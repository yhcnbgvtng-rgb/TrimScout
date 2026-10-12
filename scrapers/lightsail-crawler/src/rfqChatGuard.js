// The guard around the buyer <-> dealer conversation: strikes, pauses and the admin review queue.
//
//   rfq_chat_attempts  one row per blocked (or held-then-blocked, or reported-then-blocked) message, per dealer. NEVER the text: only who,
//                      where, what kind of reason, and when. The blocked text is never shown to the other party and is not stored here.
//   rfq_chat_review    held messages (the AI check failed or timed out) and messages the buyer reported, waiting for an admin to
//                      Release or Block. This is the only place the text of an undelivered message lives.
//   rfq_chat_pauses    a dealer's chat pause (3 attempts in 30 days). An admin lifts it; attempts before the lift no longer count.
//
// "Dealer" is the rooftop: the invite's dealer_name, lower-cased and trimmed, so a pause covers every deal that dealer is on.
// Pure policy (strikeState) is separate from the SQL so it can be tested on its own. Emails to Paul are the Next app's job (SAFE MODE).

export const STRIKE_LIMIT = 3;
export const STRIKE_WINDOW_DAYS = 30;
export const WINDOW_MS = STRIKE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const BLOCKED_NOTE = "This message wasn't sent because it looks like contact information.";
export const HELD_NOTE = "This message is being reviewed before it's sent.";
export const PAUSED_NOTE = "Chat is paused for your dealership. Contact TrimScout to have it restored.";
export const FIRST_WARNING = "Warning: contact details are shared automatically when the buyer accepts the final deal. Sharing them earlier breaks TrimScout's terms. After 3 attempts in 30 days, chat is paused for your dealership on all deals.";

export const dealerKeyOf = (invite) => String(invite?.dealer_name ?? invite?.dealerName ?? "").trim().toLowerCase();

/**
 * Strikes from a dealer's attempt timestamps. Only attempts inside the window AND after the last time an admin lifted a pause count.
 * `warning` is true on the very first counted attempt; `shouldPause` once the limit is reached.
 */
export function strikeState(attemptTimes, now = new Date(), liftedAt = null) {
  const since = Math.max(now.getTime() - WINDOW_MS, liftedAt ? new Date(liftedAt).getTime() : 0);
  const count = (attemptTimes || []).filter((t) => new Date(t).getTime() > since).length;
  return { count, warning: count === 1, shouldPause: count >= STRIKE_LIMIT };
}

export async function ensureGuardTables(pool) {
  await pool.query("CREATE TABLE IF NOT EXISTS rfq_chat_attempts (id INT AUTO_INCREMENT PRIMARY KEY, dealer_key VARCHAR(190) NOT NULL, side VARCHAR(8) NOT NULL, rfq_id INT NOT NULL, invite_id INT NOT NULL, kind VARCHAR(24) NOT NULL, reason VARCHAR(80) NULL, created_at DATETIME NOT NULL, INDEX (dealer_key, created_at))");
  await pool.query("CREATE TABLE IF NOT EXISTS rfq_chat_review (id INT AUTO_INCREMENT PRIMARY KEY, rfq_id INT NOT NULL, invite_id INT NOT NULL, sender VARCHAR(8) NOT NULL, kind VARCHAR(12) NOT NULL, message_id VARCHAR(40) NULL, text TEXT NOT NULL, reason VARCHAR(80) NULL, status VARCHAR(12) NOT NULL DEFAULT 'pending', reporter VARCHAR(8) NULL, created_at DATETIME NOT NULL, decided_at DATETIME NULL, decided_by VARCHAR(120) NULL, INDEX (status, created_at))");
  await pool.query("CREATE TABLE IF NOT EXISTS rfq_chat_pauses (id INT AUTO_INCREMENT PRIMARY KEY, dealer_key VARCHAR(190) NOT NULL, paused_at DATETIME NOT NULL, reason VARCHAR(120) NULL, lifted_at DATETIME NULL, lifted_by VARCHAR(120) NULL, INDEX (dealer_key))");
}

/** The dealer's latest pause row, or null. */
async function latestPause(pool, dealerKey) {
  const [rows] = await pool.query("SELECT id, paused_at, lifted_at FROM rfq_chat_pauses WHERE dealer_key = ? ORDER BY id DESC LIMIT 1", [dealerKey]);
  return rows[0] || null;
}

export async function isPaused(pool, dealerKey) {
  if (!dealerKey) return false;
  const p = await latestPause(pool, dealerKey);
  return Boolean(p) && !p.lifted_at;
}

/**
 * Logs one attempt. Dealers earn strikes (and a warning on the first, a pause on the third); a buyer's blocked message is logged but never
 * paused or warned. Returns { attempts, warning, paused, justPaused }.
 */
export async function recordAttempt(pool, { dealerKey, side, rfqId, inviteId, kind, reason, now = new Date() }) {
  await pool.query("INSERT INTO rfq_chat_attempts (dealer_key, side, rfq_id, invite_id, kind, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [dealerKey, side, rfqId, inviteId, kind, String(reason || "").slice(0, 80), now]);
  if (side !== "dealer") return { attempts: 0, warning: false, paused: false, justPaused: false };
  const pause = await latestPause(pool, dealerKey);
  const since = new Date(Math.max(now.getTime() - WINDOW_MS, pause?.lifted_at ? new Date(pause.lifted_at).getTime() : 0));
  const [rows] = await pool.query("SELECT created_at FROM rfq_chat_attempts WHERE dealer_key = ? AND side = 'dealer' AND created_at > ? ORDER BY created_at", [dealerKey, since]);
  const s = strikeState(rows.map((r) => r.created_at), now, pause?.lifted_at || null);
  const alreadyPaused = Boolean(pause) && !pause.lifted_at;
  let justPaused = false;
  if (s.shouldPause && !alreadyPaused) {
    await pool.query("INSERT INTO rfq_chat_pauses (dealer_key, paused_at, reason) VALUES (?, ?, ?)", [dealerKey, now, `${s.count} blocked messages in ${STRIKE_WINDOW_DAYS} days`]);
    justPaused = true;
  }
  return { attempts: s.count, warning: s.warning, paused: alreadyPaused || justPaused, justPaused };
}

/** Puts a message in the admin queue ("held": AI unavailable; "reported": the buyer flagged it). A reported message is queued once. */
export async function enqueueReview(pool, { rfqId, inviteId, sender, kind, messageId = null, text, reason, reporter = null, now = new Date() }) {
  if (kind === "reported" && messageId) {
    const [dup] = await pool.query("SELECT id FROM rfq_chat_review WHERE invite_id = ? AND message_id = ? AND kind = 'reported'", [inviteId, messageId]);
    if (dup[0]) return { id: dup[0].id, duplicate: true };
  }
  const [res] = await pool.query("INSERT INTO rfq_chat_review (rfq_id, invite_id, sender, kind, message_id, text, reason, status, reporter, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)", [rfqId, inviteId, sender, kind, messageId, String(text).slice(0, 1000), String(reason || "").slice(0, 80), reporter, now]);
  return { id: res.insertId, duplicate: false };
}
