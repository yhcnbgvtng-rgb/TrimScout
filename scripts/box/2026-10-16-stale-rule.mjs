// Last-seen staleness rule, box patch. DRY RUN by default: READER account only, read-only queries with a server-side cap, writes nothing,
// takes no sync lock, restarts nothing. Prints how many live cars the hide line (default 4 days) and the retire line (default 14 days)
// would take out, per brand and per box, and how many an open RFQ / quote / deal spares from retirement.
//
//   node 2026-10-16-stale-rule.mjs [--env /opt/trimscout-deals/.env.trimscout-db] [--hide 4] [--retire 14]
//   STALE_RULE=1 node 2026-10-16-stale-rule.mjs --apply     retire past the line (writer account); refuses unless STALE_RULE=1. Needs Paul's GO.
//
// Hiding is not a write: the web sends seenWithinDays and the box filters at query time (STALE_RULE=1 on the web env switches 7 -> 4 days).
// Run when the fleet is idle and the sync lock is free, never in the crawl window.
import fs from "node:fs";
import mysql from "mysql2/promise";
import { staleRuleConfig, perBrandSql, summarize, spareCountSql, OPEN_VINS_SQL, buildRetireStatement } from "../../scrapers/lightsail-crawler/src/staleRule.js";
import { pointsAtDeadIp } from "../../config/boxes.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const apply = args.includes("--apply");
const cfg = staleRuleConfig({ ...process.env, ...(opt("hide") ? { STALE_RULE_HIDE_DAYS: opt("hide") } : {}), ...(opt("retire") ? { STALE_RULE_RETIRE_DAYS: opt("retire") } : {}) });
if (apply && !cfg.enabled) { console.error("Refusing --apply: STALE_RULE is not 1."); process.exit(2); }

const env = {};
for (const line of fs.readFileSync(opt("env", "/opt/trimscout-deals/.env.trimscout-db"), "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
if (pointsAtDeadIp(env.DB_HOST, process.env.TRIMSCOUT_DEALS_HOST)) { console.error("Refusing to run: points at a retired box IP (docs/BOXES.md)."); process.exit(1); }
const user = apply ? env.DB_USER : env.DB_READER_USER;
if (!user) { console.error(`No ${apply ? "DB_USER" : "DB_READER_USER"} in the env file.`); process.exit(1); }
const conn = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user, password: apply ? env.DB_PASSWORD : env.DB_READER_PASSWORD, database: env.DB_NAME });
const q = async (sql, a = []) => (await conn.query(`SET STATEMENT max_statement_time=120 FOR ${sql}`, a))[0];

try {
  const hide = summarize(await q(perBrandSql(cfg.hideDays)));
  const retire = summarize(await q(perBrandSql(cfg.retireDays)));
  const sparedByOpenQuote = Number((await q(spareCountSql(cfg.retireDays)))[0].spared);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", flag: cfg.enabled ? "on" : "off", hideDays: cfg.hideDays, retireDays: cfg.retireDays, wouldHide: hide, wouldRetire: { ...retire, sparedByOpenQuote } }, null, 2));
  if (apply) {
    const openVins = (await q(OPEN_VINS_SQL)).map((r) => Object.values(r)[0]).filter(Boolean);
    const ids = (await q(`SELECT DISTINCT dealer_id FROM dealer_inventory FORCE INDEX (idx_inv_stock_dealer_id) WHERE removed_at IS NULL AND dealer_id > 0 AND last_seen_at < NOW() - INTERVAL ${cfg.retireDays} DAY`)).map((r) => r.dealer_id);
    let retired = 0;
    for (let i = 0; i < ids.length; i += 25) { const st = buildRetireStatement(ids.slice(i, i + 25), cfg.retireDays, openVins); retired += (await conn.query(st.sql, st.args))[0].affectedRows; }
    console.log(JSON.stringify({ retired }));
  }
} finally { await conn.end(); }
