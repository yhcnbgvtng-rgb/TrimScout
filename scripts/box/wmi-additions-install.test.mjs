// The 2026-10-29 vinWmi.js box install (docs/box-patches/2026-10-29-wmi-additions): the shipped copy is the repo file, wmi-install.sh pins its md5 and the
// table size, and check / apply / restore work on a simulated crawler box (a temp dir, never a real one).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(REPO, 'docs/box-patches/2026-10-29-wmi-additions');
const SRC = path.join(REPO, 'scrapers/lightsail-crawler/src');
const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
const script = fs.readFileSync(path.join(DIR, 'wmi-install.sh'), 'utf8');
const { WMI_LIST } = await import(path.join(SRC, 'vinWmi.js'));
const hasMd5sum = spawnSync('bash', ['-c', 'command -v md5sum']).status === 0;

describe('wmi-additions install package', () => {
  it('files/vinWmi.js is byte-identical to the crawler source and wmi-install.sh pins its md5', () => {
    assert.equal(md5(path.join(DIR, 'files/vinWmi.js')), md5(path.join(SRC, 'vinWmi.js')));
    assert.match(script, new RegExp(`^AFTER=${md5(path.join(SRC, 'vinWmi.js'))}`, 'm'));
  });
  it('manifest.txt lists the md5 of every shipped file', () => {
    for (const line of fs.readFileSync(path.join(DIR, 'manifest.txt'), 'utf8').trim().split('\n')) {
      const [sum, file] = line.split(/\s+/);
      assert.equal(md5(path.join(DIR, file)), sum, file);
    }
  });
  it('the installer knows the size of the table it installs', () => assert.match(script, new RegExp(`eq\\(m\\.WMI_LIST\\.length, ${WMI_LIST.length}, "table size"\\)`)));
  it('the "before" md5 is the make-wmi patch\'s vinWmi.js (what boxes 1, 3, 4 carry)', () => {
    const before = /^BEFORE=([0-9a-f]{32})/m.exec(script)[1];
    assert.match(fs.readFileSync(path.join(REPO, 'docs/box-patches/2026-10-26-make-wmi/manifest.txt'), 'utf8'), new RegExp(`${before}\\s+files/vinWmi.js`));
  });
  it('refuses to run unless the crawl window is clear (21:50 ET guard and a process check are present)', () => {
    assert.match(script, /2150/);
    assert.match(script, /pgrep -fa/);
  });
  (hasMd5sum ? describe : describe.skip)('on a simulated crawler box (temp dir)', () => {
    const before = /^BEFORE=([0-9a-f]{32})/m.exec(script)[1];
    const after = md5(path.join(SRC, 'vinWmi.js'));
    const mkBox = (vinWmi) => {
      const t = fs.mkdtempSync(path.join(os.tmpdir(), 'wmi-box-'));
      fs.mkdirSync(path.join(t, 'c/src'), { recursive: true });
      fs.writeFileSync(path.join(t, 'c/package.json'), '{"type":"module"}');
      for (const f of ['stellantisVinTable.js', 'ingestGuards.js']) fs.copyFileSync(path.join(SRC, f), path.join(t, 'c/src', f));
      fs.copyFileSync(vinWmi, path.join(t, 'c/src/vinWmi.js'));
      return { t, v: path.join(t, 'c/src/vinWmi.js'), env: { CRAWLER_DIR: path.join(t, 'c'), BACKUP: path.join(t, 'bk'), ALLOW_CRAWL_WINDOW: '1', PROC_RE: 'zzz[n]omatch' } };
    };
    const run = (mode, env) => spawnSync('bash', [path.join(DIR, 'wmi-install.sh'), mode], { env: { ...process.env, ...env }, encoding: 'utf8' });
    const OLD = path.join(REPO, 'docs/box-patches/2026-10-26-make-wmi/files/vinWmi.js'); // the #597 table boxes 1, 3, 4 carry

    it('check passes on the old table and changes nothing', () => {
      assert.equal(md5(OLD), before);
      const b = mkBox(OLD); const r = run('check', b.env);
      assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /CHECK PASS/);
      assert.equal(md5(b.v), before); assert.ok(!fs.existsSync(path.join(b.t, 'bk')));
      fs.rmSync(b.t, { recursive: true });
    });
    it('apply installs the new table, a second apply is a no-op, restore puts the old one back', () => {
      const b = mkBox(OLD);
      let r = run('apply', b.env); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /APPLIED/);
      assert.equal(md5(b.v), after);
      r = run('apply', b.env); assert.equal(r.status, 0); assert.match(r.stdout, /ALREADY PATCHED/);
      r = run('restore', b.env); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /RESTORED/);
      assert.equal(md5(b.v), before);
      fs.rmSync(b.t, { recursive: true });
    });
    it('an unknown vinWmi.js md5 stops the install and the file is left alone', () => {
      const odd = path.join(os.tmpdir(), `odd-vinwmi-${process.pid}.js`); fs.writeFileSync(odd, '// not a known version\n');
      const b = mkBox(odd); const r = run('apply', b.env);
      assert.notEqual(r.status, 0); assert.match(r.stdout, /neither the expected/);
      assert.equal(fs.readFileSync(b.v, 'utf8'), '// not a known version\n');
      fs.rmSync(b.t, { recursive: true }); fs.rmSync(odd);
    });
    it('a box without vinWmi.js (no make-wmi patch yet) stops with a clear message', () => {
      const b = mkBox(OLD); fs.rmSync(b.v);
      const r = run('check', b.env); assert.notEqual(r.status, 0); assert.match(r.stdout, /has not had the make-wmi patch/);
      fs.rmSync(b.t, { recursive: true });
    });
  });
});
