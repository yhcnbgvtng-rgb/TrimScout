// DISABLE_FACET_REBUILD stays a kill switch for every automatic rebuild, but an explicit manual
// POST /api/inventory/catalog-facets/rebuild may run while it is set.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { facetRebuildAllowed } from '../src/facetRebuildGate.js';

describe('facetRebuildAllowed', () => {
  it('allows everything when the switch is unset or empty', () => {
    assert.equal(facetRebuildAllowed({}), true);
    assert.equal(facetRebuildAllowed({ DISABLE_FACET_REBUILD: '' }), true);
    assert.equal(facetRebuildAllowed({ DISABLE_FACET_REBUILD: '' }, { manual: true }), true);
    assert.equal(facetRebuildAllowed(undefined), true);
  });

  it('with the switch set, blocks automatic rebuilds (no options, empty options, manual absent/false/truthy-but-not-true)', () => {
    const env = { DISABLE_FACET_REBUILD: '1' };
    assert.equal(facetRebuildAllowed(env), false);
    assert.equal(facetRebuildAllowed(env, {}), false);
    assert.equal(facetRebuildAllowed(env, undefined), false);
    assert.equal(facetRebuildAllowed(env, null), false);
    assert.equal(facetRebuildAllowed(env, { manual: false }), false);
    assert.equal(facetRebuildAllowed(env, { manual: 1 }), false);
    assert.equal(facetRebuildAllowed(env, { manual: 'true' }), false);
  });

  it('with the switch set, allows only an explicit manual: true', () => {
    assert.equal(facetRebuildAllowed({ DISABLE_FACET_REBUILD: '1' }, { manual: true }), true);
  });
});

// deals_api_server.js can't be imported in a test (it starts a server), so pin the wiring in its source:
// exactly one caller may pass { manual: true } — the explicit POST handler — and the gate must be the guard.
describe('deals_api_server.js wiring', () => {
  const src = fs.readFileSync(new URL('../src/deals_api_server.js', import.meta.url), 'utf8');

  it('rebuildCatalogFacets is guarded by facetRebuildAllowed, not a bare env check', () => {
    assert.match(src, /async function rebuildCatalogFacets\(pool, opts = \{\}\) \{\s*\n\s*if \(!facetRebuildAllowed\(process\.env, opts\)\) return;/);
    assert.doesNotMatch(src, /if \(process\.env\.DISABLE_FACET_REBUILD\) return;/);
  });

  it('only the POST /catalog-facets/rebuild handler passes manual: true', () => {
    const calls = [...src.matchAll(/rebuildCatalogFacets\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => a !== 'pool, opts = {}');
    const manual = calls.filter((a) => /manual:\s*true/.test(a));
    assert.equal(manual.length, 1, `calls: ${JSON.stringify(calls)}`);
    const handler = src.slice(src.indexOf('async function handleCatalogFacetRebuild'), src.indexOf('async function handleCatalogFacetStatus'));
    assert.match(handler, /rebuildCatalogFacets\(pool, \{ manual: true \}\)/);
  });

  it('the debounced timer, the finish re-queue and the startup check never pass manual', () => {
    for (const re of [
      /setTimeout\(\(\) => \{ void rebuildCatalogFacets\(getPool\(\)\); \}/,
      /catalogFacets\.again = false; void rebuildCatalogFacets\(pool\);/,
      /if \(!catalogFacets\.builtAt\) void rebuildCatalogFacets\(pool\);/,
    ]) assert.match(src, re);
  });
});
