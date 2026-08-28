// MariaDB persistence layer for the crawler (Step 2 of the JSON-file →
// database migration). Purely additive: enricher.js/standalone.js keep
// writing their existing JSON files exactly as before; this module is an
// extra sink that both call into, guarded so a DB outage never breaks the
// crawl.
//
// Credentials come from `.env.trimscout-db` (box-only, untracked — see
// `.env.trimscout-db.example` for the expected variable names) via a
// minimal hand-rolled loader below rather than adding a `dotenv`
// dependency. Cron on the Lightsail box runs `cd <tracker-dir> && node
// src/standalone.js` with no env-loading wrapper, so this file has to load
// it itself off `process.cwd()` — same pattern standalone.js already uses
// for `data/` and `dealers.json`.

import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';

function loadDbEnv() {
  const envPath = path.resolve(process.cwd(), '.env.trimscout-db');
  let raw;
  try {
    raw = fs.readFileSync(envPath, 'utf-8');
  } catch {
    return; // no env file present — DB_HOST etc. simply stay unset, and
             // every exported function below is a no-op-safe failure that
             // callers already wrap in try/catch.
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Real environment variables (if this ever runs somewhere that sets
    // them directly) always win over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDbEnv();

let pool = null;
// Exported (in addition to the higher-level functions below) so one-off
// operational scripts — e.g. scripts/backfill_porsche_model_normalization.mjs
// — can run their own targeted queries against the exact same pool/
// credentials setup instead of duplicating the connection code.
export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      database: process.env.DB_NAME,
      user: process.env.DB_WRITER_USER,
      password: process.env.DB_WRITER_PASSWORD,
      waitForConnections: true,
      connectionLimit: 5,
      dateStrings: false,
    });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

const CHUNK_SIZE = 500;

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toMysqlDatetime(isoStringOrDate) {
  if (!isoStringOrDate) return null;
  const d = isoStringOrDate instanceof Date ? isoStringOrDate : new Date(isoStringOrDate);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function isValidVin(vin) {
  return typeof vin === 'string' && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);
}

// Normalizes the scraper's inventoryType into the DB's stricter
// enum('NEW','USED','CERTIFIED_PRE_OWNED'). Confirmed live in both
// national_inventory_latest.json files: the real data also contains
// 'CERTIFIED' (Porsche's own retailer platform's term for CPO) and a
// handful of 'WHOLESALE' listings, neither of which is a DB enum member.
// WHOLESALE vehicles are used vehicles being liquidated, not new or
// certified, so they fold into USED rather than being rejected outright.
function normalizeInventoryType(t) {
  switch (t) {
    case 'NEW':
      return 'NEW';
    case 'CERTIFIED_PRE_OWNED':
    case 'CERTIFIED':
      return 'CERTIFIED_PRE_OWNED';
    case 'USED':
    case 'WHOLESALE':
    default:
      return 'USED';
  }
}

// Defensive truncation for free-text scraped fields against their column
// limits. Confirmed live: some dealer platforms publish an `engine` string
// well past vehicles.engine's varchar(128) (a full spec sentence, e.g.
// "3L V-6 gasoline direct injection, DOHC, VarioCam Plus variable valve
// control, intercooled turbo, premium unleaded, engine with 335HP" — 132
// chars) that would otherwise fail the whole chunk's INSERT with
// ER_DATA_TOO_LONG. Truncating (not dropping) the record keeps the vehicle
// itself in the DB with whatever of that field actually fits.
function truncate(value, max) {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function slugify(s) {
  return (
    (s || 'dealer')
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'dealer'
  );
}

function buildSearchText(v) {
  const optionNames = Array.isArray(v.factoryOptions) ? v.factoryOptions.map((o) => o.name).filter(Boolean) : [];
  const parts = [v.vin, v.year, v.make, v.model, v.trim, v.bodyStyle, v.dealerName, v.state, v.exteriorColor, optionNames.join(' ')];
  return parts.filter(Boolean).join(' ').slice(0, 1024);
}

function buildOptionsSearchText(v) {
  const optionNames = Array.isArray(v.factoryOptions) ? v.factoryOptions.map((o) => o.name).filter(Boolean) : [];
  const text = optionNames.join(' ').slice(0, 512);
  return text || null;
}

// ---------------------------------------------------------------------------
// upsertBrand — idempotent. The `id = LAST_INSERT_ID(id)` trick makes
// result.insertId reflect the *existing* row's id on a duplicate-key
// update too, not just on a fresh insert, so callers always get a real id
// back with a single round trip.
export async function upsertBrand(code, name) {
  const [result] = await getPool().query(
    `INSERT INTO brands (code, name) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), id = LAST_INSERT_ID(id)`,
    [code, name]
  );
  return result.insertId;
}

// upsertDealers — one transaction, bulk upsert matched on (brand_id,
// external_id). external_id is the dealer's own stable slug from
// dealers.json (`id`, e.g. "porsche-beverly-hills") when present; derived
// from the domain/name otherwise, since not every historical dealers.json
// entry is guaranteed to carry one.
export async function upsertDealers(brandId, dealersArray) {
  if (!Array.isArray(dealersArray) || dealersArray.length === 0) return;
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const batch of chunkArray(dealersArray, 500)) {
      const cols = [
        'brand_id', 'external_id', 'name', 'domain', 'city', 'state',
        'latitude', 'longitude',
        'sitemap_url', 'inventory_sitemap_url', 'fallback_url',
      ];
      const placeholders = batch.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
      const values = [];
      for (const d of batch) {
        const externalId = (d.id || slugify(d.domain || d.name)).toString().slice(0, 128);
        values.push(
          brandId,
          externalId,
          d.name,
          d.domain || null,
          d.city || null,
          d.state || null,
          typeof d.lat === 'number' ? d.lat : null,
          typeof d.lng === 'number' ? d.lng : null,
          d.sitemapUrl || null,
          d.inventorySitemapUrl || null,
          d.fallbackUrl || null,
        );
      }
      const sql = `INSERT INTO dealers (${cols.join(',')}) VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          name = VALUES(name), domain = VALUES(domain), city = VALUES(city),
          state = VALUES(state),
          latitude = COALESCE(VALUES(latitude), latitude),
          longitude = COALESCE(VALUES(longitude), longitude),
          sitemap_url = VALUES(sitemap_url),
          inventory_sitemap_url = VALUES(inventory_sitemap_url),
          fallback_url = VALUES(fallback_url)`;
      await conn.query(sql, values);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function startScrapeRun(brandId, dealersConfigured) {
  const now = toMysqlDatetime(new Date());
  const runDate = now.slice(0, 10);
  const [result] = await getPool().query(
    `INSERT INTO scrape_runs (brand_id, run_date, started_at, status, dealers_configured)
     VALUES (?, ?, ?, 'RUNNING', ?)`,
    [brandId, runDate, now, dealersConfigured || 0]
  );
  return result.insertId;
}

export async function finishScrapeRun(runId, stats = {}, errorMessage = null) {
  if (!runId) return;
  const now = toMysqlDatetime(new Date());
  await getPool().query(
    `UPDATE scrape_runs SET
       status = ?, finished_at = ?, dealers_active = ?, dealers_errored = ?,
       total_vehicles = ?, new_arrivals = ?, price_drops = ?, price_increases = ?,
       sold_or_removed = ?, error_summary = ?
     WHERE id = ?`,
    [
      errorMessage ? 'FAILED' : 'COMPLETE',
      now,
      stats.dealersActive || 0,
      stats.dealersErrored || 0,
      stats.totalVehicles || 0,
      stats.newArrivals || 0,
      stats.priceDrops || 0,
      stats.priceIncreases || 0,
      stats.soldOrRemoved || 0,
      errorMessage ? String(errorMessage).slice(0, 60000) : null,
      runId,
    ]
  );
}

// syncInventoryToDatabase — the core write.
//
// IMPORTANT: `records` is expected to be exactly what standalone.js writes
// to national_inventory_latest.json (`allRecords`), which — confirmed by
// reading standalone.js's diff logic — already contains BOTH this run's
// active vehicles AND the vehicles that transitioned ACTIVE -> SOLD_OR_
// REMOVED in this same run (status/changeType/soldDate already computed by
// standalone.js's own previousSnapshot diff). There is deliberately no
// separate `soldVins` parameter here: re-deriving the sold set from a
// second source (e.g. re-diffing against the DB's own previous state)
// would risk drifting from standalone.js's diff and double-guessing a
// decision it already made correctly. Every record — active or sold — is
// processed uniformly in the same per-chunk pass, branching only on its
// own changeType/status fields.
export async function syncInventoryToDatabase(brandId, records, { runId = null } = {}) {
  const pool = getPool();
  const inputRecords = Array.isArray(records) ? records : [];
  const validRecords = inputRecords.filter((r) => isValidVin(r?.vin));
  const skippedNoVin = inputRecords.length - validRecords.length;
  if (skippedNoVin > 0) {
    console.warn(`syncInventoryToDatabase: skipping ${skippedNoVin} record(s) with missing/invalid VIN`);
  }

  // Dealer id resolution — one query for the whole run, not one per record.
  // Keyed on a normalized (lowercase/trimmed) name because a vehicle's real
  // scraped dealership name (e.g. Dealer.com's address.accountName) can
  // differ in casing/whitespace from the name configured in dealers.json
  // even when it's genuinely the same dealer (seen live: "Schumacher
  // Chevrolet of Denville" scraped vs. "Schumacher Chevrolet Of Denville"
  // configured).
  const normalizeDealerKey = (name) => (name || '').trim().toLowerCase();
  const [dealerRows] = await pool.query('SELECT id, name FROM dealers WHERE brand_id = ?', [brandId]);
  const dealerIdByName = new Map(dealerRows.map((d) => [normalizeDealerKey(d.name), d.id]));

  const stats = {
    upserted: 0,
    newArrivals: 0,
    priceDrops: 0,
    priceIncreases: 0,
    sold: 0,
    unchanged: 0,
    skippedNoVin,
    skippedNoDealer: 0,
  };

  for (const batch of chunkArray(validRecords, CHUNK_SIZE)) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const usable = [];
      for (const r of batch) {
        // Try the vehicle's own real scraped dealer name first (normalized);
        // fall back to the crawl-config dealer name it came from (guaranteed
        // to exist in `dealers`, since that's literally where it's sourced
        // from) rather than ever silently dropping a real vehicle record
        // just because its real name didn't match our config exactly.
        const dealerId =
          dealerIdByName.get(normalizeDealerKey(r.dealerName)) ??
          dealerIdByName.get(normalizeDealerKey(r.configDealerName));
        if (!dealerId) {
          stats.skippedNoDealer++;
          continue;
        }
        usable.push({ r, dealerId, vin: r.vin.toUpperCase() });
      }

      if (usable.length === 0) {
        await conn.commit();
        continue;
      }

      // --- vehicles: bulk upsert keyed on the vin unique constraint ---
      const vCols = [
        'vin', 'brand_id', 'dealer_id', 'dealer_name', 'state', 'stock_number', 'inventory_type',
        'year', 'make', 'model', 'trim', 'body_style', 'transmission', 'engine', 'exterior_color',
        'interior_color', 'mileage', 'price', 'old_price', 'price_diff', 'msrp', 'base_msrp',
        'total_options_price', 'url', 'image_url', 'status', 'change_type', 'first_seen_date',
        'last_seen_date', 'sold_date', 'days_on_lot', 'options_search_text', 'search_text',
      ];
      const vPlaceholders = usable.map(() => `(${vCols.map(() => '?').join(',')})`).join(',');
      const vValues = [];
      for (const { r, dealerId, vin } of usable) {
        vValues.push(
          vin, brandId, dealerId,
          truncate(r.dealerName, 255), truncate(r.state, 2), truncate(r.stockNumber, 64),
          normalizeInventoryType(r.inventoryType),
          Number.isFinite(r.year) ? r.year : null,
          truncate(r.make, 64) || 'Unknown', truncate(r.model, 128), truncate(r.trim, 128), truncate(r.bodyStyle, 64),
          truncate(r.transmission, 64), truncate(r.engine, 128), truncate(r.exteriorColor, 128), truncate(r.interiorColor, 128),
          Number.isFinite(r.mileage) ? r.mileage : 0,
          r.price ?? null, r.oldPrice ?? null, r.priceDiff || 0, r.msrp ?? null, r.baseMsrp ?? null,
          // total_options_price is an unsigned column, but confirmed live in
          // the Ford dataset: dealerListedOptions sometimes includes
          // negative-priced line items (rebates/discounts encoded as an
          // "option", e.g. -$1295 "Retail Customer Cash") that sum to a
          // negative total. Clamped to 0 rather than rejecting the whole
          // vehicle over one out-of-range unsigned column.
          Math.max(0, r.totalOptionsPrice || 0), truncate(r.url, 1024), truncate(r.imageUrl, 1024),
          r.status === 'SOLD_OR_REMOVED' ? 'SOLD_OR_REMOVED' : 'ACTIVE',
          r.changeType || 'UNCHANGED',
          r.firstSeen || r.lastSeen, r.lastSeen, r.soldDate || null,
          r.daysOnLot || 0, buildOptionsSearchText(r), buildSearchText(r),
        );
      }
      const vSql = `INSERT INTO vehicles (${vCols.join(',')}) VALUES ${vPlaceholders}
        ON DUPLICATE KEY UPDATE
          dealer_id = VALUES(dealer_id), dealer_name = VALUES(dealer_name), state = VALUES(state),
          stock_number = VALUES(stock_number), inventory_type = VALUES(inventory_type),
          year = VALUES(year), make = VALUES(make), model = VALUES(model), trim = VALUES(trim),
          body_style = VALUES(body_style), transmission = VALUES(transmission), engine = VALUES(engine),
          exterior_color = VALUES(exterior_color), interior_color = VALUES(interior_color),
          mileage = VALUES(mileage), price = VALUES(price), old_price = VALUES(old_price),
          price_diff = VALUES(price_diff), msrp = VALUES(msrp), base_msrp = VALUES(base_msrp),
          total_options_price = VALUES(total_options_price), url = VALUES(url),
          image_url = VALUES(image_url), status = VALUES(status), change_type = VALUES(change_type),
          last_seen_date = VALUES(last_seen_date), sold_date = VALUES(sold_date),
          days_on_lot = VALUES(days_on_lot), options_search_text = VALUES(options_search_text),
          search_text = VALUES(search_text), updated_at = NOW()`;
      // first_seen_date is deliberately NOT in the UPDATE clause — it must
      // never regress on a re-sync/backfill of the same vehicle; the
      // INSERT branch above still seeds it correctly for genuinely new rows.
      await conn.query(vSql, vValues);

      // --- resolve vehicle_id for everything in this chunk (post-upsert) ---
      const vins = usable.map((u) => u.vin);
      const [idRows] = await conn.query(
        `SELECT id, vin FROM vehicles WHERE vin IN (${vins.map(() => '?').join(',')})`,
        vins
      );
      const idByVin = new Map(idRows.map((row) => [row.vin, row.id]));

      // --- vehicle_price_history: only real price-moving events ---
      const historyRecords = usable.filter(
        ({ r }) => ['NEW_ARRIVAL', 'PRICE_DROP', 'PRICE_INCREASE'].includes(r.changeType) && r.price
      );
      if (historyRecords.length > 0) {
        const hCols = ['vehicle_id', 'vin', 'price', 'price_delta', 'snapshot_date'];
        const hValues = [];
        let hRows = 0;
        for (const { r, vin } of historyRecords) {
          const vehicleId = idByVin.get(vin);
          if (!vehicleId) continue;
          hValues.push(vehicleId, vin, r.price, r.priceDiff || 0, r.lastSeen);
          hRows++;
        }
        if (hRows > 0) {
          const hPlaceholders = Array.from({ length: hRows }, () => `(${hCols.map(() => '?').join(',')})`).join(',');
          await conn.query(
            `INSERT INTO vehicle_price_history (${hCols.join(',')}) VALUES ${hPlaceholders}
             ON DUPLICATE KEY UPDATE price = VALUES(price), price_delta = VALUES(price_delta)`,
            hValues
          );
        }
      }

      // --- vehicle_options: wholesale delete + reinsert per vehicle ---
      const vehicleIdsInChunk = [...idByVin.values()];
      if (vehicleIdsInChunk.length > 0) {
        await conn.query(
          `DELETE FROM vehicle_options WHERE vehicle_id IN (${vehicleIdsInChunk.map(() => '?').join(',')})`,
          vehicleIdsInChunk
        );

        const oCols = ['vehicle_id', 'vin', 'code', 'name', 'price', 'category'];
        const oValues = [];
        let oRows = 0;
        for (const { r, vin } of usable) {
          const vehicleId = idByVin.get(vin);
          if (!vehicleId) continue;
          const opts = Array.isArray(r.factoryOptions) ? r.factoryOptions : [];
          for (const opt of opts) {
            if (!opt || !opt.name) continue;
            const category = ['package', 'option', 'feature'].includes(opt.category) ? opt.category : 'option';
            // vehicle_options.price is unsigned too — same negative-rebate
            // items clamp to 0 here as they do in total_options_price above.
            oValues.push(vehicleId, vin, (opt.code || 'OPT').toString().slice(0, 64), opt.name.toString().slice(0, 255), Math.max(0, opt.price || 0), category);
            oRows++;
          }
        }
        if (oRows > 0) {
          const oPlaceholders = Array.from({ length: oRows }, () => `(${oCols.map(() => '?').join(',')})`).join(',');
          await conn.query(`INSERT INTO vehicle_options (${oCols.join(',')}) VALUES ${oPlaceholders}`, oValues);
        }
      }

      // --- vehicle_enrichment: only when NHTSA data is actually present ---
      const enrichRecords = usable.filter(({ r }) => r.nhtsa);
      if (enrichRecords.length > 0) {
        const eCols = [
          'vehicle_id', 'vin', 'nhtsa_plant_country', 'nhtsa_plant_city', 'nhtsa_engine_cylinders',
          'nhtsa_engine_displ_l', 'nhtsa_fuel_type', 'nhtsa_body_class', 'nhtsa_gvwr',
          'nhtsa_brake_system', 'enriched_at',
        ];
        const eValues = [];
        let eRows = 0;
        for (const { r, vin } of enrichRecords) {
          const vehicleId = idByVin.get(vin);
          if (!vehicleId) continue;
          const n = r.nhtsa;
          eValues.push(
            vehicleId, vin,
            n.plantCountry ? String(n.plantCountry).slice(0, 64) : null,
            n.plantCity ? String(n.plantCity).slice(0, 64) : null,
            Number.isFinite(n.engineCylinders) ? n.engineCylinders : null,
            n.engineDisplacementL ? String(n.engineDisplacementL).slice(0, 16) : null,
            n.fuelType ? String(n.fuelType).slice(0, 32) : null,
            n.bodyClass ? String(n.bodyClass).slice(0, 64) : null,
            n.grossWeightClass ? String(n.grossWeightClass).slice(0, 64) : null,
            n.brakeSystem ? String(n.brakeSystem).slice(0, 64) : null,
            toMysqlDatetime(r.enrichedAt),
          );
          eRows++;
        }
        if (eRows > 0) {
          const ePlaceholders = Array.from({ length: eRows }, () => `(${eCols.map(() => '?').join(',')})`).join(',');
          await conn.query(
            `INSERT INTO vehicle_enrichment (${eCols.join(',')}) VALUES ${ePlaceholders}
             ON DUPLICATE KEY UPDATE
               nhtsa_plant_country = VALUES(nhtsa_plant_country), nhtsa_plant_city = VALUES(nhtsa_plant_city),
               nhtsa_engine_cylinders = VALUES(nhtsa_engine_cylinders), nhtsa_engine_displ_l = VALUES(nhtsa_engine_displ_l),
               nhtsa_fuel_type = VALUES(nhtsa_fuel_type), nhtsa_body_class = VALUES(nhtsa_body_class),
               nhtsa_gvwr = VALUES(nhtsa_gvwr), nhtsa_brake_system = VALUES(nhtsa_brake_system),
               enriched_at = VALUES(enriched_at)`,
            eValues
          );
        }
      }

      // --- daily_change_log: every record that actually changed today ---
      const changeRecords = usable.filter(({ r }) => r.changeType && r.changeType !== 'UNCHANGED');
      if (changeRecords.length > 0) {
        const cCols = [
          'brand_id', 'run_id', 'vin', 'vehicle_id', 'change_type', 'old_price', 'new_price',
          'price_diff', 'days_on_lot', 'dealer_name', 'change_date',
        ];
        const cValues = [];
        for (const { r, vin } of changeRecords) {
          const vehicleId = idByVin.get(vin) || null;
          const isSold = r.changeType === 'SOLD';
          cValues.push(
            brandId, runId, vin, vehicleId, r.changeType,
            isSold ? null : (r.oldPrice ?? null),
            r.price ?? null,
            r.priceDiff || 0, r.daysOnLot || 0, r.dealerName || null,
            isSold ? (r.soldDate || r.lastSeen) : r.lastSeen,
          );
        }
        const cPlaceholders = changeRecords.map(() => `(${cCols.map(() => '?').join(',')})`).join(',');
        await conn.query(`INSERT INTO daily_change_log (${cCols.join(',')}) VALUES ${cPlaceholders}`, cValues);
      }

      await conn.commit();

      for (const { r } of usable) {
        stats.upserted++;
        if (r.changeType === 'NEW_ARRIVAL') stats.newArrivals++;
        else if (r.changeType === 'PRICE_DROP') stats.priceDrops++;
        else if (r.changeType === 'PRICE_INCREASE') stats.priceIncreases++;
        else if (r.changeType === 'SOLD') stats.sold++;
        else stats.unchanged++;
      }
    } catch (err) {
      await conn.rollback();
      console.error('syncInventoryToDatabase: chunk failed, rolled back:', err.message);
      throw err;
    } finally {
      conn.release();
    }
  }

  return stats;
}
