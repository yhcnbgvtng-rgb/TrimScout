/**
 * Polling pace for the trade-in draft (photos added on the phone). The old fixed 6 s interval ran for as long as the step was open,
 * hidden tabs included (361 calls in a few minutes). Now: the gap doubles each time nothing changed (and after an error), is capped,
 * resets when the photos change, and the hook only schedules a poll while the page is visible.
 */
export const DRAFT_POLL_BASE_MS = 6_000;
export const DRAFT_POLL_MAX_MS = 60_000;

/** Delay before the next poll, given how many polls in a row found nothing new (0 = just changed / just started). */
export function nextPollDelay(quietPolls: number): number {
  const n = Number.isFinite(quietPolls) ? Math.max(0, Math.floor(quietPolls)) : 0;
  return Math.min(DRAFT_POLL_BASE_MS * 2 ** n, DRAFT_POLL_MAX_MS);
}

/** A stable fingerprint of the photo list, so "changed" means a photo was added, replaced or removed. */
export function photosSignature(photos: Array<{ slot: string; storageKey?: string; uploadedAt?: string | null }> | undefined): string {
  return JSON.stringify((photos || []).map((p) => [p.slot, p.storageKey ?? "", p.uploadedAt ?? ""]).sort());
}
