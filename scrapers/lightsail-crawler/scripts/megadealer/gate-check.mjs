#!/usr/bin/env node
// Gate check with the PRODUCTION probe (src/http_probe.js: honest UA, plain node:https, no impersonation).
// Reads every dealer file in <dir> (except jobs.json), probes each store once per probe URL the nightly uses,
// prints one line per store and writes <dir>/gate.json. Exit 0 always; the orchestrator reads gate.json.
//   node scripts/megadealer/gate-check.mjs <dealersDir>
import fs from "node:fs";
import path from "node:path";
import { probeDealer } from "../../src/http_probe.js";
const dir = process.argv[2];
if (!dir) throw new Error("usage: gate-check.mjs <dealersDir>");
const out = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "jobs.json" && x !== "gate.json").sort()) {
  for (const d of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
    const r = await probeDealer(d);
    const ready = r.classification === "NONE" && Number(r.httpStatus) === 200;
    out.push({ file: f, id: d.id, name: d.name, state: d.state, domain: d.domain, classification: r.classification, httpStatus: r.httpStatus, waf: r.wafVendor || null, ready });
    console.log(`${ready ? "PASS" : "SKIP"} ${d.name} (${d.state}) ${r.classification} ${r.httpStatus ?? ""} ${r.wafVendor || ""}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
}
fs.writeFileSync(path.join(dir, "gate.json"), JSON.stringify(out, null, 1));
console.log(`gate: ${out.filter((x) => x.ready).length}/${out.length} ready`);
