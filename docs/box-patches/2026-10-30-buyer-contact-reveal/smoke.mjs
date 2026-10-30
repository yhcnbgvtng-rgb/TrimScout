// READ-ONLY smoke test of the buyer-contact reveal modules: imports dealStages.js and rfqContactReveal.js from DIR (and every other module in DIR that imports
// dealStages.js, so a renamed or removed export fails here, not at pm2 start-up), then exercises the pure reveal rule and the handler's own refusal. No DB, no network, no writes.
//   node smoke.mjs DIR
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const dir = path.resolve(process.argv[2] || ".");
const load = (f) => import(pathToFileURL(path.join(dir, f)).href);

const stages = await load("dealStages.js");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js") && x !== "deals_api_server.js" && x !== "dealStages.js")) {
  if (fs.readFileSync(path.join(dir, f), "utf8").includes("dealStages.js")) await load(f); // fails on a missing named export
}
const { createRfqContactRevealHandler } = await load("rfqContactReveal.js");
assert.equal(typeof createRfqContactRevealHandler, "function");

const contact = { name: "Smoke Buyer", email: "smoke@example.invalid", phone: "555-0100" };
const closed = { stage: "closed", final: { status: "accepted" }, release: { at: "2026-10-30T12:00:00.000Z", contact }, log: [] };

// the pure rule: reveals only a finally accepted, released deal, stamps it, and logs without the details
const ok = stages.revealContact(closed, new Date("2026-10-30T13:00:00Z"));
assert.equal(ok.ok, true);
assert.deepEqual(ok.contact, contact);
assert.equal(ok.state.release.reveals.count, 1);
assert.ok(!JSON.stringify(ok.state.log).includes(contact.email), "the log never carries the details");
assert.equal(stages.revealContact({ ...closed, final: { status: "open" } }).ok, false);
assert.equal(stages.revealContact({ ...closed, release: null }).ok, false);
assert.equal(stages.revealContact(null).ok, false);
// a dealer-facing view never carries the details, not even the winner's
assert.ok(!JSON.stringify(stages.stageForDealer(closed)).includes(contact.email));

// the handler's own gate: the audit buyer key is refused before any database call
let sent = null;
const handler = createRfqContactRevealHandler({
  getPool: () => { throw new Error("no database in the smoke test"); },
  sendJson: (_res, status, body) => { sent = { status, body }; },
  ensureColumns: async () => {}, logRfqEvent: async () => {}, auditKind: () => "audit",
});
await handler({}, {}, 1, 1);
assert.equal(sent.status, 403);
console.log("smoke ok: dealStages.js + rfqContactReveal.js load, reveal rule and audit refusal behave, no contact in logs or dealer views");
