// The staged Cash / Finance HTTP handler (src/rfqStages.js) against an in-memory fake of the three tables it touches,
// plus the box patch script: it must apply cleanly to the repo mirror, twice (idempotent), and the mirror already has it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRfqStageHandler } from '../src/rfqStages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');
const PATCH = path.join(here, '..', '..', '..', 'scripts', 'box', '2026-10-11-rfq-deal-stages.sh');

const cashQuote = { kind: 'cash', sellingPrice: 40000, addOns: [], rebates: [], dueAtSigning: [{ name: 'Sales tax', amount: 2650 }, { name: 'Doc fee', amount: 799 }, { name: 'Title & registration', amount: 300 }] };
const OTD = 43749;
const FUTURE = new Date(Date.now() + 86400000).toISOString();

function world({ staged = true, tradeInExpected = true, tradeOnFile = true, quote = cashQuote, inviteStatus = 'quoted', rfqStatus = 'collecting', approval = 'approved' } = {}) {
  const db = {
    rfq: { id: 7, status: rfqStatus, approval_status: approval, quote_prefs_json: JSON.stringify(staged ? { quoteType: 'cash', staged: true, cash: { zip: '07030' } } : { quoteType: 'cash', cash: { zip: '07030' } }), trade_in_expected: tradeInExpected ? 1 : 0, trade_in_json: tradeOnFile ? '{"vin":"X"}' : null, picked_quote_id: null },
    invite: { id: 11, rfq_id: 7, status: inviteStatus, dealer_name: 'Test Motors', stage_json: null },
    quote: quote ? { id: 99, invite_id: 11, superseded_at: null, expires_at: FUTURE, used_json: JSON.stringify(quote) } : null,
    events: [], commits: 0, rollbacks: 0,
  };
  const q = async (sql, args = []) => {
    if (/FROM rfq_requests WHERE id/.test(sql)) return [[db.rfq]];
    if (/FROM rfq_invites WHERE id/.test(sql)) return [[db.invite]];
    if (/FROM rfq_quotes WHERE invite_id/.test(sql)) return [db.quote ? [db.quote] : []];
    if (/UPDATE rfq_invites SET stage_json/.test(sql)) {
      const [next, , , prev] = args;
      if (db.beforeWrite) { const f = db.beforeWrite; db.beforeWrite = null; f(); }
      if ((db.invite.stage_json ?? null) !== (prev ?? null)) return [{ affectedRows: 0 }];
      db.invite.stage_json = next; return [{ affectedRows: 1 }];
    }
    if (/UPDATE rfq_requests SET status = 'picked'/.test(sql)) { db.rfq.status = 'picked'; db.rfq.picked_quote_id = args[0]; return [{ affectedRows: 1 }]; }
    throw new Error('unexpected sql: ' + sql);
  };
  const pool = { query: q, getConnection: async () => ({ query: q, beginTransaction: async () => {}, commit: async () => { db.commits++; }, rollback: async () => { db.rollbacks++; }, release: () => {} }) };
  const handle = createRfqStageHandler({
    getPool: () => pool, readBody: async (req) => req.body, sendJson: (res, status, obj) => { res.status = status; res.json = obj; },
    ensureColumns: async () => {}, loadInvites: async () => [{ id: '11', stage: db.invite.stage_json ? JSON.parse(db.invite.stage_json) : null }],
    publicRfqRequest: (row, invites) => ({ status: row.status, invites }), logRfqEvent: async (_p, _id, type, payload) => { db.events.push({ type, payload }); },
    auditKind: (req) => req.audit || null,
  });
  const call = async (body, audit) => { const res = {}; await handle({ body, audit }, res, 7, 11); return res; };
  const act = (actor, action, extra = {}) => call({ actor, action, state: 'NJ', ...extra });
  return { db, call, act };
}

describe('handler: full cash path with a trade', () => {
  it('walks OTD -> trade -> cash and closes the request with the picked quote', async () => {
    const w = world();
    let r = await w.act('buyer', { type: 'accept_otd' });
    assert.equal(r.status, 200); assert.equal(r.json.stage.otd.amount, OTD); assert.equal(r.json.stage.stage, 'trade');
    r = await w.act('dealer', { type: 'trade_offer', value: 9000 });
    assert.equal(r.status, 200);
    r = await w.act('buyer', { type: 'trade_accept' });
    assert.equal(r.json.stage.trueOtd, OTD - 9000);
    assert.equal(r.json.stage.trade.taxSavings > 0, true);
    r = await w.act('buyer', { type: 'choose_cash' });
    assert.equal(r.json.stage.stage, 'closed');
    assert.equal(w.db.rfq.status, 'picked'); assert.equal(w.db.rfq.picked_quote_id, 99);
    assert.equal(w.db.events.at(-1).type, 'buyer_picked');
    assert.equal(w.db.events.at(-1).payload.method, 'cash');
  });
});

describe('handler: finance close', () => {
  it('request -> dealer quote -> accept closes with finance', async () => {
    const w = world({ tradeInExpected: false });
    await w.act('dealer', { type: 'accept_otd' });
    let r = await w.act('buyer', { type: 'request_finance', downPayment: 4000, outsideFinancing: true });
    assert.equal(r.status, 200);
    r = await w.act('dealer', { type: 'finance_quote', apr: 4.9, termMonths: 60 });
    assert.equal(r.json.stage.payment.financeQuote.amountFinanced, OTD - 4000);
    r = await w.act('buyer', { type: 'finance_accept' });
    assert.equal(r.json.stage.payment.method, 'finance');
    assert.equal(w.db.rfq.status, 'picked');
    assert.equal(w.db.events.at(-1).payload.method, 'finance');
  });
});

describe('handler: gates and errors', () => {
  it('skips trade when no trade-in is expected', async () => {
    const w = world({ tradeInExpected: false });
    const r = await w.act('buyer', { type: 'accept_otd' });
    assert.equal(r.json.stage.stage, 'payment'); assert.equal(r.json.stage.trueOtd, OTD);
  });
  it('refuses payment actions before the OTD locks (409)', async () => {
    const w = world();
    for (const a of [{ type: 'choose_cash' }, { type: 'request_finance', downPayment: 0 }]) {
      const r = await w.act('buyer', a); assert.equal(r.status, 409); assert.equal(r.json.code, 'wrong_stage');
    }
    assert.equal(w.db.invite.stage_json, null);
  });
  it('refuses a trade offer when the buyer has not added the trade', async () => {
    const w = world({ tradeOnFile: false });
    await w.act('buyer', { type: 'accept_otd' });
    const r = await w.act('dealer', { type: 'trade_offer', value: 5000 });
    assert.equal(r.status, 409); assert.equal(r.json.code, 'no_trade');
  });
  it('takes the OTD from the stored quote, ignoring anything the caller sends', async () => {
    const w = world();
    const r = await w.act('buyer', { type: 'accept_otd', amount: 1, otdAmount: 1 }, { otdAmount: 1 });
    assert.equal(r.json.stage.otd.amount, OTD);
  });
  it('wrong-actor and invalid input are rejected with 403 / 400', async () => {
    const w = world();
    await w.act('buyer', { type: 'accept_otd' });
    assert.equal((await w.act('buyer', { type: 'trade_offer', value: 100 })).status, 403);
    assert.equal((await w.act('dealer', { type: 'trade_offer', value: 'abc' })).status, 400);
    assert.equal((await w.call({ actor: 'admin', action: { type: 'walk' } })).status, 400);
    assert.equal((await w.call({ actor: 'buyer' })).status, 400);
  });
  it('no itemized quote, or a countered (superseded) one, cannot be accepted', async () => {
    assert.equal((await world({ quote: null }).act('buyer', { type: 'accept_otd' })).json.code, 'no_quote');
    assert.equal((await world({ inviteStatus: 'invited' }).act('buyer', { type: 'accept_otd' })).json.code, 'no_quote');
  });
  it('an expired quote cannot be accepted', async () => {
    const w = world();
    w.db.quote.expires_at = new Date(Date.now() - 1000).toISOString();
    const r = await w.act('buyer', { type: 'accept_otd' });
    assert.equal(r.status, 409); assert.equal(r.json.code, 'expired');
  });
  it('requests outside the staged flow, unreleased, or already closed are refused', async () => {
    assert.equal((await world({ staged: false }).act('buyer', { type: 'accept_otd' })).json.code, 'not_staged');
    assert.equal((await world({ approval: 'pending' }).act('buyer', { type: 'accept_otd' })).status, 409);
    assert.equal((await world({ rfqStatus: 'picked' }).act('buyer', { type: 'walk' })).json.code, 'closed');
    assert.equal((await world({ inviteStatus: 'declined' }).act('buyer', { type: 'walk' })).json.code, 'closed');
  });
  it('a lost race is a 409 stale, not a silent overwrite', async () => {
    const w = world();
    // Another request moves the deal after we read it and before we write.
    w.db.beforeWrite = () => { w.db.invite.stage_json = JSON.stringify({ moved: true }); };
    const r = await w.act('buyer', { type: 'accept_otd' });
    assert.equal(r.status, 409); assert.equal(r.json.code, 'stale');
    assert.equal(w.db.rollbacks, 1);
    assert.deepEqual(JSON.parse(w.db.invite.stage_json), { moved: true });
  });
});

describe('handler: walk away at every stage', () => {
  for (const [label, steps] of [['otd', []], ['trade', [['buyer', { type: 'accept_otd' }]]], ['payment', [['buyer', { type: 'accept_otd' }], ['dealer', { type: 'trade_offer', value: 5000 }], ['buyer', { type: 'trade_accept' }]]]]) {
    for (const who of ['buyer', 'dealer']) {
      it(`${who} walks at ${label}; the request stays open for other dealers`, async () => {
        const w = world();
        for (const [a, act] of steps) await w.act(a, act);
        const r = await w.act(who, { type: 'walk', reason: 'changed mind' });
        assert.equal(r.status, 200); assert.equal(r.json.stage.stage, 'walked'); assert.equal(r.json.stage.walk.atStage, label);
        assert.equal(w.db.rfq.status, 'collecting');
        assert.equal((await w.act('buyer', { type: 'choose_cash' })).status, 409);
      });
    }
  }
});

describe('handler: scoped audit keys are pinned to their side', () => {
  it('the audit buyer key cannot act as the dealer, and vice versa', async () => {
    const w = world();
    assert.equal((await w.call({ actor: 'dealer', action: { type: 'trade_offer', value: 1 } }, 'audit')).status, 403);
    assert.equal((await w.call({ actor: 'buyer', action: { type: 'accept_otd' } }, 'audit_dealer')).status, 403);
    assert.equal((await w.call({ actor: 'buyer', action: { type: 'accept_otd' } }, 'audit')).status, 200);
  });
});

describe('box patch script', () => {
  const mirror = path.join(SRC, 'deals_api_server.js');
  const run = (file) => execFileSync('bash', [PATCH], { env: { ...process.env, TEST_ONLY: '1', FILE: file }, encoding: 'utf8' });
  it('is already applied to the repo mirror (nothing to do)', () => {
    assert.match(run(mirror), /nothing \(already present\)/);
  });
  it('applies once, then is a no-op, to the pre-patch server text', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stages-'));
    const f = path.join(dir, 'deals_api_server.js');
    const src = fs.readFileSync(mirror, 'utf8')
      .replace(/^import \{ createRfqStageHandler \}.*\n/m, '')
      .replace(/^  await pool\.query\("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS stage_json TEXT NULL"\);\n/m, '')
      .replace(/^    \/\/ Staged Cash.*\n    stage: parseJsonCol.*\n/m, '')
      .replace(/\/\/ POST \/api\/rfqs\/:id\/invites\/:inviteId\/stage[\s\S]*?\}\);\n\n(?=\/\/ POST \/api\/rfqs\/:id\/invites\/:inviteId\/buyer-counter)/, '')
      .replace(/  const rfqInviteStageMatch[\s\S]*?\n  \}\n(?=  const rfqInviteCounterMatch)/, '');
    assert.doesNotMatch(src, /createRfqStageHandler/);
    fs.writeFileSync(f, src);
    assert.match(run(f), /applied: import, column, invite mapper, handler, route/);
    assert.equal(fs.readFileSync(f, 'utf8'), fs.readFileSync(mirror, 'utf8'));
    assert.match(run(f), /nothing \(already present\)/);
  });
});
