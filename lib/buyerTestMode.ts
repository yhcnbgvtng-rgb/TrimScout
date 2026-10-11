/**
 * BUYER_TEST_MODE_EMAILS — buyer test mode, for the owner's own account(s) only.
 *
 * A comma-separated list of account emails. Off by default (unset / empty / junk = nobody). For a listed
 * signed-in account the server:
 *   - lifts the one-active-request limit,
 *   - accepts the account as a buyer whatever its stored role (an admin can test the buyer flow without
 *     being signed out of it),
 *   - flags every RFQ it creates audit=1 on the box (left out of metrics) and keeps its dealer email on
 *     SAFE MODE (lib/inviteOutbox.ts treats rfq.audit like the audit key's auditForcedSafeMode).
 *
 * The list is read on the server only. The browser learns "you are in test mode" from the session
 * (auth.ts sets session.user.testMode), never from the list, and every route re-derives it from the session.
 */
import { env } from "node:process";

type EnvSource = Record<string, string | undefined>;

export function buyerTestEmails(source: EnvSource = env as EnvSource): string[] {
  return (source.BUYER_TEST_MODE_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(e));
}

export function isBuyerTestMode(user: { email?: string | null } | null | undefined, source?: EnvSource): boolean {
  const email = (user?.email || "").trim().toLowerCase();
  return email !== "" && buyerTestEmails(source).includes(email);
}

/** The one-active-request rule: bites a normal buyer, never a test-mode account. */
export function blocksSecondRequest(existing: { status: string }[], testMode: boolean): boolean {
  return !testMode && existing.some((r) => r.status === "collecting");
}

/** Test mode must never leave an unflagged request behind: if the box did not store audit=1, the app closes it and refuses. */
export function testRequestIsFlagged(rfq: { audit?: boolean }): boolean {
  return rfq.audit === true;
}

/** True for a request the box flagged audit=1 (test mode or the audit key): stays on SAFE MODE and out of metrics. */
export function rfqIsTestOrAudit(rfq: { audit?: boolean; auditForcedSafeMode?: boolean }): boolean {
  return Boolean(rfq.audit || rfq.auditForcedSafeMode);
}
