import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAllowlist, loadBundledModelPoliciesRaw } from '../src/factoryOptionAllowlist.js';
import { newTally, addVehicle, finalize } from '../../../scripts/lib/optionPolicyDryRun.mjs';
import { replay } from '../../../scripts/box/2026-10-14-option-policy-replay.mjs';

const ALLOW = buildAllowlist(null, loadBundledModelPoliciesRaw());
const car = (o) => ({ vin: 'V', make: 'Ford', year: 2026, model: 'Ranger', trim: 'XLT', ...o });

describe('option policy dry-run aggregation', () => {
  it('counts before/after rows, kept vs removed stored rows, zero-option share and the top remaining options', () => {
    const t = newTally();
    addVehicle(t, ALLOW, car({ vin: 'A' }), [{ name: 'Convenience Package' }, { name: 'Apple CarPlay' }], [{ key: 'convenience package', label: 'Convenience Package' }, { key: 'apple carplay', label: 'Apple CarPlay' }]);
    addVehicle(t, ALLOW, car({ vin: 'B' }), [{ name: 'Convenience Package' }], [{ key: 'convenience package', label: 'Convenience Package' }]);
    addVehicle(t, ALLOW, car({ vin: 'C' }), [{ name: 'Apple CarPlay' }], [{ key: 'apple carplay', label: 'Apple CarPlay' }]);
    addVehicle(t, ALLOW, car({ vin: 'D', trim: 'FORD CUSTOM GARAGE' }), [{ name: 'Convenience Package' }], [{ key: 'convenience package', label: 'Convenience Package' }]);
    const r = finalize(t).scopes['ford|ranger|2026'];
    assert.equal(r.vehicles, 4);
    assert.equal(r.rowsBefore, 5);
    assert.equal(r.rowsKept, 2);          // A's and B's Convenience Package
    assert.equal(r.rowsRemoved, 3);       // Apple CarPlay x2 (standard), D's package (untrusted trim)
    assert.equal(r.rowsAfter, 2);
    assert.equal(r.zeroOptionsBeforePct, 0);
    assert.equal(r.zeroOptionsAfterPct, 50);
    assert.equal(r.noTrustedTrim, 1);
    // trusted cars: A, B, C. A and C keep a different set than stored (A loses Apple CarPlay, C loses its only row and gains nothing); B is unchanged.
    assert.equal(r.carsTrustedTrim, 3);
    assert.equal(r.trustedTrimPct, 75);
    assert.equal(r.carsWouldChange, 2);
    assert.deepEqual(r.topAfter.map((x) => [x.label, x.vehicles]), [['Convenience Package', 2]]);
    assert.deepEqual(r.topUntrustedTrims, [['FORD CUSTOM GARAGE', 1]]);
  });
  it('leaves other models and years out of the policy tallies and counts them as untouched', () => {
    const t = newTally();
    assert.equal(addVehicle(t, ALLOW, car({ model: 'Explorer' }), [{ name: 'x' }], []), null);
    assert.equal(addVehicle(t, ALLOW, car({ year: 2025 }), [{ name: 'x' }], []), null);
    const f = finalize(t);
    assert.deepEqual(f.scopes, {});
    assert.deepEqual(f.untouched.map((x) => x[0]).sort(), ['2025 Ranger', '2026 Explorer']);
  });
});

describe('offline replay of a saved dry-run pull', () => {
  it('gives the same tallies as feeding the cars straight to addVehicle, and can filter by make', async () => {
    const cars = [
      { vin: 'A', ...car({}), options: [{ name: 'Convenience Package' }, { name: 'Apple CarPlay' }], stored: [{ key: 'convenience package', label: 'Convenience Package' }, { key: 'apple carplay', label: 'Apple CarPlay' }] },
      { vin: 'B', ...car({}), options: [{ name: 'Convenience Package' }], stored: [{ key: 'convenience package', label: 'Convenience Package' }] },
      { vin: 'C', ...car({ trim: 'FORD CUSTOM GARAGE' }), options: [{ name: 'Convenience Package' }], stored: [] },
      { vin: 'D', make: 'Honda', model: 'Civic', year: 2026, trim: 'LX', options: [], stored: [] },
    ];
    const lines = (async function* () { for (const c of cars) yield JSON.stringify(c); yield ''; })();
    const direct = newTally();
    for (const c of cars.filter((x) => x.make === 'Ford')) addVehicle(direct, ALLOW, { vin: c.vin, make: c.make, model: c.model, year: c.year, trim: c.trim }, c.options, c.stored);
    const r = await replay(lines, ALLOW, 'Ford');
    assert.equal(r.carsInScope, 3);
    assert.deepEqual(r.scopes, finalize(direct).scopes);
    assert.equal(r.scopes['ford|ranger|2026'].carsWouldChange, 1); // A loses Apple CarPlay; B unchanged; C untrusted
  });
});

