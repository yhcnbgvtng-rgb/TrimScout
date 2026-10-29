import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { wmiOf, makesForWmi, makeFromVin, reconcileMake, WMI_LIST } from '../src/vinWmi.js';
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
  it('a car no table can place and with no page make is kept under the dealer / shard brand (make_source=fallback, make_fallback.test.js)', () => {
    assert.equal(resolveKeptMake(gmc, { make: null, vin: 'XZZCJ1DH0NUL16894' }), 'GMC');
    assert.equal(resolveKeptMake(gmc, { make: null, vin: 'XZZCJ1DH0NUL16894' }, { make: 'Buick' }), 'Buick');
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
    assert.deepEqual(makesForWmi('1N4AL3AP8JC123456'), ['Nissan']); // a Nissan-only range names its make
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

describe('legacy Plymouth', () => {
  it('a Plymouth on a Chrysler-group WMI is kept (live dry run: 22 rows were wrongly flagged), and a mislabelled one is still corrected by line code or model', () => {
    const vin = '1P3EJ46X0YN000000';
    assert.equal(reconcileMake({ make: 'Plymouth', vin }).via, 'kept');
    assert.deepEqual(makesForWmi(vin).slice(0, 1), ['Plymouth']);
    assert.equal(reconcileMake({ make: 'GMC', vin, model: 'Voyager' }).make, 'Chrysler');
  });
});

// Shared-plant WMIs found by the 2026-10-27 box2 audit (238 sizeable (WMI, stored make) conflicts checked against the model each make owns): 7YA, 3MY, 3N6, JN1.
describe('shared-plant WMIs: 7YA (Hyundai / Kia / Genesis), 3MY, 3N6, JN1', () => {
  const pad = (k) => k + '0'.repeat(12);
  it('7YA carries all three Hyundai Motor Group makes, Hyundai first', () => {
    assert.deepEqual(makesForWmi(pad('7YAKM')), ['Hyundai', 'Kia', 'Genesis']);
  });
  it('the 2027 Kia Sportage Hybrid (1,413 live rows) stays Kia; the IONIQ 5 / 9 stay Hyundai', () => {
    assert.deepEqual(reconcileMake({ make: 'Kia', vin: pad('7YAPB'), model: 'Sportage Hybrid' }), { make: 'Kia', via: 'kept', from: 'Kia' });
    assert.equal(reconcileMake({ make: 'Hyundai', vin: pad('7YAKM'), model: 'IONIQ 5' }).via, 'kept');
    assert.equal(reconcileMake({ make: 'Hyundai', vin: pad('7YAMS'), model: 'IONIQ 9' }).via, 'kept');
  });
  it('a foreign or blank make on a 7YA VIN is decided by the model (brand context), else left unresolved', () => {
    assert.deepEqual(reconcileMake({ make: 'Nissan', vin: pad('7YAPB'), model: 'Sportage Hybrid' }), { make: 'Kia', via: 'wmi-conflict', from: 'Nissan' });
    assert.deepEqual(reconcileMake({ make: 'Chevrolet', vin: pad('7YAKM'), model: 'IONIQ 5' }), { make: 'Hyundai', via: 'wmi-conflict', from: 'Chevrolet' });
    assert.equal(reconcileMake({ make: null, vin: pad('7YAKM'), model: 'Sportage Hybrid' }).make, 'Kia');
    assert.equal(reconcileMake({ make: 'Chevrolet', vin: pad('7YAKM'), model: 'Mystery' }).via, 'conflict-unresolved');
    assert.equal(reconcileMake({ make: 'Chevrolet', vin: pad('7YAKM') }).via, 'conflict-unresolved');
  });
  it('a model rule never overrides a make the family already holds', () => {
    assert.equal(reconcileMake({ make: 'Kia', vin: pad('7YAKM'), model: 'IONIQ 5' }).via, 'kept'); // not second-guessed
  });
  it('3MY: Scion iA and Toyota Yaris iA; 3N6: Nissan and the Chevrolet City Express; JN1: the Nissan-built Mitsubishi', () => {
    assert.equal(reconcileMake({ make: 'Scion', vin: pad('3MYDL'), model: 'iA' }).via, 'kept');
    assert.equal(reconcileMake({ make: 'Toyota', vin: pad('3MYDL'), model: 'Yaris iA' }).via, 'kept');
    assert.equal(reconcileMake({ make: 'Chevrolet', vin: pad('3N63D'), model: 'City Express' }).via, 'kept');
    assert.equal(reconcileMake({ make: 'Nissan', vin: pad('3N63D'), model: 'NV200' }).via, 'kept');
    assert.equal(reconcileMake({ make: 'Mitsubishi', vin: pad('JN1BJ'), model: 'Eclipse Sportback' }).via, 'kept');
    assert.equal(reconcileMake({ make: 'Ford', vin: pad('3N63D'), model: 'City Express' }).make, 'Chevrolet');
  });
  it('the single-make GM, Stellantis and Nissan/Infiniti ranges that the audit cleared are unchanged', () => {
    assert.equal(reconcileMake({ make: 'Nissan', vin: pad('1GCUY'), model: 'Silverado 1500' }).make, 'Chevrolet'); // 1GC: Chevrolet only
    assert.equal(reconcileMake({ make: 'Nissan', vin: pad('1GTUY'), model: 'Sierra 1500' }).make, 'GMC');
    assert.deepEqual(makesForWmi(pad('5N1AZ')), ['Nissan', 'Infiniti']);
    assert.equal(reconcileMake({ make: 'Infiniti', vin: pad('3N1AB'), model: 'Sentra' }).make, 'Nissan'); // 3N1 is Nissan only: a real mislabel
    assert.equal(reconcileMake({ make: 'Nissan', vin: pad('1C4RJ'), model: 'Grand Cherokee' }).make, 'Jeep');
  });
});

describe('WMI_LIST', () => {
  it('lists every WMI the table knows, sorted, each resolving to at least one make', () => {
    assert.ok(WMI_LIST.length > 200); assert.deepEqual([...WMI_LIST].sort(), WMI_LIST);
    for (const w of WMI_LIST) assert.ok(makesForWmi(w + '0'.repeat(14)), w);
    assert.ok(WMI_LIST.includes('7YA'));
  });
});

// 2026-10-29: prefixes the 2026-10-28 crawl logged as `make_source=fallback` (VIN not resolvable) on boxes 1, 3 and 4, plus the Ford Super Duty / Transit
// WMIs seen on active Ford rows. Every make below is what NHTSA vPIC DecodeWMI returns for the WMI (checked 2026-10-29).
describe('WMIs added after the 2026-10-28 fallback audit', () => {
  const pad = (w) => w + '0'.repeat(14);
  const ADDED = {
    Ford: ['2FD', '3FR', '3FC', 'NM0', 'WF0'],
    BMW: ['3MW', '3MF', 'WB5'],
    Toyota: ['SB1', 'NMT', '5TB', 'VNK', 'WZ1'],
    Honda: ['SHS'], Acura: ['4W5'],
    'Alfa Romeo': ['ZAS'], Maserati: ['ZN6'], Jaguar: ['SAD'], Volvo: ['LVY', 'LYV'],
    'Mercedes-Benz': ['W1W', 'W1X', 'W1Z', 'WDA'],
    Pontiac: ['5Y2'], Saturn: ['5GZ', '3GS'], GMC: ['1GJ', '2CT'], Chevrolet: ['6G3'], Cadillac: ['LRE'],
    Polestar: ['7SY'], Audi: ['WU1'], 'Aston Martin': ['SD7'], Bentley: ['SJA'], Lamborghini: ['ZPB'], Volkswagen: ['2V4'],
  };
  for (const [make, list] of Object.entries(ADDED)) for (const w of list) {
    it(`${w} names ${make}, and a roster-brand fallback is corrected to it`, () => {
      assert.deepEqual(makesForWmi(pad(w)), [make]);
      assert.equal(makeFromVin(pad(w)), make);
      const roster = make === 'Ford' ? 'Honda' : 'Ford';
      assert.deepEqual(reconcileMake({ make: roster, vin: pad(w) }), { make, via: 'wmi-conflict', from: roster }); // a Ford-roster lot's Alfa Tonale is an Alfa
      assert.equal(reconcileMake({ make, vin: pad(w) }).via, 'kept');
      assert.equal(reconcileMake({ make: null, vin: pad(w) }).via, 'wmi-fill');
    });
  }
  it('shared WMIs accept each make they can carry and name none on their own', () => {
    for (const [w, makes] of [['3HD', ['Honda', 'Acura']], ['3GP', ['Honda', 'Acura']], ['1HT', ['International', 'Chevrolet']], ['3KM', ['Kia', 'Hyundai']], ['SJK', ['Nissan', 'Infiniti']], ['JTK', ['Toyota', 'Scion']], ['JTL', ['Toyota', 'Scion']], ['JTN', ['Toyota', 'Scion']], ['WD4', ['Mercedes-Benz', 'Freightliner']]]) {
      assert.deepEqual(makesForWmi(pad(w)), makes, w);
      assert.equal(makeFromVin(pad(w)), null, w);
      for (const m of makes) assert.equal(reconcileMake({ make: m, vin: pad(w) }).via, 'kept', `${w} ${m}`);
    }
    assert.deepEqual(reconcileMake({ make: 'Ford', vin: pad('3HD') }), { make: null, via: 'conflict-unresolved', from: 'Ford' }); // outside the family, nothing to name: left for vPIC
    assert.equal(reconcileMake({ make: 'Ford', vin: pad('3HD'), vpicMake: 'Acura' }).make, 'Acura');
  });
  it('commercial, motorcycle, trailer, unknown-make and junk prefixes stay out of the table (stored make kept, blank stays blank)', () => {
    for (const w of ['1HA', '1HD', '54D', '7GZ', '1FV', '3AK', '3AL', 'W2X', 'WDY', '1M2', 'JHH', 'SC6', 'RLL', '2G5', '3C8', 'WB1', '3JB', 'WD3', '000', '821', '82H', 'DPS']) {
      assert.equal(makesForWmi(pad(w)), null, w);
      assert.deepEqual(reconcileMake({ make: 'Ford', vin: pad(w) }), { make: 'Ford', via: 'kept', from: 'Ford' }, w);
      assert.deepEqual(reconcileMake({ make: null, vin: pad(w) }), { make: null, via: 'kept', from: null }, w);
    }
  });
  it('Scion-badged cars on JTN / JTL keep their make, other makes on them become Toyota', () => {
    for (const w of ['JTN', 'JTL']) {
      assert.equal(reconcileMake({ make: 'Scion', vin: pad(w) }).via, 'kept');
      assert.equal(reconcileMake({ make: 'Toyota', vin: pad(w) }).via, 'kept');
      assert.deepEqual(reconcileMake({ make: 'Honda', vin: pad(w) }), { make: null, via: 'conflict-unresolved', from: 'Honda' }); // shared with Scion and no model: left for vPIC
      assert.equal(reconcileMake({ make: 'Honda', vin: pad(w), model: 'Corolla' }).make, 'Toyota'); // the model names it: any non-Scion model is a Toyota
      assert.equal(reconcileMake({ make: 'Honda', vin: pad(w), model: 'tC' }).make, 'Scion');
      assert.equal(reconcileMake({ make: null, vin: pad(w), model: 'FR-S' }).make, 'Scion');
    }
  });
  it('1FV is Freightliner, not Ford: it must not join the Ford range just because it sits next to 1FT', () => {
    assert.equal(makeFromVin(pad('1FV')), null);
  });
  it('the Ford WMIs that were already in the table are unchanged', () => {
    for (const w of ['1FA', '1FB', '1FC', '1FD', '1F6', '1F9', '1FM', '1FT', '2FM', '2FT', '3FA', '3FM', '3FT', '1ZV', '2FA', '3FD', 'MAJ']) assert.deepEqual(makesForWmi(pad(w)), ['Ford'], w);
  });
});

// 2026-10-29 fallback audit of the 10-28 crawl logs (boxes 1/3/4): these prefixes carried most of the make_source=fallback lines because they were not in the table.
// Makes per NHTSA vPIC DecodeWMI; the VINs below are shaped like the live ones (no real customer data).
describe('prefixes added after the 10-28 fallback audit (3MW 3HD 3GP ZAS 1HT)', () => {
  const V = (wmi) => `${wmi}AB1CD2EF3456789`.slice(0, 17).padEnd(17, '1');
  it('are in the table and WMI_LIST', () => {
    for (const w of ['3MW', '3HD', '3GP', 'ZAS', '1HT']) { assert.ok(WMI_LIST.includes(w), w); assert.ok(makesForWmi(V(w)), w); }
  });
  it('3MW is BMW and 3HD / 3GP are Honda or Acura; ZAS is Alfa Romeo', () => {
    assert.equal(makeFromVin(V('3MW')), 'BMW');
    assert.equal(makeFromVin(V('ZAS')), 'Alfa Romeo');
    assert.deepEqual(makesForWmi(V('3HD')), ['Honda', 'Acura']);
    assert.deepEqual(makesForWmi(V('3GP')), ['Honda', 'Acura']);
  });
  it('a roster brand inside the family is kept (the old fallback case), outside it is contradicted', () => {
    assert.equal(reconcileMake({ make: 'Acura', vin: V('3HD'), model: 'ADX' }).via, 'kept');
    assert.equal(reconcileMake({ make: 'Honda', vin: V('3GP'), model: 'Prologue' }).via, 'kept');
    assert.deepEqual(reconcileMake({ make: 'GMC', vin: V('3MW'), model: '330i' }), { make: 'BMW', via: 'wmi-conflict', from: 'GMC' });
    assert.deepEqual(reconcileMake({ make: 'Chevrolet', vin: V('ZAS'), model: 'Stelvio' }), { make: 'Alfa Romeo', via: 'wmi-conflict', from: 'Chevrolet' });
  });
  it('shared 3HD / 3GP / 1HT: the model names the make for a blank or contradicted one, otherwise the VIN says nothing', () => {
    assert.equal(reconcileMake({ make: null, vin: V('3GP'), model: 'Prologue' }).make, 'Honda');
    assert.equal(reconcileMake({ make: 'Chevrolet', vin: V('3GP'), model: 'ZDX' }).make, 'Acura');
    assert.equal(reconcileMake({ make: 'Ford', vin: V('3HD'), model: 'HR-V' }).make, 'Honda');
    assert.equal(reconcileMake({ make: 'Ford', vin: V('1HT'), model: 'Silverado 5500HD' }).make, 'Chevrolet');
    assert.equal(reconcileMake({ make: 'Ford', vin: V('3HD'), model: 'Mystery' }).via, 'conflict-unresolved');
    assert.equal(reconcileMake({ make: null, vin: V('1HT'), model: 'MV607' }).via, 'unresolved');
  });
  it('a make the page gave and the table did not know before is unchanged: Honda on 3GP, International on 1HT', () => {
    assert.equal(reconcileMake({ make: 'Honda', vin: V('3GP') }).make, 'Honda');
    assert.equal(reconcileMake({ make: 'Chevrolet', vin: V('1HT') }).via, 'kept');
  });
});

// 2026-10-29: ~4.3k cars on the 10-28 crawl were SKIPPED ("make unresolvable") because the page gave no make and the VIN prefix is shared (5N1 5NM KND KMH JF2 5TD ...)
// with a roster brand outside the family. The model names the make among the makes that prefix can carry; nothing outside the family is ever considered.
import { makeFromModelInFamily } from '../src/vinWmi.js';
describe('model name picks the make inside a shared-plant family (makeFromModelInFamily)', () => {
  const CASES = [
    // [vin, model, make]   the six prefixes that carried the skipped cars
    ['5N1AT2MT8KC702673', 'Rogue', 'Nissan'], ['5N1DL0MM1HC501234', 'QX60', 'Infiniti'], ['5N1AZ2MH0JN123456', 'Murano', 'Nissan'],
    ['5NMS3CAD9KH012345', 'Santa Fe', 'Hyundai'], ['5NMJECAE7NH123456', 'Tucson', 'Hyundai'],
    ['KNDPM3AC8L7807729', 'Sportage', 'Kia'], ['KNDJ23AU4N7123456', 'Seltos', 'Kia'], ['KNDEUCA39R7123456', 'EV9', 'Kia'],
    ['KMHL64JA5NA123456', 'Sonata', 'Hyundai'], ['KMTG34LE2MU123456', 'G70', 'Genesis'],
    ['JF2SKAEC5KH123456', 'Forester', 'Subaru'], ['JF1GPAA67G8123456', 'Impreza', 'Subaru'], ['JF1ZNBA10N8701234', 'GR86', 'Toyota'],
    ['5TDBSKFC4NS062179', 'Sienna', 'Toyota'], ['5TDKDRBH1PS123456', 'Highlander', 'Toyota'], ['5TDAAAB55RS123456', 'TX 350', 'Lexus'],
    ['JN8AZ2NE0K9123456', 'QX80', 'Infiniti'], ['JTMABABA7MD123456', 'Solterra', 'Subaru'],
  ];
  for (const [vin, model, make] of CASES) {
    it(`${vin.slice(0, 3)} ${model} -> ${make}, for a blank make and for a make from outside the family`, () => {
      const fam = makesForWmi(vin);
      assert.ok(fam.includes(make), `${make} is in the ${vin.slice(0, 3)} family ${fam}`);
      assert.equal(makeFromModelInFamily(model, fam), make);
      assert.equal(reconcileMake({ make: null, vin, model }).make, make);
      assert.equal(reconcileMake({ make: 'Honda', vin, model }).make, make); // the roster-fallback case: Honda stored on a Nissan VIN
      assert.equal(reconcileMake({ make: 'Honda', vin, model }).via, 'wmi-conflict');
    });
  }
  it('JTM Solterra: a stored Toyota is inside the family and is kept (a model is never proof against a stored make in the family)', () => {
    assert.equal(reconcileMake({ make: 'Toyota', vin: 'JTMABABA7MD123456', model: 'Solterra' }).via, 'kept');
  });
  it('a blank, unknown, ambiguous or foreign model says nothing', () => {
    const fam = makesForWmi('5N1AT2MT8KC702673');
    for (const model of [null, undefined, '', '  ', 'Mystery', 'Crossover', 'Civic', 'Sierra 1500']) assert.equal(makeFromModelInFamily(model, fam), null, String(model));
    assert.deepEqual(reconcileMake({ make: 'Honda', vin: '5N1AT2MT8KC702673', model: 'Civic' }), { make: null, via: 'conflict-unresolved', from: 'Honda' }, 'a Civic on a Nissan/Infiniti VIN is NOT turned into a Honda by the model');
    assert.deepEqual(reconcileMake({ make: null, vin: '5N1AT2MT8KC702673', model: null }), { make: null, via: 'unresolved', from: null });
  });
  it('a model that matches two makes of the family is ambiguous (Yaris iA: Toyota only; a bare "Genesis" matches nobody)', () => {
    assert.equal(makeFromModelInFamily('Yaris iA', ['Toyota', 'Scion']), 'Toyota');
    assert.equal(makeFromModelInFamily('Genesis', ['Hyundai', 'Genesis']), null);
    assert.equal(makeFromModelInFamily('Rogue', ['Nissan', 'Nissan']), null, 'duplicates of one make never count as one');
  });
  it('familyModel:false switches the family fallback off (the stored-row repair stages it as its own rules); SHARED_MODEL_RULES still apply', () => {
    assert.equal(reconcileMake({ make: null, vin: '5N1AT2MT8KC702673', model: 'Rogue', familyModel: false }).via, 'unresolved');
    assert.equal(reconcileMake({ make: 'Ford', vin: '3HDAB1CD2EF345678', model: 'HR-V', familyModel: false }).make, 'Honda');
  });
  it('single-make prefixes are untouched: the model is not consulted', () => {
    assert.equal(reconcileMake({ make: 'GMC', vin: '1GCUYEED5NZ123456', model: 'Rogue' }).make, 'Chevrolet');
  });
});
