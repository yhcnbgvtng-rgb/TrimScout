// Client for the cross-box crawl claim queue (deals_api_server.js's
// /api/ops/crawl-claims/* endpoints, added 2026-09-25) — dynamic
// work-stealing for the nightly crawl fleet.
//
// Why this exists: real measurement (docs/CAPACITY_SLA.md) found box 1
// (2 vCPU) runs at 77.4s/rooftop vs box 2's (4 vCPU) 16.2s/rooftop, a 4.8x
// gap driven by concurrency-per-vCPU oversubscription, not state
// assignment. A STATIC split sized to be "fair by wall-clock time"
// therefore gives box 1 only a sliver of the workload — it finishes in
// ~2h and sits idle the rest of the night while box 2/3/4 grind for many
// more hours. This module lets any box, once its own locally-assigned
// states are done, keep claiming more states from a shared pool (seeded
// once per run, one row per state) until its own budget runs out — actual
// fleet throughput balances the work, not a number computed hours before
// the run started.
//
// Updated 2026-09-25 (second pass) after a fresh spec pointed out that a
// box's own statically-assigned states should be HINTS, not reservations:
// the first version of this module pre-claimed a box's own list at seed
// time, which meant an overloaded box's not-yet-started states were
// unstealable by a faster peer until that box actually got to (or gave up
// on) them — the exact "slow box hoards work it can't finish quickly
// enough" pattern this whole system exists to fix. Now EVERY state, local
// or stolen, is claimed one at a time right before it runs
// (claimSpecificState for a box's own list, claimNextState once that list
// is exhausted) — a box's local list is just the ORDER it tries claims in,
// never a lock on those rows. See run-daily-crawl.mjs's claimLocalStateFn.
//
// Used from run-daily-crawl.mjs via runStatesWithBoundedConcurrency's
// optional claimLocalStateFn/claimNextStateFn — see those options' own
// comments.

import os from 'node:os';

const DEALS_HOST = process.env.TRIMSCOUT_DEALS_HOST || '3.208.49.1';
const DEALS_PORT = process.env.TRIMSCOUT_DEALS_PORT || '3004';
const KEY = process.env.TRIMSCOUT_API_KEY || process.env.LIGHTSAIL_API_KEY;

// Identifies this box+run in claimed_by, the same recognizable-in-a-log
// shape as inventory-sync.mjs's LOCK_OWNER — not used for anything but
// display/debugging and the release-must-match-claimant check.
export const CLAIM_OWNER = `${os.hostname()}-${process.pid}`;

async function api(path, body) {
  const res = await fetch(`http://${DEALS_HOST}:${DEALS_PORT}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Trimscout-Api-Key': KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${(json && json.error) || ''}`);
  return json;
}

/**
 * Idempotent: safe to call from every box's run, or more than once from
 * the same box. A row that already exists for (runDate, brandSet, state)
 * — whether seeded by this box or a peer, claimed, or already done — is
 * never touched. Every state seeds as plain 'unclaimed', including a
 * box's own statically-assigned list — seeding never reserves anything;
 * see claimSpecificState for how a box actually secures one of its own
 * states right before running it.
 *
 * `units` is `{ state: { rooftopCount, estimatedSeconds } }` — see
 * src/capacity.js's estimatedSecondsForState() for how the caller should
 * derive estimatedSeconds (rooftops * a reference rate, boosted for a
 * known-high-WAF state). estimatedSeconds ranks the queue (longest job
 * first — see the `claim` endpoint's ORDER BY); rooftopCount is what a
 * claimer's own maxRooftops budget-fit check compares against, so a fit
 * check always reflects the CLAIMING box's own rate, never whichever
 * box's rate happened to seed the queue first.
 */
export async function seedClaims({ runDate, brandSet, units }) {
  if (!KEY) throw new Error('seedClaims: TRIMSCOUT_API_KEY (or LIGHTSAIL_API_KEY) is required');
  const states = Object.entries(units).map(([state, u]) => ({
    state,
    rooftopCount: u.rooftopCount,
    estimatedSeconds: u.estimatedSeconds,
  }));
  if (!states.length) return { seeded: 0 };
  const res = await api('/api/ops/crawl-claims/seed', { runDate, brandSet, states });
  return { seeded: res.seeded };
}

/**
 * Atomically claims ONE specific state (a box's own statically-hinted
 * next state, tried in the box's own list order) — returns true if this
 * box just won it, false if it's already claimed/done (by this box in an
 * earlier attempt this run, or — the whole point — by a faster peer that
 * got there first). false is never an error: it means "don't run this
 * one, someone else already is (or will)." Fails soft, like
 * claimNextState: any backend trouble reads as "didn't get it" rather
 * than crashing an otherwise-healthy run.
 */
export async function claimSpecificState({ runDate, brandSet, state }) {
  try {
    const res = await api('/api/ops/crawl-claims/claim-specific', { runDate, brandSet, state, owner: CLAIM_OWNER });
    return Boolean(res.claimed);
  } catch {
    return false;
  }
}

/**
 * Claims the longest-estimated-job still-unclaimed state that fits within
 * maxRooftops (when given — always pass the caller's real remaining-
 * budget estimate; see run-daily-crawl.mjs's claimNextStateFn), or null
 * when nothing is claimable right now (either genuinely none left, or
 * nothing small enough fits the time remaining). Longest-first (added
 * 2026-09-25): the server ranks candidates by estimatedSeconds, not raw
 * rooftop count, so a state that's disproportionately slow (a known-high-
 * WAF state — see HIGH_WAF_STATES in capacity.js) gets claimed early in
 * the night, while there's still a full budget's worth of headroom to
 * absorb it running long, rather than being whatever's left over at 4am.
 * A box whose remaining budget can only fit small jobs (maxRooftops low —
 * exactly a slow/nearly-out-of-budget box's situation) still only ever
 * gets offered candidates that satisfy that fit filter, so a fast box
 * with a huge remaining budget never gets locked out of the big states —
 * it's naturally the boxes that CAN'T fit big work that end up claiming
 * the small leftovers, not an explicit reservation rule. Fails soft: any
 * backend trouble reads as "nothing to steal" rather than crashing an
 * otherwise-healthy run.
 */
export async function claimNextState({ runDate, brandSet, maxRooftops = null }) {
  try {
    const res = await api('/api/ops/crawl-claims/claim', { runDate, brandSet, owner: CLAIM_OWNER, maxRooftops });
    return res.claimed || null;
  } catch {
    return null;
  }
}

/** Fire-and-forget — a missed heartbeat just means CRAWL_CLAIM_STALE_MS (90min) later than ideal reclaim. */
export function heartbeatClaim({ runDate, brandSet, state }) {
  return api('/api/ops/crawl-claims/heartbeat', { runDate, brandSet, state, owner: CLAIM_OWNER }).catch(() => {});
}

/**
 * status: 'done' (terminal) or anything else -> released back to 'unclaimed' so a peer can retry it
 * tonight instead of the state silently never running. Best-effort — never let a release failure mask
 * whatever real result/error the caller already has.
 */
export function releaseClaim({ runDate, brandSet, state, status }) {
  return api('/api/ops/crawl-claims/release', { runDate, brandSet, state, owner: CLAIM_OWNER, status }).catch(() => {});
}

export async function claimsStatus({ runDate, brandSet }) {
  return api(`/api/ops/crawl-claims/status?runDate=${runDate}&brandSet=${brandSet}`);
}
