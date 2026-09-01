#!/usr/bin/env node
// Deals/payments + reverse-auction backend — same pattern as
// auth_api_server.js (own PM2 process, own copy of .env.trimscout-db,
// DB_WRITER_USER since this creates/updates rows) but for `deals`,
// `deal_requests`, and `deal_bids`.
//
// Three tables, one lifecycle:
//   deal_requests  — a buyer's real reverse-auction request, seeded from a
//                    real vehicle they picked in Market Intelligence.
//   deal_bids      — a real dealer's real competing offer against a request.
//   deals          — created when the buyer pays the platform fee to lock
//                    in a specific bid; paying flips deal_requests to
//                    'locked' and that bid to 'accepted' (see
//                    handleMarkPaid), and expires every other active bid on
//                    the same request.
//
// Buyer/dealer identity masking (real dealer name/city/VIN/contact hidden
// from the buyer until they pay; real buyer name/phone/email hidden from
// the dealer always) is enforced by the CALLERS of this server (the
// Next.js API routes), not here — this server always returns full,
// unmasked rows. That's intentional: masking belongs at the boundary
// closest to the untrusted client, and keeping it out of this shared
// server means every caller doesn't have to reason about which fields a
// particular box route happens to redact.
//
// Run under pm2:
//   pm2 start src/deals_api_server.js --name trimscout-deals-api

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const PORT = process.env.DEALS_API_PORT || 3004;

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
      user: process.env.DB_WRITER_USER,
      password: process.env.DB_WRITER_PASSWORD,
      waitForConnections: true,
      connectionLimit: 5,
      dateStrings: false,
    });
  }
  return pool;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

function requireAuth(req, res) {
  const key = req.headers["x-trimscout-api-key"];
  if (!API_KEY || key !== API_KEY) {
    sendJson(res, 401, { error: "Unauthorized: missing or invalid X-Trimscout-Api-Key header" });
    return false;
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------
// deals (unchanged from the original payments-only version, extended
// with optional deal_request_id/bid_id)
// ---------------------------------------------------------------------

function publicDeal(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    certificateId: row.certificate_id,
    buyerUserId: String(row.buyer_user_id),
    dealerName: row.dealer_name,
    matchedVin: row.matched_vin,
    dealRequestId: row.deal_request_id ? String(row.deal_request_id) : null,
    bidId: row.bid_id ? String(row.bid_id) : null,
    totalOtdPrice: Number(row.total_otd_price),
    platformFeeCents: row.platform_fee_cents,
    winningBid: typeof row.winning_bid_json === "string" ? JSON.parse(row.winning_bid_json) : row.winning_bid_json,
    status: row.status,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

async function handleCreateDeal(req, res) {
  const body = await readBody(req);
  const buyerUserId = Number(body.buyerUserId);
  const dealerName = (body.dealerName || "").trim();
  const matchedVin = (body.matchedVin || "").trim();
  const totalOtdPrice = Number(body.totalOtdPrice);
  const platformFeeCents = Number(body.platformFeeCents);
  const winningBid = body.winningBid;
  const dealRequestId = body.dealRequestId ? Number(body.dealRequestId) : null;
  const bidId = body.bidId ? Number(body.bidId) : null;

  if (!Number.isFinite(buyerUserId) || buyerUserId <= 0) return badRequest(res, "Invalid buyerUserId");
  if (!dealerName) return badRequest(res, "dealerName is required");
  if (!matchedVin) return badRequest(res, "matchedVin is required");
  if (!Number.isFinite(totalOtdPrice) || totalOtdPrice <= 0) return badRequest(res, "Invalid totalOtdPrice");
  if (!Number.isFinite(platformFeeCents) || platformFeeCents <= 0) return badRequest(res, "Invalid platformFeeCents");
  if (!winningBid || typeof winningBid !== "object") return badRequest(res, "winningBid is required");

  const pool = getPool();
  const [result] = await pool.query(
    `INSERT INTO deals (buyer_user_id, dealer_name, matched_vin, deal_request_id, bid_id, total_otd_price, platform_fee_cents, winning_bid_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment')`,
    [buyerUserId, dealerName, matchedVin, dealRequestId, bidId, totalOtdPrice, platformFeeCents, JSON.stringify(winningBid)]
  );
  const dealId = result.insertId;
  const certificateId = `OTD-${String(dealId).padStart(6, "0")}`;
  await pool.query("UPDATE deals SET certificate_id = ? WHERE id = ?", [certificateId, dealId]);

  const [rows] = await pool.query("SELECT * FROM deals WHERE id = ?", [dealId]);
  sendJson(res, 201, { deal: publicDeal(rows[0]) });
}

async function handleGetDeal(req, res, id) {
  const pool = getPool();
  const [rows] = await pool.query("SELECT * FROM deals WHERE id = ?", [id]);
  if (rows.length === 0) return sendJson(res, 404, { error: "Deal not found" });
  sendJson(res, 200, { deal: publicDeal(rows[0]) });
}

// POST /api/deals/:id/mark-paid — idempotent. On first successful call,
// also cascades the win: the deal's own deal_request -> 'locked', its bid
// -> 'accepted', every other active bid on that same request -> 'expired'.
// This is the one moment a real payment is confirmed, so it's the natural
// single place that cascade belongs.
async function handleMarkPaid(req, res, id) {
  const body = await readBody(req);
  const stripeCheckoutSessionId = body.stripeCheckoutSessionId || null;
  const stripePaymentIntentId = body.stripePaymentIntentId || null;

  const pool = getPool();
  const [rows] = await pool.query("SELECT * FROM deals WHERE id = ?", [id]);
  if (rows.length === 0) return sendJson(res, 404, { error: "Deal not found" });

  if (rows[0].status === "paid") {
    return sendJson(res, 200, { deal: publicDeal(rows[0]) });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE deals SET status = 'paid', paid_at = NOW(), stripe_checkout_session_id = ?, stripe_payment_intent_id = ? WHERE id = ?`,
      [stripeCheckoutSessionId, stripePaymentIntentId, id]
    );
    const dealRequestId = rows[0].deal_request_id;
    const bidId = rows[0].bid_id;
    if (dealRequestId && bidId) {
      await conn.query("UPDATE deal_requests SET status = 'locked' WHERE id = ?", [dealRequestId]);
      await conn.query("UPDATE deal_bids SET status = 'accepted' WHERE id = ?", [bidId]);
      await conn.query(
        "UPDATE deal_bids SET status = 'expired' WHERE deal_request_id = ? AND id != ? AND status = 'active'",
        [dealRequestId, bidId]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const [updated] = await pool.query("SELECT * FROM deals WHERE id = ?", [id]);
  sendJson(res, 200, { deal: publicDeal(updated[0]) });
}

// ---------------------------------------------------------------------
// deal_requests
// ---------------------------------------------------------------------

function publicDealRequest(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    buyerUserId: String(row.buyer_user_id),
    strategy: row.strategy,
    referenceBrandCode: row.reference_brand_code,
    referenceVin: row.reference_vin,
    referenceYear: row.reference_year,
    referenceMake: row.reference_make,
    referenceModel: row.reference_model,
    referenceTrim: row.reference_trim,
    referencePrice: row.reference_price,
    referenceMsrp: row.reference_msrp,
    referenceImageUrl: row.reference_image_url,
    targetOtdPrice: row.target_otd_price,
    targetDiscountPercent: row.target_discount_percent !== null ? Number(row.target_discount_percent) : null,
    paymentMethod: row.payment_method,
    dealStructure: typeof row.deal_structure_json === "string" ? JSON.parse(row.deal_structure_json) : row.deal_structure_json,
    tradeIn: typeof row.trade_in_json === "string" ? JSON.parse(row.trade_in_json) : row.trade_in_json,
    buyerZip: row.buyer_zip,
    buyerState: row.buyer_state,
    searchRadiusMiles: row.search_radius_miles,
    sameStateOnly: Boolean(row.same_state_only),
    buyerComment: row.buyer_comment,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

// Safety-net check, mirrored (not shared — different runtimes) from the
// Next.js layer's real-time validation: the Next.js route is the primary
// enforcement point since it sits closest to the untrusted browser, but
// this server never assumes a caller upheld that — a comment containing an
// actual contact vector (email/phone/link/handle/solicitation phrase)
// never gets persisted, no matter what called this endpoint.
function findContactInfo(text) {
  const t = (text || "").toString();
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(t)) return "an email address";
  if (/(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(t)) return "a phone number";
  if (/\b((https?:\/\/)|(www\.))\S+/i.test(t)) return "a website link";
  if (/\b[a-z0-9-]+\.(com|net|org|io|co|biz|info)\b/i.test(t)) return "a website link";
  if (/@[a-zA-Z0-9_]{3,}/.test(t)) return "a social media handle";
  if (/\b(call|text|email|dm|reach|contact)\s+me\b/i.test(t)) return "contact instructions";
  return null;
}

async function handleCreateDealRequest(req, res) {
  const body = await readBody(req);
  const buyerUserId = Number(body.buyerUserId);
  const strategy = body.strategy;
  const referenceBrandCode = (body.referenceBrandCode || "").trim();
  const referenceVin = (body.referenceVin || "").trim();
  const referenceMake = (body.referenceMake || "").trim();
  const referenceModel = (body.referenceModel || "").trim();
  const paymentMethod = body.paymentMethod;
  const buyerZip = (body.buyerZip || "").trim();
  const buyerState = (body.buyerState || "").trim().toUpperCase();
  const buyerComment = typeof body.buyerComment === "string" ? body.buyerComment.trim().slice(0, 1000) : "";

  if (!Number.isFinite(buyerUserId) || buyerUserId <= 0) return badRequest(res, "Invalid buyerUserId");
  if (!["exact_auction", "firm_offer", "flexible_discount"].includes(strategy)) return badRequest(res, "Invalid strategy");
  if (!referenceBrandCode) return badRequest(res, "referenceBrandCode is required");
  if (!referenceVin) return badRequest(res, "referenceVin is required");
  if (!referenceMake || !referenceModel) return badRequest(res, "referenceMake/referenceModel are required");
  if (!["all_three", "cash", "finance", "lease"].includes(paymentMethod)) return badRequest(res, "Invalid paymentMethod");
  if (!buyerZip) return badRequest(res, "buyerZip is required");
  if (!/^[A-Z]{2}$/.test(buyerState)) return badRequest(res, "Invalid buyerState");
  const contactInfoFound = findContactInfo(buyerComment);
  if (contactInfoFound) return badRequest(res, `Your comment appears to contain ${contactInfoFound} — remove it and try again.`);

  const searchRadiusMiles = Number.isFinite(Number(body.searchRadiusMiles)) ? Number(body.searchRadiusMiles) : 100;
  const sameStateOnly = body.sameStateOnly !== false;

  const pool = getPool();
  const [result] = await pool.query(
    `INSERT INTO deal_requests
       (buyer_user_id, strategy, reference_brand_code, reference_vin, reference_year, reference_make, reference_model,
        reference_trim, reference_price, reference_msrp, reference_image_url, target_otd_price, target_discount_percent,
        payment_method, deal_structure_json, trade_in_json, buyer_zip, buyer_state, search_radius_miles, same_state_only,
        buyer_comment, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW() + INTERVAL 90 DAY)`,
    [
      buyerUserId,
      strategy,
      referenceBrandCode,
      referenceVin,
      body.referenceYear ?? null,
      referenceMake,
      referenceModel,
      body.referenceTrim ?? null,
      body.referencePrice ?? null,
      body.referenceMsrp ?? null,
      body.referenceImageUrl ?? null,
      body.targetOtdPrice ?? null,
      body.targetDiscountPercent ?? null,
      paymentMethod,
      body.dealStructure ? JSON.stringify(body.dealStructure) : null,
      body.tradeIn ? JSON.stringify(body.tradeIn) : null,
      buyerZip,
      buyerState,
      searchRadiusMiles,
      sameStateOnly,
      buyerComment || null,
    ]
  );

  const [rows] = await pool.query("SELECT * FROM deal_requests WHERE id = ?", [result.insertId]);
  sendJson(res, 201, { dealRequest: publicDealRequest(rows[0]) });
}

async function handleGetDealRequest(req, res, id) {
  const pool = getPool();
  const [rows] = await pool.query("SELECT * FROM deal_requests WHERE id = ?", [id]);
  if (rows.length === 0) return sendJson(res, 404, { error: "Deal request not found" });
  sendJson(res, 200, { dealRequest: publicDealRequest(rows[0]) });
}

// GET /api/deal-requests?status=active[&buyerUserId=] — server-to-server
// only (the dealer-matching route calls this with the shared key; never
// exposed directly to a browser).
async function handleListDealRequests(req, res, query) {
  const pool = getPool();
  const status = query.get("status");
  const buyerUserId = query.get("buyerUserId");
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  if (buyerUserId) {
    clauses.push("buyer_user_id = ?");
    params.push(Number(buyerUserId));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows] = await pool.query(`SELECT * FROM deal_requests ${where} ORDER BY created_at DESC LIMIT 500`, params);
  sendJson(res, 200, { dealRequests: rows.map(publicDealRequest) });
}

async function handleExpireDealRequest(req, res, id) {
  const pool = getPool();
  const [rows] = await pool.query("SELECT * FROM deal_requests WHERE id = ?", [id]);
  if (rows.length === 0) return sendJson(res, 404, { error: "Deal request not found" });
  if (rows[0].status === "active") {
    await pool.query("UPDATE deal_requests SET status = 'expired' WHERE id = ? AND status = 'active'", [id]);
  }
  const [updated] = await pool.query("SELECT * FROM deal_requests WHERE id = ?", [id]);
  sendJson(res, 200, { dealRequest: publicDealRequest(updated[0]) });
}

const ENGAGEMENT_PATH = path.resolve(process.cwd(), "data", "deal-engagement.json");

function loadEngagementBlob() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ENGAGEMENT_PATH, "utf8"));
    return {
      tokens: parsed?.tokens && typeof parsed.tokens === "object" ? parsed.tokens : {},
      deals: parsed?.deals && typeof parsed.deals === "object" ? parsed.deals : {},
    };
  } catch {
    return { tokens: {}, deals: {} };
  }
}

function saveEngagementBlob(data) {
  fs.mkdirSync(path.dirname(ENGAGEMENT_PATH), { recursive: true });
  fs.writeFileSync(ENGAGEMENT_PATH, JSON.stringify(data));
}

async function handleGetEngagementBlob(req, res) {
  sendJson(res, 200, loadEngagementBlob());
}

async function handlePutEngagementBlob(req, res) {
  const body = await readBody(req);
  if (!body || typeof body !== "object") return badRequest(res, "Invalid engagement payload");
  saveEngagementBlob({
    tokens: body.tokens && typeof body.tokens === "object" ? body.tokens : {},
    deals: body.deals && typeof body.deals === "object" ? body.deals : {},
  });
  sendJson(res, 200, { ok: true });
}

// ---------------------------------------------------------------------
// deal_bids
// ---------------------------------------------------------------------

function publicDealBid(row, rank) {
  if (!row) return null;
  const totalOtdPrice = Number(row.total_otd_price);
  const salesTax = Number(row.sales_tax);
  const dmvFees = Number(row.dmv_fees);
  return {
    id: String(row.id),
    dealRequestId: String(row.deal_request_id),
    dealerUserId: String(row.dealer_user_id),
    dealerName: row.dealer_name,
    dealerCity: row.dealer_city,
    dealerState: row.dealer_state,
    distanceMiles: row.distance_miles !== null ? Number(row.distance_miles) : null,
    matchedVin: row.matched_vin,
    matchedVehicleTitle: row.matched_vehicle_title,
    matchedVehicleSpec: row.matched_vehicle_spec,
    matchedVehicleImageUrl: row.matched_vehicle_image_url,
    vehicleStatus: row.vehicle_status,
    msrp: Number(row.msrp),
    dealerDiscountDollars: Number(row.dealer_discount_dollars),
    dealerDiscountPercent: Number(row.dealer_discount_percent),
    manufacturerRebates: Number(row.manufacturer_rebates),
    sellingPrice: Number(row.selling_price),
    salesTax,
    dmvFees,
    docFee: Number(row.doc_fee),
    dealerAccessories: Number(row.dealer_accessories),
    tradeInAllowance: row.trade_in_allowance !== null ? Number(row.trade_in_allowance) : null,
    totalOtdPrice,
    // Excludes tax/DMV — the number bids are ranked/competed on.
    quotedOtdPrice: totalOtdPrice - salesTax - dmvFees,
    netOtdWithTradeIn: row.net_otd_with_trade_in !== null ? Number(row.net_otd_with_trade_in) : null,
    financeMonthlyEstimate: row.finance_monthly_estimate,
    leaseMonthlyEstimate: row.lease_monthly_estimate,
    notes: row.notes,
    rank,
    createdAt: row.created_at,
    isTopDeal: rank === 1,
    status: row.status,
    salesRep: row.sales_rep_name ? { name: row.sales_rep_name, title: row.sales_rep_title, phone: row.sales_rep_phone } : null,
  };
}

function rankBidRows(rows) {
  // Rank by the tax/DMV-excluded quoted price, ascending (lowest wins) —
  // not stored, computed here every read so it can never drift from the
  // underlying columns.
  const withQuoted = rows.map((r) => ({
    row: r,
    quoted: Number(r.total_otd_price) - Number(r.sales_tax) - Number(r.dmv_fees),
  }));
  withQuoted.sort((a, b) => a.quoted - b.quoted);
  return withQuoted.map((entry, idx) => publicDealBid(entry.row, idx + 1));
}

async function handleSubmitBid(req, res, dealRequestId) {
  const body = await readBody(req);
  const dealerUserId = Number(body.dealerUserId);
  const dealerName = (body.dealerName || "").trim();
  const matchedVin = (body.matchedVin || "").trim();

  if (!Number.isFinite(dealerUserId) || dealerUserId <= 0) return badRequest(res, "Invalid dealerUserId");
  if (!dealerName) return badRequest(res, "dealerName is required");
  if (!matchedVin) return badRequest(res, "matchedVin is required");

  const pool = getPool();
  const [reqRows] = await pool.query("SELECT * FROM deal_requests WHERE id = ?", [dealRequestId]);
  if (reqRows.length === 0) return sendJson(res, 404, { error: "Deal request not found" });
  const dealRequest = reqRows[0];
  if (dealRequest.status !== "active" || new Date(dealRequest.expires_at).getTime() < Date.now()) {
    return sendJson(res, 409, { error: "This request is no longer accepting bids" });
  }

  const columns = [
    "deal_request_id", "dealer_user_id", "dealer_name", "dealer_city", "dealer_state", "distance_miles",
    "matched_vin", "matched_vehicle_title", "matched_vehicle_spec", "matched_vehicle_image_url", "vehicle_status",
    "msrp", "dealer_discount_dollars", "dealer_discount_percent", "manufacturer_rebates", "selling_price",
    "sales_tax", "dmv_fees", "doc_fee", "dealer_accessories", "trade_in_allowance", "total_otd_price",
    "net_otd_with_trade_in", "finance_monthly_estimate", "lease_monthly_estimate", "notes",
    "sales_rep_name", "sales_rep_title", "sales_rep_phone",
  ];
  const values = [
    dealRequestId, dealerUserId, dealerName, body.dealerCity ?? null, body.dealerState ?? null, body.distanceMiles ?? null,
    matchedVin, body.matchedVehicleTitle || "", body.matchedVehicleSpec ?? null, body.matchedVehicleImageUrl ?? null, body.vehicleStatus ?? null,
    Number(body.msrp) || 0, Number(body.dealerDiscountDollars) || 0, Number(body.dealerDiscountPercent) || 0, Number(body.manufacturerRebates) || 0, Number(body.sellingPrice) || 0,
    Number(body.salesTax) || 0, Number(body.dmvFees) || 0, Number(body.docFee) || 0, Number(body.dealerAccessories) || 0, body.tradeInAllowance ?? null, Number(body.totalOtdPrice) || 0,
    body.netOtdWithTradeIn ?? null, body.financeMonthlyEstimate ?? null, body.leaseMonthlyEstimate ?? null, body.notes || "",
    body.salesRepName ?? null, body.salesRepTitle ?? null, body.salesRepPhone ?? null,
  ];
  const updateAssignments = columns
    .filter((c) => c !== "deal_request_id" && c !== "dealer_user_id")
    .map((c) => `${c} = VALUES(${c})`)
    .join(", ");

  await pool.query(
    `INSERT INTO deal_bids (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
     ON DUPLICATE KEY UPDATE ${updateAssignments}, status = 'active', created_at = NOW()`,
    values
  );

  const [bidRows] = await pool.query(
    "SELECT * FROM deal_bids WHERE deal_request_id = ? AND dealer_user_id = ?",
    [dealRequestId, dealerUserId]
  );
  sendJson(res, 201, { bid: publicDealBid(bidRows[0], null) });
}

async function handleListBidsForRequest(req, res, dealRequestId) {
  const pool = getPool();
  const [rows] = await pool.query(
    "SELECT * FROM deal_bids WHERE deal_request_id = ? AND status != 'withdrawn' ORDER BY total_otd_price ASC",
    [dealRequestId]
  );
  sendJson(res, 200, { bids: rankBidRows(rows) });
}

// GET /api/deal-requests/:id/bids/:bidId — single bid, full/unmasked.
// Server-to-server only, used by checkout/create-session to fetch
// authoritative bid data rather than trusting whatever the browser sent.
async function handleGetSingleBid(req, res, dealRequestId, bidId) {
  const pool = getPool();
  const [rows] = await pool.query(
    "SELECT * FROM deal_bids WHERE id = ? AND deal_request_id = ?",
    [bidId, dealRequestId]
  );
  if (rows.length === 0) return sendJson(res, 404, { error: "Bid not found" });
  sendJson(res, 200, { bid: publicDealBid(rows[0], null) });
}

async function handleListBidsForDealer(req, res, query) {
  const dealerUserId = Number(query.get("dealerUserId"));
  if (!Number.isFinite(dealerUserId) || dealerUserId <= 0) return badRequest(res, "Invalid dealerUserId");

  const pool = getPool();
  const [rows] = await pool.query(
    "SELECT * FROM deal_bids WHERE dealer_user_id = ? AND status != 'withdrawn' ORDER BY created_at DESC",
    [dealerUserId]
  );
  // Rank each bid within its own request (not globally across requests).
  const byRequest = new Map();
  for (const r of rows) {
    const key = r.deal_request_id;
    if (!byRequest.has(key)) byRequest.set(key, []);
    byRequest.get(key).push(r);
  }
  const rankById = new Map();
  for (const [, group] of byRequest) {
    const ranked = rankBidRows(group);
    ranked.forEach((b) => rankById.set(b.id, b.rank));
  }
  const bids = rows
    .map((r) => publicDealBid(r, rankById.get(String(r.id)) || 1))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  sendJson(res, 200, { bids });
}

// ---------------------------------------------------------------------
// dealer contact reveal — real buyer contact for a bid this dealer won
// ---------------------------------------------------------------------

async function handleDealerWonDeals(req, res, query) {
  const dealerUserId = Number(query.get("dealerUserId"));
  if (!Number.isFinite(dealerUserId) || dealerUserId <= 0) return badRequest(res, "Invalid dealerUserId");

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT db.*, u.name AS buyer_name, u.email AS buyer_email, u.phone AS buyer_phone
     FROM deal_bids db
     JOIN deal_requests dr ON dr.id = db.deal_request_id
     JOIN users u ON u.id = dr.buyer_user_id
     WHERE db.dealer_user_id = ? AND db.status = 'accepted'
     ORDER BY db.created_at DESC`,
    [dealerUserId]
  );
  sendJson(res, 200, {
    wonDeals: rows.map((r) => ({
      bid: publicDealBid(r, 1),
      buyerName: r.buyer_name,
      buyerEmail: r.buyer_email,
      buyerPhone: r.buyer_phone,
    })),
  });
}

const server = http.createServer((req, res) => {
  if (!requireAuth(req, res)) return;

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  const run = (fn, ...args) => {
    fn(req, res, ...args).catch((err) => {
      console.error(`${new Date().toISOString()} ${pathname} -> 500:`, err.message);
      sendJson(res, 500, { error: "Internal server error" });
    });
  };

  if (req.method === "GET" && pathname === "/health") {
    return sendJson(res, 200, { status: "ok" });
  }

  // deals (payment/lock)
  if (req.method === "POST" && pathname === "/api/deals") {
    return run(handleCreateDeal);
  }
  const dealMatch = pathname.match(/^\/api\/deals\/(\d+)$/);
  if (req.method === "GET" && dealMatch) {
    return run(handleGetDeal, Number(dealMatch[1]));
  }
  const markPaidMatch = pathname.match(/^\/api\/deals\/(\d+)\/mark-paid$/);
  if (req.method === "POST" && markPaidMatch) {
    return run(handleMarkPaid, Number(markPaidMatch[1]));
  }

  // deal_requests
  if (req.method === "POST" && pathname === "/api/deal-requests") {
    return run(handleCreateDealRequest);
  }
  if (req.method === "GET" && pathname === "/api/deal-requests") {
    return run(handleListDealRequests, url.searchParams);
  }
  const reqBidsMatch = pathname.match(/^\/api\/deal-requests\/(\d+)\/bids$/);
  if (req.method === "POST" && reqBidsMatch) {
    return run(handleSubmitBid, Number(reqBidsMatch[1]));
  }
  if (req.method === "GET" && reqBidsMatch) {
    return run(handleListBidsForRequest, Number(reqBidsMatch[1]));
  }
  const singleBidMatch = pathname.match(/^\/api\/deal-requests\/(\d+)\/bids\/(\d+)$/);
  if (req.method === "GET" && singleBidMatch) {
    return run(handleGetSingleBid, Number(singleBidMatch[1]), Number(singleBidMatch[2]));
  }
  const reqIdMatch = pathname.match(/^\/api\/deal-requests\/(\d+)$/);
  if (req.method === "GET" && reqIdMatch) {
    return run(handleGetDealRequest, Number(reqIdMatch[1]));
  }
  const expireMatch = pathname.match(/^\/api\/deal-requests\/(\d+)\/expire$/);
  if (req.method === "POST" && expireMatch) {
    return run(handleExpireDealRequest, Number(expireMatch[1]));
  }

  if (req.method === "GET" && pathname === "/api/deal-engagement") {
    return run(handleGetEngagementBlob);
  }
  if (req.method === "PUT" && pathname === "/api/deal-engagement") {
    return run(handlePutEngagementBlob);
  }

  // dealer-scoped
  if (req.method === "GET" && pathname === "/api/dealer-bids") {
    return run(handleListBidsForDealer, url.searchParams);
  }
  if (req.method === "GET" && pathname === "/api/dealer-won-deals") {
    return run(handleDealerWonDeals, url.searchParams);
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Deals API server listening on port ${PORT}`);
  console.log(`  POST /api/deals`);
  console.log(`  GET  /api/deals/:id`);
  console.log(`  POST /api/deals/:id/mark-paid`);
  console.log(`  POST /api/deal-requests`);
  console.log(`  GET  /api/deal-requests?status=&buyerUserId=`);
  console.log(`  GET  /api/deal-requests/:id`);
  console.log(`  POST /api/deal-requests/:id/expire`);
  console.log(`  GET  /api/deal-engagement`);
  console.log(`  PUT  /api/deal-engagement`);
  console.log(`  POST /api/deal-requests/:id/bids`);
  console.log(`  GET  /api/deal-requests/:id/bids`);
  console.log(`  GET  /api/deal-requests/:id/bids/:bidId`);
  console.log(`  GET  /api/dealer-bids?dealerUserId=`);
  console.log(`  GET  /api/dealer-won-deals?dealerUserId=`);
  console.log(`  GET  /health`);
  console.log(`All routes require header X-Trimscout-Api-Key.`);
});
