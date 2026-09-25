// Per-box nightly SLA report — built from data the driver already
// collects (stateSummary.brands[*].{dealerCount,durationMs,status,stats})
// plus the per-brand log files every run already writes, never from new
// standalone.js/enricher.js return-value plumbing. Deliberately low-risk:
// the crawl pipeline itself is untouched, this only reads what it already
// produces, after the fact. See docs/CAPACITY_SLA.md's "Daily box
// performance" section for how to read the output.
//
// Some fields (Chromium crash count, real peak CPU/RAM over the whole
// run) aren't instrumented yet — this reports 0/null for those rather
// than a fabricated number, with `notInstrumented: true` alongside so a
// reader (or fleet-report.mjs) can tell "really zero" apart from "not
// measured". Extending these later is additive: add the new counter,
// leave everything else alone.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

function readLogSafe(logFile) {
  if (!logFile) return '';
  return fs.readFile(logFile, 'utf-8').catch(() => '');
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Real, exact patterns already printed by standalone.js/enricher.js/
// shared_data_lock.js — see this file's own comment above and the commit
// that added this module for where each was confirmed live.
const WAF_SKIP_RE = /🛡️ SKIP [^:]+: ([A-Z0-9_]+)/g;
const EMPTY_INVENTORY_RE = /⚠️ No inventory URLs detected for/g;
const NHTSA_SUCCESS_RE = /✓ Enriched \S+ \([^)]*\): Base \S+ \| Options: \S+ \| (?!NHTSA lookup unavailable)/g;
const NHTSA_FAIL_RE = /NHTSA lookup unavailable/g;
const LOCK_TIMEOUT_RE = /Timed out after \d+ms waiting for the shared-data lock/g;

function countMatches(text, re) {
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

// Aggregates the real per-brand log-file signals across every brand this
// run actually attempted (skipped-for-zero-dealers brands have no log
// file and contribute nothing, correctly).
async function collectLogSignals(stateSummary) {
  const wafByClass = {};
  let emptyInventory = 0;
  let nhtsaSuccess = 0;
  let nhtsaFail = 0;
  let lockTimeouts = 0;

  for (const brandResult of Object.values(stateSummary.brands || {})) {
    if (!brandResult.logFile) continue;
    const text = await readLogSafe(brandResult.logFile);
    if (!text) continue;

    for (const m of text.matchAll(WAF_SKIP_RE)) {
      wafByClass[m[1]] = (wafByClass[m[1]] || 0) + 1;
    }
    emptyInventory += countMatches(text, EMPTY_INVENTORY_RE);
    nhtsaSuccess += countMatches(text, NHTSA_SUCCESS_RE);
    nhtsaFail += countMatches(text, NHTSA_FAIL_RE);
    lockTimeouts += countMatches(text, LOCK_TIMEOUT_RE);
  }

  return { wafByClass, emptyInventory, nhtsaSuccess, nhtsaFail, lockTimeouts };
}

// `driverSummary` is exactly what main() builds/returns today (date,
// startedAt, finishedAt, states, grandTotals, capacityCheck — the last
// one added alongside this report). `config` carries the run-identifying
// env this process itself doesn't otherwise centralize: brandSet,
// runLabel, concurrency, budgetHours, publicIp (best-effort — no reliable
// zero-dependency way to learn a box's own public IP, so this is read
// from CRAWLER_BOX_PUBLIC_IP if set, else left null rather than guessed).
export async function buildBoxReport(driverSummary, config = {}) {
  const {
    brandSet = 'core',
    runLabel = null,
    concurrency = null,
    budgetHours = null,
    publicIp = process.env.CRAWLER_BOX_PUBLIC_IP || null,
  } = config;

  const states = driverSummary.states || {};
  const stateList = Object.keys(states);

  const startedAtMs = Date.parse(driverSummary.startedAt);
  const finishedAtMs = driverSummary.finishedAt ? Date.parse(driverSummary.finishedAt) : Date.now();
  const wallClockHours = (finishedAtMs - startedAtMs) / 3600000;

  const hitBudget = stateList.some((s) => states[s]?.status === 'skipped' && /time budget/.test(states[s]?.reason || ''));

  let rooftopsAttempted = 0;
  let rooftopsCompleted = 0;
  const secondsPerRooftopSamples = [];
  let vehiclesScraped = 0;
  let skippedForBotProtectionTotal = 0;

  let wafByClass = {};
  let emptyInventoryTotal = 0;
  let nhtsaSuccessTotal = 0;
  let nhtsaFailTotal = 0;
  let lockTimeoutsTotal = 0;

  const statesAttempted = [];
  const statesSkipped = [];
  const statesStolen = [];

  for (const state of stateList) {
    const stateSummary = states[state];
    if (stateSummary?.status === 'skipped') {
      statesSkipped.push({ state, reason: stateSummary.reason || 'unknown' });
      continue;
    }
    statesAttempted.push(state);
    if (stateSummary.stolen) statesStolen.push(state);

    for (const [brand, brandResult] of Object.entries(stateSummary.brands || {})) {
      if (brandResult.status === 'skipped') continue; // 0 dealers for this brand — nothing ran
      const dealerCount = brandResult.dealerCount || 0;
      rooftopsAttempted += dealerCount;
      if (brandResult.status === 'ok') rooftopsCompleted += dealerCount;
      if (dealerCount > 0 && Number.isFinite(brandResult.durationMs)) {
        secondsPerRooftopSamples.push(brandResult.durationMs / 1000 / dealerCount);
      }
      if (brandResult.stats) {
        vehiclesScraped += brandResult.stats.totalActiveInventory || 0;
        skippedForBotProtectionTotal += brandResult.stats.skippedForBotProtection || 0;
      }
    }

    const signals = await collectLogSignals(stateSummary);
    for (const [cls, count] of Object.entries(signals.wafByClass)) {
      wafByClass[cls] = (wafByClass[cls] || 0) + count;
    }
    emptyInventoryTotal += signals.emptyInventory;
    nhtsaSuccessTotal += signals.nhtsaSuccess;
    nhtsaFailTotal += signals.nhtsaFail;
    lockTimeoutsTotal += signals.lockTimeouts;
  }

  const sortedSamples = [...secondsPerRooftopSamples].sort((a, b) => a - b);
  const rooftopsPlanned = driverSummary.capacityCheck?.rooftops ?? null;
  const projectedHoursAtStart = driverSummary.capacityCheck?.projectedHours ?? null;
  const capacityRatio = projectedHoursAtStart ? wallClockHours / projectedHoursAtStart : null;

  const nhtsaAttempted = nhtsaSuccessTotal + nhtsaFailTotal;

  return {
    identity: {
      hostname: os.hostname(),
      publicIp,
      brandSet,
      runLabel,
      concurrency,
      budgetHours,
    },
    schedule: {
      date: driverSummary.date,
      actualStart: driverSummary.startedAt,
      actualEnd: driverSummary.finishedAt || null,
      wallClockHours: Number(wallClockHours.toFixed(2)),
      budgetHours,
      hitBudget,
      slaOk: !hitBudget && wallClockHours <= 24,
    },
    scope: {
      statesAssigned: stateList,
      statesAttempted,
      statesSkipped,
      // Cross-box work-stealing (CRAWLER_STEAL_ENABLED=1, src/crawl_claims.js) —
      // states this box claimed from the shared queue beyond its own static
      // assignment. Empty when stealing is off, or when this box never ran
      // out of local work early enough to steal anything. See the shared
      // crawl_claims table (deals-api's /api/ops/crawl-claims/status?runDate=
      // &brandSet=) for the fleet-wide view of who donated vs. who stole.
      statesStolen,
      rooftopsPlanned,
      rooftopsAttempted,
      rooftopsCompleted,
      rooftopsSkipped: rooftopsPlanned !== null ? Math.max(0, rooftopsPlanned - rooftopsAttempted) : null,
    },
    throughput: {
      secondsPerRooftopMean: mean(secondsPerRooftopSamples),
      secondsPerRooftopP50: percentile(sortedSamples, 0.5),
      secondsPerRooftopP90: percentile(sortedSamples, 0.9),
      sampleCount: secondsPerRooftopSamples.length,
      vehiclesScraped,
      vehiclesPerHour: wallClockHours > 0 ? Number((vehiclesScraped / wallClockHours).toFixed(1)) : null,
    },
    quality: {
      wafBlockedTotal: skippedForBotProtectionTotal,
      wafByClass,
      emptyInventoryDealers: emptyInventoryTotal,
      nhtsaAttempted,
      nhtsaSucceeded: nhtsaSuccessTotal,
      nhtsaSuccessRate: nhtsaAttempted > 0 ? Number((nhtsaSuccessTotal / nhtsaAttempted).toFixed(3)) : null,
      lockContentionTimeouts: lockTimeoutsTotal,
    },
    capacity: {
      projectedHoursAtStart,
      actualHours: Number(wallClockHours.toFixed(2)),
      ratio: capacityRatio !== null ? Number(capacityRatio.toFixed(2)) : null,
      overProjectionBy15Pct: capacityRatio !== null ? capacityRatio > 1.15 : null,
    },
    health: {
      // Best-effort, single point-in-time system snapshot taken when this
      // report is built — NOT a tracked peak over the run's whole
      // duration (the driver process itself doesn't do the heavy
      // lifting; standalone.js/patchright run as separate subprocesses).
      // A real peak would need periodic sampling added to runStep() —
      // left for a future pass rather than faked here.
      sampledAtReportTime: true,
      freeMemGb: Number((os.freemem() / 1024 / 1024 / 1024).toFixed(2)),
      totalMemGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
      loadAvg1m: os.loadavg()[0],
      chromiumCrashCount: 0,
      chromiumCrashCountNotInstrumented: true,
      lockCollisions: lockTimeoutsTotal,
    },
    links: {
      logsDir: 'logs/',
      summaryPath: `data/daily_crawl_runs/summary_${driverSummary.date}.json`,
      shardsTouched: statesAttempted,
    },
  };
}

const HISTORY_HEADER = 'date,box,brandSet,runLabel,rooftopsAttempted,wallClockHours,slaOk,secondsPerRooftopP50,secondsPerRooftopP90,sampleCount,wafBlockedTotal\n';

// Appends one row per real night per box/runLabel to a CSV sibling of
// CAPACITY_SLA.md, so the p50/p90 seconds-per-rooftop constants in
// capacity.js can eventually be recalibrated from real production
// nights instead of staying pinned to the 23-sample estimate this SLA
// work started from. Append-only and additive — never rewrites a past
// row, so the file itself is the audit trail.
export async function appendCapacityHistoryRow(report, csvPath) {
  const exists = await fs.access(csvPath).then(() => true).catch(() => false);
  if (!exists) {
    await fs.writeFile(csvPath, HISTORY_HEADER);
  }
  const row = [
    report.schedule.date,
    report.identity.hostname,
    report.identity.brandSet,
    report.identity.runLabel ?? '',
    report.scope.rooftopsAttempted,
    report.schedule.wallClockHours,
    report.schedule.slaOk,
    report.throughput.secondsPerRooftopP50 ?? '',
    report.throughput.secondsPerRooftopP90 ?? '',
    report.throughput.sampleCount,
    report.quality.wafBlockedTotal,
  ].join(',');
  await fs.appendFile(csvPath, `${row}\n`);
}

export function renderBoxReportHtml(report) {
  const slaColor = report.schedule.slaOk ? '#15803d' : '#b91c1c';
  const marginColor = report.schedule.wallClockHours > 22 ? '#b91c1c' : report.schedule.wallClockHours >= 20 ? '#a16207' : '#15803d';
  const row = (label, value) => `<tr><td style="padding:4px 12px;color:#666">${label}</td><td style="padding:4px 12px;font-family:monospace">${value ?? '—'}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Box report — ${report.identity.hostname}</title>
<style>body{font-family:-apple-system,sans-serif;background:#fafaf8;color:#1a1a1a;padding:24px}
h1{font-size:20px}h2{font-size:14px;text-transform:uppercase;color:#666;margin-top:24px}
table{border-collapse:collapse}pre{background:#f0efeb;padding:10px;border-radius:6px;overflow-x:auto}
.pill{display:inline-block;padding:3px 10px;border-radius:999px;color:white;font-size:12px;font-weight:600}</style>
</head><body>
<h1>${report.identity.hostname} — ${report.identity.brandSet}${report.identity.runLabel ? ` (${report.identity.runLabel})` : ''} — ${report.schedule.date}</h1>
<span class="pill" style="background:${slaColor}">${report.schedule.slaOk ? 'SLA OK' : 'SLA BREACH'}</span>
<span class="pill" style="background:${marginColor}">${report.schedule.wallClockHours}h wall-clock</span>
<h2>Schedule</h2><table>
${row('Start', report.schedule.actualStart)}
${row('End', report.schedule.actualEnd)}
${row('Wall-clock hours', report.schedule.wallClockHours)}
${row('Budget hours', report.schedule.budgetHours)}
${row('Hit budget (states skipped)', report.schedule.hitBudget)}
</table>
<h2>Scope</h2><table>
${row('States attempted', report.scope.statesAttempted.length)}
${row('States skipped', report.scope.statesSkipped.length)}
${row('Rooftops planned', report.scope.rooftopsPlanned)}
${row('Rooftops attempted', report.scope.rooftopsAttempted)}
${row('Rooftops completed', report.scope.rooftopsCompleted)}
${row('Rooftops skipped', report.scope.rooftopsSkipped)}
</table>
<h2>Throughput</h2><table>
${row('seconds/rooftop (mean)', report.throughput.secondsPerRooftopMean?.toFixed(1))}
${row('seconds/rooftop (p50)', report.throughput.secondsPerRooftopP50?.toFixed(1))}
${row('seconds/rooftop (p90)', report.throughput.secondsPerRooftopP90?.toFixed(1))}
${row('Vehicles scraped', report.throughput.vehiclesScraped)}
${row('Vehicles/hour', report.throughput.vehiclesPerHour)}
</table>
<h2>Quality</h2><table>
${row('WAF-blocked total', report.quality.wafBlockedTotal)}
${row('WAF by class', `<pre>${JSON.stringify(report.quality.wafByClass, null, 2)}</pre>`)}
${row('Empty-inventory dealers', report.quality.emptyInventoryDealers)}
${row('NHTSA success rate', report.quality.nhtsaSuccessRate !== null ? `${(report.quality.nhtsaSuccessRate * 100).toFixed(1)}%` : '—')}
${row('Lock contention timeouts', report.quality.lockContentionTimeouts)}
</table>
<h2>Capacity</h2><table>
${row('Projected hours (at start)', report.capacity.projectedHoursAtStart?.toFixed(1))}
${row('Actual hours', report.capacity.actualHours)}
${row('Ratio (actual/projected)', report.capacity.ratio)}
${row('Over projection by &gt;15%?', report.capacity.overProjectionBy15Pct)}
</table>
<h2>Health (best-effort)</h2><table>
${row('Free mem (GB)', report.health.freeMemGb)}
${row('Load avg (1m)', report.health.loadAvg1m?.toFixed(2))}
${row('Chromium crashes', `${report.health.chromiumCrashCount} (not instrumented yet)`)}
</table>
</body></html>`;
}
