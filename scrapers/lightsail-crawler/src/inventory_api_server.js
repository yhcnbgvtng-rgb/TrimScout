#!/usr/bin/env node
// Step 4 of the JSON-file -> database migration: a real HTTP API over the
// `trimscout` MariaDB database, so the Vercel app can query with real
// pagination/filtering instead of downloading the full export.csv.
//
// This is intentionally a second, independent process from export_server.js
// (JSON-file backed) — that file is left completely unmodified and keeps
// working as the fallback data source throughout this migration. This
// server reads the DB with a read-only user.
//
// Port: the original plan called for 3001, but that port turns out to
// already be in use on the box — `ford-nj-dashboard` in pm2 is actually
// running ford-nj-tracker/export_server.js with EXPORT_SERVER_PORT=3001
// (the Ford equivalent of the port-3000 Porsche export server), confirmed
// via `pm2 env` and `ss -tlnp`. Rather than disturb that existing fallback
// process, this server uses port 3002 instead (free, confirmed via
// `ss -tlnp` before first start). Override with INVENTORY_API_PORT if
// needed.
//
// Credentials load from `.env.trimscout-db` using the same hand-rolled
// loader pattern as db.js (no dotenv dependency, same file, same
// process.cwd()-relative resolution so `pm2 start src/inventory_api_server.js`
// from the tracker dir picks it up exactly like db.js does).
//
// Run under pm2:
//   pm2 start src/inventory_api_server.js --name trimscout-inventory-api
//
// Requires port 3002 to be opened in the Lightsail instance's Networking
// tab (firewall) before the Vercel app can reach it from outside the box —
// not done as part of this step, see deploy notes. Everything below is
// tested via `curl localhost:3002/...` from on the box in the meantime.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const PORT = process.env.INVENTORY_API_PORT || 3002;

// ---------------------------------------------------------------------------
// Env loading (same pattern as db.js)
// ---------------------------------------------------------------------------

function loadDbEnv() {
  const envPath = path.resolve(process.cwd(), ".env.trimscout-db");
  let raw;
  try {
    raw = fs.readFileSync(envPath, "utf-8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDbEnv();

const API_KEY = process.env.TRIMSCOUT_API_KEY;

let pool = null;
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      database: process.env.DB_NAME,
      // Read-only user — this server never writes.
      user: process.env.DB_READER_USER,
      password: process.env.DB_READER_PASSWORD,
      waitForConnections: true,
      connectionLimit: 5,
      dateStrings: false,
    });
  }
  return pool;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Loaded dynamically from the `brands` table rather than hardcoded, so a
// newly-registered brand (e.g. Chevrolet) shows up without a code change +
// redeploy every time — the seed values below are only a fallback for the
// brief window before the first refresh completes at startup.
let BRAND_IDS = { porsche: 1, ford: 2 };

async function refreshBrandIds() {
  try {
    const [rows] = await getPool().query("SELECT code, id FROM brands");
    const fresh = {};
    for (const r of rows) fresh[r.code] = r.id;
    if (Object.keys(fresh).length > 0) BRAND_IDS = fresh;
  } catch (err) {
    console.error("refreshBrandIds failed (keeping previous BRAND_IDS):", err.message);
  }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

// Days-on-lot threshold for the "stale" opportunity bucket.
const STALE_DAYS_ON_LOT_THRESHOLD = 60;

// Builds a parameterized WHERE clause (and its param array) from the shared
// filter query-params used by /api/vehicles, /api/vehicles/facets and
// /api/vehicles/export.csv. `excludeDimension` lets facets.js skip a given
// dimension's own filter so its full option set + cross counts show.
function buildWhere(params, excludeDimension) {
  const clauses = ["v.brand_id = ?"];
  const args = [BRAND_IDS[params.brand]];

  const includeStatus = params.status ? params.status : "ACTIVE";
  if (includeStatus !== "ALL") {
    clauses.push("v.status = ?");
    args.push(includeStatus);
  }

  const eq = (dim, column, value) => {
    if (excludeDimension === dim) return;
    if (value === undefined || value === null || value === "") return;
    clauses.push(`${column} = ?`);
    args.push(value);
  };

  eq("make", "v.make", params.make);
  eq("model", "v.model", params.model);
  eq("trim", "v.trim", params.trim);
  eq("dealer", "v.dealer_name", params.dealer);
  eq("state", "v.state", params.state);
  eq("bodyStyle", "v.body_style", params.bodyStyle);
  eq("year", "v.year", params.year ? Number(params.year) : undefined);

  if (params.condition && excludeDimension !== "condition") {
    clauses.push("v.inventory_type = ?");
    args.push(params.condition);
  }

  if (params.minPrice) {
    clauses.push("v.price >= ?");
    args.push(Number(params.minPrice));
  }
  if (params.maxPrice) {
    clauses.push("v.price <= ?");
    args.push(Number(params.maxPrice));
  }
  if (params.maxMileage) {
    clauses.push("v.mileage <= ?");
    args.push(Number(params.maxMileage));
  }
  if (params.minDaysOnLot) {
    clauses.push("v.days_on_lot >= ?");
    args.push(Number(params.minDaysOnLot));
  }
  if (params.maxDaysOnLot) {
    clauses.push("v.days_on_lot <= ?");
    args.push(Number(params.maxDaysOnLot));
  }

  if (params.opportunity && excludeDimension !== "opportunity") {
    switch (params.opportunity) {
      case "drops":
        clauses.push("v.change_type = 'PRICE_DROP'");
        break;
      case "fresh":
        clauses.push("v.change_type = 'NEW_ARRIVAL'");
        break;
      case "stale":
        clauses.push("v.days_on_lot > ?");
        args.push(STALE_DAYS_ON_LOT_THRESHOLD);
        break;
      case "cpo":
        clauses.push("v.inventory_type = 'CERTIFIED_PRE_OWNED'");
        break;
      default:
        break;
    }
  }

  if (params.optionCode && excludeDimension !== "optionCode") {
    clauses.push(
      "EXISTS (SELECT 1 FROM vehicle_options vo WHERE vo.vehicle_id = v.id AND vo.code = ?)"
    );
    args.push(params.optionCode);
  }

  let searchSql = null;
  if (params.search && excludeDimension !== "search") {
    // Caller decides FULLTEXT vs LIKE fallback; this just returns the raw
    // term so callers can build the right clause (needs its own try/catch
    // around the FULLTEXT attempt).
    searchSql = params.search;
  }

  return { where: clauses.join(" AND "), args, searchTerm: searchSql };
}

async function runSearchAwareQuery(conn, baseWhere, baseArgs, searchTerm, buildSql) {
  // buildSql(whereWithSearch, argsWithSearch) -> sql string
  if (!searchTerm) {
    return conn.query(buildSql(baseWhere, baseArgs), baseArgs);
  }

  // Try FULLTEXT natural language mode first.
  const ftWhere = `${baseWhere} AND MATCH(v.search_text) AGAINST(? IN NATURAL LANGUAGE MODE)`;
  const ftArgs = [...baseArgs, searchTerm];
  try {
    const result = await conn.query(buildSql(ftWhere, ftArgs), ftArgs);
    return result;
  } catch (err) {
    // Fall through to LIKE below.
  }

  const likeWhere = `${baseWhere} AND v.search_text LIKE ?`;
  const likeArgs = [...baseArgs, `%${searchTerm}%`];
  return conn.query(buildSql(likeWhere, likeArgs), likeArgs);
}

function requireAuth(req, res) {
  const key = req.headers["x-trimscout-api-key"];
  if (!API_KEY || key !== API_KEY) {
    sendJson(res, 401, { error: "Unauthorized: missing or invalid X-Trimscout-Api-Key header" });
    return false;
  }
  return true;
}

function parseQuery(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const params = {};
  for (const [k, v] of url.searchParams.entries()) params[k] = v;
  return { url, params };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleVehicles(req, res, params) {
  if (!params.brand || !BRAND_IDS[params.brand]) {
    return badRequest(res, "Query param 'brand' is required and must be a known brand code");
  }

  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(params.pageSize, 10) || 50));
  const offset = (page - 1) * pageSize;

  const { where, args, searchTerm } = buildWhere(params);

  const sortMap = {
    price_asc: "v.price ASC",
    price_desc: "v.price DESC",
    days_on_lot: "v.days_on_lot DESC",
    newest: "v.first_seen_date DESC",
    year: "v.year DESC",
  };

  let orderBy = "v.first_seen_date DESC";
  let extraSelect = "";
  let extraArgs = [];
  if (params.sortBy === "closest_to_zip" && params.lat && params.lng) {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    // Haversine distance (miles) against the dealer's lat/lng, computed over
    // the already-filtered set, joined once here.
    extraSelect = `, (3959 * ACOS(
        COS(RADIANS(?)) * COS(RADIANS(d.latitude)) * COS(RADIANS(d.longitude) - RADIANS(?)) +
        SIN(RADIANS(?)) * SIN(RADIANS(d.latitude))
      )) AS distance_miles`;
    extraArgs = [lat, lng, lat];
    orderBy = "distance_miles ASC";
  } else if (sortMap[params.sortBy]) {
    orderBy = sortMap[params.sortBy];
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    // Combined count + stats aggregate over the same filtered WHERE, one
    // round trip instead of six.
    const statsSql = (w) => `
      SELECT
        COUNT(*) AS totalCount,
        SUM(CASE WHEN v.change_type = 'PRICE_DROP' THEN 1 ELSE 0 END) AS priceDrops,
        SUM(CASE WHEN v.change_type = 'NEW_ARRIVAL' THEN 1 ELSE 0 END) AS newArrivals,
        SUM(CASE WHEN v.days_on_lot > ${STALE_DAYS_ON_LOT_THRESHOLD} THEN 1 ELSE 0 END) AS staleCount,
        AVG(v.days_on_lot) AS avgDaysOnLot,
        COUNT(DISTINCT v.dealer_id) AS dealershipsCount
      FROM vehicles v
      WHERE ${w}
    `;
    const [statsRows] = await runSearchAwareQuery(conn, where, args, searchTerm, statsSql);
    const stats = statsRows[0] || {};

    const listSql = (w) => `
      SELECT v.*, d.city AS dealer_city${extraSelect}
      FROM vehicles v
      LEFT JOIN dealers d ON d.id = v.dealer_id
      WHERE ${w}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;
    // extraArgs (lat/lng) need to sit right after the SELECT's placeholders,
    // before the WHERE args, since they appear earlier in the SQL string.
    const listArgsBuilder = (baseArgs) => [...extraArgs, ...baseArgs, pageSize, offset];

    let listResult;
    if (!searchTerm) {
      const listArgs = listArgsBuilder(args);
      [listResult] = await conn.query(listSql(where), listArgs);
    } else {
      const ftWhere = `${where} AND MATCH(v.search_text) AGAINST(? IN NATURAL LANGUAGE MODE)`;
      const ftArgs = [...args, searchTerm];
      try {
        const listArgs = listArgsBuilder(ftArgs);
        [listResult] = await conn.query(listSql(ftWhere), listArgs);
      } catch {
        const likeWhere = `${where} AND v.search_text LIKE ?`;
        const likeArgs = [...args, `%${searchTerm}%`];
        const listArgs = listArgsBuilder(likeArgs);
        [listResult] = await conn.query(listSql(likeWhere), listArgs);
      }
    }

    const vehicles = listResult;
    const ids = vehicles.map((v) => v.id);

    let optionsByVehicle = {};
    let enrichmentByVehicle = {};
    if (ids.length > 0) {
      const [optionRows] = await conn.query(
        `SELECT vehicle_id, code, name, price, category, source FROM vehicle_options WHERE vehicle_id IN (?)`,
        [ids]
      );
      for (const row of optionRows) {
        (optionsByVehicle[row.vehicle_id] ||= []).push(row);
      }

      const [enrichRows] = await conn.query(
        `SELECT * FROM vehicle_enrichment WHERE vehicle_id IN (?)`,
        [ids]
      );
      for (const row of enrichRows) {
        enrichmentByVehicle[row.vehicle_id] = row;
      }
    }

    const enriched = vehicles.map((v) => ({
      ...v,
      options: optionsByVehicle[v.id] || [],
      enrichment: enrichmentByVehicle[v.id] || null,
    }));

    const totalCount = Number(stats.totalCount) || 0;
    sendJson(res, 200, {
      vehicles: enriched,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      },
      stats: {
        totalActive: totalCount,
        priceDrops: Number(stats.priceDrops) || 0,
        newArrivals: Number(stats.newArrivals) || 0,
        staleCount: Number(stats.staleCount) || 0,
        avgDaysOnLot: stats.avgDaysOnLot === null ? 0 : Number(stats.avgDaysOnLot),
        dealershipsCount: Number(stats.dealershipsCount) || 0,
      },
    });
  } finally {
    conn.release();
  }
}

const FACET_DIMENSIONS = {
  make: "v.make",
  model: "v.model",
  trim: "v.trim",
  dealer: "v.dealer_name",
  state: "v.state",
  bodyStyle: "v.body_style",
  year: "v.year",
  condition: "v.inventory_type",
};

async function handleFacets(req, res, params) {
  if (!params.brand || !BRAND_IDS[params.brand]) {
    return badRequest(res, "Query param 'brand' is required and must be a known brand code");
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const dims = Object.keys(FACET_DIMENSIONS);
    const results = await Promise.all(
      dims.map(async (dim) => {
        const column = FACET_DIMENSIONS[dim];
        const exclude = params.excludeFacet === dim ? dim : null;
        const { where, args, searchTerm } = buildWhere(params, exclude);
        const sql = (w) => `
          SELECT ${column} AS value, COUNT(*) AS count
          FROM vehicles v
          WHERE ${w} AND ${column} IS NOT NULL
          GROUP BY ${column}
          ORDER BY count DESC
        `;
        const [rows] = await runSearchAwareQuery(conn, where, args, searchTerm, sql);
        return [dim, rows];
      })
    );
    const facets = Object.fromEntries(results);
    sendJson(res, 200, { facets });
  } finally {
    conn.release();
  }
}

async function handleVehicleByVin(req, res, vin) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) {
    return badRequest(res, "Invalid VIN format");
  }
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT v.*, d.city AS dealer_city FROM vehicles v LEFT JOIN dealers d ON d.id = v.dealer_id WHERE v.vin = ? LIMIT 1`,
      [vin]
    );
    if (rows.length === 0) {
      return sendJson(res, 404, { error: "Vehicle not found" });
    }
    const vehicle = rows[0];

    const [optionRows] = await conn.query(
      `SELECT code, name, price, category, source FROM vehicle_options WHERE vehicle_id = ?`,
      [vehicle.id]
    );
    const [enrichRows] = await conn.query(
      `SELECT * FROM vehicle_enrichment WHERE vehicle_id = ?`,
      [vehicle.id]
    );

    sendJson(res, 200, {
      ...vehicle,
      options: optionRows,
      enrichment: enrichRows[0] || null,
    });
  } finally {
    conn.release();
  }
}

const EXPORT_CSV_COLUMNS = [
  "vin", "dealer_name", "state", "inventory_type", "year", "make", "model", "trim",
  "body_style", "transmission", "drivetrain", "engine", "exterior_color", "interior_color",
  "mileage", "price", "old_price", "price_diff", "msrp", "base_msrp", "total_options_price",
  "status", "change_type", "first_seen_date", "last_seen_date", "sold_date", "days_on_lot",
  "url",
  // Enrichment/options-derived columns the old fixed CSV_COLUMNS omitted.
  "nhtsa_plant_country", "nhtsa_plant_city", "nhtsa_engine_cylinders", "nhtsa_engine_displ_l",
  "nhtsa_fuel_type", "nhtsa_body_class",
  "option_codes",
];

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  // mysql2 (dateStrings: false) returns DATE/DATETIME columns as JS Date
  // objects; String(date) would produce a verbose toString() form
  // ("Sun Aug 23 2026 00:00:00 GMT+0000 (...)"), so format those as plain
  // ISO strings instead.
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function handleExportCsv(req, res, params) {
  if (!params.brand || !BRAND_IDS[params.brand]) {
    return badRequest(res, "Query param 'brand' is required and must be a known brand code");
  }

  const { where, args, searchTerm } = buildWhere(params);

  const pool = getPool();
  let conn;
  try {
    conn = await pool.getConnection();

    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename=inventory_export.csv",
    });
    res.write(EXPORT_CSV_COLUMNS.join(",") + "\n");

    const sql = (w) => `
      SELECT v.*, e.nhtsa_plant_country, e.nhtsa_plant_city, e.nhtsa_engine_cylinders,
             e.nhtsa_engine_displ_l, e.nhtsa_fuel_type, e.nhtsa_body_class,
             (SELECT GROUP_CONCAT(vo.code SEPARATOR '|') FROM vehicle_options vo WHERE vo.vehicle_id = v.id) AS option_codes
      FROM vehicles v
      LEFT JOIN vehicle_enrichment e ON e.vehicle_id = v.id
      WHERE ${w}
    `;

    let finalWhere = where;
    let finalArgs = args;
    if (searchTerm) {
      // stream() errors surface asynchronously via the stream's 'error'
      // event, not as a sync throw, so we can't try/catch around the
      // stream itself the way the other handlers do. Instead, probe the
      // FULLTEXT clause with a cheap non-streaming query first (promise
      // API, real try/catch) and pick which WHERE to actually stream.
      const ftWhere = `${where} AND MATCH(v.search_text) AGAINST(? IN NATURAL LANGUAGE MODE)`;
      const ftArgs = [...args, searchTerm];
      try {
        await conn.query(`SELECT 1 FROM vehicles v WHERE ${ftWhere} LIMIT 1`, ftArgs);
        finalWhere = ftWhere;
        finalArgs = ftArgs;
      } catch {
        finalWhere = `${where} AND v.search_text LIKE ?`;
        finalArgs = [...args, `%${searchTerm}%`];
      }
    }
    const finalSql = sql(finalWhere);
    const stream = conn.connection.query(finalSql, finalArgs).stream();

    stream.on("data", (row) => {
      const line = EXPORT_CSV_COLUMNS.map((col) => csvEscape(row[col])).join(",") + "\n";
      res.write(line);
    });
    stream.on("end", () => {
      res.end();
      conn.release();
    });
    stream.on("error", (err) => {
      console.error(`${new Date().toISOString()} export.csv stream error: ${err.message}`);
      res.end();
      conn.release();
    });
  } catch (err) {
    console.error(`${new Date().toISOString()} export.csv failed: ${err.message}`);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Export failed" });
    } else {
      res.end();
    }
    if (conn) conn.release();
  }
}

async function handleHealth(req, res) {
  let dbConnected = false;
  let recordCount = 0;
  let lastCrawlAt = null;
  let lastEnrichedAt = null;
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM vehicles WHERE status = 'ACTIVE') AS recordCount,
         (SELECT MAX(finished_at) FROM scrape_runs) AS lastCrawlAt,
         (SELECT MAX(enriched_at) FROM vehicle_enrichment) AS lastEnrichedAt
      `
    );
    dbConnected = true;
    recordCount = Number(rows[0].recordCount) || 0;
    lastCrawlAt = rows[0].lastCrawlAt;
    lastEnrichedAt = rows[0].lastEnrichedAt;
  } catch (err) {
    dbConnected = false;
  }
  sendJson(res, 200, { status: "ok", dbConnected, recordCount, lastCrawlAt, lastEnrichedAt });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const { url, params } = parseQuery(req);
  const pathname = url.pathname;

  // /health is intentionally still auth-gated per the spec ("every route
  // except nothing requires the header").
  if (!requireAuth(req, res)) return;

  const run = (fn) => {
    Promise.resolve(fn()).catch((err) => {
      console.error(`${new Date().toISOString()} ${pathname} -> 500: ${err.message}`);
      if (!res.headersSent) sendJson(res, 500, { error: "Internal server error" });
      else res.end();
    });
  };

  if (pathname === "/health") {
    return run(() => handleHealth(req, res));
  }
  if (pathname === "/api/vehicles/facets") {
    return run(() => handleFacets(req, res, params));
  }
  if (pathname === "/api/vehicles/export.csv") {
    return run(() => handleExportCsv(req, res, params));
  }
  const vinMatch = pathname.match(/^\/api\/vehicles\/([A-Za-z0-9]{17})$/);
  if (vinMatch) {
    return run(() => handleVehicleByVin(req, res, vinMatch[1]));
  }
  if (pathname === "/api/vehicles") {
    return run(() => handleVehicles(req, res, params));
  }

  sendJson(res, 404, { error: "Not found" });
});

await refreshBrandIds();
setInterval(refreshBrandIds, 60_000);

server.listen(PORT, () => {
  console.log(`Inventory API server listening on port ${PORT} (3001 was already taken by ford-nj-dashboard/export_server.js)`);
  console.log(`  Brands loaded: ${JSON.stringify(BRAND_IDS)}`);
  console.log(`  GET /api/vehicles              - paginated/filtered vehicle list`);
  console.log(`  GET /api/vehicles/facets       - cross-filtered facet counts`);
  console.log(`  GET /api/vehicles/:vin         - single vehicle detail`);
  console.log(`  GET /api/vehicles/export.csv   - filtered CSV export (streamed)`);
  console.log(`  GET /health                    - status check`);
  console.log(`All routes require header X-Trimscout-Api-Key.`);
});
