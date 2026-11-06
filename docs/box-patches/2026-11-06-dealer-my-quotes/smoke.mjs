// Smoke test for the new module, run ON the box beside its real dealStages.js (in a temp dir, never the live dir):
//   node smoke.mjs <dir holding dealStages.js and rfqDealerInvites.js>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const dir = path.resolve(process.argv[2] || '.');
const { createDealerInvitesHandlers, dealerListStage } = await import(pathToFileURL(path.join(dir, 'rfqDealerInvites.js')).href);
const out = (res, status, obj) => { res.status = status; res.json = obj; };
const pool = { async query(sql, args = []) {
  if (/FROM rfq_invites i JOIN rfq_requests r/.test(sql)) return [[]];
  if (/SELECT id, dealer_user_id FROM rfq_invites WHERE view_token/.test(sql)) return [[]];
  throw new Error('unexpected sql: ' + sql);
} };
const h = createDealerInvitesHandlers({ getPool: () => pool, readBody: async (r) => r.body, sendJson: out, ensureColumns: async () => {}, loadTestDealers: async () => [] });
let r = {}; await h.list({}, r, new URLSearchParams('')); assert.equal(r.status, 400);
r = {}; await h.list({}, r, new URLSearchParams('dealerUserId=probe')); assert.deepEqual([r.status, r.json.invites], [200, []]);
r = {}; await h.claim({ body: { dealerUserId: 'probe', viewToken: 'no_such_token_zzzz' } }, r); assert.equal(r.status, 404);
const staged = JSON.stringify({ stage: 'closed', final: { status: 'accepted' }, release: { at: 'x', contact: { email: 'a@b.co' } }, log: [] });
assert.equal('contact' in dealerListStage(staged, false).release, false);
console.log('smoke ok: list needs a dealerUserId, empty list for an unknown account, claim 404s an unknown token, stage contact is dropped');
