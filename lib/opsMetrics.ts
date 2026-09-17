/**
 * Per-instance counters for the ops endpoint (/api/admin/ops) and the
 * runbook. In-memory on purpose — cheap, no vendor — so read them as "this
 * instance since it woke", and lean on Vercel's own request/error graphs
 * for fleet-wide truth. What they answer: is the write path being hit, is
 * email failing, are stickers hitting cache, how often are we saying 429.
 */
export type OpsCounter =
  | "rfq_create"
  | "rfq_create_idempotent"
  | "rfq_create_429"
  | "rfq_create_off"
  | "invite_queued"
  /** Queued with no address — the rooftop has no named contact and no shared inbox on file; ops routes it. */
  | "invite_unassigned"
  | "invite_429"
  | "email_sent"
  | "email_failed"
  | "email_parked_switch_off"
  /** An invite the outbox refused because its request hasn't been approved by an admin. */
  | "email_held_for_approval"
  | "rfq_approved"
  | "rfq_rejected"
  | "sticker_cache_hit"
  | "sticker_fetch"
  | "sticker_pending"
  | "sticker_breaker_open"
  | "drain_run"
  | "http_503";

const counts = new Map<OpsCounter, number>();
const startedAt = Date.now();

export function bump(counter: OpsCounter, by = 1): void {
  counts.set(counter, (counts.get(counter) || 0) + by);
}

export function opsSnapshot(): { startedAt: string; uptimeSec: number; counters: Record<string, number> } {
  const counters: Record<string, number> = {};
  for (const [k, v] of counts) counters[k] = v;
  return { startedAt: new Date(startedAt).toISOString(), uptimeSec: Math.round((Date.now() - startedAt) / 1000), counters };
}

/** Test-only. */
export function resetOpsMetricsForTests(): void {
  counts.clear();
}
