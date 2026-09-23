import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { fetchBoxDriftReports, collectDriftReports, buildDriftSummary, renderDriftSummaryHtml } from '../scripts/dealer-drift-report.mjs';
import { BOXES } from '../scripts/fleet-report.mjs';

// ---------------------------------------------------------------------
// dealer-drift-report.mjs's job is to pull every box's latest per-state
// dealer-bot-report-*.json over SSH and roll the `driftFlagged` entries
// already written into those reports (by dealer-bot-report.mjs) into one
// table. Like fleet-report.mjs, it must never crash on a box that hasn't
// produced a report yet — these tests inject a fake `sshFn` so the real
// `ssh` binary is never invoked.
// ---------------------------------------------------------------------
describe('dealer-drift-report.mjs (fleet-wide dealer drift rollup)', () => {
  function fakeReport({ state = 'NC', generatedAt = '2026-09-23T03:00:00.000Z', driftFlagged = [] } = {}) {
    return { generatedAt, state, brandFilter: 'ALL_IN_SCOPE', dealerCount: 40, driftFlagged };
  }

  it('fetchBoxDriftReports lists every *-latest.json then cats each one, via the injected sshFn only', async () => {
    const calls = [];
    const sshFn = async (box, command) => {
      calls.push(command);
      if (command.startsWith('ls')) {
        return `${box.remoteDir}/data/reports/dealer-bot-report-nc-latest.json\n${box.remoteDir}/data/reports/dealer-bot-report-va-latest.json\n`;
      }
      if (command.includes('nc-latest')) return JSON.stringify(fakeReport({ state: 'NC' }));
      if (command.includes('va-latest')) return JSON.stringify(fakeReport({ state: 'VA' }));
      throw new Error('unexpected command: ' + command);
    };
    const reports = await fetchBoxDriftReports(BOXES[0], { sshFn });
    assert.equal(reports.length, 2);
    assert.deepEqual(reports.map((r) => r.report.state).sort(), ['NC', 'VA']);
    assert.ok(calls.some((c) => c.startsWith('ls')), 'must list before catting anything');
  });

  it('a box with no report files yet (ls finds nothing) comes back as an empty list, not a throw', async () => {
    const sshFn = async () => '';
    const reports = await fetchBoxDriftReports(BOXES[1], { sshFn });
    assert.deepEqual(reports, []);
  });

  it('an unreadable/corrupt report file is reported as a fetchError row, not a fatal error', async () => {
    const sshFn = async (box, command) => {
      if (command.startsWith('ls')) return `${box.remoteDir}/data/reports/dealer-bot-report-nc-latest.json\n`;
      return 'not valid json {{{';
    };
    const reports = await fetchBoxDriftReports(BOXES[0], { sshFn });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].fetchError, true);
  });

  it('collectDriftReports runs across multiple boxes and flattens the results', async () => {
    const sshFn = async (box, command) => {
      if (command.startsWith('ls')) return `${box.remoteDir}/data/reports/dealer-bot-report-nc-latest.json\n`;
      return JSON.stringify(fakeReport({}));
    };
    const entries = await collectDriftReports(BOXES.slice(0, 2), { sshFn });
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((e) => e.box), ['box1', 'box2']);
  });

  it('buildDriftSummary flattens driftFlagged across every report into one list', () => {
    const entries = [
      {
        box: 'box3',
        file: 'dealer-bot-report-nc-latest.json',
        report: fakeReport({
          state: 'NC',
          driftFlagged: [
            {
              brand: 'Ford',
              dealerName: 'Mark Ficken Ford',
              domain: 'felixsabatesfordlincoln.net',
              state: 'NC',
              domainDrift: { configured: 'felixsabatesfordlincoln.net', resolved: 'fordlincolncharlotte.com' },
              nameDrift: null,
            },
          ],
        }),
      },
      { box: 'box1', file: 'dealer-bot-report-nj-latest.json', report: fakeReport({ state: 'NJ', driftFlagged: [] }) },
    ];
    const summary = buildDriftSummary(entries);
    assert.equal(summary.flaggedCount, 1);
    assert.equal(summary.flagged[0].dealerName, 'Mark Ficken Ford');
    assert.equal(summary.flagged[0].box, 'box3');
    assert.equal(summary.missingReports.length, 0);
  });

  it('a fetchError entry is counted as a missing report, not silently dropped', () => {
    const entries = [
      { box: 'box2', file: 'dealer-bot-report-ny-latest.json', report: null, fetchError: true },
      { box: 'box1', file: 'dealer-bot-report-nj-latest.json', report: fakeReport({ state: 'NJ' }) },
    ];
    const summary = buildDriftSummary(entries);
    assert.equal(summary.missingReports.length, 1);
    assert.equal(summary.missingReports[0].box, 'box2');
    assert.equal(summary.flaggedCount, 0);
  });

  it('renderDriftSummaryHtml renders flagged rows and the pill without throwing', () => {
    const entries = [
      {
        box: 'box3',
        file: 'x',
        report: fakeReport({
          state: 'NC',
          driftFlagged: [
            {
              brand: 'Ford',
              dealerName: 'Mark Ficken Ford',
              domain: 'felixsabatesfordlincoln.net',
              state: 'NC',
              domainDrift: { configured: 'felixsabatesfordlincoln.net', resolved: 'fordlincolncharlotte.com' },
              nameDrift: null,
            },
          ],
        }),
      },
    ];
    const summary = buildDriftSummary(entries);
    const html = renderDriftSummaryHtml(summary);
    assert.match(html, /Mark Ficken Ford/);
    assert.match(html, /fordlincolncharlotte\.com/);
    assert.match(html, /1 FLAGGED/);
  });

  it('renderDriftSummaryHtml renders a clean "none flagged" state', () => {
    const summary = buildDriftSummary([{ box: 'box1', file: 'x', report: fakeReport({ driftFlagged: [] }) }]);
    const html = renderDriftSummaryHtml(summary);
    assert.match(html, /NONE FLAGGED/);
    assert.match(html, /No drift flagged/);
  });
});
