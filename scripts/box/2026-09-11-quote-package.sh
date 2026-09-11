#!/usr/bin/env bash
# Quote Request Package (v1 core loop) on the deals API.
#
# Run on the box as ubuntu:   bash 2026-09-11-quote-package.sh
#
#   1. timestamped backup of deals_api_server.js
#   2. exact-string patches, each asserting exactly one match (aborts otherwise)
#   3. node --check
#   4. PM2 restart
#   5. health curl
#
# New columns are added by the server itself on first start via
# ADD COLUMN IF NOT EXISTS, using its own DB pool — no mysql login here.
#   rfq_requests: package_kind, link_pastes_json, deal_reference
#   rfq_invites:  desk_json, vehicle_json, delivery_status, queued_at, sent_at, viewed_at, view_token
set -euo pipefail

FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PYEOF'
import sys
path = sys.argv[1]
content = open(path).read()

def replace_once(old, new):
    global content
    n = content.count(old)
    assert n == 1, f"expected exactly 1 match, found {n} for:\n{old[:140]}"
    content = content.replace(old, new, 1)

# ---- 1. Serializers expose the package fields and the delivery leg
replace_once(
"""function publicRfqInvite(row, quoteRow) {
  return {
    id: String(row.id),
    dealerName: row.dealer_name,
    dealerContactEmail: row.dealer_contact_email,
    status: row.status,
    declineReason: row.decline_reason,
    invitedAt: row.invited_at,
    respondedAt: row.responded_at,
    quote: publicRfqQuote(quoteRow),
  };
}""",
"""function parseJsonCol(value) {
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
}""")

replace_once(
"""    mustHaves: typeof row.must_haves_json === "string" ? JSON.parse(row.must_haves_json) : row.must_haves_json,
    invites,
    status: row.status,
    pickedQuoteId: row.picked_quote_id ? String(row.picked_quote_id) : null,
    createdAt: row.created_at,
  };
}""",
"""    mustHaves: typeof row.must_haves_json === "string" ? JSON.parse(row.must_haves_json) : row.must_haves_json,
    invites,
    status: row.status,
    pickedQuoteId: row.picked_quote_id ? String(row.picked_quote_id) : null,
    createdAt: row.created_at,
    packageKind: row.package_kind || "match",
    linkPastes: parseJsonCol(row.link_pastes_json) || [],
    dealReference: row.deal_reference || null,
  };
}""")

# ---- 2. Create: a "links" package has no must-haves and may have no trim.
replace_once(
"""  if (!buyerUserId) return badRequest(res, "buyerUserId is required");
  if (!vin) return badRequest(res, "vin is required");
  if (!Number.isFinite(vehicleYear) || vehicleYear <= 0) return badRequest(res, "Invalid vehicleYear");
  if (!vehicleMake || !vehicleModel || !vehicleTrim) return badRequest(res, "vehicleMake, vehicleModel, and vehicleTrim are required");
  if (mustHaves.length === 0) return badRequest(res, "mustHaves must be non-empty — an RFQ needs at least one locked must-have");
  if (!mustHaves.every((m) => m && m.code && m.name && m.status === "hit")) {
    return badRequest(res, "Every mustHave must be a confirmed hit — never freeze an unconfirmed or missed option into an RFQ");
  }

  const pool = getPool();
  const [result] = await pool.query(
    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting')`,
    [buyerUserId, vin, stockNumber, vehicleYear, vehicleMake, vehicleModel, vehicleTrim, JSON.stringify(mustHaves)]
  );""",
"""  // "links" = the v1 core loop: pasted dealer links, one desk per car, no
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
    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status, package_kind, link_pastes_json, deal_reference)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?)`,
    [buyerUserId, vin, stockNumber, vehicleYear, vehicleMake, vehicleModel, vehicleTrim, JSON.stringify(mustHaves), packageKind, linkPastes.length ? JSON.stringify(linkPastes) : null, dealReference]
  );""")

# ---- 3. Invites: desk + vehicle stored, per-desk open cap across all buyers, queued with a view token.
replace_once(
"""  const body = await readBody(req);
  const dealerName = (body.dealerName || "").trim();
  const dealerContactEmail = body.dealerContactEmail ? String(body.dealerContactEmail).trim() : null;
  if (!dealerName) return badRequest(res, "dealerName is required");

  const pool = getPool();
  const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);
  if (rfqRows.length === 0) return sendJson(res, 404, { error: "RFQ not found" });

  const [activeRows] = await pool.query(
    "SELECT COUNT(*) AS n FROM rfq_invites WHERE rfq_id = ? AND status NOT IN ('declined', 'expired')",
    [rfqId]
  );
  if (activeRows[0].n >= RFQ_MAX_INVITES) {
    return badRequest(res, `An RFQ can invite at most ${RFQ_MAX_INVITES} dealers`);
  }

  const [result] = await pool.query(
    `INSERT INTO rfq_invites (rfq_id, dealer_name, dealer_contact_email, status)
     VALUES (?, ?, ?, 'invited')`,
    [rfqId, dealerName, dealerContactEmail]
  );""",
"""  const body = await readBody(req);
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
  await logRfqEvent(pool, rfqId, "invite_queued", { dealerName, inviteId: result.insertId, vin: vehicle && vehicle.vin ? vehicle.vin : rfqRows[0].vin, stockNumber: rfqRows[0].stock_number, mustHaves: [] });""")

# ---- 4. Delivery leg + token lookup
replace_once(
"""// POST /api/rfqs/:id/invites/:inviteId/decline""",
"""// POST /api/rfqs/:id/invites/:inviteId/delivery — { status: "sent" | "viewed" }.
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

// POST /api/rfqs/:id/invites/:inviteId/decline""")

replace_once(
"""  const rfqInviteDeclineMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/decline$/);""",
"""  const rfqInviteDeliveryMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/delivery$/);
  if (req.method === "POST" && rfqInviteDeliveryMatch) {
    return run(handleRfqInviteDelivery, Number(rfqInviteDeliveryMatch[1]), Number(rfqInviteDeliveryMatch[2]));
  }
  const rfqInviteTokenMatch = pathname.match(/^\\/api\\/rfq-invites\\/by-token\\/([A-Za-z0-9_-]{8,80})$/);
  if (req.method === "GET" && rfqInviteTokenMatch) {
    return run(handleRfqInviteByToken, rfqInviteTokenMatch[1]);
  }
  const rfqInviteDeclineMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/decline$/);""")

# ---- 5. Reads ensure the columns exist too, for rows written before the patch.
replace_once(
"""async function handleGetRfq(req, res, id) {
  const pool = getPool();""",
"""async function handleGetRfq(req, res, id) {
  const pool = getPool();
  await ensureQuotePackageColumns(pool);""")
replace_once(
"""  const buyerUserId = (query.get("buyerUserId") || "").trim();
  if (!buyerUserId) return badRequest(res, "buyerUserId is required");
  const pool = getPool();
  const [rows] = await pool.query(
    "SELECT * FROM rfq_requests WHERE buyer_user_id = ? ORDER BY created_at DESC",""",
"""  const buyerUserId = (query.get("buyerUserId") || "").trim();
  if (!buyerUserId) return badRequest(res, "buyerUserId is required");
  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rows] = await pool.query(
    "SELECT * FROM rfq_requests WHERE buyer_user_id = ? ORDER BY created_at DESC",""")

open(path, "w").write(content)
print("patched:", path)
PYEOF

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api
sleep 2
echo "--- health ---"
curl -s http://127.0.0.1:3004/health || curl -s http://127.0.0.1:3004/ | head -c 200
echo
sudo pm2 logs trimscout-deals-api --lines 12 --nostream | tail -12
