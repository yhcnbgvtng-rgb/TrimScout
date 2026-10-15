// The deals-box side of "every dealer quotes the trade with the car; the winner confirms or revises": the handlers against an
// in-memory fake of the tables they touch (the SQL itself is exercised on the box: see the deploy checklist in
// docs/TRADE_QUOTE_CONFIRM.md), and the patch script: applies after the earlier patches, twice, and refuses without them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRfqTradeConfirmHandlers } from '../../scrapers/lightsail-crawler/src/rfqTradeConfirm.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', '..', 'scrapers', 'lightsail-crawler', 'src');
const MIRROR = path.join(SRC, 'deals_api_server.js');

const FUTURE = new Date(Date.now() + 14 * 86400000).toISOString();
const single = (n, over = {}) => ({ allowanceSingle: n, allowanceLow: null, allowanceHigh: null, basis: 'preliminary', goodUntil: FUTURE, payoffUsed: 4000, equityComputed: n - 4000, conditions: 'assumes no frame damage', conditionChips: ['no_frame_damage'], declined: null, ...over });
const decline = (code = 'salvage_title') => ({ allowanceSingle: null, allowanceLow: null, allowanceHigh: null, basis: 'preliminary', goodUntil: FUTURE, payoffUsed: 0, equityComputed: 0, conditions: null, conditionChips: [], declined: { code, note: null } });

function world({ picked = 11, appraisal = single(10000), tradeIn = true, rfqStatus = null } = {}) {
  const db = {
    rfq: { id: 7, status: rfqStatus ?? (picked ? 'picked' : 'collecting'), picked_quote_id: picked ? 99 : null, trade_in_json: tradeIn ? JSON.stringify({ payoffEstimate: 4000 }) : null, deleted_at: null },
    invites: {
      11: { id: 11, rfq_id: 7, dealer_name: 'Winner', status: 'quoted', not_selected_at: null, trade_appraisal_json: appraisal ? JSON.stringify(appraisal) : null, trade_confirmation_json: null },
      12: { id: 12, rfq_id: 7, dealer_name: 'Other', status: 'quoted', not_selected_at: null, trade_appraisal_json: JSON.stringify(single(9000)), trade_confirmation_json: null },
    },
    quotes: { 99: { id: 99, invite_id: 11, expires_at: FUTURE, superseded_at: null }, 98: { id: 98, invite_id: 12, expires_at: FUTURE, superseded_at: null } },
    audit: [], events: [], staleOnce: false,
  };
  const q = async (sql, args = []) => {
    if (/^SELECT \* FROM rfq_requests WHERE id/.test(sql)) return [[db.rfq]];
    if (/^SELECT \* FROM rfq_invites WHERE id = \? AND rfq_id/.test(sql)) return [[db.invites[args[0]]].filter(Boolean)];
    if (/^SELECT \* FROM rfq_invites WHERE rfq_id = \? AND trade_confirmation_json IS NOT NULL/.test(sql)) return [Object.values(db.invites).filter((i) => i.trade_confirmation_json)];
    if (/^SELECT invite_id FROM rfq_quotes WHERE id/.test(sql)) return [[db.quotes[args[0]]].filter(Boolean)];
    if (/^SELECT \* FROM rfq_quotes WHERE invite_id/.test(sql)) return [Object.values(db.quotes).filter((x) => x.invite_id === args[0]).slice(-1)];
    if (/^SELECT \* FROM rfq_trade_audit/.test(sql)) return [db.audit.map((a, i) => ({ id: i + 1, ...a }))];
    if (/^UPDATE rfq_invites SET trade_appraisal_json/.test(sql)) { db.invites[args[1]].trade_appraisal_json = args[0]; return [{ affectedRows: 1 }]; }
    if (/^UPDATE rfq_invites SET trade_confirmation_json/.test(sql)) {
      const inv = db.invites[args[1]];
      if (db.staleOnce) { db.staleOnce = false; return [{ affectedRows: 0 }]; }
      if ((inv.trade_confirmation_json ?? null) !== (args[3] ?? null)) return [{ affectedRows: 0 }];
      inv.trade_confirmation_json = args[0]; return [{ affectedRows: 1 }];
    }
    if (/^UPDATE rfq_requests SET status = 'collecting', picked_quote_id = NULL/.test(sql)) { if (db.rfq.status === 'picked') { db.rfq.status = 'collecting'; db.rfq.picked_quote_id = null; } return [{ affectedRows: 1 }]; }
    if (/^UPDATE rfq_requests SET status = 'walked'/.test(sql)) { if (db.rfq.status === 'picked') db.rfq.status = 'walked'; return [{ affectedRows: 1 }]; }
    if (/^INSERT INTO rfq_trade_audit/.test(sql)) { db.audit.push({ rfq_id: args[0], invite_id: args[1], actor: args[2], action: args[3], from_json: args[4], to_json: args[5], detail_json: args[6], at: args[7] }); return [{ affectedRows: 1 }]; }
    throw new Error('unexpected sql: ' + sql);
  };
  const pool = { query: q, getConnection: async () => ({ query: q, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} }) };
  let kind = null;
  const h = createRfqTradeConfirmHandlers({
    getPool: () => pool, readBody: async (r) => r.body, sendJson: (res, s, o) => { res.status = s; res.json = o; },
    ensureColumns: async () => {}, loadInvites: async () => [], publicRfqRequest: (r) => ({ status: r.status, pickedQuoteId: r.picked_quote_id }),
    logRfqEvent: async (_p, _id, type, payload) => { db.events.push({ type, payload }); }, auditKind: () => kind,
  });
  const call = async (fn, inviteId, body) => { const res = {}; await (inviteId == null ? h[fn]({ body }, res, 7) : h[fn]({ body }, res, 7, inviteId)); return res; };
  const appraise = (inviteId, appraisal, extra = {}) => call('handleTradeAppraisal', inviteId, { appraisal, ...extra });
  const act = (inviteId, actor, action, config = {}) => call('handleTradeConfirmation', inviteId, { actor, action, config });
  const conf = (inviteId = 11) => JSON.parse(db.invites[inviteId].trade_confirmation_json);
  const setKind = (k) => { kind = k; };
  return { db, appraise, act, conf, call, setKind };
}

describe('the allowance on a quote', () => {
  it('refuses an allowance that is zero, negative, missing, or both single and range', async () => {
    const w = world({ picked: null, appraisal: null });
    for (const bad of [single(0), single(-5), single(null), { ...single(9000), allowanceLow: 8000, allowanceHigh: 9000 }, { ...single(9000), basis: 'maybe' }, { ...single(9000), goodUntil: 'soon' }]) {
      assert.equal((await w.appraise(11, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await w.appraise(11, undefined)).status, 400);
    assert.equal(w.db.audit.length, 0);
  });
  it('stores a single number or a range, with chips, and writes an audit row per change', async () => {
    const w = world({ picked: null, appraisal: null });
    assert.equal((await w.appraise(11, single(10000))).status, 200);
    assert.equal((await w.appraise(11, { ...single(null), allowanceSingle: null, allowanceLow: 9000, allowanceHigh: 11000 })).status, 200);
    assert.deepEqual(w.db.audit.map((a) => a.action), ['appraisal_set', 'appraisal_updated']);
    const second = w.db.audit[1];
    assert.deepEqual(JSON.parse(second.from_json), { single: 10000, low: null, high: null, basis: 'preliminary' });
    assert.deepEqual(JSON.parse(second.to_json), { single: null, low: 9000, high: 11000, basis: 'preliminary' });
    assert.equal(second.actor, 'dealer'); assert.ok(second.at instanceof Date);
  });
  it("records 'can't quote this trade' with a code, refuses an unknown code, and audits it", async () => {
    const w = world({ picked: null, appraisal: null });
    assert.equal((await w.appraise(11, { ...decline(), declined: { code: 'because', note: null } })).status, 400);
    assert.equal((await w.appraise(11, { ...decline('other'), declined: { code: 'other', note: '' } })).status, 400);
    assert.equal((await w.appraise(11, decline('wrong_brand_mix'))).status, 200);
    assert.equal(w.db.audit[0].action, 'trade_declined');
  });
  it('reconfirm stamps reconfirmedAt, keeps the number, and is audited; a decline cannot be reconfirmed', async () => {
    const w = world({ picked: null, appraisal: single(10000) });
    assert.equal((await w.appraise(11, undefined, { reconfirm: true })).status, 200);
    const a = JSON.parse(w.db.invites[11].trade_appraisal_json);
    assert.equal(a.allowanceSingle, 10000); assert.ok(a.reconfirmedAt);
    assert.equal(w.db.audit[0].action, 'appraisal_reconfirmed');
    const d = world({ picked: null, appraisal: decline() });
    assert.equal((await d.appraise(11, undefined, { reconfirm: true })).status, 409);
  });
  it('is refused on a request with no trade, for a closed (not selected) desk, and after the buyer picked someone else', async () => {
    assert.equal((await world({ picked: null, tradeIn: false }).appraise(11, single(9000))).status, 409);
    const closed = world({ picked: null }); closed.db.invites[11].not_selected_at = new Date();
    assert.equal((await closed.appraise(11, single(9000))).status, 409);
    const lost = world({ picked: 11 });
    assert.equal((await lost.appraise(12, single(9000))).status, 409, 'only the picked desk may still give a number');
  });
  it('locks once the confirm step exists: the picked desk must confirm or revise instead', async () => {
    const w = world();
    await w.act(11, 'buyer', { type: 'open' });
    const r = await w.appraise(11, single(9500));
    assert.equal(r.status, 409); assert.equal(r.json.code, 'locked');
  });
});

describe('opening the confirm step after the buyer selects', () => {
  it('opens for the picked desk with the configured deadline, once', async () => {
    const w = world();
    const r = await w.act(11, 'buyer', { type: 'open' }, { deadlineHours: 48 });
    assert.equal(r.status, 200); assert.equal(r.json.confirmation.status, 'pending'); assert.equal(r.json.confirmation.allowancePrelim, 10000);
    const hours = (new Date(r.json.confirmation.deadlineAt) - new Date(r.json.confirmation.requestedAt)) / 3600000;
    assert.equal(hours, 48);
    const again = await w.act(11, 'buyer', { type: 'open' });
    assert.equal(again.status, 200); assert.equal(again.json.already, true);
    assert.equal(w.db.audit.filter((a) => a.action === 'confirmation_opened').length, 1);
  });
  it('defaults to 24 hours', async () => {
    const w = world();
    const r = await w.act(11, 'buyer', { type: 'open' });
    assert.equal((new Date(r.json.confirmation.deadlineAt) - new Date(r.json.confirmation.requestedAt)) / 3600000, 24);
  });
  it('has nothing to confirm when the picked desk declined the trade, gave no number, or is not the picked desk', async () => {
    assert.equal((await world({ appraisal: decline() }).act(11, 'buyer', { type: 'open' })).json.code, 'not_required');
    assert.equal((await world({ appraisal: null }).act(11, 'buyer', { type: 'open' })).json.code, 'not_required');
    assert.equal((await world().act(12, 'buyer', { type: 'open' })).json.code, 'not_selected_desk');
    assert.equal((await world({ picked: null }).act(11, 'buyer', { type: 'open' })).status, 409, 'nothing is picked yet');
  });
  it('is permission-checked per actor: a dealer cannot open, a buyer cannot confirm', async () => {
    const w = world();
    assert.equal((await w.act(11, 'dealer', { type: 'open' })).status, 403);
    await w.act(11, 'buyer', { type: 'open' });
    assert.equal((await w.act(11, 'buyer', { type: 'confirm' })).status, 403);
    assert.equal((await w.act(11, 'dealer', { type: 'accept_revised' })).status, 403);
    assert.equal((await w.act(11, 'dealer', { type: 'go_back' })).status, 403);
    assert.equal((await w.act(11, 'nobody', { type: 'confirm' })).status, 400);
  });
  it('scoped audit keys stay on their own side', async () => {
    const w = world();
    w.setKind('audit');
    assert.equal((await w.act(11, 'dealer', { type: 'confirm' })).status, 403);
    w.setKind('audit_dealer');
    assert.equal((await w.act(11, 'buyer', { type: 'open' })).status, 403);
  });
});

describe('confirm as quoted', () => {
  it('confirms in one call, stamps the time, audits, and refuses a second answer', async () => {
    const w = world(); await w.act(11, 'buyer', { type: 'open' });
    const r = await w.act(11, 'dealer', { type: 'confirm' });
    assert.equal(r.status, 200); assert.equal(w.conf().status, 'confirmed'); assert.equal(w.conf().allowanceFinal, 10000); assert.equal(w.conf().confirmedWithinDeadline, true);
    assert.equal(w.db.rfq.status, 'picked');
    assert.equal(w.db.audit.at(-1).action, 'allowance_confirmed');
    assert.equal((await w.act(11, 'dealer', { type: 'revise', allowance: 9000, reasonCode: 'inspection_finding' })).status, 409);
  });
  it('a range needs a single number inside it', async () => {
    const w = world({ appraisal: { ...single(null), allowanceSingle: null, allowanceLow: 9000, allowanceHigh: 11000 } }); await w.act(11, 'buyer', { type: 'open' });
    assert.equal((await w.act(11, 'dealer', { type: 'confirm' })).status, 422);
    assert.equal((await w.act(11, 'dealer', { type: 'confirm', allowance: 12000 })).status, 422);
    assert.equal((await w.act(11, 'dealer', { type: 'confirm', allowance: 9400 })).status, 200);
    assert.equal(w.conf().allowanceFinal, 9400);
  });
});

describe('revising, the guardrail, and the buyer\'s answer', () => {
  it('a small revision waits for the buyer; the dealer\'s original appraisal is untouched', async () => {
    const w = world(); await w.act(11, 'buyer', { type: 'open' });
    const r = await w.act(11, 'dealer', { type: 'revise', allowance: 9500, reasonCode: 'inspection_finding', reasonText: 'Curb rash' });
    assert.equal(r.status, 200); assert.equal(w.conf().status, 'revised'); assert.equal(w.conf().revisionDelta, -500); assert.equal(w.conf().revisionFlagged, false);
    assert.equal(JSON.parse(w.db.invites[11].trade_appraisal_json).allowanceSingle, 10000);
    const a = w.db.audit.at(-1);
    assert.equal(a.action, 'allowance_revised'); assert.equal(JSON.parse(a.detail_json).reasonCode, 'inspection_finding');
  });
  it('a reason is required', async () => {
    const w = world(); await w.act(11, 'buyer', { type: 'open' });
    assert.equal((await w.act(11, 'dealer', { type: 'revise', allowance: 9500 })).status, 422);
    assert.equal(w.conf().status, 'pending');
  });
  it('a big uncited drop needs 20+ characters and is flagged; the threshold comes from the request config', async () => {
    const w = world(); await w.act(11, 'buyer', { type: 'open' });
    assert.equal((await w.act(11, 'dealer', { type: 'revise', allowance: 8000, reasonCode: 'inspection_finding' })).status, 422);
    assert.equal((await w.act(11, 'dealer', { type: 'revise', allowance: 8000, reasonCode: 'inspection_finding', reasonText: 'Transmission slips in third gear.' })).status, 200);
    assert.equal(w.conf().revisionFlagged, true);
    const lenient = world(); await lenient.act(11, 'buyer', { type: 'open' });
    assert.equal((await lenient.act(11, 'dealer', { type: 'revise', allowance: 8000, reasonCode: 'inspection_finding' }, { thresholdPct: 25 })).status, 200);
    assert.equal(lenient.conf().revisionFlagged, false);
  });
  it('citing an original condition lifts the requirement; a firm quote is flagged as a breach', async () => {
    const w = world({ appraisal: single(10000, { basis: 'firm' }) }); await w.act(11, 'buyer', { type: 'open' });
    assert.equal((await w.act(11, 'dealer', { type: 'revise', allowance: 8000, reasonCode: 'inspection_finding', citedConditions: ['no_frame_damage'] })).status, 200);
    assert.equal(w.conf().revisionFlagged, false); assert.equal(w.conf().firmBreach, true);
  });
  it('accepting the revision settles it and leaves the request picked', async () => {
    const w = world(); await w.act(11, 'buyer', { type: 'open' });
    await w.act(11, 'dealer', { type: 'revise', allowance: 9500, reasonCode: 'payoff_changed' });
    const r = await w.act(11, 'buyer', { type: 'accept_revised' });
    assert.equal(r.status, 200); assert.equal(w.conf().buyerDecision, 'accepted'); assert.equal(w.db.rfq.status, 'picked');
  });
  it('going back reopens the compare: the request is collecting again, nobody else changed, the desk stays "revised"', async () => {
    const w = world(); await w.act(11, 'buyer', { type: 'open' });
    await w.act(11, 'dealer', { type: 'revise', allowance: 9500, reasonCode: 'payoff_changed' });
    const other = w.db.invites[12].trade_appraisal_json;
    const r = await w.act(11, 'buyer', { type: 'go_back' });
    assert.equal(r.status, 200); assert.equal(w.db.rfq.status, 'collecting'); assert.equal(w.db.rfq.picked_quote_id, null);
    assert.equal(w.conf().status, 'revised'); assert.equal(w.conf().buyerDecision, 'went_back');
    assert.equal(w.db.invites[12].trade_appraisal_json, other, 'other dealers\' original numbers are intact');
    assert.equal(w.db.invites[12].not_selected_at, null, 'and nobody was closed out');
    assert.equal(JSON.parse(w.db.invites[11].trade_appraisal_json).allowanceSingle, 10000, 'the revising desk\'s own quoted number stands for the compare');
  });
  it('re-selecting that desk puts the revision in front of the buyer again, without asking the dealer twice', async () => {
    const w = world(); await w.act(11, 'buyer', { type: 'open' });
    await w.act(11, 'dealer', { type: 'revise', allowance: 9500, reasonCode: 'payoff_changed' });
    await w.act(11, 'buyer', { type: 'go_back' });
    w.db.rfq.status = 'picked'; w.db.rfq.picked_quote_id = 99; // the buyer picks them again
    const r = await w.act(11, 'buyer', { type: 'open' });
    assert.equal(r.status, 200); assert.equal(w.conf().status, 'revised'); assert.equal(w.conf().buyerDecision, null);
    assert.equal((await w.act(11, 'buyer', { type: 'accept_revised' })).status, 200);
  });
  it('going back is only possible from a revision', async () => {
    const w = world(); await w.act(11, 'buyer', { type: 'open' });
    assert.equal((await w.act(11, 'buyer', { type: 'go_back' })).status, 409);
    assert.equal(w.db.rfq.status, 'picked');
  });
  it('the buyer can always walk away, while the dealer is still deciding and while a revision waits', async () => {
    const a = world(); await a.act(11, 'buyer', { type: 'open' });
    assert.equal((await a.act(11, 'buyer', { type: 'walk' })).status, 200); assert.equal(a.db.rfq.status, 'walked');
    const b = world(); await b.act(11, 'buyer', { type: 'open' });
    await b.act(11, 'dealer', { type: 'revise', allowance: 5000, reasonCode: 'other', reasonText: 'The car does not match the photos at all.' });
    assert.equal((await b.act(11, 'buyer', { type: 'walk' })).status, 200); assert.equal(b.db.rfq.status, 'walked');
  });
  it('an answer after the buyer walked or went back is refused as closed', async () => {
    const w = world(); await w.act(11, 'buyer', { type: 'open' });
    await w.act(11, 'buyer', { type: 'walk' });
    assert.equal((await w.act(11, 'dealer', { type: 'confirm' })).status, 409);
  });
  it('a concurrent write is a stale 409, not a lost update', async () => {
    const w = world(); await w.act(11, 'buyer', { type: 'open' });
    w.db.staleOnce = true;
    const r = await w.act(11, 'dealer', { type: 'confirm' });
    assert.equal(r.status, 409); assert.equal(r.json.code, 'stale'); assert.equal(w.conf().status, 'pending');
  });
});

describe('the deadline', () => {
  const lapse = (w, id = 11) => { const c = w.conf(id); c.deadlineAt = new Date(Date.now() - 3600000).toISOString(); c.requestedAt = new Date(Date.now() - 25 * 3600000).toISOString(); w.db.invites[id].trade_confirmation_json = JSON.stringify(c); };
  it('after it passes the dealer can no longer act and the sweep leaves the original number standing', async () => {
    const w = world(); await w.act(11, 'buyer', { type: 'open' }); lapse(w);
    assert.equal((await w.act(11, 'dealer', { type: 'confirm' })).status, 409);
    const r = await w.call('handleTradeConfirmSweep', null, {});
    assert.deepEqual(r.json.expiredInviteIds, ['11']);
    assert.equal(w.conf().status, 'expired'); assert.equal(w.conf().allowanceFinal, 10000); assert.equal(w.conf().confirmedWithinDeadline, false);
    assert.equal(w.db.audit.at(-1).action, 'allowance_defaulted_at_deadline');
    const again = await w.call('handleTradeConfirmSweep', null, {});
    assert.deepEqual(again.json.expiredInviteIds, [], 'idempotent');
  });
  it('does not touch a desk whose deadline has not passed or that already answered', async () => {
    const w = world(); await w.act(11, 'buyer', { type: 'open' });
    assert.deepEqual((await w.call('handleTradeConfirmSweep', null, {})).json.expiredInviteIds, []);
    await w.act(11, 'dealer', { type: 'confirm' }); lapse(w);
    assert.deepEqual((await w.call('handleTradeConfirmSweep', null, {})).json.expiredInviteIds, []);
  });
});

describe('the audit log', () => {
  it('lists every allowance change in order with actor and time', async () => {
    const w = world({ picked: null, appraisal: null });
    await w.appraise(11, single(10000));
    w.db.rfq.status = 'picked'; w.db.rfq.picked_quote_id = 99;
    await w.act(11, 'buyer', { type: 'open' });
    await w.act(11, 'dealer', { type: 'revise', allowance: 9500, reasonCode: 'payoff_changed' });
    await w.act(11, 'buyer', { type: 'accept_revised' });
    const r = await w.call('handleTradeAudit', null, undefined);
    assert.deepEqual(r.json.audit.map((a) => [a.actor, a.action]), [['dealer', 'appraisal_set'], ['buyer', 'confirmation_opened'], ['dealer', 'allowance_revised'], ['buyer', 'revision_accepted']]);
    assert.ok(r.json.audit.every((a) => a.at && a.rfqId === '7'));
  });
});

describe('the box patch', () => {
  const PATCH = path.join(here, '2026-10-16-rfq-trade-confirm.sh');
  const TRADE = path.join(here, '2026-10-08-rfq-trade-in.sh');
  const env = (file) => ({ ...process.env, TEST_ONLY: '1', FILE: file, SRC_LOCAL: SRC });
  const apply = (script, file) => execFileSync('bash', [script], { env: env(file), encoding: 'utf8' });
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tradeconf-'));
  const prepared = () => { const copy = path.join(tmp(), 's.js'); fs.copyFileSync(MIRROR, copy); apply(TRADE, copy); return copy; };

  it('refuses to run without the trade-in patch, and changes nothing', () => {
    const copy = path.join(tmp(), 's.js'); fs.copyFileSync(MIRROR, copy);
    const r = spawnSync('bash', [PATCH], { env: env(copy), encoding: 'utf8' });
    assert.notEqual(r.status, 0); assert.match(r.stdout, /MISSING: 2026-10-08-rfq-trade-in\.sh/);
    assert.equal(fs.readFileSync(copy, 'utf8'), fs.readFileSync(MIRROR, 'utf8'));
  });
  it('applies after the trade-in patch, wires the routes ahead of the old appraisal route, and is idempotent', () => {
    const copy = prepared();
    assert.match(apply(PATCH, copy), /applied: import, columns, invite mapper, handlers, routes, quote needs a trade answer/);
    const patched = fs.readFileSync(copy, 'utf8');
    for (const needle of ['trade_confirmation_json TEXT NULL', 'CREATE TABLE IF NOT EXISTS rfq_trade_audit', 'tradeConfirmation: parseJsonCol(row.trade_confirmation_json)', 'createRfqTradeConfirmHandlers({', 'trade-appraisal|trade-confirmation', 'trade-confirmations\\/sweep', 'trade-audit', 'code: "trade_allowance_required"']) assert.ok(patched.includes(needle), needle);
    assert.ok(patched.indexOf('rfqTradeAppraisalV2Match') < patched.indexOf('const rfqTradeInMatch'), 'matched before the 2026-10-08 route');
    const before = patched;
    assert.match(apply(PATCH, copy), /applied: nothing \(already present\)/);
    assert.equal(fs.readFileSync(copy, 'utf8'), before);
  });
  it('the quote handler asks for the trade answer only when the request has a trade', () => {
    const copy = prepared(); apply(PATCH, copy);
    const patched = fs.readFileSync(copy, 'utf8');
    const guard = patched.indexOf('if (rfqRows[0].trade_in_json) {');
    assert.ok(guard > patched.indexOf('async function handleSubmitRfqQuote') && guard < patched.indexOf('// Required fields (price, itemized fees'));
  });
});
