#!/usr/bin/env node
// Fleet rollup for the per-box SLA reports written by box_report.js
// (data/runs/<date>/<runLabel>/box-report.json on EACH box — box_report.js
// itself has no fleet-wide view, it only knows its own box). This script
// runs from the operator's machine (never from a box, and never on a
// cron), pulls every box's latest report(s) over SSH, and renders one
// table: data/runs/<date>/fleet-summary.json + fleet-summary.html.
//
// Read-only: it never touches CRAWL_STATES, concurrency, or any crawl
// behavior on any box — see docs/CAPACITY_SLA.md's "Daily box
// performance" section for how to read the output day to day.
//
// Usage:
//   npm run fleet-report                 # today (ET) on all 4 boxes
//   node scripts/fleet-report.mjs --date=2026-09-21
//   node scripts/fleet-report.mjs --date=2026-09-21 --boxes=box1,box2

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// The 4-box fleet this session built out (state-sharding-fix /
// expansion-brands branches). remoteDir matches every SSH command used
// to deploy/test this fleet throughout that work. Update here (not per
// call-site) if a box is ever replaced.
export const BOXES = [
  { label: 'box1', host: '98.92.140.11', sshUser: 'ubuntu', remoteDir: 'nj-scraper/scrapers/lightsail-crawler' },
  { label: 'box2', host: '3.237.204.55', sshUser: 'ubuntu', remoteDir: 'nj-scraper/scrapers/lightsail-crawler' },
  { label: 'box3', host: '13.220.170.220', sshUser: 'ubuntu', remoteDir: 'nj-scraper/scrapers/lightsail-crawler' },
  { label: 'box4', host: '44.200.57.189', sshUser: 'ubuntu', remoteDir: 'nj-scraper/scrapers/lightsail-crawler' },
];
const DEFAULT_SSH_KEY = path.join(os.homedir(), '.ssh', 'LightsailDefaultKey-us-east-1.pem');

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function todayStampET() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

// One SSH round-trip per box: list that date's run-label directories,
// then cat every box-report.json found. Missing dirs/files (box didn't
// run that brand set that night, or hasn't run yet) come back as an
// empty list, not an error — a fleet report with a gap is still useful.
async function runSsh(box, remoteCommand, sshKey) {
  const { stdout } = await execFileAsync('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=10',
    '-i', sshKey,
    `${box.sshUser}@${box.host}`,
    remoteCommand,
  ]);
  return stdout;
}

export async function fetchBoxReports(box, date, { sshKey = DEFAULT_SSH_KEY, sshFn = runSsh } = {}) {
  const runsDir = `${box.remoteDir}/data/runs/${date}`;
  let runLabels;
  try {
    const listing = await sshFn(box, `ls -1 ${runsDir} 2>/dev/null`, sshKey);
    runLabels = listing.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }

  const reports = [];
  for (const runLabel of runLabels) {
    try {
      const text = await sshFn(box, `cat ${runsDir}/${runLabel}/box-report.json 2>/dev/null`, sshKey);
      if (!text.trim()) continue;
      const report = JSON.parse(text);
      reports.push({ box: box.label, runLabel, report });
    } catch {
      // Unreadable/corrupt report for this run label — skip it, note the
      // gap in the fleet summary rather than crashing the whole rollup.
      reports.push({ box: box.label, runLabel, report: null, fetchError: true });
    }
  }
  return reports;
}

export async function collectFleetReports(boxes, date, opts = {}) {
  const perBox = await Promise.all(boxes.map((box) => fetchBoxReports(box, date, opts)));
  return perBox.flat();
}

function wafPercent(report) {
  const attempted = report.scope.rooftopsAttempted + report.quality.wafBlockedTotal;
  if (attempted <= 0) return null;
  return Number(((report.quality.wafBlockedTotal / attempted) * 100).toFixed(1));
}

function finishTimeET(isoString) {
  if (!isoString) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(isoString)) + ' ET';
}

// Pure aggregation — takes whatever collectFleetReports() (or a test
// fixture) handed it and produces the exact row shape fleet-summary.json
// and the HTML table both read from.
export function buildFleetSummary(date, entries) {
  const rows = entries.map(({ box, runLabel, report, fetchError }) => {
    if (fetchError || !report) {
      return { box, runLabel, missing: true };
    }
    return {
      box,
      runLabel,
      brandSet: report.identity.brandSet,
      rooftops: report.scope.rooftopsAttempted,
      hours: report.schedule.wallClockHours,
      p90SecondsPerRooftop: report.throughput.secondsPerRooftopP90,
      slaOk: report.schedule.slaOk,
      wafPercent: wafPercent(report),
      nhtsaSuccessPercent: report.quality.nhtsaSuccessRate !== null ? Number((report.quality.nhtsaSuccessRate * 100).toFixed(1)) : null,
      finishTimeET: finishTimeET(report.schedule.actualEnd),
      missing: false,
    };
  });

  const breaches = rows.filter((r) => !r.missing && (!r.slaOk || r.hours > 22));
  const warnings = rows.filter((r) => !r.missing && r.slaOk && r.hours >= 20 && r.hours <= 22);
  const missing = rows.filter((r) => r.missing);

  return {
    date,
    generatedAt: new Date().toISOString(),
    rows,
    fleetOk: breaches.length === 0 && missing.length === 0,
    breachCount: breaches.length,
    warningCount: warnings.length,
    missingCount: missing.length,
  };
}

function rowColor(row) {
  if (row.missing) return '#6b7280'; // gray — no report to judge
  if (!row.slaOk || row.hours > 22) return '#b91c1c'; // red
  if (row.hours >= 20) return '#a16207'; // yellow
  return '#15803d'; // green
}

export function renderFleetSummaryHtml(summary) {
  const cell = (v) => (v === null || v === undefined ? '—' : v);
  const rowsHtml = summary.rows.map((row) => {
    const color = rowColor(row);
    if (row.missing) {
      return `<tr style="background:${color}22"><td>${row.box}</td><td>${row.runLabel}</td><td colspan="7" style="color:${color}">no report found — box didn't run or report generation failed</td></tr>`;
    }
    return `<tr style="background:${color}22">
      <td>${row.box}</td>
      <td>${row.runLabel}</td>
      <td>${row.brandSet}</td>
      <td style="font-family:monospace">${cell(row.rooftops)}</td>
      <td style="font-family:monospace;color:${color};font-weight:600">${cell(row.hours)}h</td>
      <td style="font-family:monospace">${cell(row.p90SecondsPerRooftop?.toFixed?.(1) ?? row.p90SecondsPerRooftop)}s</td>
      <td style="color:${color};font-weight:600">${row.slaOk ? 'OK' : 'BREACH'}</td>
      <td style="font-family:monospace">${row.wafPercent !== null ? row.wafPercent + '%' : '—'}</td>
      <td style="font-family:monospace">${row.nhtsaSuccessPercent !== null ? row.nhtsaSuccessPercent + '%' : '—'}</td>
      <td>${cell(row.finishTimeET)}</td>
    </tr>`;
  }).join('\n');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Fleet SLA summary — ${summary.date}</title>
<style>
body{font-family:-apple-system,sans-serif;background:#fafaf8;color:#1a1a1a;padding:24px}
h1{font-size:20px}
table{border-collapse:collapse;width:100%}
th,td{padding:6px 12px;text-align:left;border-bottom:1px solid #e5e5e0}
th{color:#666;font-size:12px;text-transform:uppercase}
.pill{display:inline-block;padding:3px 10px;border-radius:999px;color:white;font-size:12px;font-weight:600;background:${summary.fleetOk ? '#15803d' : '#b91c1c'}}
</style></head><body>
<h1>Fleet SLA summary — ${summary.date}</h1>
<span class="pill">${summary.fleetOk ? 'FLEET OK' : `${summary.breachCount} BREACH / ${summary.missingCount} MISSING`}</span>
<p style="color:#666;font-size:13px">Red = &gt;22h or SLA breach. Yellow = 20&ndash;22h (thin margin). Generated ${summary.generatedAt}.</p>
<table>
<thead><tr><th>Box</th><th>Run</th><th>Brand set</th><th>Rooftops</th><th>Hours</th><th>p90 s/rooftop</th><th>SLA</th><th>WAF%</th><th>NHTSA%</th><th>Finish (ET)</th></tr></thead>
<tbody>
${rowsHtml}
</tbody>
</table>
</body></html>`;
}

async function main() {
  const date = arg('date', todayStampET());
  const boxFilter = arg('boxes');
  const boxes = boxFilter ? BOXES.filter((b) => boxFilter.split(',').includes(b.label)) : BOXES;

  console.log(`[fleet-report] collecting box-report.json for ${date} from: ${boxes.map((b) => b.label).join(', ')}`);
  const entries = await collectFleetReports(boxes, date);
  const summary = buildFleetSummary(date, entries);

  const dir = path.join(ROOT, 'data', 'runs', date);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'fleet-summary.json'), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(dir, 'fleet-summary.html'), renderFleetSummaryHtml(summary));

  console.log(`[fleet-report] wrote ${dir}/fleet-summary.json (${summary.fleetOk ? 'FLEET OK' : `${summary.breachCount} breach, ${summary.missingCount} missing`})`);
  for (const row of summary.rows) {
    if (row.missing) {
      console.log(`  ${row.box}/${row.runLabel}: MISSING`);
    } else {
      console.log(`  ${row.box}/${row.runLabel} (${row.brandSet}): ${row.hours}h, ${row.rooftops} rooftops, SLA ${row.slaOk ? 'OK' : 'BREACH'}`);
    }
  }
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('[fleet-report] fatal:', err.stack || err.message);
    process.exit(1);
  });
}
