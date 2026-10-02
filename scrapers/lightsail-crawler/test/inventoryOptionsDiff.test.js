// handleInventoryBulk rewrites a vehicle's factory-option facet rows only when they differ from what is stored.
// The comparison must be exact — a false "unchanged" would leave stale rows behind — and the rewrite for a
// changed vehicle is the same DELETE + INSERT as always, so only the decision is tested here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pairKey, groupExistingOptionRows, optionSetsEqual, diffOptionSets } from '../src/inventoryOptionsDiff.js';
import { optionRowsFromOptions } from '../src/inventoryOptionRows.js';

const o = (key, label = key.toUpperCase(), code = null) => ({ key, label, code });
const db = (vin, dealer_id, key, label = key.toUpperCase(), code = null) => ({ vin, dealer_id, canonical_key: key, label, code });

describe('optionSetsEqual', () => {
  it('equal sets compare equal regardless of order', () => {
    assert.equal(optionSetsEqual([o('a'), o('b')], [o('b'), o('a')]), true);
    assert.equal(optionSetsEqual([], []), true);
  });

  it('a different size, key, label or code is a change', () => {
    assert.equal(optionSetsEqual([o('a')], [o('a'), o('b')]), false);
    assert.equal(optionSetsEqual([o('a'), o('b')], [o('a')]), false);
    assert.equal(optionSetsEqual([o('a')], [o('b')]), false);
    assert.equal(optionSetsEqual([o('a', 'Heated Seats')], [o('a', 'Heated Seat')]), false);
    assert.equal(optionSetsEqual([o('a', 'X', 'PKG-1')], [o('a', 'X', 'PKG-2')]), false);
    assert.equal(optionSetsEqual([o('a', 'X', null)], [o('a', 'X', 'PKG-1')]), false);
  });

  it('treats a missing code the same whichever way it is represented', () => {
    assert.equal(optionSetsEqual([o('a', 'X', null)], [o('a', 'X', undefined)]), true);
    assert.equal(optionSetsEqual([o('a', 'X', '')], [o('a', 'X', null)]), true);
  });

  it('is case- and whitespace-exact (stored labels are compared as stored)', () => {
    assert.equal(optionSetsEqual([o('a', 'Heated Seats')], [o('a', 'heated seats')]), false);
    assert.equal(optionSetsEqual([o('a', 'Heated Seats ')], [o('a', 'Heated Seats')]), false);
  });

  it('a duplicated stored key (impossible under the primary key, but never trusted) is a change', () => {
    assert.equal(optionSetsEqual([o('a'), o('a')], [o('a'), o('b')]), false);
  });
});

describe('groupExistingOptionRows', () => {
  it('groups database rows by vehicle', () => {
    const g = groupExistingOptionRows([db('V1', 7, 'a'), db('V1', 7, 'b', 'B', 'PKG-9'), db('V2', 7, 'a'), db('V1', 8, 'a')]);
    assert.equal(g.size, 3);
    assert.deepEqual(g.get(pairKey('V1', 7)), [o('a'), o('b', 'B', 'PKG-9')]);
    assert.deepEqual(g.get(pairKey('V1', 8)), [o('a')], 'the same VIN at another store is a different vehicle');
  });
});

describe('diffOptionSets', () => {
  const existing = groupExistingOptionRows([db('V1', 1, 'a'), db('V1', 1, 'b'), db('V2', 1, 'a'), db('V3', 1, 'z')]);

  it('flags only vehicles whose set differs, and counts the rest as unchanged', () => {
    const { changed, unchanged } = diffOptionSets([
      { pair: pairKey('V1', 1), rows: [o('b'), o('a')] }, // same
      { pair: pairKey('V2', 1), rows: [o('a'), o('c')] }, // gained an option
      { pair: pairKey('V3', 1), rows: [] }, // lost everything it had
      { pair: pairKey('V4', 1), rows: [o('a')] }, // never had a set
      { pair: pairKey('V5', 1), rows: [] }, // nothing then, nothing now
    ], existing);
    assert.deepEqual(changed, [pairKey('V2', 1), pairKey('V3', 1), pairKey('V4', 1)]);
    assert.equal(unchanged, 2);
  });

  it('a vehicle that lost an option from its list is rewritten, so it stops matching that option', () => {
    const { changed } = diffOptionSets([{ pair: pairKey('V1', 1), rows: [o('a')] }], existing);
    assert.deepEqual(changed, [pairKey('V1', 1)]);
  });
});

describe('end to end with the real derivation rules', () => {
  const payload = [{ name: 'Heated Front Seats', code: 'OPT-3' }, { name: 'Panoramic Sunroof', code: 'OPT-9' }, { name: '$995 Doc Fee' }];
  const derive = () => optionRowsFromOptions(payload).rows;

  it('tonight\'s identical payload derives rows equal to what the previous night stored', () => {
    const stored = derive().map((r) => db('V1', 1, r.key, r.label, r.code));
    const { changed, unchanged } = diffOptionSets([{ pair: pairKey('V1', 1), rows: derive() }], groupExistingOptionRows(stored));
    assert.deepEqual({ changed, unchanged }, { changed: [], unchanged: 1 });
  });

  it('changing the derivation rules (here: an allowlist resolver) is detected and rewritten — no version marker needed', () => {
    const stored = derive().map((r) => db('V1', 1, r.key, r.label, r.code));
    const resolveKey = (key) => (key === 'heated front seats' ? { key: 'heated seats', label: 'Heated Seats' } : null);
    const now = optionRowsFromOptions(payload, { resolveKey }).rows;
    const { changed } = diffOptionSets([{ pair: pairKey('V1', 1), rows: now }], groupExistingOptionRows(stored));
    assert.deepEqual(changed, [pairKey('V1', 1)]);
  });

  it('a dealer-fee line that the junk filter drops never causes a rewrite', () => {
    const withFee = optionRowsFromOptions([...payload, { name: '$500 Dealer Document Processing Fee' }]).rows;
    const stored = derive().map((r) => db('V1', 1, r.key, r.label, r.code));
    assert.deepEqual(diffOptionSets([{ pair: pairKey('V1', 1), rows: withFee }], groupExistingOptionRows(stored)).changed, []);
  });
});
