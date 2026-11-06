// Deterministic three-process demonstration that the "hard-linked token lock + takeover from dead owners + assertHeld before the commit rename" protocol
// (scripts/legacy/dom_index_token_lock.mjs, PR #721 at 3704168f) lets TWO mergers commit concurrently and loses an update. Real processes, marker files for
// the pauses, a temp dir only. Exit code 0 = failure reproduced (that is the point), 1 = the protocol held.
//
//   dead holder's lock L1 on disk
//   C1  reads L1, judges it dead, PAUSES before renaming it                                  (stale-lock contender)
//   H   takes L1 itself (it IS dead), now holds L2, streams its merge, assertHeld() passes, PAUSES before the index rename   (the live holder)
//   C1  resumes: renames the path aside -> that moves H's LIVE lock L2; PAUSES with the path empty
//   C3  finds the path empty, takes L3, merges, commits, and stays inside its section       (third contender)
//   H   resumes: its assertHeld already passed, so it renames its temp over the index
//   => C3's commit is overwritten: two mergers committed concurrently, and C3's record is lost.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const role = process.argv[2];
const dir = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mark = (n) => fs.writeFileSync(path.join(dir || '.', n), String(Date.now()));
const reached = (n) => fs.existsSync(path.join(dir, n));
const pause = async (point) => { mark(`${point}.reached`); while (!reached(`${point}.go`)) await sleep(2); };

if (role) {
  const { acquire } = await import('./legacy/dom_index_token_lock.mjs');
  const lockPath = path.join(dir, 'locks', 'dom-index.merge.lock');
  const indexPath = path.join(dir, 'dom_index.json');
  const merge = (who) => { const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8')); idx[who] = { '2026-11-06': { price: 1 } }; const tmp = `${indexPath}.tmp-${who}`; fs.writeFileSync(tmp, JSON.stringify(idx)); return tmp; };
  const hooks = role === 'C1' ? { beforeBreakRename: () => pause('c1-judged'), afterAside: () => pause('c1-aside') } : {};
  const lock = await acquire({ lockPath, label: role, hooks });
  mark(`${role}.acquired`);
  const tmp = merge(role);                       // each merger streams its own merge from the index it saw
  if (role === 'H') { await lock.assertHeld(); await pause('h-asserted'); }
  else await lock.assertHeld();
  mark(`${role}.commit-start`);
  fs.renameSync(tmp, indexPath);                 // the commit
  mark(`${role}.commit-end`);
  if (role === 'C3') await pause('c3-exit');
  await lock.release();
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-takeover-demo-'));
const kids = [];
const run = (r) => { const c = spawn(process.execPath, [self, r, tmp], { stdio: ['ignore', 'inherit', 'inherit'] }); kids.push(c); return c; };
const waitFile = async (n) => { for (let i = 0; i < 20000 && !fs.existsSync(path.join(tmp, n)); i++) await sleep(2); if (!fs.existsSync(path.join(tmp, n))) throw new Error('timeout waiting for ' + n); };
const go = (p) => fs.writeFileSync(path.join(tmp, `${p}.go`), '1');
try {
  fs.mkdirSync(path.join(tmp, 'locks'));
  fs.writeFileSync(path.join(tmp, 'dom_index.json'), JSON.stringify({ BASE: { '2026-11-01': { price: 9 } } }));
  // L1: a lock whose holder is dead (a pid that cannot exist)
  fs.writeFileSync(path.join(tmp, 'locks', 'dom-index.merge.lock'), JSON.stringify({ v: 1, token: 'a'.repeat(32), pid: 2147483000, start: 'x', boot: 'x', label: 'dead', startedAt: new Date().toISOString() }));
  const c1 = run('C1'); await waitFile('c1-judged.reached');
  const h = run('H'); await waitFile('h-asserted.reached');
  go('c1-judged'); await waitFile('c1-aside.reached');
  const c3 = run('C3'); await waitFile('C3.commit-end');
  go('h-asserted'); await waitFile('H.commit-end');
  const idx = JSON.parse(fs.readFileSync(path.join(tmp, 'dom_index.json'), 'utf8'));
  const t = (n) => Number(fs.readFileSync(path.join(tmp, n), 'utf8'));
  const hAcq = t('H.acquired'), hEnd = t('H.commit-end'), cAcq = t('C3.acquired'), cEnd = t('C3.commit-end');
  const overlap = cAcq < hEnd && hAcq < cEnd;
  console.log(`H   holds the lock from +0 ms until its commit at +${hEnd - hAcq} ms (it passed assertHeld at the start of that window)`);
  console.log(`C3  acquired the lock at +${cAcq - hAcq} ms and committed at +${cEnd - hAcq} ms`);
  console.log(`critical sections overlap: ${overlap ? 'YES - two mergers committed concurrently' : 'no'}`);
  console.log(`final index keys: ${Object.keys(idx).join(', ')}  ->  ${idx.C3 ? 'C3 record present' : 'C3 RECORD LOST (overwritten by H)'}`);
  go('c1-aside'); go('c3-exit');
  await sleep(300);
  process.exitCode = overlap && !idx.C3 ? 0 : 1;
} finally { for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* done */ } } fs.rmSync(tmp, { recursive: true, force: true }); }
