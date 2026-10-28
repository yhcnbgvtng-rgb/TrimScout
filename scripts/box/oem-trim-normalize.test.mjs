// The box2 Chevrolet / GMC / Toyota / Ram trim clean-up (2026-10-27-oem-trim-normalize.mjs): its pure planning / backup parts, and source checks for the
// safety rails (dry run by default, --fleet-idle, sync lock, backup before update, rollback guard). Nothing here touches a database or a box.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planFromGroups, backupLine, parseBackup, applyChanges, MODEL_QUERIES } from './2026-10-27-oem-trim-normalize.mjs';
import { normalizeOemTrimForWrite, oemTrimGroup } from '../../scrapers/lightsail-crawler/src/oemTrim.js';

const SRC = fs.readFileSync(new URL('./2026-10-27-oem-trim-normalize.mjs', import.meta.url), 'utf8');

describe('planFromGroups', () => {
  const groups = [
    { make: 'Chevrolet', model: 'Silverado 1500', trim: 'LT', count: 15803 }, { make: 'Chevrolet', model: 'Silverado 1500', trim: 'LT 2FL', count: 2751 }, { make: 'Chevrolet', model: 'Silverado 1500', trim: null, count: 712 },
    { make: 'Chevrolet', model: 'Silverado 1500', trim: 'Crew Cab Short Box', count: 1393 }, { make: 'Chevrolet', model: 'Silverado EV', trim: 'LT 2FL', count: 12 }, { make: 'Chevrolet', model: 'Tahoe', trim: 'LT Z71', count: 6 },
    { make: 'Toyota', model: 'Tacoma', trim: 'TRD Off Road', count: 3324 }, { make: 'Toyota', model: 'Tacoma', trim: 'TRD Off-Road', count: 2574 }, { make: 'Toyota', model: 'Camry', trim: 'Nightshade', count: 607 },
    { make: 'Ram', model: '1500', trim: 'Big Hornlone Star', count: 3574 }, { make: 'Ram', model: '1500', trim: 'RAM', count: 1599 }, { make: 'Ram', model: '2500', trim: 'Power Wagon Diesel', count: 57 },
  ];
  const plan = planFromGroups(groups, normalizeOemTrimForWrite);
  it('counts rows by status', () => assert.deepEqual(plan.byStatus, { clean: 15803 + 2574, fix: 2751 + 3324 + 607 + 3574 + 57, blank: 712, leftover: 1393 + 1599, skipped: 12, ambiguous: 6 }));
  it('lists only the rewrites, biggest first, with the make, and never a clean / blank / leftover / ambiguous / skipped group', () => {
    assert.deepEqual(plan.changes.map((c) => [c.make, c.model, c.before, c.after, c.count]), [
      ['Ram', '1500', 'Big Hornlone Star', 'Big Horn/Lone Star', 3574], ['Toyota', 'Tacoma', 'TRD Off Road', 'TRD Off-Road', 3324], ['Chevrolet', 'Silverado 1500', 'LT 2FL', 'LT', 2751],
      ['Toyota', 'Camry', 'Nightshade', 'SE Nightshade', 607], ['Ram', '2500', 'Power Wagon Diesel', 'Power Wagon', 57]]);
    assert.equal(plan.rowsToChange, 3574 + 3324 + 2751 + 607 + 57);
  });
  it('a second pass over the already-fixed groups plans nothing (idempotent)', () => {
    const after = groups.map((g) => { const c = plan.changes.find((x) => x.model === g.model && x.before === g.trim); return c ? { ...g, trim: c.after } : g; });
    assert.equal(planFromGroups(after, normalizeOemTrimForWrite).rowsToChange, 0);
  });
});

describe('MODEL_QUERIES', () => {
  it('every profiled model label from the probe falls under one of the (make, model prefix) queries', () => {
    const like = (pattern) => new RegExp(`^${pattern.replace('%', '.*')}$`, 'i');
    for (const [make, model] of [['Chevrolet', 'Silverado 1500'], ['Chevrolet', 'Silverado 2500HD'], ['Chevrolet', 'Tahoe'], ['Chevrolet', 'Equinox'], ['GMC', 'Sierra 3500 HD'], ['GMC', 'Yukon XL'], ['Toyota', 'Tacoma'], ['Toyota', 'RAV4 Plug-in Hybrid'], ['Toyota', 'Highlander Hybrid'], ['Toyota', 'Camry'], ['Ram', '1500 Classic'], ['Ram', '2500']]) {
      assert.ok(oemTrimGroup(make, model), `${make} ${model} is profiled`);
      assert.ok(MODEL_QUERIES.some(([mk, pats]) => mk === make && pats.some((p) => like(p).test(model))), `${make} ${model} is covered by a query`);
    }
  });
});

describe('backup and rollback records', () => {
  it('a backup line carries everything needed to restore the row', () => {
    const line = backupLine({ vin: '1GCPYBEK0NZ000001', dealer_id: 7, make: 'Chevrolet', model: 'Silverado 1500', trim: 'LT 2FL', trim_raw: null }, 'LT');
    assert.deepEqual(JSON.parse(line), { vin: '1GCPYBEK0NZ000001', dealer_id: 7, make: 'Chevrolet', model: 'Silverado 1500', trim_before: 'LT 2FL', trim_raw_before: null, trim_after: 'LT' });
    assert.equal(parseBackup(`${line}\n\n${line}\n`).length, 2);
  });
});

describe('applyChanges', () => {
  const rows = (n, trim = 'a') => Array.from({ length: n }, (_, i) => ({ vin: `V${i}`, dealer_id: i, trim }));
  it('stops at the limit and never changes more rows than asked', async () => {
    const backups = [];
    const r = await applyChanges({ changes: [{ before: 'a', after: 'b' }], limit: 4, txSize: 3, fetchTargets: async () => rows(10), writeBackup: (b) => backups.push(b.length), updateChunk: async (b) => b.length });
    assert.equal(r.updated, 4); assert.deepEqual(backups, [3, 1]);
  });
  it('chunks never exceed txSize (100 by default)', async () => {
    const sizes = [];
    await applyChanges({ changes: [{ before: 'a', after: 'b' }], fetchTargets: async () => rows(250), writeBackup: () => {}, updateChunk: async (b) => { sizes.push(b.length); return b.length; } });
    assert.deepEqual(sizes, [100, 100, 50]);
  });
  it('compares the trim text exactly in JS: case variants the ci index range returns are left alone', async () => {
    const seen = [];
    const targets = [{ vin: 'A', dealer_id: 1, trim: 'ACTIV' }, { vin: 'B', dealer_id: 1, trim: 'Activ' }, { vin: 'C', dealer_id: 1, trim: 'ACTIV ' }];
    await applyChanges({ changes: [{ before: 'ACTIV', after: 'Activ' }], fetchTargets: async () => targets, writeBackup: (b) => seen.push(...b.map((r) => r.vin)), updateChunk: async (b) => b.length });
    assert.deepEqual(seen, ['A']);
  });
  it('writes each chunk\'s backup before that chunk\'s update, and reads each group once', async () => {
    const log = []; let reads = 0;
    await applyChanges({ changes: [{ before: 'a', after: 'b' }], txSize: 2, fetchTargets: async () => { reads++; return rows(4); }, writeBackup: () => log.push('backup'), updateChunk: async (b) => { log.push('update'); return b.length; } });
    assert.deepEqual(log, ['backup', 'update', 'backup', 'update']); assert.equal(reads, 1);
  });
  it('does not spin on a chunk the UPDATE could not move', async () => {
    const r = await applyChanges({ changes: [{ before: 'a', after: 'b' }], fetchTargets: async () => rows(1), writeBackup: () => {}, updateChunk: async () => 0 });
    assert.deepEqual(r, { updated: 0, skipped: 1 });
  });
  it('an error from the update propagates (the run stops, nothing is retried)', async () => {
    let calls = 0;
    await assert.rejects(applyChanges({ changes: [{ before: 'a', after: 'b' }], txSize: 1, fetchTargets: async () => rows(3), writeBackup: () => {}, updateChunk: async () => { calls++; throw new Error('boom'); } }), /boom/);
    assert.equal(calls, 1);
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
  it('writes the backup (fsync) before the UPDATE of the same chunk, and updates by primary key in transactions of <= 100', () => {
    assert.ok(SRC.indexOf('fs.fsyncSync(fd)') > 0);
    assert.match(SRC, /writeBackup\(chunk, c\); \/\/ before-state first, then the UPDATE\n\s+const n = await updateChunk\(chunk, c\)/);
    assert.match(SRC, /FOR UPDATE dealer_inventory SET trim = \?, trim_raw = \? WHERE vin = \? AND dealer_id = \?`/);
    assert.doesNotMatch(SRC.slice(SRC.indexOf('fetchTargets:'), SRC.indexOf('writeBackup:')), /BINARY/, 'no BINARY in the apply read');
    assert.match(SRC, /beginTransaction\(\)[\s\S]*commit\(\)[\s\S]*rollback\(\)/);
    assert.match(SRC, /const TX_SIZE = 100;/);
    assert.match(SRC, /SLOW_STATEMENT_MS/);
  });
  it('rollback only restores rows that still carry the trim this script wrote', () => {
    assert.match(SRC, /WHERE vin = \? AND dealer_id = \? AND trim = \?`, \[r\.trim_before, r\.trim_raw_before, r\.vin, r\.dealer_id, r\.trim_after\]/);
  });
  it('reads are bounded by make + model prefix, grouped by exact text, and capped at 20 s; the dry run uses the reader account', () => {
    assert.match(SRC, /WHERE make = \? AND model LIKE \?\$\{ACTIVE_ONLY \? " AND removed_at IS NULL" : ""\} GROUP BY model, BINARY trim/);
    assert.match(SRC, /WHERE make = \? AND model = \? AND trim = \?\$\{ACTIVE_ONLY/);
    assert.match(SRC, /const STATEMENT_CAP_S = 20/);
    assert.match(SRC, /DB_READER_USER/);
  });
  it('refuses to run against a retired box IP, and never writes without the writer account', () => {
    assert.match(SRC, /pointsAtDeadIp/);
    assert.match(SRC, /APPLY \? \(dbEnv\.DB_WRITER_USER/);
  });
});
