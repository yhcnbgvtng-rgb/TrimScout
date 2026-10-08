// The retired-VIN files and the "came back" count (scripts/box/syncRetired.js): which VINs a sync stopped vouching for,
// kept a week so later syncs can say how many returned. No network, no database.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { isRecentDrop, retiredList, toCsv, parseCsvLine, writeRetiredFile, loadRecentRetired, cameBack, formatCameBack, COLUMNS } from '../../../scripts/box/syncRetired.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-09T12:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'retired-'));
const V = (n) => `1FTFW1E5XNFA${String(n).padStart(5, '0')}`;
const drop = (n, over = {}) => ({ vin: V(n), dealerId: 7, dealerName: 'Acme Ford', state: 'TX', ...over });

describe('what counts as retired', () => {
  it('only records the crawl touched in the last 7 days', () => {
    assert.equal(isRecentDrop({ updatedAt: new Date(NOW - 2 * DAY).toISOString() }, NOW), true);
    assert.equal(isRecentDrop({ updatedAt: new Date(NOW - 9 * DAY).toISOString() }, NOW), false);
    assert.equal(isRecentDrop({}, NOW), false);
  });
  it('only from swept stores, never a (VIN, store) that is being uploaded, once each', () => {
    const uploaded = [{ vin: V(1), dealerId: 7 }];
    const list = retiredList([drop(1), drop(2), drop(2), drop(3, { dealerId: 8 }), drop(4, { dealerId: null })], uploaded, new Set([7]));
    assert.deepEqual(list.map((d) => d.vin), [V(2)]);
    assert.deepEqual(retiredList([drop(1, { dealerId: 9 })], uploaded, new Set([9])).map((d) => d.vin), [V(1)], 'same VIN at a different store is a real drop');
  });
});

describe('the file', () => {
  it('is a gzipped CSV with exactly VIN, dealer, state and sourceBox, quoting awkward dealer names', () => {
    const csv = toCsv([drop(1, { dealerName: 'Smith, "Big" Ford' })], 'box2');
    assert.deepEqual(COLUMNS, ['vin', 'dealer', 'state', 'sourceBox']);
    assert.equal(csv.split('\n')[0], 'vin,dealer,state,sourceBox');
    assert.deepEqual(parseCsvLine(csv.split('\n')[1]), [V(1), 'Smith, "Big" Ford', 'TX', 'box2']);
    const dir = tmp();
    const file = writeRetiredFile(dir, [drop(1)], 'box2', NOW);
    assert.match(path.basename(file), /^retired-20261009T120000Z-box2\.csv\.gz$/);
    assert.equal(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'), toCsv([drop(1)], 'box2'));
    assert.deepEqual(fs.readdirSync(dir), [path.basename(file)], 'no temp file left behind');
  });
  it('prunes files older than 14 days and keeps the rest', () => {
    const dir = tmp();
    const old = writeRetiredFile(dir, [drop(1)], 'box2', NOW - 20 * DAY);
    fs.utimesSync(old, new Date(NOW - 20 * DAY), new Date(NOW - 20 * DAY));
    const fresh = writeRetiredFile(dir, [drop(2)], 'box2', NOW);
    assert.deepEqual(fs.readdirSync(dir), [path.basename(fresh)]);
  });
});

describe('the came-back count', () => {
  const setup = () => {
    const dir = tmp();
    const f2 = writeRetiredFile(dir, [drop(1), drop(2, { state: 'FL', dealerName: 'Beach GMC' })], 'box2', NOW - 1 * DAY);
    const f3 = writeRetiredFile(dir, [drop(3, { state: 'OH' })], 'box3', NOW - 3 * DAY);
    for (const [f, t] of [[f2, NOW - 1 * DAY], [f3, NOW - 3 * DAY]]) fs.utimesSync(f, new Date(t), new Date(t));
    return dir;
  };
  it('counts uploaded VINs that appear in the last 7 days of files, by retiring box and state, and splits same-dealer', () => {
    const { map, files } = loadRecentRetired(setup(), NOW);
    assert.equal(files, 2);
    const up = [{ vin: V(1), dealerName: 'ACME FORD' }, { vin: V(2), dealerName: 'Other Dealer' }, { vin: V(3), dealerName: 'Acme Ford' }, { vin: V(9), dealerName: 'Acme Ford' }];
    const r = cameBack(up, map);
    assert.equal(r.total, 3);
    assert.equal(r.sameDealer, 2, 'V1 and V3 returned at the dealer that lost them; V2 moved to a different dealer');
    assert.deepEqual(r.byBox, { box2: 2, box3: 1 });
    assert.deepEqual(r.byState, { TX: 1, FL: 1, OH: 1 });
    assert.deepEqual(r.byBoxState, { 'box2/TX': 1, 'box2/FL': 1, 'box3/OH': 1 });
    assert.match(formatCameBack(r, 2), /came back: 3 VIN\(s\).*2 at the same dealer.*box2 2, box3 1.*by box\/state: box2\/TX 1/);
  });
  it('ignores files older than 7 days and files written for this same crawl output', () => {
    const dir = tmp();
    const oldF = writeRetiredFile(dir, [drop(1)], 'box2', NOW - 8 * DAY);
    fs.utimesSync(oldF, new Date(NOW - 8 * DAY), new Date(NOW - 8 * DAY));
    const same = writeRetiredFile(dir, [drop(2)], 'box2', NOW - 1 * DAY);
    fs.utimesSync(same, new Date(NOW - 1 * DAY), new Date(NOW - 1 * DAY));
    const r = loadRecentRetired(dir, NOW, { notAfterMs: NOW - 2 * DAY });
    assert.equal(r.files, 0, 'the 8-day-old file is too old; the 1-day-old file is newer than the shards, so it is this run\'s own');
    assert.equal(loadRecentRetired(dir, NOW).files, 1);
  });
  it('says so plainly when there is nothing to compare against, and tolerates a missing or junk directory', () => {
    assert.match(formatCameBack({ total: 0 }, 0), /no retired files from the last 7 days yet/);
    assert.equal(loadRecentRetired(path.join(os.tmpdir(), 'does-not-exist-xyz'), NOW).files, 0);
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'retired-20261008T000000Z-box2.csv.gz'), 'not gzip');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    assert.equal(loadRecentRetired(dir, Date.now()).files, 0);
  });
});

describe('wiring in inventory-sync.mjs', () => {
  it('collects drops while reading, logs the came-back count before the write phase, writes the file after the sweep, no new request', () => {
    const src = fs.readFileSync(new URL('../../../scripts/box/inventory-sync.mjs', import.meta.url), 'utf8');
    assert.match(src, /dropped\.push/);
    assert.ok(src.indexOf('formatCameBack(') < src.indexOf('await acquireSyncLock()'), 'comparison logged before the lock wait');
    assert.match(src, /writeRetired\(r\.failedStores \|\| \[\]\);/);
    assert.match(src, /--dry-run --write-retired/);
    assert.doesNotMatch(fs.readFileSync(new URL('../../../scripts/box/syncRetired.js', import.meta.url), 'utf8'), /fetch\(|node:http|mysql|SELECT /i, 'no network, no database');
  });
});
