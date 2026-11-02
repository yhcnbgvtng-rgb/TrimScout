// READ-ONLY smoke test of the shared reachability module the box gets: imports quoteReachable.js from DIR and checks the audit cases. No DB, no network, no writes.
//   node smoke.mjs DIR
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const dir = path.resolve(process.argv[2] || ".");
const m = await import(pathToFileURL(path.join(dir, "quoteReachable.js")).href);
for (const fn of ["isQuoteReachable", "reachabilityBucket", "stampGroupDomains"]) assert.equal(typeof m[fn], "function", `${fn} exported`);
assert.equal(m.reachabilityBucket({ contactEmail: "accessibility@hmausa.com" }), "none");
assert.equal(m.reachabilityBucket({ contactEmail: "jdoe@gmail.com" }), "unverified");
assert.equal(m.reachabilityBucket({ contactEmail: "jdoe@lafontaine.com", dealerName: "LaFontaine Chrysler Dodge Jeep Ram of Walled Lake", website: "lafontainecdjrwalledlake.com" }), "reachable");
assert.equal(m.reachabilityBucket({ contactEmail: "jdoe@lafontaine.com", dealerName: "LaFontaine Chrysler Dodge Jeep Ram of Walled Lake", website: "lafontainecdjrwalledlake.com", emailOptOut: true }), "none");
const rc = await import(pathToFileURL(path.join(dir, "reachableCoverage.js")).href);
for (const fn of ["bucketsFromDirectory", "overlayReachable", "withReachableCoverage", "scopeSql"]) assert.equal(typeof rc[fn], "function", `${fn} exported`);
const out = rc.overlayReachable({ coverage: { dealers: 3 }, dom: { byDealer: [{ dealerId: 1 }] } }, [1, 2], rc.bucketsFromDirectory([{ id: 1, dealerName: "X", contactEmail: "a@gmail.com", emailOptOut: 0 }, { id: 2, dealerName: "Y", contactEmail: "accessibility@hmausa.com", emailOptOut: 0 }]));
assert.equal(out.coverage.dealersUnverified, 1); assert.equal(out.coverage.dealersReachable, 0); assert.equal(out.dom.byDealer[0].emailStatus, "unverified");
console.log("smoke ok: quoteReachable.js answers the audit cases, reachableCoverage.js overlays them");
