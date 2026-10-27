// Chevrolet / GMC / Toyota / Ram trim normalizer (src/oemTrim.js). Every example is a real string from the 2026-10-27 box2 probe (docs/trim-normalize/oem-probe-2026-10-27.md).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTrim } from '../src/ingestSanitize.js';
import { cleanOemTrimText, classifyOemTrim, normalizeOemTrim, normalizeOemTrimForWrite, normalizeTrimForWrite, officialOemTrims, oemTrimGroup } from '../src/oemTrim.js';

const fix = (make, model, trim) => normalizeOemTrim({ make, model, trim });

describe('oemTrimGroup', () => {
  it('folds the model spellings dealers use', () => {
    for (const m of ['Silverado 1500', 'Silverado 2500 HD', 'Silverado 2500HD', 'Silverado 3500 HD', 'Silverado 3500HD', 'Silverado 1500 LTD', 'Silverado 1500 LD', 'Silverado', 'SILVERADO 1500', 'Silverado 1500 Limited', 'Silverado HD']) assert.equal(oemTrimGroup('Chevrolet', m), 'Silverado', m);
    for (const m of ['Sierra 1500', 'Sierra 2500 HD', 'Sierra 2500HD', 'Sierra 3500HD', 'Sierra 1500 Limited', 'SIERRA 1500', 'Sierra']) assert.equal(oemTrimGroup('GMC', m), 'Sierra', m);
    for (const m of ['Yukon', 'Yukon XL', 'YUKON', 'Yukon XL 1500']) assert.equal(oemTrimGroup('GMC', m), 'Yukon', m);
    for (const m of ['RAV4', 'RAV4 Hybrid', 'RAV4 Plug-in Hybrid', 'RAV4 Plug-In Hybrid', 'RAV4 Prime']) assert.equal(oemTrimGroup('Toyota', m), 'RAV4', m);
    assert.equal(oemTrimGroup('Toyota', 'Highlander Hybrid'), 'Highlander');
    assert.equal(oemTrimGroup('Toyota', 'CAMRY'), 'Camry');
    assert.equal(oemTrimGroup('Ram', '1500'), 'Ram 1500');
    assert.equal(oemTrimGroup('RAM', '1500 Classic'), 'Ram 1500');
    assert.equal(oemTrimGroup('Ram', '2500'), 'Ram 2500');
  });
  it('keeps EVs, chassis cabs, other models, other makes and blanks out', () => {
    for (const [mk, m] of [['Chevrolet', 'Silverado EV'], ['Chevrolet', 'Silverado 3500 HD Chassis Cab'], ['Chevrolet', 'Silverado 5500 HD'], ['Chevrolet', 'Equinox EV'], ['Chevrolet', 'Silverado 2500HD Built After Aug 14'],
      ['GMC', 'Sierra EV'], ['GMC', 'Yukon Denali'], ['Toyota', 'Corolla'], ['Toyota', 'RAV4 EV'], ['Ram', '3500'], ['Dodge', '1500'], ['Chevrolet', 'Sierra 1500'], ['Chevrolet', ''], [null, 'Tahoe']]) assert.equal(oemTrimGroup(mk, m), null, `${mk} ${m}`);
  });
  it('official lists are exposed for the display layer', () => {
    assert.ok(officialOemTrims('Chevrolet', 'Silverado 1500').includes('LT Trail Boss'));
    assert.equal(officialOemTrims('Ford', 'F-150'), null);
  });
});

describe('normalizeOemTrim: what it rewrites (probe examples)', () => {
  const cases = [
    // Silverado: option-package codes, Work Truck, drivetrain / cab words
    ['Chevrolet', 'Silverado 1500', 'LT 2FL', 'LT'], ['Chevrolet', 'Silverado 1500', 'LT (2FL)', 'LT'], ['Chevrolet', 'Silverado 1500', 'LT w/1LT', 'LT'], ['Chevrolet', 'Silverado 1500', 'LT LT1', 'LT'],
    ['Chevrolet', 'Silverado 1500', 'Work Truck', 'WT'], ['Chevrolet', 'Silverado 2500 HD', 'Work Truck', 'WT'], ['Chevrolet', 'Silverado 1500', 'RST 4WD Crew Cab 147', 'RST'], ['Chevrolet', 'Silverado 1500', 'Silverado Custom', 'Custom'],
    ['Chevrolet', 'Silverado 1500', 'Silverado Custom Trail Boss', 'Custom Trail Boss'], ['Chevrolet', 'Silverado 1500', 'LT Trail Boss 4WD Crew Cab 147', 'LT Trail Boss'], ['Chevrolet', 'Silverado 1500', 'LTZ 2LZ', 'LTZ'],
    ['Chevrolet', 'Silverado 2500 HD', 'LTZ 4WD Crew Cab 159', 'LTZ'], ['Chevrolet', 'Silverado 2500HD', 'LT Trail Boss Z71 Off Road', 'LT Trail Boss'], ['Chevrolet', 'Silverado 1500', 'RST BLACK WIDOW', 'RST'], ['Chevrolet', 'Silverado 1500', 'WT RWD', 'WT'],
    // Tahoe / Equinox
    ['Chevrolet', 'Tahoe', '4WD Z71', 'Z71'], ['Chevrolet', 'Tahoe', '4WD High Country', 'High Country'], ['Chevrolet', 'Tahoe', '4WD 4dr RST', 'RST'], ['Chevrolet', 'Tahoe', 'LT 4x2', 'LT'], ['Chevrolet', 'Tahoe', 'High Country SUV 4WD', 'High Country'],
    ['Chevrolet', 'Equinox', 'AWD LT', 'LT'], ['Chevrolet', 'Equinox', 'FWD ACTIV', 'Activ'], ['Chevrolet', 'Equinox', 'Premier w/1LZ', 'Premier'], ['Chevrolet', 'Equinox', 'FWD 4dr LT W1lt', 'LT'], ['Chevrolet', 'Equinox', 'LS w/1LS', 'LS'], ['Chevrolet', 'Equinox', 'RS SUV AWD', 'RS'],
    // Sierra / Yukon
    ['GMC', 'Sierra 1500', 'Elevation w/3SB', 'Elevation'], ['GMC', 'Sierra 1500', '4WD Crew Cab Denali', 'Denali'], ['GMC', 'Sierra 1500', 'AT4 Carbravo GM CPO', 'AT4'], ['GMC', 'Sierra 1500', '2.7T 4WD Elevation w/ Heated Seats & Remote Start', 'Elevation'],
    ['GMC', 'Sierra 1500', 'AT4 Carbon PRO CRW SB 6.2/A10 4X4', 'AT4'], ['GMC', 'Sierra 1500', 'Pro Crew Cab Short', 'Pro'], ['GMC', 'Sierra 1500', 'Denali Ultimate ProGrade Trailering', 'Denali Ultimate'], ['GMC', 'Sierra 2500HD', 'AT4X 4WD', 'AT4X'],
    ['GMC', 'Yukon', '4WD 4dr Denali Ultimate', 'Denali Ultimate'], ['GMC', 'Yukon', 'SLT Standard Edition', 'SLT'], ['GMC', 'Yukon XL', 'AT4 Ultimate 4x4', 'AT4 Ultimate'], ['GMC', 'Yukon', 'Denali Sport Utility 4D', 'Denali'], ['GMC', 'Yukon XL', 'Denali 62L V8', 'Denali'],
    // Toyota
    ['Toyota', 'Tacoma', 'TRD Off Road', 'TRD Off-Road'], ['Toyota', 'Tacoma', 'Trd_off Road', 'TRD Off-Road'], ['Toyota', 'Tacoma', 'Trd_sport', 'TRD Sport'], ['Toyota', 'Tacoma', 'SR5 V6', 'SR5'], ['Toyota', 'Tacoma', 'SR V6', 'SR'],
    ['Toyota', 'Tacoma', 'Prerunner', 'PreRunner'], ['Toyota', 'Tacoma', 'TRD Off-Road i-FORCE MAX', 'TRD Off-Road'], ['Toyota', 'Tacoma', '2026 Toyota Tacoma SR5', 'SR5'], ['Toyota', 'Tacoma', 'TRD Sport Double Cab 5 Bed AT (Natl)', 'TRD Sport'],
    ['Toyota', 'Tundra', 'SR5 5.7L V8', 'SR5'], ['Toyota', 'Tundra', '1794', '1794 Edition'], ['Toyota', 'Tundra', 'Platinum i-FORCE MAX', 'Platinum'], ['Toyota', 'Tundra', 'Limited Crewmax 5.5 Bed (Natl)', 'Limited'], ['Toyota', 'Tundra', 'TRD Pro HV', 'TRD Pro'],
    ['Toyota', 'RAV4', 'Hybrid XLE', 'XLE'], ['Toyota', 'RAV4', 'Xle_premium', 'XLE Premium'], ['Toyota', 'RAV4 Hybrid', 'XLE AWD Power Moonroof', 'XLE'], ['Toyota', 'RAV4', 'TRD Off Road', 'TRD Off-Road'], ['Toyota', 'RAV4', 'Hybrid XLE Premium AWD', 'XLE Premium'],
    ['Toyota', 'RAV4 Hybrid', 'XSE (Hybrid XSE AWD (Natl))', 'XSE'], ['Toyota', 'RAV4 Hybrid', 'Woodland Edition', 'Woodland'], ['Toyota', 'RAV4 Plug-In Hybrid', 'XSE Natl', 'XSE'], ['Toyota', 'RAV4', 'XSE Sport Utility 4D', 'XSE'],
    ['Toyota', 'Camry', 'SE AWD', 'SE'], ['Toyota', 'Camry', 'XSE V6', 'XSE'], ['Toyota', 'Camry', 'TRD V6', 'TRD'], ['Toyota', 'Camry', 'Hybrid LE', 'LE'], ['Toyota', 'Camry', 'LE (LE (Natl))', 'LE'], ['Toyota', 'Camry', 'SE Sedan 4D', 'SE'], ['Toyota', 'Camry', 'Nightshade', 'SE Nightshade'],
    ['Toyota', 'Highlander', 'XLE V6', 'XLE'], ['Toyota', 'Highlander', 'Limited Platinum V6', 'Limited Platinum'], ['Toyota', 'Highlander', 'LE Plus V6', 'LE Plus'], ['Toyota', 'Highlander Hybrid', 'Hybrid Platinum AWD Natl', 'Platinum'], ['Toyota', 'Highlander', 'XLE Front-Wheel Drive', 'XLE'],
    // Ram: combined Big Horn / Lone Star spellings, cab / bed words, Power Wagon
    ['Ram', '1500', 'Big Hornlone Star', 'Big Horn/Lone Star'], ['Ram', '1500', 'BIGHORN/LONESTAR CREW 4X4', 'Big Horn/Lone Star'], ['Ram', '1500', 'Big Horn/Lone Star 4D', 'Big Horn/Lone Star'],
    ['Ram', '1500', "BIG HORN CREW CAB 4X4 5'7 BOX", 'Big Horn'], ['Ram', '1500', 'Big Horn Quad', 'Big Horn'], ['Ram', '1500', "LARAMIE CREW CAB 4X4 5'7 BOX", 'Laramie'], ['Ram', '1500', 'Laramie 4x4', 'Laramie'], ['Ram', '1500', 'TRX SRT', 'TRX'],
    ['Ram', '1500', "LONE STAR CREW CAB 4X2 5'7 BOX", 'Lone Star'], ['Ram', '1500', 'Limited Crew Cab 4x4', 'Limited'], ['Ram', '1500 Classic', 'Warlock Quad Cab 4x4', 'Warlock'], ['Ram', '1500', 'RHO CREW CAB 4X4 5\'7 BOX', 'RHO'],
    ['Ram', '2500', "BLACK EXPRESS CREW CAB 4X4 6'4 BOX", 'Black Express'], ['Ram', '2500', 'Power Wagon Diesel', 'Power Wagon'], ['Ram', '2500', "TRADESMAN REGULAR CAB 4X4 8' BOX", 'Tradesman'], ['Ram', '2500', 'LARAMIE MEGA CAB 4X4', 'Laramie'], ['Ram', '2500', 'Limited Mega Cab 4x4', 'Limited'],
  ];
  for (const [make, model, from, to] of cases) {
    it(`${make} ${model}: ${JSON.stringify(from)} -> ${to}`, () => {
      const r = fix(make, model, from);
      assert.equal(r.trim, to);
      assert.equal(r.status, 'fix', `${from} should be a fix, got ${r.status}`);
    });
  }
});

describe('normalizeOemTrim: what it leaves exactly as it is', () => {
  it('official trims are clean and untouched, per model', () => {
    for (const [mk, m, t] of [['Chevrolet', 'Silverado 1500', 'RST'], ['Chevrolet', 'Silverado 1500', 'LT Trail Boss'], ['Chevrolet', 'Silverado 1500', 'WT'], ['Chevrolet', 'Tahoe', 'Z71'], ['Chevrolet', 'Equinox', 'Activ'], ['GMC', 'Sierra 1500', 'AT4X'], ['GMC', 'Yukon', 'AT4 Ultimate'],
      ['Toyota', 'Tacoma', 'TRD Off-Road'], ['Toyota', 'Tundra', '1794 Edition'], ['Toyota', 'RAV4', 'XLE Premium'], ['Toyota', 'Camry', 'XSE'], ['Toyota', 'Camry', 'SE Nightshade'], ['Toyota', 'Highlander', 'Limited Platinum'], ['Ram', '1500', 'Big Horn/Lone Star'], ['Ram', '2500', 'Power Wagon']]) {
      assert.deepEqual(fix(mk, m, t), { trim: t, status: 'clean' }, `${mk} ${m} ${t}`);
    }
  });
  it('"Base" / "L" / "Grade" are official where listed but never matched inside text', () => {
    for (const [mk, m, t] of [['Toyota', 'Tacoma', 'Base'], ['Toyota', 'Camry', 'L'], ['Toyota', 'Highlander', 'L'], ['Toyota', 'Tundra', 'Grade']]) assert.equal(fix(mk, m, t).status, 'clean', `${m} ${t}`);
    for (const [mk, m, t] of [['Toyota', 'Camry', 'L Sedan'], ['Toyota', 'Tacoma', 'Base V6'], ['Toyota', 'Tundra', 'Grade 4x4']]) { const r = fix(mk, m, t); assert.equal(r.status, 'leftover', t); assert.equal(r.trim, t); }
    assert.notEqual(fix('Chevrolet', 'Silverado 1500', 'Base').status, 'clean', 'Base is not a Silverado trim');
  });
  it('unreadable text stays: cab / bed / engine text, the make name, dealer names, options', () => {
    for (const [mk, m, t] of [['Chevrolet', 'Silverado 1500', 'Crew Cab Short Box'], ['Chevrolet', 'Silverado 1500', '4WD Crew Cab 147"'], ['Chevrolet', 'Silverado 1500', '1LT'], ['Chevrolet', 'Silverado 1500', 'Work'], ['Chevrolet', 'Silverado 1500', 'Trail Boss'],
      ['Chevrolet', 'Silverado 2500 HD', 'GRIFFIN GA'], ['Chevrolet', 'Silverado 2500 HD', 'Inventory Sunrise Chevrolet'], ['GMC', 'Sierra 1500', 'NA'], ['Toyota', 'Tacoma', '4WD Double'], ['Toyota', 'Tacoma', 'V6'], ['Toyota', 'Highlander Hybrid', 'Topeka KS Lewis Toyota'],
      ['Toyota', 'Camry', 'FWD CVT 4dr Car'], ['Ram', '1500', 'RAM'], ['Ram', '2500', 'Power'], ['Ram', '1500', '3.6L 4WD'], ['Toyota', 'RAV4', 'I-4 cyl']]) {
      const r = fix(mk, m, t); assert.equal(r.status, 'leftover', `${m} ${t}`); assert.equal(r.trim, t);
    }
  });
  it('two trims it cannot choose between are left alone', () => {
    for (const [mk, m, t] of [['Chevrolet', 'Tahoe', 'LT Z71'], ['Ram', '2500', 'Rebel/Power Wagon'], ['Ram', '2500', 'REBEL/POWERWAGON CREW CAB'], ['Toyota', 'Camry', 'LE SE'], ['Toyota', 'Tacoma', 'TRD Pro Limited'], ['Chevrolet', 'Silverado 1500', 'LT Z71 Trail Boss']]) {
      const r = fix(mk, m, t); assert.equal(r.status, 'ambiguous', `${m} ${t}`); assert.equal(r.trim, t);
    }
  });
  it('a longer trim wins over the shorter one inside it', () => {
    assert.equal(fix('Chevrolet', 'Silverado 1500', 'LT Trail Boss 4WD').trim, 'LT Trail Boss');
    assert.equal(fix('Chevrolet', 'Silverado 1500', 'LTZ 4WD').trim, 'LTZ');
    assert.equal(fix('GMC', 'Yukon', 'Denali Ultimate 4WD').trim, 'Denali Ultimate');
    assert.equal(fix('Toyota', 'Highlander', 'Limited Platinum AWD').trim, 'Limited Platinum');
    assert.equal(fix('Toyota', 'RAV4', 'XLE Premium FWD').trim, 'XLE Premium');
    assert.equal(fix('Ram', '1500', 'Limited Longhorn Crew Cab').trim, 'Limited Longhorn');
  });
  it('blank and null stay as they are', () => {
    assert.deepEqual(fix('Chevrolet', 'Tahoe', null), { trim: null, status: 'blank' });
    assert.deepEqual(fix('Chevrolet', 'Tahoe', ''), { trim: '', status: 'blank' });
    assert.deepEqual(fix('Ram', '1500', '   '), { trim: '   ', status: 'blank' });
  });
  it('other makes, other models and a missing model are skipped; make is case-insensitive', () => {
    assert.equal(fix('Ford', 'F-150', 'XLT').status, 'skipped');
    assert.equal(fix('Honda', 'Civic', 'EX-L').status, 'skipped');
    assert.equal(fix('Chevrolet', 'Silverado EV', 'RST').status, 'skipped');
    assert.equal(fix('Chevrolet', null, 'LT').status, 'skipped');
    assert.equal(fix('CHEVROLET', 'TAHOE', '4WD LT').trim, 'LT');
  });
  it('a trim that is official for another model is not read here', () => {
    assert.equal(fix('Chevrolet', 'Tahoe', 'Denali').status, 'leftover');
    assert.equal(fix('Toyota', 'Camry', 'SR5').status, 'leftover');
  });
});

describe('normalizeOemTrimForWrite / normalizeTrimForWrite', () => {
  it('keeps the dealer text in trimRaw when it rewrites, and only then', () => {
    assert.deepEqual(normalizeOemTrimForWrite({ make: 'Chevrolet', model: 'Silverado 1500', trim: 'LT 2FL' }), { trim: 'LT', trimRaw: 'LT 2FL', status: 'fix' });
    assert.deepEqual(normalizeOemTrimForWrite({ make: 'Toyota', model: 'Tacoma', trim: '  TRD Off Road ' }), { trim: 'TRD Off-Road', trimRaw: 'TRD Off Road', status: 'fix' });
    assert.deepEqual(normalizeOemTrimForWrite({ make: 'Toyota', model: 'Tacoma', trim: 'SR5' }), { trim: 'SR5', trimRaw: null, status: 'clean' });
    assert.deepEqual(normalizeOemTrimForWrite({ make: 'Ram', model: '1500', trim: 'RAM' }), { trim: 'RAM', trimRaw: null, status: 'leftover' });
    assert.deepEqual(normalizeOemTrimForWrite({ make: 'Ram', model: '1500', trim: null }), { trim: null, trimRaw: null, status: 'blank' });
    assert.deepEqual(normalizeOemTrimForWrite({ make: 'Honda', model: 'Civic', trim: 'EX-L' }), { trim: 'EX-L', trimRaw: null, status: 'skipped' });
  });
  it('is idempotent: normalizing the output changes nothing', () => {
    for (const [mk, m, t] of [['Chevrolet', 'Silverado 1500', 'LT Trail Boss 4WD Crew Cab 147'], ['Toyota', 'Camry', 'Nightshade AWD'], ['Ram', '1500', 'BIGHORN/LONESTAR CREW 4X4'], ['GMC', 'Yukon', '4WD 4dr AT4 Ultimate'], ['Toyota', 'RAV4', 'Xle_premium']]) {
      const once = normalizeOemTrimForWrite({ make: mk, model: m, trim: t });
      const twice = normalizeOemTrimForWrite({ make: mk, model: m, trim: once.trim });
      assert.equal(twice.trim, once.trim); assert.equal(twice.trimRaw, null); assert.equal(twice.status, 'clean');
    }
  });
  it('trimRaw is capped to the column width', () => {
    const long = `LT ${'4WD '.repeat(80)}`;
    assert.ok(normalizeOemTrimForWrite({ make: 'Chevrolet', model: 'Tahoe', trim: long }).trimRaw.length <= 160);
  });
  it('normalizeTrimForWrite: Ford goes through fordTrim.js, these makes through oemTrim.js, everything else is skipped', () => {
    assert.deepEqual(normalizeTrimForWrite({ make: 'Ford', model: 'F-150', trim: '4X4 CREWCAB XLT' }), { trim: 'XLT', trimRaw: '4X4 CREWCAB XLT', status: 'fix' });
    assert.deepEqual(normalizeTrimForWrite({ make: 'Toyota', model: 'Camry', trim: 'SE AWD' }), { trim: 'SE', trimRaw: 'SE AWD', status: 'fix' });
    assert.deepEqual(normalizeTrimForWrite({ make: 'Ford', model: 'F-250', trim: 'Preferred' }), { trim: 'Preferred', trimRaw: null, status: 'leftover' });
    assert.deepEqual(normalizeTrimForWrite({ make: 'Honda', model: 'Civic', trim: 'EX-L' }), { trim: 'EX-L', trimRaw: null, status: 'skipped' });
  });
});

describe('entities and trademark marks are cleaned before matching', () => {
  it('reads the official trim through ®, ™ and HTML entities and flags it a fix', () => {
    for (const [mk, m, input, want] of [['Chevrolet', 'Silverado 1500', 'High Country&reg;', 'High Country'], ['GMC', 'Sierra 1500', 'Denali®', 'Denali'], ['GMC', 'Sierra 1500', 'AT4&#174; 4WD', 'AT4'], ['Toyota', 'Tacoma', 'TRD Pro&trade;', 'TRD Pro'],
      ['Toyota', 'Tundra', '1794&amp;reg; Edition', '1794 Edition'], ['Ram', '1500', 'Big Horn&reg;/Lone Star&reg;', 'Big Horn/Lone Star'], ['Ram', '1500', 'Laramie&#xAE; Longhorn', 'Laramie Longhorn'], ['Toyota', 'RAV4', 'TRD Off-Road&reg;', 'TRD Off-Road']]) {
      const r = fix(mk, m, input); assert.equal(r.trim, want, input); assert.equal(r.status, 'fix', input);
    }
  });
  it('unreadable text keeps its marks exactly', () => {
    assert.deepEqual(fix('Ram', '1500', 'RAM®'), { trim: 'RAM®', status: 'leftover' });
  });
  it('cleanOemTrimText agrees with ingestSanitize', () => {
    for (const t of ['Raptor&reg;', 'King Ranch®', 'XLT &amp; Co', 'A&#174;B&#xAE;', 'x &zzzz; y']) assert.equal(cleanOemTrimText(t), cleanTrim(t), t);
  });
});

describe('classifyOemTrim (display rule)', () => {
  it('null for models it does not cover', () => {
    assert.equal(classifyOemTrim({ make: 'Ford', model: 'F-150', trim: 'XLT' }), null);
    assert.equal(classifyOemTrim({ make: 'Honda', model: 'Civic', trim: 'EX' }), null);
  });
  it('official -> fine; blank -> fine; spelling variant -> official spelling; anything else -> unofficial', () => {
    assert.deepEqual(classifyOemTrim({ make: 'Toyota', model: 'Tacoma', trim: 'TRD Off-Road' }), { unofficial: false, canonical: null });
    assert.deepEqual(classifyOemTrim({ make: 'Toyota', model: 'Tacoma', trim: '' }), { unofficial: false, canonical: null });
    assert.deepEqual(classifyOemTrim({ make: 'Toyota', model: 'Tacoma', trim: 'TRD Off Road' }), { unofficial: false, canonical: 'TRD Off-Road' });
    assert.deepEqual(classifyOemTrim({ make: 'Toyota', model: 'Tacoma', trim: 'Trd_sport' }), { unofficial: false, canonical: 'TRD Sport' });
    assert.deepEqual(classifyOemTrim({ make: 'Chevrolet', model: 'Tahoe', trim: 'rst' }), { unofficial: false, canonical: 'RST' });
    assert.deepEqual(classifyOemTrim({ make: 'Toyota', model: 'Tacoma', trim: 'SR5 V6' }), { unofficial: true, canonical: null });
    assert.deepEqual(classifyOemTrim({ make: 'Ram', model: '1500', trim: 'RAM' }), { unofficial: true, canonical: null });
    assert.deepEqual(classifyOemTrim({ make: 'Ram', model: '2500', trim: 'Rebel/Power Wagon' }), { unofficial: true, canonical: null });
  });
});
