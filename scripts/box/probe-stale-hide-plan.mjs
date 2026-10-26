#!/usr/bin/env node
/**
 * Read-only: does the buyer search's `seenWithinDays` clause (i.last_seen_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) keep the
 * list and count queries index-bounded? For a few typical buyer searches it EXPLAINs the query WITHOUT the clause and WITH it
 * (EXPLAIN never runs the query) and checks that the clause is a plain post-filter: same index, same access type, no full
 * scan, no new temporary table. Row estimates are printed for the record only: a bare make is a big ref scan either way, and
 * the page has a LIMIT / the count has a cap. Uses the reader login only; writes nothing.
 *
 *   node probe-stale-hide-plan.mjs [/opt/trimscout-deals/src/inventoryListQuery.js]   (on the deals box; env file below)
 *
 *   exit 0  every case keeps the plan it had without the clause
 *   exit 1  at least one case changed plan or full-scans (prints which)
 *   exit 2  could not tell (no credentials, DB unreachable)
 *
 * Env: DB_ENV_FILE (default /opt/trimscout-deals/.env.trimscout-db) with DB_HOST, DB_PORT, DB_NAME, DB_READER_USER,
 * DB_READER_PASSWORD.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modPath = path.resolve(process.argv[2] || new URL("../../scrapers/lightsail-crawler/src/inventoryListQuery.js", import.meta.url).pathname);
const envFile = process.env.DB_ENV_FILE || "/opt/trimscout-deals/.env.trimscout-db";
const DAYS = 7; // STALE_HIDE_DAYS in lib/lastConfirmed.ts

const env = { ...process.env };
try {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* fall back to the process env */ }
if (!env.DB_READER_USER || !env.DB_READER_PASSWORD) { console.error(`DB_READER_USER / DB_READER_PASSWORD not found (looked in ${envFile} and the environment)`); process.exit(2); }

const { inventoryListQuery } = await import(pathToFileURL(modPath).href);
const mysql = createRequire(modPath)("mysql2/promise"); // resolved next to the deals code, which has it installed
let conn;
try {
  conn = await mysql.createConnection({ host: env.DB_HOST || "127.0.0.1", port: Number(env.DB_PORT || 3306), user: env.DB_READER_USER, password: env.DB_READER_PASSWORD, database: env.DB_NAME });
  await conn.query("SET SESSION max_statement_time = 20");
} catch (e) { console.error(`cannot connect: ${e.message}`); process.exit(2); }

// The shapes buyers send: a make is always required (parseBuyerSearchParams).
const CASES = [
  ["make", "make=Toyota"],
  ["make+state", "make=Toyota&state=NJ"],
  ["make+model", "make=Toyota&model=RAV4"],
  ["make+model+state", "make=Toyota&model=RAV4&state=NJ"],
].map(([name, qs]) => [name, qs + "&inStock=1&retailOnly=1"]);

const planOf = async (sql, args) => {
  const [rows] = await conn.query(`EXPLAIN ${sql}`, args);
  const t = rows.find((r) => r.table === "i") || rows[0];
  return { type: t.type, key: t.key, rows: Number(t.rows), extra: t.Extra || "" };
};

let bad = 0;
for (const [name, qs] of CASES) {
  {
    const base = inventoryListQuery(new URLSearchParams(qs));
    const seen = inventoryListQuery(new URLSearchParams(`${qs}&seenWithinDays=${DAYS}`));
    for (const [what, mk] of [["list", (q) => [`SELECT i.vin ${q.sql} ORDER BY ${q.orderBy} LIMIT 50`, q.args]], ["count", (q) => [`SELECT COUNT(*) ${q.countSql}`, q.args]]]) {
      const [bSql, bArgs] = mk(base), [sSql, sArgs] = mk(seen);
      const [b, s] = [await planOf(bSql, bArgs), await planOf(sSql, sArgs)];
      const problems = [];
      if (s.type === "ALL" || !s.key) problems.push("full scan / no index");
      if (s.key !== b.key) problems.push(`index changed (${b.key} -> ${s.key})`);
      if (s.type !== b.type) problems.push(`access type changed (${b.type} -> ${s.type})`);
      if (/Using temporary/.test(s.extra) && !/Using temporary/.test(b.extra)) problems.push("new temporary table");
      if (problems.length) bad++;
      console.log(`${problems.length ? "FAIL" : "ok  "} ${name} ${what}: without ${b.key} ${b.type} ~${b.rows} | with ${s.key} ${s.type} ~${s.rows}${problems.length ? ` — ${problems.join("; ")}` : ""}`);
    }
  }
}
await conn.end();
console.log(bad ? `${bad} case(s) need a look before the filter is relied on.` : "seenWithinDays kept every plan index-bounded.");
process.exit(bad ? 1 : 0);
