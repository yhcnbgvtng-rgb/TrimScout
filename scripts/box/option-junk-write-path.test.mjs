// scripts/box/2026-10-16-option-junk-write-path.mjs: the anchored box patch for the global option junk list. Runs it against a copy of the
// source files put back to their pre-patch text (the patch's own edits reversed), so it needs no git history and touches no box.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', '..', 'scrapers', 'lightsail-crawler', 'src');
const SCRIPT = path.join(here, '2026-10-16-option-junk-write-path.mjs');
const script = fs.readFileSync(SCRIPT, 'utf8');
const EDITS = JSON.parse(script.match(/const EDITS =\n(\[[\s\S]*?\n\]);\n/)[1]);
const FILES = ['inventoryOptionRows.js', 'factoryOptionAllowlist.js', 'deals_api_server.js'];

function boxCopy({ patched = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'junk-box-'));
  fs.mkdirSync(path.join(dir, 'optionPolicies'));
  fs.writeFileSync(path.join(dir, 'optionPolicies', 'toyota-2026-2027.json'), '{}');
  for (const f of [...FILES, 'optionSentenceFilter.js']) {
    let t = fs.readFileSync(path.join(SRC, f), 'utf8');
    if (!patched) for (const e of EDITS.filter((x) => x.file === f)) { assert.equal(t.split(e.replace).length - 1, 1, `${e.id}: replacement unique in the repo file`); t = t.replace(e.replace, () => e.find); }
    fs.writeFileSync(path.join(dir, f), t);
  }
  return dir;
}
// The live env value is passed in (the script otherwise asks pm2, read-only); default = the live list without Hyundai.
const liveEnv = (dir) => `${dir}/optionPolicies/toyota-2026-2027.json`;
const run = (dir, ...extra) => spawnSync(process.execPath, [SCRIPT, `--dir=${dir}`, `--src=${SRC}`, ...(extra.some((x) => x.startsWith('--policy-env')) ? [] : [`--policy-env=${liveEnv(dir)}`]), ...extra], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });
const snapshot = (dir, base = dir) => Object.fromEntries(fs.readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return fs.statSync(p).isDirectory() ? Object.entries(snapshot(p, base)) : [[path.relative(base, p), fs.readFileSync(p, 'utf8')]]; }));

describe('2026-10-16-option-junk-write-path.mjs', () => {
  it('the reversed copy really is pre-patch (no engine, no install line)', () => {
    const dir = boxCopy();
    const rowsSrc = fs.readFileSync(path.join(dir, 'inventoryOptionRows.js'), 'utf8');
    for (const marker of ['activeJunkRules', 'rewriteOptionLabel', 'junkExemptionFor', 'repairedPart']) assert.ok(!rowsSrc.includes(marker), marker);
    assert.ok(!fs.readFileSync(path.join(dir, 'deals_api_server.js'), 'utf8').includes('installJunkRulesFromEnv'));
  });
  it('dry run: every anchor found once, behaviour checks pass, nothing written', () => {
    const dir = boxCopy(); const before = snapshot(dir);
    const r = run(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal((r.stdout.match(/will apply/g) || []).length, EDITS.length);
    assert.match(r.stdout, /DRY RUN ok/);
    assert.deepEqual(snapshot(dir), before);
  });
  it('apply: patched files equal the repo files, backups made, JSON installed, second run changes nothing', () => {
    const dir = boxCopy(); const orig = snapshot(dir);
    const r = run(dir, '--apply');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const f of FILES) {
      const got = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.equal(got, fs.readFileSync(path.join(SRC, f), 'utf8'), `${f}: the box ends with the repo's text`);
      const bak = fs.readdirSync(dir).find((x) => x.startsWith(`${f}.bak.`));
      assert.ok(bak, `${f} backed up`);
      assert.equal(fs.readFileSync(path.join(dir, bak), 'utf8'), orig[f], `${f} backup is the original`);
    }
    assert.equal(fs.readFileSync(path.join(dir, 'optionJunkRules.json'), 'utf8'), fs.readFileSync(path.join(SRC, 'optionJunkRules.json'), 'utf8'));
    const after = snapshot(dir);
    const again = run(dir, '--apply');
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.equal((again.stdout.match(/already applied/g) || []).length, EDITS.length);
    for (const f of FILES) assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), after[f], `${f} unchanged by the second run`);
    assert.deepEqual(Object.keys(snapshot(dir)).sort(), Object.keys(after).sort(), 'the second run creates no new file (no new backups)');
  });
  it('the patched copy works end to end: RAV4 junk dropped, controls kept, OPTION_JUNK_RULES=off keeps everything', async () => {
    const dir = boxCopy(); assert.equal(run(dir, '--apply').status, 0);
    for (const f of ['inventoryOptionRows.js', 'factoryOptionAllowlist.js']) fs.copyFileSync(path.join(dir, f), path.join(dir, f.replace(/\.js$/, '.mjs')));
    const probe = `import { optionRowsFromOptions } from './inventoryOptionRows.mjs'; import { installJunkRulesFromEnv } from './factoryOptionAllowlist.mjs';
      import { optionRowsFromOptions as o2 } from './inventoryOptionRows.js';
      installJunkRulesFromEnv(process.env, { warn() {} });
      console.log(JSON.stringify(o2([{ name: 'Roadside Assistance' }, { name: 'Multipoint Point Inspection' }, { name: 'Weather Package' }]).rows.map((r) => r.label)));`;
    fs.writeFileSync(path.join(dir, 'probe.mjs'), probe);
    const on = spawnSync('node', [path.join(dir, 'probe.mjs')], { encoding: 'utf8' });
    assert.equal(on.stdout.trim().split('\n').pop(), '["Weather Package"]', on.stderr);
    const off = spawnSync('node', [path.join(dir, 'probe.mjs')], { encoding: 'utf8', env: { ...process.env, OPTION_JUNK_RULES: 'off' } });
    assert.equal(off.stdout.trim().split('\n').pop(), '["Roadside Assistance","Multipoint Point Inspection","Weather Package"]', off.stderr);
  });
  it('an anchor that is missing (the box file drifted) aborts with nothing written', () => {
    const dir = boxCopy();
    const f = path.join(dir, 'factoryOptionAllowlist.js');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('const base = optionRowsFromOptions(options);', 'const base = optionRowsFromOptions(options, {});'));
    const before = snapshot(dir);
    const r = run(dir, '--apply');
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /ANCHOR PROBLEM|ABORT/);
    assert.deepEqual(snapshot(dir), before);
  });
  it('an anchor that occurs twice aborts too', () => {
    const dir = boxCopy();
    const f = path.join(dir, 'deals_api_server.js');
    fs.appendFileSync(f, '\nconst OPTION_CATALOG_MODE = catalogModeFromEnv();\n');
    const before = snapshot(dir);
    assert.equal(run(dir, '--apply').status, 2);
    assert.deepEqual(snapshot(dir), before);
  });
  it('never restarts or runs anything on the box', () => {
    const code = script.replace(/\/\/.*$/gm, '');
    const body = code.replace(/const EDITS =[\s\S]*?\n\];\n/, '');
    assert.doesNotMatch(body, /sudo|systemctl|rmSync\(DIR|unlink/);
    // The only thing it runs besides `node --check` is a read-only `pm2 jlist`; the restart appears only inside a printed string.
    const execs = [...body.matchAll(/execFileSync\(([^,]+),\s*(\[[^\]]*\])/g)].map((m) => `${m[1]} ${m[2]}`);
    assert.ok(execs.every((e) => /process\.execPath \["--check"|"pm2" \["jlist"\]/.test(e)), execs.join(' | '));
    assert.doesNotMatch(body, /(?:exec|spawn)\w*\([^)]*restart/);
  });

  describe('Hyundai policy (missing from the live OPTION_MODEL_POLICY_PATH)', () => {
    const HY = fs.readFileSync(path.join(SRC, 'optionPolicies', 'hyundai-2025-2027.json'), 'utf8');
    it('dry run reports "not installed" and "not listed", loads the policy on the patched module, and writes nothing', () => {
      const dir = boxCopy(); const before = snapshot(dir);
      const r = run(dir);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /hyundai policy file: NOT installed/);
      assert.match(r.stdout, /hyundai in live OPTION_MODEL_POLICY_PATH: NOT listed/);
      assert.match(r.stdout, /Hyundai policy loads on the patched allowlist module/);
      assert.deepEqual(snapshot(dir), before);
    });
    it('unknown live value (no pm2, no --policy-env) is reported as UNKNOWN, not guessed', () => {
      const dir = boxCopy();
      const r = spawnSync(process.execPath, [SCRIPT, `--dir=${dir}`, `--src=${SRC}`], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /UNKNOWN \(pm2 not readable/);
    });
    it('apply installs the file, writes the new path (live list + Hyundai, once) and prints the restart line without running it', () => {
      const dir = boxCopy(); const r = run(dir, '--apply');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(fs.readFileSync(path.join(dir, 'optionPolicies', 'hyundai-2025-2027.json'), 'utf8'), HY);
      assert.equal(fs.readFileSync(path.join(dir, 'optionPolicies', 'OPTION_MODEL_POLICY_PATH.next'), 'utf8').trim(), `${liveEnv(dir)},${dir}/optionPolicies/hyundai-2025-2027.json`);
      assert.match(r.stdout, /pm2 restart deals-api --update-env && pm2 save {4}# NOT run by this script/);
      const again = run(dir, '--apply', `--policy-env=${liveEnv(dir)},${dir}/optionPolicies/hyundai-2025-2027.json`);
      assert.equal(again.status, 0, again.stdout + again.stderr);
      assert.match(again.stdout, /hyundai-2025-2027.json: already installed, unchanged/);
      assert.equal(fs.readFileSync(path.join(dir, 'optionPolicies', 'OPTION_MODEL_POLICY_PATH.next'), 'utf8').trim().split(',').length, 2, 'not listed twice');
    });
    it('a different file already there is backed up before it is replaced', () => {
      const dir = boxCopy(); fs.writeFileSync(path.join(dir, 'optionPolicies', 'hyundai-2025-2027.json'), '{"old":true}');
      const r = run(dir, '--apply');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const bak = fs.readdirSync(path.join(dir, 'optionPolicies')).find((x) => x.startsWith('hyundai-2025-2027.json.bak.'));
      assert.equal(fs.readFileSync(path.join(dir, 'optionPolicies', bak), 'utf8'), '{"old":true}');
      assert.equal(fs.readFileSync(path.join(dir, 'optionPolicies', 'hyundai-2025-2027.json'), 'utf8'), HY);
    });
    it('already installed and listed: the dry run says so', () => {
      const dir = boxCopy(); fs.writeFileSync(path.join(dir, 'optionPolicies', 'hyundai-2025-2027.json'), HY);
      const r = run(dir, `--policy-env=${liveEnv(dir)},${dir}/optionPolicies/hyundai-2025-2027.json`);
      assert.match(r.stdout, /installed, same as the repo's/); assert.match(r.stdout, /OPTION_MODEL_POLICY_PATH: listed/); assert.match(r.stdout, /Hyundai policy: installed and listed/);
    });
    it('no optionPolicies directory: abort, nothing written', () => {
      const dir = boxCopy(); fs.rmSync(path.join(dir, 'optionPolicies'), { recursive: true }); const before = snapshot(dir);
      assert.equal(run(dir, '--apply').status, 2);
      assert.deepEqual(snapshot(dir), before);
    });
  });
});
