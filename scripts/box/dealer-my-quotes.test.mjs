// Dealer "My Quotes" on the deals box: the list is by dealer ACCOUNT (dealer_user_id) only, audit RFQs reach test dealers only,
// the buyer's contact never leaves, and the claim is first-account-wins. Runs the real handlers against an in-memory fake of the
// two tables (the SQL itself is only exercised on the box: see the deploy notes).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDealerInvitesHandlers, dealerListStage } from '../../scrapers/lightsail-crawler/src/rfqDealerInvites.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIRROR = path.join(here, '..', '..', 'scrapers', 'lightsail-crawler', 'src', 'deals_api_server.js');

const contactStage = JSON.stringify({
  stage: 'closed', final: { status: 'accepted' }, walk: null, log: [],
  release: { at: '2026-11-04T10:00:00Z', contact: { name: 'Pat Buyer', email: 'pat@example.com', phone: '555-0100', zip: '07030' } },
});

function row(id, over = {}) {
  return {
    id, rfq_id: 100 + id, dealer_name: 'Acme Ford', dealer_contact_email: `desk${id}@acme.test`, status: 'quoted', view_token: `token_${id}_abcdefgh`,
    dealer_user_id: null, deleted_at: null, invited_at: '2026-11-01T00:00:00Z', responded_at: '2026-11-02T00:00:00Z', stage_json: null, buyer_counter_json: null,
    vehicle_json: JSON.stringify({ vin: `VIN${id}`, year: 2026, make: 'Ford', model: 'Bronco', trim: 'Base' }),
    rfq_status: 'collecting', rfq_picked_quote_id: null, rfq_audit: 0, rfq_approval_status: 'approved', ...over,
  };
}

function world(invites, { testDealers = [] } = {}) {
  const db = { invites, quotes: invites.map((i) => ({ id: i.id * 10, invite_id: i.id, total_otd_price: '50000', submitted_at: '2026-11-02', superseded_at: null })) };
  const pool = {
    async query(sql, args = []) {
      if (/FROM rfq_invites i JOIN rfq_requests r/.test(sql)) {
        // Mirrors the WHERE clause: this account, not deleted, released.
        return [db.invites.filter((i) => i.dealer_user_id === args[0] && !i.deleted_at && i.rfq_approval_status === 'approved')];
      }
      if (/FROM rfq_quotes WHERE invite_id IN/.test(sql)) return [db.quotes.filter((q) => args[0].includes(q.invite_id))];
      if (/SELECT id, dealer_user_id FROM rfq_invites WHERE view_token/.test(sql)) return [db.invites.filter((i) => i.view_token === args[0] && !i.deleted_at)];
      if (/UPDATE rfq_invites SET dealer_user_id/.test(sql)) {
        const inv = db.invites.find((i) => i.id === args[1]);
        if (inv.dealer_user_id) return [{ affectedRows: 0 }];
        inv.dealer_user_id = args[0];
        return [{ affectedRows: 1 }];
      }
      throw new Error('unexpected sql: ' + sql);
    },
  };
  const h = createDealerInvitesHandlers({
    getPool: () => pool, readBody: async (req) => req.body, sendJson: (res, status, obj) => { res.status = status; res.json = obj; },
    ensureColumns: async () => {}, loadTestDealers: async () => testDealers,
  });
  return { db, list: async (q) => { const res = {}; await h.list({}, res, new URLSearchParams(q)); return res; }, claim: async (body) => { const res = {}; await h.claim({ body }, res); return res; } };
}

describe('GET dealer-invites', () => {
  it('requires a dealerUserId', async () => {
    const w = world([row(1)]);
    assert.equal((await w.list('')).status, 400);
    assert.equal((await w.list('dealerUserId=')).status, 400);
    assert.equal((await w.list("dealerUserId='%20OR%201=1")).status, 400);
  });
  it('lists only invites linked to that account: another account, and an unlinked invite for the SAME dealer name, are invisible', async () => {
    const w = world([row(1, { dealer_user_id: 'dealerA' }), row(2, { dealer_user_id: 'dealerB' }), row(3, { dealer_user_id: null })]);
    const a = await w.list('dealerUserId=dealerA');
    assert.deepEqual(a.json.invites.map((i) => i.inviteId), ['1']);
    const b = await w.list('dealerUserId=dealerB');
    assert.deepEqual(b.json.invites.map((i) => i.inviteId), ['2']);
    assert.deepEqual((await w.list('dealerUserId=nobody')).json.invites, []);
  });
  it('hides audit RFQs from a real dealer and shows them to an is_test dealer', async () => {
    const audit = row(1, { dealer_user_id: 'dealerA', rfq_audit: 1 });
    const real = row(2, { dealer_user_id: 'dealerA', rfq_audit: 0 });
    const asReal = world([audit, real]);
    assert.deepEqual((await asReal.list('dealerUserId=dealerA')).json.invites.map((i) => i.inviteId), ['2']);
    const asTest = world([audit, real], { testDealers: [{ dealer_name: 'Acme Ford', contact_email: 'desk1@acme.test' }] });
    const got = (await asTest.list('dealerUserId=dealerA')).json.invites;
    assert.deepEqual(got.map((i) => i.inviteId).sort(), ['1', '2']);
    assert.equal(got.find((i) => i.inviteId === '1').testDealer, true);
    assert.equal(got.find((i) => i.inviteId === '1').audit, true);
  });
  it('never sends the buyer contact, even on an accepted deal, and gives the live quote total', async () => {
    const w = world([row(1, { dealer_user_id: 'dealerA', stage_json: contactStage })]);
    const res = await w.list('dealerUserId=dealerA');
    assert.doesNotMatch(JSON.stringify(res.json), /pat@example|Pat Buyer|555-0100|"contact"/);
    assert.equal(res.json.invites[0].quote.totalOtdPrice, 50000);
    assert.ok(res.json.invites[0].stage.release);
  });
  it('dealerListStage drops the contact whether or not the deal was accepted, and a not-selected desk loses the release', () => {
    assert.equal(dealerListStage(null, false), null);
    assert.equal('contact' in dealerListStage(contactStage, false).release, false);
    assert.equal(dealerListStage(contactStage, true).release, null);
  });
});

describe('POST dealer-invites/claim', () => {
  it('links an unlinked invite once; the same account again is a no-op', async () => {
    const w = world([row(1)]);
    const first = await w.claim({ dealerUserId: 'dealerA', viewToken: 'token_1_abcdefgh' });
    assert.deepEqual([first.status, first.json.claimed], [200, true]);
    const again = await w.claim({ dealerUserId: 'dealerA', viewToken: 'token_1_abcdefgh' });
    assert.deepEqual([again.status, again.json.claimed], [200, false]);
  });
  it('refuses a second account, validates input, and 404s an unknown token', async () => {
    const w = world([row(1, { dealer_user_id: 'dealerA' })]);
    const other = await w.claim({ dealerUserId: 'dealerB', viewToken: 'token_1_abcdefgh' });
    assert.deepEqual([other.status, other.json.code], [409, 'linked_elsewhere']);
    assert.equal(w.db.invites[0].dealer_user_id, 'dealerA');
    assert.equal((await w.claim({ dealerUserId: '', viewToken: 'token_1_abcdefgh' })).status, 400);
    assert.equal((await w.claim({ dealerUserId: 'dealerA', viewToken: 'x' })).status, 400);
    assert.equal((await w.claim({ dealerUserId: 'dealerA', viewToken: 'no_such_token_zzzz' })).status, 404);
  });
});

describe('repo mirror wiring', () => {
  const src = fs.readFileSync(MIRROR, 'utf8');
  it('registers both routes and the column + index', () => {
    assert.match(src, /pathname === "\/api\/dealer-invites"/);
    assert.match(src, /pathname === "\/api\/dealer-invites\/claim"/);
    assert.match(src, /ADD COLUMN IF NOT EXISTS dealer_user_id VARCHAR\(128\) NULL/);
    assert.match(src, /idx_rfq_invites_dealer_user/);
  });
});
