// An in-memory stand-in for the handful of tables the conversation handlers touch, plus a way to call the handlers like the server does.
import { createRfqMessagesHandler } from '../src/rfqMessages.js';
import { createChatAdminHandlers } from '../src/rfqChatAdmin.js';

export const T0 = new Date('2026-10-12T12:00:00Z');

export function chatWorld({ rfqStatus = 'collecting', approval = 'approved', invites } = {}) {
  const db = {
    rfq: { id: 7, status: rfqStatus, approval_status: approval },
    invites: invites || {
      11: { id: 11, rfq_id: 7, status: 'quoted', dealer_name: 'Alpha Motors', messages_json: null, not_selected_at: null },
      12: { id: 12, rfq_id: 7, status: 'quoted', dealer_name: 'Bravo Autos', messages_json: null, not_selected_at: null },
      13: { id: 13, rfq_id: 7, status: 'quoted', dealer_name: 'alpha motors ', messages_json: null, not_selected_at: null }, // same rooftop, another deal
    },
    attempts: [], reviews: [], pauses: [], events: [], nextId: 1,
  };
  const when = (v) => new Date(v).getTime();
  const pool = {
    query: async (sql, a = []) => {
      if (/^CREATE TABLE/.test(sql)) return [[]];
      if (/FROM rfq_requests WHERE id/.test(sql)) return [[db.rfq]];
      if (/FROM rfq_invites WHERE id = \? AND rfq_id/.test(sql)) { const i = db.invites[a[0]]; return [i && i.rfq_id === a[1] ? [i] : []]; }
      if (/UPDATE rfq_invites SET messages_json/.test(sql)) {
        const [next, id, , prev] = a;
        if (db.beforeWrite) { const f = db.beforeWrite; db.beforeWrite = null; f(); }
        if ((db.invites[id].messages_json ?? null) !== (prev ?? null)) return [{ affectedRows: 0 }];
        db.invites[id].messages_json = next; return [{ affectedRows: 1 }];
      }
      if (/^INSERT INTO rfq_chat_attempts/.test(sql)) { db.attempts.push({ dealer_key: a[0], side: a[1], rfq_id: a[2], invite_id: a[3], kind: a[4], reason: a[5], created_at: a[6] }); return [{ affectedRows: 1 }]; }
      if (/^SELECT created_at FROM rfq_chat_attempts/.test(sql)) return [db.attempts.filter((x) => x.dealer_key === a[0] && x.side === 'dealer' && when(x.created_at) > when(a[1])).sort((p, q) => when(p.created_at) - when(q.created_at)).map((x) => ({ created_at: x.created_at }))];
      if (/FROM rfq_chat_pauses WHERE dealer_key = \? ORDER BY id DESC/.test(sql)) { const l = db.pauses.filter((p) => p.dealer_key === a[0]); return [l.length ? [l[l.length - 1]] : []]; }
      if (/^INSERT INTO rfq_chat_pauses/.test(sql)) { db.pauses.push({ id: db.nextId++, dealer_key: a[0], paused_at: a[1], reason: a[2], lifted_at: null, lifted_by: null }); return [{ affectedRows: 1 }]; }
      if (/FROM rfq_chat_pauses WHERE lifted_at IS NULL ORDER BY id/.test(sql)) return [db.pauses.filter((p) => !p.lifted_at)];
      if (/^UPDATE rfq_chat_pauses SET lifted_at/.test(sql)) { const hit = db.pauses.filter((p) => p.dealer_key === a[2] && !p.lifted_at); hit.forEach((p) => { p.lifted_at = a[0]; p.lifted_by = a[1]; }); return [{ affectedRows: hit.length }]; }
      if (/SELECT id FROM rfq_chat_review WHERE invite_id/.test(sql)) return [db.reviews.filter((r) => r.invite_id === a[0] && r.message_id === a[1] && r.kind === 'reported').map((r) => ({ id: r.id }))];
      if (/^INSERT INTO rfq_chat_review/.test(sql)) { const id = db.nextId++; db.reviews.push({ id, rfq_id: a[0], invite_id: a[1], sender: a[2], kind: a[3], message_id: a[4], text: a[5], reason: a[6], status: 'pending', reporter: a[7], created_at: a[8] }); return [{ insertId: id }]; }
      if (/FROM rfq_chat_review r LEFT JOIN rfq_invites i/.test(sql)) return [db.reviews.filter((r) => r.status === 'pending').map((r) => ({ ...r, dealer_name: db.invites[r.invite_id]?.dealer_name }))];
      if (/^SELECT \* FROM rfq_chat_review WHERE id/.test(sql)) return [db.reviews.filter((r) => r.id === a[0])];
      if (/^UPDATE rfq_chat_review SET status/.test(sql)) { const r = db.reviews.find((x) => x.id === a[3] && x.status === 'pending'); if (!r) return [{ affectedRows: 0 }]; r.status = a[0]; r.decided_at = a[1]; r.decided_by = a[2]; return [{ affectedRows: 1 }]; }
      throw new Error('unexpected sql: ' + sql);
    },
  };
  const send = (res, status, obj) => { res.status = status; res.json = obj; };
  const base = { getPool: () => pool, readBody: async (req) => req.body, sendJson: send, ensureColumns: async () => {} };
  const handle = createRfqMessagesHandler({
    ...base, loadInvites: async () => Object.values(db.invites).map((i) => ({ id: String(i.id), messages: i.messages_json ? JSON.parse(i.messages_json) : [] })),
    publicRfqRequest: (row, invites) => ({ status: row.status, invites }), logRfqEvent: async (_p, _id, type, payload) => { db.events.push({ type, payload }); },
    findContactInfo: (t) => (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(t) ? 'an email address' : null), auditKind: (req) => req.audit || null,
  });
  const admin = createChatAdminHandlers(base);
  const call = async (body, inviteId = 11, audit) => { const res = {}; await handle({ body, audit }, res, 7, inviteId); return res; };
  const say = (from, text, inviteId = 11, extra = {}) => call({ kind: 'message', from, text, ...extra }, inviteId);
  const adm = async (fn, ...args) => { const res = {}; await admin[fn]({ body: args.at(-1) && typeof args.at(-1) === 'object' ? args.at(-1) : {} }, res, ...args.filter((x) => typeof x !== 'object')); return res; };
  const threadOf = (id = 11) => (db.invites[id].messages_json ? JSON.parse(db.invites[id].messages_json) : []);
  return { db, call, say, adm, threadOf, pool };
}
