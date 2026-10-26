// Condition counts and a price histogram for the buyer /search chips and slider, plus colour counts, kept next to the catalog facets.
//
// Flag FACET_COND_PRICE (default OFF). Off = no table, no extra rebuild query, no extra read, and the catalog payload keeps its old shape.
// Colour counts need none of this: inv_color_facets already stores a vehicle_count per (make, model, trim, exterior, interior) that the catalog read
// used to throw away (SELECT DISTINCT). Reading it as SUM(vehicle_count) GROUP BY colour costs nothing extra.
//
// Cost control (the rebuild must not grow by more than 10%): the extra work is ONE aggregate per make over the same index range the colour aggregate
// already walks, run after it. budgetAllows() checks, before each make, that the extra time so far plus one more average make stays within
// EXTRA_BUDGET_PCT of the rest of the build; a make that would break it is skipped (its previous rows stay), the all-makes summary is then not rewritten,
// and the skip is reported on /api/inventory/catalog-facets/status so it can never go unnoticed.
//
// Pure: no database and no env reads except through arguments, so it is unit-testable (deals_api_server.js starts a server at import time).

export const PRICE_BUCKET_WIDTH = 5000;
export const PRICE_TOP = 150000;
/** Buckets 0..29 are $0-$4,999 ... $145,000-$149,999; bucket 30 is $150,000 and up (the web slider's open top end). */
export const PRICE_BUCKETS = PRICE_TOP / PRICE_BUCKET_WIDTH + 1;
/** Stored for a car with no usable price: counted in the condition totals, left out of the histogram. */
export const NO_PRICE_BUCKET = -1;
export const FACET_CONDS = ["new", "used", "cpo"];
export const MAX_EXTRA_BUDGET_PCT = 10;

const ON = /^(1|true|yes|on)$/i;
export function facetExtrasEnabled(env = process.env) {
  const raw = env.FACET_COND_PRICE;
  return raw != null && ON.test(String(raw).trim());
}

/** The budget as a percentage of the rest of the build, from FACET_EXTRA_BUDGET_PCT; never above 10, never below 1, 10 when unset or unreadable. */
export function extraBudgetPct(env = process.env) {
  const n = Number(env.FACET_EXTRA_BUDGET_PCT);
  if (!Number.isFinite(n) || n <= 0) return MAX_EXTRA_BUDGET_PCT;
  return Math.min(MAX_EXTRA_BUDGET_PCT, Math.max(1, n));
}

/** SQL for the bucket of a price column: -1 with no price, else floor(price / 5000) capped at the open top bucket. */
export const priceBucketSql = (col = "price") => `IF(${col} > 0, LEAST(FLOOR(${col} / ${PRICE_BUCKET_WIDTH}), ${PRICE_BUCKETS - 1}), ${NO_PRICE_BUCKET})`;

/**
 * The per-make aggregate. Same table, same forced index and same WHERE as the colour aggregate in rebuildCatalogFacets, so it walks the same range;
 * one placeholder: the make. Rows: model, trim, cond ('' when unknown), bucket, n.
 */
export function extraAggSql({ retailOnly, staleDays } = {}) {
  return `SELECT COALESCE(model, '') AS model, COALESCE(trim, '') AS trim, COALESCE(cond, '') AS cond, ${priceBucketSql("price")} AS bucket, COUNT(*) AS n
         FROM dealer_inventory FORCE INDEX (idx_inv_stock_make_model_trim)
         WHERE removed_at IS NULL AND make = ?${retailOnly ? " AND (cond IS NULL OR cond <> 'wholesale')" : ""}${staleDays ? ` AND last_seen_at >= DATE_SUB(NOW(), INTERVAL ${Number(staleDays)} DAY)` : ""}
         GROUP BY COALESCE(model, ''), COALESCE(trim, ''), COALESCE(cond, ''), ${priceBucketSql("price")}`;
}

/**
 * Whether the next make may run its extra query. `makesDone` makes have been rebuilt, `elapsedMs` is the wall time of the whole rebuild so far and
 * `extraMs` the part of it spent on the extra query. The first `warmup` make always runs (no average to project from yet), so the worst overshoot is that one make's extra query.
 */
export function budgetAllows({ makesDone, elapsedMs, extraMs, budgetPct = MAX_EXTRA_BUDGET_PCT, warmup = 1 }) {
  if (makesDone < warmup) return true;
  const baseMs = Math.max(1, elapsedMs - extraMs);
  const nextExtra = extraMs + extraMs / makesDone;
  const nextBase = baseMs + baseMs / makesDone;
  return nextExtra <= (budgetPct / 100) * nextBase;
}

/** Folds every make's aggregate rows into the all-makes summary the no-make catalog call reads: one row per (cond, bucket). */
export function createExtrasAccumulator() {
  const cells = new Map();
  return {
    add(rows) {
      for (const r of rows) {
        const key = `${r.cond}|${Number(r.bucket)}`;
        cells.set(key, (cells.get(key) || 0) + Number(r.n));
      }
    },
    /** [[cond, bucket, vehicle_count], ...] ready for INSERT INTO inv_price_summary. */
    rows() {
      return [...cells.entries()].map(([k, n]) => { const [cond, bucket] = k.split("|"); return [cond, Number(bucket), n]; });
    },
  };
}

const emptyHistogram = () => Array.from({ length: PRICE_BUCKETS }, () => 0);

/**
 * Rows of { cond, bucket, n } (already summed over the picked make/model/trim) -> what the catalog payload carries:
 *   conditionCounts: { new, used, cpo }                 every car, priced or not
 *   priceHistogram:  { width, top, all, new, used, cpo } 31 counts each; `all` includes cars of unknown condition
 * Returns null when there are no rows (nothing to say, so the web app shows no sparkline).
 */
export function foldExtras(rows) {
  if (!rows || !rows.length) return null;
  const conditionCounts = { new: 0, used: 0, cpo: 0 };
  const hist = { all: emptyHistogram(), new: emptyHistogram(), used: emptyHistogram(), cpo: emptyHistogram() };
  for (const r of rows) {
    const n = Number(r.n), bucket = Number(r.bucket), cond = String(r.cond || "");
    if (FACET_CONDS.includes(cond)) conditionCounts[cond] += n;
    if (bucket >= 0 && bucket < PRICE_BUCKETS) {
      hist.all[bucket] += n;
      if (FACET_CONDS.includes(cond)) hist[cond][bucket] += n;
    }
  }
  return { conditionCounts, priceHistogram: { width: PRICE_BUCKET_WIDTH, top: PRICE_TOP, ...hist } };
}

// The summary tables' keys use utf8mb4_general_ci, so colours that differ only by case/accents are one key there; fold the same way here.
const ciKey = (v) => String(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+$/, "");

/**
 * Rows of { exterior_color, interior_color, n } -> { exteriorColorCounts, interiorColorCounts }, each [{ color, n }] by count desc then name.
 * Blank colours are left out; spellings that differ only by case are merged under the first spelling seen. Rows without n yield no counts (null).
 */
export function colorCountsFrom(rows) {
  if (!rows || !rows.length || !rows.some((r) => r.n != null)) return null;
  const tally = (field) => {
    const m = new Map();
    for (const r of rows) {
      const c = r[field];
      if (!c) continue;
      const k = ciKey(c), cur = m.get(k);
      if (cur) cur.n += Number(r.n); else m.set(k, { color: c, n: Number(r.n) });
    }
    return [...m.values()].filter((x) => x.n > 0).sort((a, b) => b.n - a.n || (a.color < b.color ? -1 : 1));
  };
  return { exteriorColorCounts: tally("exterior_color"), interiorColorCounts: tally("interior_color") };
}
