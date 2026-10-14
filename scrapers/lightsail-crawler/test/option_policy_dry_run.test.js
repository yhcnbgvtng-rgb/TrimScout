import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAllowlist, loadBundledModelPoliciesRaw } from '../src/factoryOptionAllowlist.js';
import { newTally, addVehicle, finalize } from '../../../scripts/lib/optionPolicyDryRun.mjs';

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
