import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeDumpRows, parseListArg } from '../src/oem_dump_merge.js';
import { countDealersByBrand, coverageMatrix, coverageGaps } from '../src/dealer_coverage.js';

const r = (state, name, make = 'Toyota') => ({ make, name, state, domain: `${name.toLowerCase().replace(/\W/g, '')}.com`, source: 'oem-locator' });

describe('mergeDumpRows', () => {
  it('full refresh replaces the dump', () => {
    const out = mergeDumpRows({ existing: [r('NJ', 'Old')], fresh: [r('NJ', 'New')] });
    assert.deepEqual(out.rows.map((x) => x.name), ['New']);
  });
  it('an empty fetch never replaces a non-empty dump', () => {
    const out = mergeDumpRows({ existing: [r('NJ', 'Keep')], fresh: [] });
    assert.equal(out.rows.length, 1);
    assert.match(out.note, /kept the existing dump/);
  });
  it('an empty fetch of an empty dump stays empty', () => {
    assert.deepEqual(mergeDumpRows({ existing: [], fresh: [] }).rows, []);
  });
  it('a state subset replaces only those states and keeps the rest', () => {
    const out = mergeDumpRows({
      existing: [r('NJ', 'NjOld'), r('WI', 'WiOld')],
      fresh: [r('WI', 'WiNew'), r('WI', 'WiNew2')],
      states: ['wi'],
    });
    assert.deepEqual(out.rows.map((x) => x.name).sort(), ['NjOld', 'WiNew', 'WiNew2']);
  });
});

describe('parseListArg', () => {
  it('splits, trims, and returns null when absent', () => {
    assert.deepEqual(parseListArg(['--states=WI, MI'], 'states'), ['WI', 'MI']);
    assert.equal(parseListArg([], 'states'), null);
  });
});

describe('dealer coverage from oem-dumps', () => {
  it('counts per brand, reports zero-dealer pairs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-'));
    fs.writeFileSync(path.join(root, 'acura-dealers.json'), '[]');
    fs.mkdirSync(path.join(root, 'dealers', 'oem-dumps'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dealers', 'oem-dumps', 'toyota.json'), JSON.stringify([
      r('WI', 'Badger Toyota'), r('WI', 'Lake Toyota'), r('MI', 'Motor Toyota'),
    ]));
    const counts = countDealersByBrand('WI', ['Toyota', 'Hyundai'], { cwd: root });
    assert.deepEqual(counts, { Toyota: 2, Hyundai: 0 });
    const gaps = coverageGaps(coverageMatrix(['WI', 'MI', 'WA'], ['Toyota', 'Hyundai'], { cwd: root }));
    assert.deepEqual(gaps.map((g) => `${g.state}:${g.brand}`).sort(),
      ['MI:Hyundai', 'WA:Hyundai', 'WA:Toyota', 'WI:Hyundai']);
  });
});
