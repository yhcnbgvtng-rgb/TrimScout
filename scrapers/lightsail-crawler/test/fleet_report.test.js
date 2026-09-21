import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { fetchBoxReports, collectFleetReports, buildFleetSummary, renderFleetSummaryHtml, BOXES } from '../scripts/fleet-report.mjs';

// ---------------------------------------------------------------------
// fleet-report.mjs's own job is to pull each box's box-report.json over
// SSH and roll them into one table — it must never touch CRAWL_STATES or
// concurrency on any box (observability only), and it must show a
// "missing" row rather than crash when a box hasn't produced a report
// yet (e.g. hasn't run tonight, or is mid-run). The SSH round-trip
// itself isn't exercised here — these tests inject a fake `sshFn` so the
// real network/`ssh` binary is never invoked, and check the aggregation
// and rendering logic against realistic box-report shapes instead.
// ---------------------------------------------------------------------
describe('fleet-report.mjs (fleet-wide SLA rollup)', () => {
  function fakeReport({ brandSet = 'expansion', rooftops = 3675, hours = 23.8, slaOk = true, p90 = 93.2, waf = 40, nhtsaRate = 0.92, actualEnd = '2026-09-22T02:00:00.000Z' }) {
    return {
      identity: { hostname: 'box3', brandSet, runLabel: brandSet, concurrency: 4, budgetHours: null },
      schedule: { date: '2026-09-21', actualStart: '2026-09-21T02:00:00.000Z', actualEnd, wallClockHours: hours, hitBudget: !slaOk, slaOk },
      scope: { statesAssigned: ['tx'], statesAttempted: ['tx'], statesSkipped: [], rooftopsPlanned: rooftops, rooftopsAttempted: rooftops, rooftopsCompleted: rooftops, rooftopsSkipped: 0 },
      throughput: { secondsPerRooftopMean: p90 * 0.8, secondsPerRooftopP50: p90 * 0.7, secondsPerRooftopP90: p90, sampleCount: 11, vehiclesScraped: rooftops * 25, vehiclesPerHour: 1000 },
      quality: { wafBlockedTotal: waf, wafByClass: { BLOCKED_BY_WAF: waf }, emptyInventoryDealers: 3, nhtsaAttempted: 100, nhtsaSucceeded: Math.round(nhtsaRate * 100), nhtsaSuccessRate: nhtsaRate, lockContentionTimeouts: 0 },
      capacity: { projectedHoursAtStart: 23.5, actualHours: hours, ratio: 1.01, overProjectionBy15Pct: false },
      health: { sampledAtReportTime: true, freeMemGb: 4, totalMemGb: 16, loadAvg1m: 1.2, chromiumCrashCount: 0, chromiumCrashCountNotInstrumented: true, lockCollisions: 0 },
      links: { logsDir: 'logs/', summaryPath: 'data/daily_crawl_runs/summary_2026-09-21.json', shardsTouched: ['tx'] },
    };
  }

  it('BOXES lists all 4 fleet boxes by their real host IPs', () => {
    assert.equal(BOXES.length, 4);
    assert.deepEqual(BOXES.map((b) => b.host), ['98.92.140.11', '3.237.204.55', '13.220.170.220', '44.200.57.189']);
  });

  it('fetchBoxReports lists run-label directories then cats each box-report.json, via the injected sshFn only', async () => {
    const calls = [];
    const sshFn = async (box, command) => {
      calls.push(command);
      if (command.startsWith('ls')) return 'expansion\ncore\n';
      if (command.includes('expansion/box-report.json')) return JSON.stringify(fakeReport({ brandSet: 'expansion' }));
      if (command.includes('core/box-report.json')) return JSON.stringify(fakeReport({ brandSet: 'core', rooftops: 60, hours: 4.0 }));
      throw new Error('unexpected command: ' + command);
    };
    const box = BOXES[2]; // box3
    const reports = await fetchBoxReports(box, '2026-09-21', { sshFn });
    assert.equal(reports.length, 2);
    assert.deepEqual(reports.map((r) => r.runLabel).sort(), ['core', 'expansion']);
    assert.ok(calls.some((c) => c.startsWith('ls')), 'must list the date dir before catting anything');
  });

  it('a box with no run-label directories yet (ls fails) comes back as an empty list, not a throw', async () => {
    const sshFn = async () => { throw new Error('ssh: connect to host timed out'); };
    const reports = await fetchBoxReports(BOXES[0], '2026-09-21', { sshFn });
    assert.deepEqual(reports, []);
  });

  it('a box-report.json that fails to parse is reported as a missing/fetchError row, not a fatal error', async () => {
    const sshFn = async (box, command) => {
      if (command.startsWith('ls')) return 'expansion\n';
      return 'not valid json {{{';
    };
    const reports = await fetchBoxReports(BOXES[0], '2026-09-21', { sshFn });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].fetchError, true);
  });

  it('collectFleetReports runs across multiple boxes and flattens the results', async () => {
    const sshFn = async (box, command) => {
      if (command.startsWith('ls')) return `${box.label}-run\n`;
      return JSON.stringify(fakeReport({}));
    };
    const entries = await collectFleetReports(BOXES.slice(0, 2), '2026-09-21', { sshFn });
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((e) => e.box), ['box1', 'box2']);
  });

  it('buildFleetSummary flags a box over 22h or with slaOk=false as a breach, 20-22h as a warning', () => {
    const entries = [
      { box: 'box1', runLabel: 'core', report: fakeReport({ brandSet: 'core', hours: 16, slaOk: true }) },
      { box: 'box2', runLabel: 'core', report: fakeReport({ brandSet: 'core', hours: 20.5, slaOk: true }) },
      { box: 'box3', runLabel: 'expansion', report: fakeReport({ brandSet: 'expansion', hours: 23.8, slaOk: true }) },
      { box: 'box4', runLabel: 'expansion', report: fakeReport({ brandSet: 'expansion', hours: 26, slaOk: false }) },
    ];
    const summary = buildFleetSummary('2026-09-21', entries);
    assert.equal(summary.rows.length, 4);
    assert.equal(summary.breachCount, 2); // box3 (>22h) and box4 (slaOk:false)
    assert.equal(summary.warningCount, 1); // box2 (20-22h)
    assert.equal(summary.fleetOk, false);
  });

  it('buildFleetSummary computes WAF% from wafBlockedTotal over (attempted + blocked)', () => {
    const entries = [{ box: 'box3', runLabel: 'expansion', report: fakeReport({ rooftops: 900, waf: 100 }) }];
    const summary = buildFleetSummary('2026-09-21', entries);
    // 100 / (900 + 100) = 10.0%
    assert.equal(summary.rows[0].wafPercent, 10);
  });

  it('a missing report (fetchError, or a box that never ran) shows up as a distinct missing row, counted separately from breaches', () => {
    const entries = [
      { box: 'box1', runLabel: 'core', report: fakeReport({ hours: 10, slaOk: true }) },
      { box: 'box2', runLabel: 'core', report: null, fetchError: true },
    ];
    const summary = buildFleetSummary('2026-09-21', entries);
    assert.equal(summary.missingCount, 1);
    assert.equal(summary.breachCount, 0);
    assert.equal(summary.fleetOk, false); // a missing box still fails the fleet check
    assert.equal(summary.rows.find((r) => r.box === 'box2').missing, true);
  });

  it('renderFleetSummaryHtml renders every box row and the fleet-wide pill without throwing', () => {
    const entries = [
      { box: 'box1', runLabel: 'core', report: fakeReport({ brandSet: 'core', hours: 16, slaOk: true }) },
      { box: 'box4', runLabel: 'expansion', report: null, fetchError: true },
    ];
    const summary = buildFleetSummary('2026-09-21', entries);
    const html = renderFleetSummaryHtml(summary);
    assert.match(html, /box1/);
    assert.match(html, /box4/);
    assert.match(html, /no report found/);
    assert.match(html, /MISSING/);
  });
});
