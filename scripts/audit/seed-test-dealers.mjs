// Creates the three test dealerships (dealership_contacts.is_test = 1) the audit harness uses.
// Dry run by default; --apply writes. Idempotent by name, and it refuses to touch a real dealership:
// if a row with one of these names already exists with is_test = 0 it aborts.
//
//   node scripts/audit/seed-test-dealers.mjs
//   node scripts/audit/seed-test-dealers.mjs --apply
//
// Run on the deals box from /opt/trimscout-deals (reads .env.trimscout-db), on Paul's GO — after the
// deals API has restarted once so the is_test column exists (or this script adds it).
// Emails use the reserved .test TLD: undeliverable by construction, on top of SAFE MODE.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TEST_DEALERS = [1, 2, 3].map((n) => ({
  dealer_name: `AUDIT TEST Dealer ${n}`,
  address: `${n} Audit Way`,
  city: "Testville",
  state: "NJ",
  zip_code: "00000",
  phone: "000-000-0000",
  contact_name: `Audit Desk ${n}`,
  contact_email: `audit-dealer-${n}@audit.trimscout.test`,
  notes: "TEST DEALERSHIP for the audit harness. is_test = 1. Never invite from a real RFQ.",
}));

/** `query(sql, params)` resolves to [rows]. */
export async function seedTestDealers({ query, apply, log = console.log }) {
  await query("ALTER TABLE dealership_contacts ADD COLUMN IF NOT EXISTS is_test TINYINT(1) NOT NULL DEFAULT 0", []);
  const plan = [];
  for (const d of TEST_DEALERS) {
    const [rows] = await query("SELECT id, is_test FROM dealership_contacts WHERE LOWER(dealer_name) = LOWER(?)", [d.dealer_name]);
    if (rows.length > 0 && !Number(rows[0].is_test)) {
      throw new Error(`refusing: a real dealership named "${d.dealer_name}" already exists (id ${rows[0].id}, is_test = 0)`);
    }
    plan.push({ dealer: d, action: rows.length > 0 ? "exists" : "create" });
  }
  log(`${apply ? "APPLY" : "DRY RUN"}:`);
  for (const p of plan) log(`  ${p.action.padEnd(6)} ${p.dealer.dealer_name} <${p.dealer.contact_email}>`);
  if (!apply) {
    log("Dry run only — nothing written. Re-run with --apply.");
    return plan;
  }
  for (const p of plan) {
    if (p.action !== "create") continue;
    const d = p.dealer;
    await query(
      "INSERT INTO dealership_contacts (dealer_name, address, city, state, zip_code, phone, contact_name, contact_email, notes, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      [d.dealer_name, d.address, d.city, d.state, d.zip_code, d.phone, d.contact_name, d.contact_email, d.notes]
    );
  }
  const [after] = await query("SELECT COUNT(*) AS n FROM dealership_contacts WHERE is_test = 1", []);
  log(`test dealerships now: ${after[0].n}`);
  return plan;
}

async function main() {
  const apply = process.argv.includes("--apply");
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
    await seedTestDealers({ query: (sql, params) => pool.query(sql, params), apply });
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
