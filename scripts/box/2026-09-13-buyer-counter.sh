#!/usr/bin/env bash
# Deals API: buyer counter on a lease quote.
#   rfq_invites.buyer_counter_json / buyer_counter_at — the buyer's scoped
#   response to one dealer quote (target monthly, max due at signing,
#   term/miles, note). POST /api/rfqs/:id/invites/:inviteId/buyer-counter
#   stores it, marks the current quote superseded and reopens the invite so
#   the dealer can re-quote through the calculator.
#   rfq_quotes.superseded_at — prior versions stay for history; the invite's
#   `quote` is the latest live one, `priorQuotes` the rest.
#
# Run on the box as ubuntu:
#   bash 2026-09-13-buyer-counter.sh
# Idempotent. Backup, exact-replace with asserts, node --check, pm2 restart.
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

if "buyer_counter_json" not in s:
    rep('''  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS lease_json TEXT NULL");''',
        '''  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS lease_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS superseded_at DATETIME NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS buyer_counter_json TEXT NULL");
  await pool.query("ALTER TABLE rfq_invites ADD COLUMN IF NOT EXISTS buyer_counter_at DATETIME NULL");''', "columns")
    rep('''    lease: typeof row.lease_json === "string" ? JSON.parse(row.lease_json) : row.lease_json || null,
  };
}''', '''    lease: typeof row.lease_json === "string" ? JSON.parse(row.lease_json) : row.lease_json || null,
    supersededAt: row.superseded_at || null,
  };
}''', "quote mapper")
    rep('''    // Server-to-server only: the Next.js send path builds the tracked link
    // from this and strips it before anything reaches a browser.
    viewToken: row.view_token || null,
  };
}''', '''    // Server-to-server only: the Next.js send path builds the tracked link
    // from this and strips it before anything reaches a browser.
    viewToken: row.view_token || null,
    // The buyer's scoped counter to this desk's last quote, if any.
    buyerCounter: parseJsonCol(row.buyer_counter_json) || null,
    buyerCounterAt: row.buyer_counter_at || null,
    priorQuotes: Array.isArray(row.__priorQuotes) ? row.__priorQuotes : [],
  };
}''', "invite mapper")
    rep('''  const quoteByInvite = new Map(quoteRows.map((q) => [q.invite_id, q]));
  return inviteRows.map((r) => publicRfqInvite(r, quoteByInvite.get(r.id) || null));''',
        '''  // Latest live quote per invite; superseded versions ride along for history.
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
  return inviteRows.map((r) => publicRfqInvite({ ...r, __priorQuotes: priorByInvite.get(r.id) || [] }, liveByInvite.get(r.id) || null));''', "quote versions")
    rep('''// GET /api/rfq-invites/by-token/:token — resolves a tracked-link token.''',
        '''// POST /api/rfqs/:id/invites/:inviteId/buyer-counter — { counter }. The
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

// GET /api/rfq-invites/by-token/:token — resolves a tracked-link token.''', "counter handler")
    rep('''  const rfqInviteDeclineMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/decline$/);''',
        '''  const rfqInviteCounterMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/buyer-counter$/);
  if (req.method === "POST" && rfqInviteCounterMatch) {
    return run(handleBuyerCounter, Number(rfqInviteCounterMatch[1]), Number(rfqInviteCounterMatch[2]));
  }
  const rfqInviteDeclineMatch = pathname.match(/^\\/api\\/rfqs\\/(\\d+)\\/invites\\/(\\d+)\\/decline$/);''', "route")
open(p, "w").write(s)
print("patched:", p, "| applied:", ", ".join(changed) or "nothing (already present)")
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-deals-api
sleep 3
echo "--- process up? (401 = up, key required) ---"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3004/health
