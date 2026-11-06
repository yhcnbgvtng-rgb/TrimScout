// FROZEN COPY of the hard-linked token lock that PR #721 used at commit 3704168f (src/dom_index_delta.js), with three test hooks added
// (beforeBreakRename, afterAside; the merge side calls assertHeld itself). Kept only so scripts/dom-index-lock-takeover-demo.mjs can show, deterministically,
// why a "check, then rename" lock protocol was REPLACED by a kernel flock. Not used by the crawler.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { judgeOwner, processIdentity } from '../../src/dom_index_delta.js';

async function readLockDoc(file) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return { missing: true }; return { unreadable: err.message }; }
  try { const doc = JSON.parse(text); if (doc && typeof doc.token === 'string' && Number.isInteger(doc.pid)) return { doc }; return { unreadable: 'no token/pid' }; } catch (err) { return { unreadable: err.message }; }
}

export async function acquire({ lockPath, label, maxWaitMs = 20000, hooks = {} }) {
  const token = crypto.randomBytes(16).toString('hex');
  const me = processIdentity(process.pid);
  const doc = { v: 1, token, pid: process.pid, start: me.start, boot: me.boot, label, startedAt: new Date().toISOString() };
  const tmp = `${lockPath}.new-${token}`;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(doc), { flag: 'wx' });
  const deadline = Date.now() + maxWaitMs;
  try {
    for (;;) {
      try { await fs.link(tmp, lockPath); break; } catch (err) { if (err.code !== 'EEXIST') throw err; }
      const cur = await readLockDoc(lockPath);
      if (cur.missing) continue;
      if (!cur.unreadable) {
        const j = judgeOwner({ pid: cur.doc.pid, start: cur.doc.start || 'x', boot: cur.doc.boot || 'x' });
        if (j.state === 'dead' || j.state === 'reused') { await breakLock(lockPath, cur.doc, token, hooks); continue; }
      }
      if (Date.now() >= deadline) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 20));
    }
  } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
  return {
    token,
    async assertHeld() { const cur = await readLockDoc(lockPath); if (!cur.doc || cur.doc.token !== token) throw new Error('lock lost'); },
    async release() { const cur = await readLockDoc(lockPath); if (!cur.doc || cur.doc.token !== token) return false; await fs.rm(lockPath, { force: true }); return true; },
  };
}

async function breakLock(lockPath, judged, myToken, hooks) {
  await hooks.beforeBreakRename?.();                       // test hook: the contender has judged the lock dead and has not renamed it yet
  const aside = `${lockPath}.broken-${myToken}`;
  try { await fs.rename(lockPath, aside); } catch (err) { if (err.code === 'ENOENT') return false; throw err; }
  await hooks.afterAside?.();                              // test hook: the path is EMPTY right now, whatever lock was there sits at `aside`
  const moved = await readLockDoc(aside);
  if (moved.doc && moved.doc.token === judged.token) { await fs.rm(aside, { force: true }); return true; }
  try { await fs.link(aside, lockPath); } catch { /* a newer lock exists */ }
  await fs.rm(aside, { force: true }).catch(() => {});
  return false;
}
