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
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { inventoryListQuery } from "./inventoryListQuery.js";

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

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > maxBytes) {
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
    paperworkStatus: row.paperwork_status || "pending_dealer_upload",
    contractFileName: row.contract_file_name || null,
    paperworkUploadedAt: row.paperwork_uploaded_at || null,
    verification:
      typeof row.verification_json === "string"
        ? JSON.parse(row.verification_json)
        : row.verification_json || null,
    tradeIn: parseJsonColumn(row.trade_in_json),
    tradeInAppraisal: parseJsonColumn(row.trade_in_appraisal_json),
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

function parseJsonColumn(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Trade-in: the buyer's details + photos after they accept, and the
// dealer's allowance for it. Both live as JSON on the deal row, photos
// inline as data URLs — same choice as the contract PDF: a deal's whole
// record in one place, no second storage system to back up.
// ---------------------------------------------------------------------
const TRADE_IN_MAX_BYTES = 12_000_000; // 5 photos at ~1.5 MB base64 each, plus details
const TRADE_IN_MAX_PHOTOS = 5;
const TRADE_IN_ANGLES = new Set(["front_angle", "rear_angle", "interior_odometer", "tires_wheels", "damage_cosmetic"]);
const TRADE_IN_CONDITIONS = new Set(["excellent", "very_good", "good", "fair"]);

let tradeInColumnsEnsured = false;
async function ensureTradeInColumns(pool) {
  if (tradeInColumnsEnsured) return;
  // MariaDB supports IF NOT EXISTS on ADD COLUMN, so this is safe to run
  // on every start.
  await pool.query("ALTER TABLE deals ADD COLUMN IF NOT EXISTS trade_in_json LONGTEXT NULL");
  await pool.query("ALTER TABLE deals ADD COLUMN IF NOT EXISTS trade_in_appraisal_json TEXT NULL");
  tradeInColumnsEnsured = true;
}

function cleanTradeInSubmission(input) {
  if (!input || typeof input !== "object") return null;
  const year = Number(input.year);
  const mileage = Number(input.mileage);
  const make = String(input.make || "").trim().slice(0, 40);
  const model = String(input.model || "").trim().slice(0, 60);
  if (!Number.isInteger(year) || year < 1980 || year > new Date().getFullYear() + 1) return null;
  if (!make || !model) return null;
  if (!Number.isFinite(mileage) || mileage < 0 || mileage > 1_000_000) return null;
  const condition = TRADE_IN_CONDITIONS.has(input.condition) ? input.condition : "good";
  const vin = String(input.vin || "").trim().toUpperCase();
  const photos = Array.isArray(input.photos) ? input.photos.slice(0, TRADE_IN_MAX_PHOTOS) : [];
  const cleanPhotos = [];
  for (const p of photos) {
    if (!p || typeof p !== "object") continue;
    const url = String(p.imageUrl || "");
    if (!url.startsWith("data:image/jpeg;base64,") && !url.startsWith("data:image/webp;base64,")) continue;
    if (url.length > 2_500_000) continue;
    cleanPhotos.push({
      id: String(p.id || "").slice(0, 40) || `photo-${cleanPhotos.length + 1}`,
      angle: TRADE_IN_ANGLES.has(p.angle) ? p.angle : "damage_cosmetic",
      label: String(p.label || "").slice(0, 60),
      imageUrl: url,
    });
  }
  return {
    year,
    make,
    model,
    trim: String(input.trim || "").trim().slice(0, 60),
    mileage: Math.round(mileage),
    vin: vin.length === 17 ? vin : undefined,
    condition,
    loanPayoff: Math.max(0, Math.round(Number(input.loanPayoff) || 0)),
    notes: String(input.notes || "").trim().slice(0, 1000) || undefined,
    photos: cleanPhotos,
    submittedAt: new Date().toISOString(),
  };
}

// POST /api/deals/:id/trade-in — buyer's trade-in details and photos.
async function handleSubmitTradeIn(req, res, id) {
  const body = await readBody(req, TRADE_IN_MAX_BYTES);
  const tradeIn = cleanTradeInSubmission(body.tradeIn);
  if (!tradeIn) return badRequest(res, "tradeIn needs a valid year, make, model and mileage");

  const pool = getPool();
  await ensureTradeInColumns(pool);
  const [existing] = await pool.query("SELECT id FROM deals WHERE id = ?", [id]);
  if (existing.length === 0) return sendJson(res, 404, { error: "Deal not found" });

  // A resubmission supersedes the old details and any appraisal made on them.
  await pool.query(
    "UPDATE deals SET trade_in_json = ?, trade_in_appraisal_json = NULL WHERE id = ?",
    [JSON.stringify(tradeIn), id]
  );
  const [rows] = await pool.query("SELECT * FROM deals WHERE id = ?", [id]);
  sendJson(res, 200, { deal: publicDeal(rows[0]) });
}

// POST /api/deals/:id/trade-in/appraisal — the dealer's number.
async function handleAppraiseTradeIn(req, res, id) {
  const body = await readBody(req, 100_000);
  const a = body.appraisal;
  const allowance = Number(a && a.allowance);
  if (!Number.isFinite(allowance) || allowance < 0 || allowance > 500_000) {
    return badRequest(res, "appraisal.allowance must be a dollar amount");
  }
  const appraisal = {
    allowance: Math.round(allowance),
    loanPayoff: Math.max(0, Math.round(Number(a.loanPayoff) || 0)),
    notes: String(a.notes || "").trim().slice(0, 1000) || undefined,
    appraisedAt: new Date().toISOString(),
    appraisedBy: String(a.appraisedBy || "").trim().slice(0, 120),
  };

  const pool = getPool();
  await ensureTradeInColumns(pool);
  const [existing] = await pool.query("SELECT trade_in_json FROM deals WHERE id = ?", [id]);
  if (existing.length === 0) return sendJson(res, 404, { error: "Deal not found" });
  if (!existing[0].trade_in_json) return badRequest(res, "The buyer has not submitted a trade-in for this deal");

  await pool.query("UPDATE deals SET trade_in_appraisal_json = ? WHERE id = ?", [JSON.stringify(appraisal), id]);
  const [rows] = await pool.query("SELECT * FROM deals WHERE id = ?", [id]);
  sendJson(res, 200, { deal: publicDeal(rows[0]) });
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

// POST /api/deals/:id/contract — dealer uploads the sales contract for a
// deal they won. Stores the file inline (base64) alongside the deal row
// rather than a separate object-storage service — contracts here are a
// few hundred KB to a couple MB, and this keeps them backed up with the
// rest of the deal record instead of a second system to manage.
// The 15 MB cap admits a base64-inflated ~11 MB PDF.
async function handleUploadContract(req, res, id) {
  const body = await readBody(req, 15_000_000);
  const fileName = (body.fileName || "").trim();
  const contentBase64 = body.contentBase64 || "";
  if (!fileName) return badRequest(res, "fileName is required");
  if (!contentBase64) return badRequest(res, "contentBase64 is required");

  const pool = getPool();
  const [existing] = await pool.query("SELECT id FROM deals WHERE id = ?", [id]);
  if (existing.length === 0) return sendJson(res, 404, { error: "Deal not found" });

  await pool.query(
    `UPDATE deals SET
       contract_file_name = ?, contract_pdf_base64 = ?, paperwork_status = 'uploaded',
       paperwork_uploaded_at = NOW(), verification_json = NULL
     WHERE id = ?`,
    [fileName, contentBase64, id]
  );
  const [rows] = await pool.query("SELECT * FROM deals WHERE id = ?", [id]);
  sendJson(res, 200, { deal: publicDeal(rows[0]) });
}

// GET /api/deals/:id/contract — server-to-server only, returns the stored
// file so it can be re-read for AI verification or handed to the buyer as
// a download. Never exposed straight to a browser (no auth on the file
// bytes beyond the shared API key every route here already requires).
async function handleGetContractFile(req, res, id) {
  const pool = getPool();
  const [rows] = await pool.query(
    "SELECT contract_file_name, contract_pdf_base64 FROM deals WHERE id = ?",
    [id]
  );
  if (rows.length === 0) return sendJson(res, 404, { error: "Deal not found" });
  if (!rows[0].contract_pdf_base64) return sendJson(res, 404, { error: "No contract uploaded for this deal" });
  sendJson(res, 200, { fileName: rows[0].contract_file_name, contentBase64: rows[0].contract_pdf_base64 });
}

// POST /api/deals/:id/verification — persists the AI verification result
// computed by lib/contractVerification.ts. This server never runs the
// check itself — it only stores whatever result the caller already
// decided, same boundary as /negotiation on deal_requests.
async function handleSaveVerification(req, res, id) {
  const body = await readBody(req);
  if (!body.verification || typeof body.verification !== "object") {
    return badRequest(res, "verification is required");
  }
  const pool = getPool();
  const [result] = await pool.query("UPDATE deals SET verification_json = ? WHERE id = ?", [
    JSON.stringify(body.verification),
    id,
  ]);
  if (result.affectedRows === 0) return sendJson(res, 404, { error: "Deal not found" });
  const [rows] = await pool.query("SELECT * FROM deals WHERE id = ?", [id]);
  sendJson(res, 200, { deal: publicDeal(rows[0]) });
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

// POST /api/deal-requests/:id/negotiation — server-to-server only (the
// Next.js negotiate route calls this after lib/negotiationPolicy.ts has
// already decided the action; this endpoint just persists the result, it
// never makes a pricing decision itself). Writes the buyer's next target
// OTD (only ever moving toward walk-away, per the policy) and appends one
// move to dealStructure.negotiation.moves — never overwrites prior moves.
async function handleUpdateDealRequestNegotiation(req, res, id) {
  const body = await readBody(req);
  const pool = getPool();
  const [rows] = await pool.query("SELECT * FROM deal_requests WHERE id = ?", [id]);
  if (rows.length === 0) return sendJson(res, 404, { error: "Deal request not found" });

  const existing = publicDealRequest(rows[0]);
  const dealStructure = existing.dealStructure && typeof existing.dealStructure === "object" ? existing.dealStructure : {};
  const negotiation = dealStructure.negotiation && typeof dealStructure.negotiation === "object" ? dealStructure.negotiation : { moves: [] };
  const moves = Array.isArray(negotiation.moves) ? negotiation.moves : [];

  if (body.move && typeof body.move === "object") {
    moves.push(body.move);
  }

  const nextDealStructure = { ...dealStructure, negotiation: { ...negotiation, moves } };
  const nextTargetOtd =
    typeof body.nextTargetOtd === "number" && Number.isFinite(body.nextTargetOtd)
      ? body.nextTargetOtd
      : existing.targetOtdPrice;

  await pool.query(
    "UPDATE deal_requests SET target_otd_price = ?, deal_structure_json = ? WHERE id = ?",
    [nextTargetOtd, JSON.stringify(nextDealStructure), id]
  );
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

function publicDealBid(row, rank, leadingDiscountPercent = null) {
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
    // The current best dealer_discount_percent across every active bid on
    // this same request, regardless of who holds it — never the other
    // dealer's name/city/VIN, just the one number a dealer needs to know
    // what to beat. Equals this bid's own dealerDiscountPercent when rank
    // is 1. Null only when leadingDiscountPercent wasn't computed by the
    // caller (single-bid lookups that don't need it).
    leadingDiscountPercent,
  };
}

// Ascending by the tax/DMV-excluded quoted price (lowest wins) — not
// stored, computed here every read so it can never drift from the
// underlying columns. Shared by every place that needs "who's winning"
// for a set of bids on one request.
function sortByQuotedPrice(rows) {
  return rows
    .map((r) => ({ row: r, quoted: Number(r.total_otd_price) - Number(r.sales_tax) - Number(r.dmv_fees) }))
    .sort((a, b) => a.quoted - b.quoted)
    .map((entry) => entry.row);
}

function rankBidRows(rows) {
  const sorted = sortByQuotedPrice(rows);
  const leadingDiscountPercent = sorted.length > 0 ? Number(sorted[0].dealer_discount_percent) : null;
  return sorted.map((row, idx) => publicDealBid(row, idx + 1, leadingDiscountPercent));
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

// GET /api/deal-requests/:id/market — a deliberately thin aggregate, not a
// list of bids: the current best dealer_discount_percent on this request
// and how many dealers have bid, nothing else. Lets a dealer who hasn't bid
// yet (or is deciding whether to revise) see what they're up against
// without exposing any other dealer's identity, VIN, or price breakdown —
// safe to expose to the dealer-matching route for every inbound request,
// unlike handleListBidsForRequest's full unmasked rows.
async function handleGetRequestMarket(req, res, dealRequestId) {
  const pool = getPool();
  const [rows] = await pool.query(
    "SELECT dealer_discount_percent, total_otd_price, sales_tax, dmv_fees FROM deal_bids WHERE deal_request_id = ? AND status != 'withdrawn'",
    [dealRequestId]
  );
  if (rows.length === 0) {
    return sendJson(res, 200, { leadingDiscountPercent: null, bidCount: 0 });
  }
  const [leader] = sortByQuotedPrice(rows);
  sendJson(res, 200, {
    leadingDiscountPercent: Number(leader.dealer_discount_percent),
    bidCount: rows.length,
  });
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
  const [myRows] = await pool.query(
    "SELECT * FROM deal_bids WHERE dealer_user_id = ? AND status != 'withdrawn' ORDER BY created_at DESC",
    [dealerUserId]
  );
  if (myRows.length === 0) return sendJson(res, 200, { bids: [] });

  // A dealer's true rank/leadingDiscountPercent depend on every dealer's
  // bid on the same request, not just this dealer's own row — the previous
  // version grouped `myRows` (already filtered to this dealer) before
  // ranking, so a dealer was only ever ranked against their own single bid
  // and `rank` came back 1 almost every time regardless of real standing.
  // Fetch each relevant request's full bid set (server-to-server, same
  // trust boundary as handleListBidsForRequest) and rank each one for real.
  const requestIds = [...new Set(myRows.map((r) => r.deal_request_id))];
  const placeholders = requestIds.map(() => "?").join(", ");
  const [allRows] = await pool.query(
    `SELECT * FROM deal_bids WHERE deal_request_id IN (${placeholders}) AND status != 'withdrawn'`,
    requestIds
  );
  const byRequest = new Map();
  for (const r of allRows) {
    const key = r.deal_request_id;
    if (!byRequest.has(key)) byRequest.set(key, []);
    byRequest.get(key).push(r);
  }
  const rankedById = new Map();
  for (const [, group] of byRequest) {
    for (const b of rankBidRows(group)) rankedById.set(b.id, b);
  }

  const bids = myRows
    .map((r) => rankedById.get(String(r.id)) || publicDealBid(r, null))
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
  await ensureTradeInColumns(pool);
  // LEFT JOIN deals: a bid can be 'accepted' (the mark-paid cascade sets
  // that) slightly before/without a deals row in edge cases, so this must
  // not drop the won bid just because the deal row lookup comes back
  // empty — the dealer should still see they won, just without a deal id
  // to upload paperwork against yet.
  const [rows] = await pool.query(
    `SELECT db.*, u.name AS buyer_name, u.email AS buyer_email, u.phone AS buyer_phone,
            d.id AS deal_id, d.paperwork_status, d.contract_file_name, d.verification_json,
            d.trade_in_json, d.trade_in_appraisal_json, dr.buyer_state
     FROM deal_bids db
     JOIN deal_requests dr ON dr.id = db.deal_request_id
     JOIN users u ON u.id = dr.buyer_user_id
     LEFT JOIN deals d ON d.bid_id = db.id
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
      dealId: r.deal_id ? String(r.deal_id) : null,
      paperworkStatus: r.paperwork_status || "pending_dealer_upload",
      contractFileName: r.contract_file_name || null,
      verification: typeof r.verification_json === "string" ? JSON.parse(r.verification_json) : r.verification_json || null,
      tradeIn: parseJsonColumn(r.trade_in_json),
      tradeInAppraisal: parseJsonColumn(r.trade_in_appraisal_json),
      buyerState: r.buyer_state || null,
    })),
  });
}

// ---------------------------------------------------------------------
// dealer responsiveness — real, computed from actual bid timing, never
// fabricated. Shown to a buyer next to a dealer's name while building an
// offer, so they know what to expect before they send it.
// ---------------------------------------------------------------------

// GET /api/dealer-responsiveness?dealerName= — public-facing aggregate
// only (bid count + average response time), no dealer/buyer identity
// beyond the name the caller already supplied. dealer_name here is always
// the bidding dealer's own account name (set server-side from their
// session at bid time, never client-supplied), so this is an exact match
// against dealership_contacts' canonical name — no fuzzy matching needed.
//
// Known nuance: a dealer revising an existing bid updates deal_bids'
// created_at (see handleSubmitBid's ON DUPLICATE KEY UPDATE), so a revised
// bid's response time reflects the revision, not the original response.
// Acceptable for now — there's no historical data at all yet for this to
// matter in practice.
async function handleGetDealerResponsiveness(req, res, query) {
  const dealerName = (query.get("dealerName") || "").trim();
  if (!dealerName) return badRequest(res, "dealerName is required");

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT
       COUNT(*) AS bid_count,
       AVG(TIMESTAMPDIFF(SECOND, dr.created_at, db.created_at)) AS avg_response_seconds
     FROM deal_bids db
     JOIN deal_requests dr ON dr.id = db.deal_request_id
     WHERE db.dealer_name = ? AND db.status != 'withdrawn'`,
    [dealerName]
  );
  const row = rows[0];
  const bidCount = Number(row?.bid_count || 0);
  sendJson(res, 200, {
    dealerName,
    bidCount,
    avgResponseHours: bidCount > 0 && row.avg_response_seconds !== null ? Number(row.avg_response_seconds) / 3600 : null,
  });
}

// ---------------------------------------------------------------------
// RFQs — "invite dealers to quote" experiment. Deliberately NOT a
// bidding/auction platform: the vehicle (VIN/stock) and must-haves are
// frozen at creation from a full-match shortlist (see lib/rfq.ts), a buyer
// invites at most RFQ_MAX_INVITES dealers on that SAME car, each dealer
// quotes once via a structured intake (an ops-relayed email reply for now
// — no dealer portal in this pass), and the buyer picks or walks. No
// countdown, no ranking, no binding SLA — those belong to
// deal_requests/deal_bids, not here.
//
// Four tables:
//   rfq_requests — the frozen spec + lifecycle status.
//   rfq_invites  — one row per invited dealer; status tracks whether they
//                  quoted, declined (with a reason), or the invite expired.
//   rfq_quotes   — one row per submitted quote, 1:1 with the invite that
//                  produced it.
//   rfq_events   — an append-only log of rfq_invited / quote_received /
//                  quote_incomplete / buyer_picked / buyer_walked /
//                  desk_declined, each with its full payload. No
//                  aggregation endpoint on top of it — response rate,
//                  spec integrity, quote completeness, buyer pick rate,
//                  and time-to-first-quote are scored offline by querying
//                  this table directly (see lib/rfqLogic.ts for the pure
//                  functions that do that math).
// ---------------------------------------------------------------------

const RFQ_MAX_INVITES = 3;

function publicRfqQuote(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    inviteId: String(row.invite_id),
    dealerName: row.dealer_name,
    price: Number(row.price),
    fees: typeof row.fees_json === "string" ? JSON.parse(row.fees_json) : row.fees_json || [],
    totalOtdPrice: Number(row.total_otd_price),
    vin: row.vin,
    stockNumber: row.stock_number,
    expiresAt: row.expires_at,
    submittedAt: row.submitted_at,
    mustHaveAcknowledgement: Boolean(row.must_have_acknowledgement),
    notes: row.notes,
    lease: typeof row.lease_json === "string" ? JSON.parse(row.lease_json) : row.lease_json || null,
    used: typeof row.used_json === "string" ? JSON.parse(row.used_json) : row.used_json || null,
    supersededAt: row.superseded_at || null,
  };
}

function parseJsonCol(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function publicRfqInvite(row, quoteRow) {
  return {
    id: String(row.id),
    dealerName: row.dealer_name,
    dealerContactEmail: row.dealer_contact_email,
    status: row.status,
    declineReason: row.decline_reason,
    invitedAt: row.invited_at,
    respondedAt: row.responded_at,
    quote: publicRfqQuote(quoteRow),
    desk: parseJsonCol(row.desk_json),
    vehicle: parseJsonCol(row.vehicle_json),
    deliveryStatus: row.delivery_status || "queued",
    queuedAt: row.queued_at || row.invited_at || null,
    sentAt: row.sent_at || null,
    viewedAt: row.viewed_at || null,
    // Server-to-server only: the Next.js send path builds the tracked link
    // from this and strips it before anything reaches a browser.
    viewToken: row.view_token || null,
    // The buyer's scoped counter to this desk's last quote, if any.
    buyerCounter: parseJsonCol(row.buyer_counter_json) || null,
    buyerCounterAt: row.buyer_counter_at || null,
    // Set when the dealership opted out while this invite was still open (see auth server's
    // opt-out cascade). The buyer app stops waiting on it and disables counters; a quote
    // submitted before it stays readable.
    dealerUnsubscribedAt: row.dealer_unsubscribed_at || null,
    priorQuotes: Array.isArray(row.__priorQuotes) ? row.__priorQuotes : [],
  };
}

// ---------------------------------------------------------------------
// Quote Request Package columns — added on first start, safe to re-run.
// ---------------------------------------------------------------------
let quotePackageColumnsEnsured = false;
async function ensureQuotePackageColumns(pool) {
  if (quotePackageColumnsEnsured) return;
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS package_kind VARCHAR(16) NOT NULL DEFAULT 'match'");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS link_pastes_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS deal_reference VARCHAR(16) NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS lease_prefs_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS quote_prefs_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS buyer_note VARCHAR(1000) NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS trade_in_expected TINYINT(1) NULL");
  // Admin approval before any dealer sees a request (2026-09-17). Existing rows were already released.
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS approval_status VARCHAR(16) NOT NULL DEFAULT 'approved'");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS approval_decided_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS approval_decided_by VARCHAR(191) NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500) NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS admin_edits_json TEXT NULL");
  // Quote intent (2026-09-17): same_spec = this VIN/build; alternate = open to other vehicles, no VIN required.
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS lane VARCHAR(16) NOT NULL DEFAULT 'same_spec'");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS alternate_ask_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_requests MODIFY vin VARCHAR(17) NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS used_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS lease_sheet_locked_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS lease_sheet_locked_by_invite_id BIGINT NULL");
  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS lease_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS superseded_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS buyer_counter_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS buyer_counter_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS dealer_unsubscribed_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS desk_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS vehicle_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(16) NOT NULL DEFAULT 'queued'");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS queued_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS sent_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS viewed_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS view_token VARCHAR(64) NULL");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_rfq_invites_view_token ON rfq_invites (view_token)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_rfq_invites_contact_email ON rfq_invites (dealer_contact_email)");
  quotePackageColumnsEnsured = true;
}

function newViewToken() {
  return randomBytes(24).toString("base64url");
}

function publicRfqRequest(row, invites) {
  if (!row) return null;
  return {
    id: String(row.id),
    buyerUserId: String(row.buyer_user_id),
    vin: row.vin,
    stockNumber: row.stock_number,
    vehicleYear: row.vehicle_year,
    vehicleMake: row.vehicle_make,
    vehicleModel: row.vehicle_model,
    vehicleTrim: row.vehicle_trim,
    mustHaves: typeof row.must_haves_json === "string" ? JSON.parse(row.must_haves_json) : row.must_haves_json,
    invites,
    status: row.status,
    pickedQuoteId: row.picked_quote_id ? String(row.picked_quote_id) : null,
    createdAt: row.created_at,
    packageKind: row.package_kind || "match",
    linkPastes: parseJsonCol(row.link_pastes_json) || [],
    dealReference: row.deal_reference || null,
    leasePrefs: parseJsonCol(row.lease_prefs_json) || null,
    // Finance / cash ask (used cars); null on lease requests.
    quotePrefs: parseJsonCol(row.quote_prefs_json) || null,
    // The buyer's note to every quoting dealer, word for word.
    buyerNote: row.buyer_note || null,
    // Buyer said a trade-in is coming — handled after the OTD price, never in the quote.
    tradeInExpected: row.trade_in_expected == null ? null : Boolean(row.trade_in_expected),
    // same_spec (this VIN/build) or alternate (open to other vehicles — no VIN; every quote is an alternate).
    lane: row.lane || "same_spec",
    alternateAsk: parseJsonCol(row.alternate_ask_json) || null,
    // Admin gate: 'pending' until an admin releases it, 'approved' (released), or 'rejected' (reason to the buyer).
    approvalStatus: row.approval_status || "approved",
    approvalDecidedAt: row.approval_decided_at || null,
    approvalDecidedBy: row.approval_decided_by || null,
    rejectionReason: row.rejection_reason || null,
    // Corrections an admin made before release: [{ at, by, summary }].
    adminEdits: parseJsonCol(row.admin_edits_json) || [],
    // Frozen the first time a dealer opens their quote link; null while the buyer may still edit.
    leaseSheetLockedAt: row.lease_sheet_locked_at || null,
    leaseSheetLockedByInviteId: row.lease_sheet_locked_by_invite_id ? String(row.lease_sheet_locked_by_invite_id) : null,
  };
}

async function loadRfqInvitesWithQuotes(pool, rfqId) {
  const [inviteRows] = await pool.query(
    "SELECT * FROM rfq_invites WHERE rfq_id = ? ORDER BY invited_at ASC",
    [rfqId]
  );
  if (inviteRows.length === 0) return [];
  const inviteIds = inviteRows.map((r) => r.id);
  const placeholders = inviteIds.map(() => "?").join(", ");
  const [quoteRows] = await pool.query(
    `SELECT * FROM rfq_quotes WHERE invite_id IN (${placeholders})`,
    inviteIds
  );
  // Latest live quote per invite; superseded versions ride along for history.
  const liveByInvite = new Map();
  const priorByInvite = new Map();
  for (const q of quoteRows) {
    if (q.superseded_at) {
      if (!priorByInvite.has(q.invite_id)) priorByInvite.set(q.invite_id, []);
      priorByInvite.get(q.invite_id).push(publicRfqQuote(q));
    } else {
      liveByInvite.set(q.invite_id, q);
    }
  }
  return inviteRows.map((r) => publicRfqInvite({ ...r, __priorQuotes: priorByInvite.get(r.id) || [] }, liveByInvite.get(r.id) || null));
}

// POST /api/rfqs — freezes a full-match vehicle + its confirmed must-haves
// into a new RFQ. The caller (Next.js route) is responsible for having
// actually verified this was a full match before calling here — this
// server has no opinion on where mustHaves came from, only that they're
// non-empty (an RFQ with zero must-haves recorded is never valid).
async function handleCreateRfq(req, res) {
  const body = await readBody(req);
  const buyerUserId = (body.buyerUserId || "").toString().trim();
  const vin = (body.vin || "").trim().toUpperCase();
  const stockNumber = body.stockNumber ? String(body.stockNumber).trim() : null;
  const vehicleYear = Number(body.vehicleYear);
  const vehicleMake = (body.vehicleMake || "").trim();
  const vehicleModel = (body.vehicleModel || "").trim();
  const vehicleTrim = (body.vehicleTrim || "").trim();
  const mustHaves = Array.isArray(body.mustHaves) ? body.mustHaves : [];

  // "links" = the v1 core loop: pasted dealer links, one desk per car, no
  // factory-option match and therefore no must-haves. "match" keeps the
  // original rule that every must-have is a confirmed hit.
  const packageKind = body.packageKind === "links" ? "links" : "match";
  const linkPastes = Array.isArray(body.linkPastes) ? body.linkPastes.slice(0, 3) : [];
  const dealReference = typeof body.dealReference === "string" && /^TS-[A-Z0-9]{6}$/.test(body.dealReference) ? body.dealReference : null;
  const buyerNote = typeof body.buyerNote === "string" && body.buyerNote.trim() ? body.buyerNote.trim().slice(0, 1000) : null;
  const tradeInExpected = typeof body.tradeInExpected === "boolean" ? (body.tradeInExpected ? 1 : 0) : null;

  const lane = body.lane === "alternate" ? "alternate" : "same_spec";
  const alternateAsk = lane === "alternate" && body.alternateAsk && typeof body.alternateAsk === "object" ? body.alternateAsk : null;

  if (!buyerUserId) return badRequest(res, "buyerUserId is required");
  // The alternate lane quotes an ask, not a VIN: no VIN, year, make/model or link required.
  if (lane === "same_spec") {
    if (!vin) return badRequest(res, "vin is required");
    if (!Number.isFinite(vehicleYear) || vehicleYear <= 0) return badRequest(res, "Invalid vehicleYear");
    if (!vehicleMake || !vehicleModel) return badRequest(res, "vehicleMake and vehicleModel are required");
  }
  if (lane === "alternate") {
    if (!alternateAsk) return badRequest(res, "alternateAsk is required on the alternate lane");
  } else if (packageKind === "match") {
    if (!vehicleTrim) return badRequest(res, "vehicleTrim is required");
    if (mustHaves.length === 0) return badRequest(res, "mustHaves must be non-empty — an RFQ needs at least one locked must-have");
    if (!mustHaves.every((m) => m && m.code && m.name && m.status === "hit")) {
      return badRequest(res, "Every mustHave must be a confirmed hit — never freeze an unconfirmed or missed option into an RFQ");
    }
  } else if (linkPastes.length === 0) {
    return badRequest(res, "A links package needs at least one resolved link");
  }

  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [result] = await pool.query(
    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status, package_kind, link_pastes_json, deal_reference, lease_prefs_json, quote_prefs_json, buyer_note, trade_in_expected, approval_status, lane, alternate_ask_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [buyerUserId, vin || "", stockNumber, Number.isFinite(vehicleYear) && vehicleYear > 0 ? vehicleYear : 0, vehicleMake || (lane === "alternate" ? "Open" : ""), vehicleModel || (lane === "alternate" ? "to alternatives" : ""), vehicleTrim, JSON.stringify(mustHaves), packageKind, linkPastes.length ? JSON.stringify(linkPastes) : null, dealReference, body.leasePrefs && typeof body.leasePrefs === "object" ? JSON.stringify(body.leasePrefs) : null, body.quotePrefs && typeof body.quotePrefs === "object" ? JSON.stringify(body.quotePrefs) : null, buyerNote, tradeInExpected, lane, alternateAsk ? JSON.stringify(alternateAsk) : null]
  );
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [result.insertId]);
  sendJson(res, 201, { rfq: publicRfqRequest(rows[0], []) });
}

async function handleGetRfq(req, res, id) {
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [id]);
  if (rows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  const invites = await loadRfqInvitesWithQuotes(pool, id);
  sendJson(res, 200, { rfq: publicRfqRequest(rows[0], invites) });
}

async function handleListRfqs(req, res, query) {
  const buyerUserId = (query.get("buyerUserId") || "").trim();
  const all = query.get("all") === "1";
  if (!buyerUserId && !all) return badRequest(res, "buyerUserId is required");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  // all=1: the admin desk — every buyer's requests, newest first, capped.
  const limit = Math.min(Math.max(Number(query.get("limit")) || 200, 1), 1000);
  const approval = (query.get("approval") || "").trim();
  const [rows] = all
    ? approval
      ? await pool.query("SELECT * FROM rfq_requests WHERE approval_status = ? ORDER BY created_at ASC LIMIT ?", [approval, limit])
      : await pool.query("SELECT * FROM rfq_requests ORDER BY created_at DESC LIMIT ?", [limit])
    : await pool.query(
        "SELECT * FROM rfq_requests WHERE buyer_user_id = ? ORDER BY created_at DESC",
        [buyerUserId]
      );
  const rfqs = [];
  for (const row of rows) {
    const invites = await loadRfqInvitesWithQuotes(pool, row.id);
    rfqs.push(publicRfqRequest(row, invites));
  }
  sendJson(res, 200, { rfqs });
}

// POST /api/rfqs/:id/invites — adds one dealer invite. Enforced here too
// (not just client-side): an RFQ never grows past RFQ_MAX_INVITES active
// (non-declined/expired) invites — this is an RFQ, not an open spray.
async function handleCreateRfqInvite(req, res, rfqId) {
  const body = await readBody(req);
  const dealerName = (body.dealerName || "").trim();
  const dealerContactEmail = body.dealerContactEmail ? String(body.dealerContactEmail).trim().toLowerCase() : null;
  const desk = body.desk && typeof body.desk === "object" ? body.desk : null;
  const vehicle = body.vehicle && typeof body.vehicle === "object" ? body.vehicle : null;
  if (!dealerName) return badRequest(res, "dealerName is required");

  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rfqRows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  // Alternate lane: no car on the invite — the dealer names the VIN they propose when they quote.
  const inviteVehicle = (rfqRows[0].lane || "same_spec") === "alternate" && vehicle && !vehicle.vin ? null : vehicle;

  const [activeRows] = await pool.query(
    "SELECT COUNT(*) AS n FROM rfq_invites WHERE rfq_id = ? AND status NOT IN ('declined', 'expired')",
    [rfqId]
  );
  if (activeRows[0].n >= RFQ_MAX_INVITES) {
    return badRequest(res, `An RFQ can invite at most ${RFQ_MAX_INVITES} dealers`);
  }

  // One open invite per desk, across every buyer: a named person gets one
  // outstanding request at a time. Waiting (invited) invites on packages
  // still collecting count; answered, declined and finished ones don't.
  if (dealerContactEmail) {
    const [openRows] = await pool.query(
      `SELECT COUNT(*) AS n FROM rfq_invites i JOIN rfq_requests r ON r.id = i.rfq_id
       WHERE LOWER(i.dealer_contact_email) = ? AND i.status = 'invited' AND r.status = 'collecting'`,
      [dealerContactEmail]
    );
    if (openRows[0].n > 0) {
      return sendJson(res, 409, { error: "This desk already has an open quote request. Wait for their reply, or walk away from that request first.", code: "desk_already_invited" });
    }
  }

  const viewToken = newViewToken();
  const [result] = await pool.query(
    `INSERT INTO rfq_invites (rfq_id, dealer_name, dealer_contact_email, status, desk_json, vehicle_json, delivery_status, queued_at, view_token)
     VALUES (?, ?, ?, 'invited', ?, ?, 'queued', NOW(), ?)`,
    [rfqId, dealerName, dealerContactEmail, desk ? JSON.stringify(desk) : null, inviteVehicle ? JSON.stringify(inviteVehicle) : null, viewToken]
  );
  await logRfqEvent(pool, rfqId, "invite_queued", { dealerName, inviteId: result.insertId, vin: vehicle && vehicle.vin ? vehicle.vin : rfqRows[0].vin, stockNumber: rfqRows[0].stock_number, mustHaves: [] });
  const mustHaves = typeof rfqRows[0].must_haves_json === "string" ? JSON.parse(rfqRows[0].must_haves_json) : rfqRows[0].must_haves_json;
  await logRfqEvent(pool, rfqId, "rfq_invited", {
    dealerName,
    vin: rfqRows[0].vin,
    stockNumber: rfqRows[0].stock_number,
    mustHaves,
  });
  const [rows] = await pool.query("SELECT * FROM rfq_invites WHERE id = ?", [result.insertId]);
  sendJson(res, 201, { invite: publicRfqInvite(rows[0], null) });
}

// POST /api/rfqs/:id/invites/:inviteId/delivery — { status: "sent" | "viewed" }.
// The audit trail's delivery leg. "sent" is set by the Next.js send path
// after Resend accepts the message; "viewed" when the tracked link in the
// email is opened. Never moves backwards.
async function handleRfqInviteDelivery(req, res, rfqId, inviteId) {
  const body = await readBody(req);
  const status = body.status === "sent" || body.status === "viewed" ? body.status : null;
  if (!status) return badRequest(res, "status must be sent or viewed");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query("SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
  if (rows.length === 0) return sendJson(res, 404, { error: "Invite not found" });
  const current = rows[0].delivery_status || "queued";
  const order = { queued: 0, sent: 1, viewed: 2 };
  if (order[status] > order[current]) {
    await pool.query(
      status === "sent"
        ? "UPDATE rfq_invites SET delivery_status = 'sent', sent_at = NOW() WHERE id = ?"
        : "UPDATE rfq_invites SET delivery_status = 'viewed', viewed_at = NOW(), sent_at = COALESCE(sent_at, NOW()) WHERE id = ?",
      [inviteId]
    );
    await logRfqEvent(pool, rfqId, status === "sent" ? "invite_sent" : "invite_viewed", {
      dealerName: rows[0].dealer_name, inviteId, vin: null, stockNumber: null, mustHaves: [],
    });
  }
  if (status === "viewed") {
    // First dealer view freezes the buyer's lease quote sheet — the ask a
    // dealer is looking at must not change under them. Only ever set once.
    await pool.query(
      "UPDATE rfq_requests SET lease_sheet_locked_at = NOW(), lease_sheet_locked_by_invite_id = ? WHERE id = ? AND lease_sheet_locked_at IS NULL",
      [inviteId, rfqId]
    );
  }
  const [fresh] = await pool.query("SELECT * FROM rfq_invites WHERE id = ?", [inviteId]);
  sendJson(res, 200, { invite: publicRfqInvite(fresh[0], null) });
}

// PATCH /api/rfqs/:id/lease-prefs — { leasePrefs }. The buyer adjusting the
// ask before any dealer has looked at it. 409 once the sheet is locked.
async function handlePatchRfqLeasePrefs(req, res, rfqId) {
  const body = await readBody(req);
  const prefs = body.leasePrefs && typeof body.leasePrefs === "object" ? body.leasePrefs : null;
  if (!prefs) return badRequest(res, "leasePrefs is required");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  if (rows[0].lease_sheet_locked_at) {
    return sendJson(res, 409, { error: "locked", lockedAt: rows[0].lease_sheet_locked_at, lockedByInviteId: rows[0].lease_sheet_locked_by_invite_id ? String(rows[0].lease_sheet_locked_by_invite_id) : null });
  }
  if (rows[0].status !== "collecting") return sendJson(res, 409, { error: "closed" });
  await pool.query("UPDATE rfq_requests SET lease_prefs_json = ? WHERE id = ?", [JSON.stringify(prefs), rfqId]);
  const [fresh] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(fresh[0], invites) });
}

// POST /api/rfqs/:id/invites/:inviteId/buyer-counter — { counter }. The
// buyer's structured response to this desk's current quote: the quote is
// marked superseded (kept for history), the counter is stored on the
// invite, and the invite reopens so the dealer can re-quote through the
// calculator. A request, not a bid.
async function handleBuyerCounter(req, res, rfqId, inviteId) {
  const body = await readBody(req);
  const counter = body.counter && typeof body.counter === "object" ? body.counter : null;
  if (!counter) return badRequest(res, "counter is required");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rfqRows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  if (rfqRows[0].status !== "collecting") return sendJson(res, 409, { error: "closed" });
  const [inviteRows] = await pool.query("SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
  if (inviteRows.length === 0) return sendJson(res, 404, { error: "Invite not found" });
  if (inviteRows[0].status !== "quoted") return sendJson(res, 409, { error: "This desk has no current quote to counter" });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE rfq_quotes SET superseded_at = NOW() WHERE invite_id = ? AND superseded_at IS NULL", [inviteId]);
    await conn.query(
      "UPDATE rfq_invites SET status = 'invited', responded_at = NULL, buyer_counter_json = ?, buyer_counter_at = NOW() WHERE id = ?",
      [JSON.stringify(counter), inviteId]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  await logRfqEvent(pool, rfqId, "buyer_countered", { dealerName: inviteRows[0].dealer_name, inviteId, vin: null, stockNumber: null, mustHaves: [] });
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(rfqRows[0], invites) });
}

// GET /api/rfq-invites/by-token/:token — resolves a tracked-link token.
async function handleRfqInviteByToken(req, res, token) {
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query("SELECT * FROM rfq_invites WHERE view_token = ?", [token]);
  if (rows.length === 0) return sendJson(res, 404, { error: "Unknown token" });
  sendJson(res, 200, { rfqId: String(rows[0].rfq_id), invite: publicRfqInvite(rows[0], null) });
}

// POST /api/rfqs/:id/invites/:inviteId/decline
async function handleDeclineRfqInvite(req, res, rfqId, inviteId) {
  const body = await readBody(req);
  const declineReason = body.declineReason;
  const validReasons = ["soft_lead", "wrong_car", "options_mismatch", "other"];
  if (!validReasons.includes(declineReason)) return badRequest(res, "Invalid declineReason");

  const pool = getPool();
  const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rfqRows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });

  const [result] = await pool.query(
    `UPDATE rfq_invites SET status = 'declined', decline_reason = ?, responded_at = NOW()
     WHERE id = ? AND rfq_id = ? AND status = 'invited'`,
    [declineReason, inviteId, rfqId]
  );
  if (result.affectedRows === 0) return sendJson(res, 404, { error: "Invite not found or already responded to" });

  const mustHaves = typeof rfqRows[0].must_haves_json === "string" ? JSON.parse(rfqRows[0].must_haves_json) : rfqRows[0].must_haves_json;
  await logRfqEvent(pool, rfqId, "desk_declined", {
    vin: rfqRows[0].vin,
    stockNumber: rfqRows[0].stock_number,
    mustHaves,
    declineReason,
  });

  const [rows] = await pool.query("SELECT * FROM rfq_invites WHERE id = ?", [inviteId]);
  sendJson(res, 200, { invite: publicRfqInvite(rows[0], null) });
}

// POST /api/rfqs/:id/invites/:inviteId/quotes — the one structured-intake
// endpoint every dealer quote goes through, whether a dealer fills it in
// themselves or ops relays it from an email/phone call. Every field
// required here is a field the instrumentation's "quote completeness"
// metric checks for, so there's no path to a quote missing one.
async function handleSubmitRfqQuote(req, res, rfqId, inviteId) {
  const body = await readBody(req);
  const price = Number(body.price);
  const fees = Array.isArray(body.fees) ? body.fees : [];
  const vin = (body.vin || "").trim().toUpperCase();
  const stockNumber = body.stockNumber ? String(body.stockNumber).trim() : null;
  const expiresAt = body.expiresAt;
  const mustHaveAcknowledgement = Boolean(body.mustHaveAcknowledgement);
  const notes = body.notes ? String(body.notes).trim() : null;
  // The structured lease calculator, validated by the Next.js route before
  // it gets here; stored whole so the buyer's compare reads exactly what
  // the dealer entered.
  const leaseJson = body.lease && typeof body.lease === "object" ? JSON.stringify(body.lease) : null;
  const usedJson = body.used && typeof body.used === "object" ? JSON.stringify(body.used) : null;

  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rfqRows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  const mustHaves = typeof rfqRows[0].must_haves_json === "string" ? JSON.parse(rfqRows[0].must_haves_json) : rfqRows[0].must_haves_json;

  // Required fields (price, itemized fees, VIN/stock, expiry) are a hard
  // gate, not a soft completeness score — an incomplete submission is
  // logged (so "how often do we get incomplete quotes back" is
  // measurable) and rejected, never stored as a real quote.
  const missing = [];
  if (!Number.isFinite(price) || price <= 0) missing.push("price");
  if (!fees.every((f) => f && typeof f.label === "string" && Number.isFinite(Number(f.amount)))) missing.push("fees");
  if (!vin) missing.push("vin");
  if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) missing.push("expiresAt");
  if (!mustHaveAcknowledgement) missing.push("mustHaveAcknowledgement");
  if (missing.length > 0) {
    await logRfqEvent(pool, rfqId, "quote_incomplete", {
      vin: rfqRows[0].vin,
      stockNumber: rfqRows[0].stock_number,
      mustHaves,
      missingFields: missing,
    });
    return badRequest(res, `Quote is missing required fields: ${missing.join(", ")}`);
  }

  const [inviteRows] = await pool.query(
    "SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?",
    [inviteId, rfqId]
  );
  if (inviteRows.length === 0) return sendJson(res, 404, { error: "Invite not found" });
  if (inviteRows[0].status !== "invited") {
    return badRequest(res, `This invite already has a response (${inviteRows[0].status})`);
  }

  const feesTotal = fees.reduce((sum, f) => sum + Number(f.amount), 0);
  const totalOtdPrice = price + feesTotal;

  const conn = await pool.getConnection();
  let quoteId;
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO rfq_quotes (rfq_id, invite_id, dealer_name, price, fees_json, total_otd_price, vin, stock_number, expires_at, must_have_acknowledgement, notes, lease_json, used_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rfqId, inviteId, inviteRows[0].dealer_name, price, JSON.stringify(fees), totalOtdPrice, vin, stockNumber, new Date(expiresAt), mustHaveAcknowledgement, notes, leaseJson, usedJson]
    );
    quoteId = result.insertId;
    await conn.query(
      "UPDATE rfq_invites SET status = 'quoted', responded_at = NOW() WHERE id = ?",
      [inviteId]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await logRfqEvent(pool, rfqId, "quote_received", {
    vin: rfqRows[0].vin,
    stockNumber: rfqRows[0].stock_number,
    mustHaves,
    quoteVin: vin,
    quoteStockNumber: stockNumber,
    totalOtdPrice,
  });

  const [quoteRows] = await pool.query("SELECT * FROM rfq_quotes WHERE id = ?", [quoteId]);
  sendJson(res, 201, { quote: publicRfqQuote(quoteRows[0]) });
}

// POST /api/rfqs/:id/pick — buyer picks one quote. Never touches price or
// re-verifies anything (that's the existing deal-sheet Verify feature's
// job on a later, separate object) — this just records the buyer's choice.
async function handlePickRfqQuote(req, res, rfqId) {
  const body = await readBody(req);
  const quoteId = Number(body.quoteId);
  if (!Number.isFinite(quoteId) || quoteId <= 0) return badRequest(res, "Invalid quoteId");

  const pool = getPool();
  const [quoteRows] = await pool.query("SELECT id FROM rfq_quotes WHERE id = ? AND rfq_id = ?", [quoteId, rfqId]);
  if (quoteRows.length === 0) return sendJson(res, 404, { error: "Quote not found on this RFQ" });

  const [result] = await pool.query(
    "UPDATE rfq_requests SET status = 'picked', picked_quote_id = ? WHERE id = ? AND status = 'collecting'",
    [quoteId, rfqId]
  );
  if (result.affectedRows === 0) return badRequest(res, "This RFQ is no longer open to pick a quote on");
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  const mustHaves = typeof rows[0].must_haves_json === "string" ? JSON.parse(rows[0].must_haves_json) : rows[0].must_haves_json;
  await logRfqEvent(pool, rfqId, "buyer_picked", {
    vin: rows[0].vin,
    stockNumber: rows[0].stock_number,
    mustHaves,
    pickedQuoteId: quoteId,
  });
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(rows[0], invites) });
}

// POST /api/rfqs/:id/walk — buyer walks away without picking anyone.
async function handleWalkAwayFromRfq(req, res, rfqId) {
  const pool = getPool();
  const [result] = await pool.query(
    "UPDATE rfq_requests SET status = 'walked' WHERE id = ? AND status = 'collecting'",
    [rfqId]
  );
  if (result.affectedRows === 0) return sendJson(res, 404, { error: "RFQ not found or already resolved" });
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  const mustHaves = typeof rows[0].must_haves_json === "string" ? JSON.parse(rows[0].must_haves_json) : rows[0].must_haves_json;
  await logRfqEvent(pool, rfqId, "buyer_walked", {
    vin: rows[0].vin,
    stockNumber: rows[0].stock_number,
    mustHaves,
  });
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(rows[0], invites) });
}

// POST /api/rfqs/:id/approval — { decision: "approved" | "rejected" | "pending", by, reason }.
// The admin gate. Nothing about the request or its invites is sent until
// this says "approved"; the app's outbox checks approvalStatus before every
// send. "pending" is the buyer's resubmit after a rejection.
async function handleRfqApproval(req, res, rfqId) {
  const body = await readBody(req);
  const decision = String(body.decision || "").trim();
  if (!["approved", "rejected", "pending"].includes(decision)) return badRequest(res, "decision must be approved, rejected or pending");
  const by = body.by ? String(body.by).trim().slice(0, 191) : null;
  const reason = decision === "rejected" ? String(body.reason || "").trim().slice(0, 500) : null;
  if (decision === "rejected" && !reason) return badRequest(res, "A rejection needs a reason for the buyer");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  if (rows[0].status !== "collecting") return sendJson(res, 409, { error: "closed" });
  await pool.query(
    "UPDATE rfq_requests SET approval_status = ?, approval_decided_at = ?, approval_decided_by = ?, rejection_reason = ? WHERE id = ?",
    [decision, decision === "pending" ? null : new Date(), decision === "pending" ? null : by, reason, rfqId]
  );
  await logRfqEvent(pool, rfqId, decision === "approved" ? "rfq_approved" : decision === "rejected" ? "rfq_rejected" : "rfq_resubmitted", { by, reason, vin: rows[0].vin });
  const [fresh] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(fresh[0], invites) });
}

// PATCH /api/rfqs/:id — an admin correcting the quote sheet before release.
// Only while the request is still pending/rejected (never after dealers
// have it). Every call appends to admin_edits_json so the buyer can see
// what changed. Fields absent from the body are left alone.
async function handleAdminPatchRfq(req, res, rfqId) {
  const body = await readBody(req);
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  if (rows[0].status !== "collecting") return sendJson(res, 409, { error: "closed" });
  if ((rows[0].approval_status || "approved") === "approved") return sendJson(res, 409, { error: "released", message: "This request has already been released to dealers." });
  const sets = []; const vals = [];
  const str = (key, col, max) => { if (typeof body[key] === "string") { sets.push(`${col} = ?`); vals.push(body[key].trim().slice(0, max) || null); } };
  if (typeof body.vin === "string" && /^[A-HJ-NPR-Z0-9]{17}$/i.test(body.vin.trim())) { sets.push("vin = ?"); vals.push(body.vin.trim().toUpperCase()); }
  if (Number.isFinite(Number(body.vehicleYear)) && Number(body.vehicleYear) > 1980) { sets.push("vehicle_year = ?"); vals.push(Number(body.vehicleYear)); }
  str("vehicleMake", "vehicle_make", 64); str("vehicleModel", "vehicle_model", 64); str("vehicleTrim", "vehicle_trim", 128); str("stockNumber", "stock_number", 64);
  if (Array.isArray(body.mustHaves)) { sets.push("must_haves_json = ?"); vals.push(JSON.stringify(body.mustHaves.slice(0, 50))); }
  if (Array.isArray(body.linkPastes)) { sets.push("link_pastes_json = ?"); vals.push(body.linkPastes.length ? JSON.stringify(body.linkPastes.slice(0, 3)) : null); }
  if (body.leasePrefs === null || (body.leasePrefs && typeof body.leasePrefs === "object")) { sets.push("lease_prefs_json = ?"); vals.push(body.leasePrefs ? JSON.stringify(body.leasePrefs) : null); }
  if (body.quotePrefs === null || (body.quotePrefs && typeof body.quotePrefs === "object")) { sets.push("quote_prefs_json = ?"); vals.push(body.quotePrefs ? JSON.stringify(body.quotePrefs) : null); }
  if (body.buyerNote === null || typeof body.buyerNote === "string") { sets.push("buyer_note = ?"); vals.push(body.buyerNote ? String(body.buyerNote).trim().slice(0, 1000) || null : null); }
  if (typeof body.tradeInExpected === "boolean" || body.tradeInExpected === null) { sets.push("trade_in_expected = ?"); vals.push(body.tradeInExpected === null ? null : body.tradeInExpected ? 1 : 0); }
  const edit = body.adminEdit && typeof body.adminEdit === "object" ? { at: new Date().toISOString(), by: String(body.adminEdit.by || "").slice(0, 191) || null, summary: String(body.adminEdit.summary || "").trim().slice(0, 300) || "Corrected by TrimScout" } : null;
  if (sets.length === 0 && !edit) return badRequest(res, "Nothing to change");
  const edits = parseJsonCol(rows[0].admin_edits_json) || [];
  if (edit) edits.push(edit);
  sets.push("admin_edits_json = ?"); vals.push(JSON.stringify(edits.slice(-50)));
  vals.push(rfqId);
  await pool.query(`UPDATE rfq_requests SET ${sets.join(", ")} WHERE id = ?`, vals);
  if (edit) await logRfqEvent(pool, rfqId, "rfq_admin_edited", { by: edit.by, summary: edit.summary, fields: sets.map((x) => x.split(" ")[0]) });
  const [fresh] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(fresh[0], invites) });
}

// DELETE /api/rfqs/:id/invites/:inviteId — an admin dropping a dealer
// before release. Only a still-queued invite on an unreleased request.
async function handleDeleteRfqInvite(req, res, rfqId, inviteId) {
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });
  if ((rows[0].approval_status || "approved") === "approved") return sendJson(res, 409, { error: "released" });
  const [inv] = await pool.query("SELECT * FROM rfq_invites WHERE id = ? AND rfq_id = ?", [inviteId, rfqId]);
  if (inv.length === 0) return sendJson(res, 404, { error: "Invite not found" });
  if ((inv[0].delivery_status || "queued") !== "queued") return sendJson(res, 409, { error: "already sent" });
  await pool.query("DELETE FROM rfq_quotes WHERE invite_id = ?", [inviteId]);
  await pool.query("DELETE FROM rfq_invites WHERE id = ?", [inviteId]);
  await logRfqEvent(pool, rfqId, "rfq_invite_removed", { inviteId, dealerName: inv[0].dealer_name });
  const invites = await loadRfqInvitesWithQuotes(pool, rfqId);
  sendJson(res, 200, { rfq: publicRfqRequest(rows[0], invites) });
}

// Events only — no dashboard, no aggregation endpoint. Every named event
// (rfq_invited, quote_received, quote_incomplete, buyer_picked,
// buyer_walked, desk_declined) is written verbatim to rfq_events with its
// full payload (VIN/stock, the locked must-haves, and a decline reason
// when relevant). Scoring — response rate, spec integrity, quote
// completeness, buyer pick rate, time-to-first-quote — happens offline,
// by querying this table directly; see lib/rfqLogic.ts for the pure
// functions that turn raw rows like these into those numbers.
async function logRfqEvent(pool, rfqId, eventType, payload) {
  await pool.query(
    "INSERT INTO rfq_events (rfq_id, event_type, payload_json) VALUES (?, ?, ?)",
    [rfqId, eventType, JSON.stringify(payload)]
  );
}

// ---------------------------------------------------------------------------
// Dealer inventory — vehicles crawled from dealer websites (scrapers/inventory/crawl_inventory.py).
// One row per VIN; a VIN that moves stores is re-pointed on the next upsert. `removed_at` is set by the
// sweep once a store's crawl no longer lists the VIN, so "in stock" = removed_at IS NULL.
// ---------------------------------------------------------------------------
let inventoryReady = false;
async function ensureInventoryTable(pool) {
  if (inventoryReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    dealer_name VARCHAR(255) NOT NULL,
    cond VARCHAR(8) NULL,
    year SMALLINT NULL,
    make VARCHAR(64) NULL,
    model VARCHAR(96) NULL,
    trim VARCHAR(160) NULL,
    body_style VARCHAR(64) NULL,
    exterior_color VARCHAR(96) NULL,
    interior_color VARCHAR(96) NULL,
    mileage INT NULL,
    price INT NULL,
    msrp INT NULL,
    stock_number VARCHAR(64) NULL,
    vdp_url VARCHAR(700) NULL,
    image_url VARCHAR(700) NULL,
    source VARCHAR(16) NULL,
    first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    removed_at DATETIME NULL,
    INDEX idx_inv_dealer (dealer_id),
    INDEX idx_inv_make_model (make, model),
    INDEX idx_inv_last_seen (last_seen_at),
    INDEX idx_inv_removed (removed_at),
    PRIMARY KEY (vin, dealer_id)
  )`);
  // First cut keyed by VIN alone; a dealer group lists the same car on several rooftops, so the key is (vin, store).
  const [[pk]] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dealer_inventory' AND CONSTRAINT_NAME = 'PRIMARY'");
  if (Number(pk.n) === 1) {
    await pool.query("ALTER TABLE dealer_inventory MODIFY dealer_id INT NOT NULL DEFAULT 0");
    await pool.query("ALTER TABLE dealer_inventory DROP PRIMARY KEY, ADD PRIMARY KEY (vin, dealer_id)");
  }
  // The nightly crawl carries more than the core columns: window sticker, engine/transmission, days on lot,
  // day-over-day price movement, price history, factory options. Additive, so a fresh or old table both work.
  for (const ddl of [
    "MODIFY cond VARCHAR(12) NULL",
    "ADD COLUMN IF NOT EXISTS window_sticker_url VARCHAR(700) NULL",
    "ADD COLUMN IF NOT EXISTS engine VARCHAR(160) NULL",
    "ADD COLUMN IF NOT EXISTS transmission VARCHAR(160) NULL",
    "ADD COLUMN IF NOT EXISTS days_on_lot INT NULL",
    "ADD COLUMN IF NOT EXISTS old_price INT NULL",
    "ADD COLUMN IF NOT EXISTS price_diff INT NULL",
    "ADD COLUMN IF NOT EXISTS price_change_type VARCHAR(16) NULL",
    "ADD COLUMN IF NOT EXISTS change_type VARCHAR(16) NULL",
    "ADD COLUMN IF NOT EXISTS price_history_json TEXT NULL",
    "ADD COLUMN IF NOT EXISTS options_json MEDIUMTEXT NULL",
    "ADD COLUMN IF NOT EXISTS options_total INT NULL",
    "ADD COLUMN IF NOT EXISTS base_msrp INT NULL",
    "ADD COLUMN IF NOT EXISTS crawl_first_seen DATE NULL",
    "ADD COLUMN IF NOT EXISTS source_box VARCHAR(16) NULL",
    "ADD COLUMN IF NOT EXISTS vdp_url_norm VARCHAR(700) NULL",
    // state was never its own column — every state= filter had to JOIN dealership_contacts,
    // which has no index on state either, forcing a full scan of it plus a temp table +
    // filesort to satisfy the default dealer_name sort (confirmed live 2026-09-25 on box2:
    // state=NJ + inStock=1, the admin sheet's default view, 27.4s — 56,956 matching rows
    // materialized and sorted before the first page could be returned). Denormalized here the
    // same way dealer_name already is, kept in sync by trg_inv_state_insert/update below, so
    // state= can finally use a real composite index instead of a JOIN — see inventoryListQuery.js.
    // Existing rows are backfilled once by this same deploy script, not here (500k+ rows —
    // too slow to gate a live request behind).
    "ADD COLUMN IF NOT EXISTS state VARCHAR(2) NULL",
    // How many times this vehicle's price has genuinely changed since it was first seen —
    // for the buyer search's minPriceChanges= filter. Incremented in handleInventoryBulk's
    // upsert only when the incoming price differs from what was already stored (see that
    // function), never recomputed from history here. Existing rows stay at the DEFAULT 0 —
    // there's no historical per-change record to backfill from, so this is "tracked going
    // forward" only, not a true lifetime count for inventory that predates this column.
    "ADD COLUMN IF NOT EXISTS price_change_count INT NOT NULL DEFAULT 0",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_price_changes (removed_at, price_change_count)",
    "ADD INDEX IF NOT EXISTS idx_inv_change (change_type)",
    "ADD INDEX IF NOT EXISTS idx_inv_price_change (price_change_type)",
    // Every sheet query filters removed_at IS NULL then sorts — composite indexes let those read in order.
    "ADD INDEX IF NOT EXISTS idx_inv_stock_dealer (removed_at, dealer_name, vin)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_make (removed_at, make, model)",
    // idx_inv_stock_make (above) seeks on (removed_at, make) fine, but doesn't cover the default
    // dealer_name/vin sort, so MariaDB still had to materialize and filesort every matching row
    // before returning the first page — confirmed live 2026-09-25: make=Toyota, inStock=1, no
    // sort= (the buyer /search page's own default view once it went public), 10.8s for 340k
    // matching rows, EXPLAIN showing "Using filesort". state= got this exact covering treatment
    // (idx_inv_stock_state below) when its own version of this bug was fixed 2026-09-25 — make=
    // never did. This is that same fix, for make=.
    "ADD INDEX IF NOT EXISTS idx_inv_stock_make_dealer (removed_at, make, dealer_name, vin)",
    // Same bug, same day, for GET /api/inventory/catalog's colors aggregate
    // (handleInventoryCatalogOptions): GROUP BY exterior_color, interior_color had no covering
    // index at all — "Using temporary; Using filesort" over 280k+ matching rows for a single
    // make. This index's trailing two columns exactly match the GROUP BY, turning it into a
    // plain ordered index scan.
    "ADD INDEX IF NOT EXISTS idx_inv_stock_make_colors (removed_at, make, exterior_color, interior_color)",
    // make= WITHOUT inStock=1 (the sheet's "all, incl. removed" view): idx_inv_stock_make can't seek
    // on make until removed_at is pinned, so that was a full scan — see inventoryListQuery.js.
    "ADD INDEX IF NOT EXISTS idx_inv_make_dealer (make, dealer_name, vin)",
    // Mirrors idx_inv_stock_make/idx_inv_make_dealer exactly, for state= instead of make=.
    "ADD INDEX IF NOT EXISTS idx_inv_stock_state (removed_at, state, dealer_name, vin)",
    "ADD INDEX IF NOT EXISTS idx_inv_state_dealer (state, dealer_name, vin)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_price (removed_at, price)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_msrp (removed_at, msrp)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_mileage (removed_at, mileage)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_year (removed_at, year)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_seen (removed_at, last_seen_at)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_days (removed_at, days_on_lot)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_diff (removed_at, price_diff)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_dealer_id (removed_at, dealer_id)",
    // Covering index for /api/inventory/by-dealer's GROUP BY dealer_id (the admin "Dealers"
    // tab): COUNT/SUM/MAX over cond, price_diff, last_seen_at previously needed a full row
    // lookup per in-stock vehicle — 32.1s cold, confirmed live via EXPLAIN + timing (the
    // 10-minute cache normally hid this, until a deploy restart cleared it). With every
    // referenced column in one index, MariaDB answers the whole query from the index alone
    // ("Using index" in EXPLAIN, no row access): 223ms, ~148x faster.
    "ADD INDEX IF NOT EXISTS idx_inv_by_dealer_covering (removed_at, dealer_id, cond, price_diff, last_seen_at)",
    "ADD INDEX IF NOT EXISTS idx_inv_vdp_url_norm (vdp_url_norm)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);
  // The free-text q= search's index. 2026-09-22: an ngram FULLTEXT parser (MariaDB's
  // documented CJK/no-space substring technique) turned out not to exist on this box at all —
  // not installed, not even present as a plugin file, and no apt package ships it either
  // (confirmed live: ER_FUNCTION_NOT_DEFINED, then an empty apt-cache search). Vanilla MariaDB
  // has no built-in arbitrary-substring index, so this covers the two patterns that actually
  // matter in practice — the start OR the end of a value (a partial VIN's last 6, a dealer
  // name's trailing "…Route 10") — via a plain B-tree prefix search in each direction: a
  // forward index on the column, and a reversed copy with its own index (a reversed-prefix
  // search is a suffix search on the original string). The reversed columns are plain (NOT
  // generated) — MariaDB rejects REVERSE() inside GENERATED ALWAYS AS (confirmed live:
  // "Function or expression 'reverse(...)' cannot be used in the GENERATED ALWAYS AS
  // clause", no error code, errno 1901 — a MariaDB-specific restriction MySQL doesn't share),
  // so the two triggers below populate them on every write instead. vin's forward prefix
  // already has an index via the PRIMARY KEY (vin, dealer_id). Built once, IF NOT EXISTS — on
  // an existing 570k+-row table this can take real time, so it's deployed as its own one-off
  // script (scripts/box/2026-09-22-…) rather than left to run implicitly on first request
  // after a restart; this entry only matters for a fresh box provisioned from scratch.
  for (const ddl of [
    "ADD COLUMN IF NOT EXISTS vin_rev CHAR(17) NULL",
    "ADD COLUMN IF NOT EXISTS dealer_name_rev VARCHAR(255) NULL",
    "ADD COLUMN IF NOT EXISTS model_rev VARCHAR(96) NULL",
    "ADD COLUMN IF NOT EXISTS trim_rev VARCHAR(160) NULL",
    "ADD COLUMN IF NOT EXISTS stock_number_rev VARCHAR(64) NULL",
    "ADD INDEX IF NOT EXISTS idx_inv_vin_rev (vin_rev)",
    "ADD INDEX IF NOT EXISTS idx_inv_dealer_name_fwd (dealer_name)",
    "ADD INDEX IF NOT EXISTS idx_inv_dealer_name_rev (dealer_name_rev)",
    "ADD INDEX IF NOT EXISTS idx_inv_model_fwd (model)",
    "ADD INDEX IF NOT EXISTS idx_inv_model_rev (model_rev)",
    "ADD INDEX IF NOT EXISTS idx_inv_trim_fwd (trim)",
    "ADD INDEX IF NOT EXISTS idx_inv_trim_rev (trim_rev)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_fwd (stock_number)",
    "ADD INDEX IF NOT EXISTS idx_inv_stock_rev (stock_number_rev)",
  ]) await pool.query(`ALTER TABLE dealer_inventory ${ddl}`);
  // Triggers, not generated columns (see note above) — plain BEFORE INSERT/UPDATE writes,
  // unrestricted in what functions they may call. Backfilling existing rows is a separate,
  // one-off step (scripts/box/2026-09-22-…), not done here — it only matters on first deploy.
  // DROP+CREATE (not IF NOT EXISTS) so a trigger body change — like vdp_url_norm below,
  // added 2026-09-23 for the paste-a-link VIN lookup — actually takes effect on an existing
  // box after a restart, instead of silently keeping whatever body was first created there.
  for (const when of ["INSERT", "UPDATE"]) {
    await pool.query(`DROP TRIGGER IF EXISTS trg_inv_rev_${when.toLowerCase()}`);
    await pool.query(`
      CREATE TRIGGER trg_inv_rev_${when.toLowerCase()} BEFORE ${when} ON dealer_inventory
      FOR EACH ROW BEGIN
        SET NEW.vin_rev = REVERSE(NEW.vin);
        SET NEW.dealer_name_rev = REVERSE(NEW.dealer_name);
        SET NEW.model_rev = REVERSE(NEW.model);
        SET NEW.trim_rev = REVERSE(NEW.trim);
        SET NEW.stock_number_rev = REVERSE(NEW.stock_number);
        SET @vun = SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(NEW.vdp_url), '?', 1), '#', 1);
        SET @vun = REPLACE(REPLACE(@vun, 'https://', ''), 'http://', '');
        SET @vun = IF(LEFT(@vun, 4) = 'www.', SUBSTRING(@vun, 5), @vun);
        SET NEW.vdp_url_norm = NULLIF(TRIM(TRAILING '/' FROM @vun), '');
        -- Keeps the denormalized state column (see the ADD COLUMN comment above) in sync from
        -- dealership_contacts by dealer_id — a primary-key lookup per row, not the full-table
        -- JOIN this replaces at query time. NULL when dealer_id has no matching rooftop (the
        -- "no store matched" bucket, dealer_id 0) — matches the LEFT JOIN's own behavior today.
        SET NEW.state = (SELECT state FROM dealership_contacts WHERE id = NEW.dealer_id LIMIT 1);
      END
    `);
  }
  // One row per (VIN, store, day) the crawl saw the car, with that day's price — the day-by-day history behind
  // the VIN view. Written on every sync; the crawl's price-history points backfill days before the table existed.
  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory_days (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    seen_on DATE NOT NULL,
    price INT NULL,
    mileage INT NULL,
    PRIMARY KEY (vin, dealer_id, seen_on),
    INDEX idx_days_vin (vin)
  )`);
  // One row per (vehicle, factory option code) — a normalized side table for the buyer
  // search's "must-have ALL of these options" filter. dealer_inventory.options_json is a
  // free-text blob (see inventoryRowFromDb) with no index, so "has every one of these codes"
  // can't be answered efficiently there at 1.5M+ rows. Populated in handleInventoryBulk by
  // deleting and reinserting each chunk's vehicles' rows on every upsert — always a full
  // replace of the set, never a partial add, so a vehicle that loses an option on a later
  // crawl doesn't keep matching it forever.
  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_inventory_options (
    vin CHAR(17) NOT NULL,
    dealer_id INT NOT NULL DEFAULT 0,
    code VARCHAR(32) NOT NULL,
    PRIMARY KEY (vin, dealer_id, code),
    INDEX idx_opt_code (code)
  )`);
  inventoryReady = true;
}

const INV_STR = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

// Mirrors the SQL expression in trg_inv_rev_insert/update exactly (see ensureInventoryTable) —
// strip query string and fragment, protocol, leading www., and trailing slash, all lowercased.
// Used by /api/inventory/by-listing-url, the buyer wizard's paste-a-link fallback when a pasted
// VDP URL carries no VIN in its own text: a lookup against inventory OUR OWN crawl already
// wrote, never a live fetch of the dealer's page.
function normalizeListingUrl(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  const cutCandidates = [s.indexOf("?"), s.indexOf("#")].filter((i) => i >= 0);
  if (cutCandidates.length) s = s.slice(0, Math.min(...cutCandidates));
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  return s || null;
}
// The aggregate endpoints (stats, by-dealer, catalog options) scan the whole table and only change
// when a sync writes, so they are served from memory for 10 minutes and dropped by every bulk
// upsert / sweep.
const INV_CACHE_MS = 10 * 60_000;
const invCache = new Map();
// invInFlight dedupes concurrent cache MISSES on the same key — without it, N requests that all
// arrive before the first one finishes computing and populating invCache each independently kick
// off the same expensive full-table query. Confirmed live 2026-09-25 after /api/catalog/makes (the
// buyer /search page's make picker, PR 4) started calling the same "stats" key that used to see
// only rare admin-sheet traffic: 3 concurrent identical aggregate queries piled up on the box,
// each 50-150+ seconds, timing out ordinary buyer requests that had nothing to do with the slow
// query itself. The dedup key includes the cache generation so a concurrent invInvalidate() (a
// bulk upsert/sweep mid-computation) doesn't hand a request a result computed against data that
// was invalidated before it finished.
const invInFlight = new Map();
let invGeneration = 0;
const invCached = async (key, fn) => {
  const hit = invCache.get(key);
  if (hit && Date.now() - hit.at < INV_CACHE_MS) return hit.value;
  const generation = invGeneration;
  const flightKey = `${generation}:${key}`;
  const existing = invInFlight.get(flightKey);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const value = await fn();
      if (generation === invGeneration) invCache.set(key, { at: Date.now(), value });
      return value;
    } finally {
      invInFlight.delete(flightKey);
    }
  })();
  invInFlight.set(flightKey, promise);
  return promise;
};
const invInvalidate = () => {
  invGeneration++;
  invCache.clear();
};
const INV_INT = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.round(Number(v)) : null);
const INV_DEALER = (v) => INV_INT(v) || 0;

function inventoryRowFromDb(r) {
  return {
    vin: r.vin, dealerId: r.dealer_id ? String(r.dealer_id) : null, dealerName: r.dealer_name, condition: r.cond || null, year: r.year, make: r.make, model: r.model, trim: r.trim,
    bodyStyle: r.body_style, exteriorColor: r.exterior_color, interiorColor: r.interior_color, mileage: r.mileage, price: r.price, msrp: r.msrp, stockNumber: r.stock_number,
    vdpUrl: r.vdp_url, imageUrl: r.image_url, source: r.source, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, removedAt: r.removed_at,
    dealerCity: r.dealer_city ?? null, dealerState: r.dealer_state ?? null,
    windowStickerUrl: r.window_sticker_url ?? null, engine: r.engine ?? null, transmission: r.transmission ?? null, daysOnLot: r.days_on_lot ?? null,
    oldPrice: r.old_price ?? null, priceDiff: r.price_diff ?? null, priceChangeType: r.price_change_type ?? null, changeType: r.change_type ?? null,
    priceHistory: INV_JSON(r.price_history_json), options: INV_JSON(r.options_json), optionsTotal: r.options_total ?? null, baseMsrp: r.base_msrp ?? null,
    crawlFirstSeen: r.crawl_first_seen ?? null,
    sourceBox: r.source_box ?? null,
  };
}
const INV_JSON = (t) => { if (!t) return null; try { return JSON.parse(t); } catch { return null; } };
const INV_JSON_STR = (v, n) => { if (v == null) return null; try { const t = JSON.stringify(v); return t.length > n ? null : t; } catch { return null; } };
const INV_DATE = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

// POST /api/inventory/bulk { vehicles: [{vin, dealerId, dealerName, condition, year, make, model, trim, ...}] }
async function handleInventoryBulk(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const body = await readBody(req, 30_000_000);
  const vehicles = Array.isArray(body.vehicles) ? body.vehicles : null;
  if (!vehicles) return badRequest(res, "vehicles[] is required");
  let upserted = 0, skipped = 0;
  for (let i = 0; i < vehicles.length; i += 500) {
    const chunk = vehicles.slice(i, i + 500).filter((v) => typeof v.vin === "string" && /^[A-HJ-NPR-Z0-9]{17}$/.test(v.vin.trim().toUpperCase()) && INV_STR(v.dealerName, 255));
    skipped += Math.min(500, vehicles.length - i) - chunk.length;
    if (!chunk.length) continue;
    const values = chunk.map((v) => [v.vin.trim().toUpperCase(), INV_DEALER(v.dealerId), INV_STR(v.dealerName, 255), INV_STR(v.condition, 12), INV_INT(v.year), INV_STR(v.make, 64), INV_STR(v.model, 96), INV_STR(v.trim, 160), INV_STR(v.bodyStyle, 64), INV_STR(v.exteriorColor, 96), INV_STR(v.interiorColor, 96), INV_INT(v.mileage), INV_INT(v.price), INV_INT(v.msrp), INV_STR(v.stockNumber, 64), INV_STR(v.vdpUrl, 700), INV_STR(v.imageUrl, 700), INV_STR(v.source, 16),
      INV_STR(v.windowStickerUrl, 700), INV_STR(v.engine, 160), INV_STR(v.transmission, 160), INV_INT(v.daysOnLot), INV_INT(v.oldPrice), INV_INT(v.priceDiff), INV_STR(v.priceChangeType, 16), INV_STR(v.changeType, 16), INV_JSON_STR(v.priceHistory, 60000), INV_JSON_STR(v.options, 200000), INV_INT(v.optionsTotal), INV_INT(v.baseMsrp), INV_DATE(v.crawlFirstSeen), INV_STR(v.sourceBox, 16)]);
    await pool.query(
      `INSERT INTO dealer_inventory (vin, dealer_id, dealer_name, cond, year, make, model, trim, body_style, exterior_color, interior_color, mileage, price, msrp, stock_number, vdp_url, image_url, source,
        window_sticker_url, engine, transmission, days_on_lot, old_price, price_diff, price_change_type, change_type, price_history_json, options_json, options_total, base_msrp, crawl_first_seen, source_box)
       VALUES ? ON DUPLICATE KEY UPDATE dealer_id = VALUES(dealer_id), dealer_name = VALUES(dealer_name), cond = COALESCE(VALUES(cond), cond), year = COALESCE(VALUES(year), year), make = COALESCE(VALUES(make), make), model = COALESCE(VALUES(model), model), trim = COALESCE(VALUES(trim), trim), body_style = COALESCE(VALUES(body_style), body_style), exterior_color = COALESCE(VALUES(exterior_color), exterior_color), interior_color = COALESCE(VALUES(interior_color), interior_color), mileage = COALESCE(VALUES(mileage), mileage),
        price_change_count = price_change_count + IF(VALUES(price) IS NOT NULL AND price IS NOT NULL AND VALUES(price) <> price, 1, 0),
        price = COALESCE(VALUES(price), price), msrp = COALESCE(VALUES(msrp), msrp), stock_number = COALESCE(VALUES(stock_number), stock_number), vdp_url = VALUES(vdp_url), image_url = COALESCE(VALUES(image_url), image_url), source = VALUES(source), last_seen_at = CURRENT_TIMESTAMP, removed_at = NULL,
        window_sticker_url = COALESCE(VALUES(window_sticker_url), window_sticker_url), engine = COALESCE(VALUES(engine), engine), transmission = COALESCE(VALUES(transmission), transmission), days_on_lot = COALESCE(VALUES(days_on_lot), days_on_lot), old_price = VALUES(old_price), price_diff = VALUES(price_diff), price_change_type = VALUES(price_change_type), change_type = VALUES(change_type), price_history_json = COALESCE(VALUES(price_history_json), price_history_json), options_json = COALESCE(VALUES(options_json), options_json), options_total = COALESCE(VALUES(options_total), options_total), base_msrp = COALESCE(VALUES(base_msrp), base_msrp), crawl_first_seen = COALESCE(VALUES(crawl_first_seen), crawl_first_seen), source_box = COALESCE(VALUES(source_box), source_box)`,
      [values]
    );
    upserted += chunk.length;
    // Replace each vehicle's option-code set (dealer_inventory_options) in the same chunk as
    // its main upsert — tied together so a chunk that fails partway through never leaves a
    // live VIN's row updated but its option set stale/empty. A full delete-then-reinsert per
    // chunk, not a per-vehicle diff: cheap at 500 rows, and correct when a later crawl drops
    // an option the vehicle no longer has (an additive-only write would keep matching it).
    const optionPairs = chunk.map((v) => [v.vin.trim().toUpperCase(), INV_DEALER(v.dealerId)]);
    await pool.query("DELETE FROM dealer_inventory_options WHERE (vin, dealer_id) IN (?)", [optionPairs]);
    const optionRows = [];
    for (const v of chunk) {
      if (!Array.isArray(v.options)) continue;
      const vin = v.vin.trim().toUpperCase(), dealerId = INV_DEALER(v.dealerId);
      const codes = new Set(v.options.map((o) => INV_STR(o && o.code, 32)).filter(Boolean));
      for (const code of codes) optionRows.push([vin, dealerId, code]);
    }
    if (optionRows.length) await pool.query("INSERT INTO dealer_inventory_options (vin, dealer_id, code) VALUES ? ON DUPLICATE KEY UPDATE vin = VALUES(vin)", [optionRows]);
    // Today's observation for every vehicle in the chunk, plus the crawl's dated price points (backfill).
    const today = new Date().toISOString().slice(0, 10);
    const days = [];
    for (const v of chunk) {
      const vin = v.vin.trim().toUpperCase(), dealerId = INV_DEALER(v.dealerId);
      days.push([vin, dealerId, today, INV_INT(v.price), INV_INT(v.mileage)]);
      if (Array.isArray(v.priceHistory)) for (const h of v.priceHistory.slice(-60)) { const d = INV_DATE(h && h.date); if (d && d !== today) days.push([vin, dealerId, d, INV_INT(h.price), null]); }
    }
    if (days.length) await pool.query("INSERT INTO dealer_inventory_days (vin, dealer_id, seen_on, price, mileage) VALUES ? ON DUPLICATE KEY UPDATE price = COALESCE(VALUES(price), price), mileage = COALESCE(VALUES(mileage), mileage)", [days]);
  }
  invInvalidate();
  sendJson(res, 200, { upserted, skipped });
}

// GET /api/inventory/vin/:vin — every store that has listed the VIN, with its day-by-day observations.
// GET /api/inventory/by-listing-url?url=<VDP URL> — the VIN(s) our own crawl already matched
// to this exact listing page, via the normalized-URL index (vdp_url_norm). Read-only, indexed,
// never touches the dealer's site.
async function handleInventoryByListingUrl(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const raw = params.get("url") || "";
  const norm = normalizeListingUrl(raw);
  if (!norm) return badRequest(res, "url is required");
  const [rows] = await pool.query(
    "SELECT i.*, d.city AS dealer_city, d.state AS dealer_state FROM dealer_inventory i LEFT JOIN dealership_contacts d ON d.id = i.dealer_id WHERE i.vdp_url_norm = ? ORDER BY i.removed_at IS NULL DESC, i.last_seen_at DESC LIMIT 5",
    [norm]
  );
  sendJson(res, 200, { url: raw, matches: rows.map(inventoryRowFromDb) });
}

async function handleInventoryVin(req, res, vin) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const [rows] = await pool.query("SELECT i.*, d.city AS dealer_city, d.state AS dealer_state FROM dealer_inventory i LEFT JOIN dealership_contacts d ON d.id = i.dealer_id WHERE i.vin = ? ORDER BY i.removed_at IS NULL DESC, i.last_seen_at DESC", [vin]);
  const [days] = await pool.query("SELECT dealer_id, seen_on, price, mileage FROM dealer_inventory_days WHERE vin = ? ORDER BY seen_on ASC", [vin]);
  const fmt = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
  sendJson(res, 200, { vin, listings: rows.map(inventoryRowFromDb), days: days.map((r) => ({ dealerId: r.dealer_id ? String(r.dealer_id) : null, seenOn: fmt(r.seen_on), price: r.price, mileage: r.mileage })) });
}

// POST /api/inventory/sweep { dealerId, seenAfter, sources? } — a store's VINs not seen since `seenAfter` are
// marked removed. With `sources` (e.g. ["nightly"]) only rows that crawler wrote are swept, so two crawlers
// covering the same store don't erase each other's finds.
async function handleInventorySweep(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const body = await readBody(req);
  const dealerId = INV_INT(body.dealerId);
  const seenAfter = typeof body.seenAfter === "string" ? new Date(body.seenAfter) : null;
  // dealerId 0 is the "no store matched" bucket — sweeping it retires rows that a later sync re-filed under a real store.
  if (dealerId == null || !seenAfter || Number.isNaN(seenAfter.getTime())) return badRequest(res, "dealerId and seenAfter (ISO) are required");
  const sources = Array.isArray(body.sources) ? body.sources.map((x) => INV_STR(x, 16)).filter(Boolean) : [];
  const args = [dealerId, seenAfter];
  let sql = "UPDATE dealer_inventory SET removed_at = CURRENT_TIMESTAMP WHERE dealer_id = ? AND removed_at IS NULL AND last_seen_at < ?";
  if (sources.length) { sql += " AND source IN (?)"; args.push(sources); }
  const [result] = await pool.query(sql, args);
  if (result.affectedRows) invInvalidate();
  sendJson(res, 200, { removed: result.affectedRows });
}

// inventoryListQuery lives in its own module (inventoryListQuery.js) purely so it can be
// unit-tested without starting this file's real server — see that module's header comment.

// GET /api/inventory?dealerId=&state=&make=&model=&cond=&q=&inStock=1&limit=&offset=&sort=
async function handleListInventory(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const { sql, args, orderBy } = inventoryListQuery(params);
  const limit = Math.min(Math.max(Number(params.get("limit")) || 200, 1), 2000);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);
  // Two independent queries, NOT SQL_CALC_FOUND_ROWS — reverted 2026-09-22 after it caused a
  // live outage on the default (no q=, inStock=1, sort=dealer:asc) view: 591k candidate rows,
  // 427k matching. SQL_CALC_FOUND_ROWS can't return early once LIMIT rows are found — it must
  // fully evaluate every matching row so FOUND_ROWS() is exact — so MariaDB gave up the
  // idx_inv_stock_dealer index-ordered scan (which finds the first `limit` rows and stops) for
  // a filesort over all 427k matches: 17.5s, confirmed live via EXPLAIN + timing. Splitting
  // back into two queries measured 19ms (SELECT, index range scan) + 839ms (COUNT(*)) on the
  // same data — ~20x faster combined, because the SELECT regains the index+LIMIT early-stop
  // and the COUNT is a separate, simple aggregate. This trades away the one real case
  // SQL_CALC_FOUND_ROWS helped (the original un-indexed q= full scan, where neither query
  // could stop early anyway) for correctness on every other case, which is the common one.
  const [rows] = await pool.query(`SELECT i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...args, limit, offset]);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${sql}`, args);
  sendJson(res, 200, { total, limit, offset, vehicles: rows.map(inventoryRowFromDb) });
}

// GET /api/inventory/export?<same filters as /api/inventory>&max= — the admin sheet's CSV source.
// The CSV used to page /api/inventory 2,000 rows at a time, so a 38k-row state paid ~20 separate
// sorts; this runs the filter once and streams one vehicle per line (NDJSON) as MariaDB returns
// rows, so neither this 1GB box nor the caller holds the whole export in memory. The last line is
// {"done":true,"rows":n,"capped":bool} — a stream without it was cut off. A client that
// disconnects destroys the connection (not released mid-query back into the pool).
async function handleExportInventory(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const { sql, args, orderBy } = inventoryListQuery(params);
  const max = Math.min(Math.max(Number(params.get("max")) || 50000, 1), 50000);
  const conn = await pool.getConnection();
  let aborted = false;
  res.on("close", () => { if (!res.writableFinished) { aborted = true; conn.destroy(); } });
  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
  let n = 0, capped = false;
  try {
    const rows = conn.connection.query(`SELECT i.*, d.city AS dealer_city, d.state AS dealer_state ${sql} ORDER BY ${orderBy} LIMIT ?`, [...args, max + 1]).stream({ highWaterMark: 500 });
    for await (const row of rows) {
      if (aborted) break;
      if (n === max) { capped = true; continue; }
      n++;
      if (!res.write(JSON.stringify(inventoryRowFromDb(row)) + "\n")) await new Promise((r) => { res.once("drain", r); res.once("close", r); });
    }
    if (!aborted) res.end(JSON.stringify({ done: true, rows: n, capped }) + "\n");
  } catch (err) {
    if (!aborted) {
      console.error(`${new Date().toISOString()} /api/inventory/export failed after ${n} rows:`, err.message);
      res.end(JSON.stringify({ error: "Export failed partway through" }) + "\n");
    }
  } finally {
    if (!aborted) conn.release();
  }
}

// GET /api/inventory/stats — counts for the admin sheet's filter menus.
// GET /api/inventory/analytics?state=&make=&dealerId=&model=&from=&to=
// Dealership analytics for the admin page: days on market (DOM = days on the lot,
// NOT the HTML DOM), velocity, pricing, assortment, TrimScout coverage, data quality.
// Aggregated in SQL over dealer_inventory (+ dealer_inventory_days for price cuts),
// cached 10 minutes per filter set and invalidated by every bulk upsert / sweep — so
// a page load never scans raw rows twice, and the nightly sync refreshes it.
//
// DOM formula: the crawl's days_on_lot when it carried one, else
//   DATEDIFF(COALESCE(removed_at, NOW()), COALESCE(crawl_first_seen, first_seen_at)).
// Bands: 0–14 / 15–45 / 46–90 / 90+.
const INV_DOM = "COALESCE(NULLIF(i.days_on_lot, 0), DATEDIFF(COALESCE(i.removed_at, NOW()), COALESCE(i.crawl_first_seen, i.first_seen_at)))";
const INV_BANDS = `SUM(${INV_DOM} <= 14) AS d0_14, SUM(${INV_DOM} BETWEEN 15 AND 45) AS d15_45, SUM(${INV_DOM} BETWEEN 46 AND 90) AS d46_90, SUM(${INV_DOM} > 90) AS d90p`;
const INV_DRIVETRAIN = `CASE WHEN CONCAT_WS(' ', i.trim, i.engine, i.body_style) REGEXP 'AWD|4WD|4x4|4MATIC|xDrive|quattro|4Motion|All[- ]Wheel|SH-AWD|e-4ORCE|Symmetrical' THEN 'AWD / 4WD' WHEN CONCAT_WS(' ', i.trim, i.engine) REGEXP 'RWD|Rear[- ]Wheel|sDrive' THEN 'RWD' WHEN CONCAT_WS(' ', i.trim, i.engine) REGEXP 'FWD|Front[- ]Wheel' THEN 'FWD' ELSE 'Not stated' END`;
const INV_POWERTRAIN = `CASE WHEN CONCAT_WS(' ', i.trim, i.engine, i.model) REGEXP 'Plug-in|PHEV|Prime|Recharge|e-hybrid' THEN 'Plug-in hybrid' WHEN CONCAT_WS(' ', i.trim, i.engine, i.model) REGEXP 'Hybrid|HEV|e:HEV|[0-9]h\\b' THEN 'Hybrid' WHEN CONCAT_WS(' ', i.trim, i.engine, i.model) REGEXP 'Electric|\\bEV\\b|kWh|bZ4X|EV6|EV9|Ioniq 5|Ioniq 6|ID\\.4|iX|EQ[A-Z]|Ariya|Solterra|Taycan|Macan Electric' THEN 'Electric' WHEN i.engine REGEXP 'Diesel|TDI' THEN 'Diesel' WHEN i.engine IS NOT NULL AND i.engine <> '' THEN 'Gas' ELSE 'Not stated' END`;
async function handleInventoryAnalytics(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const p = (k) => (params.get(k) || "").trim();
  const f = { state: p("state").toUpperCase().slice(0, 2), make: p("make").slice(0, 64), dealerId: INV_INT(p("dealerId")), model: p("model").slice(0, 96), from: INV_DATE(p("from")), to: INV_DATE(p("to")) };
  const key = "analytics:" + JSON.stringify(f);
  sendJson(res, 200, await invCached(key, () => computeInventoryAnalytics(pool, f)));
}
async function computeInventoryAnalytics(pool, f) {
  const where = [], args = [];
  if (f.state) { where.push("i.state = ?"); args.push(f.state); }
  if (f.make) { where.push("i.make = ?"); args.push(f.make); }
  if (f.dealerId != null) { where.push("i.dealer_id = ?"); args.push(f.dealerId); }
  if (f.model) { where.push("i.model = ?"); args.push(f.model); }
  // Date range = the observation window: rows the crawl saw inside it.
  if (f.from) { where.push("i.last_seen_at >= ?"); args.push(f.from); }
  if (f.to) { where.push("i.first_seen_at <= ?"); args.push(f.to + " 23:59:59"); }
  const scope = `FROM dealer_inventory i LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const stock = where.length ? `${scope} AND i.removed_at IS NULL` : `${scope} WHERE i.removed_at IS NULL`;
  const q = (sql, extra = []) => pool.query(sql, [...args, ...extra]).then(([rows]) => rows);
  const num = (v) => (v == null ? null : Number(v));
  const round1 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);
  // Medians: MariaDB ≥ 10.3 has MEDIAN() as a window function; older builds get null medians, not a 500.
  // MEDIAN() OVER a partition gives every row in the group the same value; the derived table t
  // exposes the key columns under PLAIN aliases (inner has "i.make AS make"), so the outer SELECT /
  // GROUP BY must use those plain names — never i.make or an AS in GROUP BY, which is invalid against t.
  async function medians(partition, innerCols, outerCols) {
    try {
      const rows = await q(`SELECT ${outerCols}, MAX(med) AS med FROM (SELECT ${innerCols}, MEDIAN(${INV_DOM}) OVER (PARTITION BY ${partition}) AS med ${stock}) t GROUP BY ${outerCols}`);
      return rows;
    } catch { return null; }
  }
  const medKey = (r, cols) => cols.map((c) => String(r[c] ?? "")).join("|");
  const attachMedian = (rows, meds, cols) => {
    const m = new Map((meds || []).map((r) => [medKey(r, cols), round1(r.med)]));
    for (const r of rows) r.medianDom = meds ? (m.get(medKey(r, cols)) ?? null) : null;
    return rows;
  };
  const shape = (r) => ({ ...r, n: Number(r.n), avgDom: round1(r.avgDom), bands: { d0_14: Number(r.d0_14 || 0), d15_45: Number(r.d15_45 || 0), d46_90: Number(r.d46_90 || 0), d90p: Number(r.d90p || 0) }, d0_14: undefined, d15_45: undefined, d46_90: undefined, d90p: undefined });

  const [[totals]] = await pool.query(`SELECT COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS}, MAX(i.last_seen_at) AS lastSeenAt, COUNT(DISTINCT i.dealer_id) AS dealers, COUNT(DISTINCT CONCAT(i.make, '|', i.model)) AS models ${stock}`, args);
  // --- DOM by model / dealer / trim / year / drivetrain / powertrain
  const byModel = (await q(`SELECT i.make, i.model, COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS}, AVG(CASE WHEN i.msrp > 0 AND i.price > 0 THEN (i.msrp - i.price) / i.msrp END) AS avgDiscount, SUM(i.window_sticker_url IS NOT NULL) AS withSticker ${stock} AND i.make IS NOT NULL AND i.model IS NOT NULL GROUP BY i.make, i.model ORDER BY n DESC LIMIT 400`)).map(shape);
  attachMedian(byModel, await medians("i.make, i.model", "i.make AS make, i.model AS model", "make, model"), ["make", "model"]);
  const byDealer = (await q(`SELECT i.dealer_id AS dealerId, i.dealer_name AS dealerName, d.state, d.city, COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS}, AVG(CASE WHEN i.msrp > 0 AND i.price > 0 THEN (i.msrp - i.price) / i.msrp END) AS avgDiscount, SUM(i.window_sticker_url IS NOT NULL) AS withSticker, SUM(i.options_json IS NOT NULL) AS withOptions, SUM(i.price IS NULL OR i.price <= 0) AS missingPrice, SUM(i.image_url IS NULL OR i.image_url = '') AS missingPhoto, SUM(i.last_seen_at < DATE_SUB(NOW(), INTERVAL 2 DAY)) AS stale, MAX(d.contact_email IS NOT NULL AND d.contact_email <> '') AS hasEmail, MAX(i.last_seen_at) AS lastSeenAt ${stock} GROUP BY i.dealer_id, i.dealer_name, d.state, d.city ORDER BY n DESC LIMIT 1500`)).map(shape);
  attachMedian(byDealer, await medians("i.dealer_id", "i.dealer_id AS dealerId", "dealerId"), ["dealerId"]);
  const byTrim = (await q(`SELECT i.make, i.model, i.trim, COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS}, AVG(CASE WHEN i.msrp > 0 AND i.price > 0 THEN (i.msrp - i.price) / i.msrp END) AS avgDiscount ${stock} AND i.make IS NOT NULL AND i.model IS NOT NULL AND i.trim IS NOT NULL AND i.trim <> '' GROUP BY i.make, i.model, i.trim HAVING n >= 2 ORDER BY n DESC LIMIT 400`)).map(shape);
  attachMedian(byTrim, await medians("i.make, i.model, i.trim", "i.make AS make, i.model AS model, i.trim AS trim", "make, model, trim"), ["make", "model", "trim"]);
  const byYear = (await q(`SELECT i.make, i.model, i.year, COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS} ${stock} AND i.make IS NOT NULL AND i.model IS NOT NULL AND i.year IS NOT NULL GROUP BY i.make, i.model, i.year ORDER BY n DESC LIMIT 600`)).map(shape);
  const byDrivetrain = (await q(`SELECT ${INV_DRIVETRAIN} AS drivetrain, COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS} ${stock} GROUP BY drivetrain ORDER BY n DESC`)).map(shape);
  const byPowertrain = (await q(`SELECT ${INV_POWERTRAIN} AS powertrain, COUNT(*) AS n, AVG(${INV_DOM}) AS avgDom, ${INV_BANDS} ${stock} GROUP BY powertrain ORDER BY n DESC`)).map(shape);

  // --- Velocity: churn inferred from removed_at (a VIN the crawl stopped seeing = sold-ish / moved).
  const [[turn]] = await pool.query(`SELECT SUM(i.removed_at IS NULL) AS onLot, SUM(i.removed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS removed7, SUM(i.removed_at >= DATE_SUB(NOW(), INTERVAL 28 DAY)) AS removed28, SUM(i.first_seen_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND i.removed_at IS NULL) AS arrived7 ${scope}`, args);
  const velocityByModel = (await q(`SELECT i.make, i.model, SUM(i.removed_at IS NULL) AS onLot, SUM(i.removed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS removed7, SUM(i.removed_at >= DATE_SUB(NOW(), INTERVAL 28 DAY)) AS removed28 ${scope} ${where.length ? "AND" : "WHERE"} i.make IS NOT NULL AND i.model IS NOT NULL GROUP BY i.make, i.model HAVING onLot > 0 ORDER BY onLot DESC LIMIT 400`)).map((r) => {
    const onLot = Number(r.onLot), removed7 = Number(r.removed7 || 0), removed28 = Number(r.removed28 || 0);
    const weeklyPace = removed28 > 0 ? removed28 / 4 : removed7;
    return { make: r.make, model: r.model, onLot, removed7, removed28, turnRate: onLot ? round1((removed7 / onLot) * 100) : null, daysSupply: weeklyPace > 0 ? Math.round(onLot / (weeklyPace / 7)) : null };
  });
  const velocityByDealer = (await q(`SELECT i.dealer_id AS dealerId, i.dealer_name AS dealerName, SUM(i.removed_at IS NULL) AS onLot, SUM(i.removed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS removed7 ${scope} GROUP BY i.dealer_id, i.dealer_name HAVING onLot > 0 ORDER BY onLot DESC LIMIT 1500`)).map((r) => ({ dealerId: Number(r.dealerId), dealerName: r.dealerName, onLot: Number(r.onLot), removed7: Number(r.removed7 || 0), turnRate: Number(r.onLot) ? round1((Number(r.removed7 || 0) / Number(r.onLot)) * 100) : null }));

  // --- Pricing: list vs MSRP, and cuts from the day-by-day observations, by lot age at the cut.
  const [[disc]] = await pool.query(`SELECT AVG(CASE WHEN i.msrp > 0 AND i.price > 0 THEN (i.msrp - i.price) / i.msrp END) AS avgDiscount, SUM(i.msrp > 0 AND i.price > 0) AS priced, SUM(i.price_diff < 0) AS dropsNow, AVG(CASE WHEN i.price_diff < 0 THEN -i.price_diff END) AS avgDropNow ${stock}`, args);
  let priceCuts = null;
  try {
    const cutSql = `SELECT CASE WHEN age < 30 THEN 'lt30' WHEN age < 60 THEN 'd30' WHEN age < 90 THEN 'd60' ELSE 'd90' END AS band, COUNT(*) AS cuts, AVG(cut) AS avgCut, AVG(cut / prev) AS avgCutPct FROM (
        SELECT x.vin, x.dealer_id, x.seen_on, x.price, LAG(x.price) OVER w AS prev, DATEDIFF(x.seen_on, MIN(x.seen_on) OVER (PARTITION BY x.vin, x.dealer_id)) AS age, (LAG(x.price) OVER w - x.price) AS cut
        FROM dealer_inventory_days x JOIN dealer_inventory i ON i.vin = x.vin AND i.dealer_id = x.dealer_id LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}
        WINDOW w AS (PARTITION BY x.vin, x.dealer_id ORDER BY x.seen_on)
      ) c WHERE c.prev > 0 AND c.cut > 0 GROUP BY band`;
    const rows = await q(cutSql);
    const [[obs]] = await pool.query(`SELECT COUNT(DISTINCT CONCAT(x.vin, '|', x.dealer_id)) AS vehicles FROM dealer_inventory_days x JOIN dealer_inventory i ON i.vin = x.vin AND i.dealer_id = x.dealer_id LEFT JOIN dealership_contacts d ON d.id = i.dealer_id ${where.length ? "WHERE " + where.join(" AND ") : ""}`, args);
    priceCuts = { vehiclesObserved: Number(obs.vehicles || 0), bands: Object.fromEntries(rows.map((r) => [r.band, { cuts: Number(r.cuts), avgCut: Math.round(Number(r.avgCut)), avgCutPct: round1(Number(r.avgCutPct) * 100) }])) };
  } catch { priceCuts = null; }

  // --- Assortment: this scope's model mix vs the brand's mix across every store we crawl (the norm).
  const makes = f.make ? [f.make] : byModel.map((r) => r.make).filter((v, i, a) => a.indexOf(v) === i).slice(0, 12);
  const brandNorm = makes.length ? await pool.query(`SELECT make, model, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND make IN (?) AND model IS NOT NULL GROUP BY make, model`, [makes]).then(([rows]) => rows.map((r) => ({ make: r.make, model: r.model, n: Number(r.n) }))) : [];

  // --- Coverage by brand (dealer-level coverage rides on byDealer).
  const coverageByMake = await q(`SELECT i.make, COUNT(*) AS n, SUM(i.window_sticker_url IS NOT NULL) AS withSticker, SUM(i.options_json IS NOT NULL) AS withOptions, SUM(i.price IS NULL OR i.price <= 0) AS missingPrice, SUM(i.image_url IS NULL OR i.image_url = '') AS missingPhoto ${stock} AND i.make IS NOT NULL GROUP BY i.make ORDER BY n DESC LIMIT 60`).then((rows) => rows.map((r) => ({ make: r.make, n: Number(r.n), withSticker: Number(r.withSticker || 0), withOptions: Number(r.withOptions || 0), missingPrice: Number(r.missingPrice || 0), missingPhoto: Number(r.missingPhoto || 0) })));
  const [[emails]] = await pool.query(`SELECT COUNT(DISTINCT i.dealer_id) AS dealers, COUNT(DISTINCT CASE WHEN d.contact_email IS NOT NULL AND d.contact_email <> '' THEN i.dealer_id END) AS withEmail ${stock}`, args);

  return {
    computedAt: new Date().toISOString(),
    filters: f,
    domFormula: "days_on_lot from the crawl when present, else days between the first day the crawl saw the VIN at this store (crawl_first_seen, else first_seen_at) and today (or the day it was removed)",
    totals: { n: Number(totals.n), avgDom: round1(totals.avgDom), bands: { d0_14: Number(totals.d0_14 || 0), d15_45: Number(totals.d15_45 || 0), d46_90: Number(totals.d46_90 || 0), d90p: Number(totals.d90p || 0) }, dealers: Number(totals.dealers), models: Number(totals.models), lastSeenAt: totals.lastSeenAt },
    dom: { byModel, byDealer: byDealer.map((r) => ({ ...r, dealerId: Number(r.dealerId), withOptions: Number(r.withOptions || 0), missingPrice: Number(r.missingPrice || 0), missingPhoto: Number(r.missingPhoto || 0), stale: Number(r.stale || 0), hasEmail: Boolean(Number(r.hasEmail)), withSticker: Number(r.withSticker || 0), avgDiscount: r.avgDiscount == null ? null : round1(Number(r.avgDiscount) * 100) })), byTrim, byYear, byDrivetrain, byPowertrain },
    velocity: { onLot: Number(turn.onLot || 0), removed7: Number(turn.removed7 || 0), removed28: Number(turn.removed28 || 0), arrived7: Number(turn.arrived7 || 0), turnRate: Number(turn.onLot) ? round1((Number(turn.removed7 || 0) / Number(turn.onLot)) * 100) : null, byModel: velocityByModel, byDealer: velocityByDealer },
    pricing: { avgDiscount: disc.avgDiscount == null ? null : round1(Number(disc.avgDiscount) * 100), priced: Number(disc.priced || 0), dropsNow: Number(disc.dropsNow || 0), avgDropNow: disc.avgDropNow == null ? null : Math.round(Number(disc.avgDropNow)), cuts: priceCuts },
    assortment: { brandNorm },
    coverage: { byMake: coverageByMake, dealersWithEmail: Number(emails.withEmail || 0), dealers: Number(emails.dealers || 0) },
  };
}

async function handleInventoryStats(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  sendJson(res, 200, await invCached("stats", () => computeInventoryStats(pool)));
}
async function computeInventoryStats(pool) {
  const [[tot]] = await pool.query("SELECT COUNT(*) AS total, SUM(removed_at IS NULL) AS inStock, COUNT(DISTINCT dealer_id) AS dealers, COUNT(DISTINCT vin) AS vins, MAX(last_seen_at) AS lastSeenAt FROM dealer_inventory");
  const [byMake] = await pool.query("SELECT make, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND make IS NOT NULL GROUP BY make ORDER BY n DESC LIMIT 100");
  // Reads i.state directly (denormalized onto dealer_inventory in PR #296 specifically to kill
  // this exact JOIN-into-dealership_contacts-then-GROUP-BY shape — confirmed live 2026-09-25,
  // 27.4s -> 0.29s for the equivalent list-query case) rather than the STRAIGHT_JOIN this
  // function never got updated to drop.
  const [byState] = await pool.query("SELECT state, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND state IS NOT NULL GROUP BY state ORDER BY n DESC");
  const [byCond] = await pool.query("SELECT cond, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL GROUP BY cond");
  const [[mv]] = await pool.query("SELECT SUM(change_type = 'NEW_ARRIVAL') AS arrivals, SUM(price_diff < 0) AS priceDrops, SUM(price_diff > 0) AS priceIncreases, SUM(window_sticker_url IS NOT NULL) AS withSticker, SUM(removed_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)) AS removedToday FROM dealer_inventory WHERE removed_at IS NULL OR removed_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)");
  return { total: Number(tot.total), inStock: Number(tot.inStock || 0), dealers: Number(tot.dealers), vins: Number(tot.vins), lastSeenAt: tot.lastSeenAt, byMake, byState, byCond,
    movement: { arrivals: Number(mv.arrivals || 0), priceDrops: Number(mv.priceDrops || 0), priceIncreases: Number(mv.priceIncreases || 0), withSticker: Number(mv.withSticker || 0), removedToday: Number(mv.removedToday || 0) } };
}

// GET /api/inventory/makes — just the make list, for the buyer /search page's make picker
// (GET /api/catalog/makes). Deliberately NOT a call into computeInventoryStats(): that function
// also computes byState (until just above, an unindexed JOIN into dealership_contacts) and a
// movement aggregate that scans effectively the whole table via an OR condition neither of which
// this needs — sharing that one "stats" cache key/computation meant every buyer visiting /search
// paid for the admin sheet's full stats payload just to populate a <select>. Confirmed live
// 2026-09-25: this is the same fast, indexed byMake query computeInventoryStats already runs
// first, on its own with nothing slow to wait behind.
async function handleInventoryMakes(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  sendJson(res, 200, await invCached("makes", async () => {
    const [rows] = await pool.query("SELECT make, COUNT(*) AS n FROM dealer_inventory WHERE removed_at IS NULL AND make IS NOT NULL GROUP BY make ORDER BY n DESC LIMIT 100");
    return { makes: rows.map((r) => ({ make: r.make, n: Number(r.n) })) };
  }));
}

// GET /api/inventory/by-dealer — in-stock counts per store, for the dealer sheet.
async function handleInventoryByDealer(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  sendJson(res, 200, await invCached("by-dealer", async () => {
    const [rows] = await pool.query("SELECT dealer_id, COUNT(*) AS inStock, SUM(cond = 'new') AS newCount, SUM(price_diff < 0) AS priceDrops, MAX(last_seen_at) AS lastSeenAt FROM dealer_inventory WHERE removed_at IS NULL AND dealer_id > 0 GROUP BY dealer_id");
    return { dealers: rows.map((r) => ({ dealerId: String(r.dealer_id), inStock: Number(r.inStock), newCount: Number(r.newCount || 0), priceDrops: Number(r.priceDrops || 0), lastSeenAt: r.lastSeenAt })) };
  }));
}

// GET /api/inventory/catalog?make=&model=&trim= — the buyer /search page's filter-panel
// options: which factory option codes and exterior/interior colors actually exist among
// in-stock vehicles matching the given make/model/trim. Scoped (not a global distinct list)
// so the panel never offers a combination that returns zero results — e.g. offering "PANO"
// for a Model 3 when only the Model Y has it. Cached per make/model/trim key the same 10
// minutes as stats/by-dealer/analytics, invalidated the same way (every bulk upsert/sweep).
async function handleInventoryCatalogOptions(req, res, params) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  const make = (params.get("make") || "").trim();
  const model = (params.get("model") || "").trim();
  const trim = (params.get("trim") || "").trim();
  const where = ["i.removed_at IS NULL"], args = [];
  if (make) { where.push("i.make = ?"); args.push(make); }
  if (model) { where.push("i.model = ?"); args.push(model); }
  if (trim) { where.push("i.trim = ?"); args.push(trim); }
  const whereSql = "WHERE " + where.join(" AND ");
  // Both queries below only get a FORCE INDEX when make= is set — mirrors inventoryListQuery.js's
  // own rule (a hint is only safe/helpful when the leading equality column it expects is actually
  // pinned). Confirmed live 2026-09-25: without these, both queries scanned/filesorted the whole
  // matching set — the options query drove from dealer_inventory_options (the larger table) and
  // filtered dealer_inventory afterward instead of the other way around (30s+, mostly wasted once
  // dealer_inventory_options has real volume); the colors query had no index covering its
  // GROUP BY exterior_color, interior_color at all ("Using temporary; Using filesort" over 280k+
  // rows for a single make).
  const makeIndexHint = make ? "FORCE INDEX (idx_inv_stock_make_dealer)" : "";
  const makeColorsIndexHint = make ? "FORCE INDEX (idx_inv_stock_make_colors)" : "";
  const cacheKey = `catalog-options:${make}|${model}|${trim}`;
  sendJson(res, 200, await invCached(cacheKey, async () => {
    // STRAIGHT_JOIN drives from dealer_inventory (filtered by make=/removed_at first, typically
    // the far smaller side) into dealer_inventory_options by its (vin, dealer_id, code) primary
    // key, instead of the optimizer's previous choice of scanning every row in
    // dealer_inventory_options and only filtering by make afterward.
    const [optionRows] = await pool.query(
      `SELECT STRAIGHT_JOIN o.code, COUNT(*) AS vehicleCount FROM dealer_inventory i ${makeIndexHint} JOIN dealer_inventory_options o ON o.vin = i.vin AND o.dealer_id = i.dealer_id ${whereSql} GROUP BY o.code ORDER BY o.code`,
      args
    );
    const [colorRows] = await pool.query(
      `SELECT exterior_color, interior_color FROM dealer_inventory i ${makeColorsIndexHint} ${whereSql} AND (exterior_color IS NOT NULL OR interior_color IS NOT NULL) GROUP BY exterior_color, interior_color`,
      args
    );
    const exteriorColors = [...new Set(colorRows.map((r) => r.exterior_color).filter(Boolean))].sort();
    const interiorColors = [...new Set(colorRows.map((r) => r.interior_color).filter(Boolean))].sort();
    return {
      options: optionRows.map((r) => ({ code: r.code, vehicleCount: Number(r.vehicleCount) })),
      exteriorColors,
      interiorColors,
    };
  }));
}

// ---------------------------------------------------------------------------
// Cross-box crawl claim queue — dynamic work-stealing for the nightly crawl
// fleet, added 2026-09-25 after real measurement showed box 1 (2 vCPU) runs
// at 77.4s/rooftop vs box 2's (4 vCPU) 16.2s/rooftop — a 4.8x gap driven by
// concurrency-per-vCPU oversubscription, not state assignment (see
// docs/CAPACITY_SLA.md). A STATIC split "fair by wall-clock time" therefore
// gives box 1 only a tiny sliver of the workload, which finishes in ~2h and
// then sits idle the rest of the night while box 2/3/4 grind through many
// more hours — the same box-1-lags-everyone-waits problem, just inverted.
// This table lets any box, once its own locally-assigned states are done,
// keep claiming more states from a shared pool (seeded once per run) until
// its own budget runs out — the fleet's actual throughput is what balances,
// not a number computed hours before the run started.
//
// One row per (run_date, brand_set, state). 'unclaimed' -> 'claimed' via an
// atomic UPDATE ... LIMIT 1 (no SELECT-then-UPDATE race), 'claimed' -> 'done'
// or back to 'unclaimed' on release (so a crashed claimant's work can be
// retried by someone else), and a stale 'claimed' row (no heartbeat within
// CRAWL_CLAIM_STALE_MS) is auto-reclaimed the same self-healing way a stale
// driver.lock already gets reclaimed on the crawler side.
// ---------------------------------------------------------------------------
let crawlClaimsReady = false;
async function ensureCrawlClaimsTable(pool) {
  if (crawlClaimsReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS crawl_claims (
    run_date DATE NOT NULL,
    brand_set VARCHAR(16) NOT NULL,
    state CHAR(2) NOT NULL,
    rooftop_count INT NOT NULL DEFAULT 0,
    estimated_seconds INT NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'unclaimed',
    claimed_by VARCHAR(128) NULL,
    claimed_at DATETIME NULL,
    heartbeat_at DATETIME NULL,
    finished_at DATETIME NULL,
    PRIMARY KEY (run_date, brand_set, state),
    INDEX idx_claims_status (run_date, brand_set, status, estimated_seconds)
  )`);
  // ADD COLUMN IF NOT EXISTS: a box that already created this table before
  // estimated_seconds existed (this session's own earlier deploy) gets the
  // column added in place rather than needing a manual migration — same
  // pattern already used elsewhere in this file (see rfq_invites/
  // rfq_requests ALTERs above).
  await pool.query(`ALTER TABLE crawl_claims ADD COLUMN IF NOT EXISTS estimated_seconds INT NOT NULL DEFAULT 0`);
  crawlClaimsReady = true;
}

const CRAWL_CLAIM_STALE_MS = 90 * 60 * 1000; // 90min — real states have taken up to ~1h; generous margin

// POST /api/ops/crawl-claims/seed { runDate, brandSet, states: [{state, rooftopCount, estimatedSeconds}] }
// Idempotent: INSERT IGNORE means a box that already seeded tonight (or a second box seeding the same
// run) never resets rows another box has already claimed or finished. Every state seeds 'unclaimed',
// including the seeding box's own statically-assigned list — seeding never reserves a row; see
// claim-specific below for how a box actually secures one of its own states right before running it.
async function handleCrawlClaimsSeed(req, res) {
  const pool = getPool();
  await ensureCrawlClaimsTable(pool);
  const body = await readBody(req);
  const runDate = INV_DATE(body.runDate);
  const brandSet = typeof body.brandSet === "string" ? body.brandSet.slice(0, 16) : "";
  const states = Array.isArray(body.states) ? body.states : [];
  if (!runDate || !brandSet || !states.length) return badRequest(res, "runDate, brandSet and states[] are required");
  const rows = states
    .filter((s) => typeof s.state === "string" && s.state.length === 2)
    .map((s) => [runDate, brandSet, s.state.toUpperCase(), INV_INT(s.rooftopCount) || 0, INV_INT(s.estimatedSeconds) || 0]);
  if (!rows.length) return badRequest(res, "no valid state rows");
  await pool.query(
    "INSERT IGNORE INTO crawl_claims (run_date, brand_set, state, rooftop_count, estimated_seconds) VALUES ?",
    [rows]
  );
  sendJson(res, 200, { seeded: rows.length });
}

// POST /api/ops/crawl-claims/claim-specific { runDate, brandSet, state, owner }
// Atomically claims exactly ONE named state — added 2026-09-25 so a box's own statically-hinted states
// go through the SAME claim as a stolen one (see claimLocalStateFn in run-daily-crawl.mjs) instead of
// running unconditionally: { claimed: false } means a peer already has it (or already finished it),
// which is the correct, expected outcome when a faster box got to this box's own hinted state first —
// never an error.
async function handleCrawlClaimsClaimSpecific(req, res) {
  const pool = getPool();
  await ensureCrawlClaimsTable(pool);
  const body = await readBody(req);
  const runDate = INV_DATE(body.runDate);
  const brandSet = typeof body.brandSet === "string" ? body.brandSet.slice(0, 16) : "";
  const state = typeof body.state === "string" ? body.state.slice(0, 2).toUpperCase() : "";
  const owner = typeof body.owner === "string" && body.owner ? body.owner.slice(0, 128) : "unknown";
  if (!runDate || !brandSet || !state) return badRequest(res, "runDate, brandSet and state are required");
  const now = new Date();
  const [result] = await pool.query(
    "UPDATE crawl_claims SET status = 'claimed', claimed_by = ?, claimed_at = ?, heartbeat_at = ? WHERE run_date = ? AND brand_set = ? AND state = ? AND status = 'unclaimed'",
    [owner, now, now, runDate, brandSet, state]
  );
  sendJson(res, 200, { claimed: result.affectedRows > 0 });
}

// POST /api/ops/crawl-claims/claim { runDate, brandSet, owner, maxRooftops? }
// Atomically claims the LONGEST-ESTIMATED-JOB unclaimed (or stale-reclaimed) state that fits within
// maxRooftops, when given — the caller's own remaining-budget check (see runStatesWithBoundedConcurrency's
// claimNextStateFn in run-daily-crawl.mjs), never a state this box couldn't plausibly finish before its
// own SLA deadline. Longest-first (added 2026-09-25): ranks by estimated_seconds, not raw rooftop_count,
// so a disproportionately slow (e.g. known-high-WAF) state gets claimed early in the night while there's
// still a full budget's worth of headroom to absorb it running long — the fit filter still checks
// rooftop_count, which is what a claimer's own maxRooftops (computed from ITS OWN rate) is expressed in;
// estimated_seconds only decides ranking order among the candidates that already pass that filter. A
// single UPDATE ... ORDER BY ... LIMIT 1 makes the claim atomic without a separate lock: MySQL/MariaDB
// serializes concurrent UPDATEs against the same row set, so two boxes racing for the same top candidate
// never both win it.
async function handleCrawlClaimsClaim(req, res) {
  const pool = getPool();
  await ensureCrawlClaimsTable(pool);
  const body = await readBody(req);
  const runDate = INV_DATE(body.runDate);
  const brandSet = typeof body.brandSet === "string" ? body.brandSet.slice(0, 16) : "";
  const owner = typeof body.owner === "string" && body.owner ? body.owner.slice(0, 128) : "unknown";
  const maxRooftops = INV_INT(body.maxRooftops);
  if (!runDate || !brandSet) return badRequest(res, "runDate and brandSet are required");

  // Reclaim anything stale first — a crashed/killed claimant never wedges its state unstealable forever.
  await pool.query(
    "UPDATE crawl_claims SET status = 'unclaimed', claimed_by = NULL, claimed_at = NULL, heartbeat_at = NULL WHERE run_date = ? AND brand_set = ? AND status = 'claimed' AND heartbeat_at < ?",
    [runDate, brandSet, new Date(Date.now() - CRAWL_CLAIM_STALE_MS)]
  );

  const params = [runDate, brandSet];
  let fitClause = "";
  if (maxRooftops != null) { fitClause = "AND rooftop_count <= ?"; params.push(maxRooftops); }
  const [[candidate]] = await pool.query(
    `SELECT state, rooftop_count, estimated_seconds FROM crawl_claims WHERE run_date = ? AND brand_set = ? AND status = 'unclaimed' ${fitClause} ORDER BY estimated_seconds DESC LIMIT 1`,
    params
  );
  if (!candidate) return sendJson(res, 200, { claimed: null });

  const now = new Date();
  const [result] = await pool.query(
    "UPDATE crawl_claims SET status = 'claimed', claimed_by = ?, claimed_at = ?, heartbeat_at = ? WHERE run_date = ? AND brand_set = ? AND state = ? AND status = 'unclaimed'",
    [owner, now, now, runDate, brandSet, candidate.state]
  );
  // Someone else won the race between our SELECT and UPDATE — try once more rather than report nothing
  // claimable when a smaller state might still be free.
  if (result.affectedRows === 0) return handleCrawlClaimsClaim(req, res);
  sendJson(res, 200, { claimed: { state: candidate.state, rooftopCount: candidate.rooftop_count, estimatedSeconds: candidate.estimated_seconds } });
}

// POST /api/ops/crawl-claims/heartbeat { runDate, brandSet, state, owner }
async function handleCrawlClaimsHeartbeat(req, res) {
  const pool = getPool();
  await ensureCrawlClaimsTable(pool);
  const body = await readBody(req);
  const runDate = INV_DATE(body.runDate);
  const brandSet = typeof body.brandSet === "string" ? body.brandSet.slice(0, 16) : "";
  const state = typeof body.state === "string" ? body.state.slice(0, 2).toUpperCase() : "";
  const owner = typeof body.owner === "string" ? body.owner.slice(0, 128) : "";
  if (!runDate || !brandSet || !state) return badRequest(res, "runDate, brandSet and state are required");
  await pool.query(
    "UPDATE crawl_claims SET heartbeat_at = ? WHERE run_date = ? AND brand_set = ? AND state = ? AND claimed_by = ? AND status = 'claimed'",
    [new Date(), runDate, brandSet, state, owner]
  );
  sendJson(res, 200, { ok: true });
}

// POST /api/ops/crawl-claims/release { runDate, brandSet, state, owner, status: 'done' | 'failed' }
// 'done' is terminal; 'failed' resets to 'unclaimed' so another box can retry it tonight instead of the
// state silently never running. Only the actual holder releases (same guard as elsewhere in this file).
async function handleCrawlClaimsRelease(req, res) {
  const pool = getPool();
  await ensureCrawlClaimsTable(pool);
  const body = await readBody(req);
  const runDate = INV_DATE(body.runDate);
  const brandSet = typeof body.brandSet === "string" ? body.brandSet.slice(0, 16) : "";
  const state = typeof body.state === "string" ? body.state.slice(0, 2).toUpperCase() : "";
  const owner = typeof body.owner === "string" ? body.owner.slice(0, 128) : "";
  const status = body.status === "done" ? "done" : "unclaimed";
  if (!runDate || !brandSet || !state) return badRequest(res, "runDate, brandSet and state are required");
  const now = new Date();
  await pool.query(
    status === "done"
      ? "UPDATE crawl_claims SET status = 'done', finished_at = ? WHERE run_date = ? AND brand_set = ? AND state = ? AND claimed_by = ?"
      : "UPDATE crawl_claims SET status = 'unclaimed', claimed_by = NULL, claimed_at = NULL, heartbeat_at = NULL WHERE run_date = ? AND brand_set = ? AND state = ? AND claimed_by = ?",
    status === "done" ? [now, runDate, brandSet, state, owner] : [runDate, brandSet, state, owner]
  );
  sendJson(res, 200, { released: true });
}

// GET /api/ops/crawl-claims/status?runDate=&brandSet= — every claim row for tonight's run, for the
// fleet-summary/box-report observability requirement (who donated, who stole, states moved).
async function handleCrawlClaimsStatus(req, res, params) {
  const pool = getPool();
  await ensureCrawlClaimsTable(pool);
  const runDate = INV_DATE(params.get("runDate") || "");
  const brandSet = params.get("brandSet") || "";
  if (!runDate || !brandSet) return badRequest(res, "runDate and brandSet query params are required");
  const [rows] = await pool.query(
    // ORDER BY claimed_at (nulls-i.e.-never-claimed last): the box-report's claim-order log (see
    // docs/CAPACITY_SLA.md's longest-job-first section) reads this endpoint expecting the ACTUAL claim
    // order, to compare against the estimated_seconds ranking that drove it.
    "SELECT state, rooftop_count, estimated_seconds, status, claimed_by, claimed_at, heartbeat_at, finished_at FROM crawl_claims WHERE run_date = ? AND brand_set = ? ORDER BY (claimed_at IS NULL), claimed_at",
    [runDate, brandSet]
  );
  sendJson(res, 200, {
    runDate,
    brandSet,
    states: rows.map((r) => ({
      state: r.state,
      rooftopCount: r.rooftop_count,
      estimatedSeconds: r.estimated_seconds,
      status: r.status,
      claimedBy: r.claimed_by,
      claimedAt: r.claimed_at,
      heartbeatAt: r.heartbeat_at,
      finishedAt: r.finished_at,
      actualSeconds: r.claimed_at && r.finished_at ? Math.round((new Date(r.finished_at) - new Date(r.claimed_at)) / 1000) : null,
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

  // dealer inventory (crawled vehicles)
  if (req.method === "POST" && pathname === "/api/inventory/bulk") return run(handleInventoryBulk);
  if (req.method === "POST" && pathname === "/api/inventory/sweep") return run(handleInventorySweep);
  if (req.method === "GET" && pathname === "/api/inventory/stats") return run(handleInventoryStats);
  if (req.method === "GET" && pathname === "/api/inventory/makes") return run(handleInventoryMakes);
  if (req.method === "GET" && pathname === "/api/inventory/analytics") return run(handleInventoryAnalytics, url.searchParams);
  if (req.method === "GET" && pathname === "/api/inventory/by-dealer") return run(handleInventoryByDealer);
  if (req.method === "GET" && pathname === "/api/inventory/catalog") return run(handleInventoryCatalogOptions, url.searchParams);
if (req.method === "GET" && pathname === "/api/inventory/by-listing-url") return run(handleInventoryByListingUrl, url.searchParams);

  // cross-box crawl claim queue (dynamic work-stealing)
  if (req.method === "POST" && pathname === "/api/ops/crawl-claims/seed") return run(handleCrawlClaimsSeed);
  if (req.method === "POST" && pathname === "/api/ops/crawl-claims/claim-specific") return run(handleCrawlClaimsClaimSpecific);
  if (req.method === "POST" && pathname === "/api/ops/crawl-claims/claim") return run(handleCrawlClaimsClaim);
  if (req.method === "POST" && pathname === "/api/ops/crawl-claims/heartbeat") return run(handleCrawlClaimsHeartbeat);
  if (req.method === "POST" && pathname === "/api/ops/crawl-claims/release") return run(handleCrawlClaimsRelease);
  if (req.method === "GET" && pathname === "/api/ops/crawl-claims/status") return run(handleCrawlClaimsStatus, url.searchParams);
  const inventoryVinMatch = pathname.match(/^\/api\/inventory\/vin\/([A-HJ-NPR-Z0-9]{17})$/i);
  if (req.method === "GET" && inventoryVinMatch) return run(handleInventoryVin, inventoryVinMatch[1].toUpperCase());
  if (req.method === "GET" && pathname === "/api/inventory") return run(handleListInventory, url.searchParams);
  if (req.method === "GET" && pathname === "/api/inventory/export") return run(handleExportInventory, url.searchParams);

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
  const contractMatch = pathname.match(/^\/api\/deals\/(\d+)\/contract$/);
  if (req.method === "POST" && contractMatch) {
    return run(handleUploadContract, Number(contractMatch[1]));
  }
  if (req.method === "GET" && contractMatch) {
    return run(handleGetContractFile, Number(contractMatch[1]));
  }
  const verificationMatch = pathname.match(/^\/api\/deals\/(\d+)\/verification$/);
  if (req.method === "POST" && verificationMatch) {
    return run(handleSaveVerification, Number(verificationMatch[1]));
  }
  const tradeInMatch = pathname.match(/^\/api\/deals\/(\d+)\/trade-in$/);
  if (req.method === "POST" && tradeInMatch) {
    return run(handleSubmitTradeIn, Number(tradeInMatch[1]));
  }
  const appraisalMatch = pathname.match(/^\/api\/deals\/(\d+)\/trade-in\/appraisal$/);
  if (req.method === "POST" && appraisalMatch) {
    return run(handleAppraiseTradeIn, Number(appraisalMatch[1]));
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
  const reqMarketMatch = pathname.match(/^\/api\/deal-requests\/(\d+)\/market$/);
  if (req.method === "GET" && reqMarketMatch) {
    return run(handleGetRequestMarket, Number(reqMarketMatch[1]));
  }
  const reqIdMatch = pathname.match(/^\/api\/deal-requests\/(\d+)$/);
  if (req.method === "GET" && reqIdMatch) {
    return run(handleGetDealRequest, Number(reqIdMatch[1]));
  }
  const expireMatch = pathname.match(/^\/api\/deal-requests\/(\d+)\/expire$/);
  if (req.method === "POST" && expireMatch) {
    return run(handleExpireDealRequest, Number(expireMatch[1]));
  }
  const negotiationMatch = pathname.match(/^\/api\/deal-requests\/(\d+)\/negotiation$/);
  if (req.method === "POST" && negotiationMatch) {
    return run(handleUpdateDealRequestNegotiation, Number(negotiationMatch[1]));
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
  if (req.method === "GET" && pathname === "/api/dealer-responsiveness") {
    return run(handleGetDealerResponsiveness, url.searchParams);
  }

  // RFQs ("invite dealers to quote" experiment — not an auction)
  if (req.method === "POST" && pathname === "/api/rfqs") {
    return run(handleCreateRfq);
  }
  if (req.method === "GET" && pathname === "/api/rfqs") {
    return run(handleListRfqs, url.searchParams);
  }
  const rfqIdMatch = pathname.match(/^\/api\/rfqs\/(\d+)$/);
  if (req.method === "GET" && rfqIdMatch) {
    return run(handleGetRfq, Number(rfqIdMatch[1]));
  }
  const rfqInvitesMatch = pathname.match(/^\/api\/rfqs\/(\d+)\/invites$/);
  if (req.method === "POST" && rfqInvitesMatch) {
    return run(handleCreateRfqInvite, Number(rfqInvitesMatch[1]));
  }
  const rfqInviteDeliveryMatch = pathname.match(/^\/api\/rfqs\/(\d+)\/invites\/(\d+)\/delivery$/);
  if (req.method === "POST" && rfqInviteDeliveryMatch) {
    return run(handleRfqInviteDelivery, Number(rfqInviteDeliveryMatch[1]), Number(rfqInviteDeliveryMatch[2]));
  }
  if (req.method === "PATCH" && rfqIdMatch) {
    return run(handleAdminPatchRfq, Number(rfqIdMatch[1]));
  }
  const rfqApprovalMatch = pathname.match(/^\/api\/rfqs\/(\d+)\/approval$/);
  if (req.method === "POST" && rfqApprovalMatch) {
    return run(handleRfqApproval, Number(rfqApprovalMatch[1]));
  }
  const rfqInviteIdMatch = pathname.match(/^\/api\/rfqs\/(\d+)\/invites\/(\d+)$/);
  if (req.method === "DELETE" && rfqInviteIdMatch) {
    return run(handleDeleteRfqInvite, Number(rfqInviteIdMatch[1]), Number(rfqInviteIdMatch[2]));
  }
  const rfqLeasePrefsMatch = pathname.match(/^\/api\/rfqs\/(\d+)\/lease-prefs$/);
  if (req.method === "PATCH" && rfqLeasePrefsMatch) {
    return run(handlePatchRfqLeasePrefs, Number(rfqLeasePrefsMatch[1]));
  }
  const rfqInviteTokenMatch = pathname.match(/^\/api\/rfq-invites\/by-token\/([A-Za-z0-9_-]{8,80})$/);
  if (req.method === "GET" && rfqInviteTokenMatch) {
    return run(handleRfqInviteByToken, rfqInviteTokenMatch[1]);
  }
  const rfqInviteCounterMatch = pathname.match(/^\/api\/rfqs\/(\d+)\/invites\/(\d+)\/buyer-counter$/);
  if (req.method === "POST" && rfqInviteCounterMatch) {
    return run(handleBuyerCounter, Number(rfqInviteCounterMatch[1]), Number(rfqInviteCounterMatch[2]));
  }
  const rfqInviteDeclineMatch = pathname.match(/^\/api\/rfqs\/(\d+)\/invites\/(\d+)\/decline$/);
  if (req.method === "POST" && rfqInviteDeclineMatch) {
    return run(handleDeclineRfqInvite, Number(rfqInviteDeclineMatch[1]), Number(rfqInviteDeclineMatch[2]));
  }
  const rfqInviteQuotesMatch = pathname.match(/^\/api\/rfqs\/(\d+)\/invites\/(\d+)\/quotes$/);
  if (req.method === "POST" && rfqInviteQuotesMatch) {
    return run(handleSubmitRfqQuote, Number(rfqInviteQuotesMatch[1]), Number(rfqInviteQuotesMatch[2]));
  }
  const rfqPickMatch = pathname.match(/^\/api\/rfqs\/(\d+)\/pick$/);
  if (req.method === "POST" && rfqPickMatch) {
    return run(handlePickRfqQuote, Number(rfqPickMatch[1]));
  }
  const rfqWalkMatch = pathname.match(/^\/api\/rfqs\/(\d+)\/walk$/);
  if (req.method === "POST" && rfqWalkMatch) {
    return run(handleWalkAwayFromRfq, Number(rfqWalkMatch[1]));
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Deals API server listening on port ${PORT}`);
  console.log(`  POST /api/deals`);
  console.log(`  GET  /api/deals/:id`);
  console.log(`  POST /api/deals/:id/mark-paid`);
  console.log(`  POST /api/deals/:id/contract`);
  console.log(`  GET  /api/deals/:id/contract`);
  console.log(`  POST /api/deals/:id/verification`);
  console.log(`  POST /api/deal-requests`);
  console.log(`  GET  /api/deal-requests?status=&buyerUserId=`);
  console.log(`  GET  /api/deal-requests/:id`);
  console.log(`  POST /api/deal-requests/:id/expire`);
  console.log(`  POST /api/deal-requests/:id/negotiation`);
  console.log(`  GET  /api/deal-engagement`);
  console.log(`  PUT  /api/deal-engagement`);
  console.log(`  POST /api/deal-requests/:id/bids`);
  console.log(`  GET  /api/deal-requests/:id/bids`);
  console.log(`  GET  /api/deal-requests/:id/bids/:bidId`);
  console.log(`  GET  /api/deal-requests/:id/market`);
  console.log(`  GET  /api/dealer-bids?dealerUserId=`);
  console.log(`  GET  /api/dealer-won-deals?dealerUserId=`);
  console.log(`  GET  /api/dealer-responsiveness?dealerName=`);
  console.log(`  POST /api/rfqs`);
  console.log(`  GET  /api/rfqs?buyerUserId=`);
  console.log(`  GET  /api/rfqs/:id`);
  console.log(`  POST /api/rfqs/:id/invites`);
  console.log(`  POST /api/rfqs/:id/invites/:inviteId/decline`);
  console.log(`  POST /api/rfqs/:id/invites/:inviteId/quotes`);
  console.log(`  POST /api/rfqs/:id/pick`);
  console.log(`  POST /api/rfqs/:id/walk`);
  console.log(`  (rfq_events logs rfq_invited/quote_received/quote_incomplete/buyer_picked/buyer_walked/desk_declined — no read endpoint; query the table directly)`);
  console.log(`  POST /api/inventory/bulk`);
  console.log(`  POST /api/inventory/sweep`);
  console.log(`  GET  /api/inventory?dealerId=&state=&make=&model=&cond=&q=&inStock=1&limit=&offset=&sort=`);
  console.log(`  GET  /api/inventory/stats`);
console.log(`  GET  /api/inventory/by-listing-url?url=`);
  console.log(`  POST /api/ops/crawl-claims/seed`);
  console.log(`  POST /api/ops/crawl-claims/claim-specific`);
  console.log(`  POST /api/ops/crawl-claims/claim`);
  console.log(`  POST /api/ops/crawl-claims/heartbeat`);
  console.log(`  POST /api/ops/crawl-claims/release`);
  console.log(`  GET  /api/ops/crawl-claims/status?runDate=&brandSet=`);
  console.log(`  GET  /health`);
  console.log(`All routes require header X-Trimscout-Api-Key.`);
});
