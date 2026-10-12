// The deploy script for the second half of the deal stages: it only installs the two modules, but it must refuse to run on a server
// that lacks the trade-in (#414), stage (#482) or not-selected (#490) patches, never half-install, and be idempotent.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', '..', 'scrapers', 'lightsail-crawler', 'src');
const SCRIPT = path.join(here, '2026-10-13-rfq-deal-stages-v2.sh');
const MIRROR = fs.readFileSync(path.join(SRC, 'deals_api_server.js'), 'utf8');

function box(serverText = MIRROR, modules = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stages-v2-'));
  fs.writeFileSync(path.join(dir, 'deals_api_server.js'), serverText);
  if (modules) {
    // What box2 has today: the v1 modules (anything that is not the v2 file).
    fs.writeFileSync(path.join(dir, 'dealStages.js'), '// old v1 module\nexport const STAGES = [];\n');
    fs.writeFileSync(path.join(dir, 'rfqStages.js'), '// old v1 module\nexport const x = 1;\n');
  }
  return dir;
}
const run = (dir, extraEnv = {}) => spawnSync('bash', [SCRIPT], { env: { ...process.env, TEST_ONLY: '1', FILE: path.join(dir, 'deals_api_server.js'), SRC_LOCAL: SRC, ...extraEnv }, encoding: 'utf8' });

describe('2026-10-13 deal stages v2 box script', () => {
  it('installs both modules next to the server, backing up the old ones, and leaves the server file alone', () => {
    const dir = box();
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    for (const m of ['dealStages.js', 'rfqStages.js']) {
      assert.equal(fs.readFileSync(path.join(dir, m), 'utf8'), fs.readFileSync(path.join(SRC, m), 'utf8'));
      assert.ok(fs.readdirSync(dir).some((f) => f.startsWith(`${m}.bak.`)), `${m} backed up`);
    }
    assert.equal(fs.readFileSync(path.join(dir, 'deals_api_server.js'), 'utf8'), MIRROR);
    assert.match(r.stdout, /syntax ok/);
  });
  it('is idempotent: a second run changes nothing', () => {
    const dir = box();
    run(dir);
    const before = fs.readdirSync(dir).sort();
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /dealStages\.js: already current/); assert.match(r.stdout, /rfqStages\.js: already current/);
    assert.deepEqual(fs.readdirSync(dir).sort(), before);
  });
  it('works on a box with no modules yet beside the server (nothing to back up)', () => {
    const dir = box(MIRROR, false);
    assert.equal(run(dir).status, 0);
    assert.ok(fs.existsSync(path.join(dir, 'rfqStages.js')));
  });
  it('refuses, changing nothing, when an earlier patch is missing: trade-in (#414), stage (#482), not-selected (#490)', () => {
    for (const [label, strip, expect] of [
      ['trade-in', (s) => s.replaceAll('trade_in_json', 'x_json'), /2026-10-08-rfq-trade-in\.sh/],
      ['stage', (s) => s.replaceAll('createRfqStageHandler', 'noStage'), /2026-10-11-rfq-deal-stages\.sh/],
      ['not-selected', (s) => s.replaceAll('createRfqNotSelectedHandler', 'noNotSelected'), /2026-10-12-rfq-not-selected\.sh/],
    ]) {
      const dir = box(strip(MIRROR));
      const before = fs.readFileSync(path.join(dir, 'dealStages.js'), 'utf8');
      const r = run(dir);
      assert.notEqual(r.status, 0, label);
      assert.match(r.stdout, expect, label);
      assert.equal(fs.readFileSync(path.join(dir, 'dealStages.js'), 'utf8'), before, `${label}: untouched`);
      assert.ok(!fs.readdirSync(dir).some((f) => f.includes('.bak.')), `${label}: no backup made`);
    }
  });
  it('aborts before installing if a module is broken or is not the v2 module', () => {
    const dir = box();
    const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'stages-v2-src-'));
    fs.copyFileSync(path.join(SRC, 'rfqStages.js'), path.join(bad, 'rfqStages.js'));
    fs.writeFileSync(path.join(bad, 'dealStages.js'), 'export const STAGES = [');
    let r = run(dir, { SRC_LOCAL: bad });
    assert.notEqual(r.status, 0);
    fs.writeFileSync(path.join(bad, 'dealStages.js'), 'export const STAGES = ["otd"]; export function applyStageAction() {}');
    r = run(dir, { SRC_LOCAL: bad });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /not the v2 module/);
    assert.match(fs.readFileSync(path.join(dir, 'dealStages.js'), 'utf8'), /old v1 module/);
  });
  it('the real script asks for the idle window and Paul\'s GO, restarts deals-api exactly once, and does not touch FEATURE_DEAL_STAGES', () => {
    const s = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(s, /IDLE WINDOW[\s\S]*PAUL'S GO/);
    assert.equal(s.split('\n').filter((l) => /^\s*sudo pm2 restart trimscout-deals-api/.test(l)).length, 1, 'one real restart (the rollback hint is an echo)');
    assert.match(s, /pgrep -f inventory-sync\.mjs/);
    assert.doesNotMatch(s.replace(/^#.*$/gm, ''), /FEATURE_DEAL_STAGES/);
    execFileSync('bash', ['-n', SCRIPT]);
  });
  it('the modules it installs load together under plain node', () => {
    const out = execFileSync('node', ['--input-type=module', '-e', `const m = await import(${JSON.stringify(path.join(SRC, 'rfqStages.js'))}); const d = await import(${JSON.stringify(path.join(SRC, 'dealStages.js'))}); console.log(typeof m.createRfqStageHandler, d.FINANCE_TERM_OPTIONS.join(','))`], { encoding: 'utf8' });
    assert.equal(out.trim(), 'function 36,48,60,72');
  });
});
