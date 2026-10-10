// Storage rules for the admin "blocked, no bypass" flag: POST /api/inventory/blocked-stores from each box's nightly sync,
// GET for the admin Vehicles sheet. Extracted from deals_api_server.js (which starts a real server when imported) so it can be unit-tested.
//
// Each box reports the stores whose sites blocked ITS crawl tonight. A report replaces that box's earlier one: stores still blocked keep
// their first_blocked_on, stores no longer listed drop out, so a store that gets through again un-flags itself.

export const MAX_BLOCKED_STORES = 2000;
export const BLOCKED_CLASSES = new Set(["CLOUDFLARE", "VERCEL_CHECKPOINT", "HTTP_403", "HTTP_429"]);

/**
 * @returns {{ ok: true, box: string, date: string, stores: { dealerId: number, name: string, cls: string, vendor: string|null }[] } | { ok: false, error: string }}
 */
export function parseBlockedReport(body, { toInt, toStr }) {
  const box = typeof body?.box === "string" ? toStr(body.box, 16) : null;
  if (!box) return { ok: false, error: "box is required" };
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  if (!date) return { ok: false, error: "date (YYYY-MM-DD) is required" };
  if (!Array.isArray(body.stores)) return { ok: false, error: "stores[] is required" };
  if (body.stores.length > MAX_BLOCKED_STORES) return { ok: false, error: `stores is limited to ${MAX_BLOCKED_STORES} per report` };
  const seen = new Map();
  for (const s of body.stores) {
    const dealerId = toInt(s?.dealerId);
    const cls = typeof s?.cls === "string" ? s.cls : "";
    if (dealerId == null || dealerId <= 0 || !BLOCKED_CLASSES.has(cls)) return { ok: false, error: "every store needs a positive dealerId and a bot-protection cls" };
    if (!seen.has(dealerId)) seen.set(dealerId, { dealerId, name: toStr(s.name, 255) || "", cls, vendor: s.vendor ? toStr(s.vendor, 32) : null });
  }
  return { ok: true, box, date, stores: [...seen.values()] };
}

export const BLOCKED_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS crawl_blocked_stores (" +
  "dealer_id INT NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL, block_class VARCHAR(24) NOT NULL, vendor VARCHAR(32) NULL, " +
  "source_box VARCHAR(16) NOT NULL, first_blocked_on DATE NOT NULL, last_blocked_on DATE NOT NULL)";

/** Upsert tonight's stores (first_blocked_on kept when the store was already flagged), in one statement; null when there are none. */
export function buildBlockedUpsert({ box, date, stores }) {
  if (!stores.length) return null;
  return {
    sql: "INSERT INTO crawl_blocked_stores (dealer_id, name, block_class, vendor, source_box, first_blocked_on, last_blocked_on) VALUES ? " +
      "ON DUPLICATE KEY UPDATE name = VALUES(name), block_class = VALUES(block_class), vendor = VALUES(vendor), source_box = VALUES(source_box), last_blocked_on = VALUES(last_blocked_on)",
    args: [stores.map((s) => [s.dealerId, s.name, s.cls, s.vendor, box, date, date])],
  };
}

/** Drop this box's flags that tonight's report no longer lists (the store got through, or was not probed). */
export function buildBlockedCleanup({ box, date }) {
  return { sql: "DELETE FROM crawl_blocked_stores WHERE source_box = ? AND last_blocked_on < ?", args: [box, date] };
}

// mysql2 hands a DATE column back as a Date at local midnight (or a string, with dateStrings): format either as YYYY-MM-DD in local time.
const ymd = (v) => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
};

export function blockedRowsToJson(rows) {
  return rows.map((r) => ({
    dealerId: Number(r.dealer_id), name: r.name, cls: r.block_class, vendor: r.vendor ?? null, box: r.source_box,
    firstBlockedOn: ymd(r.first_blocked_on), lastBlockedOn: ymd(r.last_blocked_on),
  }));
}
