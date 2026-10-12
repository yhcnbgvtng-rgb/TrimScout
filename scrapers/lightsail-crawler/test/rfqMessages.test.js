// The buyer <-> dealer chat handler (src/rfqMessages.js) against an in-memory fake of the tables it touches, plus the box patch scripts:
// each must apply cleanly to the repo mirror, twice (idempotent), and the mirror already has it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendMessage, MAX_MESSAGES, MAX_TEXT, previousFrom } from '../src/rfqMessages.js';
import { chatWorld } from './chatFakeDb.js';
import { withoutChatGuardPatch, withoutMessagesPatch } from './stripPatches.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');
const BOX = path.join(here, '..', '..', '..', 'scripts', 'box');
const MESSAGES_PATCH = path.join(BOX, '2026-10-11-rfq-messages.sh');
const GUARD_PATCH = path.join(BOX, '2026-10-12-rfq-chat-guard.sh');

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
  it('previousFrom: the sender\'s own last five delivered messages, hidden ones left out', () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `m${n}`, from: n % 2 ? 'buyer' : 'dealer', text: `t${n}`, at: 'x' })).concat([{ id: 'h', from: 'buyer', text: '', hidden: true, at: 'x' }]);
    assert.deepEqual(previousFrom(list, 'buyer'), ['t1', 't3', 't5', 't7']);
    assert.deepEqual(previousFrom(list, 'dealer'), ['t2', 't4', 't6']);
  });
});

describe('handler: chat', () => {
  it('delivers in order and returns the message and the refreshed request', async () => {
    const w = chatWorld();
    let r = await w.say('buyer', 'Can you hold it until Friday?');
    assert.equal(r.status, 200); assert.equal(r.json.status, 'delivered'); assert.equal(r.json.message.from, 'buyer');
    r = await w.say('dealer', 'Yes.');
    assert.deepEqual(r.json.rfq.invites.find((i) => i.id === '11').messages.map((m) => [m.from, m.text]), [['buyer', 'Can you hold it until Friday?'], ['dealer', 'Yes.']]);
  });
  it('a thread belongs to one invite: a message to desk 11 never lands on desk 12', async () => {
    const w = chatWorld();
    await w.say('buyer', 'for alpha only', 11);
    await w.say('buyer', 'for bravo only', 12);
    assert.deepEqual(w.threadOf(11).map((m) => m.text), ['for alpha only']);
    assert.deepEqual(w.threadOf(12).map((m) => m.text), ['for bravo only']);
  });
  it('an invite id from another request is not found', async () => {
    const w = chatWorld();
    assert.equal((await w.say('buyer', 'x', 999)).status, 404);
  });
  it('a concurrent post makes the second write retry instead of overwriting the first', async () => {
    const w = chatWorld();
    w.db.beforeWrite = () => { w.db.invites[11].messages_json = JSON.stringify([{ id: 'x', from: 'dealer', text: 'raced in', at: 'z' }]); };
    const r = await w.say('buyer', 'mine');
    assert.equal(r.status, 409); assert.equal(r.json.code, 'stale');
    assert.deepEqual(w.threadOf(11).map((m) => m.text), ['raced in']);
  });
  it('is closed on a walked request, a not-selected desk, a declined desk and an unreleased request', async () => {
    assert.equal((await chatWorld({ rfqStatus: 'walked' }).say('buyer', 'hi')).status, 409);
    const ns = chatWorld(); ns.db.invites[11].not_selected_at = '2026-10-11'; assert.equal((await ns.say('buyer', 'hi')).status, 409);
    const dc = chatWorld(); dc.db.invites[11].status = 'declined'; assert.equal((await dc.say('buyer', 'hi')).status, 409);
    assert.equal((await chatWorld({ approval: 'pending' }).say('buyer', 'hi')).status, 409);
    assert.equal((await chatWorld({ rfqStatus: 'picked' }).say('buyer', 'hi')).status, 200, 'the picked desk keeps talking');
  });
  it('scoped audit keys are pinned to their own side', async () => {
    const w = chatWorld();
    assert.equal((await w.call({ kind: 'message', from: 'dealer', text: 'x' }, 11, 'audit')).status, 403);
    assert.equal((await w.call({ kind: 'message', from: 'buyer', text: 'x' }, 11, 'audit_dealer')).status, 403);
    assert.equal((await w.call({ kind: 'message', from: 'buyer', text: 'ok' }, 11, 'audit')).status, 200);
  });
  it('refuses images and files outright', async () => {
    const w = chatWorld();
    for (const extra of [{ attachments: ['a.png'] }, { image: 'data:image/png;base64,AAAA' }, { files: [{ name: 'x.pdf' }] }, { photo: 'x' }]) {
      const r = await w.say('buyer', 'see attached', 11, extra);
      assert.equal(r.status, 400); assert.equal(r.json.code, 'attachment');
    }
    assert.equal(w.threadOf().length, 0);
  });
});

describe('handler: fee_override deal event', () => {
  it('logs the override to rfq_events and leaves the thread alone', async () => {
    const w = chatWorld();
    const r = await w.call({ kind: 'event', type: 'fee_override', overrides: [{ key: 'sales_tax', label: 'Sales tax', calculated: 2650, amount: 2750, reason: 'county rate 6.875%' }] });
    assert.equal(r.status, 200);
    assert.equal(w.db.events[0].type, 'fee_override');
    assert.deepEqual(w.db.events[0].payload.overrides[0], { key: 'sales_tax', label: 'Sales tax', calculated: 2650, amount: 2750, reason: 'county rate 6.875%' });
    assert.equal(w.db.events[0].payload.inviteId, 11);
    assert.equal(w.threadOf().length, 0);
  });
  it('is dealer-only, and only for known event types', async () => {
    const w = chatWorld();
    assert.equal((await w.call({ kind: 'event', type: 'fee_override', overrides: [] }, 11, 'audit')).status, 403);
    assert.equal((await w.call({ kind: 'event', type: 'something_else' })).status, 400);
    assert.equal((await w.call({ kind: 'nope' })).status, 400);
  });
});

describe('box patch scripts', () => {
  const run = (script, file) => execFileSync('bash', [script], { env: { ...process.env, TEST_ONLY: '1', FILE: file }, encoding: 'utf8' });
  const mirror = path.join(SRC, 'deals_api_server.js');
  const copyOf = (text) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-patch-')); const f = path.join(dir, 'deals_api_server.js'); fs.writeFileSync(f, text); return f; };
  it('the repo mirror already has both (second run changes nothing)', () => {
    assert.match(run(MESSAGES_PATCH, mirror), /applied: nothing \(already present\)/);
    assert.match(run(GUARD_PATCH, mirror), /applied: nothing \(already present\)/);
  });
  it('rfq-messages applies once to a copy without it, equals the mirror minus the guard, and is idempotent', () => {
    const f = copyOf(withoutMessagesPatch(fs.readFileSync(mirror, 'utf8')));
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /createRfqMessagesHandler|messages_json|rfqInviteMessagesMatch/);
    assert.match(run(MESSAGES_PATCH, f), /applied: import, column, invite mapper, handler, route/);
    assert.equal(fs.readFileSync(f, 'utf8'), withoutChatGuardPatch(fs.readFileSync(mirror, 'utf8')));
    assert.match(run(MESSAGES_PATCH, f), /applied: nothing \(already present\)/);
  });
  it('the guard layers on top: applies once to the messages-patched copy, equals the mirror, is idempotent', () => {
    const f = copyOf(withoutChatGuardPatch(fs.readFileSync(mirror, 'utf8')));
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /createChatAdminHandlers|chatAdmin\./);
    assert.match(run(GUARD_PATCH, f), /applied: import, handler, routes/);
    assert.equal(fs.readFileSync(f, 'utf8'), fs.readFileSync(mirror, 'utf8'));
    assert.match(run(GUARD_PATCH, f), /applied: nothing \(already present\)/);
  });
  it('the guard refuses, changing nothing, when the messages patch it anchors on is missing', () => {
    const f = copyOf('const x = 1;\n');
    assert.throws(() => execFileSync('bash', [GUARD_PATCH], { env: { ...process.env, TEST_ONLY: '1', FILE: f }, encoding: 'utf8', stdio: 'pipe' }), /rfq-messages patch/);
    assert.equal(fs.readFileSync(f, 'utf8'), 'const x = 1;\n');
  });
  it('the guard script installs every module it depends on', () => {
    const src = fs.readFileSync(GUARD_PATCH, 'utf8');
    assert.match(src, /for m in identityFilter\.js rfqChatGuard\.js rfqMessages\.js rfqChatAdmin\.js; do/);
    assert.match(src, /apply 2026-10-11-rfq-messages\.sh first/);
  });
});
