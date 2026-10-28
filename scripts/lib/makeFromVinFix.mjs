// The pure parts of scripts/box/2026-10-28-make-from-vin-fix.mjs: which stored makes the VIN contradicts and names a replacement for, the backup line, and the
// keyset apply loop. No database, no disk. Uses the same reconcileMake the crawler and the deals-API write path use (scrapers/lightsail-crawler/src/vinWmi.js).
//
// What is fixed: ONLY `wmi-conflict` rows (the stored make is outside the family the VIN's WMI can carry AND the VIN names exactly one make, or a Stellantis
// line code / model names it). Never touched, only counted: `conflict-unresolved` (shared WMI, needs a vPIC decode), `unresolved` and `wmi-fill` (blank make).
import { reconcileMake } from "../../scrapers/lightsail-crawler/src/vinWmi.js";

export const padVin = (key) => String(key ?? "").toUpperCase() + "0".repeat(Math.max(0, 17 - String(key ?? "").length)); // only characters 1-5 are ever read

/** One row (or one 5-character prefix group) -> the make to write, or null when this script leaves it alone. */
export function makeChange({ make, vin, model }) {
  const r = reconcileMake({ make: make ?? null, vin, model });
  return r.via === "wmi-conflict" && r.make && r.make !== make ? { to: r.make, via: r.via } : null;
}

/**
 * groups: [{ p5, make, model, n }] (stored make exact, VIN characters 1-5, model for Stellantis prefixes else null).
 * Returns { total, kept, conflicts: [{ p5, make, to, model, n }] (largest first), counted: { 'conflict-unresolved': n, unresolved: n, 'wmi-fill': n }, rowsToChange, pairs }.
 */
export function planFromGroups(groups) {
  const out = { total: 0, kept: 0, conflicts: [], counted: {}, rowsToChange: 0, pairs: {} };
  for (const g of groups) {
    const n = Number(g.n);
    out.total += n;
    const r = reconcileMake({ make: g.make ?? null, vin: padVin(g.p5), model: g.model ?? null });
    if (r.via === "kept") { out.kept += n; continue; }
    if (r.via !== "wmi-conflict") { out.counted[r.via] = (out.counted[r.via] || 0) + n; continue; }
    out.conflicts.push({ p5: g.p5, make: g.make, to: r.make, model: g.model ?? null, n });
    out.rowsToChange += n;
    const k = `${g.make} -> ${r.make}`;
    out.pairs[k] = (out.pairs[k] || 0) + n;
  }
  out.conflicts.sort((a, b) => b.n - a.n || (a.p5 < b.p5 ? -1 : 1));
  return out;
}

/** The (p5, stored make) groups to walk: one entry per pair, so a prefix that appears under several models is read once. */
export function walkGroups(conflicts) {
  const seen = new Map();
  for (const c of conflicts) { const k = `${c.p5}|${c.make}`; if (!seen.has(k)) seen.set(k, { p5: c.p5, make: c.make, n: 0 }); seen.get(k).n += c.n; }
  return [...seen.values()].sort((a, b) => b.n - a.n || (a.p5 < b.p5 ? -1 : 1));
}

export const backupLine = (row, to) => JSON.stringify({ vin: row.vin, dealer_id: row.dealer_id, model: row.model ?? null, make_before: row.make, make_after: to });
export const parseBackup = (text) => text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

/**
 * Keyset apply loop. For each (p5, make) group: read up to `batchSize` rows after the cursor (vin, dealer_id order), re-decide each row with makeChange,
 * write the before-state of the rows that change, THEN update them (the caller's updateBatch is by primary key and also requires the make to still be the
 * value that was read). The cursor moves past every row read, so a row the rule leaves alone, or one that did not update, is never read twice.
 * `limit` is a hard cap on rows changed. `shouldStop()` is checked before every batch (deadline). A thrown error ends the run: no retry.
 * fetchBatch(group, cursor, n) -> rows [{ vin, dealer_id, make, model }] ordered by (vin, dealer_id), strictly after cursor ({ vin, dealer_id } or null).
 */
export async function applyConflicts({ groups, limit = Infinity, batchSize = 100, fetchBatch, writeBackup, updateBatch, sleep = async () => {}, shouldStop = () => false }) {
  let updated = 0, skipped = 0, left = 0, read = 0, stopped = null;
  outer: for (const g of groups) {
    let cursor = null;
    for (;;) {
      if (shouldStop()) { stopped = "deadline"; break outer; }
      const room = limit - updated;
      if (room <= 0) { stopped = "limit"; break outer; }
      const batch = await fetchBatch(g, cursor, Math.min(batchSize, Math.max(room, 1)));
      if (!batch.length) break;
      read += batch.length;
      cursor = { vin: batch[batch.length - 1].vin, dealer_id: batch[batch.length - 1].dealer_id };
      const byTo = new Map();
      for (const row of batch) { const c = makeChange(row); if (!c) { left++; continue; } if (!byTo.has(c.to)) byTo.set(c.to, []); byTo.get(c.to).push(row); }
      for (const [to, rows] of byTo) {
        const take = rows.slice(0, Math.max(0, limit - updated));
        if (!take.length) continue;
        writeBackup(take, to); // before-state on disk first
        const n = await updateBatch(take, to);
        updated += n; skipped += take.length - n;
      }
      await sleep();
    }
  }
  return { updated, skipped, left, read, stopped };
}
