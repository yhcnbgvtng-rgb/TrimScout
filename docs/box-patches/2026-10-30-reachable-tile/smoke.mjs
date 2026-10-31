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
console.log("smoke ok: quoteReachable.js answers the audit cases");
