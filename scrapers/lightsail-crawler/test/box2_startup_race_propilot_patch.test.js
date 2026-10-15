// scripts/box/2026-10-15-patch-startup-race-and-propilot.mjs: the anchored box2 patcher for #525 (startup race) and #519 (ProPILOT). Code only until Paul types GO.
// The box's own files are not in the repo, so this pins the properties that make the patcher safe to run: every edit is idempotent, nothing restarts, and
// the replacement text is exactly what main has in those regions.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '../../..');
const src = fs.readFileSync(path.join(repo, 'scripts/box/2026-10-15-patch-startup-race-and-propilot.mjs'), 'utf8');
const editsJson = src.slice(src.indexOf('const EDITS =\n') + 'const EDITS =\n'.length, src.indexOf('];\nfor (const e of EDITS)') + 1);
const EDITS = JSON.parse(editsJson);
const server = fs.readFileSync(path.join(repo, 'scrapers/lightsail-crawler/src/deals_api_server.js'), 'utf8');
const rows = fs.readFileSync(path.join(repo, 'scrapers/lightsail-crawler/src/inventoryOptionRows.js'), 'utf8');

describe('box2 patcher for #525 and #519', () => {
  it('has the four expected edits and none of them can apply twice (the anchor is never inside its own replacement)', () => {
    assert.deepEqual(EDITS.map((e) => e.id), ['525-wrapper', '525-trigger', '519-const', '519-test']);
    for (const e of EDITS) assert.ok(!e.replace.includes(e.find), e.id);
    assert.ok(src.includes('e.replace.includes(e.find)'));
  });
  it('every replacement is text main has today (so the box ends up with the same code in those regions)', () => {
    for (const e of EDITS) assert.ok((e.file === 'deals_api_server.js' ? server : rows).includes(e.replace), e.id);
  });
  it('every anchor must occur exactly once or the run aborts with nothing written; it is a dry run unless --apply', () => {
    assert.ok(src.includes('ANCHOR PROBLEM') && src.includes('nothing written') && src.includes('DRY RUN'));
  });
  it('backs up before replacing, syntax-checks the new files, and never restarts or touches pm2 or the database', () => {
    assert.ok(src.indexOf('copyFileSync(x.p, bak)') < src.indexOf('renameSync(x.newPath, x.p)'));
    assert.ok(src.includes('node", ["--check"') || src.includes("'--check'") || src.includes('"--check"'));
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /pm2|mysql|sudo|systemctl|restart\(/);
  });
});
