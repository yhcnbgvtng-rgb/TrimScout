import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMakeForWrite, resolveUmbrellaMake, canonicalNameplate } from '../src/stellantisMake.js';

describe('normalizeMakeForWrite — never stores the Stellantis umbrella', () => {
  it('resolves umbrella rows from the VIN (line code, positions 1-5)', () => {
    assert.equal(normalizeMakeForWrite({ make: 'Stellantis', vin: '1C4SJVFJ2NS102432' }), 'Jeep');
    assert.equal(normalizeMakeForWrite({ make: 'Stellantis', vin: '1C6SRFJT3RN184304' }), 'Ram');
    assert.equal(normalizeMakeForWrite({ make: 'stellantis ', vin: '1c4sjvfj2ns102432' }), 'Jeep');
  });
  it('resolves an umbrella row carrying a foreign VIN to its real manufacturer', () => {
    assert.equal(normalizeMakeForWrite({ make: 'Stellantis', vin: '1FTFW1E50NFA00001', model: 'F-150' }), 'Ford');
    assert.equal(normalizeMakeForWrite({ make: 'Stellantis', vin: '3GNAXUEV0NL000001' }), 'Chevrolet');
  });
  it('falls back to the model when the VIN line code is new', () => {
    assert.equal(resolveUmbrellaMake({ vin: '1C4ZZZZZZZZZZZZZZ', model: 'Gladiator' }).make, 'Jeep');
    assert.equal(resolveUmbrellaMake({ vin: '3C6ZZZZZZZZZZZZZZ', model: 'ProMaster 2500' }).make, 'Ram');
  });
  it('a foreign VIN is never claimed by a Stellantis model rule', () => {
    assert.equal(resolveUmbrellaMake({ vin: '1FTFW1E50NFA00001', model: 'Ram Charger' }).via, 'other-wmi');
  });
  it('an unplaceable umbrella row becomes null, never "Stellantis"', () => {
    assert.equal(normalizeMakeForWrite({ make: 'Stellantis', vin: 'ZZZ' }), null);
    assert.equal(normalizeMakeForWrite({ make: 'Stellantis' }), null);
  });
  it('collapses nameplate spelling variants to one canonical spelling', () => {
    for (const raw of ['RAM', 'Ram', 'ram', 'RAM Trucks']) assert.equal(normalizeMakeForWrite({ make: raw }), 'Ram');
    for (const raw of ['Fiat', 'FIAT']) assert.equal(normalizeMakeForWrite({ make: raw }), 'FIAT');
    assert.equal(canonicalNameplate('Jeep®'), 'Jeep');
  });
  it('leaves every other make (and blank) exactly as it was', () => {
    assert.equal(normalizeMakeForWrite({ make: 'Ford', vin: '1FTFW1E50NFA00001' }), 'Ford');
    assert.equal(normalizeMakeForWrite({ make: 'Mercedes-Benz' }), 'Mercedes-Benz');
    assert.equal(normalizeMakeForWrite({ make: null, vin: '1C4SJVFJ2NS102432' }), null);
    assert.equal(normalizeMakeForWrite({ make: '  ' }), null);
  });
  it('is idempotent', () => {
    const once = normalizeMakeForWrite({ make: 'Stellantis', vin: '1C4SJVFJ2NS102432' });
    assert.equal(normalizeMakeForWrite({ make: once, vin: '1C4SJVFJ2NS102432' }), once);
  });
});
