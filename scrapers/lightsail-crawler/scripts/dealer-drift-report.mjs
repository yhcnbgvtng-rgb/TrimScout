#!/usr/bin/env node
// Fleet-wide dealer domain/name drift report.
//
// dealer-bot-report.mjs already runs every night for every state/brand
// combination (see its own header) and, since the domain/name-drift
// comparison was added there, already writes a `driftFlagged` array into
// each `data/reports/dealer-bot-report-<state>-<brand>-latest.json` on
// whichever box ran that state. This script runs from the operator's
// machine (never from a box, never on a cron — same posture as
// fleet-report.mjs), pulls every box's *-latest.json reports over SSH,
// and rolls the flagged dealers into one table: a dealer whose real site
// has moved, renamed, or drifted from the seed record since it was
// configured. Detect-only, same as everything upstream of it — this is a
// report to read periodically, not a push alert.
//
// Usage:
//   npm run dealer-drift-report
//   node scripts/dealer-drift-report.mjs --boxes=box1,box2

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BOXES } from './fleet-report.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SSH_KEY = path.join(os.homedir(), '.ssh', 'LightsailDefaultKey-us-east-1.pem');

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

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

// One SSH round-trip per box: list every state's `-latest.json` bot-report,
// then cat each one. A box that hasn't run a given state yet (or ever)
// just contributes nothing for it — same "gap is data, not an error"
// posture as fleet-report.mjs.
export async function fetchBoxDriftReports(box, { sshKey = DEFAULT_SSH_KEY, sshFn = runSsh } = {}) {
  const reportsDir = `${box.remoteDir}/data/reports`;
  let filePaths;
  try {
    const listing = await sshFn(box, `ls -1 ${reportsDir}/dealer-bot-report-*-latest.json 2>/dev/null`, sshKey);
    filePaths = listing.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }

  const reports = [];
  for (const filePath of filePaths) {
    try {
      const text = await sshFn(box, `cat ${filePath} 2>/dev/null`, sshKey);
      if (!text.trim()) continue;
      const report = JSON.parse(text);
      reports.push({ box: box.label, file: filePath, report });
    } catch {
      // Unreadable/corrupt report — note the gap rather than crash the rollup.
      reports.push({ box: box.label, file: filePath, report: null, fetchError: true });
    }
  }
  return reports;
}

export async function collectDriftReports(boxes, opts = {}) {
  const perBox = await Promise.all(boxes.map((box) => fetchBoxDriftReports(box, opts)));
  return perBox.flat();
}

// Pure aggregation — takes whatever collectDriftReports() (or a test
// fixture) handed it and produces the exact shape drift-summary.json and
// the HTML table both read from.
export function buildDriftSummary(entries) {
  const flagged = [];
  const missing = [];
  for (const { box, file, report, fetchError } of entries) {
    if (fetchError || !report) {
      missing.push({ box, file });
      continue;
    }
    for (const d of report.driftFlagged || []) {
      flagged.push({
        box,
        state: d.state || report.state,
        brand: d.brand,
        dealerName: d.dealerName,
        domain: d.domain,
        domainDrift: d.domainDrift || null,
        nameDrift: d.nameDrift || null,
        generatedAt: report.generatedAt,
      });
    }
  }
  flagged.sort((a, b) =>
    `${a.state}|${a.brand}|${a.dealerName}`.localeCompare(`${b.state}|${b.brand}|${b.dealerName}`)
  );

  return {
    generatedAt: new Date().toISOString(),
    boxesChecked: [...new Set(entries.map((e) => e.box))],
    reportsChecked: entries.length,
    missingReports: missing,
    flaggedCount: flagged.length,
    flagged,
  };
}

function driftCell(drift, kind) {
  if (!drift) return '—';
  return kind === 'domain'
    ? `${drift.configured} → <strong>${drift.resolved}</strong>`
    : `"${drift.configured}" → <strong>"${drift.observed}"</strong>`;
}

export function renderDriftSummaryHtml(summary) {
  const rowsHtml = summary.flagged.map((r) => `<tr>
      <td>${r.state}</td>
      <td>${r.brand}</td>
      <td>${r.dealerName}</td>
      <td>${r.domain}</td>
      <td>${driftCell(r.domainDrift, 'domain')}</td>
      <td>${driftCell(r.nameDrift, 'name')}</td>
      <td>${r.box}</td>
    </tr>`).join('\n');

  const missingHtml = summary.missingReports.length
    ? `<p style="color:#a16207;font-size:13px">${summary.missingReports.length} report file(s) failed to fetch/parse: ${summary.missingReports.map((m) => `${m.box}:${m.file}`).join(', ')}</p>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Dealer domain/name drift report</title>
<style>
body{font-family:-apple-system,sans-serif;background:#fafaf8;color:#1a1a1a;padding:24px}
h1{font-size:20px}
table{border-collapse:collapse;width:100%}
th,td{padding:6px 12px;text-align:left;border-bottom:1px solid #e5e5e0;vertical-align:top}
th{color:#666;font-size:12px;text-transform:uppercase}
.pill{display:inline-block;padding:3px 10px;border-radius:999px;color:white;font-size:12px;font-weight:600;background:${summary.flaggedCount ? '#a16207' : '#15803d'}}
</style></head><body>
<h1>Dealer domain/name drift report</h1>
<span class="pill">${summary.flaggedCount ? `${summary.flaggedCount} FLAGGED` : 'NONE FLAGGED'}</span>
<p style="color:#666;font-size:13px">Detect only — nothing here is auto-fixed. Checked ${summary.reportsChecked} state/brand report(s) across ${summary.boxesChecked.length} box(es). Generated ${summary.generatedAt}.</p>
${missingHtml}
<table>
<thead><tr><th>State</th><th>Brand</th><th>Dealer (configured name)</th><th>Configured domain</th><th>Domain drift</th><th>Name drift</th><th>Box</th></tr></thead>
<tbody>
${rowsHtml || '<tr><td colspan="7">No drift flagged.</td></tr>'}
</tbody>
</table>
</body></html>`;
}

async function main() {
  const boxFilter = arg('boxes');
  const boxes = boxFilter ? BOXES.filter((b) => boxFilter.split(',').includes(b.label)) : BOXES;

  console.log(`[dealer-drift-report] collecting dealer-bot-report-*-latest.json from: ${boxes.map((b) => b.label).join(', ')}`);
  const entries = await collectDriftReports(boxes);
  const summary = buildDriftSummary(entries);

  const dir = path.join(ROOT, 'data', 'reports');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'drift-summary.json'), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(dir, 'drift-summary.html'), renderDriftSummaryHtml(summary));

  console.log(`[dealer-drift-report] wrote ${dir}/drift-summary.{json,html} (${summary.flaggedCount} flagged, ${summary.missingReports.length} missing reports, ${summary.reportsChecked} reports checked)`);
  for (const r of summary.flagged) {
    console.log(`  ${r.state} ${r.brand} — ${r.dealerName}${r.domainDrift ? ` | domain: ${r.domainDrift.configured} -> ${r.domainDrift.resolved}` : ''}${r.nameDrift ? ` | name: "${r.nameDrift.configured}" -> "${r.nameDrift.observed}"` : ''}`);
  }
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('[dealer-drift-report] fatal:', err.stack || err.message);
    process.exit(1);
  });
}
