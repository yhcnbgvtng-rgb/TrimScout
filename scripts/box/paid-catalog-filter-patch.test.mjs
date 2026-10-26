// Runs the box2 patcher (2026-10-26-paid-catalog-filter.mjs) against a stand-in for the box's src dir: this repo's src with the patcher's own edits reversed
// (replacement -> anchor, new module removed). Tests the real anchors and stays valid after the PR merges.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PATCHER = fileURLToPath(new URL("./2026-10-26-paid-catalog-filter.mjs", import.meta.url));
const SRC = fileURLToPath(new URL("../../scrapers/lightsail-crawler/src/", import.meta.url));
const text = fs.readFileSync(PATCHER, "utf8");
const edits = JSON.parse(text.slice(text.indexOf("const EDITS =\n") + "const EDITS =\n".length, text.indexOf("\n;\nfor (const e of EDITS)")));
let box;
const run = (...a) => spawnSync(process.execPath, [PATCHER, `--dir=${box}`, ...a], { encoding: "utf8" });

before(() => {
  box = fs.mkdtempSync(path.join(os.tmpdir(), "paidcat-box-"));
  fs.cpSync(SRC, box, { recursive: true });
  let t = fs.readFileSync(path.join(SRC, "deals_api_server.js"), "utf8");
  for (const e of [...edits].reverse()) {
    assert.equal(t.split(e.replace).length - 1, 1, `${e.id}: replacement not found exactly once in the repo file`);
    t = t.replace(e.replace, () => e.find);
  }
  fs.writeFileSync(path.join(box, "deals_api_server.js"), t);
  fs.rmSync(path.join(box, "paidCatalogFilter.js"));
});
after(() => fs.rmSync(box, { recursive: true, force: true }));

describe("2026-10-26-paid-catalog-filter.mjs", () => {
  it("dry run checks every anchor and writes nothing", () => {
    const before = fs.readFileSync(path.join(box, "deals_api_server.js"), "utf8");
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DRY RUN ok/);
    assert.equal(fs.readFileSync(path.join(box, "deals_api_server.js"), "utf8"), before);
    assert.equal(fs.existsSync(path.join(box, "paidCatalogFilter.js")), false);
  });
  it("--apply reproduces the repo file, installs the module, keeps a backup, and a second run changes nothing", () => {
    const r = run("--apply");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(box, "deals_api_server.js"), "utf8"), fs.readFileSync(path.join(SRC, "deals_api_server.js"), "utf8"));
    assert.equal(fs.readFileSync(path.join(box, "paidCatalogFilter.js"), "utf8"), fs.readFileSync(path.join(SRC, "paidCatalogFilter.js"), "utf8"));
    assert.ok(fs.readdirSync(box).some((f) => f.startsWith("deals_api_server.js.bak.")));
    const again = run();
    assert.match(again.stdout, /already applied/);
  });
  it("aborts without writing when an anchor is missing", () => {
    const p = path.join(box, "deals_api_server.js");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("paidCatalogRows(optionRows)", "x(optionRows)").replace("paidCatalogRows(optionRows)", "x(optionRows)").replace('import { paidCatalogRows } from "./paidCatalogFilter.js";', ""));
    const r = run("--apply");
    assert.equal(r.status, 2);
  });
});
