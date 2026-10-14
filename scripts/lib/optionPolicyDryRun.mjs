// Pure aggregation for the read-only option-policy dry runs (no I/O): per policy scope, how the stored option rows ("before") compare with what the
// policy keeps ("after"). Used by scripts/box/2026-10-11-ford-option-policy-dry-run.mjs.
import { optionRowsForVehicle, modelPoliciesFor } from "../../scrapers/lightsail-crawler/src/factoryOptionAllowlist.js";
import { optionRowsFromOptions } from "../../scrapers/lightsail-crawler/src/inventoryOptionRows.js";

export function newTally() {
  return { scopes: new Map(), untouched: new Map() };
}

const scopeTally = (t, scope) => {
  if (!t.scopes.has(scope)) t.scopes.set(scope, {
    vehicles: 0, rawLines: 0, genericRows: 0, storedRows: 0, storedKept: 0, storedRemoved: 0, afterRows: 0, kept: 0, rolledUp: 0, dealerAddons: 0, droppedLines: 0,
    zeroBefore: 0, zeroAfter: 0, noTrusted: 0, trusted: 0, changed: 0, untrustedTrims: new Map(), after: new Map(), afterLabels: new Map(), before: new Map(), droppedRules: new Map(), byTrim: new Map(),
  });
  return t.scopes.get(scope);
};
const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);

/**
 * @param {object} t        the tally
 * @param {object} allow    buildAllowlist(...) result
 * @param {{ vin: string, make: string, model: string, year: number, trim: string|null }} vehicle
 * @param {Array|null} options  the vehicle's options_json (array of { name, code, price, kind })
 * @param {Array<{ key: string, label: string, code?: string|null }>} stored  the vehicle's rows in dealer_inventory_options today (the "before")
 */
export function addVehicle(t, allow, vehicle, options, stored) {
  const policies = modelPoliciesFor(allow, vehicle);
  if (!policies.length) { bump(t.untouched, `${vehicle.year} ${vehicle.model}`); return null; }
  const res = optionRowsForVehicle(allow, vehicle, Array.isArray(options) ? options : []);
  const s = scopeTally(t, res.scope);
  s.vehicles++;
  s.rawLines += Array.isArray(options) ? options.length : 0;
  s.genericRows += optionRowsFromOptions(Array.isArray(options) ? options : []).rows.length;
  s.storedRows += stored.length;
  if (!stored.length) s.zeroBefore++;
  for (const r of stored) bump(s.before, `${r.key}\t${r.label}`);
  // Which stored rows would the policy keep? Resolve each stored label through the same policy for this vehicle.
  for (const r of stored) {
    const one = optionRowsForVehicle(allow, vehicle, [{ name: r.label, code: r.code || undefined }]);
    if (one.rows.length) s.storedKept++; else s.storedRemoved++;
  }
  s.afterRows += res.rows.length;
  s.kept += res.rows.filter((r) => r.via === "kept").length;
  s.rolledUp += res.rows.filter((r) => r.via === "rolled_up").length;
  s.dealerAddons += res.dealerAddons.length;
  s.droppedLines += res.dropped.length;
  for (const d of res.dropped) bump(s.droppedRules, d.rule);
  if (!res.rows.length) s.zeroAfter++;
  if (!res.trimTrusted) { s.noTrusted++; bump(s.untrustedTrims, vehicle.trim || "(blank)"); }
  else {
    // A car with a trusted trim "would change" when the option keys the policy keeps differ from the keys stored for it today.
    s.trusted++;
    const have = new Set(stored.map((r) => r.key)), want = new Set(res.rows.map((r) => r.key));
    if (have.size !== want.size || [...want].some((k) => !have.has(k))) s.changed++;
  }
  const tr = s.byTrim.get(res.trim || "(blank)") || { vehicles: 0, trusted: res.trimTrusted, zeroAfter: 0, afterRows: 0 };
  tr.vehicles++; tr.afterRows += res.rows.length; if (!res.rows.length) tr.zeroAfter++;
  s.byTrim.set(res.trim || "(blank)", tr);
  for (const r of res.rows) {
    bump(s.after, r.key);
    if (!s.afterLabels.has(r.key)) s.afterLabels.set(r.key, new Map());
    bump(s.afterLabels.get(r.key), `${r.label}\t${r.kind}`);
  }
  return res;
}

const top = (m, n = 10) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);

export function finalize(t) {
  const out = {};
  for (const [scope, s] of t.scopes) {
    out[scope] = {
      vehicles: s.vehicles, rawLinesPerVehicle: +(s.rawLines / Math.max(1, s.vehicles)).toFixed(2),
      rowsBefore: s.storedRows, rowsKept: s.storedKept, rowsRemoved: s.storedRemoved, rowsAfter: s.afterRows,
      afterKept: s.kept, afterRolledUp: s.rolledUp, dealerAddons: s.dealerAddons,
      zeroOptionsBeforePct: +(100 * s.zeroBefore / Math.max(1, s.vehicles)).toFixed(1), zeroOptionsAfterPct: +(100 * s.zeroAfter / Math.max(1, s.vehicles)).toFixed(1),
      carsTrustedTrim: s.trusted, trustedTrimPct: +(100 * s.trusted / Math.max(1, s.vehicles)).toFixed(1), carsWouldChange: s.changed,
      noTrustedTrim: s.noTrusted, topUntrustedTrims: top(s.untrustedTrims, 12),
      topBefore: top(s.before).map(([k, n]) => [k.split("\t")[1], n]),
      // Counted by option KEY (the same option can reach a policy under two spellings of its label, e.g. a hyphen vs an en dash); the commonest label is shown.
      topAfter: top(s.after).map(([key, n]) => { const [label, kind] = top(s.afterLabels.get(key), 1)[0][0].split("\t"); return { key, label, kind, vehicles: n }; }),
      droppedByRule: top(s.droppedRules, 12),
      byTrim: [...s.byTrim.entries()].map(([trim, v]) => ({ trim, ...v })).sort((a, b) => b.vehicles - a.vehicles),
    };
  }
  return { scopes: out, untouched: top(t.untouched, 40) };
}
