// Ford trim normalizer (src/fordTrim.js). Every example is a real string from the 2026-10-26 box2 probe (docs/trim-normalize/ford-probe-2026-10-26.md).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fordModelGroup, normalizeFordTrim, normalizeFordTrimForWrite } from '../src/fordTrim.js';

const fix = (model, trim) => normalizeFordTrim({ make: 'Ford', model, trim });

describe('fordModelGroup', () => {
  it('folds the Super Duty spellings and Expedition MAX, keeps Lightning / Mach-E / Bronco Sport out', () => {
    for (const m of ['F-250', 'F-250SD', 'Super Duty F-250 SRW', 'Super Duty', 'F-350 DRW', 'F-450SD', 'Super Duty F-550 DRW', 'F-550']) assert.equal(fordModelGroup(m), 'Super Duty', m);
    assert.equal(fordModelGroup('Expedition Max'), 'Expedition');
    assert.equal(fordModelGroup('F-150'), 'F-150');
    for (const m of ['F-150 Lightning', 'Mustang Mach-E', 'Bronco Sport', 'Transit-250', 'Edge', 'Chassis Cab', '', null]) assert.equal(fordModelGroup(m), null, String(m));
  });
});

describe('normalizeFordTrim: what it rewrites (probe examples)', () => {
  const cases = [
    // F-150
    ['F-150', '4X4 CREWCAB XLT', 'XLT'], ['F-150', "XLT 4WD SuperCrew 5.5'", 'XLT'], ['F-150', 'XLT 4WD Supercrew 5.5 Box', 'XLT'], ['F-150', '4X4 Crew Lariat', 'Lariat'],
    ['F-150', "LARIAT 4WD SuperCrew 5.5'", 'Lariat'], ['F-150', 'XLT 4x4 SuperCrew Cab 5.5 ft. box 145 in. WB', 'XLT'], ['F-150', 'F150 Raptor CRW', 'Raptor'], ['F-150', 'XL Fleet', 'XL'],
    ['F-150', 'XLT 302A', 'XLT'], ['F-150', 'King Ranch 4WD SuperCrew', 'King Ranch'], ['F-150', 'Platinum 4WD SUPERCREW', 'Platinum'], ['F-150', 'Raptor 4WD Supercrew 5.5 Box', 'Raptor'],
    // Super Duty: series prefix, DRW, case
    ['F-250', 'F 250 Lariat', 'Lariat'], ['F-250', 'F-250 XL', 'XL'], ['F-350', 'F 350 XLT', 'XLT'], ['Super Duty F-350 DRW', 'XL DRW', 'XL'], ['Super Duty F-250 SRW', 'LARIAT', 'Lariat'],
    ['Super Duty F-350 DRW', 'King Ranch DRW', 'King Ranch'], ['F-550', 'F-550 XL', 'XL'], ['F-250', 'XL Commercial', 'XL'], ['F-250', 'LARIAT 4WD', 'Lariat'],
    // Explorer / Escape: spelling of ST-Line, option-package codes
    ['Explorer', 'ST Line', 'ST-Line'], ['Escape', 'St Line', 'ST-Line'], ['Escape', 'ST Line Select', 'ST-Line Select'], ['Escape', 'ST Line Elite', 'ST-Line Elite'], ['Escape', 'ST Line AWD', 'ST-Line'],
    ['Explorer', 'Active w/200A Pkg', 'Active'], ['Explorer', 'Active W200a Pkg', 'Active'], ['Explorer', 'Active Crossroads Courtesy Demo', 'Active'], ['Explorer', 'XLT 4WD', 'XLT'], ['Explorer', 'ST 4WD', 'ST'],
    ['Escape', 'Titanium Hybrid', 'Titanium'], ['Escape', 'SE Plug In Hybrid', 'SE'], ['Escape', 'SEL AWD', 'SEL'], ['Escape', 'Active AWD Rear Camera', 'Active'],
    // Expedition: MAX is a length, not a trim
    ['Expedition', 'MAX Platinum', 'Platinum'], ['Expedition', 'Platinum MAX', 'Platinum'], ['Expedition Max', 'King Ranch MAX', 'King Ranch'], ['Expedition', 'Limited 4x4', 'Limited'], ['Expedition', 'TREMOR 4X4', 'Tremor'],
    // Mustang
    ['Mustang', 'Ecoboost Premium', 'EcoBoost Premium'], ['Mustang', 'Ecoboost Fastback', 'EcoBoost'], ['Mustang', 'Ecoboost Premium Convertible', 'EcoBoost Premium'], ['Mustang', 'GT Premium Fastback', 'GT Premium'],
    ['Mustang', 'GT Fastback', 'GT'], ['Mustang', 'Dark Horse SC', 'Dark Horse'], ['Mustang', 'Dark Horse Premium', 'Dark Horse'], ['Mustang', 'GT Premium RTR Spec', 'GT Premium'],
    // Maverick: Lobo variants, Hybrid / drivetrain words
    ['Maverick', 'Lobo Standard', 'Lobo'], ['Maverick', 'Lobo High', 'Lobo'], ['Maverick', 'XLT AWD Supercrew', 'XLT'], ['Maverick', 'Lariat HYBRID AWD', 'Lariat'], ['Maverick', 'New 2026 Ford Maverick XLT SuperCrew', 'XLT'],
    // Bronco
    ['Bronco', 'Heritage Edition', 'Heritage'], ['Bronco', 'Heritage Limited Edition', 'Heritage Limited'], ['Bronco', 'Big Bend 4 Door', 'Big Bend'], ['Bronco', 'Badlands 4 Door Advanced', 'Badlands'],
    ['Bronco', 'RAPTOR 4 DOOR ADVANCED', 'Raptor'], ['Bronco', 'Big Bend - Crossroads', 'Big Bend'], ['Bronco', 'Outer Banks Sport Utility', 'Outer Banks'], ['Bronco', 'Wildtrak 4 Door Advanced', 'Wildtrak'],
    // Ranger
    ['Ranger', "XLT 4WD SUPERCREW 5'", 'XLT'], ['Ranger', 'Raptor 4x4 SuperCrew 5 ft. box 128.7 in. WB', 'Raptor'], ['Ranger', 'XL STX', 'STX'], ['F-150', 'XL STX', 'STX'],
  ];
  for (const [model, from, to] of cases) {
    it(`${model}: ${JSON.stringify(from)} -> ${to}`, () => {
      const r = fix(model, from);
      assert.equal(r.status, 'fix', `${from} should be fixable, got ${r.status}`);
      assert.equal(r.trim, to);
    });
  }
});

describe('normalizeFordTrim: Tremor is a package on Super Duty / Ranger / Maverick, a trim on F-150', () => {
  it('Super Duty keeps the real trim', () => {
    assert.deepEqual([fix('F-250', 'Lariat Tremor').trim, fix('F-250', 'Platinum TREMOR').trim, fix('F-250', 'XLT Tremor').trim, fix('F-350', 'King Ranch Tremor').trim, fix('F-250', 'XLT 4WD TREMOR').trim], ['Lariat', 'Platinum', 'XLT', 'King Ranch', 'XLT']);
    assert.equal(fix('F-250', 'Lariat Tremor').status, 'fix');
  });
  it('Ranger and Maverick keep the real trim', () => {
    assert.equal(fix('Ranger', '2.3T 4WD Lariat w/ Tremor Off-Road Pkg').trim, 'Lariat');
    assert.equal(fix('Maverick', 'Lariat - TREMOR OFF-ROAD').trim, 'Lariat');
  });
  it('a bare Tremor stays Tremor everywhere (there is no other trim to keep)', () => {
    for (const m of ['F-250', 'Ranger', 'Maverick', 'F-150', 'Explorer', 'Expedition']) { const r = fix(m, 'Tremor'); assert.deepEqual([r.status, r.trim], ['clean', 'Tremor'], m); }
  });
  it('F-150 and the SUVs: Tremor is a trim, and two trims in one string are left alone', () => {
    assert.equal(fix('F-150', 'Tremor 4WD SuperCrew').trim, 'Tremor');
    assert.equal(fix('Explorer', 'Tremor 4WD').trim, 'Tremor');
    const amb = fix('F-150', 'XLT Lariat');
    assert.deepEqual([amb.status, amb.trim], ['ambiguous', 'XLT Lariat']);
  });
});

describe('normalizeFordTrim: what it leaves exactly as it is', () => {
  it('official trims are clean and untouched', () => {
    for (const [m, t] of [['F-150', 'XLT'], ['F-250', 'King Ranch'], ['Explorer', 'ST-Line'], ['Escape', 'ST-Line Select'], ['Bronco', 'Big Bend'], ['Mustang', 'GT Premium'], ['Maverick', 'Lobo']]) assert.deepEqual(fix(m, t), { trim: t, status: 'clean' });
  });
  it('"Base" and the Escape "S" are not targets: never matched inside text, never rewritten', () => {
    for (const [m, t] of [['Bronco', 'Base 4 Door 4x4'], ['F-250', 'Base'], ['F-150', 'Base'], ['Escape', 'Base'], ['Mustang', 'Base']]) { const r = fix(m, t); assert.notEqual(r.status, 'fix', `${m} ${t}`); assert.equal(r.trim, t); }
    assert.deepEqual(fix('Escape', 'S'), { trim: 'S', status: 'clean' });
    assert.equal(fix('Escape', 'S AWD').status, 'leftover');
    assert.equal(fix('Escape', 'S AWD').trim, 'S AWD');
  });
  it('unreadable text stays: engine / body / drivetrain, generic words, dealer junk', () => {
    for (const [m, t] of [['F-250', 'Truck Crew Cab V-8'], ['F-150', 'Truck SuperCrew'], ['Explorer', '4WD Automatic'], ['Mustang', 'Coupe I-4 cyl'], ['F-250', 'Preferred'], ['Escape', 'PHEV'], ['F-150', 'FX4'],
      ['F-150', 'Inventory'], ['F-250', 'vehicles - Doggett Ford'], ['Explorer', 'Young Volkswagen of Layton'], ['F-250', 'F250 4X4 CREWC'], ['F-250', 'STX']]) {
      const r = fix(m, t); assert.equal(r.status, 'leftover', `${m} ${t}`); assert.equal(r.trim, t);
    }
  });
  it('blank and null stay as they are (no VIN tie-break)', () => {
    assert.deepEqual(fix('F-150', null), { trim: null, status: 'blank' });
    assert.deepEqual(fix('F-150', ''), { trim: '', status: 'blank' });
    assert.deepEqual(fix('F-150', '   '), { trim: '   ', status: 'blank' });
  });
  it('other makes, other Ford models and a missing model are skipped', () => {
    assert.equal(normalizeFordTrim({ make: 'Toyota', model: 'Tacoma', trim: 'TRD Sport 4WD' }).status, 'skipped');
    assert.equal(normalizeFordTrim({ make: 'Lincoln', model: 'Navigator', trim: 'Reserve 4x4' }).status, 'skipped');
    assert.equal(fix('Bronco Sport', 'Big Bend 4x4').status, 'skipped');
    assert.equal(fix('F-150 Lightning', 'XLT 4WD').status, 'skipped');
    assert.equal(fix(null, 'XLT').status, 'skipped');
    assert.equal(normalizeFordTrim({ make: 'FORD', model: 'F-150', trim: '4X4 CREWCAB XLT' }).trim, 'XLT', 'make is case-insensitive');
  });
  it('Super Duty STX is not an official Super Duty trim, so it stays; F-150 STX is', () => {
    assert.equal(fix('F-250', 'STX').status, 'leftover');
    assert.equal(fix('F-150', 'STX').status, 'clean');
  });
});

describe('normalizeFordTrimForWrite', () => {
  it('keeps the dealer text in trimRaw when it rewrites, and only then', () => {
    assert.deepEqual(normalizeFordTrimForWrite({ make: 'Ford', model: 'F-150', trim: '4X4 CREWCAB XLT' }), { trim: 'XLT', trimRaw: '4X4 CREWCAB XLT', status: 'fix' });
    assert.deepEqual(normalizeFordTrimForWrite({ make: 'Ford', model: 'F-150', trim: '  LARIAT  ' }), { trim: 'Lariat', trimRaw: 'LARIAT', status: 'fix' });
    assert.deepEqual(normalizeFordTrimForWrite({ make: 'Ford', model: 'F-150', trim: 'XLT' }), { trim: 'XLT', trimRaw: null, status: 'clean' });
    assert.deepEqual(normalizeFordTrimForWrite({ make: 'Ford', model: 'F-250', trim: 'Preferred' }), { trim: 'Preferred', trimRaw: null, status: 'leftover' });
    assert.deepEqual(normalizeFordTrimForWrite({ make: 'Honda', model: 'Civic', trim: 'EX-L' }), { trim: 'EX-L', trimRaw: null, status: 'skipped' });
    assert.deepEqual(normalizeFordTrimForWrite({ make: 'Ford', model: 'F-150', trim: null }), { trim: null, trimRaw: null, status: 'blank' });
  });
  it('is idempotent: normalizing the output changes nothing', () => {
    for (const [m, t] of [['F-150', '4X4 CREWCAB XLT'], ['F-250', 'F 250 Lariat'], ['Escape', 'St Line'], ['Mustang', 'Ecoboost Premium Fastback'], ['Bronco', 'Heritage Limited Edition'], ['Maverick', 'Lobo Standard']]) {
      const once = normalizeFordTrimForWrite({ make: 'Ford', model: m, trim: t });
      const twice = normalizeFordTrimForWrite({ make: 'Ford', model: m, trim: once.trim });
      assert.equal(twice.trim, once.trim); assert.equal(twice.trimRaw, null); assert.equal(twice.status, 'clean');
    }
  });
  it('trimRaw is capped to the column width', () => {
    const long = `XLT ${'4WD '.repeat(80)}`;
    assert.ok(normalizeFordTrimForWrite({ make: 'Ford', model: 'F-150', trim: long }).trimRaw.length <= 160);
  });
});
