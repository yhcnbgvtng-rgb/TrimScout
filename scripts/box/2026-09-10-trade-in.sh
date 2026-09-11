#!/usr/bin/env bash
# Adds trade-in submission + appraisal to the deals API on the box.
#
# Run on the box as ubuntu:
#   bash 2026-09-10-trade-in.sh
#
# What it does, in order:
#   1. backs up deals_api_server.js with a timestamp
#   2. patches it via exact-string replacement (each replacement asserts it
#      matched exactly once — the script aborts, leaving the backup, otherwise)
#   3. node --check
#   4. restarts the PM2 process
#   5. curls the health endpoint
#
# The two new columns (trade_in_json, trade_in_appraisal_json) are added by
# the server itself the first time it starts after the patch, using its own
# DB pool — so no separate mysql login is needed here.
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
    assert n == 1, f"expected exactly 1 match, found {n} for:\n{old[:120]}"
    content = content.replace(old, new, 1)

# ---- 1. publicDeal exposes the two new JSON columns
replace_once(
"""    verification:
      typeof row.verification_json === "string"
        ? JSON.parse(row.verification_json)
        : row.verification_json || null,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}""",
"""    verification:
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
}""")

# ---- 2. routes
replace_once(
"""  const verificationMatch = pathname.match(/^\\/api\\/deals\\/(\\d+)\\/verification$/);
  if (req.method === "POST" && verificationMatch) {
    return run(handleSaveVerification, Number(verificationMatch[1]));
  }""",
"""  const verificationMatch = pathname.match(/^\\/api\\/deals\\/(\\d+)\\/verification$/);
  if (req.method === "POST" && verificationMatch) {
    return run(handleSaveVerification, Number(verificationMatch[1]));
  }
  const tradeInMatch = pathname.match(/^\\/api\\/deals\\/(\\d+)\\/trade-in$/);
  if (req.method === "POST" && tradeInMatch) {
    return run(handleSubmitTradeIn, Number(tradeInMatch[1]));
  }
  const appraisalMatch = pathname.match(/^\\/api\\/deals\\/(\\d+)\\/trade-in\\/appraisal$/);
  if (req.method === "POST" && appraisalMatch) {
    return run(handleAppraiseTradeIn, Number(appraisalMatch[1]));
  }""")

# ---- 3. won-deals listing carries both, so the dealer portal can show them
replace_once(
"""            d.id AS deal_id, d.paperwork_status, d.contract_file_name, d.verification_json""",
"""            d.id AS deal_id, d.paperwork_status, d.contract_file_name, d.verification_json,
            d.trade_in_json, d.trade_in_appraisal_json, dr.buyer_state""")
replace_once(
"""      verification: typeof r.verification_json === "string" ? JSON.parse(r.verification_json) : r.verification_json || null,
    })),""",
"""      verification: typeof r.verification_json === "string" ? JSON.parse(r.verification_json) : r.verification_json || null,
      tradeIn: parseJsonColumn(r.trade_in_json),
      tradeInAppraisal: parseJsonColumn(r.trade_in_appraisal_json),
      buyerState: r.buyer_state || null,
    })),""")

# ---- 4. make sure the columns exist before the first won-deals SELECT
#         references them (that query runs before either POST handler might).
replace_once(
"""  const pool = getPool();
  // LEFT JOIN deals: a bid can be 'accepted' (the mark-paid cascade sets""",
"""  const pool = getPool();
  await ensureTradeInColumns(pool);
  // LEFT JOIN deals: a bid can be 'accepted' (the mark-paid cascade sets""")

open(path, "w").write(content)
print("patched:", path)
PYEOF

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api
sleep 2
echo "--- health ---"
curl -s http://127.0.0.1:3004/health || curl -s http://127.0.0.1:3004/ | head -c 200
echo
echo "--- won-deals column check (expects no 'Unknown column' error) ---"
sudo pm2 logs trimscout-deals-api --lines 15 --nostream | tail -15
