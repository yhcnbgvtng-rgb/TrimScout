// The deals-box side of "buyer accepted another dealer": the not-selected bookkeeping handler against an in-memory fake of
// the tables it touches (the SQL itself is only exercised on the box: see the deploy checklist), the closed-quote refusal
// in the stage handler, and the box patch script: applies to the repo mirror, twice, and after the trade-in patch.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRfqNotSelectedHandler } from '../../scrapers/lightsail-crawler/src/rfqNotSelected.js';
import { createRfqStageHandler } from '../../scrapers/lightsail-crawler/src/rfqStages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', '..', 'scrapers', 'lightsail-crawler', 'src');
const MIRROR = path.join(SRC, 'deals_api_server.js');

function world({ winnerStage = null, picked = false } = {}) {
  const db = {
    rfq: { id: 7, status: picked ? 'picked' : 'collecting', picked_quote_id: picked ? 99 : null, approval_status: 'approved', quote_prefs_json: JSON.stringify({ quoteType: 'cash', staged: true, cash: { zip: '07030' } }) },
    invites: {
      11: { id: 11, rfq_id: 7, dealer_name: 'Winner', status: 'quoted', stage_json: winnerStage, not_selected_at: null, not_selected_notice_claimed_at: null, not_selected_notice_sent_at: null },
      12: { id: 12, rfq_id: 7, dealer_name: 'Loser', status: 'quoted', stage_json: null, not_selected_at: null, not_selected_notice_claimed_at: null, not_selected_notice_sent_at: null },
    },
    quotes: { 99: { id: 99, invite_id: 11 } }, events: [], now: Date.now(),
  };
  const q = async (sql, args = []) => {
    if (/FROM rfq_requests WHERE id/.test(sql)) return [[db.rfq]];
    if (/FROM rfq_invites WHERE id/.test(sql)) return [[db.invites[args[0]]].filter(Boolean)];
    if (/SELECT invite_id FROM rfq_quotes/.test(sql)) return [[db.quotes[args[0]]].filter(Boolean)];
    const inv = db.invites[args[0]];
    if (/SET not_selected_at = NOW\(\)/.test(sql)) { if (inv.not_selected_at) return [{ affectedRows: 0 }]; inv.not_selected_at = db.now; return [{ affectedRows: 1 }]; }
    if (/SET not_selected_notice_claimed_at = NOW\(\)/.test(sql)) {
      const free = inv.not_selected_at && !inv.not_selected_notice_sent_at && (inv.not_selected_notice_claimed_at == null || inv.not_selected_notice_claimed_at < db.now - 10 * 60000);
      if (!free) return [{ affectedRows: 0 }];
      inv.not_selected_notice_claimed_at = db.now; return [{ affectedRows: 1 }];
    }
    if (/SET not_selected_notice_sent_at = NOW\(\)/.test(sql)) { if (inv.not_selected_notice_sent_at) return [{ affectedRows: 0 }]; inv.not_selected_notice_sent_at = db.now; return [{ affectedRows: 1 }]; }
    if (/SET not_selected_notice_claimed_at = NULL/.test(sql)) { if (inv.not_selected_notice_sent_at) return [{ affectedRows: 0 }]; inv.not_selected_notice_claimed_at = null; return [{ affectedRows: 1 }]; }
    throw new Error('unexpected sql: ' + sql);
  };
  const pool = { query: q };
  const handle = createRfqNotSelectedHandler({
    getPool: () => pool, readBody: async (req) => req.body, sendJson: (res, status, obj) => { res.status = status; res.json = obj; },
    ensureColumns: async () => {}, logRfqEvent: async (_p, _id, type, payload) => { db.events.push({ type, payload }); },
  });
  const call = async (inviteId, step) => { const res = {}; await handle({ body: { step } }, res, 7, inviteId); return res; };
  return { db, call };
}

describe('not-selected bookkeeping', () => {
  it('close is idempotent and logs once; the accepted dealer can never be closed (picked quote, or locked staged OTD)', async () => {
    const w = world();
    assert.equal((await w.call(12, 'close')).status, 200);
    const first = w.db.invites[12].not_selected_at;
    assert.ok(first);
    assert.equal((await w.call(12, 'close')).status, 200);
    assert.equal(w.db.events.length, 1);
    const picked = world({ picked: true });
    const r = await picked.call(11, 'close');
    assert.equal(r.status, 409); assert.equal(r.json.code, 'accepted');
    const staged = world({ winnerStage: JSON.stringify({ stage: 'trade', otd: { status: 'locked', amount: 40000 } }) });
    assert.equal((await staged.call(11, 'close')).json.code, 'accepted');
    assert.equal(staged.db.invites[11].not_selected_at, null);
  });
  it('claim is exclusive: one caller wins, the rest get claimed:false; it needs a closed quote first', async () => {
    const w = world();
    assert.equal((await w.call(12, 'claim')).status, 409);
    await w.call(12, 'close');
    const results = await Promise.all([w.call(12, 'claim'), w.call(12, 'claim'), w.call(12, 'claim')]);
    assert.equal(results.filter((r) => r.json.claimed).length, 1);
  });
  it('after sent it is never claimable again; after release (failed send) it is claimable once more', async () => {
    const w = world();
    await w.call(12, 'close');
    assert.equal((await w.call(12, 'claim')).json.claimed, true);
    await w.call(12, 'release');
    assert.equal((await w.call(12, 'claim')).json.claimed, true);
    await w.call(12, 'sent');
    assert.equal((await w.call(12, 'claim')).json.claimed, false);
    await w.call(12, 'release');
    assert.equal((await w.call(12, 'claim')).json.claimed, false, 'release cannot undo a sent stamp');
  });
  it('a claim from a sender that died is taken over after the lease (10 minutes)', async () => {
    const w = world();
    await w.call(12, 'close');
    assert.equal((await w.call(12, 'claim')).json.claimed, true);
    assert.equal((await w.call(12, 'claim')).json.claimed, false);
    w.db.now += 11 * 60000;
    assert.equal((await w.call(12, 'claim')).json.claimed, true);
  });
  it('rejects unknown steps and unknown invites', async () => {
    const w = world();
    assert.equal((await w.call(12, 'nope')).status, 400);
    assert.equal((await w.call(99, 'close')).status, 404);
  });
});

describe('a closed quote cannot move on the stage endpoint (except walking away)', () => {
  const FUTURE = new Date(Date.now() + 86400000).toISOString();
  const run = async (action) => {
    const invite = { id: 11, rfq_id: 7, status: 'quoted', dealer_name: 'Loser', stage_json: null, not_selected_at: '2026-10-12T00:00:00Z' };
    const q = async (sql) => {
      if (/FROM rfq_requests WHERE id/.test(sql)) return [[{ id: 7, status: 'collecting', approval_status: 'approved', quote_prefs_json: JSON.stringify({ quoteType: 'cash', staged: true, cash: {} }), trade_in_json: null }]];
      if (/FROM rfq_invites WHERE id/.test(sql)) return [[invite]];
      if (/FROM rfq_quotes WHERE invite_id/.test(sql)) return [[{ id: 99, invite_id: 11, superseded_at: null, expires_at: FUTURE, used_json: JSON.stringify({ kind: 'cash', sellingPrice: 40000, addOns: [], rebates: [], dueAtSigning: [] }) }]];
      if (/UPDATE rfq_invites SET stage_json/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error('unexpected sql: ' + sql);
    };
    const pool = { query: q, getConnection: async () => ({ query: q, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} }) };
    const handle = createRfqStageHandler({ getPool: () => pool, readBody: async (r) => r.body, sendJson: (res, s, o) => { res.status = s; res.json = o; }, ensureColumns: async () => {}, loadInvites: async () => [], publicRfqRequest: () => ({}), logRfqEvent: async () => {}, auditKind: () => null });
    const res = {}; await handle({ body: { actor: 'buyer', action } }, res, 7, 11); return res;
  };
  it('accepting the OTD on a closed quote is refused', async () => {
    const r = await run({ type: 'accept_otd' });
    assert.equal(r.status, 409); assert.equal(r.json.code, 'closed');
  });
  it('walking away is still possible', async () => {
    assert.equal((await run({ type: 'walk' })).status, 200);
  });
});

describe('the box patch', () => {
  const PATCH = path.join(here, '2026-10-12-rfq-not-selected.sh');
  const TRADE = path.join(here, '2026-10-08-rfq-trade-in.sh');
  const apply = (script, file) => execFileSync('bash', [script], { env: { ...process.env, TEST_ONLY: '1', FILE: file }, encoding: 'utf8' });
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notsel-'));

  it('the repo mirror already has it, and re-applying changes nothing', () => {
    const copy = path.join(tmp(), 's.js'); fs.copyFileSync(MIRROR, copy);
    const out = apply(PATCH, copy);
    assert.match(out, /applied: nothing \(already present\)/);
    assert.equal(fs.readFileSync(copy, 'utf8'), fs.readFileSync(MIRROR, 'utf8'));
    assert.match(fs.readFileSync(MIRROR, 'utf8'), /\/not-selected\$\//);
  });
  it('applies after the trade-in patch, relaxes the trade endpoints for the accepted dealer only, and is idempotent', () => {
    const base = fs.readFileSync(MIRROR, 'utf8');
    assert.doesNotMatch(base, /handleRfqTradeIn/, 'the mirror carries no trade-in code: the patch must cope');
    const copy = path.join(tmp(), 's.js'); fs.writeFileSync(copy, base);
    apply(TRADE, copy);
    const once = apply(PATCH, copy);
    assert.match(once, /trade attach after pick/); assert.match(once, /trade appraisal after pick/);
    const patched = fs.readFileSync(copy, 'utf8');
    assert.match(patched, /TRADE_AFTER_ACCEPT/);
    assert.match(patched, /rows\[0\]\.not_selected_at\) return \{ error: \[409, "The buyer chose another dealer"\] \}/);
    assert.match(patched, /picked_quote_id != null \? await pool\.query\("SELECT invite_id FROM rfq_quotes/);
    assert.match(apply(PATCH, copy), /applied: nothing \(already present\)/);
    assert.equal(fs.readFileSync(copy, 'utf8'), patched);
  });
  it('refuses a server that has no stage patch, naming the fix', () => {
    const copy = path.join(tmp(), 's.js'); fs.writeFileSync(copy, fs.readFileSync(MIRROR, 'utf8').replaceAll('createRfqStageHandler', 'createOtherHandler').replaceAll('createRfqNotSelectedHandler', 'createOtherHandler2'));
    assert.throws(() => execFileSync('bash', [PATCH], { env: { ...process.env, TEST_ONLY: '1', FILE: copy }, encoding: 'utf8', stdio: 'pipe' }), /2026-10-11-rfq-deal-stages\.sh first/);
  });
});
