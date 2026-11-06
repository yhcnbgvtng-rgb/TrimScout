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
//   * At the end of the run, under the dom-index merge lock (below), the process STREAMS the current index file through a merge into a new temp file
//     (one VIN at a time: memory is bounded by the largest single VIN plus the deltas, not by the 480 MB index), verifies the temp file, and renames it over the
//     index. Only after that are the delta files deleted. A load-based merge was measured first and works but leaves only ~200-350 MB of a 3584 MB heap when
//     run at #719's guard threshold, and takes 14-19 s there; see scripts/dom-index-merge-heaptest.mjs.
//   * Orphaned deltas (process killed before it merged) are CLAIMED by an atomic rename to claimed-<mergerPid>-... before they are read, so a delta written
//     again by a still-running owner can never be deleted unmerged. WHO OWNS A FILE is decided by process identity, never by age: every delta (and every
//     claim) carries its owner's pid, process START identity (Linux: field 22 of /proc/<pid>/stat) and BOOT identity (/proc/sys/kernel/random/boot_id) in
//     its file name. See judgeOwner(): only a dead pid, a pid now held by a process with a different start identity (genuine PID reuse), or a different boot
//     (machine rebooted) makes a file claimable. A confirmed live owner's file is never touched, however old it is. If identity cannot be established
//     (nothing recorded, /proc unreadable, boot unknown) the file is left untouched and reported, never guessed at.
//
// THE MERGE LOCK is a kernel flock(2), held by the process that does the merge. Every lock built from files plus checks failed under a deterministic
// three-process test (scripts/dom-index-lock-takeover-demo.mjs): shared_data_lock.js takes a live holder's lock at 10 minutes of age, trusts the pid alone and
// removes by path after a separate read (scripts/dom-index-lock-probe.mjs), and the token-file protocol that replaced it (age rule gone, identity-judged takeover,
// token-checked release, assertHeld before the commit) still let a contender that had judged a DEAD lock rename a replacement LIVE holder's lock aside, a third
// process then took the empty path, and the displaced holder, which had already passed assertHeld, renamed its merge over the third one's commit. Any scheme where one
// process decides "that lock is stale, remove it" and a second step acts on the decision has that window. flock has no such step:
//   * the merge runs in a short-lived worker process (this file with --merge-worker) started as `flock -x -w <secs> <lockfile> node dom_index_delta.js --merge-worker ...`.
//     flock(1) takes the lock and EXECS the worker, which inherits the locked file descriptor: the process that streams the index and renames it over dom_index.json is the
//     lock holder itself;
//   * the kernel releases the lock when that process exits or is killed, for any reason, at that instant. There is no stale lock, no age, no pid or identity judgement,
//     no takeover, no file contents, nothing to remove. A live (even stopped or hung) holder keeps the lock; a dead one cannot commit anything any more;
//   * contenders wait inside flock(1) for at most maxWaitMs, then give up (exit 200): their deltas stay on disk for the next run;
//   * the lock file (data/locks/dom-index.merge.flock) is never deleted or replaced by this code; do not delete it by hand while a merge can be running;
//   * Linux boxes use util-linux flock(1) (2.39.3 on box1/box5); where it is missing (macOS dev machines) a python3 fcntl.flock launcher does the same thing.
// The worker also keeps the merge's memory out of the crawler process (a fresh node process with a 1 GB heap, streaming).
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
import crypto from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { writeJsonLarge } from './bigJson.js';
import { DomIndexUnreadableError, DOM_INDEX_TRANSIENT_CODES, domPaths } from './dom_store.js';
import { isProcessAlive } from './pid_lock.js';

export const DOM_DELTA_DIRNAME = 'dom_index_delta';
export const DOM_CONFLICTS_DIRNAME = 'dom_index_conflicts';
export const DOM_MERGE_LOCK_NAME = 'dom-index.merge.lock';
export const DOM_MERGE_MAX_WAIT_MS = 20 * 60 * 1000; // ~18 brand runs can finish within minutes of each other; each holds the lock a few seconds
const TMP_STALE_MS = 6 * 3600 * 1000;
// delta-<pid>-<startMs>[-<startToken>-<bootToken>].json   (tokens are 'x' when unknown; files without tokens come from older builds/tests: identity unknown)
const DELTA_NAME = /^delta-(\d+)-(\d+)(?:-([0-9a-f]+|x)-([0-9a-f]+|x))?\.json$/;
// claimed-<mergerPid>-<startToken>-<bootToken>-<claimMs>-<original delta name>
const CLAIMED_NAME = /^claimed-(\d+)-([0-9a-f]+|x)-([0-9a-f]+|x)-(\d+)-(delta-.+\.json)$/;
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

// ---- who owns a file: pid + process start identity + boot identity ---------------------------------------------------------------------------------------

const tok = (str) => crypto.createHash('sha1').update(String(str)).digest('hex').slice(0, 16);
const hexOnly = (str) => String(str).replace(/[^0-9a-f]/gi, '').toLowerCase() || null;

/** Identity of the running OS boot. Linux: boot_id. macOS (dev machines): hash of kern.boottime. null if it cannot be read. */
export function readBootToken({ procRoot = '/proc' } = {}) {
  try { const t = hexOnly(fssync.readFileSync(`${procRoot}/sys/kernel/random/boot_id`, 'utf8')); if (t) return t; } catch { /* not Linux */ }
  try { return tok(execFileSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8', timeout: 2000 })); } catch { return null; }
}

/** Start identity of a process. Linux: starttime (field 22 of /proc/<pid>/stat, clock ticks since boot). macOS: hash of `ps -o lstart=`. null if it cannot be read. */
export function readStartToken(pid, { procRoot = '/proc' } = {}) {
  try {
    const stat = fssync.readFileSync(`${procRoot}/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' '); // after "pid (comm) ": state is field 3, so starttime (field 22) is index 19
    const st = rest[19];
    if (st && /^\d+$/.test(st)) return st.toString(16);
  } catch { /* no /proc entry: not Linux, or the process is gone */ }
  try { const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 }).trim(); return out ? tok(out) : null; } catch { return null; }
}

/** { pid, start, boot } of a process; start/boot are 'x' when they cannot be read. */
export function processIdentity(pid, io = {}) { return { pid, start: readStartToken(pid, io) || 'x', boot: readBootToken(io) || 'x' }; }

/**
 * Judge the owner recorded for a delta or claim file.
 *   'dead'      the pid is not running                                  -> claimable
 *   'reused'    the pid is running but is NOT the recorded process      -> claimable (genuine PID reuse: different start identity, or a different boot)
 *   'alive'     the pid is running and start AND boot identity match    -> NEVER touched, whatever the file's age
 *   'uncertain' identity cannot be established                          -> NEVER touched, reported
 * `io` lets tests replace the OS probes: { alive(pid), start(pid), boot() }.
 */
export function judgeOwner({ pid, start = 'x', boot = 'x' }, io = {}) {
  const alive = io.alive || isProcessAlive;
  const curStart = io.start || readStartToken;
  const curBootFn = io.boot || readBootToken;
  if (!alive(pid)) return { state: 'dead', why: 'process is not running' };
  const curBoot = curBootFn();
  if (boot !== 'x' && curBoot && boot !== curBoot) return { state: 'reused', why: 'recorded boot identity differs from this boot (machine restarted since)' };
  if (start === 'x') return { state: 'uncertain', why: 'no start identity was recorded for the owner and its pid is running' };
  if (boot === 'x') return { state: 'uncertain', why: 'no boot identity was recorded for the owner and its pid is running' };
  if (!curBoot) return { state: 'uncertain', why: 'cannot read this machine\'s boot identity' };
  const now = curStart(pid);
  if (!now) return { state: 'uncertain', why: `cannot read the start identity of running pid ${pid}` };
  if (now !== start) return { state: 'reused', why: `pid ${pid} is now a different process (start identity ${now}, recorded ${start})` };
  return { state: 'alive', why: 'process with the recorded start and boot identity is running' };
}

/** This process's own writes. `entries` has the same shape as the index: { VIN: { 'YYYY-MM-DD': record } }. */
export function createDomDelta({ cwd = process.cwd(), label = null, pid = process.pid, startedAtMs = Date.now(), identity = processIdentity(pid) } = {}) {
  return {
    pid, label, startedAtMs, cwd, identity,
    path: path.join(domDeltaDir(cwd), `delta-${pid}-${startedAtMs}-${identity.start}-${identity.boot}.json`),
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

/** Write the delta to its own file, atomically (temp name + fsync + rename). Nothing new since the last checkpoint: nothing to write, unless the file has gone. */
export async function checkpointDomDelta(delta) {
  if (delta.count === delta.checkpointedCount) {
    try { await fs.access(delta.path); return false; } catch (err) { if (err.code !== 'ENOENT') throw err; /* removed by a merger: write it again */ }
  }
  await fs.mkdir(path.dirname(delta.path), { recursive: true });
  await writeJsonLarge(delta.path, { v: 2, pid: delta.pid, identity: delta.identity, label: delta.label, startedAtMs: delta.startedAtMs, entries: delta.entries });
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

// ---- the merge lock: kernel flock, held by the worker process -----------------------------------------------------------------------------------------------

export function domMergeLockPath(cwd = process.cwd()) { return path.join(domPaths(cwd).dataDir, 'locks', 'dom-index.merge.flock'); }
const LOCK_CONFLICT_EXIT = 200;
const PY_FLOCK = [
  'import fcntl, os, sys, time',
  'path, wait = sys.argv[1], float(sys.argv[2]); cmd = sys.argv[3:]',
  'fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o666)',
  'deadline = time.time() + wait',
  'while True:',
  '    try:',
  '        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); break',
  '    except OSError:',
  `        if time.time() >= deadline: sys.exit(${LOCK_CONFLICT_EXIT})`,
  '        time.sleep(0.05)',
  'os.set_inheritable(fd, True)',
  'os.execvp(cmd[0], cmd)',
].join('\n');

/** Command prefix that takes the exclusive flock on `lockPath` (waiting up to `waitSec`) and then execs the rest of the command line in the SAME process. */
export function flockPrefix(lockPath, waitSec, { flockBin = 'flock', pythonBin = 'python3' } = {}) {
  const has = (bin, args) => { try { return spawnSync(bin, args, { stdio: 'ignore', timeout: 3000 }).status === 0; } catch { return false; } };
  if (has(flockBin, ['--version'])) return [flockBin, '-x', '-E', String(LOCK_CONFLICT_EXIT), '-w', String(waitSec), lockPath];
  if (has(pythonBin, ['-c', 'import fcntl'])) return [pythonBin, '-c', PY_FLOCK, lockPath, String(waitSec)];
  return null;
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

/**
 * Claim the delta files (and dead mergers' claims) whose owner is provably gone. Never touches a file of a confirmed live owner, and never guesses: a file
 * whose owner's identity cannot be established is left where it is and returned in `uncertain`.
 * @returns {{ claimed: string[], originals: Map<string,string>, uncertain: Array<{ file: string, owner: string, why: string }>, skippedLive: number }}
 */
async function claimOrphans(cwd, ownPath, myPid, io = {}) {
  const dir = domDeltaDir(cwd);
  const out = { claimed: [], originals: new Map(), uncertain: [], skippedLive: 0 };
  let names; try { names = await fs.readdir(dir); } catch { return out; }
  const me = processIdentity(myPid);
  for (const name of names.sort()) {
    const file = path.join(dir, name);
    if (file === ownPath) continue;
    let owner, isClaim = false, m;
    if ((m = DELTA_NAME.exec(name))) owner = { pid: Number(m[1]), start: m[3] || 'x', boot: m[4] || 'x' };
    else if ((m = CLAIMED_NAME.exec(name))) { owner = { pid: Number(m[1]), start: m[2], boot: m[3] }; isClaim = true; } // a merger's claim: judged by the MERGER's identity
    else continue;
    const j = judgeOwner(owner, io);
    if (j.state === 'alive') { out.skippedLive++; continue; }
    if (j.state === 'uncertain') { out.uncertain.push({ file, owner: `${isClaim ? 'merger' : 'owner'} pid ${owner.pid}`, why: j.why }); continue; }
    if (isClaim) { out.claimed.push(file); continue; } // dead/reused merger: take the claim over as it is
    const target = path.join(dir, `claimed-${myPid}-${me.start}-${me.boot}-${Date.now()}-${name}`);
    try { await fs.rename(file, target); out.claimed.push(target); out.originals.set(target, file); } catch (err) { if (err.code !== 'ENOENT') throw err; /* someone else claimed it first */ }
  }
  return out;
}

/**
 * The merge itself: claim orphans, stream the index through it, make the conflict records durable, rename, delete the deltas. The CALLER MUST HOLD THE FLOCK (the
 * merge worker does; tests that run it directly are single-process). Throws if the merge could not complete; then the index file is untouched and every delta file
 * is still on disk. `hooks` exist for crash tests only (called at the named points).
 * @returns {Promise<{ added: number, same: number, conflicts: number, conflictFile: string|null, mergedFiles: number, orphanFiles: number, unreadableDeltas: string[], vinsOut: number }>}
 */
export async function mergeDomDeltaCore(delta, { cwd = delta.cwd, now = Date.now(), log = console.log, hooks = {}, attempts = 3, retryDelayMs = 500, io = {} } = {}) {
  const { indexPath, dataDir } = domPaths(cwd);
  {
    await removeStaleTmp(dataDir, 'dom_index.json.tmp', now);
    const found = await claimOrphans(cwd, delta.path, process.pid, io);
    const claimed = found.claimed;
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
        const original = found.originals.get(file);
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
      // 2. the new index replaces the old one atomically; the caller holds the flock for the whole of this function, and the kernel drops it only when this process ends
      await hooks.beforeCommit?.();
      if (prepared.added || conflicts.length) await prepared.commit(); else await prepared.abort();
      await hooks.afterRename?.();
      // 3. only now are the delta files deleted (the index holds their records, or the conflict file holds the ones not kept)
      let deleted = 0;
      for (const file of [...mergedClaimed, delta.path]) { await fs.rm(file, { force: true }).catch(() => {}); await hooks.afterDelete?.(++deleted); }
      const logLine = (`DOM index merge: +${prepared.added} new VIN-date(s), ${prepared.same} already present, ${conflicts.length} overlapping VIN-date(s) with a different record (both full records in ${conflictFile ? path.basename(conflictFile) : 'none'}), ${mergedClaimed.length} orphaned delta file(s) merged${unreadableDeltas.length ? `, ${unreadableDeltas.length} unreadable delta file(s) left in place` : ''}${found.uncertain.length ? `. NOT TOUCHED, owner identity uncertain: ${found.uncertain.map((u) => `${path.basename(u.file)} (${u.owner}: ${u.why})`).join('; ')}` : ''}${found.skippedLive ? `; ${found.skippedLive} file(s) belong to live processes and were left alone` : ''}.`);
      log(logLine);
      return { logLine, added: prepared.added, same: prepared.same, conflicts: conflicts.length, conflictFile, mergedFiles: mergedClaimed.length + 1, orphanFiles: mergedClaimed.length, unreadableDeltas, uncertain: found.uncertain, skippedLive: found.skippedLive, vinsOut: prepared.vinsOut };
    } catch (err) {
      await prepared.abort();
      throw err;
    }
  }
}

// ---- running the merge under the flock -----------------------------------------------------------------------------------------------------------------------

const SELF = fileURLToPath(import.meta.url);

function rebuildError(e) {
  if (e?.name === 'DomIndexUnreadableError') { const err = Object.create(DomIndexUnreadableError.prototype); Object.assign(err, { message: e.message, name: e.name, code: e.code, path: e.path, stack: e.stack }); err.cause = Object.assign(new Error(e.cause?.message || ''), { code: e.cause?.code }); return err; }
  return Object.assign(new Error(e?.message || 'merge worker failed'), { name: e?.name || 'Error', code: e?.code });
}

/**
 * Merge this process's delta (and any orphaned deltas) into the shared index. Writes a final checkpoint of the delta, then runs the merge in a worker process that
 * holds the kernel flock (see the header), waits for it, and returns its result. Throws if the lock could not be had within maxWaitMs, if no flock launcher exists, or
 * if the merge failed; in every case the index file is untouched or complete (atomic rename) and the delta files are still on disk. `log` receives the worker's one-line summary.
 */
export async function mergeDomDelta(delta, { cwd = delta.cwd, maxWaitMs = DOM_MERGE_MAX_WAIT_MS, now = Date.now(), log = console.log, attempts = 3, retryDelayMs = 500, launcher = {}, env = {}, hooks, io } = {}) {
  if (hooks || io) throw new Error('mergeDomDelta runs in a separate locked worker process: hooks/io cannot cross it; use mergeDomDeltaCore (the caller then holds the lock) in tests');
  await checkpointDomDelta(delta); // the worker reads the delta from disk
  const lockPath = domMergeLockPath(cwd);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const prefix = flockPrefix(lockPath, Math.max(1, Math.ceil(maxWaitMs / 1000)), launcher);
  if (!prefix) throw new Error('cannot take the dom-index merge lock: neither flock(1) nor python3 with fcntl is available. Nothing was changed; the delta file stays on disk and is merged by the next run that has one.');
  const args = { cwd, deltaPath: delta.path, label: delta.label, pid: delta.pid, expectDates: delta.count, now, attempts, retryDelayMs };
  const argv = [...prefix, process.execPath, '--max-old-space-size=1024', SELF, '--merge-worker', JSON.stringify(args)];
  const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let out = '', err = '';
  child.stdout.on('data', (b) => { out += b; }); child.stderr.on('data', (b) => { err += b; });
  const { code, signal } = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (c, sg) => resolve({ code: c, signal: sg })); });
  if (code === LOCK_CONFLICT_EXIT) throw new Error(`Timed out after ${maxWaitMs}ms waiting for the dom-index merge lock at ${lockPath}: another merge holds it (flock). The lock is held by a process, not a file's age: it is never taken from a live holder, and is released the instant that process ends. The delta stays on disk for the next run.`);
  const line = out.trim().split('\n').filter(Boolean).pop();
  let msg = null; try { msg = line ? JSON.parse(line) : null; } catch { /* not ours */ }
  if (code === 0 && msg?.ok) { log(msg.result.logLine); return msg.result; }
  if (msg && msg.ok === false) throw rebuildError(msg.error);
  throw new Error(`dom-index merge worker ended without a result (exit ${code}${signal ? `, signal ${signal}` : ''}): ${err.trim().slice(-400) || 'no output'}. The index is untouched or complete; the delta files are still on disk.`);
}

// ---- the worker: `flock ... node dom_index_delta.js --merge-worker '<json>'` runs this, holding the lock ----------------------------------------------------------

async function pauseAt(point) { // TEST SCAFFOLDING, inert unless DOM_INDEX_MERGE_PAUSE_DIR and DOM_INDEX_MERGE_PAUSE_POINTS (comma list) are set: freezes the lock holder at a named point
  const dir = process.env.DOM_INDEX_MERGE_PAUSE_DIR;
  if (!dir || !(process.env.DOM_INDEX_MERGE_PAUSE_POINTS || '').split(',').includes(point)) return;
  await fs.writeFile(path.join(dir, `${point}.reached`), String(process.pid));
  while (!fssync.existsSync(path.join(dir, `${point}.go`))) await new Promise((r) => setTimeout(r, 5));
}

async function mergeWorkerMain(raw) {
  const startedAtMs = Date.now(); // the lock is already ours: flock(1) / the python launcher took it before exec'ing this process
  try {
    const a = JSON.parse(raw);
    await pauseAt('locked');
    const doc = JSON.parse(await fs.readFile(a.deltaPath, 'utf8'));
    const dates = Object.values(doc.entries || {}).reduce((n, d) => n + Object.keys(d).length, 0);
    if (dates !== a.expectDates) throw new Error(`the delta file ${a.deltaPath} holds ${dates} VIN-date(s) but its owner wrote ${a.expectDates}; refusing to merge a delta that may be incomplete (nothing was changed)`);
    const delta = { path: a.deltaPath, label: a.label, pid: a.pid, entries: doc.entries || {} };
    const hooks = { afterConflicts: () => pauseAt('afterConflicts'), beforeCommit: () => pauseAt('beforeCommit'), afterRename: () => pauseAt('afterRename') };
    const result = await mergeDomDeltaCore(delta, { cwd: a.cwd, now: a.now, log: () => {}, hooks, attempts: a.attempts, retryDelayMs: a.retryDelayMs });
    process.stdout.write(`${JSON.stringify({ ok: true, result: { ...result, lockedAtMs: startedAtMs, doneAtMs: Date.now(), workerPid: process.pid, maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024) /* KB, as libuv reports it on Linux and macOS */ } })}\n`);
    process.exit(0);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { name: err.name, code: err.code, message: err.message, path: err.path, stack: err.stack, cause: err.cause ? { code: err.cause.code, message: err.cause.message } : undefined } })}\n`);
    process.exit(3);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF && process.argv[2] === '--merge-worker') await mergeWorkerMain(process.argv[3]);
