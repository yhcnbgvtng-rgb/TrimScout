// The pure parts of scripts/box/2026-10-28-make-from-vin-fix.mjs: which stored makes the VIN contradicts and names a replacement for, the backup line, and the
// keyset apply loop. No database, no disk. Uses the same reconcileMake the crawler and the deals-API write path use (scrapers/lightsail-crawler/src/vinWmi.js).
//
// What is fixed: the RULES below (wmi-conflict from the first version; model-conflict, wmi-fill and model-fill added after the 2026-10-29 audit of the rows that
// version only counted). Never touched, only counted: what no rule names (see the RULES comment).
import { reconcileMake } from "../../scrapers/lightsail-crawler/src/vinWmi.js";
import { ownerMake } from "./makeModelOwner.mjs";

export const padVin = (key) => String(key ?? "").toUpperCase() + "0".repeat(Math.max(0, 17 - String(key ?? "").length)); // only characters 1-5 are ever read

// The rules, by the reconcileMake verdict they act on. `wmi-conflict` is the original fix; the other three extend it to the groups that were audited as safe.
//   wmi-conflict    stored make outside the WMI's family, the VIN names one make                          -> that make
//   model-conflict  stored make outside a SHARED WMI's family (reconcileMake: conflict-unresolved), and the model is owned by exactly one make of that family -> that make
//   wmi-fill        blank make, the VIN names one make (a single-make WMI)                                -> that make
//   model-fill      blank make on a SHARED WMI (reconcileMake: unresolved), model owned by exactly one make of the family -> that make
// What no rule touches stays COUNTED: a shared WMI with no model, a model no table entry claims (or two claim), a Stellantis line the table cannot name.
export const RULES = ["wmi-conflict", "model-conflict", "wmi-fill", "model-fill"];

/** One row (or one 5-character prefix group) -> { to, via: rule } when a rule in `rules` rewrites it, else null. */
export function makeChange({ make, vin, model }, rules = RULES) {
  const r = reconcileMake({ make: make ?? null, vin, model });
  if (r.via === "wmi-conflict") return rules.includes("wmi-conflict") && r.make && r.make !== make ? { to: r.make, via: "wmi-conflict" } : null;
  if (r.via === "wmi-fill") return rules.includes("wmi-fill") && r.make ? { to: r.make, via: "wmi-fill" } : null;
  if (r.via === "conflict-unresolved" || r.via === "unresolved") {
    const rule = r.via === "unresolved" ? "model-fill" : "model-conflict";
    const to = rules.includes(rule) ? ownerMake(vin, model) : null;
    return to && to !== make ? { to, via: rule } : null;
  }
  return null;
}

/**
 * groups: [{ p5, make, model, n }] (stored make exact, VIN characters 1-5, model).
 * Returns { total, kept, conflicts: [{ p5, make, to, via, model, n }] (largest first; the groups a rule rewrites), counted: { <verdict>: n } (what no rule touches), rowsToChange, pairs, byRule }.
 * byRule: { <rule>: { rows, groups: { 'WMI stored -> to': n } } }, the per-group dry-run counts.
 */
export function planFromGroups(groups, rules = RULES) {
  const out = { total: 0, kept: 0, conflicts: [], counted: {}, rowsToChange: 0, pairs: {}, byRule: {} };
  for (const g of groups) {
    const n = Number(g.n);
    out.total += n;
    const vin = padVin(g.p5);
    const c = makeChange({ make: g.make ?? null, vin, model: g.model ?? null }, rules);
    if (!c) {
      const r = reconcileMake({ make: g.make ?? null, vin, model: g.model ?? null });
      if (r.via === "kept") out.kept += n; else out.counted[r.via] = (out.counted[r.via] || 0) + n;
      continue;
    }
    out.conflicts.push({ p5: g.p5, make: g.make, to: c.to, via: c.via, model: g.model ?? null, n });
    out.rowsToChange += n;
    const k = `${g.make} -> ${c.to}`;
    out.pairs[k] = (out.pairs[k] || 0) + n;
    const b = (out.byRule[c.via] ||= { rows: 0, groups: {} });
    b.rows += n;
    const gk = `${String(g.p5).slice(0, 3)} ${g.make ?? "(blank)"} -> ${c.to}`;
    b.groups[gk] = (b.groups[gk] || 0) + n;
  }
  out.conflicts.sort((a, b) => b.n - a.n || (a.p5 < b.p5 ? -1 : 1));
  return out;
}

/**
 * Discovery for one VIN prefix as a primary-key walk instead of a GROUP BY: read (vin, dealer_id) in order, `chunk` rows at a time, and group in Node.
 * Every statement is bounded by the chunk size (LIMIT counts scanned rows because nothing but the key range filters them), so none can run long.
 * fetchChunk(prefix, cursor|null, n) -> rows [{ vin, dealer_id, make, model, active }] ordered by (vin, dealer_id) strictly after the cursor.
 * Returns { groups: [{ p5, make, model, n }] (the planFromGroups input), scanned, active, chunks }.
 */
export async function readPrefixByWalk({ prefix, withModel, activeOnly, splitActive = false, chunk = 5000, fetchChunk, shouldStop = () => false, onChunk = () => {} }) {
  const tally = new Map();
  let cur = null, scanned = 0, active = 0, chunks = 0;
  for (;;) {
    if (shouldStop()) throw new Error("deadline reached during discovery");
    const t = Date.now();
    const rows = await fetchChunk(prefix, cur, chunk);
    chunks++; scanned += rows.length;
    for (const r of rows) {
      const isActive = Number(r.active) === 1;
      if (isActive) active++;
      if (activeOnly && !isActive) continue;
      const make = r.make ?? null, model = withModel ? (r.model ?? null) : null, p5 = String(r.vin).slice(0, 5);
      const key = `${p5}\u0000${make}\u0000${model}${splitActive ? `\u0000${isActive}` : ""}`;
      let g = tally.get(key);
      if (!g) tally.set(key, (g = splitActive ? { p5, make, model, active: isActive, n: 0 } : { p5, make, model, n: 0 }));
      g.n++;
    }
    onChunk({ chunks, scanned, rows: rows.length, ms: Date.now() - t });
    if (rows.length < chunk) break;
    const last = rows[rows.length - 1];
    cur = { vin: last.vin, dealer_id: last.dealer_id };
  }
  return { groups: [...tally.values()], scanned, active, chunks };
}

/**
 * Apply-path read for one (p5, stored make) group as a primary-key walk: read (vin, dealer_id) in `chunk`-row steps after the cursor, whatever the make,
 * and keep the rows whose make is exactly group.make (and, with activeOnly, that are not removed) in Node, until `n` are collected or the p5 range ends.
 * Each statement is bounded by the chunk size (LIMIT counts scanned rows), so a group whose make is rare can no longer make one SELECT scan the whole range.
 * fetchChunk(p5, cursor|null, k) -> rows [{ vin, dealer_id, make, model, active }] ordered by (vin, dealer_id) strictly after the cursor.
 * Returns up to n rows [{ vin, dealer_id, make, model }] in key order, the shape applyConflicts' fetchBatch expects.
 */
export async function fetchMatching({ group, cursor, n, activeOnly, chunk = 2000, fetchChunk }) {
  const out = [];
  let cur = cursor;
  for (;;) {
    const rows = await fetchChunk(group.p5, cur, chunk);
    for (const r of rows) {
      if (activeOnly && Number(r.active) !== 1) continue;
      if (r.make !== group.make) continue;
      out.push({ vin: r.vin, dealer_id: r.dealer_id, make: r.make, model: r.model });
      if (out.length >= n) return out;
    }
    if (rows.length < chunk) return out;
    const last = rows[rows.length - 1];
    cur = { vin: last.vin, dealer_id: last.dealer_id };
  }
}

/**
 * Read-only audit of the rows NO rule rewrites although the VIN contradicts or cannot fill the make: every group whose reconcileMake verdict is
 * conflict-unresolved, unresolved or wmi-fill and that makeChange leaves alone, as { via, wmi, p5, make, model, active, n } (largest first).
 */
export function auditGroups(groups, rules = RULES) {
  const out = [];
  for (const g of groups) {
    const vin = padVin(g.p5), model = g.model ?? null;
    const r = reconcileMake({ make: g.make ?? null, vin, model });
    if (r.via === "kept" || r.via === "wmi-conflict" || makeChange({ make: g.make ?? null, vin, model }, rules)) continue;
    out.push({ via: r.via, wmi: String(g.p5).slice(0, 3), p5: g.p5, make: g.make ?? null, model, active: g.active ?? null, n: Number(g.n) });
  }
  return out.sort((a, b) => b.n - a.n);
}

/** The (p5, stored make) groups to walk: one entry per pair, so a prefix that appears under several models is read once. */
export function walkGroups(conflicts) {
  const seen = new Map();
  for (const c of conflicts) { const k = `${c.p5}|${c.make}`; if (!seen.has(k)) seen.set(k, { p5: c.p5, make: c.make, n: 0 }); seen.get(k).n += c.n; }
  return [...seen.values()].sort((a, b) => b.n - a.n || (a.p5 < b.p5 ? -1 : 1));
}

/** The UPDATE's "make is still what we read" guard: a blank (NULL) make cannot be matched with `= ?`, a text make is compared byte for byte. */
export const storedMakeGuard = (stored) => (stored == null ? { sql: "make IS NULL", params: [] } : { sql: "BINARY make = BINARY ?", params: [stored] });

export const backupLine = (row, to) => JSON.stringify({ vin: row.vin, dealer_id: row.dealer_id, model: row.model ?? null, make_before: row.make, make_after: to });
export const parseBackup = (text) => text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

/**
 * Keyset apply loop. For each (p5, make) group: read up to `batchSize` rows after the cursor (vin, dealer_id order), re-decide each row with makeChange,
 * write the before-state of the rows that change, THEN update them (the caller's updateBatch is by primary key and also requires the make to still be the
 * value that was read). The cursor moves past every row read, so a row the rule leaves alone, or one that did not update, is never read twice.
 * `limit` is a hard cap on rows changed. `shouldStop()` is checked before every batch (deadline). A thrown error ends the run: no retry.
 * fetchBatch(group, cursor, n) -> rows [{ vin, dealer_id, make, model }] ordered by (vin, dealer_id), strictly after cursor ({ vin, dealer_id } or null).
 */
export async function applyConflicts({ groups, rules = RULES, limit = Infinity, batchSize = 100, fetchBatch, writeBackup, updateBatch, sleep = async () => {}, shouldStop = () => false }) {
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
      for (const row of batch) { const c = makeChange(row, rules); if (!c) { left++; continue; } if (!byTo.has(c.to)) byTo.set(c.to, []); byTo.get(c.to).push(row); }
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
