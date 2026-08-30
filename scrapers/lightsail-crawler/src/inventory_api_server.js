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
      // handleFacets fires up to 9 concurrent queries per brand (see its own
      // header comment), and the "All Makes" view loads all 3 brands' facets
      // at once — confirmed live that 27 queries competing for a 5-connection
      // pool pushed some past Vercel's 5.5s client timeout, silently
      // dropping Porsche/Chevrolet to the legacy fallback (no bodyStyle or
      // optionCode) even though each brand is fast in isolation. MariaDB's
      // own max_connections is 151 with ~6 in routine use, so 25 here still
      // leaves ample headroom for the crawlers' own separate pools.
      connectionLimit: 25,
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

// ---------------------------------------------------------------------------
// Short-TTL response cache for the two hot read paths (GET /api/vehicles and
// /api/vehicles/facets) — the site's Market Intelligence page re-issues
// these on every filter/page change, and with many crawlers now sharing
// this box's 2 vCPUs with MariaDB, a fresh query per request means live
// page loads queue up behind crawler CPU load. Crawlers only write via
// batch syncs a few times a day, so a short TTL (not query-invalidated) is
// enough to absorb request bursts without serving meaningfully stale data.
// Keyed on the exact request URL (method is always GET for cached routes).
const RESPONSE_CACHE_TTL_MS = 20_000;
const RESPONSE_CACHE_MAX_ENTRIES = 500;
const responseCache = new Map(); // url -> { body: string, expiresAt: number }

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (entry.expiresAt <= now) responseCache.delete(key);
  }
}, 30_000);

// Wraps a handler that internally calls sendJson(res, ...): serves a cached
// body on a hit, otherwise lets the handler run and transparently captures
// whatever it sends via res.end() so the next matching request can be
// served from memory instead of hitting MariaDB again.
function withResponseCache(cacheKey, res, handlerFn) {
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Cache": "HIT" });
    res.end(cached.body);
    return Promise.resolve();
  }

  const realWriteHead = res.writeHead.bind(res);
  const realEnd = res.end.bind(res);
  let capturedStatus = 200;
  res.writeHead = (status, headers) => {
    capturedStatus = status;
    return realWriteHead(status, { ...headers, "X-Cache": "MISS" });
  };
  res.end = (body) => {
    if (capturedStatus === 200 && typeof body === "string") {
      if (responseCache.size >= RESPONSE_CACHE_MAX_ENTRIES) {
        const oldestKey = responseCache.keys().next().value;
        if (oldestKey !== undefined) responseCache.delete(oldestKey);
      }
      responseCache.set(cacheKey, { body, expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS });
    }
    return realEnd(body);
  };
  return Promise.resolve(handlerFn());
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

  // state supports a comma-separated list (used by the radius filter, which
  // maps "within N miles" to a set of nearby states via state centroids on
  // the frontend, then sends them all here) as well as a single value.
  if (excludeDimension !== "state" && params.state) {
    const states = params.state.split(",").map((s) => s.trim()).filter(Boolean);
    if (states.length === 1) {
      clauses.push("v.state = ?");
      args.push(states[0]);
    } else if (states.length > 1) {
      clauses.push(`v.state IN (${states.map(() => "?").join(",")})`);
      args.push(...states);
    }
  }

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

  // Direct change_type filter — lets a caller ask for e.g. just
  // PRICE_DROP/SOLD/PRICE_INCREASE rows instead of paging through the
  // entire status=ALL history to find them (that history is far larger
  // than any real day's actual change volume, so a full sweep is both slow
  // and, past a page cap, silently incomplete for anything that isn't a
  // recent NEW_ARRIVAL).
  const VALID_CHANGE_TYPES = new Set(["NEW_ARRIVAL", "PRICE_DROP", "PRICE_INCREASE", "SOLD", "UNCHANGED"]);
  if (params.changeType && excludeDimension !== "changeType" && VALID_CHANGE_TYPES.has(params.changeType)) {
    clauses.push("v.change_type = ?");
    args.push(params.changeType);
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
    price_drop_first: "CASE WHEN v.change_type = 'PRICE_DROP' THEN 0 ELSE 1 END ASC, v.price_diff ASC",
    days_on_lot: "v.days_on_lot DESC",
    days_desc: "v.days_on_lot DESC",
    days_asc: "v.days_on_lot ASC",
    mileage_asc: "v.mileage ASC",
    newest: "v.first_seen_date DESC",
    year: "v.year DESC",
    year_desc: "v.year DESC",
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
      SELECT v.*, d.city AS dealer_city, d.latitude AS dealer_latitude, d.longitude AS dealer_longitude${extraSelect}
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

// Filter keys that live on the `vehicles` table (not vehicle_options) — if
// none of these are active, the options facet doesn't need to join back to
// vehicles at all, since brand_id/status are already denormalized directly
// onto vehicle_options (see db.js). This is the overwhelmingly common case
// (browsing a brand with no other filter yet), so it's worth a dedicated
// fast path: confirmed live the join-based query took 2.5+ minutes on
// Ford's ~280K active options rows even after indexing, vs. near-instant
// for the no-join path below.
const VEHICLE_ONLY_FILTER_KEYS = [
  'make', 'model', 'trim', 'dealer', 'state', 'bodyStyle', 'year', 'condition',
  'minPrice', 'maxPrice', 'maxMileage', 'minDaysOnLot', 'maxDaysOnLot', 'opportunity', 'search',
];

async function fetchOptionCodeFacet(conn, params) {
  const statusValue = params.status ? params.status : 'ACTIVE';
  const statusArgs = statusValue !== 'ALL' ? [statusValue] : [];
  const brandId = BRAND_IDS[params.brand];

  const hasVehicleOnlyFilter = VEHICLE_ONLY_FILTER_KEYS.some(
    (k) => params[k] !== undefined && params[k] !== null && params[k] !== ''
  );
  if (!hasVehicleOnlyFilter) {
    const statusClause = statusValue !== 'ALL' ? 'AND vo.status = ?' : '';
    // COUNT(*) rather than COUNT(DISTINCT vehicle_id): confirmed live these
    // are effectively unique per (vehicle, code) already (delete+reinsert
    // per vehicle per sync — see db.js), and DISTINCT's dedup bookkeeping
    // alone was the difference between 629ms and never finishing at this
    // row count. name comes from the small option_names reference table,
    // not vehicle_options itself — see fetchOptionCodeFacet's header comment.
    const sql = `
      SELECT vo.code AS value, opn.name AS label, COUNT(*) AS count
      FROM vehicle_options vo
      LEFT JOIN option_names opn ON opn.brand_id = vo.brand_id AND opn.code = vo.code
      WHERE vo.brand_id = ? ${statusClause} AND vo.code IS NOT NULL
      GROUP BY vo.code, opn.name
      ORDER BY count DESC
      LIMIT 500
    `;
    const [rows] = await conn.query(sql, [brandId, ...statusArgs]);
    return rows;
  }

  // Slower, correct-in-all-cases path: some other filter (state/model/price/
  // etc.) is active, so it needs the join back to vehicles. brand_id/status
  // are still pre-filtered on vehicle_options directly (via the index) before
  // that join runs, so this stays bounded even though it's not free.
  const optionExclude = params.excludeFacet === 'optionCode' ? 'optionCode' : null;
  const { where, args, searchTerm } = buildWhere(params, optionExclude);
  const statusClause = statusValue !== 'ALL' ? 'AND vo.status = ?' : '';
  const sql = (w) => `
    SELECT vo.code AS value, opn.name AS label, COUNT(*) AS count
    FROM vehicle_options vo
    JOIN vehicles v ON v.id = vo.vehicle_id
    LEFT JOIN option_names opn ON opn.brand_id = vo.brand_id AND opn.code = vo.code
    WHERE vo.brand_id = ? ${statusClause} AND vo.code IS NOT NULL AND ${w}
    GROUP BY vo.code, opn.name
    ORDER BY count DESC
    LIMIT 500
  `;
  const prefixArgs = [brandId, ...statusArgs];
  if (!searchTerm) {
    const [rows] = await conn.query(sql(where), [...prefixArgs, ...args]);
    return rows;
  }
  const ftWhere = `${where} AND MATCH(v.search_text) AGAINST(? IN NATURAL LANGUAGE MODE)`;
  try {
    const [rows] = await conn.query(sql(ftWhere), [...prefixArgs, ...args, searchTerm]);
    return rows;
  } catch {
    const likeWhere = `${where} AND v.search_text LIKE ?`;
    const [rows] = await conn.query(sql(likeWhere), [...prefixArgs, ...args, `%${searchTerm}%`]);
    return rows;
  }
}

async function handleFacets(req, res, params) {
  if (!params.brand || !BRAND_IDS[params.brand]) {
    return badRequest(res, "Query param 'brand' is required and must be a known brand code");
  }

  // Each branch below queries the pool directly (not a single checked-out
  // connection) so they run genuinely concurrently — confirmed live that
  // sharing one connection across all 9 of these serializes them on the
  // wire regardless of Promise.all, turning "9 queries in parallel" into
  // "9 queries back to back" and pushing total latency past 15s on Ford's
  // ~280K-row vehicles table. The pool's own connectionLimit (5) caps real
  // concurrency, which is still a large win over fully sequential.
  const pool = getPool();
  const dims = Object.keys(FACET_DIMENSIONS);
  const results = await Promise.all([
    ...dims.map(async (dim) => {
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
      const [rows] = await runSearchAwareQuery(pool, where, args, searchTerm, sql);
      return [dim, rows];
    }),
    fetchOptionCodeFacet(pool, params).then((rows) => ['optionCode', rows]),
  ]);
  const facets = Object.fromEntries(results);
  sendJson(res, 200, { facets });
}

async function handleVehicleByVin(req, res, vin) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) {
    return badRequest(res, "Invalid VIN format");
  }
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT v.*, d.city AS dealer_city, d.latitude AS dealer_latitude, d.longitude AS dealer_longitude FROM vehicles v LEFT JOIN dealers d ON d.id = v.dealer_id WHERE v.vin = ? LIMIT 1`,
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

// GET /api/vehicles/:vin/history — real day-by-day crawl history for one
// VIN: every logged price-history/change-log row, plus the brand's own
// completed scrape_run dates (so the caller can show "seen, no change" on
// days nothing happened, not just the sparse days something did). Kept as
// its own endpoint rather than folded into handleVehicleByVin so the
// heavier joins here don't run on every plain vehicle-detail lookup.
// mysql2 (dateStrings: false) returns DATE columns as JS Date objects,
// which JSON.stringify serializes as a full "2026-08-28T00:00:00.000Z"
// timestamp — the frontend timeline does exact string equality against
// plain "YYYY-MM-DD" run dates, so every date field here is normalized
// through this first.
function toDateStr(d) {
  if (d === null || d === undefined) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

async function handleVehicleHistory(req, res, vin) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) {
    return badRequest(res, "Invalid VIN format");
  }
  const pool = getPool();
  const [vehicleRows] = await pool.query(
    `SELECT id, brand_id, first_seen_date, last_seen_date, year, make, model, trim, dealer_name, price, status
     FROM vehicles WHERE vin = ? LIMIT 1`,
    [vin]
  );
  if (vehicleRows.length === 0) {
    return sendJson(res, 404, { error: "Vehicle not found" });
  }
  const vehicle = vehicleRows[0];

  const [priceHistoryRows] = await pool.query(
    `SELECT snapshot_date, price, price_delta FROM vehicle_price_history WHERE vehicle_id = ? ORDER BY snapshot_date`,
    [vehicle.id]
  );
  const [changeLogRows] = await pool.query(
    `SELECT change_date, change_type, old_price, new_price, price_diff, days_on_lot FROM daily_change_log WHERE vehicle_id = ? ORDER BY change_date`,
    [vehicle.id]
  );
  const [runDateRows] = await pool.query(
    `SELECT DISTINCT run_date FROM scrape_runs WHERE brand_id = ? AND status = 'COMPLETE' ORDER BY run_date`,
    [vehicle.brand_id]
  );

  sendJson(res, 200, {
    vin,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    dealerName: vehicle.dealer_name,
    price: vehicle.price,
    status: vehicle.status,
    firstSeenDate: toDateStr(vehicle.first_seen_date),
    lastSeenDate: toDateStr(vehicle.last_seen_date),
    priceHistory: priceHistoryRows.map((r) => ({ date: toDateStr(r.snapshot_date), price: r.price, priceDelta: r.price_delta })),
    changeLog: changeLogRows.map((r) => ({
      date: toDateStr(r.change_date),
      type: r.change_type,
      oldPrice: r.old_price,
      newPrice: r.new_price,
      priceDiff: r.price_diff,
      daysOnLot: r.days_on_lot,
    })),
    brandRunDates: runDateRows.map((r) => toDateStr(r.run_date)),
  });
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

// Real day-by-day crawl health, for the admin "Crawl History" dashboard —
// every row here is a real scrape_runs record (one per brand per crawl
// attempt), never synthesized. Lets an admin look back at any past day and
// see whether each brand's crawl actually completed, how many dealers/
// vehicles it touched, and which specific dealers failed (once that field
// exists on a run — older rows predate failed_dealer_names and just come
// back null for it).
async function handleCrawlHistory(req, res, params) {
  const pool = getPool();

  const [dateRows] = await pool.query(
    `SELECT DISTINCT run_date FROM scrape_runs ORDER BY run_date DESC LIMIT 90`
  );
  const availableDates = dateRows.map((r) => toDateStr(r.run_date));

  const requestedDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;
  const date = requestedDate || availableDates[0] || null;

  if (!date) {
    return sendJson(res, 200, { availableDates: [], date: null, runs: [] });
  }

  const [runRows] = await pool.query(
    `SELECT sr.*, b.code AS brand_code, b.name AS brand_name
     FROM scrape_runs sr
     JOIN brands b ON b.id = sr.brand_id
     WHERE sr.run_date = ?
     ORDER BY b.name ASC, sr.started_at ASC`,
    [date]
  );

  const runs = runRows.map((r) => {
    const startedAt = r.started_at;
    const finishedAt = r.finished_at;
    const durationMinutes =
      finishedAt && startedAt ? Math.round((new Date(finishedAt) - new Date(startedAt)) / 60000) : null;
    let failedDealerNames = null;
    if (r.failed_dealer_names) {
      try {
        failedDealerNames = typeof r.failed_dealer_names === "string" ? JSON.parse(r.failed_dealer_names) : r.failed_dealer_names;
      } catch {
        failedDealerNames = null;
      }
    }
    return {
      id: String(r.id),
      brandCode: r.brand_code,
      brandName: r.brand_name,
      status: r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      durationMinutes,
      dealersConfigured: r.dealers_configured,
      dealersActive: r.dealers_active,
      dealersErrored: r.dealers_errored,
      totalVehicles: r.total_vehicles,
      newArrivals: r.new_arrivals,
      priceDrops: r.price_drops,
      priceIncreases: r.price_increases,
      soldOrRemoved: r.sold_or_removed,
      errorSummary: r.error_summary,
      failedDealerNames,
    };
  });

  sendJson(res, 200, { availableDates, date, runs });
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
  if (pathname === "/api/crawl-history") {
    return run(() => handleCrawlHistory(req, res, params));
  }
  if (pathname === "/api/vehicles/facets") {
    return run(() => withResponseCache(req.url, res, () => handleFacets(req, res, params)));
  }
  if (pathname === "/api/vehicles/export.csv") {
    return run(() => handleExportCsv(req, res, params));
  }
  const historyMatch = pathname.match(/^\/api\/vehicles\/([A-Za-z0-9]{17})\/history$/);
  if (historyMatch) {
    return run(() => handleVehicleHistory(req, res, historyMatch[1]));
  }
  const vinMatch = pathname.match(/^\/api\/vehicles\/([A-Za-z0-9]{17})$/);
  if (vinMatch) {
    return run(() => handleVehicleByVin(req, res, vinMatch[1]));
  }
  if (pathname === "/api/vehicles") {
    return run(() => withResponseCache(req.url, res, () => handleVehicles(req, res, params)));
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
