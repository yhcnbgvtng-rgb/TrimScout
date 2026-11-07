#!/usr/bin/env node
// Local summary of the per-dealer crawl tracker (src/dealerTracker.js): slowest dealers, partial / skip reasons, interrupted attempts.
//
//   node scripts/dealer-tracker-summary.mjs                       # newest day file in data/dealer_tracker
//   node scripts/dealer-tracker-summary.mjs --date 2026-11-08 --box box5 --top 25
//   node scripts/dealer-tracker-summary.mjs --file /path/to/crawl-2026-11-08.jsonl --state TX --json
//   node scripts/dealer-tracker-summary.mjs --days 3              # the newest 3 day files together
//
// Reads files only; writes nothing. Malformed lines are counted and skipped.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const FILE_RE = /^crawl-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export async function readRecords(files) {
    const records = [];
    let malformed = 0;
    for (const f of files) {
        const rl = readline.createInterface({ input: fs.createReadStream(f, { encoding: 'utf8' }), crlfDelay: Infinity });
        for await (const line of rl) {
            if (!line.trim()) continue;
            try { const r = JSON.parse(line); if (r && typeof r === 'object') records.push(r); else malformed++; } catch { malformed++; }
        }
    }
    return { records, malformed };
}

// The tracker records the machine's hostname (no env edit needed on the boxes); docs/BOXES.md private IPs name them.
export const BOX_ALIASES = { 'ip-172-26-5-232': 'box1', 'ip-172-26-6-89': 'box2', 'ip-172-26-15-105': 'box3', 'ip-172-26-11-241': 'box4', 'ip-172-26-13-207': 'box5' };
export const boxLabel = (b) => BOX_ALIASES[b] || b;

const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : 'n/a');
const fmtMs = (ms) => {
    if (ms == null) return 'n/a';
    const s = Math.round(ms / 1000);
    return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};

/** Pure: records -> summary object. */
export function summarize(rawRecords, { box = null, state = null, brand = null, top = 15 } = {}) {
    const records = rawRecords.map((r) => (r && r.box ? { ...r, box: boxLabel(r.box) } : r));
    const keep = (r) => (!box || r.box === box) && (!state || r.state === state) && (!brand || String(r.brand || '').toLowerCase() === String(brand).toLowerCase());
    const sel = records.filter((r) => r.attempt || r.ev === 'run_start' || r.ev === 'run_end' || r.ev === 'logging_stopped').filter(keep);
    const begins = new Map();
    const ends = new Map();
    const runs = new Map();
    const stops = [];
    for (const r of sel) {
        if (r.ev === 'begin') begins.set(r.attempt, r);
        else if (r.ev === 'end') ends.set(r.attempt, r);
        else if (r.ev === 'run_start') runs.set(r.run, { ...(runs.get(r.run) || {}), ...r });
        else if (r.ev === 'run_end') runs.set(r.run, { ...(runs.get(r.run) || {}), finished: true });
        else if (r.ev === 'logging_stopped') stops.push(r);
    }
    const finished = [...ends.values()];
    // A begin with no end: the process died mid-attempt (crash, OOM abort, kill) or is still running.
    const interrupted = [...begins.values()].filter((b) => !ends.has(b.attempt));
    const exitIncomplete = finished.filter((e) => e.status === 'incomplete');
    const real = finished.filter((e) => e.status !== 'incomplete');

    const byStatus = {};
    const byReason = {};
    for (const e of real) {
        byStatus[e.status] = (byStatus[e.status] || 0) + 1;
        if (e.reason) byReason[e.reason] = (byReason[e.reason] || 0) + 1;
    }
    const notComplete = real.filter((e) => e.status !== 'complete');
    const groupRate = (keyFn) => {
        const g = new Map();
        for (const e of real) {
            const k = keyFn(e); const o = g.get(k) || { key: k, attempts: 0, notComplete: 0, failedStore: 0, totalMs: 0 };
            o.attempts++; if (e.status !== 'complete') o.notComplete++; if (e.countedAsFailedStore) o.failedStore++; o.totalMs += e.durationMs || 0; g.set(k, o);
        }
        return [...g.values()].sort((a, b) => b.notComplete / b.attempts - a.notComplete / a.attempts || b.notComplete - a.notComplete || b.attempts - a.attempts);
    };
    const slowest = [...real].sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0)).slice(0, top).map((e) => ({
        dealer: e.dealer && (e.dealer.id || e.dealer.name), name: e.dealer && e.dealer.name, state: e.state, brand: e.brand, box: e.box, durationMs: e.durationMs, status: e.status, reason: e.reason,
        discovered: e.urls && e.urls.discovered, attempted: e.urls && e.urls.attempted, blocked: e.urls && e.urls.blocked, vins: e.vins,
        peakRssMb: e.mem && e.mem.process && e.mem.process.peakRssMbSampled, heapDeltaMb: e.mem && e.mem.dealerEstimate ? e.mem.dealerEstimate.heapUsedDeltaMb : null, retry: e.retry,
    }));
    const heapStops = real.filter((e) => e.reason === 'heap_stop').map((e) => ({ dealer: e.dealer && (e.dealer.id || e.dealer.name), state: e.state, brand: e.brand, vins: e.vins, heapStop: e.heapStop, peakHeapUsedMbSampled: e.mem && e.mem.process && e.mem.process.peakHeapUsedMbSampled }));
    // Logging that STOPPED (size cap, repeated write failures) is a different thing from an attempt that was INTERRUPTED: after a stop the run's later dealers are
    // simply absent from the data, and the open attempt (if any) still got its end record. Each stop says how many dealers that run had and how many were logged.
    const loggedPerRun = new Map();
    for (const e of finished) loggedPerRun.set(e.run, (loggedPerRun.get(e.run) || 0) + 1);
    const loggingStopped = stops.map((x) => {
        const run = runs.get(x.run) || {};
        const dealers = run.dealers ?? null;
        const logged = loggedPerRun.get(x.run) || 0;
        return { run: x.run, box: x.box, state: x.state, brand: x.brand, reason: x.reason, at: x.t, fileBytes: x.fileBytes, dealersInRun: dealers, attemptsLogged: logged, notLoggedAtLeast: dealers == null ? null : Math.max(0, dealers - logged) };
    });
    const sum = (f) => real.reduce((a, e) => a + (f(e) || 0), 0);
    return {
        attempts: real.length,
        runs: runs.size,
        runsWithoutRunEnd: [...runs.values()].filter((r) => !r.finished).length,
        byStatus, byReason,
        notCompleteRate: real.length ? notComplete.length / real.length : null,
        countedAsFailedStore: real.filter((e) => e.countedAsFailedStore === true).length,
        countedAsFailedStoreKnown: real.filter((e) => typeof e.countedAsFailedStore === 'boolean').length,
        totals: { durationMs: sum((e) => e.durationMs), urlsAttempted: sum((e) => e.urls && e.urls.attempted), vins: sum((e) => e.vins), pagesBlocked: sum((e) => e.urls && e.urls.blocked) },
        loggingStopped,
        interrupted: interrupted.map((b) => ({ attempt: b.attempt, dealer: b.dealer && (b.dealer.id || b.dealer.name), state: b.state, brand: b.brand, box: b.box, pid: b.pid, startedAt: b.t })),
        exitIncomplete: exitIncomplete.map((e) => ({ dealer: e.dealer && (e.dealer.id || e.dealer.name), state: e.state, brand: e.brand, box: e.box, vins: e.vins, note: e.note })),
        byState: groupRate((e) => e.state || '?'),
        byBrand: groupRate((e) => e.brand || '?'),
        byBox: groupRate((e) => e.box || '?'),
        slowest, heapStops,
    };
}

export function render(s, filters = {}) {
    const f = Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ');
    const out = [];
    out.push(`Dealer crawl tracker${f ? ` (${f})` : ''}: ${s.attempts} finished attempts in ${s.runs} run(s)`);
    if (s.attempts === 0 && s.interrupted.length === 0) return out.concat('No records match.').join('\n');
    out.push(`Not complete (partial + skipped + failed): ${s.attempts - (s.byStatus.complete || 0)} of ${s.attempts} (${pct(s.attempts - (s.byStatus.complete || 0), s.attempts)})`);
    out.push(`  by status: ${Object.entries(s.byStatus).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
    out.push(`  the crawl itself excluded ${s.countedAsFailedStore} of ${s.countedAsFailedStoreKnown} attempts from the sold-diff/sweep (failedDealerNames)`);
    out.push('', 'Partial / skip / failure reasons:');
    for (const [k, v] of Object.entries(s.byReason).sort((a, b) => b[1] - a[1])) out.push(`  ${String(v).padStart(5)}  ${pct(v, s.attempts).padStart(6)}  ${k}`);
    if (!Object.keys(s.byReason).length) out.push('  none');
    if (s.loggingStopped.length) {
        out.push('', `LOGGING STOPPED in ${s.loggingStopped.length} run(s): the data below is INCOMPLETE for these (dealers after the stop were not logged; this is not a crash):`);
        for (const x of s.loggingStopped.slice(0, 20)) out.push(`  ${x.box} ${x.state}/${x.brand} ${x.reason} at ${x.at}: ${x.attemptsLogged} of ${x.dealersInRun ?? '?'} dealers logged${x.notLoggedAtLeast != null ? ` (>= ${x.notLoggedAtLeast} missing)` : ''}`);
    }
    out.push('', `Interrupted attempts (begin record, no end: crash, OOM abort, kill, or still running; a logging stop does not create these): ${s.interrupted.length}`);
    for (const i of s.interrupted.slice(0, 20)) out.push(`  ${i.box} ${i.state}/${i.brand} ${i.dealer} pid ${i.pid} since ${i.startedAt}`);
    if (s.exitIncomplete.length) { out.push(`Attempts open at a clean process exit: ${s.exitIncomplete.length}`); for (const i of s.exitIncomplete.slice(0, 10)) out.push(`  ${i.box} ${i.state}/${i.brand} ${i.dealer} (${i.note || ''})`); }
    if (s.runsWithoutRunEnd) out.push(`Runs with no run_end record (loop did not finish, or still running): ${s.runsWithoutRunEnd}`);
    out.push('', 'Slowest dealers:');
    out.push('  ' + ['time', 'status/reason', 'urls found/tried/blocked', 'vins', 'peakRSS', 'heapΔ', 'dealer'].join('  '));
    for (const e of s.slowest) out.push(`  ${fmtMs(e.durationMs).padStart(7)}  ${(e.status + (e.reason ? '/' + e.reason : '')).padEnd(28)}  ${[e.discovered ?? '?', e.attempted ?? '?', e.blocked ?? '?'].join('/').padEnd(14)}  ${String(e.vins ?? '?').padStart(5)}  ${e.peakRssMb == null ? 'n/a' : e.peakRssMb + 'MB'}  ${e.heapDeltaMb == null ? 'n/a' : e.heapDeltaMb + 'MB'}  ${e.state} ${e.brand} ${e.name || e.dealer}${e.retry ? ' (retry)' : ''} [${e.box}]`);
    if (s.heapStops.length) { out.push('', `Heap stops: ${s.heapStops.length}`); for (const h of s.heapStops.slice(0, 15)) out.push(`  ${h.state}/${h.brand} ${h.dealer} after ${h.vins} vins, heap ${h.heapStop ? `${h.heapStop.usedMb}/${h.heapStop.limitMb} MB (stop at ${h.heapStop.stopAtMb})` : 'n/a'}`); }
    const grp = (title, rows, n) => { out.push('', title); for (const r of rows.slice(0, n)) out.push(`  ${String(r.key).padEnd(14)} ${String(r.notComplete).padStart(4)}/${String(r.attempts).padEnd(4)} not complete (${pct(r.notComplete, r.attempts)}), ${r.failedStore} excluded from sweep, ${fmtMs(r.totalMs)} total`); };
    grp('Not-complete rate by box:', s.byBox, 10);
    grp('Not-complete rate by state (worst first):', s.byState, 15);
    grp('Not-complete rate by brand (worst first):', s.byBrand, 15);
    return out.join('\n');
}

export function pickFiles({ dir, file, date, days }) {
    if (file) return [file];
    const names = fs.readdirSync(dir).filter((n) => FILE_RE.test(n)).sort();
    if (date) return names.filter((n) => n === `crawl-${date}.jsonl`).map((n) => path.join(dir, n));
    return names.slice(-(days || 1)).map((n) => path.join(dir, n));
}

async function main(argv) {
    const a = {};
    for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (k === '--json') a.json = true; else if (k.startsWith('--')) a[k.slice(2)] = argv[++i]; }
    const dir = path.resolve(a.dir || path.join(process.cwd(), 'data', 'dealer_tracker'));
    if (!a.file && !fs.existsSync(dir)) { console.error(`No tracker directory at ${dir}`); process.exit(1); }
    const files = pickFiles({ dir, file: a.file, date: a.date, days: a.days ? Number(a.days) : 1 });
    if (!files.length) { console.error('No tracker files match.'); process.exit(1); }
    const { records, malformed } = await readRecords(files);
    const filters = { box: a.box, state: a.state ? a.state.toUpperCase() : undefined, brand: a.brand };
    const s = summarize(records, { ...filters, top: Number(a.top) || 15 });
    if (a.json) { console.log(JSON.stringify({ files, malformed, ...s }, null, 2)); return; }
    console.log(`Files: ${files.map((f) => path.basename(f)).join(', ')}${malformed ? `  (${malformed} malformed line(s) skipped)` : ''}`);
    console.log(render(s, filters));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
