import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSummaryAccumulator, summaryToQueryRows } from '../src/catalogSummary.js';

describe('catalog all-makes summary', () => {
  it('sums counts across makes, applies the minimum and orders by count desc', () => {
    const acc = createSummaryAccumulator();
    acc.addOptions([{ canonical_key: 'sunroof', label: 'Sunroof', n: 5 }, { canonical_key: 'rare', label: 'Rare', n: 2 }]);
    acc.addOptions([{ canonical_key: 'sunroof', label: 'Moonroof', n: 7 }, { canonical_key: 'awd', label: 'AWD', n: 20 }]);
    const { optionRows } = acc.result({ minVehicles: 3 });
    assert.deepEqual(optionRows, [['awd', 'AWD', 20], ['sunroof', 'Moonroof', 12]]);
  });

  it('keeps the smallest label case-insensitively (MIN under a _ci collation)', () => {
    const acc = createSummaryAccumulator();
    acc.addOptions([{ canonical_key: 'k', label: 'zeta', n: 1 }, { canonical_key: 'k', label: 'Alpha', n: 1 }]);
    assert.equal(acc.result({ minVehicles: 1 }).optionRows[0][1], 'Alpha');
  });

  it('caps at the limit', () => {
    const acc = createSummaryAccumulator();
    acc.addOptions(Array.from({ length: 10 }, (_, i) => ({ canonical_key: `k${i}`, label: `L${i}`, n: 10 - i })));
    assert.equal(acc.result({ minVehicles: 1, limit: 3 }).optionRows.length, 3);
  });

  it('collects distinct exterior and interior colors separately and skips blanks', () => {
    const acc = createSummaryAccumulator();
    acc.addColors([{ ext: 'Red', intr: 'Black' }, { ext: 'Red', intr: '' }, { ext: '', intr: 'Tan' }]);
    assert.deepEqual(acc.result({ minVehicles: 1 }).colorRows, [['ext', 'Red'], ['int', 'Black'], ['int', 'Tan']]);
  });

  it('round-trips into the row shapes the handler already consumes', () => {
    const { optionRows, colorRows } = summaryToQueryRows({
      options: [{ canonical_key: 'awd', label: 'AWD', vehicle_count: 20 }],
      colors: [{ kind: 'ext', color: 'Red' }, { kind: 'int', color: 'Tan' }],
    });
    assert.deepEqual(optionRows, [{ canonical_key: 'awd', label: 'AWD', vehicleCount: 20 }]);
    assert.deepEqual(colorRows, [{ exterior_color: 'Red', interior_color: null }, { exterior_color: null, interior_color: 'Tan' }]);
  });

  it('folds keys that differ only by case/accent/trailing space (the table PK is case-insensitive)', () => {
    const acc = createSummaryAccumulator();
    acc.addOptions([{ canonical_key: 'Sunroof', label: 'A', n: 2 }, { canonical_key: 'sunroof ', label: 'B', n: 3 }]);
    acc.addColors([{ ext: '01g3', intr: 'Café' }, { ext: '01G3', intr: 'Cafe' }]);
    const r = acc.result({ minVehicles: 1 });
    assert.equal(r.optionRows.length, 1);
    assert.equal(r.optionRows[0][2], 5);
    assert.deepEqual(r.colorRows, [['ext', '01g3'], ['int', 'Café']]);
  });
});
