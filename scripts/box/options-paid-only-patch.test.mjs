// Runs the box2 patcher (2026-10-19-options-paid-only.mjs) against a stand-in for the box's src dir: this repo's src with the patcher's own edits
// reversed (replacement -> anchor, new module removed). So it tests the real anchors, and stays valid after the PR merges.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PATCHER = fileURLToPath(new URL("./2026-10-19-options-paid-only.mjs", import.meta.url));
const SRC = fileURLToPath(new URL("../../scrapers/lightsail-crawler/src/", import.meta.url));
const text = fs.readFileSync(PATCHER, "utf8");
const edits = JSON.parse(text.slice(text.indexOf("const EDITS =\n") + "const EDITS =\n".length, text.indexOf("\n;\nfor (const e of EDITS)")));
const FILES = [...new Set(edits.map((e) => e.file))];

let box;
const run = (...a) => spawnSync(process.execPath, [PATCHER, `--dir=${box}`, ...a], { encoding: "utf8" });
const read = (f) => fs.readFileSync(path.join(box, f), "utf8");

before(() => {
  box = fs.mkdtempSync(path.join(os.tmpdir(), "paidonly-box-"));
  fs.cpSync(SRC, box, { recursive: true });
  for (const f of FILES) {
    let t = fs.readFileSync(path.join(SRC, f), "utf8");
    for (const e of [...edits.filter((x) => x.file === f)].reverse()) {
      assert.equal(t.split(e.replace).length - 1, 1, `${e.id}: replacement not found exactly once in the repo file`);
      t = t.replace(e.replace, () => e.find);
    }
    fs.writeFileSync(path.join(box, f), t);
  }
  fs.rmSync(path.join(box, "optionsPaidOnlyServer.js"), { force: true });
});
after(() => fs.rmSync(box, { recursive: true, force: true }));

describe("2026-10-19-options-paid-only.mjs", () => {
  it("dry run (the default): every edit 'will apply', smoke checks pass, nothing is written", () => {
    const before = Object.fromEntries(FILES.map((f) => [f, read(f)]));
    const r = run();
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /DRY RUN ok - nothing written/);
    assert.match(r.stdout, /flag defaults OFF and flag-off output is unchanged/);
    assert.equal((r.stdout.match(/will apply/g) || []).length, edits.length);
    for (const f of FILES) assert.equal(read(f), before[f]);
    assert.ok(!fs.existsSync(path.join(box, "optionsPaidOnlyServer.js")));
    assert.equal(fs.readdirSync(box).filter((f) => /\.bak\./.test(f)).length, 0);
  });

  it("--apply: a .bak of each patched file, files equal the repo's, new module installed, no restart, flag not set", () => {
    const originals = Object.fromEntries(FILES.map((f) => [f, read(f)]));
    const r = run("--apply");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /has NOT been restarted and OPTIONS_PAID_ONLY was not set/);
    for (const f of FILES) {
      assert.equal(read(f), fs.readFileSync(path.join(SRC, f), "utf8"), `${f} equals the repo's file`);
      const baks = fs.readdirSync(box).filter((n) => n.startsWith(`${f}.bak.`));
      assert.equal(baks.length, 1, `${f} has one backup`);
      assert.equal(fs.readFileSync(path.join(box, baks[0]), "utf8"), originals[f], `${f} backup is the original`);
    }
    assert.equal(read("optionsPaidOnlyServer.js"), fs.readFileSync(path.join(SRC, "optionsPaidOnlyServer.js"), "utf8"));
    assert.ok(!fs.readdirSync(box).some((n) => n.endsWith(".new.mjs")), "no temp files left");
  });

  it("re-running is a no-op ('already applied'), and a restore from the backups returns the original", () => {
    const r = run("--apply");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal((r.stdout.match(/already applied/g) || []).length, edits.length);
    assert.match(r.stdout, /already installed, unchanged/);
    for (const f of FILES) for (const n of fs.readdirSync(box)) if (n.startsWith(`${f}.bak.`)) fs.copyFileSync(path.join(box, n), path.join(box, f));
    const dry = run();
    assert.equal((dry.stdout.match(/will apply/g) || []).length, edits.length, "after restoring the backups every edit applies again");
  });

  it("aborts without writing when an anchor does not match the box's file", () => {
    const f = path.join(box, "deals_api_server.js");
    fs.writeFileSync(f, read("deals_api_server.js").replace("const RETAIL_ONLY_FACETS", "const RETAIL_ONLY_FACETS_X"));
    const r = run("--apply");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /ABORT: nothing written/);
  });

  it("refuses to run without the sync-option-clean prerequisite", () => {
    fs.rmSync(path.join(box, "syncOptionClean.js"), { force: true });
    const r = run();
    assert.equal(r.status, 2);
    assert.match(r.stderr, /syncOptionClean\.js is missing/);
  });
});
