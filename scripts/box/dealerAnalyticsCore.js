// Dealer Analytics nightly job: the pure parts (table definitions, SQL, price-change derivation, run-window rules).
// No I/O here, so everything is unit-testable (dealerAnalytics.test.mjs). Design and install steps: docs/DEALER_ANALYTICS_NIGHTLY.md.
//
// Four NEW tables, nothing existing is altered:
//   dealer_price_changes   one row per observed price change of a (VIN, store), derived from dealer_inventory_days
//   dealer_daily_summary   one row per (store, day): units, new/used, DOM, age buckets, added/removed, 7/30-day price drops
//   market_price_daily     one row per (day, make, model, year, cond): units and average price across every store
//   dealer_analytics_runs  one row per run: the "finished" marker (idempotent cron) and the data-as-of time
// `day` everywhere is the UTC date at run time — the same convention dealer_inventory_days.seen_on already uses.

const CHARSET = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci";

export const TABLES = Object.freeze({
  changes: "dealer_price_changes",
  summary: "dealer_daily_summary",
  market: "market_price_daily",
  runs: "dealer_analytics_runs",
});

export const DDL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS dealer_price_changes (
    dealer_id INT NOT NULL,
    changed_on DATE NOT NULL,
    vin CHAR(17) NOT NULL,
    prev_on DATE NOT NULL,
    old_price INT NOT NULL,
    new_price INT NOT NULL,
    PRIMARY KEY (dealer_id, changed_on, vin)
  ) ${CHARSET}`,
  `CREATE TABLE IF NOT EXISTS dealer_daily_summary (
    dealer_id INT NOT NULL,
    day DATE NOT NULL,
    active_units INT NOT NULL,
    new_units INT NOT NULL,
    used_units INT NOT NULL,
    priced_units INT NOT NULL,
    avg_price INT NULL,
    avg_dom DECIMAL(7,1) NULL,
    age_0_30 INT NOT NULL,
    age_31_60 INT NOT NULL,
    age_61_90 INT NOT NULL,
    age_90_plus INT NOT NULL,
    added_units INT NOT NULL,
    removed_units INT NOT NULL,
    added_7d INT NOT NULL,
    removed_7d INT NOT NULL,
    drop_units_7d INT NOT NULL,
    drop_units_30d INT NOT NULL,
    avg_drop_usd_7d INT NULL,
    avg_drop_pct_7d DECIMAL(6,2) NULL,
    avg_drop_usd_30d INT NULL,
    avg_drop_pct_30d DECIMAL(6,2) NULL,
    computed_at DATETIME NOT NULL,
    PRIMARY KEY (dealer_id, day),
    KEY idx_dds_day (day)
  ) ${CHARSET}`,
  `CREATE TABLE IF NOT EXISTS market_price_daily (
    day DATE NOT NULL,
    make VARCHAR(64) NOT NULL,
    model VARCHAR(96) NOT NULL,
    year SMALLINT NOT NULL,
    cond VARCHAR(12) NOT NULL,
    units INT NOT NULL,
    dealers INT NOT NULL,
    avg_price INT NOT NULL,
    computed_at DATETIME NOT NULL,
    PRIMARY KEY (day, make, model, year, cond)
  ) ${CHARSET}`,
  `CREATE TABLE IF NOT EXISTS dealer_analytics_runs (
    day DATE NOT NULL,
    started_at DATETIME NOT NULL,
    finished_at DATETIME NULL,
    status VARCHAR(16) NOT NULL,
    detail TEXT NULL,
    PRIMARY KEY (day, started_at)
  ) ${CHARSET}`,
]);

export const DEFAULTS = Object.freeze({
  // Dealer id 0 ("no store matched") is ALWAYS excluded. 16951 (ED MORSE NISSAN) is a dealer-group website attributed to one
  // rooftop (61 makes, 10,934 units) — left out of every table until Paul decides how to treat such rows.
  excludeDealerIds: [16951],
  windowDays: 2, // nightly job re-derives price changes for this many UTC days (a late box sync is caught next night)
  lookbackDays: 14, // how far before the window to look for the "previous price" row
  startAfter: "06:00", // ET: earliest start
  startBefore: "18:00", // ET: latest start
  stopAt: "21:30", // ET: hard stop, so the job is gone well before the 22:00 crawl
  lockWaitMs: 90 * 60_000,
  throttleMs: 200,
  statementCapSeconds: 120, // MariaDB max_statement_time per statement; a runaway statement fails the run instead of hanging it
  dealerChunk: 250,
  vinBatch: 1000,
  insertBatch: 2000,
  gateCheckEvery: 20, // re-check the crawl gate every N checkpoints
  syncMaxAgeMs: 20 * 3600_000,
});

export function excludedSet(ids = DEFAULTS.excludeDealerIds) {
  const s = new Set([0]);
  for (const id of ids) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 0) throw new Error(`bad excluded dealer id: ${id}`);
    s.add(n);
  }
  return s;
}
export function parseExcludedEnv(raw) {
  if (raw == null || String(raw).trim() === "") return DEFAULTS.excludeDealerIds;
  return String(raw).split(",").map((s) => s.trim()).filter(Boolean).map(Number);
}

// ---- dates ---------------------------------------------------------------------------------------------------------
export const isYmd = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export function assertYmd(s) {
  if (!isYmd(s)) throw new Error(`bad date: ${s}`);
  return s;
}
export const utcDay = (d) => d.toISOString().slice(0, 10);
export function addDays(ymd, n) {
  const d = new Date(`${assertYmd(ymd)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const pad = (n) => String(n).padStart(2, "0");
/** "YYYY-MM-DD HH:MM:SS" (UTC) for a DATETIME bind. */
export const sqlDateTime = (d) => `${utcDay(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

// ---- run window (America/New_York) ----------------------------------------------------------------------------------
const etFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
export function etMinutes(date) {
  const parts = etFmt.formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return get("hour") * 60 + get("minute");
}
const hhmm = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`bad HH:MM: ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
};
export function canStartNow(now, cfg = DEFAULTS) {
  const m = etMinutes(now);
  return m >= hhmm(cfg.startAfter) && m < hhmm(cfg.startBefore);
}
/** True from the stop time until midnight ET. (Nothing is allowed to start overnight, so 00:00–06:00 never matters.) */
export function pastStop(now, cfg = DEFAULTS) {
  return etMinutes(now) >= hhmm(cfg.stopAt);
}

// ---- box2 sync-finished detection ------------------------------------------------------------------------------------
// ~/inventory-sync/logs/sync-<date>.log ends with a "<ts> {"upserted":...}" summary line when a run completed.
export function parseSyncLogTail({ tail, mtimeMs, nowMs, quietMs = 120_000, maxAgeMs = DEFAULTS.syncMaxAgeMs }) {
  const lines = String(tail || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || "";
  if (nowMs - mtimeMs < quietMs) return { finished: false, detail: "newest sync log was written to in the last 2 minutes" };
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \{"upserted":/.test(last)) return { finished: false, detail: `newest sync log does not end with a run summary (last line: ${last.slice(0, 80)})` };
  if (nowMs - mtimeMs > maxAgeMs) return { finished: false, detail: `newest finished sync is ${Math.round((nowMs - mtimeMs) / 3600_000)}h old — tonight's has not landed` };
  return { finished: true, finishedAt: new Date(mtimeMs), detail: "" };
}

// ---- price-change derivation ------------------------------------------------------------------------------------------
const validPrice = (p) => Number.isInteger(p) && p > 0;
/**
 * rows: {vin, dealer_id, seen_on:'YYYY-MM-DD', price} from dealer_inventory_days (any order).
 * A change is recorded on the first day a (VIN, store) is seen at a different positive price than its previous positive price,
 * so a gap in crawling dates the change when it was first observed, never loses it. Only changes with seen_on >= fromDate
 * are returned (rows before it just provide the previous price). Returns [dealer_id, changed_on, vin, prev_on, old, new]
 * sorted by the table's primary key (dealer_id, changed_on, vin) — multi-row writes in key order, as the box's other upserts do.
 */
export function deriveEvents(rows, { fromDate = null, toDate = null, excluded = excludedSet() } = {}) {
  const sorted = [...rows].sort((a, b) => (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : a.dealer_id - b.dealer_id || (a.seen_on < b.seen_on ? -1 : a.seen_on > b.seen_on ? 1 : 0)));
  const events = [];
  let key = null;
  let last = null;
  for (const r of sorted) {
    const dealerId = Number(r.dealer_id);
    if (excluded.has(dealerId)) continue;
    const k = `${r.vin}|${dealerId}`;
    if (k !== key) { key = k; last = null; }
    const price = r.price == null ? null : Number(r.price);
    if (!validPrice(price)) continue;
    if (last && price !== last.price && (fromDate == null || r.seen_on >= fromDate) && (toDate == null || r.seen_on <= toDate)) {
      events.push([dealerId, r.seen_on, r.vin, last.seen_on, last.price, price]);
    }
    last = { seen_on: r.seen_on, price };
  }
  return events.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
export function dealerRanges(maxId, size = DEFAULTS.dealerChunk) {
  const out = [];
  for (let from = 1; from <= maxId; from += size) out.push([from, Math.min(from + size - 1, maxId)]);
  return out;
}

// ---- SQL --------------------------------------------------------------------------------------------------------------
const WRITE_RE = /^\s*(insert|replace|update|delete|create|alter|drop|truncate|rename|grant|lock\s+tables)\b/i;
export const isWriteSql = (sql) => WRITE_RE.test(sql);

const notExcluded = (excluded) => {
  const ids = [...excluded].filter((n) => n > 0).sort((a, b) => a - b);
  return `dealer_id > 0${ids.length ? ` AND dealer_id NOT IN (${ids.join(",")})` : ""}`;
};

/** Covering index idx_inv_last_seen (+ PK): candidates are VINs the sync touched since a given time. */
export const CANDIDATES_SQL = "SELECT vin, dealer_id FROM dealer_inventory WHERE last_seen_at >= ? AND last_seen_at < ? AND dealer_id > 0";
export const DAYS_FOR_VINS_SQL = "SELECT vin, dealer_id, DATE_FORMAT(seen_on, '%Y-%m-%d') AS seen_on, price FROM dealer_inventory_days WHERE vin IN (?) AND seen_on >= ?";
export const NEXT_VINS_SQL = "SELECT DISTINCT vin FROM dealer_inventory WHERE vin > ? ORDER BY vin LIMIT ?";
export const INSERT_CHANGES_SQL = "INSERT IGNORE INTO dealer_price_changes (dealer_id, changed_on, vin, prev_on, old_price, new_price) VALUES ?";

// Days on market, per docs/DEALER_ANALYTICS.md: the crawl's days_on_lot, else days since first seen.
const domExpr = (day) => `GREATEST(COALESCE(days_on_lot, DATEDIFF('${assertYmd(day)}', COALESCE(crawl_first_seen, DATE(first_seen_at)))), 0)`;

export function summarySql(day, excluded) {
  const d = assertYmd(day);
  const dom = domExpr(d);
  const in7 = addDays(d, -6);
  return `SELECT dealer_id,
    SUM(removed_at IS NULL) AS active_units,
    SUM(removed_at IS NULL AND cond = 'new') AS new_units,
    SUM(removed_at IS NULL AND cond = 'used') AS used_units,
    SUM(removed_at IS NULL AND price > 0) AS priced_units,
    ROUND(AVG(CASE WHEN removed_at IS NULL AND price > 0 THEN price END)) AS avg_price,
    ROUND(AVG(CASE WHEN removed_at IS NULL THEN ${dom} END), 1) AS avg_dom,
    SUM(removed_at IS NULL AND ${dom} <= 30) AS age_0_30,
    SUM(removed_at IS NULL AND ${dom} BETWEEN 31 AND 60) AS age_31_60,
    SUM(removed_at IS NULL AND ${dom} BETWEEN 61 AND 90) AS age_61_90,
    SUM(removed_at IS NULL AND ${dom} > 90) AS age_90_plus,
    SUM(DATE(COALESCE(crawl_first_seen, first_seen_at)) = '${d}') AS added_units,
    SUM(removed_at IS NOT NULL AND DATE(removed_at) = '${d}') AS removed_units,
    SUM(DATE(COALESCE(crawl_first_seen, first_seen_at)) >= '${in7}') AS added_7d,
    SUM(removed_at IS NOT NULL AND DATE(removed_at) >= '${in7}') AS removed_7d
  FROM dealer_inventory WHERE dealer_id BETWEEN ? AND ? AND ${notExcluded(excluded)} GROUP BY dealer_id ORDER BY dealer_id`;
}

export function dropsSql(day) {
  const d = assertYmd(day);
  const d7 = addDays(d, -7);
  const d30 = addDays(d, -30);
  const drop7 = `new_price < old_price AND changed_on > '${d7}'`;
  return `SELECT dealer_id,
    COUNT(DISTINCT CASE WHEN ${drop7} THEN vin END) AS drop_units_7d,
    COUNT(DISTINCT CASE WHEN new_price < old_price THEN vin END) AS drop_units_30d,
    ROUND(AVG(CASE WHEN ${drop7} THEN old_price - new_price END)) AS avg_drop_usd_7d,
    ROUND(AVG(CASE WHEN ${drop7} THEN (old_price - new_price) / old_price * 100 END), 2) AS avg_drop_pct_7d,
    ROUND(AVG(CASE WHEN new_price < old_price THEN old_price - new_price END)) AS avg_drop_usd_30d,
    ROUND(AVG(CASE WHEN new_price < old_price THEN (old_price - new_price) / old_price * 100 END), 2) AS avg_drop_pct_30d
  FROM dealer_price_changes WHERE dealer_id BETWEEN ? AND ? AND changed_on > '${d30}' AND changed_on <= '${d}' GROUP BY dealer_id`;
}

export const SUMMARY_COLUMNS = Object.freeze(["dealer_id", "day", "active_units", "new_units", "used_units", "priced_units", "avg_price", "avg_dom", "age_0_30", "age_31_60", "age_61_90", "age_90_plus", "added_units", "removed_units", "added_7d", "removed_7d", "drop_units_7d", "drop_units_30d", "avg_drop_usd_7d", "avg_drop_pct_7d", "avg_drop_usd_30d", "avg_drop_pct_30d", "computed_at"]);

const num = (v) => (v == null ? null : Number(v));
/** Merge one dealer's summary row with its drop stats (absent = no drops) into SUMMARY_COLUMNS order. computedAt is the DB's own NOW() read once per run. */
export function summaryRow(day, s, drops, computedAt) {
  const d = drops || {};
  return [Number(s.dealer_id), day, num(s.active_units) ?? 0, num(s.new_units) ?? 0, num(s.used_units) ?? 0, num(s.priced_units) ?? 0, num(s.avg_price), num(s.avg_dom),
    num(s.age_0_30) ?? 0, num(s.age_31_60) ?? 0, num(s.age_61_90) ?? 0, num(s.age_90_plus) ?? 0,
    num(s.added_units) ?? 0, num(s.removed_units) ?? 0, num(s.added_7d) ?? 0, num(s.removed_7d) ?? 0,
    num(d.drop_units_7d) ?? 0, num(d.drop_units_30d) ?? 0, num(d.avg_drop_usd_7d), num(d.avg_drop_pct_7d), num(d.avg_drop_usd_30d), num(d.avg_drop_pct_30d), computedAt];
}
/** Multi-row upsert of summaryRow() arrays. */
export function upsertSummarySql() {
  const set = SUMMARY_COLUMNS.filter((c) => c !== "dealer_id" && c !== "day").map((c) => `${c} = VALUES(${c})`).join(", ");
  return `INSERT INTO dealer_daily_summary (${SUMMARY_COLUMNS.join(", ")}) VALUES ? ON DUPLICATE KEY UPDATE ${set}`;
}

export const MARKET_MAKES_SQL = "SELECT make FROM dealer_inventory WHERE removed_at IS NULL AND make IS NOT NULL GROUP BY make";
export function marketSql(excluded) {
  return `SELECT model, year, cond, COUNT(*) AS units, COUNT(DISTINCT dealer_id) AS dealers, ROUND(AVG(price)) AS avg_price
    FROM dealer_inventory WHERE removed_at IS NULL AND make = ? AND ${notExcluded(excluded)} AND price >= 1000 AND model IS NOT NULL AND year IS NOT NULL AND cond IS NOT NULL
    GROUP BY model, year, cond`;
}
export const UPSERT_MARKET_SQL = "INSERT INTO market_price_daily (day, make, model, year, cond, units, dealers, avg_price, computed_at) VALUES ? ON DUPLICATE KEY UPDATE units = VALUES(units), dealers = VALUES(dealers), avg_price = VALUES(avg_price), computed_at = VALUES(computed_at)";
export function marketRows(day, make, rows, computedAt) {
  return rows
    .map((r) => [day, make, r.model, Number(r.year), r.cond, Number(r.units), Number(r.dealers), Number(r.avg_price), computedAt])
    .sort((a, b) => (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : a[3] - b[3] || (a[4] < b[4] ? -1 : a[4] > b[4] ? 1 : 0)));
}

// ---- validation probe helpers -------------------------------------------------------------------------------------------------
/** Deterministic stratified sample of dealers by size: `perBand` ids from each of five size bands. rows: [{dealer_id, units}] */
export function stratifiedSample(rows, perBand = 4, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const sorted = [...rows].sort((a, b) => a.units - b.units || a.dealer_id - b.dealer_id);
  const n = sorted.length;
  const out = [];
  for (const [lo, hi] of [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 0.97], [0.97, 1]]) {
    const seg = sorted.slice(Math.floor(lo * n), Math.floor(hi * n));
    const pool = [...seg];
    for (let i = 0; i < perBand && pool.length; i++) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0].dealer_id);
  }
  return out;
}

const intList = (ids) => ids.map((n) => { if (!Number.isInteger(Number(n))) throw new Error(`bad id: ${n}`); return Number(n); }).join(",");
/**
 * Compares the crawler's price_diff/old_price on current stock with price changes seen in dealer_inventory_days, per dealer.
 * a_n = stock rows with price_diff <> 0; match_exact = the same old->new change exists in the days table;
 * match_price = a change to the same new price exists; match_same_date = ... on DATE(last_seen_at).
 */
export function priceDiffValidationSql(dealerIds) {
  const ids = intList(dealerIds);
  return `WITH inv AS (SELECT vin, dealer_id, price, old_price, price_diff, DATE(last_seen_at) AS ls FROM dealer_inventory WHERE dealer_id IN (${ids}) AND removed_at IS NULL),
  d AS (SELECT x.vin, x.dealer_id, x.seen_on, x.price, LAG(x.price) OVER (PARTITION BY x.vin, x.dealer_id ORDER BY x.seen_on) AS prev FROM dealer_inventory_days x WHERE x.vin IN (SELECT vin FROM inv) AND x.dealer_id IN (${ids})),
  ev AS (SELECT vin, dealer_id, seen_on, prev, price FROM d WHERE prev IS NOT NULL AND price IS NOT NULL AND price <> prev)
  SELECT i.dealer_id, COUNT(*) AS units, SUM(i.price_diff <> 0) AS a_n,
    SUM(i.price_diff <> 0 AND EXISTS (SELECT 1 FROM ev e WHERE e.vin = i.vin AND e.dealer_id = i.dealer_id AND e.price = i.price AND e.prev = i.old_price)) AS match_exact,
    SUM(i.price_diff <> 0 AND EXISTS (SELECT 1 FROM ev e WHERE e.vin = i.vin AND e.dealer_id = i.dealer_id AND e.price = i.price)) AS match_price,
    SUM(i.price_diff <> 0 AND EXISTS (SELECT 1 FROM ev e WHERE e.vin = i.vin AND e.dealer_id = i.dealer_id AND e.seen_on = i.ls AND e.price = i.price AND e.prev = i.old_price)) AS match_same_date
  FROM inv i GROUP BY i.dealer_id ORDER BY units`;
}
export const SUSPECTS_SQL = "SELECT dealer_id, COUNT(*) AS units, COUNT(DISTINCT make) AS makes FROM dealer_inventory WHERE removed_at IS NULL AND dealer_id > 0 GROUP BY dealer_id HAVING units >= ? ORDER BY makes DESC, units DESC";
export const SIZES_SQL = "SELECT dealer_id, COUNT(*) AS units FROM dealer_inventory WHERE removed_at IS NULL AND dealer_id > 0 GROUP BY dealer_id";
export const TABLE_RANGE_SQL = "SELECT DATE_FORMAT(MIN(changed_on), '%Y-%m-%d') AS lo, DATE_FORMAT(MAX(changed_on), '%Y-%m-%d') AS hi FROM dealer_price_changes";
export const TABLE_EVENTS_SQL = "SELECT dealer_id, DATE_FORMAT(changed_on, '%Y-%m-%d') AS changed_on, vin, old_price, new_price FROM dealer_price_changes WHERE dealer_id IN (?) AND changed_on BETWEEN ? AND ?";
export const DEALER_VINS_SQL = "SELECT vin FROM dealer_inventory WHERE dealer_id = ?";
