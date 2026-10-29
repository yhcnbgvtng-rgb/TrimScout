// Wires oemTrim.js into a crawl box's OWN standalone.js (the file differs from the repo on every box, so it is patched in place, never copied over).
// The same two edits PR #609 made in the repo:
//   import { normalizeFordTrimForWrite } from './fordTrim.js';   ->  import { normalizeTrimForWrite } from './oemTrim.js';
//   normalizeFordTrimForWrite(                                    ->  normalizeTrimForWrite(
// normalizeTrimForWrite runs the Ford rule first and returns its answer unless Ford skipped the row, so Ford rows are unchanged.
//
//   node 2026-10-28-oem-trim-crawler-patch.mjs <standalone.js>                    # CHECK (default): reports what it would do, writes nothing
//   node 2026-10-28-oem-trim-crawler-patch.mjs <standalone.js> --apply            # backup, patch, node --check; restores the backup if the check fails
//   node 2026-10-28-oem-trim-crawler-patch.mjs <standalone.js> --rollback         # put the backup back
//
// Exit codes: 0 ok (or already wired), 2 the file does not look like what the edit expects (drift: nothing written, send the file back),
// 3 the dependency files beside it are missing or have the wrong md5, 4 the patched file does not parse (backup restored), 5 usage / no backup.
// Nothing here touches a database, a process or a cron entry. A crawl is a fresh Node process, so there is no restart.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BACKUP_SUFFIX = '.bak.oemtrim-20261028';
// The files this PR ships to each box (src/ beside standalone.js). fordTrim.js is the entity-decode version oemTrim.js imports cleanFordTrimText from.
export const DEPS = { 'oemTrim.js': '0f9bb8163921b82ff9f54748e1a64cee', 'fordTrim.js': '1224e1ae9aae5528a8af39ad5da3a2f3' };

const IMPORT_OLD = /^import \{ normalizeFordTrimForWrite \} from '\.\/fordTrim\.js';[ \t]*$/m;
const IMPORT_NEW = "import { normalizeTrimForWrite } from './oemTrim.js'; // Ford (fordTrim.js) + Chevrolet / GMC / Toyota / Ram";
const WIRED = /^import \{ normalizeTrimForWrite \} from '\.\/oemTrim\.js';/m;

const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const count = (s, needle) => s.split(needle).length - 1;

/** Pure: the patched text, or why not. status: 'wired' (nothing to do) | 'patch' | 'drift'. */
export function planPatch(text) {
  if (WIRED.test(text) && !text.includes('normalizeFordTrimForWrite')) return { status: 'wired', text };
  const idents = count(text, 'normalizeFordTrimForWrite');
  const calls = count(text, 'normalizeFordTrimForWrite(');
  const imports = (text.match(new RegExp(IMPORT_OLD.source, 'gm')) || []).length;
  if (idents !== 2 || calls !== 1 || imports !== 1) {
    return { status: 'drift', reason: `expected exactly 1 import line and 1 call of normalizeFordTrimForWrite (2 mentions), found ${imports} import line(s), ${calls} call(s), ${idents} mention(s)` };
  }
  if (text.includes('normalizeTrimForWrite')) return { status: 'drift', reason: 'file already mentions normalizeTrimForWrite next to the Ford one' };
  const out = text.replace(IMPORT_OLD, IMPORT_NEW).replace('normalizeFordTrimForWrite(', 'normalizeTrimForWrite(');
  return { status: 'patch', text: out };
}

/** Dependency files beside the target: [{ name, ok, md5 }]. */
export function checkDeps(dir) {
  return Object.entries(DEPS).map(([name, want]) => {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) return { name, ok: false, md5: null, want };
    const got = md5(fs.readFileSync(p));
    return { name, ok: got === want, md5: got, want };
  });
}

function main(argv) {
  const file = argv.find((a) => !a.startsWith('--'));
  const apply = argv.includes('--apply');
  const rollback = argv.includes('--rollback');
  if (!file) { console.error('usage: 2026-10-28-oem-trim-crawler-patch.mjs <path to standalone.js> [--apply | --rollback]'); return 5; }
  const backup = file + BACKUP_SUFFIX;
  if (rollback) {
    if (!fs.existsSync(backup)) { console.error(`no backup at ${backup}`); return 5; }
    fs.copyFileSync(backup, file);
    console.log(`restored ${file} from ${backup} (md5 ${md5(fs.readFileSync(file))})`);
    return 0;
  }
  const before = fs.readFileSync(file, 'utf8');
  console.log(`${file}: md5 ${md5(before)}`);
  const plan = planPatch(before);
  if (plan.status === 'wired') { console.log('already wired to oemTrim.js: nothing to do'); return 0; }
  if (plan.status === 'drift') { console.error(`DRIFT: ${plan.reason}. Nothing written. Send this file back; do not hand-edit it.`); return 2; }
  const deps = checkDeps(path.dirname(file));
  for (const d of deps) console.log(`  ${d.name}: ${d.ok ? 'ok' : d.md5 ? `md5 ${d.md5} (want ${d.want})` : 'MISSING'}`);
  if (!deps.every((d) => d.ok)) { console.error('DEPENDENCIES: the importing file would fail to load. Install oemTrim.js / fordTrim.js first. Nothing written.'); return 3; }
  console.log(`would write: md5 ${md5(plan.text)} (import line + one call changed)`);
  if (!apply) { console.log('CHECK only. Re-run with --apply to write it.'); return 0; }
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const tmp = file + '.oemtrim-tmp.js';
  fs.writeFileSync(tmp, plan.text);
  const chk = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  if (chk.status !== 0) { fs.rmSync(tmp, { force: true }); console.error(`node --check failed, nothing changed:\n${chk.stderr}`); return 4; }
  fs.renameSync(tmp, file);
  console.log(`patched ${file}: md5 ${md5(fs.readFileSync(file))}; backup ${backup}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
