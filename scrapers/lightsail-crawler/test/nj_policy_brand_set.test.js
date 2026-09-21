import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// nj_policy.js reads CRAWLER_BRAND_SET once at module load (same pattern as
// CRAWLER_STATE/CRAWLER_BRAND in standalone.js) — in production that's fine
// because every real invocation is a fresh process. To exercise both
// branches in one test process, we set the env var and re-import with a
// cache-busting query string so Node's ESM loader gives us a fresh module
// instance instead of the cached one.
async function loadPolicy(brandSet) {
  const prev = process.env.CRAWLER_BRAND_SET;
  if (brandSet) process.env.CRAWLER_BRAND_SET = brandSet;
  else delete process.env.CRAWLER_BRAND_SET;
  try {
    return await import(`../src/nj_policy.js?t=${Date.now()}-${Math.random()}`);
  } finally {
    if (prev === undefined) delete process.env.CRAWLER_BRAND_SET;
    else process.env.CRAWLER_BRAND_SET = prev;
  }
}

describe('nj_policy.js brand-set scoping (CRAWLER_BRAND_SET)', () => {
  let originalEnv;
  before(() => { originalEnv = process.env.CRAWLER_BRAND_SET; });
  after(() => {
    if (originalEnv === undefined) delete process.env.CRAWLER_BRAND_SET;
    else process.env.CRAWLER_BRAND_SET = originalEnv;
  });

  it('default (unset, box 1/box 2): NJ_BRANDS_IN/OUT are exactly the core lists — unchanged from before this existed', async () => {
    const core = await loadPolicy(undefined);
    assert.deepEqual(core.NJ_BRANDS_IN, core.NJ_BRANDS_IN_CORE);
    assert.deepEqual(core.NJ_BRANDS_OUT, core.NJ_BRANDS_OUT_CORE);
    assert.equal(core.isNjBrandIn('Toyota'), true);
    assert.equal(core.isNjBrandIn('Ford'), false);
    assert.equal(core.isNjBrandOut('Ford'), true);
  });

  it('"core" explicitly set behaves identically to unset', async () => {
    const core = await loadPolicy('core');
    assert.deepEqual(core.NJ_BRANDS_IN, core.NJ_BRANDS_IN_CORE);
  });

  it('expansion (box 3/box 4): Ford/Chevrolet/GMC/Buick/Cadillac/Lincoln/Stellantis are in, core brands are out', async () => {
    const exp = await loadPolicy('expansion');
    assert.deepEqual(exp.NJ_BRANDS_IN, exp.NJ_BRANDS_IN_EXPANSION);
    for (const b of ['Ford', 'Lincoln', 'Chevrolet', 'GMC', 'Buick', 'Cadillac', 'Stellantis']) {
      assert.equal(exp.isNjBrandIn(b), true, `${b} should be in-scope under expansion`);
    }
    assert.equal(exp.isNjBrandIn('Toyota'), false, 'core-set brands are not in-scope under expansion');
    assert.equal(exp.isNjBrandOut('Genesis'), true);
    assert.equal(exp.isNjBrandOut('Tesla'), true);
  });

  it('expansion: Stellantis nameplates (Jeep/Ram/Dodge/Chrysler/Fiat) all canonicalize to "Stellantis" and are in-scope', async () => {
    const exp = await loadPolicy('expansion');
    for (const nameplate of ['Jeep', 'ram', 'Dodge', 'CHRYSLER', 'Fiat']) {
      assert.equal(exp.canonicalBrandName(nameplate), 'Stellantis', `${nameplate} should canonicalize to Stellantis`);
      assert.equal(exp.isNjBrandIn(nameplate), true, `${nameplate} should resolve in-scope via the Stellantis alias`);
    }
  });

  it('expansion: combo/multi-franchise dealers are NOT excluded (the core-only combo rule is dropped)', async () => {
    const exp = await loadPolicy('expansion');
    assert.equal(exp.isMegadealerOrSuperstore({ name: 'Swickard Chevrolet Buick GMC of Anchorage' }), false);
    assert.equal(exp.isMegadealerOrSuperstore({ name: 'Kendall Ford Lincoln of Anchorage' }), false);
  });

  it('expansion: true superstore chains are still excluded (that part of the rule is unchanged)', async () => {
    const exp = await loadPolicy('expansion');
    assert.equal(exp.isMegadealerOrSuperstore({ name: 'AutoNation Ford' }), true);
    assert.equal(exp.isMegadealerOrSuperstore({ name: 'CarMax Edison' }), true);
  });

  it('core: combo/multi-franchise dealers are still excluded (existing behavior, unaffected by the expansion carve-out)', async () => {
    const core = await loadPolicy('core');
    assert.equal(core.isMegadealerOrSuperstore({ name: 'Quality Chevrolet GMC' }), true);
  });
});
