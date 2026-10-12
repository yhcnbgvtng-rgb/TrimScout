import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guardParsedPrice, applyParsedPriceGuard, ceilingForMake, describePriceRejection, MAX_PRICE_JUMP } from '../src/priceGuard.js';

// The rows reported on 2026-10-12.
test('the reported junk prices are all rejected', () => {
  assert.equal(guardParsedPrice({ price: 1_250_000, make: 'Hyundai', model: 'Palisade', year: 2026 }).reject, true);
  assert.equal(guardParsedPrice({ price: 1_620_000, make: 'Hyundai', model: 'IONIQ 9', year: 2026 }).reject, true);
  assert.equal(guardParsedPrice({ price: 3_600_000, make: 'Ford', model: 'Bronco Sport', year: 2026 }).reject, true);
  assert.equal(guardParsedPrice({ price: 660_740, make: 'Ford', model: 'Explorer', year: 2025, msrp: 66_074 }).reject, true);
  assert.equal(guardParsedPrice({ price: 3_500_000, make: 'Prevost', model: 'H3-45', year: 2024 }).reject, true);
});

test('over 5x the previous price or 5x the MSRP is rejected, with the reason', () => {
  const prev = guardParsedPrice({ price: 260_001, prevPrice: 52_000, make: 'Ford', model: 'F-150', year: 2026 });
  assert.deepEqual([prev.reject, prev.reason], [true, 'over-5x-previous-price']);
  const msrp = guardParsedPrice({ price: 180_000, msrp: 35_000, make: 'Ford', model: 'Bronco Sport', year: 2026 });
  assert.deepEqual([msrp.reject, msrp.reason], [true, 'over-5x-msrp']);
  assert.equal(MAX_PRICE_JUMP, 5);
});

test('a previous price that is itself the broken one does not block the real price (live 2026-10-12: GLS $105,900, stored $10,290)', () => {
  assert.equal(guardParsedPrice({ price: 105_900, msrp: 105_900, prevPrice: 10_290, make: 'Mercedes-Benz', model: 'GLS', year: 2024 }).reject, false);
  assert.equal(guardParsedPrice({ price: 98_900, prevPrice: 9_590, make: 'Ford', model: 'F-150', year: 2023 }).reject, false);
  assert.equal(guardParsedPrice({ price: 98_900, prevPrice: 15_000, make: 'Ford', model: 'F-150', year: 2023 }).reject, true, 'at the 15k floor the reference counts');
});

test('the reason is the strongest evidence: the ceiling is reported before the ratios', () => {
  assert.equal(guardParsedPrice({ price: 727_872, msrp: 727_872, prevPrice: 35_797, make: 'Hyundai', model: 'KONA', year: 2027 }).reason, 'over-make-ceiling');
  assert.equal(guardParsedPrice({ price: 260_508, msrp: 27_865, make: 'Nissan', model: 'Sentra', year: 2027 }).reason, 'over-make-ceiling');
});

test('exactly 5x is allowed; real repricings are untouched', () => {
  assert.equal(guardParsedPrice({ price: 250_000, prevPrice: 50_000, make: 'Ford', model: 'F-150', year: 2026 }).reject, false);
  assert.equal(guardParsedPrice({ price: 47_900, prevPrice: 52_000, msrp: 55_000, make: 'Toyota', model: 'Highlander', year: 2026 }).reject, false);
  assert.equal(guardParsedPrice({ price: 2_500, make: 'Honda', model: 'Civic', year: 2005 }).reject, false, 'no minimum-price rule: a $2,500 used car is real');
});

test('a broken reference never causes a good price to be rejected', () => {
  // msrp 5,918 on a $56,995 Gladiator (the live data shows the MSRP is the corrupt field): too small to be a usable reference.
  assert.equal(guardParsedPrice({ price: 56_995, msrp: 5_918, make: 'Jeep', model: 'Gladiator', year: 2026 }).reject, false);
  assert.equal(guardParsedPrice({ price: 30_000, prevPrice: 3_000, make: 'Kia', model: 'Sportage', year: 2022 }).reject, false, 'a $3,000 previous price is a placeholder');
});

test('per-make absolute ceilings: volume makes 150k, others 300k, exotics and Porsche none', () => {
  assert.equal(ceilingForMake('Hyundai'), 150_000);
  assert.equal(ceilingForMake('toyota'), 150_000);
  assert.equal(ceilingForMake('Ford'), 300_000);
  assert.equal(ceilingForMake('Prevost'), 300_000);
  assert.equal(ceilingForMake('Ferrari'), null);
  assert.equal(ceilingForMake('Porsche'), null);
  assert.equal(guardParsedPrice({ price: 160_000, make: 'Toyota', model: 'Land Cruiser', year: 2026 }).reason, 'over-make-ceiling');
  assert.equal(guardParsedPrice({ price: 180_000, make: 'Lexus', model: 'LX 600', year: 2026 }).reject, false, 'Lexus is not a volume make');
});

test('exemptions: exotics, Porsche GT, collectibles, classics, and a price supported by its own MSRP', () => {
  assert.equal(guardParsedPrice({ price: 450_000, make: 'Ferrari', model: '296 GTB', year: 2025 }).reject, false);
  assert.equal(guardParsedPrice({ price: 410_000, make: 'Porsche', model: '911 GT3 RS', year: 2024 }).reject, false);
  assert.equal(guardParsedPrice({ price: 330_000, make: 'Chevrolet', model: 'Corvette ZR1X', year: 2025, msrp: 210_000 }).reject, false);
  assert.equal(guardParsedPrice({ price: 400_000, make: 'Dodge', model: 'Viper', year: 2017 }).reject, false);
  assert.equal(guardParsedPrice({ price: 350_000, make: 'Ford', model: 'Mustang', year: 1967 }).reject, false);
  assert.equal(guardParsedPrice({ price: 340_000, make: 'Ford', model: 'Mustang GTD', year: 2025, msrp: 325_000 }).reject, false);
  assert.equal(guardParsedPrice({ price: 340_000, make: 'Ford', model: 'Mustang GTD', year: 2025 }).reject, true, 'without an MSRP to support it, over the ceiling is rejected');
});

test('applyParsedPriceGuard nulls the price (and an MSRP that is a copy of it), keeps everything else, never clamps', () => {
  const v = { vin: 'V1', price: 3_600_000, msrp: 3_600_000, make: 'Ford', model: 'Bronco Sport', year: 2026, dealerName: 'Some Ford' };
  const verdict = applyParsedPriceGuard(v, undefined);
  assert.equal(verdict.reject, true);
  assert.equal(v.price, null);
  assert.equal(v.msrp, null);
  assert.equal(v.model, 'Bronco Sport');
  assert.match(describePriceRejection(v, verdict), /V1.*3600000 rejected \(over-make-ceiling/);

  const ok = { vin: 'V2', price: 41_000, msrp: 43_000, make: 'Ford', model: 'Bronco Sport', year: 2026 };
  assert.equal(applyParsedPriceGuard(ok, { price: 40_500 }).reject, false);
  assert.equal(ok.price, 41_000);

  const keepMsrp = { vin: 'V3', price: 900_000, msrp: 42_000, make: 'Hyundai', model: 'Palisade', year: 2026 };
  applyParsedPriceGuard(keepMsrp, { price: 41_000 });
  assert.equal(keepMsrp.price, null);
  assert.equal(keepMsrp.msrp, 42_000, 'a sane MSRP is kept');
});

test('standalone.js runs the guard once, on the final vehicle, before it is stored', () => {
  const src = readFileSync(new URL('../src/standalone.js', import.meta.url), 'utf8');
  assert.match(src, /applyParsedPriceGuard\(vehicle, previousSnapshot\[vehicle\.vin\]\)/);
  assert.ok(src.indexOf('applyParsedPriceGuard(vehicle') < src.indexOf('currentInventory.set(vehicle.vin, vehicle)'), 'guard comes before the store');
});
