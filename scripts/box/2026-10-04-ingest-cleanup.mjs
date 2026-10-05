// One-time cleanup of three ingest defects already stored in dealer_inventory (the code fixes only stop NEW bad rows):
//
//   1. miles   used/CPO rows with mileage = 0 -> NULL. The scrapers defaulted a missing odometer to 0; a used car never
//              sits at exactly 0 miles. New cars keep their 0.
//   2. price   rows whose price is clearly a stored lease payment -> price = NULL (and msrp = NULL where it was just a copy
//              of that same number). "Clearly" is deliberately narrow — see PAYMENT_* below; there is NO blanket
//              "under $3,000" rule, a $2,500 used car is a real price and stays.
//   3. sticker window_sticker_url that is an image / icon / CDN button asset (window-sticker.svg) -> NULL. Real PDF and
//              Monroney links are untouched.
//
// SAFE BY DEFAULT: with no flags this only COUNTS (and prints sample rows) — it writes nothing.
//   --apply --fleet-idle   performs the updates. Takes the deals-API sync lock for the duration (refuses if it is held,
//                          exit 4) and heartbeats it, exactly like 2026-10-03-revert-model-fill-rows.mjs.
//   --only=miles,price,sticker   run a subset (default: all three)
//   --max-payment=1500     a price at or under this is a payment candidate (default 1500)
//   --used-min-year=2020   a USED row is only treated as a lease payment when its model year is at least this (default 2020);
//                          NEW and CPO rows qualify at any year. This keeps a real $900 older used car.
//
// WHEN TO APPLY (Paul's call, not the script's): only once the recovery crawl is done AND the sync lock on box2
// (52.202.234.65) is free. Never against 3.237.204.55 — this refuses to run if the DB or deals API points there.
//
// Run on the deals box (box2) from /opt/trimscout-deals, with ingestSanitize.js copied next to this file (it is the same
// predicate the scraper now uses for stickers, so the cleanup and the ingest rule cannot drift):
//   sudo node 2026-10-04-ingest-cleanup.mjs                                  # count only
//   sudo node 2026-10-04-ingest-cleanup.mjs --apply --fleet-idle             # live
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
// In the repo the module lives with the scraper; on the box it is copied next to this file.
const { isRealWindowStickerUrl } = await import("./ingestSanitize.js").catch(() => import("../../scrapers/lightsail-crawler/src/ingestSanitize.js"));

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const APPLY = flag("apply");
const FLEET_IDLE = flag("fleet-idle");
const ONLY = new Set((opt("only") || "miles,price,sticker").split(",").map((s) => s.trim()).filter(Boolean));
const MAX_PAYMENT = Number(opt("max-payment") || 1500);
const USED_MIN_YEAR = Number(opt("used-min-year") || 2020);
const BATCH = 2000;
const PAUSE_MS = 150;
const FORBIDDEN_HOST = "3.237.204.55";
if (!Number.isInteger(MAX_PAYMENT) || MAX_PAYMENT < 1 || !Number.isInteger(USED_MIN_YEAR)) { console.error("--max-payment and --used-min-year must be integers"); process.exit(1); }
for (const k of ONLY) if (!["miles", "price", "sticker"].includes(k)) { console.error(`unknown --only value: ${k}`); process.exit(1); }
if (APPLY && !FLEET_IDLE) { console.error("Refusing to --apply without --fleet-idle (confirm the recovery crawl is done and no sync is running on any box first)."); process.exit(1); }

function readEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[t.slice(0, eq).trim()] = v;
    }
  } catch { /* missing file: nothing from it */ }
  return out;
}
const dbEnv = readEnvFile(path.resolve(process.cwd(), ".env.trimscout-db"));
const appEnv = readEnvFile(path.resolve(process.cwd(), ".env"));
const API_KEY = process.env.TRIMSCOUT_API_KEY || appEnv.TRIMSCOUT_API_KEY || dbEnv.TRIMSCOUT_API_KEY || null;
const DB_HOST = dbEnv.DB_HOST || process.env.DB_HOST;
const DEALS = `http://127.0.0.1:${process.env.DEALS_API_PORT || dbEnv.DEALS_API_PORT || 3004}`;
if ([DB_HOST, DEALS, process.env.TRIMSCOUT_DEALS_HOST].some((h) => String(h || "").includes(FORBIDDEN_HOST))) {
  console.error(`Refusing to run: this points at ${FORBIDDEN_HOST}. This cleanup only ever targets box2 (52.202.234.65).`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pool = mysql.createPool({
  host: DB_HOST, port: Number(dbEnv.DB_PORT || process.env.DB_PORT) || 3306, database: dbEnv.DB_NAME || process.env.DB_NAME || "trimscout",
  user: dbEnv.DB_WRITER_USER || process.env.DB_WRITER_USER, password: dbEnv.DB_WRITER_PASSWORD || process.env.DB_WRITER_PASSWORD, connectionLimit: 2,
});
async function lockCall(action, owner, extra = {}) {
  const r = await fetch(`${DEALS}/api/ops/sync-lock/${action}`, { method: "POST", headers: { "X-Trimscout-Api-Key": API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...extra }) });
  if (!r.ok) throw new Error(`sync-lock ${action} -> HTTP ${r.status}`);
  return r.json();
}
const fmt = (n) => Number(n).toLocaleString("en-US");

// 1. miles: dealer_inventory.cond is 'new' | 'used' | 'cpo' | 'wholesale' (inventory-sync.mjs's cond()).
const MILES_WHERE = "cond IN ('used','cpo') AND mileage = 0";
// 2. price: a figure this low is not a plausible sale price for a new/CPO car at any year, nor for a recent used car.
//    It is the monthly payment / drive-off amount the page printed next to "/mo", "per month" or "down".
const PRICE_WHERE = `price BETWEEN 1 AND ${MAX_PAYMENT} AND (cond IN ('new','cpo') OR (cond = 'used' AND year >= ${USED_MIN_YEAR}))`;
// 3. sticker: loose SQL prefilter, then the scraper's own predicate decides (so the two cannot disagree).
const STICKER_PREFILTER = "window_sticker_url IS NOT NULL AND (" +
  [".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp", "icon", "button", "btn", "badge", "logo", "sprite"]
    .map((x) => `window_sticker_url LIKE '%${x}%'`).join(" OR ") + ")";

async function countAndSample(label, where, sampleCols) {
  const [[c]] = await pool.query(`SELECT COUNT(*) AS n FROM dealer_inventory WHERE ${where}`);
  console.log(`${label}: ${fmt(c.n)} rows`);
  if (Number(c.n) > 0) {
    const [rows] = await pool.query(`SELECT ${sampleCols} FROM dealer_inventory WHERE ${where} LIMIT 8`);
    for (const r of rows) console.log("    " + JSON.stringify(r));
  }
  return Number(c.n);
}

async function stickerCandidates() {
  const bad = [];
  let lastVin = "", lastDealer = -1;
  for (;;) {
    const [rows] = await pool.query(
      `SELECT vin, dealer_id, window_sticker_url FROM dealer_inventory WHERE (${STICKER_PREFILTER}) AND (vin > ? OR (vin = ? AND dealer_id > ?)) ORDER BY vin, dealer_id LIMIT 20000`,
      [lastVin, lastVin, lastDealer]);
    if (rows.length === 0) break;
    for (const r of rows) if (!isRealWindowStickerUrl(r.window_sticker_url)) bad.push(r);
    lastVin = rows[rows.length - 1].vin; lastDealer = rows[rows.length - 1].dealer_id;
  }
  return bad;
}

async function main() {
  console.log(`${APPLY ? "LIVE (--apply)" : "COUNT ONLY"}  ${new Date().toISOString()}  steps: ${[...ONLY].join(", ")}  (max-payment $${fmt(MAX_PAYMENT)}, used-min-year ${USED_MIN_YEAR})`);
  const counts = {};
  if (ONLY.has("miles")) counts.miles = await countAndSample("used/CPO rows with mileage = 0 (would become NULL)", MILES_WHERE, "vin, dealer_id, cond, year, mileage, price");
  if (ONLY.has("price")) {
    counts.price = await countAndSample(`rows with a payment-sized price (<= $${fmt(MAX_PAYMENT)}; would become NULL)`, PRICE_WHERE, "vin, dealer_id, cond, year, price, msrp, vdp_url");
    const [bands] = await pool.query(`SELECT cond, CASE WHEN price < 500 THEN '<500' WHEN price < 1000 THEN '500-999' ELSE '1000+' END AS band, COUNT(*) AS n FROM dealer_inventory WHERE ${PRICE_WHERE} GROUP BY cond, band ORDER BY cond, band`);
    for (const b of bands) console.log(`    ${b.cond} ${b.band}: ${fmt(b.n)}`);
  }
  let stickers = [];
  if (ONLY.has("sticker")) {
    stickers = await stickerCandidates();
    counts.sticker = stickers.length;
    console.log(`rows with a fake sticker URL (image / icon / button asset; would become NULL): ${fmt(stickers.length)} rows`);
    for (const r of stickers.slice(0, 8)) console.log("    " + JSON.stringify(r));
  }
  if (!APPLY) { console.log("COUNT ONLY — nothing was changed."); await pool.end(); return; }

  if (!API_KEY) { console.error("No TRIMSCOUT_API_KEY found (env, .env): refusing to apply without being able to take the sync lock."); await pool.end(); process.exit(3); }
  const owner = `ingest-cleanup-${process.pid}`;
  const lock = await lockCall("acquire", owner, { heartbeat: true });
  if (!lock.acquired) { console.log(`HELD, LOCK BUSY — ${JSON.stringify(lock)}. Nothing was changed.`); await pool.end(); process.exit(4); }
  console.log(`Sync lock taken as ${owner}; cleaning...`);
  const hb = setInterval(() => lockCall("heartbeat", owner).catch((e) => console.error(`  lock heartbeat failed: ${e.message}`)), 30_000);
  const release = async () => { clearInterval(hb); await lockCall("release", owner).catch(() => {}); };
  process.on("SIGTERM", async () => { await release(); process.exit(143); });
  try {
    // Rows leave their WHERE once updated, so a LIMIT loop terminates on its own.
    const drain = async (label, sql) => {
      let total = 0;
      for (;;) {
        const [res] = await pool.query(sql);
        total += res.affectedRows;
        if (res.affectedRows < BATCH) break;
        await sleep(PAUSE_MS);
      }
      console.log(`${label}: ${fmt(total)} rows updated`);
    };
    if (ONLY.has("miles")) await drain("miles -> NULL", `UPDATE dealer_inventory SET mileage = NULL WHERE ${MILES_WHERE} LIMIT ${BATCH}`);
    // msrp is assigned first: MySQL/MariaDB evaluate SET left to right, so `price = NULL` first would make `msrp = price` never true.
    if (ONLY.has("price")) await drain("payment price -> NULL", `UPDATE dealer_inventory SET msrp = IF(msrp = price, NULL, msrp), price = NULL WHERE ${PRICE_WHERE} LIMIT ${BATCH}`);
    if (ONLY.has("sticker")) {
      let total = 0;
      for (let i = 0; i < stickers.length; i += 200) {
        const chunk = stickers.slice(i, i + 200);
        // The URL is re-checked in the WHERE, so a good link a sync wrote since the scan is never nulled.
        const [res] = await pool.query(
          `UPDATE dealer_inventory FORCE INDEX (PRIMARY) SET window_sticker_url = NULL WHERE ${chunk.map(() => "(vin = ? AND dealer_id = ? AND window_sticker_url = ?)").join(" OR ")}`,
          chunk.flatMap((r) => [r.vin, r.dealer_id, r.window_sticker_url]));
        total += res.affectedRows;
        await sleep(PAUSE_MS);
      }
      console.log(`fake sticker URL -> NULL: ${fmt(total)} rows updated`);
    }
  } finally {
    await release();
  }
  // Re-count so the log shows what is left (should be ~0; non-zero means a sync/crawl wrote more meanwhile).
  if (ONLY.has("miles")) console.log(`remaining used/CPO miles = 0: ${fmt((await pool.query(`SELECT COUNT(*) AS n FROM dealer_inventory WHERE ${MILES_WHERE}`))[0][0].n)}`);
  if (ONLY.has("price")) console.log(`remaining payment-sized prices: ${fmt((await pool.query(`SELECT COUNT(*) AS n FROM dealer_inventory WHERE ${PRICE_WHERE}`))[0][0].n)}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
