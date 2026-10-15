import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuplicateVinRequest, planVinKeepers, buildRowsSelect, buildRetireStatement, storeMatchesMake, canonicalMake, buildBlockedIdsSelect, BLOCKED_RANK_MODES, MAX_DUPLICATE_VINS } from '../src/vinKeeper.js';
import { distinctVins, runDuplicateVins, DUPLICATE_VINS_PATH } from '../../../scripts/box/syncSuperseded.js';

const V1 = '3N1AB8CV6RY276712', V2 = 'KMHGC4DD9DU247439';
const FB = '2026-10-09T20:00:00Z'; // run start - 48h
const row = (vin, dealerId, first, last, extra = {}) => ({ vin, dealerId, firstSeenAt: first, lastSeenAt: last, source: 'nightly', ...extra });

describe('parseDuplicateVinRequest', () => {
  it('accepts VINs, upper-cases and de-duplicates them', () => {
    const r = parseDuplicateVinRequest({ vins: [V1.toLowerCase(), V1, V2], foreignBefore: FB, dryRun: true });
    assert.equal(r.ok, true);
    assert.deepEqual(r.vins, [V1, V2]);
    assert.equal(r.dryRun, true);
  });
  it('rejects a missing cutoff, empty/oversized lists and malformed VINs', () => {
    assert.equal(parseDuplicateVinRequest({ vins: [V1] }).ok, false);
    assert.equal(parseDuplicateVinRequest({ vins: [], foreignBefore: FB }).ok, false);
    assert.equal(parseDuplicateVinRequest({ vins: Array.from({ length: MAX_DUPLICATE_VINS + 1 }, () => V1), foreignBefore: FB }).ok, false);
    assert.equal(parseDuplicateVinRequest({ vins: ['SHORT'], foreignBefore: FB }).ok, false);
    assert.equal(parseDuplicateVinRequest({ vins: [V1], foreignBefore: 'nope' }).ok, false);
  });
});

describe('planVinKeepers', () => {
  it('a VIN under one store is kept as is', () => {
    const p = planVinKeepers([row(V1, 5, '2026-10-01T00:00:00Z', '2026-10-11T14:00:00Z')], { foreignBefore: FB });
    assert.deepEqual(p.retire, []);
    assert.deepEqual(p.keep, [[V1, 5]]);
    assert.equal(p.vinsWithDuplicates, 0);
  });
  it('two stores both refreshed tonight (the live Fred Anderson Kia / Asheville Toyota shape): the incumbent keeps it', () => {
    const rows = [row(V1, 6571, '2026-09-24T10:54:00Z', '2026-10-11T14:42:00Z'), row(V1, 12885, '2026-10-08T09:28:00Z', '2026-10-11T14:40:00Z')];
    const p = planVinKeepers(rows, { foreignBefore: FB });
    assert.deepEqual(p.keep, [[V1, 6571]]);
    assert.deepEqual(p.retire, [[V1, 12885]]);
    assert.equal(p.vinsWithDuplicates, 1);
  });
  it('the choice does not depend on row order or on which box ran the sync (no ping-pong)', () => {
    const rows = [row(V1, 6571, '2026-09-24T10:54:00Z', '2026-10-11T14:42:00Z'), row(V1, 12885, '2026-10-08T09:28:00Z', '2026-10-11T14:40:00Z'), row(V1, 777, '2026-10-02T00:00:00Z', '2026-10-11T01:00:00Z')];
    const a = planVinKeepers(rows, { foreignBefore: FB });
    const b = planVinKeepers([...rows].reverse(), { foreignBefore: FB });
    assert.deepEqual(a.keep, b.keep);
    assert.deepEqual(new Set(a.retire.map((x) => x.join('|'))), new Set(b.retire.map((x) => x.join('|'))));
    assert.deepEqual(a.keep, [[V1, 6571]]);
  });
  it('a row nobody has refreshed within the window never outranks one that was, however old the other is', () => {
    const rows = [row(V1, 1, '2026-01-01T00:00:00Z', '2026-10-03T12:00:00Z'), row(V1, 2, '2026-10-09T00:00:00Z', '2026-10-11T14:00:00Z')];
    const p = planVinKeepers(rows, { foreignBefore: FB });
    assert.deepEqual(p.keep, [[V1, 2]]);
    assert.deepEqual(p.retire, [[V1, 1]]);
  });
  it('the "no store matched" bucket (0) loses to a real store even when it is older and fresher', () => {
    const rows = [row(V1, 0, '2026-09-01T00:00:00Z', '2026-10-11T15:00:00Z'), row(V1, 4493, '2026-10-05T00:00:00Z', '2026-10-11T14:00:00Z')];
    const p = planVinKeepers(rows, { foreignBefore: FB });
    assert.deepEqual(p.keep, [[V1, 4493]]);
    assert.deepEqual(p.retire, [[V1, 0]]);
  });
  it('when every row is stale, one is still kept (the incumbent) rather than all retired', () => {
    const rows = [row(V1, 9, '2026-09-10T00:00:00Z', '2026-10-01T00:00:00Z'), row(V1, 3, '2026-09-01T00:00:00Z', '2026-10-02T00:00:00Z')];
    const p = planVinKeepers(rows, { foreignBefore: FB });
    assert.deepEqual(p.keep, [[V1, 3]]);
    assert.deepEqual(p.retire, [[V1, 9]]);
  });
  it('equal first_seen falls back to the lowest store id; null first_seen ranks last', () => {
    const t = '2026-10-11T14:00:00Z';
    assert.deepEqual(planVinKeepers([row(V1, 9, '2026-10-01T00:00:00Z', t), row(V1, 4, '2026-10-01T00:00:00Z', t)], { foreignBefore: FB }).keep, [[V1, 4]]);
    assert.deepEqual(planVinKeepers([row(V1, 1, null, t), row(V1, 2, '2026-10-01T00:00:00Z', t)], { foreignBefore: FB }).keep, [[V1, 2]]);
  });
  it('never retires or keeps rows that are not live nightly rows', () => {
    const t = '2026-10-11T14:00:00Z';
    const rows = [row(V1, 1, '2026-10-01T00:00:00Z', t, { source: 'manual' }), row(V1, 2, '2026-10-02T00:00:00Z', t), row(V1, 3, '2026-10-03T00:00:00Z', t, { removedAt: '2026-10-05T00:00:00Z' })];
    const p = planVinKeepers(rows, { foreignBefore: FB });
    assert.deepEqual(p.keep, [[V1, 2]]);
    assert.deepEqual(p.retire, []);
  });
  it('handles MariaDB datetime strings and Date objects alike, and several VINs at once', () => {
    const rows = [
      row(V1, 1, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-11T14:00:00Z')), row(V1, 2, new Date('2026-10-02T00:00:00Z'), new Date('2026-10-11T14:00:00Z')),
      row(V2, 7, '2026-10-01 00:00:00', '2026-10-11 14:00:00'), row(V2, 8, '2026-10-01 00:00:00', '2026-10-11 14:00:00'),
    ];
    const p = planVinKeepers(rows, { foreignBefore: FB });
    assert.deepEqual(p.keep, [[V1, 1], [V2, 7]].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    assert.equal(p.retire.length, 2);
    assert.equal(p.vinsWithDuplicates, 2);
  });
  it('throws without a cutoff', () => assert.throws(() => planVinKeepers([], {}), /foreignBefore/));
});

describe('statements', () => {
  it('reads only live nightly rows of the listed VINs, by primary-key prefix', () => {
    const { sql, args } = buildRowsSelect([V1, V2]);
    assert.match(sql, /WHERE removed_at IS NULL AND source = 'nightly' AND vin IN \(\?, \?\)$/);
    assert.deepEqual(args, [V1, V2]);
  });
  it('retires by primary key and re-checks the row is still live', () => {
    const { sql, args } = buildRetireStatement([[V1, 12885], [V2, 5]]);
    assert.match(sql, /^UPDATE dealer_inventory FORCE INDEX \(PRIMARY\) SET removed_at = CURRENT_TIMESTAMP WHERE removed_at IS NULL AND source = 'nightly' AND \(\(vin = \? AND dealer_id = \?\) OR \(vin = \? AND dealer_id = \?\)\)$/);
    assert.deepEqual(args, [V1, 12885, V2, 5]);
  });
});

describe('sync client: distinctVins / runDuplicateVins', () => {
  const rows = [{ vin: V2, dealerId: 5 }, { vin: V1, dealerId: 6 }, { vin: V1, dealerId: 7 }, { vin: V1.toLowerCase(), dealerId: 7 }, { vin: V2, dealerId: 0 }, { vin: null, dealerId: 5 }, { vin: 'X', dealerId: null }];
  it('lists each matched-store VIN once, sorted, upper-cased', () => assert.deepEqual(distinctVins(rows), [V1, V2].sort()));
  it('sends batches, sums the counts and passes the dry-run flag through', async () => {
    const calls = [];
    const api = async (path, body) => { calls.push([path, body]); return { vinsWithDuplicates: 1, wouldRetire: 2, retired: 3 }; };
    const dry = await runDuplicateVins({ api, rows, foreignBefore: FB, dryRun: true, batch: 1, log: () => {} });
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], DUPLICATE_VINS_PATH);
    assert.equal(calls[0][1].dryRun, true);
    assert.deepEqual(dry, { vins: 2, calls: 2, retired: 0, wouldRetire: 4, vinsWithDuplicates: 2, failedCalls: 0 });
    const live = await runDuplicateVins({ api, rows, foreignBefore: FB, log: () => {} });
    assert.equal(live.retired, 3);
    assert.equal(live.wouldRetire, 0);
  });
  it('a failed batch is logged and skipped; a 404 stops the step; a lost lock stops it before any call', async () => {
    const logs = [];
    let n = 0;
    const flaky = async () => { n++; if (n === 1) throw new Error('HTTP 500 boom'); return { retired: 1 }; };
    const r = await runDuplicateVins({ api: flaky, rows, foreignBefore: FB, batch: 1, log: (m) => logs.push(m) });
    assert.equal(r.failedCalls, 1);
    assert.equal(r.retired, 1);
    const old = await runDuplicateVins({ api: async () => { throw new Error('POST x -> HTTP 404 Not Found'); }, rows, foreignBefore: FB, batch: 1, log: (m) => logs.push(m) });
    assert.equal(old.calls, 1);
    const lost = await runDuplicateVins({ api: async () => { throw new Error('should not be called'); }, rows, foreignBefore: FB, isLockLost: () => true, log: () => {} });
    assert.equal(lost.calls, 0);
  });
});

describe('brand tiebreak (a store whose name carries the car\'s make beats one that does not, before earliest first_seen)', () => {
  const fresh = '2026-10-14T14:00:00Z';
  const r = (dealerId, dealerName, make, first) => ({ vin: V1, dealerId, dealerName, make, firstSeenAt: first, lastSeenAt: fresh, source: 'nightly' });
  it('storeMatchesMake: whole words, several makes per store, false for a missing name or make or an unlisted make', () => {
    assert.equal(storeMatchesMake('Freedom Chevrolet Buick GMC', 'Chevrolet'), true);
    assert.equal(storeMatchesMake('Freedom Chevrolet Buick GMC', 'GMC'), true);
    assert.equal(storeMatchesMake('ED MORSE NISSAN', 'Chevrolet'), false);
    assert.equal(storeMatchesMake('Mercedes-Benz of Pompano', 'Mercedes-Benz'), true);
    assert.equal(storeMatchesMake('Ramsey Auto Group', 'Ram'), false);
    assert.equal(storeMatchesMake('Stafford Motors', 'Ford'), false);
    assert.equal(storeMatchesMake('Murray Chrysler Dodge Jeep Ram of Starke', 'Jeep'), true);
    assert.equal(storeMatchesMake('Hendrick MINI', 'MINI'), true);
    assert.equal(storeMatchesMake('', 'Ford'), false); assert.equal(storeMatchesMake('Some Ford Store', ''), false); assert.equal(storeMatchesMake('Some Maybach Store', 'Maybach'), false);
  });
  it('the live example: a 2026 Silverado under Freedom Chevrolet Buick GMC (later first seen) and ED MORSE NISSAN (earlier): the Chevrolet store keeps it', () => {
    const rows = [r(16951, 'ED MORSE NISSAN', 'Chevrolet', '2026-09-28T00:00:00Z'), r(9630, 'Freedom Chevrolet Buick GMC By Owner', 'Chevrolet', '2026-09-30T00:00:00Z')];
    assert.deepEqual(planVinKeepers(rows, { foreignBefore: FB }).keep, [[V1, 9630]]);
    assert.deepEqual(planVinKeepers([...rows].reverse(), { foreignBefore: FB }).keep, [[V1, 9630]]);
  });
  it('freshness and a real store still outrank the brand: a stale matching store loses to a fresh non-matching one, and dealer_id 0 never wins on brand', () => {
    const stale = { ...r(9630, 'Freedom Chevrolet', 'Chevrolet', '2026-09-30T00:00:00Z'), lastSeenAt: '2026-09-01T00:00:00Z' };
    assert.deepEqual(planVinKeepers([stale, r(16951, 'ED MORSE NISSAN', 'Chevrolet', '2026-09-28T00:00:00Z')], { foreignBefore: FB }).keep, [[V1, 16951]]);
    assert.deepEqual(planVinKeepers([r(0, 'Freedom Chevrolet', 'Chevrolet', '2026-09-28T00:00:00Z'), r(16951, 'ED MORSE NISSAN', 'Chevrolet', '2026-09-30T00:00:00Z')], { foreignBefore: FB }).keep, [[V1, 16951]]);
  });
  it('both or neither matching falls through to the incumbent, and rows without a name or make behave exactly as before', () => {
    assert.deepEqual(planVinKeepers([r(2, 'Fred Anderson Toyota', 'Toyota', '2026-09-30T00:00:00Z'), r(1, 'Fred Anderson Toyota North', 'Toyota', '2026-09-28T00:00:00Z')], { foreignBefore: FB }).keep, [[V1, 1]]);
    assert.deepEqual(planVinKeepers([r(2, 'Alpha Honda', 'Toyota', '2026-09-30T00:00:00Z'), r(1, 'Beta Kia', 'Toyota', '2026-09-28T00:00:00Z')], { foreignBefore: FB }).keep, [[V1, 1]]);
    const plain = [{ vin: V1, dealerId: 2, firstSeenAt: '2026-09-30T00:00:00Z', lastSeenAt: fresh }, { vin: V1, dealerId: 1, firstSeenAt: '2026-09-28T00:00:00Z', lastSeenAt: fresh }];
    assert.deepEqual(planVinKeepers(plain, { foreignBefore: FB }).keep, [[V1, 1]]);
  });
  it('the keeper query reads the store name and make', () => {
    assert.match(buildRowsSelect([V1]).sql, /dealer_name AS dealerName, make,/);
  });
});

describe('unparseable dates are treated like NULL (the order stays total and never depends on row order)', () => {
  const fresh = '2026-10-14T14:00:00Z';
  const both = (rows, opts = { foreignBefore: FB }) => [planVinKeepers(rows, opts).keep, planVinKeepers([...rows].reverse(), opts).keep];
  it('an Invalid Date / 0000-00-00 first_seen_at on both rows falls to the lowest dealer id, in either row order (it used to depend on the order)', () => {
    for (const bad of [new Date('invalid'), '0000-00-00 00:00:00', 'garbage']) {
      const [a, b] = both([row(V1, 9, bad, fresh), row(V1, 5, bad, fresh)]);
      assert.deepEqual(a, [[V1, 5]]); assert.deepEqual(b, [[V1, 5]]);
    }
  });
  it('an unparseable first_seen_at ranks last, like NULL: the row with a real date keeps the VIN, in either order', () => {
    const [a, b] = both([row(V1, 5, new Date('invalid'), fresh), row(V1, 9, '2026-10-01T00:00:00Z', fresh)]);
    assert.deepEqual(a, [[V1, 9]]); assert.deepEqual(b, [[V1, 9]]);
    const [c, d] = both([row(V1, 5, null, fresh), row(V1, 9, new Date('invalid'), fresh)]);
    assert.deepEqual(c, [[V1, 5]]); assert.deepEqual(d, [[V1, 5]]);
  });
  it('an unparseable last_seen_at is not fresh (same as NULL): a fresh row beats it, and two of them fall through the usual way', () => {
    const [a, b] = both([row(V1, 5, '2026-09-01T00:00:00Z', '0000-00-00 00:00:00'), row(V1, 9, '2026-10-01T00:00:00Z', fresh)]);
    assert.deepEqual(a, [[V1, 9]]); assert.deepEqual(b, [[V1, 9]]);
    const [c, d] = both([row(V1, 5, '2026-10-01T00:00:00Z', new Date('invalid')), row(V1, 9, '2026-09-01T00:00:00Z', null)]);
    assert.deepEqual(c, [[V1, 9]]); assert.deepEqual(d, [[V1, 9]]);
  });
  it('the tiebreak order itself is unchanged: valid dates still go freshness, real store, brand, earliest first seen, lowest dealer id', () => {
    assert.deepEqual(planVinKeepers([row(V1, 9, '2026-09-01T00:00:00Z', fresh), row(V1, 5, '2026-09-02T00:00:00Z', fresh)], { foreignBefore: FB }).keep, [[V1, 9]]);
    assert.deepEqual(planVinKeepers([row(V1, 9, '2026-09-01T00:00:00Z', fresh), row(V1, 5, '2026-09-01T00:00:00Z', fresh)], { foreignBefore: FB }).keep, [[V1, 5]]);
  });
  it('a missing or unparseable foreignBefore still throws', () => {
    assert.throws(() => planVinKeepers([], { foreignBefore: 'nope' }), /foreignBefore/);
    assert.throws(() => planVinKeepers([], {}), /foreignBefore/);
  });
});

describe('one normalized make per VIN (aliases folded, the most common spelling decides for every row)', () => {
  const fresh = '2026-10-14T14:00:00Z';
  const r = (dealerId, dealerName, make, first) => ({ vin: V1, dealerId, dealerName, make, firstSeenAt: first, lastSeenAt: fresh, source: 'nightly' });
  const both = (rows) => [planVinKeepers(rows, { foreignBefore: FB }).keep, planVinKeepers([...rows].reverse(), { foreignBefore: FB }).keep];
  it('canonicalMake folds the usual spellings and keeps unknown makes as they are', () => {
    for (const [a, b] of [['Chevy', 'chevrolet'], ['CHEVROLET', 'chevrolet'], ['VW', 'volkswagen'], ['Mercedes', 'mercedes-benz'], ['Mercedes-Benz', 'mercedes-benz'], ['Mercedes Benz', 'mercedes-benz'], ['Land-Rover', 'land rover'], ['Landrover', 'land rover'], ['Range Rover', 'land rover'], ['Alfa', 'alfa romeo'], ['Ram Trucks', 'ram'], ['MINI Cooper', 'mini'], ['Infinity', 'infiniti'], ['Maserati', 'maserati']]) assert.equal(canonicalMake(a), b, a);
    assert.equal(canonicalMake(''), ''); assert.equal(canonicalMake(null), ''); assert.equal(canonicalMake(undefined), '');
  });
  it('storeMatchesMake accepts the aliases too', () => {
    assert.equal(storeMatchesMake('Freedom Chevrolet Buick GMC', 'Chevy'), true);
    assert.equal(storeMatchesMake('Hendrick Volkswagen', 'VW'), true);
    assert.equal(storeMatchesMake('Mercedes-Benz of Pompano', 'Mercedes'), true);
    assert.equal(storeMatchesMake('ED MORSE NISSAN', 'Chevy'), false);
  });
  it('a row spelled "Chevy" is no longer treated differently from its sister row spelled "Chevrolet": the Chevrolet store keeps the car, in either order', () => {
    const rows = [r(16951, 'ED MORSE NISSAN', 'Chevrolet', '2026-09-28T00:00:00Z'), r(9630, 'Freedom Chevrolet Buick GMC', 'Chevy', '2026-09-30T00:00:00Z')];
    const [a, b] = both(rows);
    assert.deepEqual(a, [[V1, 9630]]); assert.deepEqual(b, [[V1, 9630]]);
  });
  it('a blank make on one row takes the VIN\'s make from its sister rows', () => {
    const rows = [r(16951, 'ED MORSE NISSAN', 'Chevrolet', '2026-09-28T00:00:00Z'), r(9630, 'Freedom Chevrolet', '', '2026-09-30T00:00:00Z')];
    const [a, b] = both(rows);
    assert.deepEqual(a, [[V1, 9630]]); assert.deepEqual(b, [[V1, 9630]]);
  });
  it('the most common spelling wins when the rows disagree (one noisy row cannot flip the brand test), and a tie is broken alphabetically', () => {
    const noisy = [r(1, 'Smith Honda', 'Honda', '2026-09-01T00:00:00Z'), r(2, 'Bob Chevrolet', 'Chevrolet', '2026-09-10T00:00:00Z'), r(3, 'Al Chevrolet', 'Chevy', '2026-09-20T00:00:00Z')];
    const [a, b] = both(noisy);
    assert.deepEqual(a, [[V1, 2]]); assert.deepEqual(b, [[V1, 2]]); // chevrolet x2 beats honda x1 -> the Chevrolet stores match; Bob has the earlier first seen
    const tie = [r(1, 'Smith Honda', 'Honda', '2026-09-20T00:00:00Z'), r(2, 'Bob Chevrolet', 'Chevrolet', '2026-09-10T00:00:00Z')];
    const [c, d] = both(tie);
    assert.deepEqual(c, [[V1, 2]]); assert.deepEqual(d, [[V1, 2]]); // 1-1: 'chevrolet' < 'honda' -> Chevrolet is the VIN's make, in either order
  });
  it('all makes blank or unlisted: no brand credit for anyone, the incumbent decides exactly as before', () => {
    const rows = [r(9, 'Some Store', '', '2026-09-01T00:00:00Z'), r(5, 'Other Store', '', '2026-09-02T00:00:00Z')];
    const [a, b] = both(rows);
    assert.deepEqual(a, [[V1, 9]]); assert.deepEqual(b, [[V1, 9]]);
  });
});

describe('blocked-store rank (OFF by default; a row at a store whose site blocked tonight\'s crawl ranks below a crawlable store\'s row)', () => {
  const fresh = '2026-10-14T14:00:00Z';
  const r = (dealerId, dealerName, make, first, last = fresh) => ({ vin: V1, dealerId, dealerName, make, firstSeenAt: first, lastSeenAt: last, source: 'nightly' });
  const keep = (rows, opts) => [planVinKeepers(rows, { foreignBefore: FB, ...opts }).keep, planVinKeepers([...rows].reverse(), { foreignBefore: FB, ...opts }).keep];
  const same = (res, expected) => { assert.deepEqual(res[0], expected); assert.deepEqual(res[1], expected); };
  // Freedom Chevrolet is the brand match and the incumbent; ED MORSE NISSAN is crawlable, no brand match, later first seen.
  const rows = [r(9630, 'Freedom Chevrolet Buick GMC', 'Chevrolet', '2026-09-01T00:00:00Z'), r(16951, 'ED MORSE NISSAN', 'Chevrolet', '2026-09-20T00:00:00Z')];
  it('the modes are off / before-brand / after-brand; a request may omit blockedRank (null) or send a valid mode, and an unknown one is rejected', () => {
    assert.deepEqual(BLOCKED_RANK_MODES, ['off', 'before-brand', 'after-brand']);
    assert.equal(parseDuplicateVinRequest({ vins: [V1], foreignBefore: FB }).blockedRank, null);
    assert.equal(parseDuplicateVinRequest({ vins: [V1], foreignBefore: FB, blockedRank: 'before-brand' }).blockedRank, 'before-brand');
    assert.equal(parseDuplicateVinRequest({ vins: [V1], foreignBefore: FB, blockedRank: 'sometimes' }).ok, false);
    assert.throws(() => planVinKeepers(rows, { foreignBefore: FB, blockedRank: 'sometimes' }), /blockedRank/);
  });
  it('OFF is the default and changes nothing, even when blocked ids are passed: the brand store keeps the car', () => {
    same(keep(rows, {}), [[V1, 9630]]);
    same(keep(rows, { blockedDealerIds: [9630] }), [[V1, 9630]]);
    same(keep(rows, { blockedRank: 'off', blockedDealerIds: [9630] }), [[V1, 9630]]);
  });
  it('before-brand: the crawlable store beats the blocked brand-matching one', () => {
    same(keep(rows, { blockedRank: 'before-brand', blockedDealerIds: [9630] }), [[V1, 16951]]);
  });
  it('after-brand: the brand still wins first, the blocked flag only breaks a brand tie', () => {
    same(keep(rows, { blockedRank: 'after-brand', blockedDealerIds: [9630] }), [[V1, 9630]]);
    const tied = [r(9, 'Smith Auto', 'Ford', '2026-09-01T00:00:00Z'), r(5, 'Jones Auto', 'Ford', '2026-09-20T00:00:00Z')];
    same(keep(tied, {}), [[V1, 9]]); // incumbent: earliest first seen
    same(keep(tied, { blockedRank: 'after-brand', blockedDealerIds: [9] }), [[V1, 5]]); // the earlier one is blocked tonight -> the crawlable one
    same(keep(tied, { blockedRank: 'before-brand', blockedDealerIds: [9] }), [[V1, 5]]);
  });
  it('both blocked, or neither, or an empty blocked set: falls through to the incumbent exactly as before', () => {
    same(keep(rows, { blockedRank: 'before-brand', blockedDealerIds: [9630, 16951] }), [[V1, 9630]]);
    same(keep(rows, { blockedRank: 'before-brand', blockedDealerIds: [4242] }), [[V1, 9630]]);
    same(keep(rows, { blockedRank: 'before-brand', blockedDealerIds: [] }), [[V1, 9630]]);
  });
  it('freshness and a real store still outrank it: a blocked fresh row beats a crawlable stale one, and a blocked real store beats the dealer_id 0 bucket', () => {
    const staleOpen = [r(9630, 'Freedom Chevrolet', 'Chevrolet', '2026-09-01T00:00:00Z'), r(16951, 'ED MORSE NISSAN', 'Chevrolet', '2026-09-20T00:00:00Z', '2026-09-01T00:00:00Z')];
    same(keep(staleOpen, { blockedRank: 'before-brand', blockedDealerIds: [9630] }), [[V1, 9630]]);
    const zero = [r(0, 'Freedom Chevrolet', 'Chevrolet', '2026-09-01T00:00:00Z'), r(16951, 'ED MORSE NISSAN', 'Chevrolet', '2026-09-20T00:00:00Z')];
    same(keep(zero, { blockedRank: 'before-brand', blockedDealerIds: [16951] }), [[V1, 16951]]);
  });
  it('the blocked ids come from crawl_blocked_stores (dealer ids only)', () => {
    const q = buildBlockedIdsSelect();
    assert.match(q.sql, /SELECT dealer_id AS dealerId FROM crawl_blocked_stores/);
    assert.deepEqual(q.args, []);
  });
});
