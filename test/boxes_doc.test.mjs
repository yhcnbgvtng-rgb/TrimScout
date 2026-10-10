// Guards docs/BOXES.md: it must agree with config/boxes.json, and no retired IP may appear
// anywhere else in the tracked repo. Run: node --test test/boxes_doc.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cfg = JSON.parse(readFileSync(root + "config/boxes.json", "utf-8"));
const doc = readFileSync(root + "docs/BOXES.md", "utf-8");
const deadBlock = doc.match(/<!-- DEAD-IPS:START -->([\s\S]*?)<!-- DEAD-IPS:END -->/);

test("BOXES.md Do-not-use list equals config deadIps", () => {
  assert.ok(deadBlock, "DEAD-IPS markers missing");
  const listed = [...deadBlock[1].matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)].map((m) => m[0]);
  assert.deepEqual([...listed].sort(), [...cfg.deadIps].sort());
});

test("every live box IP in config appears in BOXES.md and none is dead", () => {
  for (const [name, b] of Object.entries(cfg.boxes)) {
    assert.ok(doc.includes(b.host), `${name} host ${b.host} missing from BOXES.md`);
    if (b.privateIp) assert.ok(doc.includes(b.privateIp), `${name} private IP missing from BOXES.md`);
    assert.ok(!cfg.deadIps.includes(b.host), `${name} uses a dead IP`);
  }
});

test("standalone-deployed scripts default to the deals box in config", () => {
  const deals = cfg.boxes[cfg.dealsBox].host;
  for (const f of ["scripts/box/inventory-sync.mjs", "scrapers/lightsail-crawler/src/crawl_claims.js"]) {
    assert.ok(readFileSync(root + f, "utf-8").includes(`|| ${f.endsWith(".mjs") ? '"' : "'"}${deals}`), `${f} default drifted from config`);
  }
});

test("no retired IP appears in any tracked file outside BOXES.md's Do-not-use list", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean);
  const offenders = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(root + f, "utf-8"); } catch { continue; }
    if (f === "docs/BOXES.md") text = text.replace(deadBlock[0], "");
    if (f === "config/boxes.json") continue; // the machine-readable copy of the list
    for (const ip of cfg.deadIps) {
      const re = new RegExp(`(?<![\\d.])${ip.replace(/\./g, "\\.")}(?![\\d])`);
      if (re.test(text)) offenders.push(`${f}: ${ip}`);
    }
  }
  assert.deepEqual(offenders, []);
});
