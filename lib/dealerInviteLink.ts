/**
 * Links a quote invite to a dealer ACCOUNT (rfq_invites.dealer_user_id) — the only thing My Quotes lists by.
 * Two moments set it: signup from a quote-email link, and the first time a signed-in dealer opens the token page.
 * Never by dealer-name match. The box write is once-only, so an invite already linked is never re-homed.
 * Best effort by design: a failed link must never break signup or the quote page itself.
 */
import { bindInviteToDealer, getRfqInviteByViewToken } from "./rfqApi";

type Binder = (inviteId: string, dealerUserId: string) => Promise<{ bound: boolean }>;

/** Only a dealer account may own an invite; anything else (buyer, admin, signed out) is ignored. */
export function bindableDealerId(user: { id?: string | null; role?: string | null } | null | undefined): string | null {
  if (!user?.id || user.role !== "dealer") return null;
  return String(user.id);
}

export async function linkInviteToSignedInDealer(inviteId: string, deps: { session?: () => Promise<{ user?: unknown } | null>; bind?: Binder } = {}): Promise<boolean> {
  try {
    // Loaded on demand so tests (which inject the session) never import Auth.js.
    const session = await (deps.session ?? (await import("@/auth")).auth)();
    const dealerId = bindableDealerId(session?.user as { id?: string; role?: string } | undefined);
    if (!dealerId) return false;
    return (await (deps.bind ?? bindInviteToDealer)(inviteId, dealerId)).bound;
  } catch {
    return false;
  }
}

/** Signup from a quote-email link: the new account's id claims the invite the token belongs to. */
export async function linkInviteTokenToNewDealer(token: unknown, dealerUserId: string | null | undefined, deps: { lookup?: typeof getRfqInviteByViewToken; bind?: Binder } = {}): Promise<boolean> {
  try {
    const t = typeof token === "string" ? token.trim() : "";
    if (!dealerUserId || !/^[A-Za-z0-9_-]{8,80}$/.test(t)) return false;
    const found = await (deps.lookup ?? getRfqInviteByViewToken)(t);
    if (!found) return false;
    return (await (deps.bind ?? bindInviteToDealer)(found.invite.id, String(dealerUserId))).bound;
  } catch {
    return false;
  }
}
