// Box side of dealer "My Quotes": GET /api/dealer-invites and POST /api/rfq-invites/:id/bind-dealer.
// deals_api_server.js starts a server on import, so (like deals_bulk_handler.test.js) this runs the REAL handler
// source in a vm against an in-memory pool. The pool filters on the same parameters the SQL binds, and the tests
// also pin the clauses that make the query safe (dealer_user_id key, released-only, audit exclusion, write-once bind).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../src/deals_api_server.js', import.meta.url), 'utf8');
const extractFunction = (name) => {
  const start = SRC.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `could not find "async function ${name}(" in deals_api_server.js — update this test if it was renamed`);
  const end = SRC.indexOf('\n}\n', start);
  assert.ok(end > start, `could not find the end of ${name}`);
  return SRC.slice(start, end + 3);
};

function harness(invites, { body = {} } = {}) {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/FROM rfq_invites i JOIN rfq_requests r/.test(sql)) {
        const audit = !/AND r\.audit = 0/.test(sql);
        const rows = invites.filter(
          (r) => String(r.dealer_user_id) === String(params[0]) && !r.deleted_at && (r.rfq_approval_status || 'approved') === 'approved' && (audit || (!r.rfq_audit && !r.audit && !r.rfq_audit_forced_safe))
        );
        return [rows];
      }
      if (/FROM rfq_quotes/.test(sql)) return [[]];
      if (/^UPDATE rfq_invites SET dealer_user_id/.test(sql)) {
        const row = invites.find((r) => String(r.id) === String(params[1]));
        if (row && row.dealer_user_id == null) {
          row.dealer_user_id = params[0];
          return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 0 }];
      }
      if (/^SELECT dealer_user_id FROM rfq_invites/.test(sql)) {
        const row = invites.find((r) => String(r.id) === String(params[0]));
        return [row ? [{ dealer_user_id: row.dealer_user_id }] : []];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const sent = [];
  const ctx = {
    getPool: () => pool,
    ensureQuotePackageColumns: async () => {},
    ensureAuditColumns: async () => {},
    sendJson: (_res, status, obj) => sent.push({ status, obj }),
    badRequest: (_res, message) => sent.push({ status: 400, obj: { error: message } }),
    readBody: async () => body,
    publicRfqInvite: (row) => ({ id: String(row.id), dealerName: row.dealer_name, viewToken: row.view_token }),
    Number, Boolean, String, Map, Array,
  };
  vm.createContext(ctx);
  vm.runInContext(`${extractFunction('handleListDealerInvites')}\n${extractFunction('handleBindInviteDealer')}`, ctx);
  return { ctx, queries, sent };
}

const row = (id, dealer, over = {}) => ({ id, rfq_id: 7, dealer_user_id: dealer, dealer_name: 'Acme', view_token: `tok_${id}`, rfq_status: 'collecting', rfq_approval_status: 'approved', rfq_audit: 0, audit: 0, rfq_audit_forced_safe: 0, rfq_vehicle_year: 2026, rfq_vehicle_make: 'Ford', rfq_vehicle_model: 'F-150', rfq_vehicle_trim: 'XLT', rfq_vin: 'V', ...over });
const params = (q) => new URLSearchParams(q);

describe('GET /api/dealer-invites', () => {
  it('returns only the invites linked to that dealer account (dealerUserId isolation)', async () => {
    const { ctx, sent } = harness([row(1, 5), row(2, 6), row(3, null)]);
    await ctx.handleListDealerInvites({}, {}, params('dealerUserId=5'));
    assert.deepEqual(sent[0].obj.invites.map((i) => i.invite.id), ['1']);
    await ctx.handleListDealerInvites({}, {}, params('dealerUserId=6'));
    assert.deepEqual(sent[1].obj.invites.map((i) => i.invite.id), ['2']);
  });
  it('rejects a missing, zero, negative or non-numeric dealerUserId (never returns "everything")', async () => {
    for (const q of ['', 'dealerUserId=', 'dealerUserId=0', 'dealerUserId=-1', 'dealerUserId=abc', 'dealerUserId=1.5']) {
      const { ctx, sent } = harness([row(1, 5)]);
      await ctx.handleListDealerInvites({}, {}, params(q));
      assert.equal(sent[0].status, 400, q);
    }
  });
  it('leaves audit rows out unless includeAudit=1, and unreleased requests never', async () => {
    const data = [row(1, 5), row(2, 5, { rfq_audit: 1 }), row(3, 5, { rfq_audit_forced_safe: 1 }), row(4, 5, { rfq_approval_status: 'pending' }), row(5, 5, { deleted_at: '2026-10-01' })];
    const a = harness(data);
    await a.ctx.handleListDealerInvites({}, {}, params('dealerUserId=5'));
    assert.deepEqual(a.sent[0].obj.invites.map((i) => i.invite.id), ['1']);
    const b = harness(data);
    await b.ctx.handleListDealerInvites({}, {}, params('dealerUserId=5&includeAudit=1'));
    assert.deepEqual(b.sent[0].obj.invites.map((i) => i.invite.id), ['1', '2', '3']);
  });
  it('a scoped audit key can never ask for audit rows', async () => {
    const { ctx, sent } = harness([row(1, 5), row(2, 5, { rfq_audit: 1 })]);
    await ctx.handleListDealerInvites({ audit: { kind: 'audit' } }, {}, params('dealerUserId=5&includeAudit=1'));
    assert.deepEqual(sent[0].obj.invites.map((i) => i.invite.id), ['1']);
  });
  it('the query is keyed on dealer_user_id, never a name, and never selects the buyer', async () => {
    const { ctx, queries } = harness([row(1, 5)]);
    await ctx.handleListDealerInvites({}, {}, params('dealerUserId=5'));
    const sql = queries.find((q) => /rfq_invites i JOIN/.test(q.sql)).sql;
    assert.match(sql, /i\.dealer_user_id = \?/);
    assert.doesNotMatch(sql, /dealer_name\s*=/);
    assert.doesNotMatch(sql, /buyer_user_id/);
    assert.match(sql, /approval_status/);
  });
});

describe('POST /api/rfq-invites/:id/bind-dealer', () => {
  it('links an unlinked invite once; a second account can never take it over', async () => {
    const data = [row(1, null)];
    const first = harness(data, { body: { dealerUserId: 5 } });
    await first.ctx.handleBindInviteDealer({}, {}, 1);
    assert.equal(JSON.stringify(first.sent[0].obj), JSON.stringify({ bound: true, dealerUserId: '5' }));
    const second = harness(data, { body: { dealerUserId: 6 } });
    await second.ctx.handleBindInviteDealer({}, {}, 1);
    assert.equal(JSON.stringify(second.sent[0].obj), JSON.stringify({ bound: false, dealerUserId: '5' }));
    assert.equal(data[0].dealer_user_id, 5);
  });
  it('404 for an unknown invite, 400 for a bad id', async () => {
    const a = harness([row(1, null)], { body: { dealerUserId: 5 } });
    await a.ctx.handleBindInviteDealer({}, {}, 99);
    assert.equal(a.sent[0].status, 404);
    const b = harness([row(1, null)], { body: { dealerUserId: 'x' } });
    await b.ctx.handleBindInviteDealer({}, {}, 1);
    assert.equal(b.sent[0].status, 400);
  });
  it('the bind statement is write-once in SQL and the routes are registered', () => {
    assert.match(SRC, /UPDATE rfq_invites SET dealer_user_id = \? WHERE id = \? AND dealer_user_id IS NULL/);
    assert.match(SRC, /pathname === "\/api\/dealer-invites"/);
    assert.match(SRC, /\/api\\\/rfq-invites\\\/\(\\d\+\)\\\/bind-dealer/);
    assert.match(SRC, /ADD COLUMN IF NOT EXISTS dealer_user_id BIGINT NULL/);
  });
});
