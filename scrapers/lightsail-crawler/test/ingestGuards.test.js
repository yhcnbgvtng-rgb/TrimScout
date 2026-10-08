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
    assert.equal(guardPrice({ price: 300_001, make: 'Mercedes-Benz', year: 2024 }).reason, 'over-ceiling', 'Mercedes-Benz with no MSRP to support it');
    assert.equal(guardPrice({ price: 999_999, make: 'LEXUS', year: 2024 }).price, null);
  });

  it('exotics keep a six-figure price above the ceiling', () => {
    for (const make of ['Ferrari', 'LAMBORGHINI', 'Rolls-Royce', 'rolls royce', 'Bentley', 'McLaren', 'Aston Martin', 'Bugatti']) {
      assert.equal(isExoticMake(make), true, make);
      assert.equal(guardPrice({ price: 425_000, make, year: 2024 }).price, 425_000, make);
    }
    assert.equal(isExoticMake('Toyota'), false);
    assert.equal(isExoticMake('Porsche'), false, 'Porsche is exempt from the ceiling by its own rule, not by being an exotic');
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

describe('guardPrice — corrections from the live data (2026-10-07)', () => {
  it('Porsche GT cars above $300k keep their price, with a normal MSRP or a nonsense one (498, 799)', () => {
    assert.deepEqual(guardPrice({ price: 341_000, msrp: 241_300, make: 'Porsche', model: '911 GT3 RS', year: 2025 }), { price: 341_000, msrp: 241_300, reason: null });
    assert.equal(guardPrice({ price: 336_000, msrp: 498, make: 'Porsche', model: '911', year: 2024 }).price, 336_000);
    assert.equal(guardPrice({ price: 336_000, msrp: 799, make: 'PORSCHE', model: '911', year: 2024 }).price, 336_000);
    assert.equal(guardPrice({ price: 1_600_000, msrp: 1_500_000, make: 'Porsche', model: '918 Spyder', year: 2015 }).price, 1_600_000);
  });
  it('a price above $300k is kept when its own MSRP supports it (<= 2x a usable MSRP)', () => {
    assert.equal(guardPrice({ price: 330_000, msrp: 210_000, make: 'Chevrolet', model: 'Corvette', year: 2025 }).price, 330_000, 'Corvette ZR1X');
    assert.equal(guardPrice({ price: 410_000, msrp: 205_000, make: 'Mercedes-Benz', model: 'G-Class', year: 2025 }).price, 410_000, 'exactly 2x');
    assert.equal(guardPrice({ price: 410_001, msrp: 205_000, make: 'Mercedes-Benz', model: 'G-Class', year: 2025 }).reason, 'over-ceiling', 'just past 2x');
  });
  it('known collectible/halo models keep a price above the ceiling whatever the MSRP says', () => {
    for (const [make, model] of [['Dodge', 'Viper ACR'], ['Chevrolet', 'Corvette ZR1X'], ['Mercedes-Benz', 'G 63 AMG'], ['Mercedes-Benz', 'AMG GT Black Series'], ['Acura', 'NSX'], ['Ford', 'GT'], ['Lexus', 'LFA'], ['Nissan', 'GT-R']]) {
      assert.equal(guardPrice({ price: 320_000, msrp: 90_000, make, model, year: 2021 }).price, 320_000, `${make} ${model}`);
    }
    assert.equal(guardPrice({ price: 320_000, msrp: 90_000, make: 'Toyota', model: 'Camry', year: 2021 }).reason, 'over-ceiling', 'an ordinary model is still rejected');
  });
  it('~10x pair where the PRICE is the broken one: the price is nulled, the MSRP kept (Explorer $660,740 vs $66,074)', () => {
    assert.deepEqual(guardPrice({ price: 660_740, msrp: 66_074, make: 'Ford', model: 'Explorer', year: 2025 }), { price: null, msrp: 66_074, reason: 'x10-msrp' });
    assert.deepEqual(guardPrice({ price: 509_100, msrp: 50_910, make: 'Nissan', model: 'Murano', year: 2025 }), { price: null, msrp: 50_910, reason: 'x10-msrp' });
  });
  it('~10x pair where the MSRP is the broken one: the MSRP is nulled and the CORRECT price survives (Ram 3500 $75,170 vs $7,514; Gladiator $56,995 vs $5,918)', () => {
    assert.deepEqual(guardPrice({ price: 75_170, msrp: 7_514, make: 'Ram', model: '3500', year: 2025 }), { price: 75_170, msrp: null, reason: 'x10-msrp-bad-msrp' });
    assert.deepEqual(guardPrice({ price: 56_995, msrp: 5_918, make: 'Jeep', model: 'Gladiator', year: 2025 }), { price: 56_995, msrp: null, reason: 'x10-msrp-bad-msrp' });
  });
  it('the boundary between the two: an MSRP of exactly $15,000 is usable (price is the broken one), below it is not', () => {
    assert.equal(guardPrice({ price: 150_000, msrp: 15_000, make: 'Ford', year: 2024 }).price, null);
    assert.equal(guardPrice({ price: 149_000, msrp: 14_900, make: 'Ford', year: 2024 }).price, 149_000);
    assert.equal(guardPrice({ price: 149_000, msrp: 14_900, make: 'Ford', year: 2024 }).msrp, null);
  });
  it('when the price is also outside the normal band the price goes (both numbers nonsense): never keep a >$300k price on a ~10x pair', () => {
    assert.deepEqual(guardPrice({ price: 3_100_000, msrp: 310_000, make: 'Toyota', year: 2024 }).price, null);
    assert.deepEqual(guardPrice({ price: 99_000, msrp: 9_900, make: 'Kia', year: 2024 }), { price: 99_000, msrp: null, reason: 'x10-msrp-bad-msrp' }, 'normal price: the MSRP is blamed');
  });
  it('the handler-facing contract: reason is null (no change) for everything legitimate in the cases above', () => {
    assert.equal(guardPrice({ price: 38_000, msrp: 36_000, make: 'Toyota', model: 'Camry', year: 2025 }).reason, null);
    assert.equal(guardPrice({ price: 2_500, msrp: null, make: 'Ford', year: 2009 }).reason, null);
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
