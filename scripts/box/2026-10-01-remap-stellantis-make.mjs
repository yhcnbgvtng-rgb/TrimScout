// One-shot backfill: rewrite dealer_inventory.make = 'Stellantis' (the crawl-scope umbrella, never a real
// make) to the vehicle's real nameplate/manufacturer using src/stellantisMake.js — the same resolver the
// crawler and the deals API now apply on every write. Confirmed live 2026-10-01: ~19k in-stock + ~4.6k
// removed rows carried make='Stellantis'. See the PR for the mapping tiers and the measured accuracy.
//
// Safe by construction:
//  - DEFAULT IS A DRY RUN: reads the umbrella rows (one covered-index scan on idx_inv_make_dealer's
//    make prefix), resolves each in JS, prints counts by target make + resolution tier + residual.
//  - --apply updates by primary key (vin, dealer_id) in small batches, one make per statement, with a
//    pause between batches; it never reads or touches any other column or row, and an unresolvable row
//    is left exactly as-is (listed in the residual, not guessed).
//  - --apply refuses to run unless --fleet-idle is also passed (the operator asserts all four boxes'
//    crawls and syncs are finished — a sync running mid-update just re-writes make from stale shards
//    through the (now normalizing) API, which is harmless, but the point is to not add DB load to a
//    live sync). If TRIMSCOUT_API_KEY is set it additionally takes the deals-API sync lock for the
//    duration so no sync can start; it releases it in a finally block.
//  - Idempotent: re-running after a partial run only sees the rows still marked Stellantis.
//
// Usage (from /opt/trimscout-deals on box2; needs src/stellantisMake.js + src/stellantisVinTable.js deployed):
//   node 2026-10-01-remap-stellantis-make.mjs                       # dry run (counts only)
//   node 2026-10-01-remap-stellantis-make.mjs --apply --fleet-idle  # perform the UPDATE
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const FLEET_IDLE = process.argv.includes("--fleet-idle");
const BATCH = 500;
const PAUSE_MS = 150;

const modPath = path.resolve(process.cwd(), "src/stellantisMake.js");
if (!fs.existsSync(modPath)) {
  console.error(`Missing ${modPath} — deploy src/stellantisMake.js and src/stellantisVinTable.js to the box first.`);
  process.exit(1);
}
const { resolveUmbrellaMake, UMBRELLA_MAKE } = await import(modPath);

if (APPLY && !FLEET_IDLE) {
  console.error("Refusing to --apply without --fleet-idle (confirm no crawl/sync is running on any box first).");
  process.exit(1);
}

function loadDbEnv() {
  const raw = fs.readFileSync(path.resolve(process.cwd(), ".env.trimscout-db"), "utf-8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function lockCall(action, owner) {
  const key = process.env.TRIMSCOUT_API_KEY;
  if (!key) return null;
  const r = await fetch(`http://127.0.0.1:3004/api/ops/sync-lock/${action}`, {
    method: "POST",
    headers: { "X-Trimscout-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ owner }),
  });
  return r.json();
}

async function main() {
  const env = loadDbEnv();
  const pool = await mysql.createPool({
    host: env.DB_HOST, user: env.DB_WRITER_USER || env.DB_USER, password: env.DB_WRITER_PASSWORD || env.DB_PASSWORD,
    database: env.DB_NAME || "trimscout", connectionLimit: 2,
  });

  const [rows] = await pool.query(
    "SELECT vin, dealer_id, model, removed_at IS NULL AS in_stock FROM dealer_inventory WHERE make = ?",
    [UMBRELLA_MAKE],
  );
  console.log(`${APPLY ? "LIVE" : "DRY RUN"} — ${rows.length} rows with make='${UMBRELLA_MAKE}'`);

  const byMake = new Map(); // make -> [{vin, dealer_id}]
  const stats = {};
  const residual = [];
  for (const r of rows) {
    const { make, via } = resolveUmbrellaMake({ vin: r.vin, model: r.model });
    const bucket = make || "(unresolved)";
    const s = (stats[bucket] ||= { inStock: 0, removed: 0, via: {} });
    s[r.in_stock ? "inStock" : "removed"]++;
    s.via[via || "none"] = (s.via[via || "none"] || 0) + 1;
    if (make) {
      if (!byMake.has(make)) byMake.set(make, []);
      byMake.get(make).push([r.vin, r.dealer_id]);
    } else residual.push(r);
  }
  console.log("\nTarget make        in-stock  removed   via");
  for (const [m, s] of Object.entries(stats).sort((a, b) => b[1].inStock - a[1].inStock)) {
    console.log(`${m.padEnd(18)} ${String(s.inStock).padStart(8)} ${String(s.removed).padStart(8)}   ${JSON.stringify(s.via)}`);
  }
  if (residual.length) {
    console.log(`\nResidual (left untouched): ${residual.length} rows; first 15 VIN prefixes/models:`);
    for (const r of residual.slice(0, 15)) console.log(`  ${r.vin} model=${r.model ?? ""} in_stock=${r.in_stock}`);
  }
  if (!APPLY) { await pool.end(); return; }

  const owner = `stellantis-remap-${process.pid}`;
  const lock = await lockCall("acquire", owner);
  if (lock && !lock.acquired) {
    console.error(`Sync lock is held (${JSON.stringify(lock)}) — a sync is running. Aborting, nothing changed.`);
    await pool.end();
    process.exit(2);
  }
  try {
    let updated = 0;
    for (const [make, pks] of byMake) {
      for (let i = 0; i < pks.length; i += BATCH) {
        const chunk = pks.slice(i, i + BATCH);
        // vin IN (...) hits the primary key's vin prefix; a (vin, dealer_id) row-constructor IN beside make=
        // made MariaDB scan the table (116s+ per 500-row batch on 2026-10-02). Same VIN resolves to the same
        // make for every store's row, so matching on vin alone (still guarded by make = umbrella) is exact.
        const vins = [...new Set(chunk.map((c) => c[0]))];
        const ph = vins.map(() => "?").join(",");
        const [res] = await pool.query(
          `UPDATE dealer_inventory SET make = ? WHERE vin IN (${ph}) AND make = ?`,
          [make, ...vins, UMBRELLA_MAKE],
        );
        updated += res.affectedRows;
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      }
      console.log(`updated -> ${make}: ${pks.length} planned`);
    }
    console.log(`\nDone: ${updated} rows updated, ${residual.length} residual left as '${UMBRELLA_MAKE}'.`);
  } finally {
    if (lock) await lockCall("release", owner).catch(() => {});
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
