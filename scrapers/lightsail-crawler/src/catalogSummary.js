// "All makes" option and color summary behind GET /api/inventory/catalog with no make/model/trim.
//
// That request used to GROUP BY canonical_key over all of inv_option_facets (3M rows, no usable index: 30s+ on box2, never cached).
// The rebuild already holds every make's aggregate in memory, so it folds them into this accumulator and writes the result (a few
// hundred rows) to inv_option_summary / inv_color_summary; the handler reads those, and only falls back to the old query if the
// summary is missing or empty.

// Mirrors the old query: SUM(vehicle_count) per canonical_key, HAVING SUM >= minVehicles, ORDER BY SUM DESC, LIMIT 400. MIN(label) is
// compared case-insensitively to follow the table's utf8mb4_general_ci collation.
export const SUMMARY_OPTION_LIMIT = 400;

// The summary tables' primary keys use the default utf8mb4_general_ci collation (case-, accent- and trailing-space-insensitive), so
// two values that differ only that way are ONE key there; folding them here keeps the INSERT from hitting 'Duplicate entry'
// (box2 2026-10-10: ext '01g3' vs '01G3').
export const ciKey = (v) => String(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+$/, "");

export function createSummaryAccumulator() {
  const options = new Map(); // ciKey(canonical_key) -> { key, label, count }
  const exterior = new Map(); // ciKey(color) -> first-seen spelling
  const interior = new Map();
  return {
    addOptions(rows) {
      for (const r of rows) {
        const key = ciKey(r.canonical_key), n = Number(r.n);
        const cur = options.get(key);
        if (!cur) options.set(key, { key: r.canonical_key, label: r.label, count: n });
        else {
          cur.count += n;
          if (String(r.label).toLowerCase() < String(cur.label).toLowerCase()) cur.label = r.label;
        }
      }
    },
    addColors(rows) {
      for (const r of rows) {
        if (r.ext && !exterior.has(ciKey(r.ext))) exterior.set(ciKey(r.ext), r.ext);
        if (r.intr && !interior.has(ciKey(r.intr))) interior.set(ciKey(r.intr), r.intr);
      }
    },
    result({ minVehicles, limit = SUMMARY_OPTION_LIMIT }) {
      const optionRows = [...options.entries()]
        .filter(([, v]) => v.count >= minVehicles)
        .sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))
        .slice(0, limit)
        .map(([, v]) => [v.key, v.label, v.count]);
      const colorRows = [...[...exterior.values()].sort().map((c) => ["ext", c]), ...[...interior.values()].sort().map((c) => ["int", c])];
      return { optionRows, colorRows };
    },
  };
}

// Shape the handler's existing code expects from its two queries.
export function summaryToQueryRows({ options, colors }) {
  return {
    optionRows: options.map((r) => ({ canonical_key: r.canonical_key, label: r.label, vehicleCount: Number(r.vehicle_count) })),
    colorRows: colors.map((r) => (r.kind === "ext" ? { exterior_color: r.color, interior_color: null } : { exterior_color: null, interior_color: r.color })),
  };
}
