#!/usr/bin/env node
// Merge a brand's full locator roster (scrapers/dealer-rosters/<brand>/roster_raw.json, from that brand's crawl_locator.py) into the crawler's
// in-repo OEM dump (dealers/oem-dumps/<brand>.json), for the listed states only. The dump is what dealers/<st>/<brand>.json is generated from
// (oem_locator.js -> write-<st>-dealer-files.mjs); a state missing from the dump means an empty roster and a brand job that is skipped silently.
//
//   node scripts/merge-roster-into-oem-dump.mjs --brand kia --states AR,MI,LA,DE [--roster ../dealer-rosters/kia/roster_raw.json] [--dry-run]
//
// Rows for the listed states are REPLACED by the roster's; every other row in the dump is kept byte-for-byte. Prints counts per state
// against the roster and every roster row it could not use (no dealer website, or an OEM marketing host).
import fs from "node:fs";
import path from "node:path";
import { mergeRosterIntoDump } from "../src/rosterMerge.js";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const brand = opt("brand");
const states = (opt("states") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
if (!brand || !states.length) { console.error("usage: --brand <slug> --states AR,MI,... [--roster path] [--dry-run]"); process.exit(2); }
const root = path.resolve(import.meta.dirname, "..");
const rosterPath = path.resolve(opt("roster", path.join(root, "..", "dealer-rosters", brand, "roster_raw.json")));
const dumpPath = path.join(root, "dealers", "oem-dumps", `${brand}.json`);
const makeName = brand.replace(/(^|-)([a-z])/g, (_, a, b) => (a ? "-" : "") + b.toUpperCase());

const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
const dump = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
const { rows, report } = mergeRosterIntoDump({ dump, roster, states, make: makeName });
console.log(JSON.stringify(report, null, 2));
if (!args.includes("--dry-run")) fs.writeFileSync(dumpPath, `${JSON.stringify(rows, null, 2)}\n`);
