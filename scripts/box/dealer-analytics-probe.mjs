#!/usr/bin/env node
/**
 * Dealer Analytics validation probe (box2). READ-ONLY: reader DB user, SET SESSION TRANSACTION READ ONLY, no lock, no writes.
 *
 *   --price-diff [--dealers=1,2,3 | --sample=N] [--min=98]
 *        Compares the crawler's price_diff/old_price on current stock with the price changes in dealer_inventory_days.
 *        This is the check that decided the job derives changes from the days table instead of price_diff (see the doc).
 *   --tables [--sample=N] [--min=98]
 *        After the tables exist: re-derives changes from dealer_inventory_days for sampled dealers over the table's date range and
 *        diffs them against dealer_price_changes. Exits 1 when the match rate is under --min (default 98).
 *   --suspects
 *        Lists the dealers the nightly job flags as is_group_bucket (40+ distinct makes in stock or 1,500+ units): dealer-group
 *        websites attributed to a single rooftop (like 16951). They stay in every table; the flag lets the page hide them.
 */
import { DEALER_VINS_SQL, DEFAULTS, GROUP_BUCKET_MIN_MAKES, GROUP_BUCKET_MIN_UNITS, SIZES_SQL, SUSPECTS_SQL, TABLE_EVENTS_SQL, TABLE_RANGE_SQL, chunk, deriveEvents, excludedSet, parseExcludedEnv, priceDiffValidationSql, stratifiedSample, DAYS_FOR_VINS_SQL } from "./dealerAnalyticsCore.js";
import { log, makePool } from "./dealerAnalyticsBox.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const min = Number(args.min) || 98;
const excluded = excludedSet(parseExcludedEnv(process.env.DEALER_ANALYTICS_EXCLUDE));
const db = await makePool({ readOnly: true });
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 100);
const pickDealers = async () => {
  if (args.dealers) return String(args.dealers).split(",").map(Number);
  const sizes = (await db.q(SIZES_SQL)).map((r) => ({ dealer_id: Number(r.dealer_id), units: Number(r.units) })).filter((r) => !excluded.has(r.dealer_id));
  return stratifiedSample(sizes, Math.max(1, Math.round((Number(args.sample) || 20) / 5)));
};
let code = 0;
try {
  if (args["price-diff"]) {
    const dealers = await pickDealers();
    const rows = await db.q(priceDiffValidationSql(dealers));
    console.table(rows.map((r) => ({ dealer: r.dealer_id, units: Number(r.units), price_diff_rows: Number(r.a_n), exact: Number(r.match_exact), price_only: Number(r.match_price), same_date: Number(r.match_same_date) })));
    const t = rows.reduce((a, r) => ({ n: a.n + Number(r.a_n), e: a.e + Number(r.match_exact), p: a.p + Number(r.match_price), d: a.d + Number(r.match_same_date) }), { n: 0, e: 0, p: 0, d: 0 });
    log(`[probe] ${dealers.length} dealers, ${t.n} price_diff rows: exact old->new ${pct(t.e, t.n)}%, same new price ${pct(t.p, t.n)}%, same date ${pct(t.d, t.n)}% (threshold ${min}%)`);
    if (pct(t.e, t.n) < min) { log("[probe] price_diff is NOT reliable enough: derive changes from dealer_inventory_days"); code = 1; }
  } else if (args.tables) {
    const dealers = await pickDealers();
    const [{ lo, hi }] = await db.q(TABLE_RANGE_SQL);
    if (!lo) throw new Error("dealer_price_changes is empty");
    let derived = 0, found = 0, extra = 0;
    for (const id of dealers) {
      const vins = (await db.q(DEALER_VINS_SQL, [id])).map((r) => r.vin);
      const days = [];
      for (const part of chunk(vins, DEFAULTS.vinBatch)) days.push(...(await db.q(DAYS_FOR_VINS_SQL, [part, "2000-01-01"])).filter((r) => Number(r.dealer_id) === id));
      const want = deriveEvents(days, { fromDate: lo, toDate: hi, excluded });
      const have = new Set((await db.q(TABLE_EVENTS_SQL, [[id], lo, hi])).map((r) => `${r.vin}|${r.changed_on}|${r.old_price}|${r.new_price}`));
      const wantKeys = new Set(want.map((e) => `${e[2]}|${e[1]}|${e[4]}|${e[5]}`));
      derived += wantKeys.size;
      for (const k of wantKeys) if (have.has(k)) found += 1;
      for (const k of have) if (!wantKeys.has(k)) extra += 1;
      log(`[probe] dealer ${id}: ${wantKeys.size} derived, ${[...wantKeys].filter((k) => have.has(k)).length} in table`);
    }
    log(`[probe] tables vs days (${lo}..${hi}): ${found}/${derived} derived changes present (${pct(found, derived)}%), ${extra} table rows with no derived match (threshold ${min}%)`);
    if (pct(found, derived) < min) code = 1;
  } else if (args.suspects) {
    const rows = await db.q(SUSPECTS_SQL, [GROUP_BUCKET_MIN_UNITS, GROUP_BUCKET_MIN_MAKES]);
    console.table(rows.slice(0, 40).map((r) => ({ dealer: r.dealer_id, units: Number(r.units), makes: Number(r.makes) })));
    const byUnits = rows.filter((r) => Number(r.units) >= GROUP_BUCKET_MIN_UNITS).length;
    const byMakes = rows.filter((r) => Number(r.makes) >= GROUP_BUCKET_MIN_MAKES).length;
    log(`[probe] ${rows.length} dealers flagged as group buckets (${byUnits} by ${GROUP_BUCKET_MIN_UNITS}+ units, ${byMakes} by ${GROUP_BUCKET_MIN_MAKES}+ makes), ${rows.reduce((a, r) => a + Number(r.units), 0)} units`);
  } else {
    console.error("usage: dealer-analytics-probe.mjs --price-diff | --tables | --suspects (see the file header)");
    code = 2;
  }
} catch (err) {
  log(`[probe] ERROR: ${err.stack || err.message}`);
  code = 1;
} finally {
  await db.close().catch(() => {});
}
process.exit(code);
