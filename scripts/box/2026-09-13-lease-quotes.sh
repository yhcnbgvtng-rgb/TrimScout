#!/usr/bin/env bash
# Lease-quote flow on the deals API: rfq_requests.lease_prefs_json (what the
# buyer asked for) and rfq_quotes.lease_json (the dealer's structured
# calculator), accepted on create/submit and returned on read.
#
# Run on the box as ubuntu:
#   bash 2026-09-13-lease-quotes.sh
# Idempotent: every piece applies only if absent. Backup, exact-replace with
# asserts, node --check, pm2 restart, curl check.
set -euo pipefail
FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    n = s.count(old); assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:160]}"
    s = s.replace(old, new); changed.append(label)

if "lease_prefs_json" not in s:
    rep('''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS deal_reference VARCHAR(16) NULL");''',
        '''  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS deal_reference VARCHAR(16) NULL");
  await pool.query("ALTER TABLE rfq_requests ADD COLUMN IF NOT EXISTS lease_prefs_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS lease_json TEXT NULL");''', "columns")
    rep('''    dealReference: row.deal_reference || null,
  };
}''', '''    dealReference: row.deal_reference || null,
    leasePrefs: parseJsonCol(row.lease_prefs_json) || null,
  };
}''', "rfq mapper")
    rep('''    mustHaveAcknowledgement: Boolean(row.must_have_acknowledgement),
    notes: row.notes,
  };
}''', '''    mustHaveAcknowledgement: Boolean(row.must_have_acknowledgement),
    notes: row.notes,
    lease: typeof row.lease_json === "string" ? JSON.parse(row.lease_json) : row.lease_json || null,
  };
}''', "quote mapper")
    rep('''    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status, package_kind, link_pastes_json, deal_reference)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?)`,
    [buyerUserId, vin, stockNumber, vehicleYear, vehicleMake, vehicleModel, vehicleTrim, JSON.stringify(mustHaves), packageKind, linkPastes.length ? JSON.stringify(linkPastes) : null, dealReference]''',
        '''    `INSERT INTO rfq_requests (buyer_user_id, vin, stock_number, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, must_haves_json, status, package_kind, link_pastes_json, deal_reference, lease_prefs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?)`,
    [buyerUserId, vin, stockNumber, vehicleYear, vehicleMake, vehicleModel, vehicleTrim, JSON.stringify(mustHaves), packageKind, linkPastes.length ? JSON.stringify(linkPastes) : null, dealReference, body.leasePrefs && typeof body.leasePrefs === "object" ? JSON.stringify(body.leasePrefs) : null]''', "rfq insert")
    rep('''  const notes = body.notes ? String(body.notes).trim() : null;

  const pool = getPool();
  const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);''',
        '''  const notes = body.notes ? String(body.notes).trim() : null;
  // The structured lease calculator, validated by the Next.js route before
  // it gets here; stored whole so the buyer's compare reads exactly what
  // the dealer entered.
  const leaseJson = body.lease && typeof body.lease === "object" ? JSON.stringify(body.lease) : null;

  const pool = getPool();
  await ensureQuotePackageColumns(pool);
  const [rfqRows] = await pool.query("SELECT * FROM rfq_requests WHERE id = ?", [rfqId]);''', "quote body")
    rep('''      `INSERT INTO rfq_quotes (rfq_id, invite_id, dealer_name, price, fees_json, total_otd_price, vin, stock_number, expires_at, must_have_acknowledgement, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rfqId, inviteId, inviteRows[0].dealer_name, price, JSON.stringify(fees), totalOtdPrice, vin, stockNumber, new Date(expiresAt), mustHaveAcknowledgement, notes]''',
        '''      `INSERT INTO rfq_quotes (rfq_id, invite_id, dealer_name, price, fees_json, total_otd_price, vin, stock_number, expires_at, must_have_acknowledgement, notes, lease_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rfqId, inviteId, inviteRows[0].dealer_name, price, JSON.stringify(fees), totalOtdPrice, vin, stockNumber, new Date(expiresAt), mustHaveAcknowledgement, notes, leaseJson]''', "quote insert")
open(p, "w").write(s)
print("patched:", p, "| applied:", ", ".join(changed) or "nothing (already present)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api
sleep 3
echo "--- route check (expect 401 without key; the process is up) ---"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3004/health
sudo pm2 logs trimscout-deals-api --lines 5 --nostream | tail -5
