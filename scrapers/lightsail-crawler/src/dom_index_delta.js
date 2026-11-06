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
//   * After every dealer the delta is checkpointed to its own file (data/dom_index_delta/delta-<pid>-<startMs>.json, written to a temp name and renamed, so a
//     reader or a crash sees the previous complete checkpoint or the new one). An unchanged delta only gets its mtime touched (a heartbeat).
//   * At the end of the run, under the shared-data lock (scope "dom-index"), the process STREAMS the current index file through a merge into a new temp file
//     (one VIN at a time: memory is bounded by the largest single VIN plus the deltas, not by the 480 MB index), verifies the temp file, and renames it over the
//     index. Only after that are the delta files deleted. A load-based merge was measured first and works but leaves only ~200-350 MB of a 3584 MB heap when
//     run at #719's guard threshold, and takes 14-19 s there; see scripts/dom-index-merge-heaptest.mjs.
//   * Orphaned deltas (process killed before it merged) are CLAIMED by an atomic rename to claimed-<mergerPid>-... before they are read, so a delta written
//     again by a still-running owner can never be deleted unmerged. A delta whose pid is alive is left to its owner unless its file has had no heartbeat for
//     DOM_DELTA_LIVE_MAX_STALE_MS (pid numbers get reused; merging a delta early is harmless because every merge is idempotent and the owner still merges its
//     in-memory delta at the end).
//
// CONFLICT POLICY (same VIN and same date, two different records). This is not assumed away: states do NOT have disjoint VINs (a car can move between
// sister stores or states, a brand can be rerun the same day, a SOLD record can meet a live one).
//   1. Identical records: nothing to do.
//   2. Different records: exactly one is kept in dom_index.json, chosen by recordScore (live beats SOLD; a record with a hash beats one without; a stored page
//      beats a hash-only record). If the scores are equal (for example two LIVE records with different prices from two stores), the record with the larger
//      canonical JSON text is kept. THAT TIE-BREAK IS ARBITRARY: it only makes the outcome independent of merge order. It says nothing about which price is
//      true, and for a tie the index price for that VIN-date may be either store's.
//   3. BOTH full records, with the side each came from (index, or delta label/file), are written to data/dom_index_conflicts/<day>-<pid>-<ms>.jsonl, fsynced,
//      BEFORE the new index replaces the old one. A conflict is therefore never discarded from the index without both records already being durable.
//      Anything that needs to know whether a VIN-date was contested must look at those files.
//   4. Replay after a crash re-merges the same deltas; identical records are no-ops, but a conflict can be written to a second conflict file. Duplicates are
//      possible, losses are not.
// Failures anywhere before the rename (lock timeout, unreadable index, disk full, a crash) leave the index file untouched and every delta file on disk.

import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { writeJsonLarge } from './bigJson.js';
import { DomIndexUnreadableError, DOM_INDEX_TRANSIENT_CODES, domPaths } from './dom_store.js';
import { withSharedDataLock } from './shared_data_lock.js';
import { isProcessAlive } from './pid_lock.js';

export const DOM_DELTA_DIRNAME = 'dom_index_delta';
export const DOM_CONFLICTS_DIRNAME = 'dom_index_conflicts';
export const DOM_LOCK_SCOPE = 'dom-index';
export const DOM_DELTA_LIVE_MAX_STALE_MS = 6 * 3600 * 1000; // a delta whose owner pid is "alive" but which has had no checkpoint/heartbeat this long is treated as orphaned
export const DOM_MERGE_MAX_WAIT_MS = 20 * 60 * 1000; // ~18 brand runs can finish within minutes of each other; each holds the lock a few seconds
const TMP_STALE_MS = 6 * 3600 * 1000;
const DELTA_NAME = /^delta-(\d+)-(\d+)\.json$/;
const CLAIMED_NAME = /^claimed-(\d+)-(\d+)-(delta-\d+-\d+\.json)$/;
const WRITE_CHUNK_CHARS = 1 << 20;

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
 * does not depend on which process merges first. A tie on score falls back to the larger canonical JSON text, which is arbitrary (see the policy above).
 * @returns {{ keep: object, drop: object, reason: 'higher-score' | 'tie-canonical-arbitrary' }}
 */
export function chooseDomRecord(a, b) {
  const sa = recordScore(a), sb = recordScore(b);
  if (sa !== sb) return sa > sb ? { keep: a, drop: b, reason: 'higher-score' } : { keep: b, drop: a, reason: 'higher-score' };
  return stable(a) >= stable(b) ? { keep: a, drop: b, reason: 'tie-canonical-arbitrary' } : { keep: b, drop: a, reason: 'tie-canonical-arbitrary' };
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

/** Write the delta to its own file, atomically (temp name + fsync + rename). Unchanged since the last checkpoint: only touch the file's mtime (heartbeat). */
export async function checkpointDomDelta(delta) {
  if (delta.count === delta.checkpointedCount) {
    try { const now = new Date(); await fs.utimes(delta.path, now, now); return false; } catch (err) { if (err.code !== 'ENOENT') throw err; /* another merger claimed it: write it again */ }
  }
  await fs.mkdir(path.dirname(delta.path), { recursive: true });
  await writeJsonLarge(delta.path, { v: 1, pid: delta.pid, label: delta.label, startedAtMs: delta.startedAtMs, entries: delta.entries });
  delta.checkpointedCount = delta.count;
  return true;
}

/**
 * Fold `entries` into `index` in place. Returns { added, same, conflicts: [{ vin, date, kept, dropped, reason, keptSource, droppedSource }] }.
 * `existingSource` / `incomingSource` say where each side came from, for the conflict log.
 */
export function applyDomEntries(index, entries, incomingSource = null, existingSource = 'index') {
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
      const keptIsCurrent = keep === cur;
      conflicts.push({ vin, date, reason, kept: keep, dropped: drop, keptSource: keptIsCurrent ? existingSource : incomingSource, droppedSource: keptIsCurrent ? incomingSource : existingSource });
    }
  }
  return { added, same, conflicts };
}

// ---- streaming over the index file ---------------------------------------------------------------------------------------------------------------------

// Splits a JSON text, arriving as string chunks, into the entries of its top-level OBJECT ('"key":value' texts) without holding more than one entry.
function createEntrySplitter(onEntry) {
  let started = false, depth = 0, inStr = false, esc = false, cur = '', closed = false;
  const emit = () => { const t = cur.trim(); cur = ''; if (t) onEntry(t); };
  return {
    feed(chunk) {
      let seg = 0;
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk.charCodeAt(i);
        if (!started) {
          if (ch === 0x20 || ch === 0x0a || ch === 0x0d || ch === 0x09 || ch === 0xfeff) { seg = i + 1; continue; }
          if (ch !== 0x7b) throw new SyntaxError('dom_index is not a JSON object');
          started = true; seg = i + 1; continue;
        }
        if (closed) { if (ch === 0x20 || ch === 0x0a || ch === 0x0d || ch === 0x09) continue; throw new SyntaxError('unexpected text after the end of the dom_index object'); }
        if (inStr) { if (esc) esc = false; else if (ch === 0x5c) esc = true; else if (ch === 0x22) inStr = false; continue; }
        if (ch === 0x22) { inStr = true; continue; }
        if (ch === 0x7b || ch === 0x5b) { depth++; continue; }
        if (ch === 0x7d || ch === 0x5d) {
          if (depth === 0) { cur += chunk.slice(seg, i); emit(); closed = true; seg = i + 1; continue; }
          depth--; continue;
        }
        if (ch === 0x2c && depth === 0) { cur += chunk.slice(seg, i); emit(); seg = i + 1; }
      }
      if (started && !closed) cur += chunk.slice(seg);
    },
    finish() {
      if (!started) throw new SyntaxError('empty dom_index file');
      if (!closed) throw new SyntaxError('unterminated dom_index object (file is truncated or corrupt)');
    },
  };
}

// Calls `handler(text)` (awaited, in file order) for every top-level entry. Reads the next chunk only after the entries of the previous one were handled, so
// memory stays at about one chunk plus one entry however slow the handler's writes are.
async function forEachIndexEntry(file, handler, chunkBytes = 1 << 20) {
  let pending = [];
  const splitter = createEntrySplitter((t) => pending.push(t));
  const decoder = new StringDecoder('utf8');
  const drain = async () => { const list = pending; pending = []; for (const t of list) await handler(t); };
  const stream = fssync.createReadStream(file, { highWaterMark: chunkBytes });
  for await (const buf of stream) { splitter.feed(decoder.write(buf)); await drain(); }
  splitter.feed(decoder.end()); splitter.finish(); await drain();
}

const KEY_RE = /^"((?:[^"\\]|\\.)*)"\s*:/;
function splitEntry(text) {
  const m = KEY_RE.exec(text);
  if (!m) throw new SyntaxError('dom_index entry without a key');
  return { vin: JSON.parse(`"${m[1]}"`), valueText: text.slice(m[0].length) };
}

/**
 * Rewrite `indexPath` through `combined` ({ VIN: { date: record } }) without ever holding the whole index: reads the current file one VIN at a time, copies
 * untouched VINs verbatim, merges the ones present in `combined`, appends VINs that are not in the file yet. Writes a uniquely named temp file next to the
 * index and verifies it, but does NOT rename it: the caller commits with commit() (after it has made the conflict records durable) or discards with abort().
 * Throws DomIndexUnreadableError if an existing index cannot be read or parsed (nothing is written then).
 */
export async function prepareStreamMerge(indexPath, combined, { existingSource = 'index', incomingSource = 'delta', verify = true } = {}) {
  const tmpPath = `${indexPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  const handle = await fs.open(tmpPath, 'w');
  let closed = false;
  const abort = async () => { if (!closed) { closed = true; try { await handle.close(); } catch { /* closed */ } } await fs.rm(tmpPath, { force: true }).catch(() => {}); };
  try {
    let buf = '', first = true, inCount = 0, merged = 0, same = 0, added = 0, bytes = 0;
    const conflicts = [];
    const consumed = new Set();
    const flushNow = async () => { if (!buf) return; const out = buf; buf = ''; const { bytesWritten } = await handle.write(out); bytes += bytesWritten; };
    const put = async (text) => { buf += (first ? '\n' : ',\n') + text; first = false; if (buf.length >= WRITE_CHUNK_CHARS) await flushNow(); };
    buf = '{';

    let inputExists = true;
    try { await fs.access(indexPath); } catch (err) { if (err.code === 'ENOENT') inputExists = false; else throw err; }
    if (inputExists) {
      await forEachIndexEntry(indexPath, async (text) => {
        const { vin, valueText } = splitEntry(text);
        const value = JSON.parse(valueText); // validates every VIN, as the old whole-file JSON.parse did
        inCount++;
        let outText = text;
        if (Object.prototype.hasOwnProperty.call(combined, vin)) {
          if (consumed.has(vin)) throw new SyntaxError(`dom_index has the key ${vin} twice`);
          consumed.add(vin);
          const holder = { [vin]: value };
          const r = applyDomEntries(holder, { [vin]: combined[vin] }, incomingSource, existingSource);
          merged++; added += r.added; same += r.same; conflicts.push(...r.conflicts);
          outText = `${JSON.stringify(vin)}:${JSON.stringify(holder[vin])}`;
        }
        await put(outText);
      });
    }
    for (const vin of Object.keys(combined)) {
      if (consumed.has(vin)) continue;
      added += Object.keys(combined[vin]).length;
      await put(`${JSON.stringify(vin)}:${JSON.stringify(combined[vin])}`);
    }
    buf += first ? '}\n' : '\n}\n';
    await flushNow();
    await handle.sync();
    await handle.close(); closed = true;

    const expected = inCount + (Object.keys(combined).length - consumed.size);
    if (verify) { // read the finished temp file back through the same strict reader: right entry count, every entry valid JSON
      let n = 0;
      await forEachIndexEntry(tmpPath, async (text) => { const { valueText } = splitEntry(text); JSON.parse(valueText); n++; });
      if (n !== expected) throw new Error(`merged dom_index temp file has ${n} VINs, expected ${expected}; not installed`);
    }
    return {
      tmpPath, bytes, vinsIn: inCount, vinsOut: expected, added, same, conflicts, touchedVins: merged,
      commit: async () => { await fs.rename(tmpPath, indexPath); },
      abort,
    };
  } catch (err) {
    await abort();
    if (err instanceof DomIndexUnreadableError) throw err;
    if (err instanceof SyntaxError || err?.code === 'ERR_STREAM_PREMATURE_CLOSE' || (err && ['EACCES', 'EISDIR', 'EPERM'].includes(err.code)) || (err && DOM_INDEX_TRANSIENT_CODES.has(err.code))) throw new DomIndexUnreadableError(indexPath, err);
    throw err;
  }
}

async function removeStaleTmp(dir, prefix, now) {
  let names; try { names = await fs.readdir(dir); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const f = path.join(dir, name);
    try { const st = await fs.stat(f); if (st.isFile() && now - st.mtimeMs > TMP_STALE_MS) await fs.unlink(f); } catch { /* gone or not ours */ }
  }
}

async function fsyncDir(dir) { try { const h = await fs.open(dir, 'r'); try { await h.sync(); } finally { await h.close(); } } catch { /* not supported everywhere */ } }

let conflictSeq = 0;
async function writeConflictFile(cwd, conflicts, now, tag) {
  if (!conflicts.length) return null;
  const dir = domConflictsDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${new Date(now).toISOString().slice(0, 10)}-${process.pid}-${now}-${++conflictSeq}.jsonl`); // one file per merge: writers can never interleave
  const at = new Date(now).toISOString();
  const handle = await fs.open(file, 'wx');
  try {
    await handle.writeFile(conflicts.map((c) => JSON.stringify({ at, mergedBy: tag, ...c })).join('\n') + '\n');
    await handle.sync();
  } finally { await handle.close(); }
  await fsyncDir(dir);
  return file;
}

async function claimOrphans(cwd, ownPath, now, myPid) {
  const dir = domDeltaDir(cwd);
  let names; try { names = await fs.readdir(dir); } catch { return []; }
  const claimed = [];
  claimed.originals = new Map();
  for (const name of names.sort()) {
    const file = path.join(dir, name);
    if (file === ownPath) continue;
    let ownerPid = null, isClaim = false;
    let m = DELTA_NAME.exec(name);
    if (m) ownerPid = Number(m[1]);
    else if ((m = CLAIMED_NAME.exec(name))) { ownerPid = Number(m[1]); isClaim = true; } // a merger's claim: orphaned when that merger is gone
    else continue;
    let age; try { age = now - (await fs.stat(file)).mtimeMs; } catch { continue; }
    const ownerGone = !isProcessAlive(ownerPid);
    if (!ownerGone && age <= DOM_DELTA_LIVE_MAX_STALE_MS) continue; // alive and recently heard from: its owner merges it
    if (isClaim && ownerPid === myPid) continue;
    if (isClaim) { claimed.push(file); continue; }
    const target = path.join(dir, `claimed-${myPid}-${now}-${name}`);
    try { await fs.rename(file, target); claimed.push(target); claimed.originals.set(target, file); } catch (err) { if (err.code !== 'ENOENT') throw err; /* someone else claimed it first */ }
  }
  return claimed;
}

/**
 * Merge this process's delta (and any orphaned deltas) into the shared index under the lock, streaming. Throws if the merge could not complete; in that case
 * the index file is untouched and every delta file is still on disk. `hooks` exist for crash tests only (called at the named points).
 * @returns {Promise<{ added: number, same: number, conflicts: number, conflictFile: string|null, mergedFiles: number, orphanFiles: number, unreadableDeltas: string[], vinsOut: number }>}
 */
export async function mergeDomDelta(delta, { cwd = delta.cwd, maxWaitMs = DOM_MERGE_MAX_WAIT_MS, now = Date.now(), log = console.log, hooks = {}, attempts = 3, retryDelayMs = 500 } = {}) {
  const label = `dom-index-merge:${delta.label || delta.pid}`;
  const { indexPath, dataDir } = domPaths(cwd);
  return withSharedDataLock(async () => {
    await removeStaleTmp(dataDir, 'dom_index.json.tmp', now);
    const claimed = await claimOrphans(cwd, delta.path, now, process.pid);
    // Combine all deltas (orphans first, own last) into one { VIN: { date: record } }; overlaps between deltas are resolved by the same policy and logged.
    const combined = {};
    const conflicts = [];
    const unreadableDeltas = [];
    const mergedClaimed = [];
    const fold = (entries, source) => { const r = applyDomEntries(combined, entries, source, 'earlier-delta'); conflicts.push(...r.conflicts); };
    for (const file of claimed) {
      try {
        const doc = JSON.parse(await fs.readFile(file, 'utf8'));
        fold(doc?.entries, `orphan-delta:${doc?.label || '?'}:${path.basename(file)}`);
        mergedClaimed.push(file);
      } catch (err) {
        unreadableDeltas.push(`${file}: ${err.message}`); // stays on disk, never deleted unmerged
        const original = claimed.originals.get(file);
        if (original) await fs.rename(file, original).catch(() => {}); // put it back under its own name, exactly as it was found
      }
    }
    fold(delta.entries, `delta:${delta.label || '?'}:${path.basename(delta.path)}`);

    let prepared;
    for (let n = 1; ; n++) {
      try { prepared = await prepareStreamMerge(indexPath, combined, { incomingSource: `delta:${delta.label || '?'}:${path.basename(delta.path)}` }); break; } catch (err) {
        const transient = err instanceof DomIndexUnreadableError && err.cause && DOM_INDEX_TRANSIENT_CODES.has(err.cause.code);
        if (transient && n < attempts) { await new Promise((r) => setTimeout(r, retryDelayMs * n)); continue; }
        throw err;
      }
    }
    try {
      conflicts.push(...prepared.conflicts);
      // 1. both full records of every conflict are durable BEFORE the index changes
      const conflictFile = await writeConflictFile(cwd, conflicts, now, `${process.pid}:${delta.label || '?'}`);
      await hooks.afterConflicts?.();
      // 2. the new index replaces the old one atomically
      if (prepared.added || conflicts.length) await prepared.commit(); else await prepared.abort();
      await hooks.afterRename?.();
      // 3. only now are the delta files deleted (the index holds their records, or the conflict file holds the ones not kept)
      let deleted = 0;
      for (const file of [...mergedClaimed, delta.path]) { await fs.rm(file, { force: true }).catch(() => {}); await hooks.afterDelete?.(++deleted); }
      log(`DOM index merge: +${prepared.added} new VIN-date(s), ${prepared.same} already present, ${conflicts.length} overlapping VIN-date(s) with a different record (both full records in ${conflictFile ? path.basename(conflictFile) : 'none'}), ${mergedClaimed.length} orphaned delta file(s) merged${unreadableDeltas.length ? `, ${unreadableDeltas.length} unreadable delta file(s) left in place` : ''}.`);
      return { added: prepared.added, same: prepared.same, conflicts: conflicts.length, conflictFile, mergedFiles: mergedClaimed.length + 1, orphanFiles: mergedClaimed.length, unreadableDeltas, vinsOut: prepared.vinsOut };
    } catch (err) {
      await prepared.abort();
      throw err;
    }
  }, { scope: DOM_LOCK_SCOPE, cwd, maxWaitMs, label });
}
