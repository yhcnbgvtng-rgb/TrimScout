// The box2 "Reachable by quote request" tile package (docs/box-patches/2026-10-30-reachable-tile/): deals_api_server.js has two accepted starting files (before and after
// the sweep-crawl-stamps install). Each patch is run with zero fuzz against the box-text snapshots in the repo, must give the pinned result, must parse, and must stack with
// the stats-cache-warm patch. The new module is pinned by md5 so the box gets exactly the file the web app and the tests run.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'docs/box-patches/2026-10-30-reachable-tile');
const WARM = path.join(ROOT, 'docs/box-patches/2026-10-29-stats-cache-warm');
const SNAP = path.join(ROOT, 'docs/box-snapshots/2026-10-29-box2-deals-api');
const MODULE = path.join(ROOT, 'scrapers/lightsail-crawler/src/quoteReachable.js');
const md5 = (file) => createHash('md5').update(fs.readFileSync(file)).digest('hex');
const manifest = fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => { const [sum, role, file] = l.trim().split(/\s+/); return { sum, role, file }; });
const want = (role, file) => manifest.find((m) => m.role === role && m.file === file)?.sum;
const hasPatch = spawnSync('patch', ['--version']).status === 0;

const CASES = [
  { name: 'before the crawl stamps install', file: 'deals_api_server.js@before-crawl-stamps', snap: 'deals_api_server.31d527ba.js.txt', patch: 'deals_api_server.js.patch', warm: 'deals_api_server.js.patch' },
  { name: 'after the crawl stamps install', file: 'deals_api_server.js@after-crawl-stamps', snap: 'deals_api_server.400e943b.js.txt', patch: 'deals_api_server.after-crawl-stamps.js.patch', warm: 'deals_api_server.after-crawl-stamps.js.patch' },
];

describe('manifest, STEPS.md and the files agree', () => {
  it('every PATCH md5 is the patch file in this checkout, and the FILE md5 is the real module', () => {
    for (const m of manifest.filter((x) => x.role === 'PATCH')) assert.equal(m.sum, md5(path.join(PKG, m.file)), `${m.file} changed after the manifest was written`);
    assert.equal(want('FILE', 'quoteReachable.js'), md5(MODULE), 'quoteReachable.js changed since the manifest was written');
  });

  it('the snapshots are the BASE files the manifest names', () => {
    for (const c of CASES) assert.equal(md5(path.join(SNAP, c.snap)), want('BASE', c.file), c.snap);
  });

  it('STEPS.md carries exactly the manifest as its md5 table and has what an install needs', () => {
    const steps = fs.readFileSync(path.join(PKG, 'STEPS.md'), 'utf8');
    const block = /<!-- MD5S:START -->\n```\n([\s\S]*?)\n```\n<!-- MD5S:END -->/.exec(steps);
    assert.ok(block, 'md5 block present');
    assert.equal(block[1], fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').trimEnd());
    for (const must of ['NOTHING IS INSTALLED', 'typed GO', 'by the live md5', 'patch -F0', 'Rollback', 'quoteReachable.js', 'pm2 restart deals-api', 'Not measured on box2']) assert.ok(steps.includes(must), `STEPS.md mentions ${must}`);
  });
});

describe('deals_api_server.js patches', { skip: hasPatch ? false : 'no patch(1) on this machine' }, () => {
  for (const c of CASES) {
    it(`${c.name}: ${c.patch} applies with zero fuzz, gives the pinned result, and the file parses`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reachtile-'));
      const f = path.join(dir, 'deals_api_server.js');
      fs.copyFileSync(path.join(SNAP, c.snap), f);
      const p = fs.readFileSync(path.join(PKG, c.patch));
      execFileSync('patch', ['-F0', '--dry-run', '-s', f], { input: p });
      execFileSync('patch', ['-F0', '-s', '--no-backup-if-mismatch', f], { input: p });
      assert.equal(md5(f), want('RESULT', c.file));
      assert.equal(fs.existsSync(`${f}.rej`), false);
      const asModule = path.join(dir, 'check.mjs');
      fs.copyFileSync(f, asModule);
      execFileSync(process.execPath, ['--check', asModule]);
    });

    it(`${c.name}: stacks with the stats-cache-warm patch in either order`, () => {
      const warm = fs.readFileSync(path.join(WARM, c.warm));
      const mine = fs.readFileSync(path.join(PKG, c.patch));
      const results = [];
      for (const order of [[warm, mine], [mine, warm]]) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reachtile-stack-'));
        const f = path.join(dir, 'deals_api_server.js');
        fs.copyFileSync(path.join(SNAP, c.snap), f);
        for (const p of order) execFileSync('patch', ['-F0', '-s', '--no-backup-if-mismatch', f], { input: p });
        results.push(md5(f));
      }
      assert.equal(results[0], results[1], 'same file whichever is installed first');
    });
  }
});

describe('the module the box gets', () => {
  it('answers the audit cases', async () => {
    const m = await import(MODULE);
    assert.equal(m.reachabilityBucket({ contactEmail: 'accessibility@hmausa.com' }), 'none');
    assert.equal(m.reachabilityBucket({ contactEmail: 'jdoe@gmail.com' }), 'unverified');
    assert.equal(m.reachabilityBucket({ contactEmail: 'jdoe@lafontaine.com', dealerName: 'LaFontaine Chrysler Dodge Jeep Ram of Walled Lake', website: 'lafontainecdjrwalledlake.com' }), 'reachable');
  });
});
