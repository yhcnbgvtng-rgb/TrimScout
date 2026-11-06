// Lost-update-safe updates to data/dom_index.json for concurrent brand processes.
//
// The problem (measured on box1/box5 2026-11-06, see docs/box-patches/2026-11-06-dom-index-save-boxes-15/STEPS.md): every brand run is its own
// `node src/standalone.js` in the same working directory, so they all share data/dom_index.json. Each one loaded the whole index at startup and saved ITS OWN
// copy after every dealer. A saved copy does not contain what the other processes added after it was loaded, so whichever process saved last replaced the
// file and the others' entries from that night were lost. An atomic rename makes each write all-or-nothing; it does not stop one writer overwriting another's
// content.
//
// What this does instead:
//   * Each process keeps its loaded index READ-ONLY for the "yesterday" lookups and records only the VIN-dates it wrote itself in a DELTA.
//   * After every dealer the delta is checkpointed to its own uniquely named file (data/dom_index_delta/delta-<pid>-<startMs>.json, written atomically).
//     A crash loses nothing that was checkpointed.
//   * At the end of the run, under the shared-data lock (scope "dom-index"), the process reloads the CURRENT index file (fail closed, as loadDomIndex does),
//     applies its delta and any orphaned deltas left by dead processes, saves once with the incremental writer, and only then deletes the delta files it merged.
//   * Overlapping entries are NOT assumed away. Two processes can write the same VIN and date (a car that moves between sister stores or states, a rerun of the
//     same day, a sold record against a live one). When the file already holds a different record for that VIN-date, the more informative one is kept (rule
//     below, independent of merge order) and BOTH records go into data/dom_index_conflicts/<date>.jsonl, so nothing is dropped without a trace.
//   * If anything fails (lock timeout, unreadable index, disk full) the index file is untouched and the delta files stay on disk to be merged by the next run.

import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonLarge, writeJsonLarge } from './bigJson.js';
import { loadDomIndex, saveDomIndex, domPaths } from './dom_store.js';
import { withSharedDataLock } from './shared_data_lock.js';
import { isProcessAlive } from './pid_lock.js';

export const DOM_DELTA_DIRNAME = 'dom_index_delta';
export const DOM_CONFLICTS_DIRNAME = 'dom_index_conflicts';
export const DOM_LOCK_SCOPE = 'dom-index';
export const DOM_DELTA_ORPHAN_MAX_AGE_MS = 24 * 3600 * 1000; // a delta this old is merged even if its pid number has been reused
export const DOM_MERGE_MAX_WAIT_MS = 20 * 60 * 1000; // ~18 brand runs can finish within minutes of each other; each holds the lock ~20 s at box1 size
const DELTA_NAME = /^delta-(\d+)-(\d+)\.json$/;

export function domDeltaDir(cwd = process.cwd()) { return path.join(domPaths(cwd).dataDir, DOM_DELTA_DIRNAME); }
export function domConflictsDir(cwd = process.cwd()) { return path.join(domPaths(cwd).dataDir, DOM_CONFLICTS_DIRNAME); }

const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x));

/** How informative a record is. Higher wins. A live record beats SOLD (the car is still listed somewhere); a stored page beats a hash-only record. */
export function recordScore(rec) {
  if (!rec || typeof rec !== 'object') return -1;
  return (rec.priceChangeType === 'SOLD' ? 0 : 4) + (rec.hash ? 2 : 0) + (rec.blobStored ? 1 : 0);
}

/**
 * Decide between two different records for the same VIN-date. Deterministic and symmetric: choose(a, b) and choose(b, a) keep the same record, so the result
 * does not depend on which process merges first. Ties on score fall back to the larger canonical JSON text.
 * @returns {{ keep: object, drop: object, reason: string }}
 */
export function chooseDomRecord(a, b) {
  const sa = recordScore(a), sb = recordScore(b);
  if (sa !== sb) return sa > sb ? { keep: a, drop: b, reason: 'higher-score' } : { keep: b, drop: a, reason: 'higher-score' };
  return stable(a) >= stable(b) ? { keep: a, drop: b, reason: 'tie-canonical' } : { keep: b, drop: a, reason: 'tie-canonical' };
}

/** This process's own writes. `entries` has the same shape as the index: { VIN: { 'YYYY-MM-DD': record } }. */
export function createDomDelta({ cwd = process.cwd(), label = null, pid = process.pid, startedAtMs = Date.now() } = {}) {
  return {
    pid, label, startedAtMs, cwd,
    path: path.join(domDeltaDir(cwd), `delta-${pid}-${startedAtMs}.json`),
    entries: {},
    count: 0,
    checkpointedCount: -1,
    /** Record that `index[VIN][date]` was just written by this process (call after captureVehicleDom / recordSoldDom with the shared `index`). */
    note(index, vin, date) {
      const key = String(vin).toUpperCase();
      const rec = index?.[key]?.[date];
      if (!rec) return false;
      if (!this.entries[key]) this.entries[key] = {};
      if (!this.entries[key][date]) this.count++;
      this.entries[key][date] = rec;
      return true;
    },
  };
}

/** Write the delta to its own file, atomically. Skipped when nothing was added since the last checkpoint. */
export async function checkpointDomDelta(delta) {
  if (delta.count === delta.checkpointedCount) return false;
  await fs.mkdir(path.dirname(delta.path), { recursive: true });
  await writeJsonLarge(delta.path, { v: 1, pid: delta.pid, label: delta.label, startedAtMs: delta.startedAtMs, entries: delta.entries });
  delta.checkpointedCount = delta.count;
  return true;
}

/** Fold `entries` into `index` in place. Returns { added, same, conflicts: [{ vin, date, kept, dropped, reason }] }. */
export function applyDomEntries(index, entries, source = null) {
  let added = 0, same = 0;
  const conflicts = [];
  for (const [vin, dates] of Object.entries(entries || {})) {
    if (!dates || typeof dates !== 'object') continue;
    for (const [date, rec] of Object.entries(dates)) {
      if (!index[vin]) index[vin] = {};
      const cur = index[vin][date];
      if (cur === undefined) { index[vin][date] = rec; added++; continue; }
      if (stable(cur) === stable(rec)) { same++; continue; }
      const { keep, drop, reason } = chooseDomRecord(cur, rec);
      index[vin][date] = keep;
      conflicts.push({ vin, date, kept: keep, dropped: drop, reason, source });
    }
  }
  return { added, same, conflicts };
}

async function listOrphanDeltas(cwd, ownPath, now) {
  let names;
  try { names = await fs.readdir(domDeltaDir(cwd)); } catch { return []; }
  const out = [];
  for (const name of names.sort()) {
    const m = DELTA_NAME.exec(name);
    if (!m) continue;
    const file = path.join(domDeltaDir(cwd), name);
    if (file === ownPath) continue;
    const pid = Number(m[1]);
    let age = 0;
    try { age = now - (await fs.stat(file)).mtimeMs; } catch { continue; }
    if (!isProcessAlive(pid) || age > DOM_DELTA_ORPHAN_MAX_AGE_MS) out.push(file); // a live process's delta is merged by that process
  }
  return out;
}

/**
 * Merge this process's delta (and any orphaned deltas) into the shared index under the lock. The caller should have released its own loaded copy first
 * (the merge loads the current file, about the size of the index again).
 * Throws if the merge could not complete; in that case the index file is untouched and every delta file is still on disk.
 * @returns {Promise<{ added: number, same: number, conflicts: number, mergedFiles: number, orphanFiles: number, unreadableDeltas: string[] }>}
 */
export async function mergeDomDelta(delta, { cwd = delta.cwd, maxWaitMs = DOM_MERGE_MAX_WAIT_MS, now = Date.now(), log = console.log } = {}) {
  const label = `dom-index-merge:${delta.label || delta.pid}`;
  return withSharedDataLock(async () => {
    const orphans = await listOrphanDeltas(cwd, delta.path, now);
    const index = await loadDomIndex(cwd); // fail closed: throws on an unreadable existing index; nothing below runs
    const totals = { added: 0, same: 0, conflicts: [] };
    const fold = (entries, source) => { const r = applyDomEntries(index, entries, source); totals.added += r.added; totals.same += r.same; totals.conflicts.push(...r.conflicts); };
    const unreadableDeltas = [];
    const mergedOrphans = [];
    for (const file of orphans) {
      try {
        const doc = await readJsonLarge(file);
        fold(doc?.entries, `orphan:${path.basename(file)}`);
        mergedOrphans.push(file);
      } catch (err) {
        unreadableDeltas.push(`${file}: ${err.message}`); // left on disk for a human; never deleted unmerged
      }
    }
    fold(delta.entries, `delta:${path.basename(delta.path)}`);

    if (totals.conflicts.length) { // durable record of what was not kept, written BEFORE the index changes
      const day = new Date(now).toISOString().slice(0, 10);
      await fs.mkdir(domConflictsDir(cwd), { recursive: true });
      await fs.appendFile(path.join(domConflictsDir(cwd), `${day}.jsonl`), totals.conflicts.map((c) => JSON.stringify({ at: new Date(now).toISOString(), ...c })).join('\n') + '\n');
    }
    if (totals.added || totals.conflicts.length) await saveDomIndex(index, cwd);
    // Only now is anything deleted: the index file holds every record these deltas carried (or the conflict log holds the ones not kept).
    for (const file of [...mergedOrphans, delta.path]) await fs.rm(file, { force: true }).catch(() => {});
    log(`DOM index merge: +${totals.added} new VIN-date(s), ${totals.same} already present, ${totals.conflicts.length} overlapping VIN-date(s) with a different record (both kept in ${DOM_CONFLICTS_DIRNAME}/), ${mergedOrphans.length} orphaned delta file(s) merged${unreadableDeltas.length ? `, ${unreadableDeltas.length} unreadable delta file(s) left in place` : ''}.`);
    return { added: totals.added, same: totals.same, conflicts: totals.conflicts.length, mergedFiles: mergedOrphans.length + 1, orphanFiles: mergedOrphans.length, unreadableDeltas };
  }, { scope: DOM_LOCK_SCOPE, cwd, maxWaitMs, label });
}
