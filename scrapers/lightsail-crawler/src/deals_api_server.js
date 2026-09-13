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
  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS lease_json TEXT NULL");
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
  return require("crypto").randomBytes(24).toString("base64url");
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
  const quoteByInvite = new Map(quoteRows.map((q) => [q.invite_id, q]));
  return inviteRows.map((r) => publicRfqInvite(r, quoteByInvite.get(r.id) || null));
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

  if (!buyerUserId) return badRequest(res, "buyerUserId is required");
  if (!vin) return badRequest(res, "vin is required");
  if (!Number.isFinite(vehicleYear) || vehicleYear <= 0) return badRequest(res, "Invalid vehicleYear");
  if (!vehicleMake || !vehicleModel) return badRequest(res, "vehicleMake and vehicleModel are required");
  if (packageKind === "match") {
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
    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status, package_kind, link_pastes_json, deal_reference, lease_prefs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?)`,
    [buyerUserId, vin, stockNumber, vehicleYear, vehicleMake, vehicleModel, vehicleTrim, JSON.stringify(mustHaves), packageKind, linkPastes.length ? JSON.stringify(linkPastes) : null, dealReference, body.leasePrefs && typeof body.leasePrefs === "object" ? JSON.stringify(body.leasePrefs) : null]
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
  if (!buyerUserId) return badRequest(res, "buyerUserId is required");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query(
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
    [rfqId, dealerName, dealerContactEmail, desk ? JSON.stringify(desk) : null, vehicle ? JSON.stringify(vehicle) : null, viewToken]
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
  const [fresh] = await pool.query("SELECT * FROM rfq_invites WHERE id = ?", [inviteId]);
  sendJson(res, 200, { invite: publicRfqInvite(fresh[0], null) });
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
      `INSERT INTO rfq_quotes (rfq_id, invite_id, dealer_name, price, fees_json, total_otd_price, vin, stock_number, expires_at, must_have_acknowledgement, notes, lease_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rfqId, inviteId, inviteRows[0].dealer_name, price, JSON.stringify(fees), totalOtdPrice, vin, stockNumber, new Date(expiresAt), mustHaveAcknowledgement, notes, leaseJson]
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
  const rfqInviteTokenMatch = pathname.match(/^\/api\/rfq-invites\/by-token\/([A-Za-z0-9_-]{8,80})$/);
  if (req.method === "GET" && rfqInviteTokenMatch) {
    return run(handleRfqInviteByToken, rfqInviteTokenMatch[1]);
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
  console.log(`  GET  /health`);
  console.log(`All routes require header X-Trimscout-Api-Key.`);
});
