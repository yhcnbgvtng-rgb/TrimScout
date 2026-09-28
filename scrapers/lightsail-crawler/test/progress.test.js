import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { writeProgress, readProgress, progressPath, emptyProgress } from '../src/progress.js';

// ---------------------------------------------------------------------
// Real bug found live 2026-09-27: writeProgress()'s read-modify-write used
// one shared "<path>.tmp" name with no lock around the read, merge, write
// and rename. run-daily-crawl.mjs runs MAX_CONCURRENT_STATES states at
// once, each spawning its own standalone.js process that calls this same
// function against the exact same file (progressPath() never varies by
// state or brand) — two overlapping calls could rename() the same tmp
// path out from under each other. Confirmed live: MI Honda's first shard
// (box4) crashed 2 seconds in with ENOENT renaming run_progress.json.tmp,
// losing that shard's entire dealer list. These tests fire real concurrent
// writeProgress() calls (not a mocked lock) against one shared file and
// assert none of them throw and the file is always valid, fully-written
// JSON — the actual failure mode this bug produced.
// ---------------------------------------------------------------------
describe('writeProgress (concurrent-write race)', () => {
  let tmpDir;
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimscout-progress-race-'));
  });
  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('many concurrent writeProgress() calls against the same file all succeed with no ENOENT', async () => {
    const calls = Array.from({ length: 40 }, (_, i) => writeProgress({
      status: 'running',
      currentBrand: `Brand${i % 5}`,
      dealersDone: i,
      dealersTotal: 40,
    }, tmpDir));

    // Real bug reproduced without the fix: some of these reject with
    // "ENOENT: no such file or directory, open '<path>.tmp'" because two
    // calls' fs.rename() targeted the exact same shared tmp file.
    const results = await Promise.allSettled(calls);
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.deepEqual(rejected.map((r) => r.reason?.message), []);
  });

  it('the file on disk after concurrent writes is always complete, valid JSON — never truncated or interleaved', async () => {
    const raw = await fs.readFile(progressPath(tmpDir), 'utf-8');
    const parsed = JSON.parse(raw); // throws if the concurrent writes ever interleaved partial content
    assert.equal(typeof parsed.dealersDone, 'number');
    assert.equal(parsed.dealersTotal, 40);
  });

  it('no leftover .tmp files survive concurrent writes (every unique per-call tmp name got renamed away)', async () => {
    const dir = path.dirname(progressPath(tmpDir));
    const entries = await fs.readdir(dir);
    const leftoverTmp = entries.filter((name) => name.includes('.tmp'));
    assert.deepEqual(leftoverTmp, []);
  });

  it('concurrent writes never lose an update to a lost-update race — the last one to actually acquire the lock always wins cleanly', async () => {
    const raceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trimscout-progress-race2-'));
    try {
      await writeProgress(emptyProgress({ status: 'running', dealersTotal: 2 }), raceDir);
      // Two updates that each depend on reading the CURRENT state (like the
      // real per-dealer loop's Object.assign-then-write in
      // flushRunProgress()) — without the lock serializing the whole
      // read-modify-write, the second write's read can observe stale data
      // from before the first write, right after they resolve in either
      // order.
      await Promise.all([
        writeProgress({ dealersDone: 1, notes: 'from-a' }, raceDir),
        writeProgress({ dealersDone: 2, notes: 'from-b' }, raceDir),
      ]);
      const final = await readProgress(raceDir);
      // Either final write order is an acceptable outcome (last writer
      // wins is the existing, accepted semantics for this shared status
      // file) — what's not acceptable is a torn/partial record mixing
      // fields from neither real write.
      assert.ok(
        (final.dealersDone === 1 && final.notes === 'from-a') || (final.dealersDone === 2 && final.notes === 'from-b'),
        `expected a clean last-writer-wins result, got ${JSON.stringify(final)}`,
      );
    } finally {
      await fs.rm(raceDir, { recursive: true, force: true });
    }
  });
});
