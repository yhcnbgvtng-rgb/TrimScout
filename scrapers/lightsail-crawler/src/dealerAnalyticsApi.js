// Dealer Analytics read endpoints on the deals API (admin page, PRs 2-3). Read-only; reads the tables the nightly job fills
// (scripts/box/dealer-analytics-nightly.mjs, docs/DEALER_ANALYTICS_NIGHTLY.md): dealer_daily_summary, dealer_price_changes,
// market_price_daily, dealer_analytics_runs — plus per-dealer reads of dealer_inventory.
//
//   GET /api/inventory/dealer-analytics/dealers[?includeBuckets=1&day=YYYY-MM-DD]
//   GET /api/inventory/dealer-analytics/dealers/:id[?limit=&offset=&direction=all|drop|increase&day=]
//   GET /api/inventory/dealer-analytics/dealers/:id/market[?day=]
//
// Rules this module keeps (each is a test):
//  - every payload goes through a stable-cache instance (stale-while-revalidate, NOT cleared by upserts; see stableCache.js). The cache key
//    carries the finished run's identity, so a new nightly run is picked up at once without waiting for a TTL.
//  - the table endpoint reads precomputed rows only; nothing here GROUP BYs the whole of dealer_inventory. Every dealer_inventory statement
//    is keyed by dealer_id (or is the single-row-per-VIN join of the change log).
//  - every statement is a read, runs under the caller's statement cap, and a missing table or no finished run is a 503 "not built yet".
//
// Pure of the server: `query(sql, args) -> rows` and `cache(key, compute)` are injected (the server wires the real pool and a stable cache).

export class DealerAnalyticsError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "DealerAnalyticsError";
    this.status = status;
  }
}
const badRequest = (m) => new DealerAnalyticsError(400, m);
const notFound = (m) => new DealerAnalyticsError(404, m);
const notBuilt = (m) => new DealerAnalyticsError(503, m || "Dealer analytics has not been built yet — the nightly job has not finished a run.");

export const ROUTE_PREFIX = "/api/inventory/dealer-analytics/";
export const LIMITS = Object.freeze({ logDefault: 50, logMax: 200, offsetMax: 10_000, trendDays: 90, mixModelsMax: 300, minMarketDealers: 3, runMemoMs: 60_000 });

/** Same extraction as brandsFromNotes in lib/crawlSheet.ts (the Crawl page's Dealers tab); the web layer adds the name-derived fallback. */
export function brandTagsFromNotes(notes) {
  if (!notes) return [];
  return Array.from(new Set(Array.from(String(notes).matchAll(/Brand:\s*([A-Za-z][A-Za-z -]*?)\s*(?:\||$)/g)).map((m) => m[1].trim()))).filter(Boolean);
}

export function matchDealerAnalyticsRoute(method, pathname) {
  if (method !== "GET" || !pathname.startsWith(ROUTE_PREFIX)) return null;
  const rest = pathname.slice(ROUTE_PREFIX.length);
  if (rest === "dealers") return { kind: "dealers" };
  let m = /^dealers\/([^/]+)$/.exec(rest);
  if (m) return { kind: "dealer", id: m[1] };
  m = /^dealers\/([^/]+)\/market$/.exec(rest);
  if (m) return { kind: "market", id: m[1] };
  return null;
}

// ---- input validation ------------------------------------------------------------------------------------------------
export function parseDealerId(raw) {
  if (!/^[1-9]\d{0,8}$/.test(String(raw))) throw badRequest("A dealer id is a positive whole number.");
  return Number(raw);
}
function parseBool(params, key) {
  const v = params.get(key);
  if (v == null || v === "" || v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  throw badRequest(`${key} must be 1 or 0.`);
}
function parseDay(params) {
  const v = params.get("day");
  if (v == null || v === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw badRequest("day must be YYYY-MM-DD.");
  return v;
}
function parseIntParam(params, key, { min, max, fallback }) {
  const v = params.get(key);
  if (v == null || v === "") return fallback;
  if (!/^\d{1,6}$/.test(v) || Number(v) < min || Number(v) > max) throw badRequest(`${key} must be a whole number from ${min} to ${max}.`);
  return Number(v);
}
export const DIRECTIONS = ["all", "drop", "increase"];
function parseDirection(params) {
  const v = params.get("direction");
  if (v == null || v === "") return "all";
  if (!DIRECTIONS.includes(v)) throw badRequest(`direction must be one of ${DIRECTIONS.join(", ")}.`);
  return v;
}

// ---- helpers ------------------------------------------------------------------------------------------------------------
const n = (v) => (v == null ? null : Number(v));
const n0 = (v) => (v == null ? 0 : Number(v));
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const isMissingTable = (err) => Boolean(err) && (err.errno === 1146 || err.code === "ER_NO_SUCH_TABLE");
const isStatementTimeout = (err) => Boolean(err) && (err.errno === 1969 || err.code === "ER_STATEMENT_TIMEOUT");
const addDays = (ymd, days) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

export function createDealerAnalyticsApi({ query, cache, now = () => Date.now() }) {
  // Every statement goes through here: a read of a missing table is "not built yet"; a statement killed by the cap says so.
  const q = async (sql, args = []) => {
    try {
      return await query(sql, args);
    } catch (err) {
      if (isMissingTable(err)) throw notBuilt();
      if (isStatementTimeout(err)) throw new DealerAnalyticsError(503, "Dealer analytics took too long and was stopped — try again in a moment.");
      throw err;
    }
  };

  // The newest finished run (or the finished run of a requested day). 60 s memo: one tiny PK-range read, not one per request.
  const runMemo = new Map();
  async function finishedRun(day) {
    const memoKey = day || "latest";
    const hit = runMemo.get(memoKey);
    if (hit && now() - hit.at < LIMITS.runMemoMs) return hit.run;
    const rows = await q(
      `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, UNIX_TIMESTAMP(finished_at) AS finished_epoch FROM dealer_analytics_runs WHERE status = 'ok'${day ? " AND day = ?" : ""} ORDER BY day DESC, finished_at DESC LIMIT 1`,
      day ? [day] : [],
    );
    if (!rows.length) {
      if (day) throw notFound(`No finished dealer analytics run for ${day}.`);
      throw notBuilt();
    }
    const run = { day: rows[0].day, asOf: new Date(Number(rows[0].finished_epoch) * 1000).toISOString() };
    run.key = `${run.day}@${rows[0].finished_epoch}`;
    runMemo.set(memoKey, { at: now(), run });
    return run;
  }

  // ---- GET /dealers ---------------------------------------------------------------------------------------------------------
  async function dealersTable(run, includeBuckets) {
    return cache(`da:dealers:${run.key}:${includeBuckets ? "all" : "nobuckets"}`, async () => {
      const rows = await q(
        `SELECT s.dealer_id, c.dealer_name, c.city, c.state, CASE WHEN c.notes LIKE '%Brand:%' THEN c.notes END AS brand_notes,
           s.active_units, s.make_count, s.is_group_bucket, s.new_units, s.used_units, s.priced_units, s.avg_price, s.avg_dom,
           s.added_7d, s.removed_7d, s.drop_units_7d, s.drop_units_30d, s.avg_drop_usd_7d, s.avg_drop_pct_7d, s.avg_drop_usd_30d, s.avg_drop_pct_30d
         FROM dealer_daily_summary s LEFT JOIN dealership_contacts c ON c.id = s.dealer_id
         WHERE s.day = ?${includeBuckets ? "" : " AND s.is_group_bucket = 0"}
         ORDER BY s.active_units DESC, s.dealer_id`,
        [run.day],
      );
      const [{ buckets }] = await q("SELECT COUNT(*) AS buckets FROM dealer_daily_summary WHERE day = ? AND is_group_bucket = 1", [run.day]);
      return {
        day: run.day,
        asOf: run.asOf,
        includeBuckets,
        bucketCount: n0(buckets),
        hiddenBuckets: includeBuckets ? 0 : n0(buckets),
        dealers: rows.map((r) => ({
          dealerId: Number(r.dealer_id),
          dealerName: r.dealer_name || `Dealer ${r.dealer_id}`,
          city: r.city || null,
          state: r.state || null,
          brandTags: brandTagsFromNotes(r.brand_notes),
          isGroupBucket: Boolean(Number(r.is_group_bucket)),
          makeCount: n0(r.make_count),
          activeUnits: n0(r.active_units),
          newUnits: n0(r.new_units),
          usedUnits: n0(r.used_units),
          pricedUnits: n0(r.priced_units),
          avgPrice: n(r.avg_price),
          avgDom: n(r.avg_dom),
          added7d: n0(r.added_7d),
          removed7d: n0(r.removed_7d),
          dropUnits7d: n0(r.drop_units_7d),
          dropUnits30d: n0(r.drop_units_30d),
          avgDropUsd7d: n(r.avg_drop_usd_7d),
          avgDropPct7d: n(r.avg_drop_pct_7d),
          avgDropUsd30d: n(r.avg_drop_usd_30d),
          avgDropPct30d: n(r.avg_drop_pct_30d),
        })),
      };
    });
  }

  // ---- GET /dealers/:id -----------------------------------------------------------------------------------------------------
  async function dealerHeader(id) {
    const rows = await q("SELECT id, dealer_name, city, state, notes FROM dealership_contacts WHERE id = ?", [id]);
    return rows[0] || null;
  }

  async function dealerView(run, id) {
    return cache(`da:dealer:${run.key}:${id}`, async () => {
      const header = await dealerHeader(id);
      const since = addDays(run.day, -LIMITS.trendDays);
      const trendRows = await q(
        `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, active_units, new_units, used_units, avg_price, added_units, removed_units
         FROM dealer_daily_summary WHERE dealer_id = ? AND day > ? AND day <= ? ORDER BY day`,
        [id, since, run.day],
      );
      const [latest] = await q(
        `SELECT is_group_bucket, make_count, active_units, new_units, used_units, priced_units, avg_price, avg_dom, age_0_30, age_31_60, age_61_90, age_90_plus,
           added_7d, removed_7d, drop_units_7d, drop_units_30d, avg_drop_usd_7d, avg_drop_pct_7d, avg_drop_usd_30d, avg_drop_pct_30d
         FROM dealer_daily_summary WHERE dealer_id = ? AND day = ?`,
        [id, run.day],
      );
      if (!header && !trendRows.length && !latest) throw notFound("No such dealer.");
      // Live and per dealer: a few hundred to a few thousand rows of one dealer_id (the largest non-bucket dealers are under 1,500 units).
      const mixRows = await q(
        "SELECT make, model, COUNT(*) AS units, ROUND(AVG(CASE WHEN price > 0 THEN price END)) AS avg_price FROM dealer_inventory WHERE dealer_id = ? AND removed_at IS NULL GROUP BY make, model",
        [id],
      );
      const makeTotals = new Map();
      for (const r of mixRows) makeTotals.set(r.make || "Unknown", (makeTotals.get(r.make || "Unknown") || 0) + Number(r.units));
      const makes = [...makeTotals].map(([make, units]) => ({ make, units })).sort((a, b) => b.units - a.units || a.make.localeCompare(b.make));
      const models = mixRows
        .map((r) => ({ make: r.make || "Unknown", model: r.model || "Unknown", units: Number(r.units), avgPrice: n(r.avg_price) }))
        .sort((a, b) => b.units - a.units || a.make.localeCompare(b.make) || a.model.localeCompare(b.model))
        .slice(0, LIMITS.mixModelsMax);
      return {
        day: run.day,
        asOf: run.asOf,
        dealer: header
          ? { dealerId: id, dealerName: header.dealer_name, city: header.city || null, state: header.state || null, brandTags: brandTagsFromNotes(header.notes) }
          : { dealerId: id, dealerName: `Dealer ${id}`, city: null, state: null, brandTags: [] },
        isGroupBucket: latest ? Boolean(Number(latest.is_group_bucket)) : false,
        summary: latest
          ? {
              makeCount: n0(latest.make_count), activeUnits: n0(latest.active_units), newUnits: n0(latest.new_units), usedUnits: n0(latest.used_units), pricedUnits: n0(latest.priced_units),
              avgPrice: n(latest.avg_price), avgDom: n(latest.avg_dom), added7d: n0(latest.added_7d), removed7d: n0(latest.removed_7d),
              dropUnits7d: n0(latest.drop_units_7d), dropUnits30d: n0(latest.drop_units_30d), avgDropUsd7d: n(latest.avg_drop_usd_7d), avgDropPct7d: n(latest.avg_drop_pct_7d),
              avgDropUsd30d: n(latest.avg_drop_usd_30d), avgDropPct30d: n(latest.avg_drop_pct_30d),
            }
          : null,
        ageBuckets: latest
          ? [
              { bucket: "0-30", units: n0(latest.age_0_30) },
              { bucket: "31-60", units: n0(latest.age_31_60) },
              { bucket: "61-90", units: n0(latest.age_61_90) },
              { bucket: "90+", units: n0(latest.age_90_plus) },
            ]
          : null,
        trend: trendRows.map((r) => ({ day: r.day, activeUnits: n0(r.active_units), newUnits: n0(r.new_units), usedUnits: n0(r.used_units), avgPrice: n(r.avg_price), addedUnits: n0(r.added_units), removedUnits: n0(r.removed_units) })),
        mix: { makes, models, modelsTruncated: mixRows.length > models.length },
      };
    });
  }

  async function priceChangeLog(run, id, { limit, offset, direction }) {
    return cache(`da:log:${run.key}:${id}:${direction}:${limit}:${offset}`, async () => {
      const dirSql = direction === "drop" ? " AND p.new_price < p.old_price" : direction === "increase" ? " AND p.new_price > p.old_price" : "";
      const [{ total }] = await q(`SELECT COUNT(*) AS total FROM dealer_price_changes p WHERE p.dealer_id = ?${dirSql}`, [id]);
      const rows = await q(
        `SELECT DATE_FORMAT(p.changed_on, '%Y-%m-%d') AS changed_on, p.vin, p.old_price, p.new_price, i.year, i.make, i.model, i.trim, i.cond, i.vdp_url, (i.removed_at IS NULL) AS active
         FROM dealer_price_changes p LEFT JOIN dealer_inventory i ON i.vin = p.vin AND i.dealer_id = p.dealer_id
         WHERE p.dealer_id = ?${dirSql} ORDER BY p.changed_on DESC, p.vin LIMIT ? OFFSET ?`,
        [id, limit, offset],
      );
      return {
        total: n0(total),
        limit,
        offset,
        direction,
        changes: rows.map((r) => {
          const oldPrice = Number(r.old_price), newPrice = Number(r.new_price);
          return {
            vin: r.vin,
            changedOn: r.changed_on,
            oldPrice,
            newPrice,
            deltaUsd: newPrice - oldPrice,
            pctChange: oldPrice > 0 ? round2(((newPrice - oldPrice) / oldPrice) * 100) : null,
            year: n(r.year),
            make: r.make || null,
            model: r.model || null,
            trim: r.trim || null,
            condition: r.cond || null,
            vdpUrl: r.vdp_url || null,
            inStock: r.active == null ? null : Boolean(Number(r.active)),
          };
        }),
      };
    });
  }

  // ---- GET /dealers/:id/market ------------------------------------------------------------------------------------------------
  async function marketView(run, id) {
    return cache(`da:market:${run.key}:${id}`, async () => {
      const header = await dealerHeader(id);
      const own = await q(
        `SELECT make, model, year, cond, COUNT(*) AS units, ROUND(AVG(price)) AS avg_price FROM dealer_inventory
         WHERE dealer_id = ? AND removed_at IS NULL AND price >= 1000 AND make IS NOT NULL AND model IS NOT NULL AND year IS NOT NULL AND cond IS NOT NULL
         GROUP BY make, model, year, cond`,
        [id],
      );
      if (!header && !own.length) {
        const [any] = await q("SELECT dealer_id FROM dealer_daily_summary WHERE dealer_id = ? AND day = ? LIMIT 1", [id, run.day]);
        if (!any) throw notFound("No such dealer.");
      }
      const makes = [...new Set(own.map((r) => r.make))];
      const marketRows = makes.length ? await q("SELECT make, model, year, cond, units, dealers, avg_price FROM market_price_daily WHERE day = ? AND make IN (?)", [run.day, makes]) : [];
      const key = (r) => `${r.make}\u0000${r.model}\u0000${Number(r.year)}\u0000${r.cond}`;
      const market = new Map(marketRows.map((r) => [key(r), r]));
      let cmpUnits = 0, cmpDealerSum = 0, cmpMarketSum = 0;
      const rows = own
        .map((r) => {
          const m = market.get(key(r));
          const avgPrice = Number(r.avg_price);
          const marketAvg = m ? Number(m.avg_price) : null;
          const marketDealers = m ? Number(m.dealers) : 0;
          const thinMarket = marketDealers < LIMITS.minMarketDealers;
          const deltaUsd = marketAvg == null ? null : avgPrice - marketAvg;
          if (marketAvg != null && !thinMarket) { cmpUnits += Number(r.units); cmpDealerSum += Number(r.units) * avgPrice; cmpMarketSum += Number(r.units) * marketAvg; }
          return {
            make: r.make, model: r.model, year: Number(r.year), condition: r.cond, units: Number(r.units), avgPrice,
            marketUnits: m ? Number(m.units) : null, marketDealers, marketAvgPrice: marketAvg,
            deltaUsd, deltaPct: marketAvg ? round2(((avgPrice - marketAvg) / marketAvg) * 100) : null, thinMarket,
          };
        })
        .sort((a, b) => b.units - a.units || a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || b.year - a.year);
      return {
        day: run.day,
        asOf: run.asOf,
        dealerId: id,
        // The market average is across every dealer in the sample, this one included.
        marketIncludesDealer: true,
        minMarketDealers: LIMITS.minMarketDealers,
        overall: { comparableUnits: cmpUnits, weightedDeltaPct: cmpMarketSum > 0 ? round1(((cmpDealerSum - cmpMarketSum) / cmpMarketSum) * 100) : null },
        rows,
      };
    });
  }

  /** Returns {status, body}; never throws for the known states (400/404/503). Unknown errors propagate to the server's 500 handler. */
  async function handle(match, params) {
    try {
      if (match.kind === "dealers") {
        const includeBuckets = parseBool(params, "includeBuckets");
        const day = parseDay(params);
        return { status: 200, body: await dealersTable(await finishedRun(day), includeBuckets) };
      }
      const id = parseDealerId(match.id);
      const day = parseDay(params);
      if (match.kind === "market") return { status: 200, body: await marketView(await finishedRun(day), id) };
      const log = { limit: parseIntParam(params, "limit", { min: 1, max: LIMITS.logMax, fallback: LIMITS.logDefault }), offset: parseIntParam(params, "offset", { min: 0, max: LIMITS.offsetMax, fallback: 0 }), direction: parseDirection(params) };
      const run = await finishedRun(day);
      const [view, changes] = await Promise.all([dealerView(run, id), priceChangeLog(run, id, log)]);
      return { status: 200, body: { ...view, priceChanges: changes } };
    } catch (err) {
      if (err instanceof DealerAnalyticsError) return { status: err.status, body: { error: err.message } };
      throw err;
    }
  }

  return { handle };
}
