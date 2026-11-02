// Runs the cleanup script's dry run end to end against a fake mysql2 and checks what it asks the database and what it prints.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bundle = path.join(root, "scripts/box/contact-email-cleanup-bundle.sh");
const SECRET_PW = "hunter2-do-not-print";

// 1,200 directory rows (three batches of 500, 500, 200). A few have problems; ids 5, 10, 30 and 1100 end with no reachable email.
function directory() {
  const rows = [];
  for (let id = 1; id <= 1200; id++) {
    rows.push({ id, dealerName: `Good${id} Motors`, contactEmail: `sales@good${id}motors.com`, notes: null, website: `good${id}motors.com`, domainsJson: null, emailOptOut: 0 });
  }
  rows[4] = { ...rows[4], contactEmail: "info@good5motors.com" };                                  // department -> cleared, loses its only reachable email
  rows[1099] = { ...rows[1099], contactEmail: "leads@eleadtrack.net" };                           // vendor -> cleared, loses it too
  rows[9] = { ...rows[9], contactEmail: "logo@2x.png" };                                           // junk file name
  rows[19] = { ...rows[19], contactEmail: null, notes: "Lead inbox: Sales@good20motors.com" };    // moved from notes
  rows[29] = { ...rows[29], contactEmail: null, notes: null };                                     // nothing at all
  // a dealer group's shared mailbox domain: valid only while two rooftops use it, so clearing one's department inbox strips the other
  rows[39] = { ...rows[39], dealerName: "Alpha Store", website: null, contactEmail: "mia@groupco.com" };
  rows[40] = { ...rows[40], dealerName: "Beta Store", website: null, contactEmail: "info@groupco.com" };
  return rows;
}

function setup() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cec-test-"));
  const app = path.join(work, "app");
  fs.mkdirSync(path.join(app, "node_modules/mysql2"), { recursive: true });
  fs.writeFileSync(path.join(app, "package.json"), "{}");
  fs.writeFileSync(path.join(app, ".env.trimscout-db"), `DB_HOST=h\nDB_NAME=n\nDB_READER_USER=r\nDB_READER_PASSWORD=${SECRET_PW}\nDB_WRITER_USER=w\nDB_WRITER_PASSWORD=${SECRET_PW}\n`);
  fs.writeFileSync(path.join(app, "node_modules/mysql2/package.json"), JSON.stringify({ name: "mysql2", main: "index.js", exports: { "./promise": "./promise.js" } }));
  const log = path.join(work, "queries.jsonl");
  fs.writeFileSync(path.join(app, "node_modules/mysql2/promise.js"), `
const fs = require("fs");
const rows = ${JSON.stringify(directory())};
const live = new Set([5, 20]);
exports.createConnection = async () => ({
  async query(sql, params) {
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ sql, params }) + "\\n");
    if (/FROM dealership_contacts WHERE id > \\? AND is_test = 0 ORDER BY id LIMIT \\?/.test(sql)) {
      return [rows.filter((r) => r.id > params[0]).slice(0, params[1])];
    }
    if (/FROM dealer_inventory WHERE dealer_id = \\? AND removed_at IS NULL LIMIT 1/.test(sql)) return [live.has(params[0]) ? [{ 1: 1 }] : []];
    if (/^SET SESSION/.test(sql)) return [[]];
    throw new Error("unexpected query: " + sql);
  },
  async end() {},
});
`);
  const out = path.join(work, "cec");
  execFileSync(bundle, [out]);
  return { work, app, log, out };
}

const run = (t, extra = []) => spawnSync("node", [path.join(t.out, "2026-10-30-contact-email-cleanup.mjs"), ...extra], { cwd: t.app, encoding: "utf8" });
const queries = (t) => fs.readFileSync(t.log, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("bundle holds the script and both modules, so nothing is needed from the app's src/", () => {
  const t = setup();
  assert.deepEqual(fs.readdirSync(t.out).sort(), ["2026-10-30-contact-email-cleanup.mjs", "contactEmailCleanup.js", "quoteReachable.js"]);
  assert.equal(fs.existsSync(path.join(t.app, "src")), false);
});

test("dry run reads dealership_contacts in primary-key batches of 500 with a 10 s cap, and never writes", () => {
  const t = setup();
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  const q = queries(t);
  assert.equal(q[0].sql, "SET SESSION max_statement_time=10");
  assert.equal(q[1].sql, "SET SESSION TRANSACTION READ ONLY");
  const reads = q.filter((x) => /FROM dealership_contacts/.test(x.sql));
  assert.deepEqual(reads.map((x) => x.params), [[0, 500], [500, 500], [1000, 500]]);
  for (const x of reads) assert.match(x.sql, /WHERE id > \? AND is_test = 0 ORDER BY id LIMIT \?/);
  assert.equal(q.some((x) => /^\s*(UPDATE|INSERT|DELETE|ALTER|CREATE|DROP|EXPLAIN)/i.test(x.sql)), false);
  assert.equal(q.some((x) => /sync-lock/.test(x.sql)), false);
});

test("inventory is only probed one dealer at a time, and only for dealers the plan touches", () => {
  const t = setup();
  run(t);
  const inv = queries(t).filter((x) => /dealer_inventory/.test(x.sql));
  assert.ok(inv.length > 0 && inv.length <= 8, `expected a handful of lookups, got ${inv.length}`);
  for (const x of inv) assert.match(x.sql, /WHERE dealer_id = \? AND removed_at IS NULL LIMIT 1$/);
  assert.ok(inv.every((x) => [5, 10, 20, 40, 41, 1100].includes(x.params[0])));
});

test("prints counts only, including dealers left with no reachable email, and no address, name or secret", () => {
  const t = setup();
  const r = run(t);
  assert.match(r.stdout, /directory rows checked 1,200/);
  assert.match(r.stdout, /Would CLEAR 4 stored addresses \(1 on rooftops with cars on the lot\): department_mailbox 2, junk_file_name 1, vendor_or_oem_domain 1/);
  assert.match(r.stdout, /Would MOVE  1 addresses from notes into contact_email \(1 on rooftops/);
  assert.match(r.stdout, /Reachable email, today 1,194 -> after cleanup 1,194/);   // +1 rescued from notes (id 20), -1 group mailbox stripped (id 40)
  const m = r.stdout.match(/Dealers left with NO reachable email after cleanup: ([\d,]+) \(of which ([\d,]+) have one today and would lose it; ([\d,]+) of those/);
  assert.ok(m, r.stdout);
  assert.equal(m[1], "6");   // ids 5, 10, 30, 40 (group mailbox stripped), 41 (info@ cleared), 1100
  assert.equal(m[2], "1");   // only 40 had a working address today and loses it
  const all = r.stdout + r.stderr;
  assert.doesNotMatch(all, /@[a-z0-9-]+\./i);
  assert.doesNotMatch(all, /good\d+ motors|hunter2/i);
  assert.equal(all.includes(SECRET_PW), false);
});

test("--write-plan writes ids, kinds and fingerprints only, and refuses a path inside the app folder", () => {
  const t = setup();
  const planFile = path.join(t.work, "plan.json");
  const r = run(t, [`--write-plan=${planFile}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Plan written to .*: 5 rows \(ids, kinds and fingerprints only, no addresses\)/);
  const raw = fs.readFileSync(planFile, "utf8");
  assert.doesNotMatch(raw, /@/);
  const plan = JSON.parse(raw);
  assert.deepEqual(plan.clear.map((x) => x.id), [5, 10, 41, 1100]);
  assert.deepEqual(plan.move.map((x) => x.id), [20]);
  assert.equal((fs.statSync(planFile).mode & 0o777).toString(8), "600");
  const bad = run(t, [`--write-plan=${path.join(t.app, "plan.json")}`]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Refusing to write the plan inside the working directory/);
});

test("write modes still refuse without their gates", () => {
  const t = setup();
  assert.equal(run(t, ["--apply"]).status, 1);
  assert.match(run(t, ["--apply", "--go"]).stderr, /without --fleet-idle/);
  assert.match(run(t, ["--apply", "--fleet-idle"]).stderr, /without --go/);
  assert.match(run(t, ["--apply", "--fleet-idle", "--go"]).stderr, /--apply needs --plan=/);
});
