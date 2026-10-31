// The box2 "Reachable by quote request" tile package (docs/box-patches/2026-10-30-reachable-tile/), re-cut against box2's live deals_api_server.js (md5 bd11ff77, after the
// buyer-contact-reveal install): the patch with zero fuzz against the committed live snapshot, the pinned result, and install.sh check|apply|restart|restore run end to end
// against a temp copy of the box. Nothing here touches a box.
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
const SNAP = path.join(ROOT, 'docs/box-snapshots/2026-10-30-box2-deals-api/deals_api_server.bd11ff77.js.txt');
const MODULE = path.join(ROOT, 'scrapers/lightsail-crawler/src/quoteReachable.js');
const md5 = (file) => createHash('md5').update(fs.readFileSync(file)).digest('hex');
const rows = fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => { const [sum, role, file] = l.trim().split(/\s+/); return { sum, role, file }; });
const want = (role, file) => rows.find((m) => m.role === role && m.file === file)?.sum;
const hasPatch = spawnSync('patch', ['--version']).status === 0 || spawnSync('patch', ['-v']).status === 0;
// The live-file snapshot is NOT committed (.gitignore): save box2's /opt/trimscout-deals/src/deals_api_server.js (md5 bd11ff77) at SNAP to run the patch tests.
const hasSnap = fs.existsSync(SNAP);
const SKIP = !hasPatch ? 'no patch(1) on this machine' : !hasSnap ? `snapshot not present locally (${path.relative(ROOT, SNAP)}; it is gitignored): scp it from box2 to run the patch and install.sh tests. install.sh check still pins the md5 and dry-runs the patch with zero fuzz on the box.` : false;
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sh = (args, env = {}) => spawnSync('bash', [path.join(PKG, 'install.sh'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

/** A temp "box": the live server text in a src dir, a clean sync-lock log, and the knobs install.sh reads. */
function fakeBox({ lock = '[sync-lock] 2026-10-30T21:32:53.644Z release by make-allowlist-1\n', proc = 'no-such-process-xyz' } = {}) {
  const root = tmp('reachtile-box-');
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  fs.copyFileSync(SNAP, path.join(src, 'deals_api_server.js'));
  const log = path.join(root, 'deals-api-out.log');
  fs.writeFileSync(log, lock);
  return { root, src, env: { DEALS_DIR: src, BACKUP: path.join(root, 'backup'), LOCK_LOG: log, PROC_RE: proc, SUDO: '' } };
}

describe('manifest, STEPS.md and the files agree', () => {
  it('every PACKAGE md5 is the file in this checkout, and the shipped module is the repo source', () => {
    for (const m of rows.filter((x) => x.role === 'PACKAGE')) assert.equal(m.sum, md5(path.join(PKG, m.file)), `${m.file} changed after the manifest was written`);
    assert.equal(want('PACKAGE', 'files/quoteReachable.js'), md5(MODULE), 'files/quoteReachable.js must be the repo source');
  });

  it('the local snapshot is the BASE the manifest pins', { skip: hasSnap ? false : 'snapshot not present locally (gitignored)' }, () => {
    assert.equal(md5(SNAP), want('BASE', 'deals_api_server.js@live-2026-10-30'));
  });

  it('install.sh pins every md5 in the manifest', () => {
    const script = fs.readFileSync(path.join(PKG, 'install.sh'), 'utf8');
    for (const m of rows.filter((x) => x.sum !== '-' && x.file !== 'files/quoteReachable.js' || x.file === 'files/quoteReachable.js')) assert.ok(script.includes(m.sum), `install.sh pins ${m.sum} (${m.role} ${m.file})`);
  });

  it('STEPS.md carries exactly the manifest as its md5 table and has what an install needs', () => {
    const steps = fs.readFileSync(path.join(PKG, 'STEPS.md'), 'utf8');
    const block = /<!-- MD5S:START -->\n```\n([\s\S]*?)\n```\n<!-- MD5S:END -->/.exec(steps);
    assert.ok(block, 'md5 block present');
    assert.equal(block[1], fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').trimEnd());
    for (const must of ['NOTHING IS INSTALLED', 'typed GO', 'bd11ff77', 'install.sh check', 'install.sh apply', 'install.sh restart', 'install.sh restore', 'sudo -u ubuntu pm2 restart deals-api', '**backup first**', 'zero fuzz', 'Rollback', '[sync-lock]', 'Not measured on box2']) assert.ok(steps.includes(must), `STEPS.md mentions ${must}`);
  });
});

describe('deals_api_server.js patch and install.sh', { skip: SKIP }, () => {
  it('applies with zero fuzz to the live snapshot, gives the pinned result, parses, and wires the import once', () => {
    const dir = tmp('reachtile-patch-');
    const f = path.join(dir, 'deals_api_server.js');
    fs.copyFileSync(SNAP, f);
    const p = fs.readFileSync(path.join(PKG, 'deals_api_server.js.patch'));
    execFileSync('patch', ['-F0', '--dry-run', '-s', f], { input: p });
    execFileSync('patch', ['-F0', '-s', '--no-backup-if-mismatch', f], { input: p });
    assert.equal(md5(f), want('RESULT', 'deals_api_server.js@live-2026-10-30'));
    assert.equal(fs.existsSync(`${f}.rej`), false);
    const asModule = path.join(dir, 'check.mjs');
    fs.copyFileSync(f, asModule);
    execFileSync(process.execPath, ['--check', asModule]);
    const text = fs.readFileSync(f, 'utf8');
    assert.equal(text.split('import { reachabilityBucket, stampGroupDomains } from "./quoteReachable.js"').length - 1, 1);
    assert.ok(text.includes('dealersReachable: emails.reachable'));
    assert.ok(!text.includes("COUNT(DISTINCT CASE WHEN d.contact_email IS NOT NULL"), 'the any-text-in-the-field count is gone');
  });

  it('check passes on the live text and changes nothing', () => {
    const b = fakeBox();
    const before = md5(path.join(b.src, 'deals_api_server.js'));
    const r = sh(['check'], b.env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /DRIFT CHECK PASS/);
    assert.equal(md5(path.join(b.src, 'deals_api_server.js')), before);
    assert.equal(fs.existsSync(path.join(b.src, 'quoteReachable.js')), false);
  });

  it('refuses any other starting md5 and edits nothing', () => {
    const b = fakeBox();
    fs.appendFileSync(path.join(b.src, 'deals_api_server.js'), '\n// drift\n');
    const r = sh(['check'], b.env);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /neither the expected before/);
  });

  it('apply refuses while the sync lock is held or a crawl runs', () => {
    const held = fakeBox({ lock: '[sync-lock] 2026-10-30T21:32:53.644Z acquire by inventory-sync-1\n' });
    let r = sh(['apply'], held.env);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /sync lock is held/);
    assert.equal(fs.existsSync(path.join(held.src, 'quoteReachable.js')), false);
    const busy = fakeBox({ proc: 'node|sh|bash' });
    r = sh(['apply'], busy.env);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /process is running/);
    assert.equal(fs.existsSync(path.join(busy.src, 'quoteReachable.js')), false);
  });

  it('apply backs up first, lands the pinned files, is idempotent, and restore puts the original back', () => {
    const b = fakeBox();
    const original = md5(path.join(b.src, 'deals_api_server.js'));
    const r = sh(['apply'], b.env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /FILES APPLIED/);
    assert.equal(md5(path.join(b.src, 'deals_api_server.js')), want('RESULT', 'deals_api_server.js@live-2026-10-30'));
    assert.equal(md5(path.join(b.src, 'quoteReachable.js')), want('PACKAGE', 'files/quoteReachable.js'));
    assert.equal(md5(path.join(b.env.BACKUP, 'deals_api_server.js')), original, 'the backup is the file as it was');
    assert.match(sh(['apply'], b.env).stdout, /ALREADY PATCHED/);
    const back = sh(['restore'], b.env);
    assert.equal(back.status, 0, back.stdout + back.stderr);
    assert.equal(md5(path.join(b.src, 'deals_api_server.js')), original);
    assert.equal(fs.existsSync(path.join(b.src, 'quoteReachable.js')), false);
  });
});

describe('the module the box gets', () => {
  it('answers the audit cases', async () => {
    const m = await import(MODULE);
    assert.equal(m.reachabilityBucket({ contactEmail: 'accessibility@hmausa.com' }), 'none');
    assert.equal(m.reachabilityBucket({ contactEmail: 'jdoe@gmail.com' }), 'unverified');
    assert.equal(m.reachabilityBucket({ contactEmail: 'jdoe@lafontaine.com', dealerName: 'LaFontaine Chrysler Dodge Jeep Ram of Walled Lake', website: 'lafontainecdjrwalledlake.com' }), 'reachable');
  });
});
