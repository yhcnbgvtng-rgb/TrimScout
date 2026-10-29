// The install script for the staged accept-original patch: module-only, refuses on a server missing earlier patches, verifies the md5,
// backs up, is idempotent. The md5 printed in docs/STAGED_ACCEPT_ORIGINAL.md must be the md5 of the module in this repo.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', '..', 'scrapers', 'lightsail-crawler', 'src');
const SCRIPT = path.join(here, '2026-10-29-rfq-staged-accept-original.sh');
const DOC = fs.readFileSync(path.join(here, '..', '..', 'docs', 'STAGED_ACCEPT_ORIGINAL.md'), 'utf8');
const MIRROR = fs.readFileSync(path.join(SRC, 'deals_api_server.js'), 'utf8');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const NEW_MD5 = md5(path.join(SRC, 'rfqStages.js'));

function box(server = MIRROR, { v2 = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accept-original-'));
  fs.writeFileSync(path.join(dir, 'deals_api_server.js'), server);
  fs.copyFileSync(path.join(SRC, 'dealStages.js'), path.join(dir, 'dealStages.js'));
  fs.writeFileSync(path.join(dir, 'rfqStages.js'), v2 ? '// live v2 module\nexport const x = 1;\n' : '');
  if (!v2) fs.writeFileSync(path.join(dir, 'dealStages.js'), '// v1\n');
  return dir;
}
const run = (dir, env = {}) => spawnSync('bash', [SCRIPT], { env: { ...process.env, TEST_ONLY: '1', FILE: path.join(dir, 'deals_api_server.js'), SRC_LOCAL: SRC, ...env }, encoding: 'utf8' });

describe('2026-10-29 staged accept-original box script', () => {
  it('installs only rfqStages.js, backs the old one up, prints md5s, leaves the server file alone', () => {
    const dir = box();
    const before = md5(path.join(dir, 'rfqStages.js'));
    const r = run(dir, { EXPECT_MD5: NEW_MD5 });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(md5(path.join(dir, 'rfqStages.js')), NEW_MD5);
    const bak = fs.readdirSync(dir).find((f) => f.startsWith('rfqStages.js.bak.'));
    assert.ok(bak, 'backed up');
    assert.equal(md5(path.join(dir, bak)), before, 'the backup is the file that was live');
    assert.match(r.stdout, new RegExp(`new rfqStages.js md5: ${NEW_MD5}`));
    assert.match(r.stdout, new RegExp(`live rfqStages.js md5 before: ${before}`));
    assert.equal(fs.readFileSync(path.join(dir, 'deals_api_server.js'), 'utf8'), MIRROR);
    assert.equal(fs.readdirSync(dir).filter((f) => f.includes('.bak.')).length, 1, 'no other file is touched');
  });
  it('is idempotent', () => {
    const dir = box(); run(dir);
    const files = fs.readdirSync(dir).sort();
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /rfqStages\.js: already current/);
    assert.deepEqual(fs.readdirSync(dir).sort(), files);
  });
  it('refuses, changing nothing, on a wrong md5', () => {
    const dir = box(); const before = md5(path.join(dir, 'rfqStages.js'));
    const r = run(dir, { EXPECT_MD5: '0'.repeat(32) });
    assert.notEqual(r.status, 0); assert.match(r.stdout, /md5 mismatch/);
    assert.equal(md5(path.join(dir, 'rfqStages.js')), before);
  });
  it('refuses when the stage endpoint, the buyer counter or the v2 stage module is missing', () => {
    for (const [label, dir, expect] of [
      ['stage', box(MIRROR.replaceAll('createRfqStageHandler', 'noStage')), /2026-10-11-rfq-deal-stages\.sh/],
      ['counter', box(MIRROR.replaceAll('buyer_counter_json', 'x_json')), /2026-09-13-buyer-counter\.sh/],
      ['v2', box(MIRROR, { v2: false }), /2026-10-13-rfq-deal-stages-v2\.sh/],
    ]) {
      const before = md5(path.join(dir, 'rfqStages.js'));
      const r = run(dir);
      assert.notEqual(r.status, 0, label); assert.match(r.stdout, expect, label);
      assert.equal(md5(path.join(dir, 'rfqStages.js')), before, `${label}: untouched`);
    }
  });
  it('the doc names the md5 of the module in this repo, the script, and a rollback', () => {
    assert.ok(DOC.includes(NEW_MD5), `docs/STAGED_ACCEPT_ORIGINAL.md must contain ${NEW_MD5}`);
    assert.ok(DOC.includes(md5(SCRIPT)), 'doc must contain the installer md5');
    assert.match(DOC, /2026-10-29-rfq-staged-accept-original\.sh/);
    assert.match(DOC, /Rollback/i);
    assert.match(DOC, /NEXT_PUBLIC_STAGED_ACCEPT_ORIGINAL/);
  });
});
