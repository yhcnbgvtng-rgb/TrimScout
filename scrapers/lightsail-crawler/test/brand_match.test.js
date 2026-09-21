import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveVehicleBrandMatch } from '../src/brand_match.js';

describe('resolveVehicleBrandMatch', () => {
  it('single-nameplate brand: matches by raw make label and collapses to brand.name (existing behavior, unchanged)', () => {
    const brand = { name: 'Ford', nameplates: undefined, vinPrefixes: ['1FA', '1FT'] };
    const result = resolveVehicleBrandMatch(brand, { make: 'FORD MEDIUM TRUCK', vin: '1FTZZZZZZZZZZZZZZ' });
    assert.equal(result.isTargetBrand, true);
    assert.equal(result.resolvedMake, 'Ford');
  });

  it('single-nameplate brand: matches by VIN prefix when the raw make label is missing entirely', () => {
    const brand = { name: 'Ford', vinPrefixes: ['1FA', '1FT'] };
    const result = resolveVehicleBrandMatch(brand, { make: null, vin: '1FAZZZZZZZZZZZZZZ' });
    assert.equal(result.isTargetBrand, true);
    assert.equal(result.resolvedMake, 'Ford'); // no nameplate found in the label, falls back to brand.name
  });

  it('single-nameplate brand: a different brand on a multi-franchise site is correctly rejected', () => {
    const brand = { name: 'Ford', vinPrefixes: ['1FA', '1FT'] };
    const result = resolveVehicleBrandMatch(brand, { make: 'Lincoln', vin: '5LMZZZZZZZZZZZZZZ' });
    assert.equal(result.isTargetBrand, false);
    assert.equal(result.resolvedMake, null);
  });

  it('multi-nameplate brand (Stellantis): keeps each vehicle\'s own real nameplate, not the umbrella brand name', () => {
    const stellantis = {
      name: 'Stellantis',
      nameplates: ['Jeep', 'Ram', 'Dodge', 'Chrysler', 'Fiat'],
      vinPrefixes: ['1C4', '1J4'],
    };
    const jeep = resolveVehicleBrandMatch(stellantis, { make: 'Jeep', vin: '1J4ZZZZZZZZZZZZZZ' });
    assert.equal(jeep.isTargetBrand, true);
    assert.equal(jeep.resolvedMake, 'Jeep');

    const ram = resolveVehicleBrandMatch(stellantis, { make: 'RAM', vin: '1C6ZZZZZZZZZZZZZZ' });
    assert.equal(ram.isTargetBrand, true);
    assert.equal(ram.resolvedMake, 'Ram');

    const chrysler = resolveVehicleBrandMatch(stellantis, { make: 'Chrysler', vin: '2C3ZZZZZZZZZZZZZZ' });
    assert.equal(chrysler.resolvedMake, 'Chrysler');
  });

  it('multi-nameplate brand (Stellantis): a genuinely different make on the same combo lot is still rejected', () => {
    const stellantis = { name: 'Stellantis', nameplates: ['Jeep', 'Ram', 'Dodge', 'Chrysler', 'Fiat'], vinPrefixes: ['1C4'] };
    const result = resolveVehicleBrandMatch(stellantis, { make: 'Kia', vin: 'KNAZZZZZZZZZZZZZZ' });
    assert.equal(result.isTargetBrand, false);
  });

  it('multi-nameplate brand: VIN-prefix-only match (no nameplate in the label) falls back to the umbrella name, not a guess', () => {
    const stellantis = { name: 'Stellantis', nameplates: ['Jeep', 'Ram', 'Dodge', 'Chrysler', 'Fiat'], vinPrefixes: ['1C4'] };
    const result = resolveVehicleBrandMatch(stellantis, { make: null, vin: '1C4ZZZZZZZZZZZZZZ' });
    assert.equal(result.isTargetBrand, true);
    assert.equal(result.resolvedMake, 'Stellantis');
  });
});
