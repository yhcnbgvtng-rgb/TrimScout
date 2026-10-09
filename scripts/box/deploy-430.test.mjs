// deploy-430.sh is a READ-ONLY pre-flight. Proves it passes on the unpatched code, reports "applied" on the
// patched code, fails loudly on drift, and that it contains no write/restart commands.
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "deploy-430.sh");
const anchorsPath = path.join(here, "deploy-430.anchors.json");
const src = (f) => fs.readFileSync(path.join(here, "../../scrapers/lightsail-crawler/src", f), "utf8");
const anchors = JSON.parse(fs.readFileSync(anchorsPath, "utf8"));
const run = (deals, auth) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "d430-"));
  fs.writeFileSync(path.join(d, "deals.js"), deals);
  fs.writeFileSync(path.join(d, "auth.js"), auth);
  const r = spawnSync("bash", [script], { encoding: "utf8", env: { ...process.env, DEALS_FILE: path.join(d, "deals.js"), AUTH_FILE: path.join(d, "auth.js"), ANCHORS: anchorsPath } });
  return { ...r, dir: d };
};
// The unpatched text: take the patched file and put every anchor's `old` back (inverse of the patch).
const unpatch = (key, text) => {
  let s = text;
  for (const a of anchors.filter((x) => x.file === key).reverse()) {
    assert.equal(s.split(a.new).length - 1 >= 1, true, `${a.id}: new text missing from patched source`);
    s = s.replace(a.new, a.old);
  }
  return s;
};

describe("deploy-430.sh anchors", () => {
  it("has anchors for both files, each with distinct old/new text", () => {
    assert.ok(anchors.filter((a) => a.file === "deals").length > 20);
    assert.ok(anchors.filter((a) => a.file === "auth").length >= 3);
    for (const a of anchors) assert.notEqual(a.old, a.new, a.id);
  });
  it("patched source (this PR): every anchor reports PASS (applied), exit 0", () => {
    const r = run(src("deals_api_server.js"), src("auth_api_server.js"));
    assert.equal(r.status, 0, r.stdout);
    assert.equal((r.stdout.match(/^PASS \(applied\)/gm) || []).length, anchors.length);
    assert.doesNotMatch(r.stdout, /^FAIL/m);
  });
  it("unpatched source: every anchor reports plain PASS (anchorable exactly once), exit 0", () => {
    const r = run(unpatch("deals", src("deals_api_server.js")), unpatch("auth", src("auth_api_server.js")));
    assert.equal(r.status, 0, r.stdout);
    assert.equal((r.stdout.match(/^PASS  /gm) || []).length, anchors.length, r.stdout);
    assert.doesNotMatch(r.stdout, /^FAIL|^PASS \(applied\)/m);
  });
  it("drifted source: the affected anchor prints FAIL with the reason, others still print, exit 1", () => {
    const base = unpatch("deals", src("deals_api_server.js"));
    const victim = anchors.find((a) => a.file === "deals");
    const drifted = base.replace(victim.old, victim.old.replace(/\w+/, "DRIFTED"));
    const r = run(drifted, unpatch("auth", src("auth_api_server.js")));
    assert.equal(r.status, 1);
    assert.match(r.stdout, new RegExp(`^FAIL  ${victim.id}  old text found 0x`, "m"));
    assert.ok((r.stdout.match(/^PASS  /gm) || []).length >= anchors.length - 3, "other anchors unaffected");
  });
  it("an ambiguous anchor (text appears twice) is a FAIL, not a guess", () => {
    const base = unpatch("deals", src("deals_api_server.js"));
    const victim = anchors.find((a) => a.file === "deals");
    const r = run(base + "\n" + victim.old + "\n", unpatch("auth", src("auth_api_server.js")));
    assert.equal(r.status, 1);
    assert.match(r.stdout, new RegExp(`^FAIL  ${victim.id}  old text found 2x`, "m"));
  });
  it("a missing file is a FAIL for the file and all its anchors", () => {
    const r = spawnSync("bash", [script], { encoding: "utf8", env: { ...process.env, DEALS_FILE: "/nonexistent/x.js", AUTH_FILE: "/nonexistent/y.js", ANCHORS: anchorsPath } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^FAIL  deals +cannot read/m);
  });
  it("changes nothing: the checked files are byte-identical afterwards", () => {
    const r = run(src("deals_api_server.js"), src("auth_api_server.js"));
    assert.equal(fs.readFileSync(path.join(r.dir, "deals.js"), "utf8"), src("deals_api_server.js"));
    assert.equal(fs.readFileSync(path.join(r.dir, "auth.js"), "utf8"), src("auth_api_server.js"));
    assert.deepEqual(fs.readdirSync(r.dir).sort(), ["auth.js", "deals.js"]);
  });
  it("the script contains no write, copy, restart or network command", () => {
    const sh = fs.readFileSync(script, "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    for (const bad of [/\bsudo\b/, /\bcp\b/, /\bmv\b/, /\brm\b/, /sed\s+-i/, /\btee\b/, /\bpm2\b/, /systemctl/, /\bcurl\b/, /\bwget\b/, /\bmysql/, /open\([^)]*['"][wa]/, /\.write\(/, />>?\s*[\w$"'/.]/]) {
      assert.doesNotMatch(sh, bad);
    }
  });
});
