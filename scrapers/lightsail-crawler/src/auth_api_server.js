#!/usr/bin/env node
// Real user authentication backend for the buyer/dealer portal, on the same
// box as the rest of the DB — mirrors inventory_api_server.js's exact
// pattern (same env loader, same X-Trimscout-Api-Key header, same
// sendJson/badRequest helpers) but against `DB_WRITER_USER`, since this
// server's whole job is creating/updating rows in `users`/`user_accounts`,
// unlike inventory_api_server.js which is deliberately read-only.
//
// The Next.js app (wherever it actually runs — Vercel's serverless
// functions have no fixed outbound IP, so they can't be firewall-allowed
// the way a specific box could be) never touches MariaDB directly for auth
// either, for the same reason inventory data doesn't: it calls this HTTP
// API instead, over the box's already-proven API-key-protected pattern.
//
// Passwords are only ever handled here, hashed with bcrypt before touching
// the database — the plaintext is in transit over HTTPS + the shared API
// key for one request, never logged, never stored.
//
// Run under pm2:
//   pm2 start src/auth_api_server.js --name trimscout-auth-api

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

const PORT = process.env.AUTH_API_PORT || 3003;

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
      if (data.length > 5_000_000) {
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    email: row.email,
    name: row.name,
    role: row.role,
    phone: row.phone,
    zipCode: row.zip_code,
    avatarUrl: row.avatar_url,
    dealerName: row.dealer_name,
    status: row.status,
    createdAt: row.created_at,
    lastLogin: row.last_login_at,
  };
}

// POST /api/auth/signup — email/password account creation.
async function handleSignup(req, res) {
  const body = await readBody(req);
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const name = (body.name || "").trim();
  const role = ["buyer", "dealer"].includes(body.role) ? body.role : "buyer";

  if (!EMAIL_RE.test(email)) return badRequest(res, "Invalid email address");
  if (password.length < 8) return badRequest(res, "Password must be at least 8 characters");
  if (!name) return badRequest(res, "Name is required");

  const pool = getPool();
  const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
  if (existing.length > 0) return sendJson(res, 409, { error: "An account with this email already exists" });

  const passwordHash = await bcrypt.hash(password, 12);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO users (email, password_hash, name, role, phone, zip_code, dealer_name, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [email, passwordHash, name, role, body.phone || null, body.zipCode || null, role === "dealer" ? body.dealerName || null : null]
    );
    const userId = result.insertId;
    await conn.query(
      "INSERT INTO user_accounts (user_id, provider, provider_account_id) VALUES (?, 'credentials', ?)",
      [userId, email]
    );
    await conn.commit();
    const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [userId]);
    sendJson(res, 201, { user: publicUser(rows[0]) });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// POST /api/auth/verify-credentials — email/password sign-in check, called
// from Auth.js's Credentials provider `authorize()`.
async function handleVerifyCredentials(req, res) {
  const body = await readBody(req);
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password) return badRequest(res, "Email and password are required");

  const pool = getPool();
  const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
  const row = rows[0];
  if (!row || !row.password_hash) {
    return sendJson(res, 401, { error: "Invalid email or password" });
  }
  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) return sendJson(res, 401, { error: "Invalid email or password" });
  if (row.status !== "active") return sendJson(res, 403, { error: `Account is ${row.status}` });

  await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [row.id]);
  sendJson(res, 200, { user: publicUser(row) });
}

// GET /api/auth/users — full account listing for the admin portal's
// account-management table. Every field except password_hash, same shape
// as publicUser() elsewhere in this file.
async function handleListUsers(req, res) {
  const pool = getPool();
  const [rows] = await pool.query("SELECT * FROM users ORDER BY created_at DESC");
  sendJson(res, 200, { users: rows.map(publicUser) });
}

// POST /api/auth/admin-reset-password — admin-initiated password reset.
// Trust boundary: the Next.js route calling this has already checked the
// caller's own session has role='admin' before ever making this request;
// this server only re-checks the shared API key like every other route.
async function handleAdminResetPassword(req, res) {
  const body = await readBody(req);
  const email = (body.email || "").trim().toLowerCase();
  const newPassword = body.newPassword || "";
  if (!EMAIL_RE.test(email)) return badRequest(res, "Invalid email address");
  if (newPassword.length < 8) return badRequest(res, "Password must be at least 8 characters");

  const pool = getPool();
  const [rows] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
  if (rows.length === 0) return sendJson(res, 404, { error: "No account with that email" });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, rows[0].id]);
  sendJson(res, 200, { ok: true });
}

// POST /api/auth/admin-set-status — admin suspend/reactivate toggle, since
// verify-credentials already enforces status !== 'active' at sign-in.
async function handleAdminSetStatus(req, res) {
  const body = await readBody(req);
  const email = (body.email || "").trim().toLowerCase();
  const status = body.status;
  if (!["active", "suspended", "pending_verification"].includes(status)) {
    return badRequest(res, "Invalid status");
  }
  const pool = getPool();
  const [result] = await pool.query("UPDATE users SET status = ? WHERE email = ?", [status, email]);
  if (result.affectedRows === 0) return sendJson(res, 404, { error: "No account with that email" });
  const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
  sendJson(res, 200, { user: publicUser(rows[0]) });
}

function publicDealership(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    dealerName: row.dealer_name,
    address: row.address,
    city: row.city,
    state: row.state,
    zipCode: row.zip_code,
    phone: row.phone,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/dealerships — full directory listing.
async function handleListDealerships(req, res) {
  const pool = getPool();
  const [rows] = await pool.query("SELECT * FROM dealership_contacts ORDER BY dealer_name ASC");
  sendJson(res, 200, { dealerships: rows.map(publicDealership) });
}

// POST /api/dealerships/bulk — upsert many rows at once, matched by dealer
// name (case-insensitive). Meant for a manufacturer-contact-crawl export
// (any manufacturer, not just one) uploaded as a spreadsheet — re-uploading
// the same or an updated file is safe and just refreshes matching rows.
async function handleBulkUpsertDealerships(req, res) {
  const body = await readBody(req);
  const list = Array.isArray(body.dealerships) ? body.dealerships : [];
  if (list.length === 0) return badRequest(res, "dealerships must be a non-empty array");
  if (list.length > 10000) return badRequest(res, "Too many rows in one upload (max 10,000)");

  const pool = getPool();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of list) {
    const dealerName = (row.dealerName || "").trim();
    if (!dealerName) {
      skipped++;
      continue;
    }
    const fields = [
      row.address || null,
      row.city || null,
      row.state || null,
      row.zipCode || null,
      row.phone || null,
      row.contactName || null,
      row.contactEmail || null,
      row.notes || null,
    ];
    const [existing] = await pool.query(
      "SELECT id FROM dealership_contacts WHERE LOWER(dealer_name) = LOWER(?) LIMIT 1",
      [dealerName]
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE dealership_contacts SET
           dealer_name = ?, address = ?, city = ?, state = ?, zip_code = ?,
           phone = ?, contact_name = ?, contact_email = ?, notes = ?
         WHERE id = ?`,
        [dealerName, ...fields, existing[0].id]
      );
      updated++;
    } else {
      await pool.query(
        `INSERT INTO dealership_contacts (dealer_name, address, city, state, zip_code, phone, contact_name, contact_email, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [dealerName, ...fields]
      );
      created++;
    }
  }

  sendJson(res, 200, { created, updated, skipped, total: list.length });
}

// POST /api/dealerships — create.
async function handleCreateDealership(req, res) {
  const body = await readBody(req);
  const dealerName = (body.dealerName || "").trim();
  if (!dealerName) return badRequest(res, "dealerName is required");

  const pool = getPool();
  const [result] = await pool.query(
    `INSERT INTO dealership_contacts (dealer_name, address, city, state, zip_code, phone, contact_name, contact_email, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dealerName,
      body.address || null,
      body.city || null,
      body.state || null,
      body.zipCode || null,
      body.phone || null,
      body.contactName || null,
      body.contactEmail || null,
      body.notes || null,
    ]
  );
  const [rows] = await pool.query("SELECT * FROM dealership_contacts WHERE id = ?", [result.insertId]);
  sendJson(res, 201, { dealership: publicDealership(rows[0]) });
}

// PUT /api/dealerships/:id — update.
async function handleUpdateDealership(req, res, id) {
  const body = await readBody(req);
  const pool = getPool();
  const [existing] = await pool.query("SELECT id FROM dealership_contacts WHERE id = ?", [id]);
  if (existing.length === 0) return sendJson(res, 404, { error: "Dealership not found" });

  await pool.query(
    `UPDATE dealership_contacts SET
       dealer_name = ?, address = ?, city = ?, state = ?, zip_code = ?,
       phone = ?, contact_name = ?, contact_email = ?, notes = ?
     WHERE id = ?`,
    [
      (body.dealerName || "").trim(),
      body.address || null,
      body.city || null,
      body.state || null,
      body.zipCode || null,
      body.phone || null,
      body.contactName || null,
      body.contactEmail || null,
      body.notes || null,
      id,
    ]
  );
  const [rows] = await pool.query("SELECT * FROM dealership_contacts WHERE id = ?", [id]);
  sendJson(res, 200, { dealership: publicDealership(rows[0]) });
}

// DELETE /api/dealerships/:id
async function handleDeleteDealership(req, res, id) {
  const pool = getPool();
  const [result] = await pool.query("DELETE FROM dealership_contacts WHERE id = ?", [id]);
  if (result.affectedRows === 0) return sendJson(res, 404, { error: "Dealership not found" });
  sendJson(res, 200, { ok: true });
}

// POST /api/auth/oauth-upsert — called from Auth.js's signIn callback for
// Google/Apple. Finds an existing user by (provider, providerAccountId)
// first, then by email (to link a new provider onto an existing
// credentials/OAuth account with the same address), else creates one.
async function handleOAuthUpsert(req, res) {
  const body = await readBody(req);
  const provider = body.provider;
  const providerAccountId = (body.providerAccountId || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const name = (body.name || "").trim() || email.split("@")[0];
  const avatarUrl = body.avatarUrl || null;

  if (!["google", "apple"].includes(provider)) return badRequest(res, "Invalid provider");
  if (!providerAccountId) return badRequest(res, "Missing providerAccountId");
  if (!EMAIL_RE.test(email)) return badRequest(res, "Invalid email address");

  const pool = getPool();
  const [linked] = await pool.query(
    "SELECT u.* FROM users u JOIN user_accounts ua ON ua.user_id = u.id WHERE ua.provider = ? AND ua.provider_account_id = ?",
    [provider, providerAccountId]
  );
  if (linked.length > 0) {
    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [linked[0].id]);
    return sendJson(res, 200, { user: publicUser(linked[0]) });
  }

  const [byEmail] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let userId;
    if (byEmail.length > 0) {
      userId = byEmail[0].id;
      await conn.query(
        "UPDATE users SET last_login_at = NOW(), avatar_url = COALESCE(avatar_url, ?) WHERE id = ?",
        [avatarUrl, userId]
      );
    } else {
      const [result] = await conn.query(
        `INSERT INTO users (email, name, role, avatar_url, last_login_at) VALUES (?, ?, 'buyer', ?, NOW())`,
        [email, name, avatarUrl]
      );
      userId = result.insertId;
    }
    await conn.query(
      "INSERT INTO user_accounts (user_id, provider, provider_account_id) VALUES (?, ?, ?)",
      [userId, provider, providerAccountId]
    );
    await conn.commit();
    const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [userId]);
    sendJson(res, 200, { user: publicUser(rows[0]) });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

const server = http.createServer((req, res) => {
  if (!requireAuth(req, res)) return;

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  const run = (fn) => {
    fn(req, res).catch((err) => {
      console.error(`${new Date().toISOString()} ${pathname} -> 500:`, err.message);
      sendJson(res, 500, { error: "Internal server error" });
    });
  };

  if (req.method === "GET" && pathname === "/health") {
    return sendJson(res, 200, { status: "ok" });
  }
  if (req.method === "POST" && pathname === "/api/auth/signup") {
    return run(handleSignup);
  }
  if (req.method === "POST" && pathname === "/api/auth/verify-credentials") {
    return run(handleVerifyCredentials);
  }
  if (req.method === "POST" && pathname === "/api/auth/oauth-upsert") {
    return run(handleOAuthUpsert);
  }
  if (req.method === "GET" && pathname === "/api/auth/users") {
    return run(handleListUsers);
  }
  if (req.method === "POST" && pathname === "/api/auth/admin-reset-password") {
    return run(handleAdminResetPassword);
  }
  if (req.method === "POST" && pathname === "/api/auth/admin-set-status") {
    return run(handleAdminSetStatus);
  }
  if (req.method === "GET" && pathname === "/api/dealerships") {
    return run(handleListDealerships);
  }
  if (req.method === "POST" && pathname === "/api/dealerships") {
    return run(handleCreateDealership);
  }
  if (req.method === "POST" && pathname === "/api/dealerships/bulk") {
    return run(handleBulkUpsertDealerships);
  }
  const dealershipMatch = pathname.match(/^\/api\/dealerships\/(\d+)$/);
  if (dealershipMatch && req.method === "PUT") {
    return run((request, response) => handleUpdateDealership(request, response, dealershipMatch[1]));
  }
  if (dealershipMatch && req.method === "DELETE") {
    return run((request, response) => handleDeleteDealership(request, response, dealershipMatch[1]));
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Auth API server listening on port ${PORT}`);
  console.log(`  POST /api/auth/signup`);
  console.log(`  POST /api/auth/verify-credentials`);
  console.log(`  POST /api/auth/oauth-upsert`);
  console.log(`  GET  /api/auth/users`);
  console.log(`  POST /api/auth/admin-reset-password`);
  console.log(`  POST /api/auth/admin-set-status`);
  console.log(`  GET  /api/dealerships`);
  console.log(`  POST /api/dealerships`);
  console.log(`  POST /api/dealerships/bulk`);
  console.log(`  PUT  /api/dealerships/:id`);
  console.log(`  DELETE /api/dealerships/:id`);
  console.log(`  GET  /health`);
  console.log(`All routes require header X-Trimscout-Api-Key.`);
});
