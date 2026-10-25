import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { wmiOf, makesForWmi, makeFromVin, reconcileMake } from '../src/vinWmi.js';
import { normalizeMakeForWrite } from '../src/stellantisMake.js';
import { resolveKeptMake } from '../src/brand_match.js';
import { getBrand } from '../src/brands.js';

// The five cars found stored as make="GMC" on 2026-10-24, each really another make.
const MISLABELED = [
  ['2B3LJ54T19H594202', 'Dodge', 'Challenger'],
  ['4S3GTAV69P3713237', 'Subaru', 'Impreza'],
  ['5LMCJ1DH0NUL16894', 'Lincoln', 'Corsair'],
  ['JHMGK5H76HS000056', 'Honda', 'Fit'],
  ['KL4CJCSB4JB582999', 'Buick', 'Encore'],
];
// Real GMC / Buick / Cadillac VINs already used as fixtures elsewhere in the repo.
const GMC = ['1GKB0RDC6RU100924', '3GKALTEV5LL187300'];
const BUICK = ['5GAEVAKW9RJ101917', 'KL4AMBS20RB006959', 'LRBFZPE49RD017775'];
const CADILLAC = ['1G6DF5RK5T0107960', '1G6DG5RK3P0143908', '1G6DK5RK2P0135667'];

describe('the five VINs stored as "GMC"', () => {
  for (const [vin, make, model] of MISLABELED) {
    it(`${vin} (${model}) is ${make}, not GMC`, () => {
      assert.equal(makeFromVin(vin, { model }), make);
      assert.deepEqual(reconcileMake({ make: 'GMC', vin, model }), { make, via: 'wmi-conflict', from: 'GMC' });
      assert.equal(normalizeMakeForWrite({ make: 'GMC', vin, model }), make);
    });
    it(`${vin}: a blank make is filled from the VIN`, () => {
      assert.equal(reconcileMake({ make: null, vin, model }).make, make);
      assert.equal(reconcileMake({ make: null, vin, model }).via, 'wmi-fill');
    });
  }
  it('the Challenger needs no model: the Stellantis line code (2B3LJ) names Dodge', () => {
    assert.equal(makeFromVin('2B3LJ54T19H594202'), 'Dodge');
  });
});

describe('real GMC VINs keep make GMC', () => {
  for (const vin of GMC) {
    it(vin, () => {
      assert.equal(makeFromVin(vin), 'GMC');
      assert.deepEqual(reconcileMake({ make: 'GMC', vin }), { make: 'GMC', via: 'kept', from: 'GMC' });
      assert.equal(normalizeMakeForWrite({ make: 'gmc', vin }), 'GMC');
    });
  }
  it('a GM sibling mislabelled GMC is corrected, and a GMC mislabelled as a sibling too', () => {
    assert.equal(reconcileMake({ make: 'GMC', vin: BUICK[0] }).make, 'Buick');
    assert.equal(reconcileMake({ make: 'GMC', vin: CADILLAC[0] }).make, 'Cadillac');
    assert.equal(reconcileMake({ make: 'Buick', vin: GMC[0] }).make, 'GMC');
  });
});

describe('Buick and Cadillac', () => {
  for (const vin of BUICK) {
    it(`Buick ${vin} stays Buick, and a Chevrolet/GMC label on it becomes Buick`, () => {
      assert.equal(makeFromVin(vin), 'Buick');
      assert.equal(reconcileMake({ make: 'Buick', vin }).via, 'kept');
      for (const wrong of ['GMC', 'Chevrolet', 'Cadillac']) assert.equal(reconcileMake({ make: wrong, vin }).make, 'Buick');
    });
  }
  for (const vin of CADILLAC) {
    it(`Cadillac ${vin} stays Cadillac, and a Chevrolet/GMC label on it becomes Cadillac`, () => {
      assert.equal(makeFromVin(vin), 'Cadillac');
      assert.equal(reconcileMake({ make: 'Cadillac', vin }).via, 'kept');
      for (const wrong of ['GMC', 'Chevrolet', 'Buick']) assert.equal(reconcileMake({ make: wrong, vin }).make, 'Cadillac');
    });
  }
  it('the GMC crawl config (the roster that caused it) keeps Buick/Cadillac cars under their own make', () => {
    const gmc = getBrand('GMC');
    for (const vin of [...BUICK, ...CADILLAC]) {
      const expected = makeFromVin(vin);
      assert.equal(resolveKeptMake(gmc, { make: null, vin }), expected);
      assert.equal(resolveKeptMake(gmc, { make: 'GMC', vin }), expected);
    }
  });
});

describe('resolveKeptMake on a GMC-roster crawl (the bug path)', () => {
  const gmc = getBrand('GMC');
  for (const [vin, make, model] of MISLABELED) {
    it(`${model}: no page make -> ${make}`, () => {
      assert.equal(resolveKeptMake(gmc, { make: null, vin, model }), make);
    });
    it(`${model}: page make "GMC" (a roster guess) -> ${make}`, () => {
      assert.equal(resolveKeptMake(gmc, { make: 'GMC', vin, model }), make);
    });
  }
  it('a real GMC with no page make is GMC via the brand VIN prefix', () => {
    for (const vin of GMC) assert.equal(resolveKeptMake(gmc, { make: null, vin }), 'GMC');
  });
  it('a car no table can place and with no page make is dropped (null), never given the roster brand', () => {
    assert.equal(resolveKeptMake(gmc, { make: null, vin: 'XZZCJ1DH0NUL16894' }), null);
  });
  it('a page make with a WMI the table does not know is kept as the page said it', () => {
    assert.equal(resolveKeptMake(gmc, { make: 'Isuzu', vin: 'JAABCDEF1N1234567' }), 'Isuzu');
  });
});

describe('reconcileMake rules', () => {
  it('agreeing makes are kept, including a family nameplate that differs from the primary', () => {
    assert.equal(reconcileMake({ make: 'Ram', vin: '1C6SRFJT3RN184304' }).via, 'kept');
    assert.equal(reconcileMake({ make: 'Chrysler', vin: '2B3LJ54T19H594202' }).via, 'kept'); // inside the Stellantis family: not second-guessed
    assert.equal(reconcileMake({ make: 'Toyota', vin: 'JF1ZNBA16P9700001' }).via, 'kept'); // Subaru-built GR86
    assert.equal(reconcileMake({ make: 'Infiniti', vin: 'JN8AZ2NE0K9230000' }).via, 'kept'); // shared Nissan/Infiniti range
  });
  it('unknown WMI or malformed VIN: the stored make is never touched, blank stays blank', () => {
    assert.deepEqual(reconcileMake({ make: 'GMC', vin: 'XZZCJ1DH0NUL16894' }), { make: 'GMC', via: 'kept', from: 'GMC' });
    assert.equal(reconcileMake({ make: 'GMC', vin: '2B3LJ54' }).make, 'GMC');
    assert.equal(reconcileMake({ make: 'GMC', vin: 'IOQ00000000000000' }).make, 'GMC');
    assert.equal(reconcileMake({ make: null, vin: null }).make, null);
    assert.deepEqual(reconcileMake({ make: null, vin: 'XZZCJ1DH0NUL16894' }), { make: null, via: 'kept', from: null });
  });
  it('a shared WMI cannot name a make: conflict -> null, unless the caller decoded one that fits the range', () => {
    const vin = 'JN8AZ2NE0K9230000';
    assert.deepEqual(makesForWmi(vin), ['Nissan', 'Infiniti']);
    assert.equal(makeFromVin(vin), null);
    assert.deepEqual(reconcileMake({ make: 'Ford', vin }), { make: null, via: 'conflict-unresolved', from: 'Ford' });
    assert.deepEqual(reconcileMake({ make: 'Ford', vin, vpicMake: 'INFINITI' }), { make: 'Infiniti', via: 'vpic-conflict', from: 'Ford' });
    assert.equal(reconcileMake({ make: 'Ford', vin, vpicMake: 'Tesla' }).make, null); // a decode outside the range is ignored
  });
  it('a Stellantis WMI outside the line-code table falls back to the model, then null', () => {
    assert.equal(reconcileMake({ make: 'GMC', vin: '1C4ZZZZZZZZZZZZZZ', model: 'Gladiator' }).make, 'Jeep');
    assert.equal(reconcileMake({ make: 'GMC', vin: '1C4ZZZZZZZZZZZZZZ' }).make, null);
  });
  it('is idempotent and spelling-insensitive', () => {
    for (const [vin, , model] of MISLABELED) {
      const once = reconcileMake({ make: 'GMC', vin, model }).make;
      assert.equal(reconcileMake({ make: once, vin, model }).via, 'kept');
    }
    assert.equal(reconcileMake({ make: 'HONDA', vin: 'JHMGK5H76HS000056' }).make, 'Honda');
  });
  it('wmiOf accepts only well-formed 17-character VINs', () => {
    assert.equal(wmiOf(' jhmgk5h76hs000056 '), 'JHM');
    assert.equal(wmiOf('JHMGK5H76HS00005'), null);
    assert.equal(wmiOf(undefined), null);
  });
});

// Pairs the 2026-10-24 box2 dry run showed were gaps in the table, not mislabelling: each is a real make the first table version would have rewritten.
// Keys are the live VIN characters 1-5 (padded with zeros: only characters 1-5 are read).
describe('real cross-badge ranges the live dry run found', () => {
  const pad = (k) => k + '0'.repeat(12);
  const cases = [
    ['5TDAA', 'Lexus', 'TX 350'], ['5TDAB', 'Lexus', 'TX 500h'], ['JTMAB', 'Subaru', 'Solterra'], ['JTMBG', 'Subaru', 'Trailseeker'],
    ['KMHGN', 'Genesis', 'G80'], ['KMHG3', 'Genesis', 'G90'], ['3KPC2', 'Hyundai', 'Accent'], ['KNDMC', 'Hyundai', 'Entourage'],
    ['KNMAT', 'Nissan', 'Rogue'], ['JA4T0', 'Nissan', 'Rogue Plug-In Hybrid'],
  ];
  for (const [key, make, model] of cases) {
    it(`${key} ${model} stays ${make}`, () => {
      assert.deepEqual(reconcileMake({ make, vin: pad(key), model }), { make, via: 'kept', from: make });
    });
  }
  it('the primary make is unchanged for the same ranges (a Toyota Highlander, a Kia Rio, a Mitsubishi Outlander)', () => {
    assert.equal(reconcileMake({ make: 'Toyota', vin: pad('5TDKK') }).via, 'kept');
    assert.equal(reconcileMake({ make: 'Kia', vin: pad('3KPA2') }).via, 'kept');
    assert.equal(reconcileMake({ make: 'Mitsubishi', vin: pad('JA4J3') }).via, 'kept');
  });
  it('a real mislabel on a shared range gives null (only a vPIC decode can pick), on a single-make range the make', () => {
    assert.deepEqual(reconcileMake({ make: 'GMC', vin: pad('5TDAA') }), { make: null, via: 'conflict-unresolved', from: 'GMC' });
    assert.equal(reconcileMake({ make: 'GMC', vin: pad('5TDAA'), vpicMake: 'LEXUS' }).make, 'Lexus');
    assert.equal(reconcileMake({ make: 'Nissan', vin: pad('KNAPN') }).make, 'Kia');
  });
});

describe('the crawler no longer asserts the roster brand as a make', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../src/standalone.js', import.meta.url)), 'utf8');
  it('neither extraction strategy falls back to dealer.make / brand.name for the vehicle make', () => {
    assert.ok(!/make:\s*cleanString\([^)]*\)\s*\|\|\s*dealer\.make/.test(src));
    assert.ok(!/make:\s*cleanString\([^)]*\)\s*\|\|\s*brand\.name/.test(src));
  });
});
