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
// Used from run-daily-crawl.mjs via runStatesWithBoundedConcurrency's
// optional claimNextStateFn — see that function's own comment.

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
 * never touched. `owned` marks THIS box's own statically-assigned states
 * as pre-claimed by it (never stealable by a peer while this box is still
 * working through them); every other state seeds as plain 'unclaimed'.
 */
export async function seedClaims({ runDate, brandSet, rooftopCounts, owned = [] }) {
  if (!KEY) throw new Error('seedClaims: TRIMSCOUT_API_KEY (or LIGHTSAIL_API_KEY) is required');
  const ownedSet = new Set(owned);
  const states = Object.entries(rooftopCounts).map(([state, rooftopCount]) => ({ state, rooftopCount }));
  if (!states.length) return { seeded: 0 };
  const ownedStates = states.filter((s) => ownedSet.has(s.state));
  const otherStates = states.filter((s) => !ownedSet.has(s.state));
  let seeded = 0;
  if (ownedStates.length) {
    seeded += (await api('/api/ops/crawl-claims/seed', { runDate, brandSet, states: ownedStates, preClaimedBy: CLAIM_OWNER })).seeded;
  }
  if (otherStates.length) {
    seeded += (await api('/api/ops/crawl-claims/seed', { runDate, brandSet, states: otherStates })).seeded;
  }
  return { seeded };
}

/**
 * Claims the largest still-unclaimed state that fits within maxRooftops
 * (when given — always pass the caller's real remaining-budget estimate;
 * see run-daily-crawl.mjs's claimNextStateFn), or null when nothing is
 * claimable right now (either genuinely none left, or nothing small
 * enough fits the time remaining). Fails soft: any backend trouble reads
 * as "nothing to steal" rather than crashing an otherwise-healthy run.
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
