// Multi-value facet counts for the admin Vehicles sheet's State / Make / Model / Trim dropdowns
// (GET /api/inventory/admin-facets). A separate endpoint from the buyer /search page's single-value
// GET /api/inventory/facets so that path — and its tuned cache — is untouched.
//
// Pure (URLSearchParams in, queries out) so the SQL shapes are unit-testable without a database.
//
// Scoping is DISJUNCTIVE: each dropdown's counts honour every OTHER dropdown's selection but not its own,
// so after picking FL you can still see GA's count and add it (a normal OR-within-a-field multi-select).
//   states <- makes (+ models)        makes  <- states
//   models <- makes (+ states)        trims  <- makes + models (+ states)
// Models/trims need a parent selection (nothing selective to scope them by otherwise), exactly the
// progressive-unlock rule the sheet enforces. Counts are IN-STOCK vehicles (removed_at IS NULL) because
// every query reads one of the facet covering indexes created for the buyer dropdowns; the admin sheet's
// other filters (condition, movement, toggles, search text) deliberately do NOT scope these counts — they
// aren't in those indexes, and a per-filter-combination scan is exactly what this endpoint exists to avoid.
import { multiParam } from "./inventoryListQuery.js";

const marks = (vals) => vals.map(() => "?").join(",");

export function adminFacetQueries(params) {
  const states = multiParam(params, "state", (v) => v.toUpperCase().slice(0, 2));
  const makes = multiParam(params, "make");
  const models = makes.length ? multiParam(params, "model") : [];
  const trimsParent = makes.length && models.length;

  const statesQ = makes.length
    ? {
        sql: `SELECT state, COUNT(*) AS n FROM dealer_inventory FORCE INDEX (idx_inv_facet_make_state_model) WHERE removed_at IS NULL AND make IN (${marks(makes)}) ${models.length ? `AND model IN (${marks(models)})` : ""} AND state IS NOT NULL GROUP BY state ORDER BY n DESC`,
        args: [...makes, ...models],
      }
    : { sql: "SELECT state, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND state IS NOT NULL GROUP BY state ORDER BY n DESC", args: [] };

  const makesQ = states.length
    ? {
        sql: `SELECT make, COUNT(*) AS n FROM dealer_inventory FORCE INDEX (idx_inv_facet_state_make) WHERE removed_at IS NULL AND state IN (${marks(states)}) AND make IS NOT NULL GROUP BY make ORDER BY n DESC LIMIT 100`,
        args: states,
      }
    : { sql: "SELECT make, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND make IS NOT NULL GROUP BY make ORDER BY n DESC LIMIT 100", args: [] };

  const modelsQ = makes.length
    ? {
        sql: `SELECT model, COUNT(*) AS n FROM dealer_inventory FORCE INDEX (idx_inv_facet_make_state_model) WHERE removed_at IS NULL AND make IN (${marks(makes)}) ${states.length ? `AND state IN (${marks(states)})` : ""} AND model IS NOT NULL GROUP BY model ORDER BY n DESC LIMIT 200`,
        args: [...makes, ...states],
      }
    : null;

  const trimsQ = trimsParent
    ? {
        sql: `SELECT trim, COUNT(*) AS n FROM dealer_inventory FORCE INDEX (idx_inv_facet_make_model_state_trim) WHERE removed_at IS NULL AND make IN (${marks(makes)}) AND model IN (${marks(models)}) ${states.length ? `AND state IN (${marks(states)})` : ""} AND trim IS NOT NULL GROUP BY trim ORDER BY n DESC LIMIT 200`,
        args: [...makes, ...models, ...states],
      }
    : null;

  // Sorted so the same selection in a different click order shares one cache entry.
  const k = (a) => [...a].sort().join("~");
  return { cacheKey: `admin-facets:${k(states)}|${k(makes)}|${k(models)}`, states, makes, models, queries: { states: statesQ, makes: makesQ, models: modelsQ, trims: trimsQ } };
}

/** Rows -> the response shape (same field names as the buyer facets endpoint, plus `multi: true` as a capability marker). */
export function adminFacetResponse(rows) {
  const shape = (list, key) => (list || []).map((r) => ({ [key]: r[key], n: Number(r.n) }));
  return { multi: true, states: shape(rows.states, "state"), makes: shape(rows.makes, "make"), models: shape(rows.models, "model"), trims: shape(rows.trims, "trim") };
}
