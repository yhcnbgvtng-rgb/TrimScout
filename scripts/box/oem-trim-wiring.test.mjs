// The sync-client / deals-API wiring patches for oemTrim.js (docs/box-patches/2026-10-28-oem-trim-sync-api-wiring/): they are cut against the repo files and
// applied to box2's own copies at install time, so they must still apply here (no fuzz). Nothing here touches a box.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PKG = path.join(ROOT, 'docs/box-patches/2026-10-28-oem-trim-sync-api-wiring');
const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const hasPatch = spawnSync('patch', ['--version']).status === 0;
const FILES = [
  { patch: 'deals_api_server.js.patch', file: 'scrapers/lightsail-crawler/src/deals_api_server.js', base: '6512f25c22306a6ac506b8ba1426ac1b', result: '8df86d11c54dfad14cd1a6f6eb23903b', must: [/import \{ normalizeTrimForWrite \} from "\.\/oemTrim\.js"/, /normalizeTrimForWrite\(\{ make, model: v\.model/], mustNot: /normalizeFordTrimForWrite/ },
  { patch: 'inventory-sync.mjs.patch', file: 'scripts/box/inventory-sync.mjs', base: '9a872876ec7c407e03c1f1c24e7a623a', result: '051c1a4f227a81a21b400dc7e25c2614', must: [/\.\/oemTrim\.js/, /\.\.\.trimFields\(v\)/, /trim normalizer: loaded/] },
];

describe('oem trim wiring patches', { skip: hasPatch ? false : 'no patch(1) on this machine' }, () => {
  for (const f of FILES) {
    it(`${f.patch} applies to ${f.file} without fuzz and produces a loadable file`, () => {
      const src = fs.readFileSync(path.join(ROOT, f.file));
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oem-wiring-'));
      const out = path.join(dir, path.basename(f.file));
      fs.writeFileSync(out, src);
      execFileSync('patch', ['-s', '-F0', out], { input: fs.readFileSync(path.join(PKG, f.patch)) });
      const patched = fs.readFileSync(out, 'utf8');
      if (md5(src) === f.base) assert.equal(md5(patched), f.result, 'on the file the patch was cut from it reproduces the recorded result');
      for (const re of f.must) assert.match(patched, re);
      if (f.mustNot) assert.doesNotMatch(patched, f.mustNot);
      assert.equal(spawnSync(process.execPath, ['--check', out]).status, 0, 'patched file parses');
    });
  }
  it('STEPS.md quotes the same base and result md5s', () => {
    const steps = fs.readFileSync(path.join(PKG, 'STEPS.md'), 'utf8');
    for (const f of FILES) { assert.ok(steps.includes(f.base), f.patch); assert.ok(steps.includes(f.result), f.patch); }
    assert.match(steps, /Nothing here is installed|nothing here is installed/i);
  });
});
