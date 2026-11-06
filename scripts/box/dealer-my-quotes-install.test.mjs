// The My Quotes box2 install package: files match the manifest, the installer is valid shell, the module does not depend on the
// (older) live auditKey.js, and the patch adds exactly the documented wiring. The live-file dry run is done by install.sh check ON box2.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = path.join(root, 'docs', 'box-patches', '2026-11-06-dealer-my-quotes');
const md5 = (f) => createHash('md5').update(fs.readFileSync(f)).digest('hex');
const manifest = fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => { const [sum, role, file] = l.trim().split(/\s+/); return { sum, role, file }; });

describe('dealer-my-quotes box package', () => {
  it('every PACKAGE md5 equals the file, and the module equals the repo source', () => {
    for (const m of manifest.filter((x) => x.role === 'PACKAGE')) assert.equal(md5(path.join(PKG, m.file)), m.sum, m.file);
    assert.equal(md5(path.join(PKG, 'files', 'rfqDealerInvites.js')), md5(path.join(root, 'scrapers', 'lightsail-crawler', 'src', 'rfqDealerInvites.js')));
  });
  it('STEPS.md carries exactly the manifest', () => {
    const steps = fs.readFileSync(path.join(PKG, 'STEPS.md'), 'utf8');
    const block = /<!-- MD5S:START -->\n```\n([\s\S]*?)\n```\n<!-- MD5S:END -->/.exec(steps);
    assert.ok(block);
    assert.equal(block[1], fs.readFileSync(path.join(PKG, 'manifest.txt'), 'utf8').trimEnd());
  });
  it('install.sh is valid bash, uses plain pm2 (no sudo) and pins the live starting md5', () => {
    assert.equal(spawnSync('bash', ['-n', path.join(PKG, 'install.sh')]).status, 0);
    const sh = fs.readFileSync(path.join(PKG, 'install.sh'), 'utf8');
    assert.match(sh, /PM2=\$\{PM2:-pm2\}/);
    assert.doesNotMatch(sh, /sudo/);
    assert.match(sh, /SV_BASE=846d8cabac356b37798fb047f334c387/);
  });
  it('the module imports only dealStages.js (the live auditKey.js is older)', () => {
    const src = fs.readFileSync(path.join(PKG, 'files', 'rfqDealerInvites.js'), 'utf8');
    assert.deepEqual([...src.matchAll(/^import .* from "(.*)";/gm)].map((m) => m[1]), ['./dealStages.js']);
  });
  it('the patch adds the documented wiring and removes nothing', () => {
    const patch = fs.readFileSync(path.join(PKG, 'deals_api_server.js.patch'), 'utf8');
    const added = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    assert.equal(patch.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length, 0);
    const text = added.join('\n');
    for (const needle of ['createDealerInvitesHandlers', 'dealer_user_id VARCHAR(128) NULL', 'idx_rfq_invites_dealer_user', '"/api/dealer-invites"', '"/api/dealer-invites/claim"']) assert.ok(text.includes(needle), needle);
  });
});
