// Exact aliases for the Hyundai, BMW and Mercedes-Benz option policies (scripts/lib/optionPolicyAliases.mjs) and the "skip, never strip" rule in the apply scripts.
// Every feed string below is a real one from the 2026-10-13 box2 read-only pull. Ruling: exact spellings only, no fuzzy matching, no year-to-year mapping.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAllowlist, buildModelPolicies, loadBundledModelPoliciesRaw, modelPoliciesFor, optionRowsForVehicle, policyApiOptions, policyFacetRows, resolvePolicyTrim } from '../src/factoryOptionAllowlist.js';
import { ALIASES } from '../../../scripts/lib/optionPolicyAliases.mjs';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ALLOW = buildAllowlist(null, loadBundledModelPoliciesRaw());
/** { scope, trim } for a feed car: scope null = no policy covers it; trim null = covered but untrusted. */
const resolve = (make, year, model, trim) => {
  const v = { make, year, model, trim };
  const ps = modelPoliciesFor(ALLOW, v);
  if (!ps.length) return { scope: null, trim: null };
  for (const p of ps) { const hit = resolvePolicyTrim(p, trim, model); if (hit) return { scope: p.scope, trim: hit.trim.label }; }
  return { scope: ps[0].scope, trim: null };
};
const label = (r) => (r.trim ? r.trim.toLowerCase() : null);
const trusted = (make, year, model, trim, scope, want) => { const r = resolve(make, year, model, trim); assert.equal(r.scope, scope, `${year} ${model} | ${trim}: scope`); assert.equal(label(r), want, `${year} ${model} | ${trim}: trim`); };
const untrusted = (make, year, model, trim) => { const r = resolve(make, year, model, trim); assert.ok(r.scope, `${year} ${model} should be covered`); assert.equal(r.trim, null, `${year} ${model} | ${trim} must stay untrusted`); };
const uncovered = (make, year, model) => assert.equal(resolve(make, year, model, 'SEL').scope, null, `${year} ${make} ${model} must stay uncovered`);

describe('engine: exact (model, trim) pairs', () => {
  const raw = { 'x|m|2026': { models: ['m'], trims: { 'full name': { label: 'Full Name', options: {} }, other: { label: 'Other', options: {} } }, modelTrimAliases: { 'm 1|short': 'full name' } } };
  const policy = [...buildModelPolicies(raw).values()][0];
  it('maps the listed pair and nothing else', () => {
    assert.equal(resolvePolicyTrim(policy, 'Short', 'M 1')?.trim.label, 'Full Name');
    assert.equal(resolvePolicyTrim(policy, 'Short', 'M 2'), null, 'same trim under another model is not mapped');
    assert.equal(resolvePolicyTrim(policy, 'Short', null), null, 'no model, no pair');
    assert.equal(resolvePolicyTrim(policy, 'Shorter', 'M 1'), null, 'no prefix / fuzzy matching');
  });
  it('never re-points a trim that already resolves', () => {
    const p = [...buildModelPolicies({ 'x|m|2026': { ...raw['x|m|2026'], modelTrimAliases: { 'm 1|other': 'full name' } } }).values()][0];
    assert.equal(resolvePolicyTrim(p, 'Other', 'M 1')?.trim.label, 'Other');
  });
});

describe('Hyundai', () => {
  it('Sonata Hybrid: the CSV Sonata policy covers the Hybrid model spelling through its Hybrid trims', () => {
    trusted('Hyundai', 2026, 'Sonata Hybrid', 'SEL', 'hyundai|sonata|2026', 'sel hybrid');
    trusted('Hyundai', 2026, 'SONATA HYBRID', 'Blue', 'hyundai|sonata|2026', 'blue hybrid');
    untrusted('Hyundai', 2026, 'Sonata Hybrid', 'Limited FWD Automatic'); // drivetrain / transmission words after a model-implied trim are not folded in (11 cars)
    trusted('Hyundai', 2026, 'Sonata', 'SEL Sport', 'hyundai|sonata|2026', 'sel sport'); // the plain Sonata is unchanged
  });
  it('seating count and transmission words are noise', () => {
    trusted('Hyundai', 2027, 'Palisade Hybrid', 'SEL 7P', 'hyundai|palisade hybrid|2027', 'sel');
    trusted('Hyundai', 2027, 'PALISADE HYBRID', 'Limited 8P', 'hyundai|palisade hybrid|2027', 'limited');
    trusted('Hyundai', 2027, 'Palisade', 'SEL Premium 7 Passenger', 'hyundai|palisade|2027', 'sel premium');
    trusted('Hyundai', 2027, 'Santa Fe', 'Limited 6P', 'hyundai|santa fe|2027', 'limited');
    trusted('Hyundai', 2027, 'Santa Fe Hybrid', 'Limited 7 Passenger', 'hyundai|santa fe hybrid|2027', 'limited');
    trusted('Hyundai', 2026, 'Tucson', 'SEL FWD Automatic', 'hyundai|tucson|2026', 'sel');
    trusted('Hyundai', 2026, 'Elantra', 'SE FWD CVT', 'hyundai|elantra|2026', 'se');
    trusted('Hyundai', 2027, 'Palisade HEV', 'Calligraphy', 'hyundai|palisade hybrid|2027', 'calligraphy');
  });
  it('Venue "SEL w/Two-Tone Roof" is the CSV "SEL w/2-Tone Roof"; Elantra N has one trim', () => {
    trusted('Hyundai', 2026, 'Venue', 'SEL w/Two-Tone Roof', 'hyundai|venue|2026', 'sel w/ 2-tone roof');
    trusted('Hyundai', 2026, 'VENUE', 'SEL Wtwo Tone Roof', 'hyundai|venue|2026', 'sel w/ 2-tone roof');
    trusted('Hyundai', 2026, 'Venue', 'SEL w/Two-Tone Roof FWD', 'hyundai|venue|2026', 'sel w/ 2-tone roof');
    trusted('Hyundai', 2026, 'Elantra N', 'Sedan', 'hyundai|elantra n|2026', 'n');
    trusted('Hyundai', 2026, 'ELANTRA N', 'DCT', 'hyundai|elantra n|2026', 'n');
  });
  it('what is NOT mapped stays untrusted (left for a ruling)', () => {
    untrusted('Hyundai', 2026, 'Tucson Hybrid', 'Blue');
    untrusted('Hyundai', 2026, 'Elantra Hybrid', 'SEL Sport Plus');
    untrusted('Hyundai', 2027, 'Palisade Hybrid', 'Blue SEL Premium 7P');
    untrusted('Hyundai', 2027, 'Santa Cruz', 'SEL');
    untrusted('Hyundai', 2026, 'Elantra N', 'Base');
  });
  it('a model-year without a policy is never mapped from another year', () => {
    for (const [y, m] of [[2026, 'Santa Fe'], [2026, 'Palisade'], [2026, 'Santa Fe Hybrid'], [2026, 'Kona'], [2025, 'Tucson'], [2027, 'Sonata Hybrid'], [2026, 'IONIQ 5']]) uncovered('Hyundai', y, m);
  });
});

describe('BMW', () => {
  it('X-series trims: the feed drops the model prefix BMW puts in the trim name', () => {
    trusted('BMW', 2026, 'X3', '30 xDrive', 'bmw|x3|2026', 'x3 30 xdrive');
    trusted('BMW', 2026, 'X3', '30 Xdrive', 'bmw|x3|2026', 'x3 30 xdrive');
    trusted('BMW', 2026, 'X3', 'M50 xDrive', 'bmw|x3|2026', 'x3 m50 xdrive');
    trusted('BMW', 2026, 'X3', '30 xDrive AWD Automatic', 'bmw|x3|2026', 'x3 30 xdrive');
    trusted('BMW', 2026, 'X3', '30 xDrive Sports Activity', 'bmw|x3|2026', 'x3 30 xdrive');
    trusted('BMW', 2026, 'X3 30 xDrive', 'AWD Automatic', 'bmw|x3|2026', 'x3 30 xdrive');
    trusted('BMW', 2027, 'X7', 'xDrive40i', 'bmw|x7|2027', 'x7 xdrive40i');
    trusted('BMW', 2027, 'X7', 'M60i', 'bmw|x7|2027', 'x7 m60i');
    trusted('BMW', 2027, 'X7 xDrive40i', 'AWD Automatic', 'bmw|x7|2027', 'x7 xdrive40i');
    trusted('BMW', 2027, 'X5', '40 xDrive', 'bmw|x5|2027', 'x5 40 xdrive');
    trusted('BMW', 2027, 'X5 40', 'xDrive', 'bmw|x5|2027', 'x5 40 xdrive');
    trusted('BMW', 2027, 'X1', 'xDrive28i', 'bmw|x1|2027', 'x1 xdrive28i');
    trusted('BMW', 2027, 'X2', 'M35i', 'bmw|x2|2027', 'x2 m35i');
    trusted('BMW', 2027, 'X6', 'xDrive40i', 'bmw|x6|2027', 'x6 xdrive40i');
    trusted('BMW', 2027, 'X6 M', 'Competition', 'bmw|x6|2027', 'x6 m competition');
    trusted('BMW', 2027, 'iX3', '50 xDrive', 'bmw|ix3|2027', 'ix3 50 xdrive');
    trusted('BMW', 2027, 'XM', 'Label', 'bmw|xm|2027', 'xm label');
  });
  it('sedan-only model names map to the sedan trims', () => {
    trusted('BMW', 2026, '330i', 'xDrive', 'bmw|3 series sedan|2026', '330i xdrive sedan');
    trusted('BMW', 2026, '3 Series', '330i', 'bmw|3 series sedan|2026', '330i sedan');
    trusted('BMW', 2026, '3 Series', 'M340i xDrive', 'bmw|3 series sedan|2026', 'm340i xdrive sedan');
    trusted('BMW', 2027, '530i', 'xDrive', 'bmw|5 series sedan|2027', '530i xdrive sedan');
    trusted('BMW', 2027, '5 Series', '550e xDrive', 'bmw|5 series sedan|2027', '550e xdrive sedan');
    trusted('BMW', 2027, '740i', 'xDrive', 'bmw|7 series sedan|2027', '740 xdrive sedan');
  });
  it('unlisted strings stay untrusted; bodies that span coupe / gran coupe / convertible stay out', () => {
    untrusted('BMW', 2026, '330i', 'Base');
    untrusted('BMW', 2026, '3 Series', '330i NA xDrive');
    untrusted('BMW', 2027, '740i', 'Base');
    untrusted('BMW', 2026, 'X3', 'Base');
    untrusted('BMW', 2027, 'X7', 'Lease Offers');
    uncovered('BMW', 2026, '2 Series');
    uncovered('BMW', 2027, '4 Series');
    uncovered('BMW', 2026, 'X5');
    uncovered('BMW', 2026, 'X5 PHEV');
  });
});

describe('Mercedes-Benz', () => {
  it('"&reg;" left in the feed text is noise; a body word in the trim picks the policy', () => {
    trusted('Mercedes-Benz', 2026, 'C 300', 'C 300 4MATIC &reg; Sedan', 'mercedes-benz|c class sedan|2026', 'c 300 4matic sedan');
    trusted('Mercedes-Benz', 2026, 'C-Class', 'C 300 Sedan', 'mercedes-benz|c class sedan|2026', 'c 300 sedan');
    trusted('Mercedes-Benz', 2027, 'GLC 300', 'GLC 300 4MATIC &reg; SUV', 'mercedes-benz|glc suv|2027', 'glc 300 4matic suv');
    trusted('Mercedes-Benz', 2027, 'GLC 300', 'GLC 300 4MATIC &reg; Coupe', 'mercedes-benz|glc coupe|2027', 'glc 300 4matic coupe');
    trusted('Mercedes-Benz', 2027, 'GLC 300', 'GLC 300 SUV', 'mercedes-benz|glc suv|2027', 'glc 300 suv');
    trusted('Mercedes-Benz', 2027, 'GLE 450', 'GLE 450 4MATIC &reg; Coupe', 'mercedes-benz|gle coupe|2027', 'gle 450 4matic coupe');
    trusted('Mercedes-Benz', 2027, 'GLC 400', 'GLC 400 Electric 4MATIC &reg; SUV', 'mercedes-benz|glc electric suv|2027', 'glc 400 4matic electric suv');
    trusted('Mercedes-Benz', 2027, 'E-Class', 'E 350 RWD Sedan', 'mercedes-benz|e class sedan|2027', 'e 350 sedan');
    trusted('Mercedes-Benz', 2027, 'CLE 300', 'CLE 300 4MATIC &reg; Cabriolet', 'mercedes-benz|cle cabriolet|2027', 'cle 300 4matic cabriolet');
    trusted('Mercedes-Benz', 2027, 'G-Class', 'AMG &reg; G 63 SUV', 'mercedes-benz|g class suv|2027', 'amg g 63 suv');
  });
  it('model + trim pairs that name ONE policy trim', () => {
    trusted('Mercedes-Benz', 2026, 'C 300', '4MATIC', 'mercedes-benz|c class sedan|2026', 'c 300 4matic sedan');
    trusted('Mercedes-Benz', 2026, 'GLA 250', '4MATIC', 'mercedes-benz|gla suv|2026', 'gla 250 4matic suv');
    trusted('Mercedes-Benz', 2026, 'GLB', 'GLB 250', 'mercedes-benz|glb suv|2026', 'glb 250 suv');
    trusted('Mercedes-Benz', 2027, 'GLE 350', '4MATIC', 'mercedes-benz|gle suv|2027', 'gle 350 4matic suv');
    trusted('Mercedes-Benz', 2027, 'GLS 450', '4MATIC', 'mercedes-benz|gls suv|2027', 'gls 450 4matic suv');
    trusted('Mercedes-Benz', 2027, 'CLA 220', 'CLA 220 Hybrid FWD', 'mercedes-benz|cla sedan|2027', 'cla 220 hybrid sedan');
    trusted('Mercedes-Benz', 2027, 'CLA 350', 'CLA 350 Electric 4MATIC &reg;', 'mercedes-benz|cla sedan|2027', 'cla 350 4matic electric sedan');
    trusted('Mercedes-Benz', 2027, 'S-Class', 'S 580', 'mercedes-benz|s class sedan|2027', 's 580 4matic sedan');
  });
  it('ambiguous strings stay untrusted (SUV or coupe? RWD or 4MATIC?)', () => {
    untrusted('Mercedes-Benz', 2027, 'GLC 300', '4MATIC');
    untrusted('Mercedes-Benz', 2027, 'GLC 300', 'GLC 300');
    untrusted('Mercedes-Benz', 2027, 'GLE 450', '4MATIC');
    untrusted('Mercedes-Benz', 2027, 'S-Class', '4MATIC');
    untrusted('Mercedes-Benz', 2027, 'E-Class', 'E 450 4MATIC');
    untrusted('Mercedes-Benz', 2026, 'C 300', 'Sedan');
  });
  it('a model-year without a policy, and vans, are never mapped', () => {
    for (const [y, m] of [[2026, 'GLC 300'], [2026, 'GLE 350'], [2026, 'Sprinter 2500'], [2027, 'C-Class'], [2026, 'AMG GLC 43']]) uncovered('Mercedes-Benz', y, m);
  });
});

describe('aliases are exact data, reviewed in one file', () => {
  it('every alias target is a real trim of its scope (the builder fails otherwise) and the generated JSON is current', () => {
    const raw = loadBundledModelPoliciesRaw();
    let n = 0;
    for (const [brand, scopes] of Object.entries(ALIASES)) {
      const make = brand === 'mercedes' ? 'mercedes-benz' : brand;
      for (const [scope, al] of Object.entries(scopes)) {
        const [year, model] = scope.split('|');
        const key = Object.keys(raw).find((k) => k.startsWith(`${make}|`) && k.endsWith(`|${year}`) && raw[k].source.includes(`(${year} ${model})`));
        assert.ok(key, `${brand} ${scope} has a policy`);
        for (const to of [...Object.values(al.trimAliases || {}), ...Object.values(al.modelTrim || {})]) { n++; assert.ok(Object.keys(raw[key].trims).some((t) => t === to.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || raw[key].trims[t].label.toLowerCase() === to.toLowerCase()), `${scope}: target ${to}`); }
      }
    }
    assert.ok(n >= 80, `checked ${n} alias targets`);
  });
  it('no alias maps a year to another year: every aliased model spelling lives inside its own make + year scope', () => {
    for (const p of modelPoliciesFor(ALLOW, { make: 'BMW', model: 'X3 30 xDrive', year: 2026 })) assert.equal(p.year, '2026');
    assert.deepEqual(modelPoliciesFor(ALLOW, { make: 'BMW', model: 'X3 30 xDrive', year: 2027 }), []);
  });
});

describe('apply scripts skip, never strip, a car with no trusted trim', () => {
  for (const b of ['buick', 'cadillac', 'chevrolet', 'ford', 'gmc', 'honda', 'hyundai', 'kia']) {
    it(`${b}: plan phase leaves cars with an untrusted or blank trim alone and counts them`, () => {
      const src = fs.readFileSync(path.join(repo, `scripts/box/2026-10-11-${b}-option-policy-apply.mjs`), 'utf8');
      const skip = src.indexOf('if (!res.trimTrusted) { t.skippedNoTrustedTrim++; continue; }');
      assert.ok(skip > 0, 'skips on !trimTrusted');
      assert.ok(skip < src.indexOf('const before = by.get'), 'the skip comes before anything is planned or backed up');
      assert.match(src, /skippedNoTrustedTrim: 0/);
    });
  }
  it('the engine marks exactly those cars: blank and unknown trims are not trusted, listed ones are', () => {
    const run = (trim) => optionRowsForVehicle(ALLOW, { make: 'BMW', model: 'X3', year: 2026, trim }, [{ name: 'Weather Package' }]);
    assert.equal(run('').trimTrusted, false);
    assert.equal(run('Base').trimTrusted, false);
    assert.equal(run('30 xDrive').trimTrusted, true);
  });
});

describe('the nightly sync never empties a car because of a trim it cannot read', () => {
  const sync = (vehicle) => policyFacetRows(ALLOW, vehicle, [{ name: 'Weather Package' }]);
  it('blank trim, unknown trim and a listed-but-ambiguous string all skip; a trusted trim still writes rows', () => {
    assert.deepEqual(sync({ make: 'Hyundai', model: 'Tucson Hybrid', year: 2026, trim: 'Blue' }), { skip: true });
    assert.deepEqual(sync({ make: 'BMW', model: 'X3', year: 2026, trim: '' }), { skip: true });
    assert.deepEqual(sync({ make: 'BMW', model: 'X3', year: 2026, trim: 'Base' }), { skip: true });
    assert.deepEqual(sync({ make: 'Mercedes-Benz', model: 'GLC 300', year: 2027, trim: '4MATIC' }), { skip: true });
    const ok = sync({ make: 'BMW', model: 'X3', year: 2026, trim: '30 xDrive' });
    assert.ok(Array.isArray(ok.rows) && !ok.skip, 'a trusted trim is written as before');
  });
  it('a car no policy covers is still the generic path (null), and the list for an untrusted car is unchanged', () => {
    assert.equal(sync({ make: 'Hyundai', model: 'Santa Fe', year: 2026, trim: 'SEL' }), null);
    assert.deepEqual(policyApiOptions(ALLOW, { make: 'BMW', model: 'X3', year: 2026, trim: 'Base' }, [{ name: 'Weather Package' }]), []);
  });
});
