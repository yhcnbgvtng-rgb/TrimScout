// The box2 dealer-analytics-api package (docs/box-patches/2026-10-30-dealer-analytics-api/): deals_api_server.js is patched with zero fuzz against the box-text
// snapshot in the repo, dealerAnalyticsApi.js is copied as-is. Nothing here touches a box.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'docs/box-patches/2026-10-30-dealer-analytics-api');
const SNAP = path.join(ROOT, 'docs/box-snapshots/2026-10-30-box2-deals-api/deals_api_server.bd11ff77.js.txt');
const NEW_FILE = path.join(ROOT, 'scrapers/lightsail-crawler/src/dealerAnalyticsApi.js');
const md5 = (file) => createHash('md5').update(fs.readFileSync(file)).digest('hex');
const manifest = fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => { const [sum, role, file] = l.trim().split(/\s+/); return { sum, role, file }; });
const want = (role) => manifest.find((m) => m.role === role)?.sum;
const hasPatch = spawnSync('patch', ['--version']).status === 0;

describe('manifest, STEPS.md and the files agree', () => {
  it('the patch and the new file are the ones the manifest names', () => {
    assert.equal(md5(path.join(PKG, 'deals_api_server.js.patch')), want('PATCH'));
    assert.equal(md5(NEW_FILE), want('NEW'));
  });
  it('the snapshot is the live BASE text', () => {
    assert.equal(md5(SNAP), want('BASE'));
    assert.equal(want('BASE'), 'bd11ff778117cd932c2608e1585634d4');
  });
  it('STEPS.md names every md5, checks the import after patching, uses zero fuzz, and has a rollback', () => {
    const steps = fs.readFileSync(path.join(PKG, 'STEPS.md'), 'utf8');
    for (const m of manifest) assert.ok(steps.includes(m.sum), `STEPS.md mentions ${m.sum} (${m.role})`);
    for (const must of ['NOTHING IS INSTALLED', 'patch -F0', 'Rollback', 'does NOT catch a missing import', 'sudo -u ubuntu pm2 restart deals-api', 'dealerAnalyticsCached', 'default-denied']) assert.ok(steps.includes(must), `STEPS.md mentions ${must}`);
  });
  it('the live text already defines every identifier the new lines use', () => {
    const live = fs.readFileSync(SNAP, 'utf8');
    for (const id of ['createStableCache', 'runBackground', 'waitMs', 'withPoolTimeout', 'getPool', 'sendJson', 'const run = (fn, ...args)']) assert.ok(live.includes(id), id);
    assert.equal((live.match(/^\/\/ GET \/api\/inventory\/by-dealer — in-stock counts per store, for the dealer sheet\.$/gm) || []).length, 1, 'the cache block anchor is unique');
  });
});

describe('deals_api_server.js patch', { skip: hasPatch ? false : 'no patch(1) on this machine' }, () => {
  it('applies with zero fuzz to the live text, gives the pinned result, and the file parses', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dealeranalytics-'));
    const f = path.join(dir, 'deals_api_server.js');
    fs.copyFileSync(SNAP, f);
    fs.copyFileSync(NEW_FILE, path.join(dir, 'dealerAnalyticsApi.js'));
    const p = fs.readFileSync(path.join(PKG, 'deals_api_server.js.patch'));
    execFileSync('patch', ['-F0', '--dry-run', '-s', f], { input: p });
    execFileSync('patch', ['-F0', '-s', '--no-backup-if-mismatch', f], { input: p });
    assert.equal(md5(f), want('RESULT'));
    assert.deepEqual(fs.readdirSync(dir).sort(), ['dealerAnalyticsApi.js', 'deals_api_server.js'], 'no .rej or .orig left');
    const src = fs.readFileSync(f, 'utf8');
    assert.equal((src.match(/from "\.\/dealerAnalyticsApi\.js"/g) || []).length, 1);
    assert.equal((src.match(/matchDealerAnalyticsRoute/g) || []).length, 2, 'import + the route');
    assert.equal((src.match(/dealerAnalyticsCached/g) || []).length, 2, 'declaration + use');
    assert.ok(src.indexOf('matchDealerAnalyticsRoute(req.method') < src.indexOf('pathname === "/api/inventory/by-dealer"'));
    assert.ok(!/invCached\(["']da:/.test(src));
    execFileSync(process.execPath, ['--check', f]);
    execFileSync(process.execPath, ['--check', path.join(dir, 'dealerAnalyticsApi.js')]);
  });

  it('the repo mirror stays untouched: the sweep-guards package pins its md5, the wiring ships only in this box patch', () => {
    const mirror = fs.readFileSync(path.join(ROOT, 'scrapers/lightsail-crawler/src/deals_api_server.js'), 'utf8');
    assert.ok(!/dealerAnalytics|DealerAnalytics/.test(mirror));
    const patch = fs.readFileSync(path.join(PKG, 'deals_api_server.js.patch'), 'utf8');
    assert.equal((patch.match(/^\+(?!\+\+)/gm) || []).length >= 20, true);
  });
});
