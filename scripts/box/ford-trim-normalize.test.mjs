// The box2 Ford trim clean-up (2026-10-27-ford-trim-normalize.mjs): its pure planning/backup parts, and source checks for the safety rails
// (dry run by default, --fleet-idle, sync lock, backup before update, rollback guard). Nothing here touches a database or a box.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planFromGroups, backupLine, parseBackup } from './2026-10-27-ford-trim-normalize.mjs';
import { normalizeFordTrimForWrite } from '../../scrapers/lightsail-crawler/src/fordTrim.js';

const SRC = fs.readFileSync(new URL('./2026-10-27-ford-trim-normalize.mjs', import.meta.url), 'utf8');

describe('planFromGroups', () => {
  const groups = [
    { model: 'F-150', trim: 'XLT', count: 34290 }, { model: 'F-150', trim: '4X4 CREWCAB XLT', count: 360 }, { model: 'F-150', trim: null, count: 3378 },
    { model: 'F-250', trim: 'F 250 Lariat', count: 509 }, { model: 'F-250', trim: 'Preferred', count: 282 }, { model: 'F-150', trim: 'XLT Lariat', count: 1 },
    { model: 'Explorer', trim: 'ST Line', count: 3760 }, { model: 'Explorer', trim: 'ST-Line', count: 4124 }, { model: 'Bronco Sport', trim: 'Big Bend 4x4', count: 50 },
    { model: 'Escape', trim: 'S', count: 347 }, { model: 'Bronco', trim: 'Base 4 Door 4x4', count: 8 },
  ];
  const plan = planFromGroups(groups, normalizeFordTrimForWrite);
  it('counts rows by status', () => assert.deepEqual(plan.byStatus, { clean: 34290 + 4124 + 347, fix: 360 + 509 + 3760, blank: 3378, leftover: 282 + 8, ambiguous: 1, skipped: 50 }));
  it('lists only the rewrites, biggest first, and never a clean / blank / leftover / ambiguous / skipped group', () => {
    assert.deepEqual(plan.changes.map((c) => [c.model, c.before, c.after, c.count]), [['Explorer', 'ST Line', 'ST-Line', 3760], ['F-250', 'F 250 Lariat', 'Lariat', 509], ['F-150', '4X4 CREWCAB XLT', 'XLT', 360]]);
    assert.equal(plan.rowsToChange, 3760 + 509 + 360);
  });
  it('a second pass over the already-fixed groups plans nothing (idempotent)', () => {
    const after = groups.map((g) => { const c = plan.changes.find((x) => x.model === g.model && x.before === g.trim); return c ? { ...g, trim: c.after } : g; });
    assert.equal(planFromGroups(after, normalizeFordTrimForWrite).rowsToChange, 0);
  });
});

describe('backup and rollback records', () => {
  it('a backup line carries everything needed to restore the row', () => {
    const line = backupLine({ vin: '1FTFW1E50NFA00001', dealer_id: 7, model: 'F-150', trim: '4X4 CREWCAB XLT', trim_raw: null }, 'XLT');
    assert.deepEqual(JSON.parse(line), { vin: '1FTFW1E50NFA00001', dealer_id: 7, model: 'F-150', trim_before: '4X4 CREWCAB XLT', trim_raw_before: null, trim_after: 'XLT' });
    assert.equal(parseBackup(`${line}\n\n${line}\n`).length, 2);
  });
});

describe('safety rails (source checks)', () => {
  it('is a dry run unless --apply, and --apply needs --fleet-idle', () => {
    assert.match(SRC, /const APPLY = flag\("apply"\)/);
    assert.match(SRC, /if \(APPLY && !FLEET_IDLE\) \{[^}]*Refusing to --apply without --fleet-idle/);
    assert.match(SRC, /if \(!APPLY\) \{ console\.log\("DRY RUN - nothing was changed\."\)/);
  });
  it('takes the sync lock for any write, exits 4 when it is held, and releases it in finally', () => {
    assert.match(SRC, /sync-lock\/\$\{action\}/);
    assert.match(SRC, /process\.exit\(4\)/);
    assert.match(SRC, /finally \{ await release\(\)/);
    assert.equal((SRC.match(/await withLock\(/g) || []).length, 2, 'both the rewrite and the rollback go through the lock');
  });
  it('writes the backup (fsync) before the UPDATE of the same batch, and guards the UPDATE on the trim it read', () => {
    assert.ok(SRC.indexOf('fs.fsyncSync(fd)') > 0 && SRC.indexOf('fs.fsyncSync(fd)') < SRC.indexOf('FOR UPDATE dealer_inventory SET trim = ?, trim_raw = ? WHERE trim = ?'));
    assert.match(SRC, /WHERE trim = \? AND \(\$\{batch\.map\(\(\) => "\(vin = \? AND dealer_id = \?\)"\)/);
  });
  it('rollback only restores rows that still carry the trim this script wrote', () => {
    assert.match(SRC, /WHERE vin = \? AND dealer_id = \? AND trim = \?`, \[r\.trim_before, r\.trim_raw_before, r\.vin, r\.dealer_id, r\.trim_after\]/);
  });
  it('reads are index-bounded on make (and model, trim) and capped at 20 s; any error stops the run', () => {
    assert.match(SRC, /WHERE make = 'Ford'\$\{ACTIVE_ONLY \? " AND removed_at IS NULL" : ""\} GROUP BY model, trim/);
    assert.match(SRC, /WHERE make = 'Ford' AND model = \? AND trim = \?/);
    assert.match(SRC, /SET STATEMENT max_statement_time=\$\{STATEMENT_CAP_S\} FOR/);
    assert.match(SRC, /no retry/);
  });
  it('has no VIN tie-break and refuses a retired box IP', () => {
    assert.doesNotMatch(SRC, /SUBSTRING\(vin|vinWmi|tie-break\)\s*\{/);
    assert.match(SRC, /pointsAtDeadIp/);
  });
});
