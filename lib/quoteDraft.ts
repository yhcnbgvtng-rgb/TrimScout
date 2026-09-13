/**
 * The quote-request wizard's in-progress state, parked in sessionStorage
 * across an auth round-trip. A buyer who reaches Step 2 and only then signs
 * in (or creates an account, or goes through Google's consent page — all
 * full-page navigations) must land back on Step 2 with the vehicle, the
 * prefs and the desks exactly as they left them. The draft is written the
 * moment they click Sign in / Sign up from inside the wizard, read once on
 * the next mount, then cleared; it is never used to auto-submit anything.
 *
 * Pure helpers over a Storage-like object so this is testable without a
 * browser. Anything not JSON-serialisable (lookups, pending panels, busy
 * flags) is deliberately not part of the draft — it's re-derived.
 */
export const QUOTE_DRAFT_KEY = "trimscout.quoteDraft.v1";
/** A draft older than this is stale: the buyer walked away, not round-tripped. */
export const QUOTE_DRAFT_TTL_MS = 60 * 60 * 1000;

export interface QuoteDraft {
  version: 1;
  savedAt: number;
  step: number;
  /** Why the draft exists — only ever an auth hop for now. */
  reason: "sign_in" | "sign_up" | "switch_account";
  state: Record<string, unknown>;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(explicit?: StorageLike | null): StorageLike | null {
  if (explicit) return explicit;
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function saveQuoteDraft(
  draft: Omit<QuoteDraft, "version" | "savedAt">,
  store?: StorageLike | null
): boolean {
  const s = storage(store);
  if (!s) return false;
  try {
    s.setItem(QUOTE_DRAFT_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), ...draft } satisfies QuoteDraft));
    return true;
  } catch {
    return false;
  }
}

/** Read the draft if one exists and is fresh; a stale or unreadable one is discarded. */
export function readQuoteDraft(store?: StorageLike | null, now = Date.now()): QuoteDraft | null {
  const s = storage(store);
  if (!s) return null;
  try {
    const raw = s.getItem(QUOTE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QuoteDraft>;
    if (parsed.version !== 1 || typeof parsed.savedAt !== "number" || typeof parsed.step !== "number" || !parsed.state || typeof parsed.state !== "object") {
      s.removeItem(QUOTE_DRAFT_KEY);
      return null;
    }
    if (now - parsed.savedAt > QUOTE_DRAFT_TTL_MS) {
      s.removeItem(QUOTE_DRAFT_KEY);
      return null;
    }
    return parsed as QuoteDraft;
  } catch {
    try {
      s.removeItem(QUOTE_DRAFT_KEY);
    } catch {
      // nothing to clean
    }
    return null;
  }
}

export function clearQuoteDraft(store?: StorageLike | null): void {
  const s = storage(store);
  if (!s) return;
  try {
    s.removeItem(QUOTE_DRAFT_KEY);
  } catch {
    // nothing to clean
  }
}

/** Header link set for the wizard chrome, by who's signed in. */
export type WizardAuthState = "signed_out" | "buyer" | "not_buyer";

export function wizardAuthState(user: { role?: string } | null | undefined): WizardAuthState {
  if (!user) return "signed_out";
  return user.role === "buyer" ? "buyer" : "not_buyer";
}
