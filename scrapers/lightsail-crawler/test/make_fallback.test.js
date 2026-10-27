import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveKeptMake, resolveKeptMakeDetailed } from '../src/brand_match.js';
import { makeFromVin } from '../src/vinWmi.js';

const GMC = { name: 'GMC', vinPrefixes: ['1GT', '1GK', '3GT', '3GK'] };
const STELLANTIS = { name: 'Stellantis', nameplates: ['Jeep', 'Ram', 'Dodge', 'Chrysler', 'Fiat'], vinPrefixes: ['1C4'] };
const UNKNOWN_WMI_VIN = 'XZZCJ1DH0NUL16894'; // no table row for XZZ

describe('no page make and a VIN prefix not in the WMI table: the car is kept, not dropped', () => {
  it("falls back to the dealer's brand and reports make_source=fallback", () => {
    const r = resolveKeptMakeDetailed(GMC, { make: null, vin: UNKNOWN_WMI_VIN, model: 'X' }, { make: 'GMC' });
    assert.deepEqual(r, { make: 'GMC', makeSource: 'fallback' });
  });

  it("the dealer's brand wins over the shard's brand (a Buick-GMC dealer crawled in the Buick shard)", () => {
    const buick = { name: 'Buick', vinPrefixes: ['1G4', 'KL4'] };
    assert.equal(resolveKeptMake(buick, { make: null, vin: UNKNOWN_WMI_VIN }, { make: 'GMC' }), 'GMC');
  });

  it("with no dealer brand it falls back to the shard's brand", () => {
    assert.deepEqual(resolveKeptMakeDetailed(GMC, { make: '', vin: UNKNOWN_WMI_VIN }, { make: null }), { make: 'GMC', makeSource: 'fallback' });
    assert.deepEqual(resolveKeptMakeDetailed(GMC, { make: '', vin: UNKNOWN_WMI_VIN }), { make: 'GMC', makeSource: 'fallback' });
  });

  it('a lowercase / odd-spelled roster brand is canonicalised', () => {
    assert.equal(resolveKeptMake(GMC, { make: null, vin: UNKNOWN_WMI_VIN }, { make: 'mercedes-benz' }), 'Mercedes-Benz');
  });

  it('the Stellantis umbrella is never used as a fallback make; with nothing else the car is still dropped', () => {
    assert.deepEqual(resolveKeptMakeDetailed(STELLANTIS, { make: null, vin: UNKNOWN_WMI_VIN }, { make: 'Stellantis' }), { make: null, makeSource: null });
    // ...but a real nameplate on the dealer record is fine
    assert.deepEqual(resolveKeptMakeDetailed(STELLANTIS, { make: null, vin: UNKNOWN_WMI_VIN }, { make: 'Jeep' }), { make: 'Jeep', makeSource: 'fallback' });
  });
});

describe('multi-brand dealer: the fallback only ever fills a car nothing else can place', () => {
  const dealer = { make: 'GMC' }; // a Buick-GMC store whose site also lists Dodge, Subaru, Lincoln, Honda ...

  it('a known-WMI car of another brand still gets its own make from the VIN (the Challenger is not a GMC)', () => {
    assert.deepEqual(resolveKeptMakeDetailed(GMC, { make: null, vin: '2B3LJ54T19H594202', model: 'Challenger' }, dealer), { make: 'Dodge', makeSource: 'vin' });
    assert.deepEqual(resolveKeptMakeDetailed(GMC, { make: null, vin: '4S3GTAV69P3713237', model: 'Impreza' }, dealer), { make: 'Subaru', makeSource: 'vin' });
    assert.deepEqual(resolveKeptMakeDetailed(GMC, { make: null, vin: '5LMCJ1DH0NUL16894', model: 'Corsair' }, dealer), { make: 'Lincoln', makeSource: 'vin' });
  });

  it('a page make is never replaced by the fallback', () => {
    assert.deepEqual(resolveKeptMakeDetailed(GMC, { make: 'Honda', vin: UNKNOWN_WMI_VIN }, dealer), { make: 'Honda', makeSource: 'page' });
  });

  it('a car whose page make the VIN contradicts but cannot replace (shared WMI) is not rescued by the fallback', () => {
    // 5XY is shared Kia/Hyundai; the page says Ford, the VIN says "not Ford", and cannot say which of the two.
    assert.deepEqual(resolveKeptMakeDetailed(GMC, { make: 'Ford', vin: '5XYK23DF6SG321699', model: 'Sportage' }, dealer), { make: null, makeSource: null });
  });

  it('a shared WMI only accepts a fallback inside its own family', () => {
    const nissan = { name: 'Nissan', vinPrefixes: ['1N4'] }; // 5N1 is not among this shard's own prefixes
    // 5N1 is Nissan/Infiniti: a Nissan roster fills it; a GMC roster must not stamp GMC on it
    assert.deepEqual(resolveKeptMakeDetailed(nissan, { make: null, vin: '5N1AC0EX3VC612423' }, { make: 'Nissan' }), { make: 'Nissan', makeSource: 'fallback' });
    assert.deepEqual(resolveKeptMakeDetailed(GMC, { make: null, vin: '5N1AC0EX3VC612423' }, { make: 'GMC' }), { make: null, makeSource: null });
    // dealer brand outside the family, shard brand inside it: the shard brand is used
    assert.deepEqual(resolveKeptMakeDetailed(nissan, { make: null, vin: '5N1AC0EX3VC612423' }, { make: 'GMC' }), { make: 'Nissan', makeSource: 'fallback' });
  });
});

// VINs from box4's 2026-10-27 crawl logs ("make unresolvable ... car skipped"), each of a prefix the table did not know.
const FROM_BOX4_LOGS = [
  ['1G2MG35XX7Y117329', 'Pontiac'], ['1G8ZV57757F265961', 'Saturn'], ['2G4GS5ER4C9215657', 'Buick'], ['2G61M5S3XE9321976', 'Cadillac'],
  ['3GYFNAE32CS508014', 'Cadillac'], ['1NXBU4EE1AZ317347', 'Toyota'], ['1YVHZ8BH3C5M07273', 'Mazda'], ['2CNBE18C426921660', 'Chevrolet'],
  ['3MVDMABL3MM308834', 'Mazda'], ['3N8AP6BA0SL309664', 'Nissan'], ['5BZAF0AA1MN851002', 'Nissan'], ['5FRYD3H35HB003575', 'Acura'],
  ['5NTJADDE3VH184702', 'Hyundai'], ['5XXG14J21MG028963', 'Kia'], ['7G2CEHED8RA009711', 'Tesla'], ['7JDDA3VL5TG060703', 'Volvo'],
  ['7MMVAABW1TN191543', 'Mazda'], ['7MUAAAAG0VV45B401', 'Toyota'], ['7SVAAAAAXTX005092', 'Toyota'], ['7FARS3H27TE007711', 'Honda'],
];

// Six more clear prefixes from the same logs (added after the first twenty).
FROM_BOX4_LOGS.push(
  ['2G2FS32K922108501', 'Pontiac'], ['7PDSGBBA6RN031476', 'Rivian'], ['7YAKMDDC2TY070915', 'Hyundai'],
  ['JS2YA5A53B6301004', 'Suzuki'], ['JHLRD78936C044284', 'Honda'], ['3MYDLBYV2HY191802', 'Toyota'],
);

describe('WMI prefixes added from box4 2026-10-27 skipped VINs', () => {
  for (const [vin, make] of FROM_BOX4_LOGS) {
    it(`${vin.slice(0, 3)} -> ${make}`, () => {
      assert.equal(makeFromVin(vin), make);
      // named by the VIN even on a lot whose roster brand is something else: a VIN-named car is never a fallback
      assert.equal(resolveKeptMakeDetailed(GMC, { make: null, vin }, { make: 'GMC' }).makeSource, 'vin');
    });
  }
});
