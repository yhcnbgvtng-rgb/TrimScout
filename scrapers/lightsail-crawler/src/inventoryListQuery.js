// The filter/sort shared by GET /api/inventory (one page) and GET /api/inventory/export (the whole
// filter, streamed): returns the FROM/WHERE clause, its args and the ORDER BY.
//
// Pulled out of deals_api_server.js into its own module specifically so this can be unit-tested
// without a live DB connection or starting the real server: deals_api_server.js runs
// server.listen() unconditionally at import time (no "am I the main module" guard, unlike the
// operator-run scripts elsewhere in this package), so importing it anywhere else opens a real
// port and hangs. This function needs none of that — it's pure (URLSearchParams in, {sql, args,
// orderBy} out) — and it has earned real test coverage: this exact query-plan logic has broken in
// production six times across two days (five combinations on 2026-09-22, one more on 2026-09-25),
// always the same shape — a filter combination the hand-tuned index hints didn't cover, found live
// during an outage.
/** Distinct, trimmed, non-empty values of a (possibly repeated) query param, capped so a hostile URL can't build a huge IN list. */
export const MAX_MULTI_VALUES = 25;
export function multiParam(params, key, normalize = (v) => v) {
  const seen = new Set();
  for (const raw of params.getAll(key)) {
    const v = normalize(String(raw).trim());
    if (v) seen.add(v);
    if (seen.size >= MAX_MULTI_VALUES) break;
  }
  return [...seen];
}

/**
 * The CSV export's default sort, matching the list view's fast plan. State + Make without a Model, in
 * stock, has no fast plan under the default dealer:asc order (the box walks the whole state in dealer
 * order: NJ in-stock Porsche, 523 rows, took 52s to stream on 2026-10-04, and the list view 503s at its
 * 20s cap), but sort=model reads idx_inv_facet_make_state_model in index order (see indexHint below).
 * The admin Next route already swaps its own default for this shape (adminListSort in lib/inventoryApi.ts);
 * this does the same for a caller of the box endpoint directly, so an export never depends on which client
 * asked. Only an UNCHOSEN sort (none, or the dealer:asc default) is swapped; an explicit sort is left alone.
 * Same preconditions as the index hint: inStock=1, no dealerId, a state and a make, no model.
 * Returns the same params object when nothing changes, else a copy with sort=model:asc.
 */
export function withExportFastSort(params) {
  const sort = (params.get("sort") || "").trim();
  if (sort && sort !== "dealer:asc") return params;
  const fast =
    (params.get("inStock") || "").trim() === "1" &&
    !(params.get("dealerId") || "").trim() &&
    multiParam(params, "state").length > 0 &&
    multiParam(params, "make").length > 0 &&
    multiParam(params, "model").length === 0;
  if (!fast) return params;
  const next = new URLSearchParams(params);
  next.set("sort", "model:asc");
  return next;
}

// Sorting by the "Contact on file" column: 1 = the dealership has a contact email, 0 = it has a directory row but no email,
// NULL = no directory row (unknown). Same meaning as lib/dealerContactIndex.ts. Reads the d join, so the page query keeps it.
const CONTACT_SORT_EXPR = "(CASE WHEN d.id IS NULL THEN NULL WHEN d.contact_email IS NOT NULL AND TRIM(d.contact_email) <> '' THEN 1 ELSE 0 END)";
// Columns whose "blank" includes the empty string; the rest (numbers, the contact flag) are blank only when NULL.
const TEXT_SORT_COLUMNS = new Set(["i.dealer_name", "i.make", "i.model", "i.trim", "i.vin", "i.exterior_color", "i.interior_color", "i.state", "i.vdp_url"]);

const STATE_PAGE_HINT = "FORCE INDEX (idx_inv_stock_state)";
const STATE_MAKE_COUNT_HINT = "FORCE INDEX (idx_inv_facet_state_make)";

export function inventoryListQuery(params) {
  const where = [], args = [];
  const p = (k) => (params.get(k) || "").trim();
  // state/make/model/trim/cond accept REPEATED params (state=FL&state=GA): OR within a field, AND across
  // fields. Repeated params, not a comma list — trims legitimately contain commas. One value keeps the exact
  // `col = ?` SQL every index hint below was tuned against; several become `col IN (...)`.
  const states = multiParam(params, "state", (v) => v.toUpperCase());
  const makes = multiParam(params, "make");
  const models = multiParam(params, "model");
  const trims = multiParam(params, "trim");
  const conds = multiParam(params, "cond");
  const addIn = (col, vals) => {
    if (vals.length === 1) { where.push(`${col} = ?`); args.push(vals[0]); }
    else if (vals.length) { where.push(`${col} IN (${vals.map(() => "?").join(",")})`); args.push(...vals); }
  };
  if (p("dealerId")) { where.push("i.dealer_id = ?"); args.push(Number(p("dealerId"))); }
  addIn("i.state", states);
  addIn("i.make", makes);
  addIn("i.model", models);
  addIn("i.trim", trims);
  addIn("i.cond", conds);
  // retailOnly=1 (sent by the buyer search only, never by the admin sheet): a dealer's wholesale lot is not retail stock a buyer can
  // request a quote on — e.g. Mercedes-Benz of Coconut Creek lists 2,142 cars with cond 'wholesale' next to its 745 retail ones. The rows
  // stay in the table (the admin Vehicles tab still shows them); this only keeps them out of buyer results. A NULL cond is kept (unknown is
  // not wholesale). Added as a plain post-filter so every index choice and hint below is unchanged.
  if (p("retailOnly") === "1") where.push("(i.cond IS NULL OR i.cond <> 'wholesale')");
  if (p("inStock") === "1") where.push("i.removed_at IS NULL");
  if (p("changeType")) { where.push("i.change_type = ?"); args.push(p("changeType").toUpperCase()); }
  if (p("priceChange") === "drop") where.push("i.price_diff < 0");
  if (p("priceChange") === "increase") where.push("i.price_diff > 0");
  // Admin "Sold" movement filter — a vehicle the crawler no longer finds on the dealer's own
  // site. Never a confirmed sale (same "left lots" disclaimer as Market Pulse's computeMarketPulse
  // in deals_api_server.js — this is admin inventory-movement language, never shown to buyers).
  // There is no crawl run-id anywhere in this schema (confirmed live 2026-09-27 auditing this
  // exact gap: scrape_runs exists but belongs to an unconnected, brand-scoped pipeline, never
  // written by handleInventoryBulk/handleInventorySweep), so a rolling 24h window against
  // removed_at is the most durable "since last crawl" signal that actually exists — this crawls
  // nightly, and it's the exact same window the sheet's own "Removed (24h)" stat tile already
  // counts (computeInventoryStats's removedToday), so the filter and the tile it's driven from
  // agree by construction. A vehicle can never be both removed and in stock, so this is never
  // combined with inStock=1 by the frontend (see VehiclesSheet.tsx's query builder).
  if (p("removed") === "1") where.push("i.removed_at IS NOT NULL AND i.removed_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)");
  if (p("hasSticker") === "1") where.push("i.window_sticker_url IS NOT NULL");
  if (p("minDays")) { where.push("i.days_on_lot >= ?"); args.push(Number(p("minDays"))); }
  if (p("maxDays")) { where.push("i.days_on_lot <= ?"); args.push(Number(p("maxDays"))); }
  if (p("priceMin")) { where.push("i.price >= ?"); args.push(Number(p("priceMin"))); }
  if (p("priceMax")) { where.push("i.price <= ?"); args.push(Number(p("priceMax"))); }
  // idx_inv_stock_year (removed_at, year) already existed (added for the year:asc/desc sort
  // option) — this is the first filter to actually use it.
  if (p("yearMin")) { where.push("i.year >= ?"); args.push(Number(p("yearMin"))); }
  if (p("yearMax")) { where.push("i.year <= ?"); args.push(Number(p("yearMax"))); }
  // No dedicated index on either color column yet — fine for now since these are additive
  // filters typically combined with make=/model= (already the selective, indexed part of the
  // query). Confirm live via EXPLAIN if a color-only search (no make) turns out to be common.
  if (p("exteriorColor")) { where.push("i.exterior_color = ?"); args.push(p("exteriorColor")); }
  if (p("interiorColor")) { where.push("i.interior_color = ?"); args.push(p("interiorColor")); }
  if (p("odometerMax")) { where.push("i.mileage <= ?"); args.push(Number(p("odometerMax"))); }
  // price_change_count is denormalized onto dealer_inventory, incremented in
  // handleInventoryBulk's upsert only when the incoming price genuinely differs from what
  // was stored — no live aggregation needed here, unlike the admin analytics page's
  // cohort-level LAG() OVER query over dealer_inventory_days.
  if (p("minPriceChanges")) { where.push("i.price_change_count >= ?"); args.push(Number(p("minPriceChanges"))); }
  // Buyer search's "must-have ALL of these factory options" — real set containment against
  // the normalized dealer_inventory_options side table (see ensureInventoryTable), not a
  // LIKE/JSON scan of options_json. Filters on canonical_key, NEVER the raw per-listing `code`
  // dealer_inventory_options also stores as metadata — confirmed live 2026-09-25, that code is
  // just a listing-position number ("OPT-35"), not a stable identifier, so the SAME real option
  // gets a different code on every vehicle; only canonical_key (normalizeOptionKey(label)) is
  // safe to match across vehicles. A comma-separated single param (optionKeys=a,b), not repeated
  // params — matches how every other filter here is a single string value, and is simpler for a
  // client to build than URLSearchParams.append() per key.
  //
  // Was a CORRELATED SUBQUERY (one dealer_inventory_options lookup per outer candidate row,
  // "i.vin IN (SELECT ... WHERE dealer_id = i.dealer_id ...)") — an earlier fix (indexing it by
  // dealer_id) made each individual lookup fast, but a correlated subquery still runs once PER
  // OUTER ROW regardless of how fast any one lookup is. Confirmed live 2026-09-26: a real buyer
  // search with optionKeys= and no make=/state= (exactly what the AI search box produces for an
  // options-only query like "heated seats and sunroof") ran for 2+ hours before being killed —
  // 674,248 outer candidate rows (every in-stock vehicle nationally) × one subquery execution
  // each. Rewritten as a JOIN into a derived table instead: the matching (vin, dealer_id) pairs
  // are computed EXACTLY ONCE regardless of outer row count, then joined in like any other
  // table — the standard fix for this exact correlated-subquery-doesn't-scale shape.
  // idx_opt_canonical (canonical_key) already covers this derived table's own scan: InnoDB
  // appends the primary key (vin, dealer_id, canonical_key) to every secondary index, so scanning
  // by canonical_key already returns vin/dealer_id index-only, no new index needed — confirmed
  // via EXPLAIN (no "Using filesort"/"Using temporary" beyond the small per-key row set itself).
  const optionKeys = (params.get("optionKeys") || "").split(",").map((c) => c.trim()).filter(Boolean);
  let optionJoin = "";
  const optionArgs = [];
  if (optionKeys.length) {
    optionJoin = `JOIN (SELECT vin, dealer_id FROM dealer_inventory_options WHERE canonical_key IN (${optionKeys.map(() => "?").join(",")}) GROUP BY vin, dealer_id HAVING COUNT(DISTINCT canonical_key) = ?) opt_match ON opt_match.vin = i.vin AND opt_match.dealer_id = i.dealer_id `;
    optionArgs.push(...optionKeys, optionKeys.length);
  }
  // "New" with real miles on it usually means a demo/loaner, not a car
  // fresh off the truck — there's no separate demo/loaner condition value
  // anywhere in this schema (confirmed in a 2026-09-22 inventory audit),
  // so this filters on the two fields that already exist rather than
  // adding one. 500 is a judgment call, not a manufacturer-defined
  // threshold — a handful of delivery/demo miles is normal for any new
  // car, but a few hundred or more usually means it's been driven as a
  // loaner.
  if (p("possibleDemo") === "1") where.push("i.cond = 'new' AND i.mileage > 500");
  if (p("q")) {
    // A leading-wildcard LIKE across 5 columns can't use any index — confirmed via EXPLAIN
    // against the live box (2026-09-22): type "ALL", a full scan of 555k+ rows, ~16s per
    // search. idx_inv_*_fwd/_rev (see ensureInventoryTable) cover the two patterns that
    // matter in practice — starts-with or ends-with — as an indexed prefix search in each
    // direction (a reversed-prefix match is a suffix match on the original value): a VIN's
    // last 6, a dealer name's trailing "…Route 10", the start of a model/trim/stock number.
    // What this can't find: a fragment from the middle that's neither end — a smaller, more
    // honest gap than the ngram approach this replaced, which didn't exist on this box at
    // all (no plugin, not installable via apt either). A term under 2 characters is too
    // short for a useful prefix/suffix match, so it falls back to the old full scan — rare,
    // no regression there.
    const term = p("q").trim();
    if (term.length >= 2) {
      where.push(`(
        i.vin LIKE ? OR i.vin_rev LIKE ? OR
        i.dealer_name LIKE ? OR i.dealer_name_rev LIKE ? OR
        i.model LIKE ? OR i.model_rev LIKE ? OR
        i.trim LIKE ? OR i.trim_rev LIKE ? OR
        i.stock_number LIKE ? OR i.stock_number_rev LIKE ?
      )`);
      const fwd = `${term}%`;
      const back = `${term.split("").reverse().join("")}%`;
      args.push(fwd, back, fwd, back, fwd, back, fwd, back, fwd, back);
    } else if (term) {
      where.push("(i.vin LIKE ? OR i.dealer_name LIKE ? OR i.model LIKE ? OR i.trim LIKE ? OR i.stock_number LIKE ?)");
      const like = `%${term}%`;
      args.push(like, like, like, like, like);
    }
  }
  const sortable = { dealer: "i.dealer_name", year: "i.year", make: "i.make", model: "i.model", price: "i.price", mileage: "i.mileage", seen: "i.last_seen_at", days: "i.days_on_lot", pricediff: "i.price_diff", msrp: "i.msrp",
    // The buyer /search table's other column headers (each sortable across the WHOLE result set, not just the visible page).
    vin: "i.vin", vehicleid: "i.vehicle_id", ext: "i.exterior_color", int: "i.interior_color", state: "i.state", listing: "i.vdp_url", contact: CONTACT_SORT_EXPR };
  const [sk, sd] = (p("sort") || "dealer:asc").split(":");
  const dirSql = sd === "desc" ? "DESC" : "ASC";
  // nullsLast=1 (opt-in; only the buyer search's header sort sends it): a blank value sorts AFTER every real value in BOTH
  // directions. Without it MariaDB treats NULL as the lowest value, so an ascending sort led with the rows that have nothing
  // (price:asc, mileage:asc, trim:asc all started with blanks). The blank test is a separate leading key that is always ASC
  // (0 = has a value, 1 = blank), so the real direction only applies to the values. Not applied to the default order or to any
  // caller that does not ask: their plans (index order, no filesort) are measured and must not change.
  const nullsLast = p("nullsLast") === "1";
  const blankKey = (col) => (TEXT_SORT_COLUMNS.has(col) ? `(${col} IS NULL OR ${col} = '')` : `(${col}) IS NULL`);
  const lead = (col) => (nullsLast ? `${blankKey(col)} ASC, ` : "");
  // sort=trim is the buyer search's default for make+model: idx_inv_stock_make_model_trim is ordered
  // (removed_at, make, model, trim, dealer_name, vin), so with make+model pinned, (trim, dealer_name,
  // vin) IS index order — no filesort at all. Measured live 2026-10-01 on 57,574 in-stock Ford F-150s:
  // the dealer:asc default filesorts the whole make+model range (348ms covering / 952ms with full
  // rows) while this order stops after 24 index entries (4ms). Only meaningful with make+model.
  const orderBy = sk === "trim"
    ? `${lead("i.trim")}i.trim ${dirSql}, i.dealer_name ${dirSql}, i.vin ${dirSql}`
    : `${sortable[sk] ? lead(sortable[sk]) : ""}${sortable[sk] || "i.dealer_name"} ${dirSql}, i.vin ASC`;
  // A make= filter combined with the default dealer_name sort made the optimizer pick
  // idx_inv_stock_dealer (295k-row estimate) over the far more selective idx_inv_stock_make
  // (removed_at, make, model) — confirmed live 2026-09-22: 110.9s vs 203ms forced. Likely
  // the growing number of indexes on this table (added for the prefix/suffix search) gave
  // the planner more bad options to pick from. model= and state= filters were checked at the
  // same time and don't hit this — only make= needed a hint.
  // idx_inv_stock_make leads with removed_at, so it only seeks on make when inStock=1 pins that
  // column; without it the same hint was a forced full scan + filesort — confirmed live 2026-09-22:
  // make=Porsche 18s, make=Toyota 20.1s. idx_inv_make_dealer (make, dealer_name, vin) leads with make
  // and reads the default dealer:asc sort in index order.
  //
  // idx_inv_stock_make itself (removed_at, make, model) seeks the WHERE fine but doesn't cover
  // dealer_name/vin, so the inStock=1 case above still filesorted every matching row before
  // returning a page — confirmed live 2026-09-25 once the buyer /search page (whose default view
  // is exactly this: make=, inStock=1, no explicit sort=) sent it real traffic: make=Toyota,
  // 10.8s for ~340k matching rows. idx_inv_stock_make_dealer (removed_at, make, dealer_name, vin)
  // is the covering fix — same shape as idx_inv_stock_state got for the identical state= bug the
  // same day.
  //
  // state= originally had no column of its own — every state= filter had to JOIN
  // dealership_contacts (which had no index on state either), and even the STRAIGHT_JOIN
  // rework that fixed the worst case (2026-09-22) still couldn't return sorted results
  // without materializing and filesorting the whole state's matches first. Confirmed live
  // 2026-09-25 on box2 (post deals-box migration): state=NJ + inStock=1, the admin sheet's
  // default view, 27.4s for 56,956 matching rows. Denormalizing state onto dealer_inventory
  // itself (see ensureInventoryTable in deals_api_server.js) turns it into exactly the same
  // shape as make=, so it gets the identical fix: a composite index it can read in order, no
  // JOIN, no filesort.
  // If both state= and make= are given, state's hint wins — state is what was actually
  // reported broken; make= alone was already fixed 2026-09-22 and isn't reintroduced here.
  // dealerId= excludes it the same way the old byState path excluded dealerId= — one store is
  // already maximally selective, and forcing a state-wide index onto a single-dealer query
  // could only make an already-fast query slower. make='s own hint keeps applying regardless
  // of dealerId=, unchanged from 2026-09-22 — no live evidence that combination needs a guard.
  //
  // make= + model=(+ trim=), state= NOT set (state stays optional — confirmed live 2026-09-28
  // this combination is common and must not be nudged toward requiring state): idx_inv_stock_
  // make_dealer above covers make= alone (removed_at, make, dealer_name, vin) but doesn't include
  // model/trim, so once those are also in the WHERE, every one of make='s rows (Ford: 186k+) still
  // needed a full row lookup just to check model=/trim= before the ~2k-45k that actually matched
  // could be counted or sorted — the exact same "index covers the equality prefix but not the next
  // WHERE column" shape state=/make= alone already had fixed into them, one level deeper. A make=
  // + model= query can't just reuse idx_inv_stock_make_dealer's own deeper sibling either: once
  // model/trim are unconstrained-but-present in index order ahead of dealer_name, the DEFAULT
  // dealer:asc sort would no longer match index order for the make-ONLY case, trading the filesort
  // this index exists to avoid for a different one. idx_inv_stock_make_model_trim (removed_at,
  // make, model, trim, dealer_name, vin) is a separate index used ONLY when model= is also given —
  // model=/trim= then pin exactly enough of the index's leading columns that (dealer_name, vin)
  // is once again the correctly-ordered remainder, index-only, no filesort, whether or not trim=
  // is present (trim locks one column further right in the same index; leaving it unset just means
  // a wider but still fully-ordered range within that make+model).
  // removed=1 (admin "Sold" movement filter) branches first and separately: every index above is
  // keyed for the IN-STOCK case (removed_at IS NULL) or no removed_at condition at all, so none of
  // them help WHERE make/state = ? AND removed_at IS NOT NULL AND removed_at >= ? — confirmed live
  // 2026-09-28, make=Toyota fell back to idx_inv_make_dealer (make, dealer_name, vin) with no
  // removed_at in the key, forcing a residual filter over every one of that make's rows: 70s+ for
  // a common make. idx_inv_make_removed/idx_inv_state_removed (see ensureInventoryTable) seek
  // straight to the make/state and range-scan only the recently-removed rows within it.
  const hasState = states.length > 0, hasMake = makes.length > 0, hasModel = models.length > 0;
  const indexHint = p("removed") === "1" && !p("dealerId")
    ? (hasState ? "FORCE INDEX (idx_inv_state_removed)" : hasMake ? "FORCE INDEX (idx_inv_make_removed)" : "FORCE INDEX (idx_inv_removed)")
    // make+model+state, in stock: state's own index (below) walks the WHOLE state in dealer order and
    // needs a row lookup per car just to test make/model — measured live 2026-10-01, Ford F-150 in NJ
    // (1,555 of NJ's ~57k cars) never finished inside 10s. idx_inv_facet_make_model_state_trim
    // (removed_at, make, model, state, trim) is exactly the equality prefix, so the range is only
    // those 1,555 rows; the sort then runs over that tiny set. (Created for the facet dropdowns.)
    : (hasMake && hasModel && hasState && p("inStock") === "1" && !p("dealerId"))
    ? "FORCE INDEX (idx_inv_facet_make_model_state_trim)"
    // make+state (no model) with sort=model: idx_inv_facet_make_state_model is (removed_at, make,
    // state, model) + the PK's vin, so (model, vin) is index order — the buyer's default for this
    // shape. Without it the state index walks all of the state's cars looking for a rare make (Porsche
    // in NJ never finished inside 10s, 2026-10-01); here the range is only that make's cars in the state.
    : (hasMake && hasState && !hasModel && p("inStock") === "1" && !p("dealerId") && (p("sort") || "").startsWith("model:"))
    ? "FORCE INDEX (idx_inv_facet_make_state_model)"
    : (hasState && !p("dealerId"))
    ? (p("inStock") === "1" ? "FORCE INDEX (idx_inv_stock_state)" : "FORCE INDEX (idx_inv_state_dealer)")
    : !hasMake ? ""
    : hasModel
      ? (p("inStock") === "1" ? "FORCE INDEX (idx_inv_stock_make_model_trim)" : "FORCE INDEX (idx_inv_make_model_trim)")
      : p("inStock") === "1" ? "FORCE INDEX (idx_inv_stock_make_dealer)" : "FORCE INDEX (idx_inv_make_dealer)";
  // Zero-scrape stale cars (zeroScrape.js) are still in stock as far as the table goes but hidden from buyers; the admin sheet asks for them with includeStale=1.
  if (p("inStock") === "1" && p("includeStale") !== "1") where.push("i.stale_at IS NULL");
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  // optionJoin's own placeholders appear in the SQL text before whereSql's, so its args must come
  // first in the flat array mysql2 binds positionally against.
  const sql = `FROM dealer_inventory i ${indexHint} ${optionJoin}LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${whereSql}`;
  // COUNT(*) never needs dealer_city/dealer_state — only the row-list SELECT does — and no WHERE
  // clause built above ever filters on a d.* column (state and dealer_name are native i.* columns,
  // denormalized in PR #296 and from day one respectively), so the count-only FROM clause drops
  // the dealership_contacts join entirely instead of paying for a lookup on every one of make='s
  // (or the whole table's) matching rows just to discard the result. Confirmed live 2026-09-28
  // this join was pure overhead on the COUNT(*) query for every filter combination, not just the
  // make=+model= case this fix targets.
  // Only a sort by the contact flag reads a d.* column inside the page's inner query (deferredPageSql builds that from countSql), so
  // exactly then countSql keeps the join; every other sort still drops it.
  // make+state (no model), in stock: idx_inv_stock_state has no make column, so counting a make's cars walks the state's cars in dealer
  // order with a clustered-row read for each (NJ Toyota: ~12k reads for a capped 1,001, >20s for an exact count). The COUNT uses
  // idx_inv_facet_state_make, (removed_at, state, make), where the make's range is contiguous. The PAGE keeps idx_inv_stock_state
  // (deferredPageSql swaps it back): its dealer_name order stops after one page, 0.9s vs 3.4s for a filesort of the make's cars.
  const countHint = indexHint === STATE_PAGE_HINT && hasMake && !hasModel ? STATE_MAKE_COUNT_HINT : indexHint;
  const countSql = /\bd\./.test(orderBy) ? sql : `FROM dealer_inventory i ${countHint} ${optionJoin}${whereSql}`;
  // countCap: stop counting once this many matches are found. An exact COUNT(*) has to visit every
  // matching row — 186k+ for a bare make like Ford — and buyers never need that number: "1,000+" is
  // an honest answer, and the LIMIT inside the derived table lets MariaDB stop early (a plain
  // COUNT(*) can't). Counting one past the cap is how the caller knows the real total is higher.
  // Absent/invalid = exact count, unchanged — the admin sheet still wants the true number.
  const capN = Math.floor(Number(params.get("countCap")));
  const countCap = Number.isFinite(capN) && capN >= 1 ? Math.min(capN, 100000) : null;
  const cappedCountSql = countCap ? `SELECT COUNT(*) AS total FROM (SELECT 1 ${countSql} LIMIT ${countCap + 1}) capped` : null;
  return { sql, countSql, countCap, cappedCountSql, args: [...optionArgs, ...args], orderBy };
}

/**
 * Resolves the page's `total` without a COUNT(*) when the page itself already proves it: a first
 * page that isn't full (offset 0) or a later page that isn't full means there are no more rows, so
 * the total is exactly offset + rows returned. Returns null when a count query is still needed.
 */
export function totalFromPage(offset, limit, rowsReturned) {
  if (rowsReturned === 0 && offset > 0) return null; // paged past the end — the true total is unknown
  return rowsReturned < limit ? offset + rowsReturned : null;
}

/** Folds a capped count result into the {total, totalCapped} the API returns. */
export function applyCountCap(rawCount, countCap) {
  const n = Number(rawCount);
  return countCap && n > countCap ? { total: countCap, totalCapped: true } : { total: n, totalCapped: false };
}

/**
 * Deferred-join page query: the inner query picks the page's (vin, dealer_id) pairs using only
 * columns the chosen index covers (no row lookups, no blob pages), and only those <= LIMIT rows are
 * then fetched whole. Without it MariaDB reads the full wide row (options_json etc.) for every
 * candidate before filtering/sorting — measured live 2026-10-01: F-150 + two must-have options never
 * finished inside 10s that way. Takes the builder's own `countSql` (the FROM/WHERE with no
 * dealership_contacts join, which is exactly what the inner query needs) and `orderBy`; bind
 * [...args, limit, offset]. The outer ORDER BY repeats the inner one because a join doesn't
 * preserve the derived table's order.
 */
export function deferredPageSql({ countSql, orderBy }) {
  // state+make counts through idx_inv_facet_state_make (see countHint). The page only goes back to idx_inv_stock_state for the default
  // dealer_name ASC, vin ASC order, which that index delivers in order and stops after one page (0.9s). Any other sort has to order the
  // whole make-in-state set, and on idx_inv_stock_state that is a walk of every car in the state with a row read each (NJ Honda
  // price:asc >25s); on the facet index it is the make's own range (3.7s).
  const pageFrom = /^i\.dealer_name ASC, i\.vin ASC$/.test(orderBy) ? countSql.replace(STATE_MAKE_COUNT_HINT, STATE_PAGE_HINT) : countSql;
  return `SELECT i.*, d.city AS dealer_city, d.state AS dealer_state FROM (SELECT i.vin, i.dealer_id ${pageFrom} ORDER BY ${orderBy} LIMIT ? OFFSET ?) pg JOIN dealer_inventory i ON i.vin = pg.vin AND i.dealer_id = pg.dealer_id LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ORDER BY ${orderBy}`;
}
