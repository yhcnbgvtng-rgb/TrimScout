// The rule behind scripts/box/2026-10-24-make-wmi-reclean.mjs: which stored makes the VIN contradicts, decided per (make, model, VIN characters 1-5)
// group so the database is only ever asked for counts. Uses the same reconcileMake the crawler and the deals-API write path use, so the dry run
// reports exactly what the code fix would write. No VIN is kept: a group key is five characters (WMI + line code), never a whole VIN.
import { reconcileMake } from "../../scrapers/lightsail-crawler/src/vinWmi.js";

export const padVin = (key) => String(key ?? "").toUpperCase() + "0".repeat(Math.max(0, 17 - String(key ?? "").length)); // a VIN-shaped string: only characters 1-5 are ever read
const CONFLICT = new Set(["wmi-conflict", "vpic-conflict", "conflict-unresolved"]);

/** What reconcileMake does with a stored make on a car whose VIN starts with `key` (5 characters). */
export function classifyGroup({ make, key, model }) {
  const r = reconcileMake({ make, vin: padVin(key), model });
  return { next: r.make, via: r.via };
}
export const isConflict = (via) => CONFLICT.has(via);

/**
 * groups: [{ model, key, n }] for one stored make. Returns counts only:
 *   rowsChecked, rowsAgree (kept), rowsConflict (VIN contradicts the stored make), rowsToMake (conflict with a make the VIN names), rowsToNull
 *   (conflict the VIN cannot name: shared WMI, needs a vPIC decode), byTarget (make -> rows), byWmiTarget ("WMI>make" -> rows, top 80), conflictGroups (largest first, capped).
 */
export function summarizeGroups(make, groups, { top = 30 } = {}) {
  const s = { make, rowsChecked: 0, rowsAgree: 0, rowsConflict: 0, rowsToMake: 0, rowsToNull: 0, byTarget: {}, byVia: {}, byWmiTarget: {}, conflictGroups: [], unresolvedGroups: [] };
  for (const g of groups) {
    const n = Number(g.n);
    s.rowsChecked += n;
    const c = classifyGroup({ make, key: g.key, model: g.model });
    if (!isConflict(c.via)) { s.rowsAgree += n; continue; }
    s.rowsConflict += n; s.byVia[c.via] = (s.byVia[c.via] || 0) + n;
    if (c.next) { s.rowsToMake += n; s.byTarget[c.next] = (s.byTarget[c.next] || 0) + n; } else { s.rowsToNull += n; s.byTarget["(null: shared WMI)"] = (s.byTarget["(null: shared WMI)"] || 0) + n; }
    const wk = `${String(g.key).slice(0, 3)}>${c.next ?? 'null'}`; s.byWmiTarget[wk] = (s.byWmiTarget[wk] || 0) + n; // complete (not capped): the odd-pair review reads this
    s.conflictGroups.push({ model: g.model, key: g.key, to: c.next, via: c.via, rows: n });
    if (!c.next) s.unresolvedGroups.push({ model: g.model, key: g.key, n }); // shared WMI: the vPIC step decodes these
  }
  s.conflictGroups.sort((a, b) => b.rows - a.rows || (a.key < b.key ? -1 : 1));
  s.conflictGroups = s.conflictGroups.slice(0, top);
  s.byWmiTarget = Object.fromEntries(Object.entries(s.byWmiTarget).sort((a, b) => b[1] - a[1]).slice(0, 80));
  return s;
}

/**
 * The shared-WMI conflict rows (the ones summarizeGroups sends to null) with a vPIC make for their 8-character prefix.
 * subgroups: [{ model, key8, n }] (the unresolved groups split by VIN characters 1-8); decoded: { key8: vPIC make | "" }.
 * A make vPIC names that is inside the WMI's family is used; anything else (no answer, "", a make outside the family) leaves null.
 */
export function summarizeVpic(make, subgroups, decoded) {
  const s = { make, rowsChecked: 0, rowsResolved: 0, rowsStillNull: 0, rowsNotDecoded: 0, byTarget: {}, stillNullByWmi: {} };
  for (const g of subgroups) {
    const n = Number(g.n); s.rowsChecked += n;
    const has = Object.hasOwn(decoded, g.key8);
    const r = reconcileMake({ make, vin: padVin(g.key8), model: g.model, vpicMake: has ? decoded[g.key8] : null });
    if (r.make) { s.rowsResolved += n; s.byTarget[r.make] = (s.byTarget[r.make] || 0) + n; continue; }
    s.rowsStillNull += n; if (!has) s.rowsNotDecoded += n;
    const w = String(g.key8).slice(0, 3); s.stillNullByWmi[w] = (s.stillNullByWmi[w] || 0) + n;
  }
  return s;
}

/** Blank-make rows (make NULL or ''): not a disagreement, reported separately: how many the VIN would fill. */
export function summarizeBlank(groups) {
  const s = { rowsChecked: 0, rowsFilledFromVin: 0, rowsStayBlank: 0, byTarget: {}, unresolvedGroups: [] };
  for (const g of groups) {
    const n = Number(g.n); s.rowsChecked += n;
    const c = classifyGroup({ make: null, key: g.key, model: g.model });
    if (c.next) { s.rowsFilledFromVin += n; s.byTarget[c.next] = (s.byTarget[c.next] || 0) + n; } else { s.rowsStayBlank += n; if (c.via === "unresolved") s.unresolvedGroups.push({ key: g.key, n }); } // "unresolved" = the WMI is known but shared: the vPIC step decodes these (an unknown WMI stays blank)
  }
  return s;
}
