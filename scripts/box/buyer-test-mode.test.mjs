// The deals-box patch for buyer test mode: applies to the LIVE box text (fixture), is idempotent, and flags only full-key test requests.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "2026-10-11-buyer-test-mode.sh");
const fixture = fs.readFileSync(path.join(here, "fixtures/live-rfq-create.js"), "utf8");
const run = (file) => spawnSync("bash", [script], { encoding: "utf8", env: { ...process.env, TEST_ONLY: "1", FILE: file } });
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "btm-")), "deals_api_server.js");

describe("2026-10-11-buyer-test-mode.sh", () => {
  it("patches the live text, then reports already patched (idempotent)", () => {
    const f = tmp();
    fs.writeFileSync(f, fixture);
    const first = run(f);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /patched: columns, mapper, handler, flag row/);
    const once = fs.readFileSync(f, "utf8");
    const second = run(f);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /already patched/);
    assert.equal(fs.readFileSync(f, "utf8"), once);
  });
  it("adds audit / audit_at, honours buyerTestMode for the full key only, and keeps audit_forced_safe for the audit key", () => {
    const f = tmp();
    fs.writeFileSync(f, fixture);
    run(f);
    const s = fs.readFileSync(f, "utf8");
    assert.match(s, /ADD COLUMN IF NOT EXISTS audit TINYINT\(1\) NOT NULL DEFAULT 0/);
    assert.match(s, /ADD COLUMN IF NOT EXISTS audit_at DATETIME NULL/);
    assert.match(s, /const buyerTestMode = !req\.audit && body\.buyerTestMode === true;/);
    assert.match(s, /if \(buyerTestMode\) await pool\.query\("UPDATE rfq_requests SET audit = 1, audit_at = \? WHERE id = \?", \[new Date\(\), result\.insertId\]\);/);
    assert.match(s, /audit: Boolean\(row\.audit\),/);
  });
  it("fails loudly (changes nothing) when the box text has drifted", () => {
    const f = tmp();
    fs.writeFileSync(f, fixture.replace("audit_forced_safe TINYINT(1)", "audit_forced_safe TINYINT(2)"));
    const before = fs.readFileSync(f, "utf8");
    const r = run(f);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /columns: expected exactly 1 match/);
    assert.equal(fs.readFileSync(f, "utf8"), before);
  });
  it("contains no restart outside the real (non-TEST_ONLY) path", () => {
    const sh = fs.readFileSync(script, "utf8");
    assert.ok(sh.indexOf('if [ "${TEST_ONLY:-0}" = "1" ]; then exit 0; fi') < sh.lastIndexOf("pm2 restart"));
  });
});
