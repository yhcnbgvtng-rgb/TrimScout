// Soft-deletes audit records (audit = 1) older than N days (default 7). Dry run by default.
//
//   node scripts/audit/audit-cleanup.mjs                       # dry run: counts per table, writes nothing
//   node scripts/audit/audit-cleanup.mjs --apply --expect-total 42
//
// --apply refuses unless --expect-total equals what the dry run just reported, so a write is always
// preceded by a dry run you read. Only rows with audit = 1 AND deleted_at IS NULL AND audit_at older than
// the cutoff are touched, and only deleted_at is set — nothing is hard-deleted. Run on the deals box from
// /opt/trimscout-deals (reads .env.trimscout-db), on Paul's GO.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Children before parents, purely for readable output; each table is independent.
export const CLEANUP_TABLES = ["rfq_events", "rfq_quotes", "rfq_invites", "rfq_requests", "deals", "deal_bids", "deal_requests"];
export const DEFAULT_DAYS = 7;

/** The WHERE every statement shares. Never touches audit = 0 rows. */
export const CLEANUP_WHERE = "audit = 1 AND deleted_at IS NULL AND audit_at IS NOT NULL AND audit_at < (NOW() - INTERVAL ? DAY)";

export function countSql(table) {
  assertTable(table);
  return `SELECT COUNT(*) AS n FROM ${table} WHERE ${CLEANUP_WHERE}`;
}
export function updateSql(table) {
  assertTable(table);
  return `UPDATE ${table} SET deleted_at = NOW() WHERE ${CLEANUP_WHERE}`;
}
function assertTable(table) {
  if (!CLEANUP_TABLES.includes(table)) throw new Error(`refusing unknown table ${table}`);
}

export function parseArgs(argv) {
  const out = { apply: false, days: DEFAULT_DAYS, expectTotal: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--days") out.days = Number(argv[++i]);
    else if (a === "--expect-total") out.expectTotal = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!Number.isInteger(out.days) || out.days < 1) throw new Error("--days must be a whole number >= 1");
  return out;
}

/** `query(sql, params)` resolves to [rows]. Returns { counts, total, applied }. */
export async function runCleanup({ query, args, log = console.log }) {
  const counts = {};
  for (const t of CLEANUP_TABLES) {
    const [rows] = await query(countSql(t), [args.days]);
    counts[t] = Number(rows[0].n);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  log(`${args.apply ? "APPLY" : "DRY RUN"}: audit records older than ${args.days} days, not yet soft-deleted`);
  for (const t of CLEANUP_TABLES) log(`  ${t.padEnd(14)} ${counts[t]}`);
  log(`  ${"total".padEnd(14)} ${total}`);
  if (!args.apply) {
    log(total ? `Dry run only — nothing written. To apply: --apply --expect-total ${total}` : "Nothing to clean up.");
    return { counts, total, applied: false };
  }
  if (args.expectTotal !== total) {
    throw new Error(`refusing to apply: --expect-total ${args.expectTotal} does not match the ${total} rows found (run the dry run first)`);
  }
  for (const t of CLEANUP_TABLES) {
    if (counts[t] === 0) continue;
    const [res] = await query(updateSql(t), [args.days]);
    log(`  soft-deleted ${res.affectedRows} from ${t}`);
  }
  return { counts, total, applied: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = fs.readFileSync(path.resolve(process.cwd(), ".env.trimscout-db"), "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
  const mysql = (await import("mysql2/promise")).default;
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME,
    user: process.env.DB_WRITER_USER,
    password: process.env.DB_WRITER_PASSWORD,
    connectionLimit: 2,
  });
  try {
    await runCleanup({ query: (sql, params) => pool.query(sql, params), args });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
