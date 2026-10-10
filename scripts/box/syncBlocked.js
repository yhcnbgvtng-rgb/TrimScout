// Which stores' sites blocked the crawl last night, for the admin Vehicles sheet's "blocked, no bypass" flag.
//
// The crawler never bypasses bot protection: when a dealer's site answers its probe with a Cloudflare / Vercel challenge, an Akamai-style
// 403 or a 429, it logs one line and skips the store ("🛡️ SKIP <store>: HTTP_403 (403) — ...; vendor=Akamai [https://site/sitemap.xml]").
// Those lines are the only per-store record of it, so the nightly sync reads them from the crawl logs and tells the deals API which stores
// were blocked tonight. Best effort: a failure here never fails the sync.

import fs from "node:fs";
import path from "node:path";

export const BLOCKED_PATH = "/api/inventory/blocked-stores";
/** The crawler's bot-protected classes (bot_protection.js WAF_CLASSES). DNS/404/5xx/timeouts are "uncrawlable" but not a block. */
export const BLOCK_CLASSES = new Set(["CLOUDFLARE", "VERCEL_CHECKPOINT", "HTTP_403", "HTTP_429"]);

const SKIP_RE = /🛡️ SKIP (.+?): ([A-Z_0-9]+)(?: \((\d{3})\))? — (.*?)(?:; vendor=([A-Za-z0-9_-]+))? \[(https?:\/\/[^\]\s]+)\]/;

/** Blocked stores named in one crawl log's text: [{ name, cls, vendor, url }], first line per store wins. */
export function parseBlockedLines(text) {
  const out = new Map();
  for (const line of String(text).split("\n")) {
    if (!line.includes("SKIP")) continue;
    const m = SKIP_RE.exec(line);
    if (!m || !BLOCK_CLASSES.has(m[2])) continue;
    const name = m[1].trim();
    if (!out.has(name)) out.set(name, { name, cls: m[2], vendor: m[5] || null, url: m[6] });
  }
  return [...out.values()];
}

/** Logs written within `windowMs` before `nowMs`, excluding the pre-crawl probe reports (they list every rooftop, blocked or not). */
export function recentCrawlLogs(dir, nowMs, windowMs = 30 * 3600_000) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => n.endsWith(".log") && !n.includes("bot-report") && !n.includes("write-dealers") && !n.startsWith("run-all"))
    .map((n) => path.join(dir, n))
    .filter((f) => { try { return nowMs - fs.statSync(f).mtimeMs <= windowMs; } catch { return false; } });
}

/**
 * @param {object} p
 * @param {string[]} p.files          crawl logs to read
 * @param {(entry: { name: string, url: string }) => number | null} p.dealerIdFor  resolves a blocked store to its directory id (by site host, then name)
 */
export function collectBlocked({ files, dealerIdFor, readFile = (f) => fs.readFileSync(f, "utf8") }) {
  const byId = new Map();
  let unmatched = 0;
  for (const f of files) {
    let text;
    try { text = readFile(f); } catch { continue; }
    for (const e of parseBlockedLines(text)) {
      const id = dealerIdFor({ name: e.name, url: e.url });
      if (!id) { unmatched++; continue; }
      if (!byId.has(id)) byId.set(id, { dealerId: id, name: e.name, cls: e.cls, vendor: e.vendor });
    }
  }
  return { stores: [...byId.values()].sort((a, b) => a.dealerId - b.dealerId), unmatched };
}

/** Tell the deals API tonight's blocked list for this box. Never throws. */
export async function postBlocked({ api, box, date, stores, log = console.log }) {
  try {
    const r = await api(BLOCKED_PATH, { box, date, stores });
    log(`[sync] blocked stores reported for ${box}: ${stores.length} (${JSON.stringify(r)})`);
    return r;
  } catch (err) {
    log(`[sync] blocked-stores report failed (non-fatal): ${err.message}`);
    return null;
  }
}
