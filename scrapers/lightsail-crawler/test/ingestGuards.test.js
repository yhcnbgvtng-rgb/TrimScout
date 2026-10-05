import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { guardPrice, canonicalMake, isExoticMake, PRICE_CEILING } from '../src/ingestGuards.js';
import { normalizeMakeForWrite } from '../src/stellantisMake.js';

describe('guardPrice', () => {
  it('keeps ordinary prices, including cheap used cars (there is no minimum-price rule)', () => {
    for (const price of [2_500, 899, 1, 24_995, 61_900, 299_999, PRICE_CEILING]) {
      assert.deepEqual(guardPrice({ price, msrp: null, make: 'Toyota', year: 2022 }), { price, msrp: null, reason: null }, String(price));
    }
  });

  it('a price above $300k on a non-exotic is dropped', () => {
    assert.deepEqual(guardPrice({ price: 450_000, msrp: null, make: 'Toyota', year: 2023 }), { price: null, msrp: null, reason: 'over-ceiling' });
    assert.equal(guardPrice({ price: 300_001, make: 'Porsche', year: 2024 }).reason, 'over-ceiling', 'Porsche is not on the exotic list');
    assert.equal(guardPrice({ price: 999_999, make: 'LEXUS', year: 2024 }).price, null);
  });

  it('exotics keep a six-figure price above the ceiling', () => {
    for (const make of ['Ferrari', 'LAMBORGHINI', 'Rolls-Royce', 'rolls royce', 'Bentley', 'McLaren', 'Aston Martin', 'Bugatti']) {
      assert.equal(isExoticMake(make), true, make);
      assert.equal(guardPrice({ price: 425_000, make, year: 2024 }).price, 425_000, make);
    }
    assert.equal(isExoticMake('Toyota'), false);
    assert.equal(isExoticMake(null), false);
  });

  it('a pre-1996 collectible keeps a price above the ceiling', () => {
    assert.equal(guardPrice({ price: 440_162, make: 'Ford', year: 1965 }).price, 440_162);
    assert.equal(guardPrice({ price: 440_162, make: 'Ford', year: 1996 }).price, null, '1996 is not exempt');
    assert.equal(guardPrice({ price: 440_162, make: 'Ford', year: null }).price, null, 'no year: not exempt');
  });

  it('a price about ten times the row\'s own MSRP is dropped, for any make', () => {
    assert.deepEqual(guardPrice({ price: 459_900, msrp: 45_990, make: 'Honda', year: 2024 }), { price: null, msrp: 45_990, reason: 'x10-msrp' });
    assert.equal(guardPrice({ price: 2_500_000, msrp: 250_000, make: 'Ferrari', year: 2024 }).reason, 'x10-msrp', 'applies to exotics too');
    assert.equal(guardPrice({ price: 9 * 30_000, msrp: 30_000, make: 'Ford', year: 2024 }).reason, 'x10-msrp', 'lower edge of the band');
    assert.equal(guardPrice({ price: 11 * 30_000, msrp: 30_000, make: 'Ford', year: 2024 }).reason, 'x10-msrp', 'upper edge of the band');
  });

  it('does not fire on ratios outside the band, on a missing MSRP, or on a fee-sized "MSRP"', () => {
    assert.equal(guardPrice({ price: 60_000, msrp: 45_990, make: 'Honda', year: 2024 }).price, 60_000);
    assert.equal(guardPrice({ price: 8 * 30_000 - 1, msrp: 30_000, make: 'Ford', year: 2024 }).reason, null, 'under 9x: not the x10 rule');
    assert.equal(guardPrice({ price: 12 * 30_000, msrp: 30_000, make: 'Ford', year: 2024 }).reason, 'over-ceiling', 'over 11x only trips the ceiling rule');
    assert.equal(guardPrice({ price: 20_000, msrp: 995, make: 'Ford', year: 2024 }).price, 20_000, 'a $995 "MSRP" is a fee, not a ratio basis');
    assert.equal(guardPrice({ price: 45_000, msrp: null, make: 'Ford', year: 2024 }).price, 45_000);
  });

  it('a null/absent price is left alone and the MSRP is never modified', () => {
    assert.deepEqual(guardPrice({ price: null, msrp: 45_000, make: 'Ford' }), { price: null, msrp: 45_000, reason: null });
    assert.deepEqual(guardPrice({}), { price: null, msrp: null, reason: null });
    assert.equal(guardPrice({ price: 450_000, msrp: 777_000, make: 'Ford', year: 2024 }).msrp, 777_000);
  });
});

describe('canonicalMake', () => {
  it('collapses every case/spacing variant of a known make to one spelling', () => {
    for (const raw of ['LEXUS', 'lexus', 'Lexus', ' Lexus ', 'LeXuS']) assert.equal(canonicalMake(raw), 'Lexus', raw);
    assert.equal(canonicalMake('MERCEDES-BENZ'), 'Mercedes-Benz');
    assert.equal(canonicalMake('mercedes benz'), 'Mercedes-Benz');
    assert.equal(canonicalMake('Mercedes'), 'Mercedes-Benz');
    assert.equal(canonicalMake('LAND ROVER'), 'Land Rover');
    assert.equal(canonicalMake('landrover'), 'Land Rover');
    assert.equal(canonicalMake('ROLLS ROYCE'), 'Rolls-Royce');
    assert.equal(canonicalMake('Alfa-Romeo'), 'Alfa Romeo');
    assert.equal(canonicalMake('bmw'), 'BMW');
    assert.equal(canonicalMake('Gmc'), 'GMC');
    assert.equal(canonicalMake('MINI'), 'Mini');
    assert.equal(canonicalMake('Vw'), 'Volkswagen');
    assert.equal(canonicalMake('CHEVY'), 'Chevrolet');
  });

  it('title-cases an unknown all-upper/all-lower make, keeps short acronyms and leaves mixed case alone', () => {
    assert.equal(canonicalMake('VELOCITY MOTORS'), 'Velocity Motors');
    assert.equal(canonicalMake('velocity'), 'Velocity');
    assert.equal(canonicalMake('MG'), 'MG');
    assert.equal(canonicalMake('DeLorean'), 'DeLorean');
  });

  it('blank and absent makes stay null', () => {
    assert.equal(canonicalMake(null), null);
    assert.equal(canonicalMake(undefined), null);
    assert.equal(canonicalMake('   '), null);
  });

  it('is idempotent', () => {
    for (const raw of ['LEXUS', 'Land Rover', 'VELOCITY MOTORS', 'Mercedes', 'DeLorean']) assert.equal(canonicalMake(canonicalMake(raw)), canonicalMake(raw), raw);
  });
});

describe('normalizeMakeForWrite — the write path every make goes through', () => {
  it('canonicalizes the capitalization of a non-Stellantis make', () => {
    assert.equal(normalizeMakeForWrite({ make: 'LEXUS', vin: 'JTHBA1D20J5000001', model: 'ES' }), 'Lexus');
    assert.equal(normalizeMakeForWrite({ make: 'toyota' }), 'Toyota');
  });
  it('still resolves Stellantis and nameplate variants exactly as before', () => {
    assert.equal(normalizeMakeForWrite({ make: 'RAM' }), 'Ram');
    assert.equal(normalizeMakeForWrite({ make: 'Fiat' }), 'FIAT');
    assert.equal(normalizeMakeForWrite({ make: 'Stellantis', vin: '1C4HJXDN4NW243250', model: 'Wrangler' }), 'Jeep');
  });
  it('blank stays null', () => {
    assert.equal(normalizeMakeForWrite({ make: '' }), null);
    assert.equal(normalizeMakeForWrite({ make: null }), null);
  });
});
