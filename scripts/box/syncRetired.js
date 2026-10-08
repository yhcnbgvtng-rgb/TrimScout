// Which VINs a sync stopped vouching for, kept for a week so the NEXT syncs can say how many of them came back.
//
// Why: the sweep itself is one UPDATE on the deals box (see inventorySweep.js) and reports only a count, and a car that
// is re-uploaded later has its removed_at cleared — so after the fact nothing in the database says "this VIN was retired
// on the 8th and was back on the 9th". These files are that record. Pure functions + two small file helpers, no
// network and no database: the sync client already knows, from its own shard files, which records it did not upload.
//
// What "retired" means here: a record in this box's shard files for a store that WAS swept this run (it uploaded at least
// one fresh row, its shard was complete) whose (VIN, store) was not uploaded — the crawl marked it SOLD_OR_REMOVED, or
// it is ACTIVE but stale. The sweep retires those rows when they are still in stock in the database. It is the part of the
// retired set this client can know; rows the database holds that are in no shard file are not listed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

export const COLUMNS = ["vin", "dealer", "state", "sourceBox"];
export const DEFAULT_DIR = path.join(os.homedir(), "sweep-retired");
export const WINDOW_DAYS = 7;
export const KEEP_DAYS = 14;
const DAY = 86_400_000;
const FILE_RE = /^retired-(\d{8}T\d{6}Z)-.+\.csv\.gz$/;

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Minimal CSV line parser for the lines this module writes (quotes doubled inside quoted cells). */
export function parseCsvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Records the sync read but did not upload, kept only if the crawl touched them recently (bounded, not the whole history). */
export function isRecentDrop(rec, nowMs, windowMs = WINDOW_DAYS * DAY) {
  const t = Date.parse(rec && rec.updatedAt);
  return Number.isFinite(t) && t >= nowMs - windowMs;
}

/**
 * @param {{vin: string, dealerId: number|null, dealerName: string, state: string}[]} dropped  candidates (not uploaded)
 * @param {{vin: string, dealerId: number|null}[]} uploaded  the rows this run uploads
 * @param {Set<number>} swept  store ids actually swept (not excluded, not failed)
 */
export function retiredList(dropped, uploaded, swept) {
  const up = new Set(uploaded.map((r) => `${r.vin}:${r.dealerId ?? 0}`));
  const seen = new Set();
  const out = [];
  for (const d of dropped) {
    if (!d.dealerId || !swept.has(d.dealerId)) continue;
    const key = `${d.vin}:${d.dealerId}`;
    if (up.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

export function toCsv(list, sourceBox) {
  const lines = [COLUMNS.join(",")];
  for (const d of list) lines.push([d.vin, d.dealerName, d.state, sourceBox].map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/** Writes retired-<UTC stamp>-<box>.csv.gz (temp file + rename), prunes files older than KEEP_DAYS. Returns the path. */
export function writeRetiredFile(dir, list, sourceBox, nowMs = Date.now()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `retired-${stamp(nowMs)}-${String(sourceBox).replace(/[^A-Za-z0-9_-]/g, "")}.csv.gz`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, zlib.gzipSync(toCsv(list, sourceBox)));
  fs.renameSync(tmp, file);
  for (const f of fs.readdirSync(dir)) {
    const m = FILE_RE.exec(f);
    if (m && nowMs - fs.statSync(path.join(dir, f)).mtimeMs > KEEP_DAYS * DAY) fs.rmSync(path.join(dir, f), { force: true });
  }
  return file;
}

/**
 * VIN -> [{dealer, state, sourceBox}] from the files of the last `days`, skipping any file written at or after
 * `notAfterMs` (the newest shard's mtime): those belong to the SAME crawl output as this run — an earlier attempt of
 * tonight's sync — and must not count as "retired before".
 */
export function loadRecentRetired(dir, nowMs = Date.now(), { days = WINDOW_DAYS, notAfterMs = Infinity } = {}) {
  const map = new Map();
  let files = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return { map, files }; }
  for (const f of names) {
    if (!FILE_RE.test(f)) continue;
    const full = path.join(dir, f);
    const st = fs.statSync(full);
    if (nowMs - st.mtimeMs > days * DAY || st.mtimeMs >= notAfterMs) continue;
    let text;
    try { text = zlib.gunzipSync(fs.readFileSync(full)).toString("utf8"); } catch { continue; }
    files++;
    const [, ...rows] = text.split("\n");
    for (const line of rows) {
      if (!line) continue;
      const [vin, dealer, state, box] = parseCsvLine(line);
      if (!vin) continue;
      (map.get(vin) || map.set(vin, []).get(vin)).push({ dealer, state, sourceBox: box });
    }
  }
  return { map, files };
}

/** Of the rows uploaded now, how many are VINs the last week's files listed as retired — by retiring box and state. */
export function cameBack(uploaded, map) {
  const res = { total: 0, sameDealer: 0, byBox: {}, byState: {}, byBoxState: {} };
  for (const r of uploaded) {
    const hits = map.get(r.vin);
    if (!hits) continue;
    res.total++;
    const same = hits.some((h) => norm(h.dealer) === norm(r.dealerName));
    if (same) res.sameDealer++;
    const h = hits[0];
    res.byBox[h.sourceBox] = (res.byBox[h.sourceBox] || 0) + 1;
    res.byState[h.state] = (res.byState[h.state] || 0) + 1;
    const k = `${h.sourceBox}/${h.state}`;
    res.byBoxState[k] = (res.byBoxState[k] || 0) + 1;
  }
  return res;
}

export function formatCameBack(res, files) {
  if (!files) return "[sync] came back: no retired files from the last 7 days yet — nothing to compare against";
  const top = (o, n = 8) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  return `[sync] came back: ${res.total} VIN(s) in this upload were in the last 7 days of retired files (${files} file(s)); ${res.sameDealer} at the same dealer. by retiring box: ${top(res.byBox)}. by state: ${top(res.byState)}. by box/state: ${top(res.byBoxState, 12)}`;
}
