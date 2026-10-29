/**
 * SAFE MODE, as far as product state and copy are concerned (pure; safe to import from client code).
 *
 * The override itself lives in lib/dealerEmail.ts: every sender posts to SAFE_MODE_RECIPIENT and has no `to` parameter. This file only
 * says that it is on, so buyer-facing text never claims a dealer was emailed and review subjects name the dealer the mail was meant for.
 * It is a constant on purpose (not env): lift it together with the override in dealerEmail.ts, in one change.
 */
export const SAFE_MODE_ACTIVE = true;

/** "[SAFE MODE · Dealer] subject" while the override is on, so the review inbox shows who the mail was for. */
export function safeModeSubject(dealerName: string, subject: string): string {
  return SAFE_MODE_ACTIVE ? `[SAFE MODE · ${dealerName}] ${subject}` : subject;
}

/** What the buyer's tracker says while the override holds dealer mail back. */
export const SAFE_MODE_HELD_COPY = "Held for review — not yet delivered to the dealer.";
