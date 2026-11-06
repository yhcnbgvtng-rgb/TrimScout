// Smoke test for the pick-release rule, run ON the box against the package's dealStages.js (in a temp dir, never the live dir; apply runs it again on the live files):
//   node smoke.mjs <dir holding dealStages.js>
// Pure functions only: no database, no network, no mail.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const dir = path.resolve(process.argv[2] || '.');
const { releaseOnPick, applyStageAction, initialStageState, stageForDealer } = await import(pathToFileURL(path.join(dir, 'dealStages.js')).href);
const NOW = new Date('2026-11-06T15:00:00Z');
const CONTACT = { name: 'Pat Buyer', email: 'pat@example.com', phone: '5551234567', zip: '07001' };
assert.equal(typeof stageForDealer, 'function', 'the existing stageForDealer export is still there');

const r = releaseOnPick(null, { otd: 43749, contact: CONTACT, now: NOW });
assert.equal(r.ok, true); assert.equal(r.released, true);
assert.equal(r.state.stage, 'closed'); assert.equal(r.state.final.status, 'accepted'); assert.equal(r.state.final.summary.otd, 43749);
assert.equal(r.state.release.contact.email, 'pat@example.com'); assert.equal(r.state.release.at, NOW.toISOString());
assert.equal(r.state.log.at(-1).type, 'buyer_details_released'); assert.equal(r.state.log.at(-1).stage, 'pick');

const again = releaseOnPick(r.state, { otd: 1, contact: CONTACT, now: new Date('2026-11-07T00:00:00Z') });
assert.equal(again.ok, true); assert.equal(again.released, false); assert.equal(again.state, r.state, 'an already-released deal comes back untouched (idempotent)');

for (const contact of [null, { name: 'Pat' }, { email: 'not-an-email' }]) {
  const bad = releaseOnPick(null, { otd: 1, contact, now: NOW });
  assert.equal(bad.ok, false); assert.equal(bad.code, 'no_contact');
}
assert.equal(releaseOnPick(initialStageState({ tradeInExpected: true }), { otd: 43749, contact: CONTACT, now: NOW }).released, true, 'a deal with no stage yet (trade-in expected) releases too');
for (const missing of [null, undefined, '']) assert.equal(releaseOnPick(null, { otd: missing, contact: CONTACT, now: NOW }).state.final.summary.otd, null, 'a missing OTD is recorded as null, not 0');
assert.equal(releaseOnPick(null, { otd: '43749.00', contact: CONTACT, now: NOW }).state.final.summary.otd, 43749, 'a DB decimal string still parses');

const later = applyStageAction(r.state, { type: 'accept_final', actor: 'buyer' }, { buyerContact: CONTACT, now: NOW });
assert.equal(later.ok, false, 'a later accept_final cannot introduce the buyer a second time');
console.log('smoke ok: pick releases once (closed/accepted/released), idempotent, null OTD stays null, needs a reachable email, later accept_final refused');
