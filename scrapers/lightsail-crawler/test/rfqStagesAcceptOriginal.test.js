// Staged cash deal: after the dealer declined the buyer's counter, the buyer may accept the dealer's ORIGINAL out-the-door price
// (src/rfqStages.js, installed by scripts/box/2026-10-29-rfq-staged-accept-original.sh). Nothing else moves on a declined desk.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRfqStageHandler } from '../src/rfqStages.js';

const cashQuote = { kind: 'cash', sellingPrice: 40000, addOns: [], rebates: [], dueAtSigning: [{ name: 'Sales tax', amount: 2650 }, { name: 'Doc fee', amount: 799 }, { name: 'Title & registration', amount: 300 }] };
const FUTURE = new Date(Date.now() + 86400000).toISOString();
const PAST = new Date(Date.now() - 86400000).toISOString();

function world({ status = 'declined', counter = true, original = true, expires = FUTURE, liveQuote = false, raceOnReopen = false } = {}) {
  const db = {
    rfq: { id: 7, status: 'collecting', approval_status: 'approved', quote_prefs_json: JSON.stringify({ quoteType: 'cash', staged: true, cash: { zip: '07030' } }), trade_in_expected: 0, trade_in_json: null },
    invite: { id: 11, rfq_id: 7, status, dealer_name: 'Test Motors', stage_json: null, not_selected_at: null, buyer_counter_json: counter ? '{"againstQuoteId":"99"}' : null },
    quotes: [
      ...(original ? [{ id: 99, invite_id: 11, superseded_at: '2026-10-28 10:00:00', expires_at: expires, used_json: JSON.stringify(cashQuote) }] : []),
      ...(liveQuote ? [{ id: 100, invite_id: 11, superseded_at: null, expires_at: FUTURE, used_json: JSON.stringify({ ...cashQuote, sellingPrice: 39000 }) }] : []),
    ],
    events: [], commits: 0, rollbacks: 0,
  };
  const q = async (sql, args = []) => {
    if (/FROM rfq_requests WHERE id/.test(sql)) return [[db.rfq]];
    if (/FROM rfq_invites WHERE id/.test(sql)) return [[db.invite]];
    if (/FROM rfq_quotes WHERE invite_id = \? AND superseded_at IS NOT NULL/.test(sql)) return [db.quotes.filter((x) => x.superseded_at).slice(-1)];
    if (/FROM rfq_quotes WHERE invite_id = \? AND superseded_at IS NULL/.test(sql)) return [db.quotes.filter((x) => !x.superseded_at).slice(-1)];
    if (/UPDATE rfq_invites SET stage_json/.test(sql)) {
      const [next, , , prev] = args;
      if ((db.invite.stage_json ?? null) !== (prev ?? null)) return [{ affectedRows: 0 }];
      db.invite.stage_json = next; return [{ affectedRows: 1 }];
    }
    if (/UPDATE rfq_invites SET status = 'quoted'/.test(sql)) {
      if (raceOnReopen || db.invite.status !== 'declined') return [{ affectedRows: 0 }];
      db.invite.status = 'quoted'; return [{ affectedRows: 1 }];
    }
    if (/UPDATE rfq_quotes SET superseded_at = NULL/.test(sql)) { db.quotes.find((x) => x.id === args[0]).superseded_at = null; return [{ affectedRows: 1 }]; }
    if (/UPDATE rfq_requests SET status = 'picked'/.test(sql)) { db.rfq.status = 'picked'; return [{ affectedRows: 1 }]; }
    throw new Error('unexpected sql: ' + sql);
  };
  const pool = { query: q, getConnection: async () => ({ query: q, beginTransaction: async () => {}, commit: async () => { db.commits++; }, rollback: async () => { db.rollbacks++; }, release: () => {} }) };
  const handle = createRfqStageHandler({
    getPool: () => pool, readBody: async (req) => req.body, sendJson: (res, status, obj) => { res.status = status; res.json = obj; },
    ensureColumns: async () => {}, loadInvites: async () => [{ id: '11', stage: db.invite.stage_json ? JSON.parse(db.invite.stage_json) : null }],
    publicRfqRequest: (row, invites) => ({ status: row.status, invites }), logRfqEvent: async (_p, _id, type, payload) => { db.events.push({ type, payload }); },
    auditKind: () => null,
  });
  const act = async (actor, action) => { const res = {}; await handle({ body: { actor, action, state: 'NJ' } }, res, 7, 11); return res; };
  return { db, act };
}

describe('accept the original after a declined counter (staged cash)', () => {
  it('locks the original out-the-door price and puts the desk back in the running', async () => {
    const w = world();
    const res = await w.act('buyer', { type: 'accept_otd' });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.stage.otd.status, 'locked');
    assert.equal(res.json.stage.otd.amount, 43749);
    assert.equal(w.db.invite.status, 'quoted');
    assert.equal(w.db.quotes[0].superseded_at, null, 'the original quote is live again');
    assert.equal(w.db.commits, 1);
    assert.ok(w.db.events.some((e) => e.payload.counterDeclinedOriginal === true));
  });
  it('a later step on the reopened desk works like any other desk', async () => {
    const w = world();
    await w.act('buyer', { type: 'accept_otd' });
    const again = await w.act('buyer', { type: 'skip_trade' });
    // The stage rules answer (this deal has no trade step), not "no longer in the running".
    assert.notEqual(again.json.code, 'closed', JSON.stringify(again.json));
  });
  it('a dealer who declined the whole request (no counter on file) is still refused', async () => {
    const w = world({ counter: false, original: false });
    const res = await w.act('buyer', { type: 'accept_otd' });
    assert.equal(res.status, 409); assert.equal(res.json.code, 'closed');
    assert.equal(w.db.invite.status, 'declined');
  });
  it('a counter with no original quote on file is refused', async () => {
    const res = await world({ original: false }).act('buyer', { type: 'accept_otd' });
    assert.equal(res.status, 409);
  });
  it('only the buyer accepting the OTD reopens it: other actions and the dealer stay refused', async () => {
    for (const [actor, action] of [['buyer', { type: 'walk' }], ['buyer', { type: 'skip_trade' }], ['dealer', { type: 'accept_otd' }]]) {
      const w = world();
      const res = await w.act(actor, action);
      assert.equal(res.status, 409, `${actor} ${action.type}`);
      assert.equal(w.db.invite.status, 'declined');
      assert.equal(w.db.quotes[0].superseded_at !== null, true);
    }
  });
  it('an expired original cannot be accepted, and nothing is written', async () => {
    const w = world({ expires: PAST });
    const res = await w.act('buyer', { type: 'accept_otd' });
    assert.equal(res.status, 409); assert.equal(res.json.code, 'expired');
    assert.equal(w.db.invite.status, 'declined'); assert.equal(w.db.commits, 0);
  });
  it('rolls back, leaving the desk declined, if the desk changed under the buyer', async () => {
    const w = world({ raceOnReopen: true });
    const res = await w.act('buyer', { type: 'accept_otd' });
    assert.equal(res.status, 409); assert.equal(res.json.code, 'stale');
    assert.equal(w.db.rollbacks, 1); assert.equal(w.db.commits, 0);
    assert.ok(w.db.quotes[0].superseded_at, 'the original stays superseded');
  });
  it('an ordinary quoted desk is untouched by the change', async () => {
    const w = world({ status: 'quoted', counter: false, original: false, liveQuote: true });
    const res = await w.act('buyer', { type: 'accept_otd' });
    assert.equal(res.status, 200); assert.equal(res.json.stage.otd.amount, 42749);
    assert.ok(!w.db.events.some((e) => e.payload.counterDeclinedOriginal));
  });
});
