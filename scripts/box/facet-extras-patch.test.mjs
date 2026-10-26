// The box patcher for the catalog facet extras: up to date, applies to the "before" files, reproduces the repo files exactly, restores, and refuses on drift.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildPatcher, PATCHER_PATH } from "./gen-facet-extras-patch.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "../../scrapers/lightsail-crawler/src");
const EDITS = JSON.parse(fs.readFileSync(path.join(here, "facet-extras-edits.json"), "utf8"));
const sha = (p) => crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
const run = (dir, ...flags) => spawnSync(process.execPath, [PATCHER_PATH, `--dir=${dir}`, ...flags], { encoding: "utf8" });
const snapshot = (dir) => Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, fs.statSync(path.join(dir, f)).isFile() ? sha(path.join(dir, f)) : "dir"]));

// The box's files BEFORE the patch = the repo files with every edit reversed.
function reverse(file) {
  let t = fs.readFileSync(path.join(SRC, file), "utf8");
  for (const e of [...EDITS].reverse().filter((x) => x.file === file)) {
    assert.equal(t.split(e.replace).length - 1, 1, `${e.id}: replacement not found exactly once in the repo file`);
    t = t.replace(e.replace, () => e.find);
  }
  return t;
}
function freshBoxDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boxdir-"));
  for (const f of fs.readdirSync(SRC)) if (/\.(js|json)$/.test(f)) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.rmSync(path.join(dir, "facetExtras.js"));
  for (const f of ["deals_api_server.js", "inventoryListQuery.js"]) fs.writeFileSync(path.join(dir, f), reverse(f));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
  return dir;
}

describe("facet extras box patcher", () => {
  const dirs = [];
  after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
  const mk = () => { const d = freshBoxDir(); dirs.push(d); return d; };

  it("the checked-in patcher is what the generator produces", () => {
    assert.equal(fs.readFileSync(PATCHER_PATH, "utf8"), buildPatcher());
  });
  it("every marker is absent from the 'before' files and every find occurs exactly once there", () => {
    const base = { "deals_api_server.js": reverse("deals_api_server.js"), "inventoryListQuery.js": reverse("inventoryListQuery.js") };
    let cur = { ...base };
    for (const e of EDITS) {
      assert.equal(cur[e.file].split(e.marker).length - 1, 0, `${e.id}: marker already present`);
      assert.equal(cur[e.file].split(e.find).length - 1, 1, `${e.id}: find not unique`);
      cur[e.file] = cur[e.file].replace(e.find, () => e.replace);
    }
  });
  it("dry run passes and writes nothing", () => {
    const dir = mk(); const before = snapshot(dir);
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /DRY RUN ok - nothing written/);
    assert.match(r.stdout, /flag defaults OFF/);
    assert.deepEqual(snapshot(dir), before);
  });
  it("apply reproduces the repo files byte for byte, backs up the originals, and the restore recipe puts them back", () => {
    const dir = mk(); const origSha = { a: sha(path.join(dir, "deals_api_server.js")), b: sha(path.join(dir, "inventoryListQuery.js")) };
    const r = run(dir, "--apply");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    for (const f of ["deals_api_server.js", "inventoryListQuery.js", "facetExtras.js"]) assert.equal(sha(path.join(dir, f)), sha(path.join(SRC, f)), `${f} differs from the repo`);
    const baks = fs.readdirSync(dir).filter((f) => /\.bak\.\d{14}$/.test(f));
    assert.deepEqual(baks.map((f) => f.replace(/\.bak\..*/, "")).sort(), ["deals_api_server.js", "inventoryListQuery.js"]);
    assert.equal(sha(path.join(dir, baks.find((f) => f.startsWith("deals_api")))), origSha.a);
    assert.equal(sha(path.join(dir, baks.find((f) => f.startsWith("inventoryList")))), origSha.b);
    assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith(".new.mjs")), "temp files left behind");
    const again = run(dir);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already applied/);
    // restore
    const stamp = baks[0].match(/\.bak\.(\d{14})$/)[1];
    for (const f of ["deals_api_server", "inventoryListQuery"]) fs.copyFileSync(path.join(dir, `${f}.js.bak.${stamp}`), path.join(dir, `${f}.js`));
    fs.rmSync(path.join(dir, "facetExtras.js"));
    assert.equal(sha(path.join(dir, "deals_api_server.js")), origSha.a);
    assert.equal(sha(path.join(dir, "inventoryListQuery.js")), origSha.b);
  });
  it("refuses, writing nothing, when the box's text differs at an anchor", () => {
    const dir = mk();
    const p = path.join(dir, "deals_api_server.js");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("const PAID_ONLY = paidOnlyEnabled();", "const PAID_ONLY = somethingElse();"));
    const before = snapshot(dir);
    const r = run(dir, "--apply");
    assert.equal(r.status, 2);
    assert.match(r.stdout, /ANCHOR PROBLEM/);
    assert.deepEqual(snapshot(dir), before);
  });
  it("refuses when the options-paid-only patch is not installed", () => {
    const dir = mk(); fs.rmSync(path.join(dir, "optionsPaidOnlyServer.js"));
    const r = run(dir, "--apply");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /options-paid-only/);
  });
});
