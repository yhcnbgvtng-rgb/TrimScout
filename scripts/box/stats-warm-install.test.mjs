// The box2 stats-warm package (docs/box-patches/2026-10-29-stats-cache-warm/): deals_api_server.js has two accepted starting files (before and after the
// sweep-crawl-stamps install), each with its own patch and pinned result. The test runs both patches, with zero fuzz, against the box-text snapshots in the repo.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'docs/box-patches/2026-10-29-stats-cache-warm');
const SNAP = path.join(ROOT, 'docs/box-snapshots/2026-10-29-box2-deals-api');
const md5 = (file) => createHash('md5').update(fs.readFileSync(file)).digest('hex');
const manifest = fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => { const [sum, role, file] = l.trim().split(/\s+/); return { sum, role, file }; });
const want = (role, file) => manifest.find((m) => m.role === role && m.file === file)?.sum;
const hasPatch = spawnSync('patch', ['--version']).status === 0;

const CASES = [
  { name: 'before the crawl stamps install', file: 'deals_api_server.js@before-crawl-stamps', snap: 'deals_api_server.31d527ba.js.txt', patch: 'deals_api_server.js.patch' },
  { name: 'after the crawl stamps install', file: 'deals_api_server.js@after-crawl-stamps', snap: 'deals_api_server.400e943b.js.txt', patch: 'deals_api_server.after-crawl-stamps.js.patch' },
];

describe('manifest, STEPS.md and the files agree', () => {
  it('every PATCH md5 is the patch file in this checkout', () => {
    for (const m of manifest.filter((x) => x.role === 'PATCH')) assert.equal(m.sum, md5(path.join(PKG, m.file)), `${m.file} changed after the manifest was written`);
  });

  it('the snapshots are the BASE files the manifest names', () => {
    for (const c of CASES) assert.equal(md5(path.join(SNAP, c.snap)), want('BASE', c.file), c.snap);
  });

  it('STEPS.md names every md5 in the manifest and tells the installer to pick the patch by the live md5', () => {
    const steps = fs.readFileSync(path.join(PKG, 'STEPS.md'), 'utf8');
    for (const m of manifest) assert.ok(steps.includes(m.sum), `STEPS.md mentions ${m.sum} (${m.role} ${m.file})`);
    for (const must of ['two accepted starting files', 'by the live md5', 'deals_api_server.after-crawl-stamps.js.patch', 'patch -F0', 'Rollback', 'NOTHING IS INSTALLED']) assert.ok(steps.includes(must), `STEPS.md mentions ${must}`);
  });
});

describe('deals_api_server.js patches', { skip: hasPatch ? false : 'no patch(1) on this machine' }, () => {
  for (const c of CASES) {
    it(`${c.name}: ${c.patch} applies with zero fuzz and gives the pinned result, and the file parses`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statswarm-'));
      const f = path.join(dir, 'deals_api_server.js');
      fs.copyFileSync(path.join(SNAP, c.snap), f);
      const p = fs.readFileSync(path.join(PKG, c.patch));
      execFileSync('patch', ['-F0', '--dry-run', '-s', f], { input: p });
      execFileSync('patch', ['-F0', '-s', '--no-backup-if-mismatch', f], { input: p });
      assert.equal(md5(f), want('RESULT', c.file));
      assert.deepEqual(fs.readdirSync(dir), ['deals_api_server.js'], 'no .rej or .orig left');
      const src = fs.readFileSync(f, 'utf8');
      assert.ok(src.includes('import { createStatsCache, warmStatsCache } from "./statsCache.js";'));
      assert.equal(src.split('warmStatsCache').length - 1, 2, 'import + the call');
      execFileSync(process.execPath, ['--check', f]);
    });
  }

  it('both patches add the same warm lines', () => {
    const warm = (c) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statswarm-'));
      const f = path.join(dir, 'deals_api_server.js');
      fs.copyFileSync(path.join(SNAP, c.snap), f);
      execFileSync('patch', ['-F0', '-s', '--no-backup-if-mismatch', f], { input: fs.readFileSync(path.join(PKG, c.patch)) });
      return fs.readFileSync(f, 'utf8').split('\n').filter((l) => /warmStatsCache|STATS_WARM_DELAY_MS/.test(l));
    };
    assert.deepEqual(warm(CASES[0]), warm(CASES[1]));
  });
});
