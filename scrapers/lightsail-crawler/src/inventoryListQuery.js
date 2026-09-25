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
export function inventoryListQuery(params) {
  const where = [], args = [];
  const p = (k) => (params.get(k) || "").trim();
  if (p("dealerId")) { where.push("i.dealer_id = ?"); args.push(Number(p("dealerId"))); }
  if (p("state")) { where.push("i.state = ?"); args.push(p("state").toUpperCase()); }
  if (p("make")) { where.push("i.make = ?"); args.push(p("make")); }
  if (p("model")) { where.push("i.model = ?"); args.push(p("model")); }
  if (p("trim")) { where.push("i.trim = ?"); args.push(p("trim")); }
  if (p("cond")) { where.push("i.cond = ?"); args.push(p("cond")); }
  if (p("inStock") === "1") where.push("i.removed_at IS NULL");
  if (p("changeType")) { where.push("i.change_type = ?"); args.push(p("changeType").toUpperCase()); }
  if (p("priceChange") === "drop") where.push("i.price_diff < 0");
  if (p("priceChange") === "increase") where.push("i.price_diff > 0");
  if (p("hasSticker") === "1") where.push("i.window_sticker_url IS NOT NULL");
  if (p("minDays")) { where.push("i.days_on_lot >= ?"); args.push(Number(p("minDays"))); }
  if (p("maxDays")) { where.push("i.days_on_lot <= ?"); args.push(Number(p("maxDays"))); }
  if (p("priceMin")) { where.push("i.price >= ?"); args.push(Number(p("priceMin"))); }
  if (p("priceMax")) { where.push("i.price <= ?"); args.push(Number(p("priceMax"))); }
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
  // LIKE/JSON scan of options_json. A comma-separated single param (optionCodes=A,B), not
  // repeated params — matches how every other filter here is a single string value, and is
  // simpler for a client to build than URLSearchParams.append() per code.
  //
  // This is a correlated subquery (one dealer_inventory_options lookup per outer candidate
  // row), so it should run after other filters (make/model/price/etc.) have already narrowed
  // the outer set — it has no index hint of its own yet. Confirm live via EXPLAIN once a real
  // optionCodes= search is exercised, the same discipline every other filter here has had.
  const optionCodes = (params.get("optionCodes") || "").split(",").map((c) => c.trim()).filter(Boolean);
  if (optionCodes.length) {
    where.push(`i.vin IN (SELECT vin FROM dealer_inventory_options WHERE dealer_id = i.dealer_id AND code IN (${optionCodes.map(() => "?").join(",")}) GROUP BY vin HAVING COUNT(DISTINCT code) = ?)`);
    args.push(...optionCodes, optionCodes.length);
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
  const sortable = { dealer: "i.dealer_name", year: "i.year", make: "i.make", model: "i.model", price: "i.price", mileage: "i.mileage", seen: "i.last_seen_at", days: "i.days_on_lot", pricediff: "i.price_diff", msrp: "i.msrp" };
  const [sk, sd] = (p("sort") || "dealer:asc").split(":");
  const orderBy = `${sortable[sk] || "i.dealer_name"} ${sd === "desc" ? "DESC" : "ASC"}, i.vin ASC`;
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
  const indexHint = (p("state") && !p("dealerId"))
    ? (p("inStock") === "1" ? "FORCE INDEX (idx_inv_stock_state)" : "FORCE INDEX (idx_inv_state_dealer)")
    : !p("make") ? ""
    : p("inStock") === "1" ? "FORCE INDEX (idx_inv_stock_make)" : "FORCE INDEX (idx_inv_make_dealer)";
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const sql = `FROM dealer_inventory i ${indexHint} LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${whereSql}`;
  return { sql, args, orderBy };
}
