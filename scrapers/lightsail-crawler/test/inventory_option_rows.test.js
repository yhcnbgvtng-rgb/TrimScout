// The option -> facet-row rules shared by the nightly upsert (handleInventoryBulk) and the options
// backfill script. Pinned here because deals_api_server.js can't be imported in a test (it starts a
// real server at import time).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOptionKey, optionRowsFromOptions, payloadHasOptions } from '../src/inventoryOptionRows.js';

describe('optionRowsFromOptions', () => {
  it('canonicalizes by name and dedupes, keeping the first label/code seen', () => {
    const { rows } = optionRowsFromOptions([
      { code: 'PKG-101A', name: 'FX4 Off-Road Package', price: 995 },
      { code: 'OPT-7', name: 'FX4 Off Road Package', price: 0 },
      { code: null, name: 'Twin Panel Moonroof' },
    ]);
    assert.deepEqual(rows, [
      { key: 'fx4 off road package', label: 'FX4 Off-Road Package', code: 'PKG-101A' },
      { key: 'twin panel moonroof', label: 'Twin Panel Moonroof', code: null },
    ]);
  });

  it('drops #333 marketing sentences before they reach the facet, and counts them', () => {
    const { rows, junkDropped } = optionRowsFromOptions([
      { name: 'the FX4 Off-Road Package adds skid plates underneath' },
      { name: 'Picture the FX4 confidence on the road ahead' },
      { name: 'x'.repeat(80) },
      { name: 'Bowers & Wilkins Diamond Surround Sound System' },
    ]);
    assert.equal(junkDropped, 3);
    assert.deepEqual(rows.map((r) => r.key), ['bowers wilkins diamond surround sound system']);
  });

  it('drops dealer fees, finance/warranty products and split-decimal fragments (live Honda CR-V junk)', () => {
    const { rows, junkDropped } = optionRowsFromOptions([
      { name: '$0 Deductible Coverage' },
      { name: '00 Dealer Document Processing Fee' },
      { name: '00 Doc Fee' },
      { name: '0-amp port in center console' },
      { name: '$0 Warranty Deductible' },
      { name: '(0 A) Marsh Gray' },
      { name: '0!!!' },
      { name: '0 adds adaptive cruise control with stop-and-go capability' },
      { name: '360-Degree Camera' },
      { name: '10-Speed Automatic Transmission' },
    ]);
    assert.equal(junkDropped, 8);
    assert.deepEqual(rows.map((r) => r.label), ['360-Degree Camera', '10-Speed Automatic Transmission']);
  });

  it('keeps a real option containing a single sentence-marker word', () => {
    const { rows, junkDropped } = optionRowsFromOptions([{ name: '20-inch Wheels With FX4 Off-Road Bodyside Decal' }]);
    assert.equal(junkDropped, 0);
    assert.equal(rows.length, 1);
  });

  it('skips code-only entries — a listing-position code is not a stable identity', () => {
    assert.deepEqual(optionRowsFromOptions([{ code: 'OPT-35', name: null }, { code: 'OPT-36' }]).rows, []);
  });

  it('returns nothing for a non-array', () => {
    assert.deepEqual(optionRowsFromOptions(null), { rows: [], junkDropped: 0 });
  });
});

describe('payloadHasOptions — a crawl that extracted nothing must not wipe existing facet rows', () => {
  it('is false for null, undefined, and an empty list (what the sync sends when nothing was extracted)', () => {
    assert.equal(payloadHasOptions(null), false);
    assert.equal(payloadHasOptions(undefined), false);
    assert.equal(payloadHasOptions([]), false);
  });

  it('is true for a real options list, even one that turns out to be all junk after filtering', () => {
    assert.equal(payloadHasOptions([{ name: 'x' }]), true);
  });
});

describe('normalizeOptionKey', () => {
  it('folds B&W into the full brand name before stripping punctuation', () => {
    assert.equal(normalizeOptionKey('B&W Premium Audio'), 'bowers wilkins premium audio');
  });

  it('caps at 80 characters (the column width)', () => {
    assert.equal(normalizeOptionKey('a '.repeat(100)).length <= 80, true);
  });
});
