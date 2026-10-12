// The conversation guard on the box: blocked messages never reach the other side, every attempt is logged per dealer (never the text),
// the first attempt warns, three in 30 days pause the dealer's chat on all deals, an admin lifts it; borderline messages go to an AI check
// and, when that is unavailable, to an admin queue; the buyer can report a dealer message into the same queue.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCKED_NOTE, dealerKeyOf, FIRST_WARNING, HELD_NOTE, PAUSED_NOTE, STRIKE_LIMIT, STRIKE_WINDOW_DAYS, strikeState } from '../src/rfqChatGuard.js';
import { chatWorld } from './chatFakeDb.js';

const DAY = 86400000;

describe('strike policy (pure)', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  const ago = (d) => new Date(now.getTime() - d * DAY);
  it('3 attempts in 30 days pause; the first one warns', () => {
    assert.equal(STRIKE_LIMIT, 3); assert.equal(STRIKE_WINDOW_DAYS, 30);
    assert.deepEqual(strikeState([ago(0)], now), { count: 1, warning: true, shouldPause: false });
    assert.deepEqual(strikeState([ago(1), ago(0)], now), { count: 2, warning: false, shouldPause: false });
    assert.deepEqual(strikeState([ago(5), ago(1), ago(0)], now), { count: 3, warning: false, shouldPause: true });
  });
  it('attempts older than 30 days do not count', () => {
    assert.equal(strikeState([ago(31), ago(40), ago(2)], now).count, 1);
    assert.equal(strikeState([ago(29.9), ago(10), ago(0)], now).shouldPause, true);
    assert.equal(strikeState([ago(30.1), ago(10), ago(0)], now).shouldPause, false);
  });
  it('attempts before an admin lifted the pause do not count', () => {
    assert.equal(strikeState([ago(5), ago(4), ago(3), ago(0)], now, ago(2)).count, 1);
  });
  it('the dealer is the rooftop, case and spacing aside', () => {
    assert.equal(dealerKeyOf({ dealer_name: ' Alpha Motors ' }), 'alpha motors');
  });
});

describe('blocked messages', () => {
  const BAD = ['call me 201-555-0147', 'my name is Jane', 'five five five one two three four', 'jane at gmail dot com', 'find me on instagram', 'https://evil.example/me', '5️⃣5️⃣5️⃣1️⃣2️⃣3️⃣4️⃣'];
  it('are refused with the plain note, never stored, never shown to the other side, and logged without their text', async () => {
    const w = chatWorld();
    for (const text of BAD) {
      const r = await w.say('buyer', text);
      assert.equal(r.status, 200); assert.equal(r.json.status, 'blocked'); assert.equal(r.json.note, BLOCKED_NOTE);
      assert.doesNotMatch(JSON.stringify(r.json), /201-555|Jane|gmail|instagram|evil/);
    }
    assert.equal(w.threadOf().length, 0);
    assert.equal(w.db.attempts.length, BAD.length);
    assert.doesNotMatch(JSON.stringify(w.db.attempts), /201-555|Jane|gmail|instagram|evil/, 'the attempts log holds reasons, not text');
    assert.equal(w.db.reviews.length, 0);
  });
  it('a buyer is told, but never warned or paused', async () => {
    const w = chatWorld();
    let r;
    for (let i = 0; i < 5; i++) r = await w.say('buyer', 'call me 201-555-0147');
    assert.equal(r.json.status, 'blocked'); assert.equal(r.json.warning, null); assert.equal(r.json.paused, false);
    assert.equal(w.db.pauses.length, 0);
    assert.equal((await w.say('buyer', 'Can you do $38,900?')).json.status, 'delivered');
  });
  it('the sender\'s last five messages joined together are checked, and the one that completes the number is refused', async () => {
    const w = chatWorld();
    for (const t of ['five five', 'five one', 'two']) assert.equal((await w.say('buyer', t)).json.status, 'delivered', t);
    const r = await w.say('buyer', 'three four');
    assert.equal(r.json.status, 'blocked');
    assert.deepEqual(w.threadOf().map((m) => m.text), ['five five', 'five one', 'two'], 'what was already delivered stays delivered');
    assert.equal(w.db.attempts.length, 1, 'and the refused one counts as an attempt');
  });
  it('the other side\'s messages in between do not hide it, and a normal run of short messages is fine', async () => {
    const w = chatWorld();
    for (const t of ['jane', 'at acme']) await w.say('dealer', t);
    await w.say('buyer', 'ok thanks');
    assert.equal((await w.say('dealer', 'dot com')).json.status, 'blocked');
    const n = chatWorld();
    for (const t of ['36 months', '5.9', '3000 down', '60', '10/15']) assert.equal((await n.say('buyer', t)).json.status, 'delivered', t);
    assert.equal((await n.say('buyer', '2650')).json.status, 'delivered');
  });
});

describe('strikes against a dealer', () => {
  it('the first attempt shows a warning; the third in 30 days pauses the dealer on ALL deals and says so for the SAFE MODE email', async () => {
    const w = chatWorld();
    const a = await w.say('dealer', 'call me 201-555-0147');
    assert.equal(a.json.warning, FIRST_WARNING); assert.equal(a.json.attempts, 1); assert.equal(a.json.paused, false);
    const b = await w.say('dealer', 'my name is Dave');
    assert.equal(b.json.warning, null); assert.equal(b.json.attempts, 2); assert.equal(b.json.justPaused, false);
    const c = await w.say('dealer', 'text me');
    assert.equal(c.json.attempts, 3); assert.equal(c.json.paused, true); assert.equal(c.json.justPaused, true);
    assert.equal(w.db.pauses.length, 1);
    // paused everywhere this rooftop is, even on another deal, and the same dealer under another spelling
    for (const inv of [11, 13]) { const r = await w.say('dealer', 'Is the VIN still available?', inv); assert.equal(r.json.status, 'paused'); assert.equal(r.json.note, PAUSED_NOTE); }
    // but not another dealer, and not the buyer
    assert.equal((await w.say('dealer', 'Yes it is', 12)).json.status, 'delivered');
    assert.equal((await w.say('buyer', 'Great', 11)).json.status, 'delivered');
    assert.equal(w.threadOf(11).filter((m) => m.from === 'dealer').length, 0);
  });
  it('attempts older than 30 days are not counted', async () => {
    const w = chatWorld();
    for (const d of [45, 40]) w.db.attempts.push({ dealer_key: 'alpha motors', side: 'dealer', rfq_id: 7, invite_id: 11, kind: 'blocked', reason: 'x', created_at: new Date(Date.now() - d * DAY) });
    const r = await w.say('dealer', 'call me 201-555-0147');
    assert.equal(r.json.attempts, 1); assert.equal(r.json.paused, false); assert.equal(r.json.warning, FIRST_WARNING);
  });
  it('an admin lifts the pause; earlier attempts stop counting and chat works again', async () => {
    const w = chatWorld();
    for (let i = 0; i < 3; i++) await w.say('dealer', 'call me 201-555-0147');
    assert.equal((await w.say('dealer', 'hello')).json.status, 'paused');
    let r = await w.adm('pauses'); assert.deepEqual(r.json.pauses.map((p) => p.dealerKey), ['alpha motors']);
    await new Promise((r2) => setTimeout(r2, 15));
    r = await w.adm('lift', { dealerKey: 'Alpha Motors', by: 'paul' }); assert.equal(r.status, 200);
    assert.equal((await w.adm('pauses')).json.pauses.length, 0);
    await new Promise((r) => setTimeout(r, 15));
    assert.equal((await w.say('dealer', 'Is the VIN still available?')).json.status, 'delivered');
    const again = await w.say('dealer', 'call me 201-555-0147');
    assert.equal(again.json.attempts, 1, 'a fresh count after the lift'); assert.equal(again.json.paused, false);
    assert.equal((await w.adm('lift', { dealerKey: 'alpha motors' })).status, 404, 'nothing left to lift');
    assert.equal((await w.adm('status', 7, 11)).json.paused, false);
  });
  it('the dealer panel can read whether its chat is paused', async () => {
    const w = chatWorld();
    for (let i = 0; i < 3; i++) await w.say('dealer', 'text me');
    assert.equal((await w.adm('status', 7, 11)).json.paused, true);
    assert.equal((await w.adm('status', 7, 12)).json.paused, false);
  });
});

describe('borderline messages: the AI check and its fallback', () => {
  const ODD = 'x y z w v u t';
  it('score high but no rule hit -> needs_review; nothing is delivered or logged yet', async () => {
    const w = chatWorld();
    const r = await w.say('buyer', ODD);
    assert.equal(r.json.status, 'needs_review');
    assert.equal(w.threadOf().length, 0); assert.equal(w.db.attempts.length, 0); assert.equal(w.db.reviews.length, 0);
  });
  it('AI says no -> delivered; AI says yes -> blocked and counted', async () => {
    const w = chatWorld();
    assert.equal((await w.say('buyer', ODD, 11, { aiVerdict: 'no' })).json.status, 'delivered');
    const r = await w.say('dealer', ODD, 11, { aiVerdict: 'yes' });
    assert.equal(r.json.status, 'blocked'); assert.equal(r.json.attempts, 1); assert.equal(r.json.warning, FIRST_WARNING);
  });
  it('AI error or timeout ("unavailable") -> held for an admin, NOT delivered, and the sender is told it is being reviewed', async () => {
    const w = chatWorld();
    const r = await w.say('dealer', ODD, 11, { aiVerdict: 'unavailable' });
    assert.equal(r.json.status, 'held'); assert.equal(r.json.note, HELD_NOTE);
    assert.equal(w.threadOf().length, 0);
    assert.equal(w.db.reviews.length, 1); assert.equal(w.db.reviews[0].kind, 'held'); assert.equal(w.db.reviews[0].status, 'pending');
    assert.equal(w.db.attempts.length, 0, 'held is not yet an attempt');
  });
  it('the AI verdict can never override a rule block', async () => {
    const w = chatWorld();
    assert.equal((await w.say('buyer', 'call me 201-555-0147', 11, { aiVerdict: 'no' })).json.status, 'blocked');
  });
  it('admin Release delivers the held message; admin Block makes it a held-then-blocked attempt', async () => {
    const w = chatWorld();
    await w.say('dealer', ODD, 11, { aiVerdict: 'unavailable' });
    await w.say('dealer', 'x y z w v u t s', 11, { aiVerdict: 'unavailable' });
    let q = await w.adm('list'); assert.equal(q.json.items.length, 2); assert.equal(q.json.items[0].dealerName, 'Alpha Motors');
    let r = await w.adm('decide', q.json.items[0].id, { decision: 'release', by: 'paul' });
    assert.equal(r.json.status, 'released');
    assert.deepEqual(w.threadOf().map((m) => [m.from, m.text]), [['dealer', ODD]]);
    r = await w.adm('decide', q.json.items[1].id, { decision: 'block', by: 'paul' });
    assert.equal(r.json.status, 'blocked'); assert.equal(r.json.attempts, 1);
    assert.equal(w.db.attempts[0].kind, 'held_blocked');
    assert.equal(w.threadOf().length, 1, 'a blocked held message never reaches the thread');
    assert.equal((await w.adm('list')).json.items.length, 0);
    assert.equal((await w.adm('decide', q.json.items[0].id, { decision: 'block' })).status, 409, 'decided once');
  });
  it('three held-then-blocked messages pause the dealer, reported back for the SAFE MODE email', async () => {
    const w = chatWorld();
    for (let i = 0; i < 3; i++) await w.say('dealer', `${ODD} ${i}`, 11, { aiVerdict: 'unavailable' });
    const items = (await w.adm('list')).json.items;
    let last;
    for (const it of items) last = await w.adm('decide', it.id, { decision: 'block' });
    assert.equal(last.json.justPaused, true); assert.equal(last.json.paused, true);
    assert.equal((await w.say('dealer', 'hello')).json.status, 'paused');
  });
});

describe('the buyer reports a dealer message', () => {
  async function withDealerMessage() {
    const w = chatWorld();
    const sent = await w.say('dealer', 'We can hold it until Friday.');
    return { w, id: sent.json.message.id };
  }
  it('lands in the admin queue once (the message stays until an admin decides), with who reported it', async () => {
    const { w, id } = await withDealerMessage();
    let r = await w.call({ kind: 'report', messageId: id });
    assert.equal(r.status, 200); assert.equal(r.json.status, 'reported'); assert.equal(r.json.duplicate, false);
    r = await w.call({ kind: 'report', messageId: id });
    assert.equal(r.json.duplicate, true); assert.equal(w.db.reviews.length, 1);
    assert.equal(w.db.reviews[0].kind, 'reported'); assert.equal(w.db.reviews[0].reporter, 'buyer'); assert.equal(w.db.reviews[0].text, 'We can hold it until Friday.');
    assert.equal(w.threadOf().length, 1, 'still delivered until an admin blocks it');
  });
  it('only a dealer message in this thread can be reported', async () => {
    const { w } = await withDealerMessage();
    const mine = await w.say('buyer', 'Thanks');
    assert.equal((await w.call({ kind: 'report', messageId: mine.json.message.id })).status, 404, 'a buyer message');
    assert.equal((await w.call({ kind: 'report', messageId: 'nope' })).status, 404);
    assert.equal((await w.call({ kind: 'report', messageId: mine.json.message.id }, 12)).status, 404, 'another thread');
  });
  it('Release dismisses it; Block hides the message from both sides (text gone) and counts against the dealer', async () => {
    const { w, id } = await withDealerMessage();
    await w.call({ kind: 'report', messageId: id });
    const [item] = (await w.adm('list')).json.items;
    let r = await w.adm('decide', item.id, { decision: 'release', by: 'paul' });
    assert.equal(r.json.status, 'released'); assert.equal(w.threadOf()[0].hidden, undefined); assert.equal(w.db.attempts.length, 0);

    const second = await w.say('dealer', 'Call the finance desk');
    await w.call({ kind: 'report', messageId: second.json.message.id });
    const [item2] = (await w.adm('list')).json.items;
    r = await w.adm('decide', item2.id, { decision: 'block', by: 'paul' });
    assert.equal(r.json.status, 'blocked'); assert.equal(r.json.attempts, 1);
    const hidden = w.threadOf().find((m) => m.id === second.json.message.id);
    assert.equal(hidden.hidden, true); assert.equal(hidden.text, '', 'the text is gone from the stored thread');
    assert.equal(w.db.attempts[0].kind, 'reported_blocked'); assert.equal(w.db.attempts[0].side, 'dealer');
  });
});
