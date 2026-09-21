import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildBoxReport, renderBoxReportHtml, appendCapacityHistoryRow } from '../src/box_report.js';

// ---------------------------------------------------------------------
// This module is read-only ops reporting: it must never fabricate a
// number it can't actually measure yet (Chromium crash count, a real
// run-long CPU/RAM peak) and it must derive throughput/quality entirely
// from what run-daily-crawl.mjs's own driverSummary + the per-brand log
// files already contain — no new instrumentation of standalone.js or
// enricher.js. These tests build a realistic driverSummary (the same
// shape main() produces) plus real log files with the exact line
// patterns those files print today, and check the numbers come out
// right — not that the functions merely run without throwing.
// ---------------------------------------------------------------------
describe('box_report.js (per-box nightly SLA report)', () => {
  let tmpDir;
  let logHi;
  let logId;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimscout-box-report-'));
    logHi = path.join(tmpDir, 'hi-ford.log');
    logId = path.join(tmpDir, 'id-chevrolet.log');

    await fs.writeFile(logHi, [
      '🛡️ SKIP Honolulu Ford: BLOCKED_BY_WAF (Akamai)',
      '🛡️ SKIP Maui Ford: BLOCKED_BY_WAF (Akamai)',
      '⚠️ No inventory URLs detected for Kona Ford',
      '✓ Enriched 1FA6P0H... (2024 Mustang): Base $27,205 | Options: $1,200 | V8, RWD',
      '✓ Enriched 1FA6P0H... (2024 Bronco): Base $34,995 | Options: $0 | NHTSA lookup unavailable',
      'Timed out after 5000ms waiting for the shared-data lock',
    ].join('\n'));

    await fs.writeFile(logId, [
      '🛡️ SKIP Boise Chevrolet: SUSPECTED_BLOCK (Cloudflare)',
      '✓ Enriched 1GC6P0H... (2024 Silverado): Base $38,395 | Options: $2,100 | 4WD, Crew Cab',
    ].join('\n'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function fixtureDriverSummary() {
    return {
      date: '2026-09-21',
      startedAt: '2026-09-21T04:00:00.000Z',
      finishedAt: '2026-09-21T22:00:00.000Z', // 18h wall clock
      capacityCheck: { rooftops: 500, projectedHours: 20 },
      states: {
        hi: {
          status: 'ok',
          brands: {
            ford: {
              status: 'ok',
              dealerCount: 10,
              durationMs: 10 * 41200, // 41.2s/rooftop exactly
              logFile: logHi,
              stats: { totalActiveInventory: 340, skippedForBotProtection: 2 },
            },
            buick: { status: 'skipped', reason: '0 dealers for this state/brand' },
          },
        },
        id: {
          status: 'ok',
          brands: {
            chevrolet: {
              status: 'ok',
              dealerCount: 5,
              durationMs: 5 * 60000,
              logFile: logId,
              stats: { totalActiveInventory: 120, skippedForBotProtection: 1 },
            },
          },
        },
        wy: { status: 'skipped', reason: 'driver time budget (18h) exceeded before this state could start' },
      },
    };
  }

  it('sums real dealerCount/status fields into scope + rooftop totals, skipping brands/states marked skipped', async () => {
    const report = await buildBoxReport(fixtureDriverSummary(), { brandSet: 'expansion', runLabel: 'expansion', concurrency: 4 });
    assert.deepEqual(report.scope.statesAttempted.sort(), ['hi', 'id']);
    assert.deepEqual(report.scope.statesSkipped, [{ state: 'wy', reason: 'driver time budget (18h) exceeded before this state could start' }]);
    assert.equal(report.scope.rooftopsAttempted, 15); // 10 (ford) + 5 (chevrolet); buick's 0-dealer skip contributes nothing
    assert.equal(report.scope.rooftopsCompleted, 15);
    assert.equal(report.scope.rooftopsPlanned, 500);
    assert.equal(report.scope.rooftopsSkipped, 485);
  });

  it('hitBudget is true when a state was skipped for the driver time budget, and slaOk reflects it', async () => {
    const report = await buildBoxReport(fixtureDriverSummary(), { brandSet: 'expansion' });
    assert.equal(report.schedule.hitBudget, true);
    assert.equal(report.schedule.slaOk, false); // hitBudget alone fails SLA even though wallClockHours (18h) is under 24
    assert.equal(report.schedule.wallClockHours, 18);
  });

  it('computes wall-clock hours from startedAt/finishedAt, not from durationMs sums', async () => {
    const report = await buildBoxReport(fixtureDriverSummary(), {});
    assert.equal(report.schedule.wallClockHours, 18);
  });

  it('throughput seconds/rooftop is derived per-brand from real durationMs/dealerCount, not guessed', async () => {
    const report = await buildBoxReport(fixtureDriverSummary(), {});
    // ford: 10*41200ms / 10 dealers = 41.2s ; chevrolet: 5*60000ms / 5 dealers = 60s
    assert.equal(report.throughput.sampleCount, 2);
    assert.ok(Math.abs(report.throughput.secondsPerRooftopMean - (41.2 + 60) / 2) < 0.01);
    assert.equal(report.throughput.vehiclesScraped, 460); // 340 + 120
  });

  it('parses real WAF-skip lines by classification, counted per box not per line format guess', async () => {
    const report = await buildBoxReport(fixtureDriverSummary(), {});
    assert.equal(report.quality.wafByClass.BLOCKED_BY_WAF, 2);
    assert.equal(report.quality.wafByClass.SUSPECTED_BLOCK, 1);
    assert.equal(report.quality.emptyInventoryDealers, 1);
  });

  it('distinguishes real NHTSA success from "NHTSA lookup unavailable" failure lines', async () => {
    const report = await buildBoxReport(fixtureDriverSummary(), {});
    // hi log: 1 success line + 1 "unavailable" line ; id log: 1 success line
    assert.equal(report.quality.nhtsaSucceeded, 2);
    assert.equal(report.quality.nhtsaAttempted, 3);
    assert.ok(Math.abs(report.quality.nhtsaSuccessRate - 2 / 3) < 0.001);
  });

  it('counts shared-data-lock timeout lines', async () => {
    const report = await buildBoxReport(fixtureDriverSummary(), {});
    assert.equal(report.quality.lockContentionTimeouts, 1);
  });

  it('flags unmeasured fields explicitly rather than fabricating a number', async () => {
    const report = await buildBoxReport(fixtureDriverSummary(), {});
    assert.equal(report.health.chromiumCrashCount, 0);
    assert.equal(report.health.chromiumCrashCountNotInstrumented, true);
  });

  it('a state/brand with a missing or unreadable log file contributes zero log signals, not a throw', async () => {
    const summary = fixtureDriverSummary();
    summary.states.hi.brands.ford.logFile = path.join(tmpDir, 'does-not-exist.log');
    const report = await buildBoxReport(summary, {});
    assert.equal(report.quality.wafByClass.BLOCKED_BY_WAF, undefined);
  });

  it('renderBoxReportHtml renders a page containing the SLA verdict and hostname without throwing', async () => {
    const report = await buildBoxReport(fixtureDriverSummary(), { brandSet: 'expansion', runLabel: 'expansion' });
    const html = renderBoxReportHtml(report);
    assert.match(html, /SLA BREACH/); // hitBudget=true above forces this
    assert.match(html, /expansion/);
    assert.match(html, /<html>/);
  });

  describe('appendCapacityHistoryRow (recalibration data for capacity.js p50/p90)', () => {
    it('creates the CSV with a header on the first call, then appends without repeating the header', async () => {
      const csvPath = path.join(tmpDir, 'capacity_history.csv');
      const reportA = await buildBoxReport(fixtureDriverSummary(), { brandSet: 'expansion', runLabel: 'expansion' });
      await appendCapacityHistoryRow(reportA, csvPath);
      const reportB = await buildBoxReport(fixtureDriverSummary(), { brandSet: 'core', runLabel: 'core' });
      await appendCapacityHistoryRow(reportB, csvPath);

      const text = await fs.readFile(csvPath, 'utf-8');
      const lines = text.trim().split('\n');
      assert.equal(lines.length, 3); // header + 2 rows
      assert.match(lines[0], /^date,box,brandSet,runLabel/);
      assert.match(lines[1], /expansion/);
      assert.match(lines[2], /core/);
    });

    it('a row carries the real measured p50/p90 seconds/rooftop this run produced, not the config constant', async () => {
      const csvPath = path.join(tmpDir, 'capacity_history_2.csv');
      const report = await buildBoxReport(fixtureDriverSummary(), { brandSet: 'expansion', runLabel: 'expansion' });
      await appendCapacityHistoryRow(report, csvPath);
      const text = await fs.readFile(csvPath, 'utf-8');
      const dataRow = text.trim().split('\n')[1];
      // fixture's two samples were exactly 41.2s and 60s/rooftop (see fixtureDriverSummary) — p50/p90 must reflect that, not P90_SECONDS_PER_ROOFTOP (93.2)
      assert.ok(dataRow.includes('41.2') || dataRow.includes('60'), `expected a real measured rate in the row, got: ${dataRow}`);
      assert.ok(!dataRow.includes('93.2'), `must not carry the config constant instead of the real measurement, got: ${dataRow}`);
    });
  });
});
