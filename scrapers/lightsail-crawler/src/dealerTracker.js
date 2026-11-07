// Per-dealer crawl performance tracker (standalone.js).
//
// One JSONL file per run date, data/dealer_tracker/crawl-<YYYY-MM-DD>.jsonl, shared by every crawl process on the box. Per dealer ATTEMPT (a retry pass is a
// separate attempt) two records are appended:
//   begin  written when the attempt starts. An attempt that has a begin and no end was interrupted: process crash, OOM abort, SIGKILL, power loss.
//   end    written when the attempt finishes, by whatever route (success, skip, wall, heap stop, timeout, exception). It repeats the identity fields, so
//          a reader needs only end records plus the begin records that never got one.
// Plus one run_start per process and one run_end when the dealer loop completed.
//
// THIS MODULE OBSERVES. It never returns a value the crawl uses, never throws into the crawl, never prints to stdout (existing log formats are untouched),
// never awaits, and holds no timers. All it does is count what the hooks tell it and append a line with fs.appendFileSync (one write(2) on an O_APPEND
// descriptor: concurrent processes cannot interleave inside a record, each record is well under 4 KB).
//
// Metrics the crawl cannot observe are null, never 0. Memory: V8 has no per-allocation attribution, so `mem.process` is whole-process (RSS and heap are shared by
// everything the process does) and `mem.dealerAttributable` is always null; `mem.dealerEstimate` is a labelled approximation (used heap at end minus start,
// dealers run one at a time inside a process, so it includes GC timing and whatever this dealer left retained).
//
// Not recorded: page bodies, URLs of vehicle pages, cookies, headers, env, credentials, buyer data. Error messages are cut to 160 chars with URLs removed.
//
// Records are framed "\n<json>\n": if a writer ever dies mid-record (ENOSPC), the next record still starts on its own line, so a torn record costs one
// line (readers skip and count malformed lines), never its neighbour.
//
// Size cap (64 MB per day file, checked every 20 appends because other processes write the same file): at the cap a process writes ONE `logging_stopped`
// marker (reason size_cap) and stops adding begin/run_start/run_end records; the one attempt it may have open still gets its `end`, so a capped log never
// makes a finished dealer look interrupted. Overshoot is bounded by (writers x 20 appends x <4 KB). Three consecutive write failures stop the process the
// same way (reason write_failures), marker attempted best-effort. The summary reports both and does NOT count them as interrupted attempts.
//
// Switches: CRAWLER_DEALER_TRACKER=off (kill switch), CRAWLER_DEALER_TRACKER_RETAIN_DAYS (default 14), CRAWLER_DEALER_TRACKER_MAX_FILE_MB (default 64, per day file).
// Retention: at start-up a process deletes crawl-*.jsonl files in ITS OWN directory older than the retain window; nothing else is ever deleted.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';

export const SCHEMA_VERSION = 1;
export const DEFAULT_RETAIN_DAYS = 14;
export const DEFAULT_MAX_FILE_MB = 64;
export const MEM_SAMPLE_MIN_INTERVAL_MS = 2000;
export const MAX_CONSECUTIVE_WRITE_FAILURES = 3;
const FILE_RE = /^crawl-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const MB = 1048576;

const mb = (n) => (Number.isFinite(n) ? Math.round((n / MB) * 10) / 10 : null);
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));
// An error message can carry a URL or a path; neither is wanted in a performance log.
export const scrubMessage = (m) => clip(String(m == null ? '' : m).replace(/https?:\/\/\S+/gi, '<url>').replace(/(^|[\s(])\/[\w./-]{3,}/g, '$1<path>').replace(/\s+/g, ' ').trim(), 160);

function memSnapshot() {
    const m = process.memoryUsage();
    return { rssMb: mb(m.rss), heapUsedMb: mb(m.heapUsed) };
}

const NOOP_METHODS = ['begin', 'endProbeSkip', 'noUrls', 'discovered', 'urlStart', 'pageBlocked', 'pageSkipped', 'urlError', 'vehicle', 'error', 'end', 'runEnd'];
export function noopTracker(reason = 'disabled') {
    const t = { enabled: false, reason, stats: () => ({ written: 0, failures: 0, disabled: true }) };
    for (const k of NOOP_METHODS) t[k] = () => {};
    return t;
}

/**
 * @param {{ state?: string, brand?: string, dealerTotal?: number, runDate?: string, cwd?: string, box?: string, env?: object, now?: () => number,
 *           appendLine?: (file: string, line: string) => void, statSize?: (file: string) => number, stderr?: (msg: string) => void, installExitHandler?: boolean }} [opts]
 */
export function createDealerTracker(opts = {}) {
    try {
        return build(opts);
    } catch (e) {
        try { (opts.stderr || ((m) => process.stderr.write(m + '\n')))(`[dealer-tracker] disabled at start-up: ${scrubMessage(e && e.message)}`); } catch { /* nothing */ }
        return noopTracker('startup-failed');
    }
}

function build(opts) {
    const env = opts.env || process.env;
    if (String(env.CRAWLER_DEALER_TRACKER || '').toLowerCase() === 'off') return noopTracker('env-off');
    const now = opts.now || Date.now;
    const stderr = opts.stderr || ((m) => process.stderr.write(m + '\n'));
    const appendLine = opts.appendLine || ((file, line) => fs.appendFileSync(file, line, { flag: 'a' }));
    const statSize = opts.statSize || ((file) => { try { return fs.statSync(file).size; } catch { return 0; } });
    const cwd = opts.cwd || process.cwd();
    const runDate = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.runDate)) ? opts.runDate : new Date(now()).toISOString().slice(0, 10);
    const dir = path.join(cwd, 'data', 'dealer_tracker');
    const file = path.join(dir, `crawl-${runDate}.jsonl`);
    fs.mkdirSync(dir, { recursive: true });

    const retainDays = Number(env.CRAWLER_DEALER_TRACKER_RETAIN_DAYS) > 0 ? Number(env.CRAWLER_DEALER_TRACKER_RETAIN_DAYS) : DEFAULT_RETAIN_DAYS;
    const maxBytes = (Number(env.CRAWLER_DEALER_TRACKER_MAX_FILE_MB) > 0 ? Number(env.CRAWLER_DEALER_TRACKER_MAX_FILE_MB) : DEFAULT_MAX_FILE_MB) * MB;
    try { pruneOld(dir, runDate, retainDays, { now: now(), keepName: path.basename(file) }); } catch { /* retention is best effort */ }

    const box = opts.box || env.CRAWLER_BOX || os.hostname();
    const pid = process.pid;
    const startMs = now();
    const state = opts.state || null;
    const brand = opts.brand || null;
    const run = `${runDate}/${box}/${state || '-'}/${String(brand || '-').toLowerCase().replace(/[^a-z0-9]+/g, '-')}/p${pid}-${startMs}`;
    const heapLimitMb = mb(v8.getHeapStatistics().heap_size_limit);

    let written = 0;
    let failures = 0;
    let consecutive = 0;
    let disabled = false; // no more begin/run records from this process (cap or write failures); see `stopReason`
    let stopReason = null;
    let sizeKnown = statSize(file);
    let sinceStat = 0;
    let reported = false;
    const report = (msg) => { if (reported) return; reported = true; try { stderr(`[dealer-tracker] ${msg}`); } catch { /* nothing */ } };

    // kind: 'open' (begin, run_start, run_end: dropped once stopped) | 'close' (the end of an attempt whose begin was logged: allowed after a size-cap stop).
    // Returns true when the record was appended.
    function appendRecord(rec) {
        const line = '\n' + JSON.stringify(rec) + '\n';
        try { appendLine(file, line); } catch (e) {
            if (!e || e.code !== 'ENOENT') throw e;
            fs.mkdirSync(dir, { recursive: true }); // the directory was removed under us (a cleanup, a restore): make it again, once
            appendLine(file, line);
        }
        sizeKnown += Buffer.byteLength(line);
        written++;
    }
    function stop(reason) {
        if (stopReason) return;
        stopReason = reason; disabled = true;
        report(reason === 'size_cap' ? `day file reached ${Math.round(maxBytes / MB)} MB, no more begin records from this process` : 'stopped after repeated write failures');
        try { appendRecord({ v: SCHEMA_VERSION, ev: 'logging_stopped', t: new Date(now()).toISOString(), run, pid, box, state, brand, reason, fileBytes: sizeKnown, capBytes: maxBytes, attemptsLogged: counters.attempts, openAttempt: cur ? cur.attempt : null }); } catch { /* best effort: a failing disk cannot take a marker either */ }
    }
    function write(rec, kind = 'open') {
        try {
            if (stopReason === 'write_failures') return false;
            if (++sinceStat >= 20) { sizeKnown = statSize(file); sinceStat = 0; }
            if (!stopReason && sizeKnown >= maxBytes) stop('size_cap');
            if (stopReason && kind !== 'close') return false;
            appendRecord(rec);
            consecutive = 0;
            return true;
        } catch (e) {
            failures++;
            consecutive++;
            report(`write failed (${scrubMessage(e && e.message)}); the crawl is not affected`);
            if (consecutive >= MAX_CONSECUTIVE_WRITE_FAILURES) stop('write_failures');
            return false;
        }
    }

    // ---- the open attempt (dealers run one at a time inside a process) ----
    let cur = null;
    let seq = 0;
    const safe = (fn) => (...a) => { try { return fn(...a); } catch (e) { failures++; report(`internal error (${scrubMessage(e && e.message)}); the crawl is not affected`); return undefined; } };
    const identity = (c) => ({ run, attempt: c.attempt, pid, box, state, brand, dealer: c.dealer, retry: c.retry, index: c.index, total: opts.dealerTotal ?? null });

    function dealerIdentity(d) {
        const domain = d && d.domain ? String(d.domain).toLowerCase() : null;
        return {
            id: d && d.id != null ? String(d.id) : null, // the dealer file's own slug; null when a dealer file has none
            key: domain || (d && d.name ? `${d.name}|${d.city || ''}|${d.state || ''}`.toLowerCase() : null),
            name: clip(d && d.name, 120), city: clip(d && d.city, 60), state: clip(d && d.state, 4), domain,
        };
    }

    function sample(c) {
        const t = now();
        if (t - c.lastSampleAt < MEM_SAMPLE_MIN_INTERVAL_MS) return;
        c.lastSampleAt = t;
        const s = memSnapshot();
        if (s.rssMb != null && s.rssMb > c.peakRssMb) c.peakRssMb = s.rssMb;
        if (s.heapUsedMb != null && s.heapUsedMb > c.peakHeapMb) c.peakHeapMb = s.heapUsedMb;
    }

    function finish(c, status, reason, extra = {}) {
        const endMs = now();
        const s = memSnapshot();
        if (s.rssMb != null && s.rssMb > c.peakRssMb) c.peakRssMb = s.rssMb;
        if (s.heapUsedMb != null && s.heapUsedMb > c.peakHeapMb) c.peakHeapMb = s.heapUsedMb;
        const attempted = c.attempted;
        const succeeded = Math.max(0, attempted - c.blocked - c.skippedVdp - c.errored);
        const degraded = [];
        if (c.blocked > 0) degraded.push('pages_blocked');
        if (c.skippedVdp > 0) degraded.push('vdp_skipped');
        if (c.errored > 0) degraded.push('url_errors');
        const rec = {
            v: SCHEMA_VERSION, ev: 'end', ...identity(c),
            startedAt: new Date(c.startMs).toISOString(), endedAt: new Date(endMs).toISOString(),
            durationMs: endMs - c.startMs,
            msToDiscovery: c.discoveredAtMs == null ? null : c.discoveredAtMs - c.startMs,
            urls: {
                discovered: c.discovered,
                attempted,
                succeeded, // fetched and not blocked / skipped / errored (a page with no vehicle on it counts; see vins)
                blocked: c.blocked, skippedVdp: c.skippedVdp, errored: c.errored,
            },
            vins: c.vins,
            errors: { exception: c.err ? 1 : 0, urlErrors: c.errored, errorName: c.err ? clip(c.err.name, 60) : null, errorMessage: c.err ? scrubMessage(c.err.message) : null },
            blocking: { pageBlocked: c.blocked, blockClass: c.blockClass, wall: extra.wall || null, probeClass: extra.probeClass || null, probeHttpStatus: extra.probeHttpStatus ?? null },
            status, reason, degraded,
            discoveryOutcome: c.discoveryOutcome,
            browserFallback: extra.browserFallback ?? null,
            countedAsFailedStore: extra.countedAsFailedStore ?? null, // the crawl's own failedDealerNames verdict (excluded from the sold-diff and the sweep)
            heapStop: extra.heapStop || null,
            note: extra.note || null,
            mem: {
                process: {
                    scope: 'process',
                    rssMbStart: c.memStart.rssMb, rssMbEnd: s.rssMb, heapUsedMbStart: c.memStart.heapUsedMb, heapUsedMbEnd: s.heapUsedMb, heapLimitMb,
                    peakRssMbSampled: c.peakRssMb > 0 ? c.peakRssMb : null, peakHeapUsedMbSampled: c.peakHeapMb > 0 ? c.peakHeapMb : null,
                    peakRssMbProcessLifetime: (() => { try { return mb(process.resourceUsage().maxRSS * 1024); } catch { return null; } })(),
                    hostFreeMemMb: mb(os.freemem()),
                },
                dealerAttributable: null,
                dealerEstimate: c.memStart.heapUsedMb != null && s.heapUsedMb != null
                    ? { heapUsedDeltaMb: Math.round((s.heapUsedMb - c.memStart.heapUsedMb) * 10) / 10, exact: false, basis: 'used heap at end minus at start, same process, includes GC timing and what the dealer left retained' }
                    : null,
            },
        };
        if (c.beginDropped !== true) write(rec, 'close');
        counters.attempts++;
    }
    const counters = { attempts: 0 };

    const api = {
        enabled: true,
        file,
        stats: () => ({ written, failures, disabled, stopReason }),

        begin: safe((dealer, { retry = false, index = null } = {}) => {
            if (cur) closeOrphan('next_attempt_started'); // an attempt left open by a path with no hook
            const startMs = now();
            cur = {
                attempt: `${run}#${++seq}`, dealer: dealerIdentity(dealer), retry: !!retry, index, startMs, lastSampleAt: -Infinity,
                memStart: memSnapshot(), peakRssMb: 0, peakHeapMb: 0,
                discovered: null, discoveredAtMs: null, discoveryOutcome: null, attempted: 0, blocked: 0, skippedVdp: 0, errored: 0, vins: 0, blockClass: null, err: null,
            };
            if (cur.memStart.rssMb != null) cur.peakRssMb = cur.memStart.rssMb;
            if (cur.memStart.heapUsedMb != null) cur.peakHeapMb = cur.memStart.heapUsedMb;
            if (!write({ v: SCHEMA_VERSION, ev: 'begin', t: new Date(startMs).toISOString(), ...identity(cur), mem: { process: { scope: 'process', ...cur.memStart } } }) && stopReason) cur.beginDropped = true; // dropped by a stop: no orphan end either
        }),

        // Skipped by the bot-protection probe before any page was requested.
        endProbeSkip: safe((getProbe) => {
            const c = cur; if (!c) return;
            let p = null; try { p = getProbe(); } catch { /* keep going without the detail */ }
            cur = null;
            finish(c, 'skipped', 'probe_skip', { probeClass: clip(p && p.classification, 60), probeHttpStatus: p && p.httpStatus != null ? Number(p.httpStatus) : null, countedAsFailedStore: true });
        }),

        // Sitemap discovery came back with no vehicle URLs. `getDiscovery()` -> { outcome }.
        noUrls: safe((getDiscovery) => {
            const c = cur; if (!c) return;
            let d = null; try { d = getDiscovery(); } catch { /* ignore */ }
            c.discoveryOutcome = clip(d && d.outcome, 30);
            c.discovered = c.discoveryOutcome === 'failed' ? null : 0; // a failed discovery says nothing about how many URLs exist
            c.discoveredAtMs = now();
        }),

        discovered: safe((n) => {
            const c = cur; if (!c) return;
            c.discovered = Number.isFinite(n) ? n : null;
            c.discoveredAtMs = now();
        }),

        urlStart: safe(() => { const c = cur; if (!c) return; c.attempted++; sample(c); }),
        pageBlocked: safe((cls) => { const c = cur; if (!c) return; c.blocked++; c.blockClass = clip(cls, 60) || c.blockClass; }),
        pageSkipped: safe(() => { const c = cur; if (c) c.skippedVdp++; }),
        urlError: safe(() => { const c = cur; if (c) c.errored++; }),
        vehicle: safe(() => { const c = cur; if (c) c.vins++; }),
        error: safe((err) => { const c = cur; if (c) c.err = { name: err && err.name, message: err && err.message }; }),

        // Called from the dealer's `finally`. `getCtx()` is evaluated inside this try/catch, so a bad identifier in the hook cannot throw into the crawl.
        end: safe((getCtx) => {
            const c = cur; if (!c) return;
            cur = null;
            let x = null; let ctxFailed = false;
            try { x = getCtx() || {}; } catch { x = {}; ctxFailed = true; }
            const wall = x.wall ? { cls: clip(x.wall.cls, 60), status: x.wall.status ?? null } : null;
            let heapStop = null;
            if (x.heapStopped) { try { const h = x.heapSnapshot && x.heapSnapshot(); if (h) heapStop = { usedMb: h.usedMb ?? null, limitMb: h.limitMb ?? null, stopAtMb: h.stopAtMb ?? null }; } catch { /* detail only */ } }
            const [status, reason] = classify(c, x, wall);
            finish(c, status, reason, { wall, heapStop, browserFallback: typeof x.browserFallback === 'boolean' ? x.browserFallback : null, countedAsFailedStore: typeof x.countedAsFailedStore === 'boolean' ? x.countedAsFailedStore : null, note: ctxFailed ? 'context_unavailable' : null });
        }),

        runEnd: safe(() => {
            if (cur) closeOrphan('loop_finished_with_open_attempt');
            write({ v: SCHEMA_VERSION, ev: 'run_end', t: new Date(now()).toISOString(), run, pid, box, state, brand, attempts: counters.attempts, durationMs: now() - startMs, trackerWrites: written, trackerFailures: failures, mem: { process: { scope: 'process', ...memSnapshot() } } });
        }),
    };
    function closeOrphan(reason) {
        const c = cur; if (!c) return;
        cur = null;
        finish(c, 'incomplete', reason, {});
    }

    write({
        v: SCHEMA_VERSION, ev: 'run_start', t: new Date(startMs).toISOString(), run, pid, box, state, brand, dealers: opts.dealerTotal ?? null, node: process.version, heapLimitMb,
        config: { pageWorkers: Number(env.CRAWLER_CONCURRENCY) || null, heapGuardRatio: env.CRAWLER_HEAP_GUARD_RATIO != null && env.CRAWLER_HEAP_GUARD_RATIO !== '' ? Number(env.CRAWLER_HEAP_GUARD_RATIO) : null },
        mem: { process: { scope: 'process', ...memSnapshot() } },
    });

    // A clean process exit (including an uncaught exception, which exits 1) with an attempt still open: say so. A SIGKILL / OOM abort never gets here: that
    // attempt keeps its begin record and no end record, which is how readers recognise it.
    if (opts.installExitHandler !== false) {
        process.on('exit', (code) => {
            try { if (cur) { const c = cur; cur = null; finish(c, 'incomplete', 'process_exit', { note: `exit code ${code}` }); } } catch { /* nothing */ }
        });
    }
    return api;
}

// Status + reason from what the hooks counted and what the crawl itself knew at the end. Order matters: the first match wins.
export function classify(c, x, wall) {
    if (c.err) return ['failed', 'exception'];
    if (x.heapStopped) return ['partial', 'heap_stop'];
    if (x.timedOut) return c.discovered === null || c.attempted === 0 ? ['skipped', 'timeout_before_extract'] : ['partial', 'timeout_1h'];
    if (wall) return c.discovered === null || c.attempted === 0 ? ['skipped', 'wall_sitemap'] : ['partial', 'wall_mid_crawl'];
    if (c.discovered === null) return ['skipped', c.discoveryOutcome === 'failed' ? 'discovery_failed' : 'no_discovery_result'];
    if (c.discovered === 0) return ['skipped', 'no_inventory_urls'];
    if (c.vins === 0) {
        if (c.attempted > 0 && c.blocked === c.attempted) return ['failed', 'all_pages_blocked'];
        if (c.attempted > 0 && c.skippedVdp === c.attempted) return ['failed', 'all_pages_skipped_vdp'];
        return ['failed', 'no_vehicles_extracted'];
    }
    if (c.attempted < c.discovered) return ['partial', 'stopped_early_unknown'];
    return ['complete', null];
}

export const ACTIVE_FILE_GRACE_MS = 48 * 3600 * 1000;
/**
 * Delete crawl-YYYY-MM-DD.jsonl older than the window, in `dir` only. Never deletes: the caller's own file (`keepName`), any file written to in the last 48 h
 * (an active file), or anything when the window would be computed from a run date in the future (cutoff = the earlier of the run date and today).
 */
export function pruneOld(dir, runDate, retainDays, { now = Date.now(), keepName = null } = {}) {
    const base = Math.min(Date.parse(`${runDate}T00:00:00Z`), now);
    const cutoff = base - retainDays * 86400000;
    let removed = 0;
    for (const name of fs.readdirSync(dir)) {
        const m = FILE_RE.exec(name);
        if (!m || name === keepName) continue; // only files this module wrote, in this directory
        if (!(Date.parse(`${m[1]}T00:00:00Z`) < cutoff)) continue;
        try {
            const full = path.join(dir, name);
            if (now - fs.statSync(full).mtimeMs < ACTIVE_FILE_GRACE_MS) continue; // recently written: someone may still be appending to it
            fs.unlinkSync(full); removed++;
        } catch { /* leave it */ }
    }
    return removed;
}
