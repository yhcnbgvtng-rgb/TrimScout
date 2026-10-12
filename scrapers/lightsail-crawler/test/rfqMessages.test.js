// The buyer <-> dealer chat handler (src/rfqMessages.js) against an in-memory fake of the two tables it touches, plus the box
// patch script: it must apply cleanly to the repo mirror, twice (idempotent), and the mirror already has it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendMessage, createRfqMessagesHandler, MAX_MESSAGES, MAX_TEXT } from '../src/rfqMessages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');
const PATCH = path.join(here, '..', '..', '..', 'scripts', 'box', '2026-10-11-rfq-messages.sh');

const findContactInfo = (t) => (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(t) ? 'an email address' : /\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/.test(t) ? 'a phone number' : null);

function world({ rfqStatus = 'collecting', approval = 'approved', inviteStatus = 'quoted', notSelected = null } = {}) {
  const db = {
    rfq: { id: 7, status: rfqStatus, approval_status: approval },
    invites: {
      11: { id: 11, rfq_id: 7, status: inviteStatus, dealer_name: 'Alpha Motors', messages_json: null, not_selected_at: notSelected },
      12: { id: 12, rfq_id: 7, status: 'quoted', dealer_name: 'Bravo Autos', messages_json: null, not_selected_at: null },
    },
    events: [],
  };
  const pool = {
    query: async (sql, args = []) => {
      if (/FROM rfq_requests WHERE id/.test(sql)) return [[db.rfq]];
      if (/FROM rfq_invites WHERE id/.test(sql)) { const i = db.invites[args[0]]; return [i && i.rfq_id === args[1] ? [i] : []]; }
      if (/UPDATE rfq_invites SET messages_json/.test(sql)) {
        const [next, id, , prev] = args;
        if (db.beforeWrite) { const f = db.beforeWrite; db.beforeWrite = null; f(); }
        if ((db.invites[id].messages_json ?? null) !== (prev ?? null)) return [{ affectedRows: 0 }];
        db.invites[id].messages_json = next; return [{ affectedRows: 1 }];
      }
      throw new Error('unexpected sql: ' + sql);
    },
  };
  const handle = createRfqMessagesHandler({
    getPool: () => pool, readBody: async (req) => req.body, sendJson: (res, status, obj) => { res.status = status; res.json = obj; },
    ensureColumns: async () => {}, loadInvites: async () => Object.values(db.invites).map((i) => ({ id: String(i.id), messages: i.messages_json ? JSON.parse(i.messages_json) : [] })),
    publicRfqRequest: (row, invites) => ({ status: row.status, invites }), logRfqEvent: async (_p, _id, type, payload) => { db.events.push({ type, payload }); },
    findContactInfo, auditKind: (req) => req.audit || null,
  });
  const call = async (body, inviteId = 11, audit) => { const res = {}; await handle({ body, audit }, res, 7, inviteId); return res; };
  const say = (from, text, inviteId = 11) => call({ kind: 'message', from, text }, inviteId);
  return { db, call, say };
}

describe('appendMessage', () => {
  it('trims, ids and timestamps a message, and caps the thread', () => {
    const r = appendMessage([], { from: 'buyer', text: '  hi  ' }, new Date('2026-10-11T12:00:00Z'));
    assert.equal(r.ok, true); assert.equal(r.message.text, 'hi'); assert.equal(r.message.at, '2026-10-11T12:00:00.000Z'); assert.ok(r.message.id);
    let list = [];
    for (let i = 0; i < MAX_MESSAGES + 5; i++) list = appendMessage(list, { from: 'dealer', text: `m${i}` }).list;
    assert.equal(list.length, MAX_MESSAGES); assert.equal(list.at(-1).text, `m${MAX_MESSAGES + 4}`);
  });
  it('refuses empty, over-long and unknown senders', () => {
    assert.equal(appendMessage([], { from: 'buyer', text: '   ' }).code, 'empty');
    assert.equal(appendMessage([], { from: 'buyer', text: 'x'.repeat(MAX_TEXT + 1) }).code, 'too_long');
    assert.equal(appendMessage([], { from: 'admin', text: 'hi' }).code, 'bad_from');
  });
});

describe('handler: chat', () => {
  it('appends in order, returns the message and the refreshed request', async () => {
    const w = world();
    let r = await w.say('buyer', 'Can you hold it until Friday?');
    assert.equal(r.status, 200); assert.equal(r.json.message.from, 'buyer');
    r = await w.say('dealer', 'Yes.');
    assert.deepEqual(r.json.rfq.invites.find((i) => i.id === '11').messages.map((m) => [m.from, m.text]), [['buyer', 'Can you hold it until Friday?'], ['dealer', 'Yes.']]);
  });
  it('a thread belongs to one invite: a message to desk 11 never lands on desk 12', async () => {
    const w = world();
    await w.say('buyer', 'for alpha only', 11);
    await w.say('buyer', 'for bravo only', 12);
    assert.deepEqual(JSON.parse(w.db.invites[11].messages_json).map((m) => m.text), ['for alpha only']);
    assert.deepEqual(JSON.parse(w.db.invites[12].messages_json).map((m) => m.text), ['for bravo only']);
  });
  it('an invite id from another request is not found', async () => {
    const w = world();
    const res = {}; await createRfqMessagesHandler({ ...{}, getPool: () => ({ query: async () => [[]] }), readBody: async () => ({ kind: 'message', from: 'buyer', text: 'x' }), sendJson: (r, s, o) => { r.status = s; r.json = o; }, ensureColumns: async () => {}, loadInvites: async () => [], publicRfqRequest: () => ({}), logRfqEvent: async () => {}, findContactInfo })({}, res, 7, 999);
    assert.equal(res.status, 404); assert.ok(w);
  });
  it('contact info is refused outright, from either side, and nothing is stored', async () => {
    const w = world();
    for (const from of ['buyer', 'dealer']) {
      const r = await w.say(from, 'call me 201-555-0147');
      assert.equal(r.status, 400); assert.equal(r.json.code, 'contact_info');
    }
    assert.equal((await w.say('buyer', 'mail jane@gmail.com')).status, 400);
    assert.equal(w.db.invites[11].messages_json, null);
  });
  it('a concurrent post makes the second write retry instead of overwriting the first', async () => {
    const w = world();
    w.db.beforeWrite = () => { w.db.invites[11].messages_json = JSON.stringify([{ id: 'x', from: 'dealer', text: 'raced in', at: 'z' }]); };
    const r = await w.say('buyer', 'mine');
    assert.equal(r.status, 409); assert.equal(r.json.code, 'stale');
    assert.deepEqual(JSON.parse(w.db.invites[11].messages_json).map((m) => m.text), ['raced in']);
  });
  it('is closed on a walked request, a not-selected desk, a declined desk and an unreleased request', async () => {
    assert.equal((await world({ rfqStatus: 'walked' }).say('buyer', 'hi')).status, 409);
    assert.equal((await world({ notSelected: '2026-10-11' }).say('buyer', 'hi')).status, 409);
    assert.equal((await world({ inviteStatus: 'declined' }).say('buyer', 'hi')).status, 409);
    assert.equal((await world({ approval: 'pending' }).say('buyer', 'hi')).status, 409);
    assert.equal((await world({ rfqStatus: 'picked' }).say('buyer', 'hi')).status, 200, 'the picked desk keeps talking');
  });
  it('scoped audit keys are pinned to their own side', async () => {
    const w = world();
    assert.equal((await w.call({ kind: 'message', from: 'dealer', text: 'x' }, 11, 'audit')).status, 403);
    assert.equal((await w.call({ kind: 'message', from: 'buyer', text: 'x' }, 11, 'audit_dealer')).status, 403);
    assert.equal((await w.call({ kind: 'message', from: 'buyer', text: 'ok' }, 11, 'audit')).status, 200);
  });
});

describe('handler: fee_override deal event', () => {
  it('logs the override to rfq_events and leaves the thread alone', async () => {
    const w = world();
    const r = await w.call({ kind: 'event', type: 'fee_override', overrides: [{ key: 'sales_tax', label: 'Sales tax', calculated: 2650, amount: 2750, reason: 'county rate 6.875%' }] });
    assert.equal(r.status, 200);
    assert.equal(w.db.events.length, 1); assert.equal(w.db.events[0].type, 'fee_override');
    assert.deepEqual(w.db.events[0].payload.overrides[0], { key: 'sales_tax', label: 'Sales tax', calculated: 2650, amount: 2750, reason: 'county rate 6.875%' });
    assert.equal(w.db.events[0].payload.inviteId, 11);
    assert.equal(w.db.invites[11].messages_json, null);
  });
  it('is dealer-only, and only for known event types', async () => {
    const w = world();
    assert.equal((await w.call({ kind: 'event', type: 'fee_override', overrides: [] }, 11, 'audit')).status, 403);
    assert.equal((await w.call({ kind: 'event', type: 'something_else' })).status, 400);
    assert.equal((await w.call({ kind: 'nope' })).status, 400);
  });
});

describe('box patch script', () => {
  const run = (file) => execFileSync('bash', [PATCH], { env: { ...process.env, TEST_ONLY: '1', FILE: file }, encoding: 'utf8' });
  it('the repo mirror already has it (second run changes nothing)', () => {
    assert.match(run(path.join(SRC, 'deals_api_server.js')), /applied: nothing \(already present\)/);
  });
  it('applies to a copy of the server without the patch, once, then is idempotent', () => {
    const live = fs.readFileSync(path.join(SRC, 'deals_api_server.js'), 'utf8')
      .replace('import { createRfqMessagesHandler } from "./rfqMessages.js";\n', '')
      .replace('  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS messages_json TEXT NULL");\n', '')
      .replace(/    \/\/ This desk's buyer <-> dealer chat[^\n]*\n    messages: parseJsonCol\(row\.messages_json\) \|\| \[\],\n/, '')
      .replace(/\/\/ POST \/api\/rfqs\/:id\/invites\/:inviteId\/messages[\s\S]*?\n\}\);\n\n/, '')
      .replace(/  const rfqInviteMessagesMatch[\s\S]*?\n  \}\n/, '');
    assert.doesNotMatch(live, /createRfqMessagesHandler|messages_json|rfqInviteMessagesMatch/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfq-messages-'));
    const file = path.join(dir, 'deals_api_server.js');
    fs.writeFileSync(file, live);
    assert.match(run(file), /applied: import, column, invite mapper, handler, route/);
    assert.equal(fs.readFileSync(file, 'utf8'), fs.readFileSync(path.join(SRC, 'deals_api_server.js'), 'utf8'), 'the patched copy equals the repo mirror');
    assert.match(run(file), /applied: nothing \(already present\)/);
  });
  it('refuses, changing nothing, when the deal-stages patch it anchors on is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfq-messages-'));
    const file = path.join(dir, 'deals_api_server.js');
    fs.writeFileSync(file, 'const x = 1;\n');
    assert.throws(() => execFileSync('bash', [PATCH], { env: { ...process.env, TEST_ONLY: '1', FILE: file }, encoding: 'utf8', stdio: 'pipe' }), /deal-stages patch/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'const x = 1;\n');
  });
});
