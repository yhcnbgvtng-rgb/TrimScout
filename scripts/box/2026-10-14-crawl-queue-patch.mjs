#!/usr/bin/env node
// Anchored patcher for the crawl-queue install. The box copies of run-daily-crawl.mjs, inventory-sync.mjs and
// deals_api_server.js have drifted from the repo, so nothing here is a file copy: every edit is one anchor
// { id, file, old, new } from 2026-10-14-crawl-queue-anchors.json, applied only where `old` occurs EXACTLY once.
//
//   node 2026-10-14-crawl-queue-patch.mjs check  <anchors.json> driver=<path> [sync=<path>] [server=<path>]   read-only
//   node 2026-10-14-crawl-queue-patch.mjs apply  <anchors.json> driver=<path> ...    writes (back the files up first)
//   node 2026-10-14-crawl-queue-patch.mjs revert <anchors.json> driver=<path> ...    puts `old` back where `new` is
//
// check/apply/revert are all-or-nothing PER FILE: if any anchor of a file is ambiguous or missing, that file is left
// byte-for-byte untouched and the exit status is 1. apply is idempotent (an already-applied anchor is skipped), and the
// patched text must pass `node --check` before it replaces anything. The anchors can also arrive base64 in
// $ANCHORS_B64 (used by the read-only remote check, so nothing has to be copied to a box to run it).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const count = (s, sub) => { let n = 0; for (let i = s.indexOf(sub); i !== -1; i = s.indexOf(sub, i + sub.length)) n++; return n; };

/**
 * Pure: returns { text, results[], ok } for one file's anchors. mode: check | apply | revert.
 * Whether an anchor is already in place is decided by its `new` text (which may CONTAIN `old`, as the hook insertions do,
 * so counting `old` alone would mistake an applied file for an unpatched one).
 */
export function patchText(text, anchors, mode) {
  const results = []; let out = text; let ok = true;
  const fail = (a, detail) => { ok = false; results.push({ id: a.id, status: "FAIL", detail }); };
  for (const a of anchors) {
    const nNew = count(out, a.new);
    const nOld = count(out, a.old);
    if (mode === "revert") {
      if (nNew === 1) { out = out.replace(a.new, () => a.old); results.push({ id: a.id, status: "REVERTED" }); }
      else if (nNew === 0 && nOld === 1) results.push({ id: a.id, status: "ALREADY-REVERTED" });
      else fail(a, `applied text found ${nNew}x, original ${nOld}x (need the applied text exactly once)`);
      continue;
    }
    if (nNew === 1) results.push({ id: a.id, status: "ALREADY-APPLIED" });
    else if (nNew > 1) fail(a, `applied text found ${nNew}x (ambiguous)`);
    else if (nOld === 1) { if (mode === "apply") out = out.replace(a.old, () => a.new); results.push({ id: a.id, status: mode === "apply" ? "APPLIED" : "PASS" }); }
    else fail(a, `old text found ${nOld}x (need exactly 1): ${a.old.trim().split("\n")[0].slice(0, 80)}`);
  }
  return { text: ok ? out : text, results, ok };
}

function syntaxOk(text, file) {
  const tmp = path.join(os.tmpdir(), `cq-check-${process.pid}-${path.basename(file)}.mjs`); // all three files are ES modules; a .js name would be parsed as CommonJS on older node
  fs.writeFileSync(tmp, text);
  try { execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" }); return null; } catch (e) { return String(e.stderr || e.message).split("\n").slice(0, 4).join(" | "); } finally { fs.rmSync(tmp, { force: true }); }
}

function main() {
  const [mode, anchorsPath, ...targets] = process.argv.slice(2);
  if (!["check", "apply", "revert"].includes(mode) || !targets.length) { console.error("usage: patch.mjs check|apply|revert <anchors.json|-> driver=<path> [sync=<path>] [server=<path>]"); process.exit(2); }
  const anchors = process.env.ANCHORS_B64 ? JSON.parse(Buffer.from(process.env.ANCHORS_B64, "base64").toString("utf-8")) : JSON.parse(fs.readFileSync(anchorsPath, "utf-8"));
  let bad = 0;
  for (const t of targets) {
    const [key, file] = t.split("=");
    const mine = anchors.filter((a) => a.file === key);
    let text;
    try { text = fs.readFileSync(file, "utf-8"); } catch (e) { console.log(`FAIL  ${key}: cannot read ${file}: ${e.code}`); bad++; continue; }
    const r = patchText(text, mine, mode);
    for (const x of r.results) console.log(`${x.status.padEnd(16)}${key}/${x.id}${x.detail ? `  ${x.detail}` : ""}`);
    if (!r.ok) { bad++; console.log(`  -> ${file} left untouched`); continue; }
    if (mode !== "check" && r.text !== text) {
      const err = syntaxOk(r.text, file);
      if (err) { bad++; console.log(`FAIL  ${key}: patched text does not parse (${err}) — ${file} left untouched`); continue; }
      const tmp = `${file}.cq-tmp-${process.pid}`;
      fs.writeFileSync(tmp, r.text, { mode: fs.statSync(file).mode });
      fs.renameSync(tmp, file);
      console.log(`  -> wrote ${file}`);
    }
  }
  process.exit(bad ? 1 : 0);
}
// `node - check ...` (script on stdin, used by the read-only remote check) has argv[1] === "-".
const sameFile = (a, b) => { try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; } }; // /tmp vs /private/tmp on macOS
if (process.argv[1] === "-" || (process.argv[1] && sameFile(process.argv[1], fileURLToPath(import.meta.url)))) main();
