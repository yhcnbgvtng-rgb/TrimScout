/**
 * "You must be signed in as a buyer." has to lead somewhere. The app's sign-in is the modal on the home page
 * (/?login=1), so the link goes there with a callbackUrl that brings the buyer back to the page they were on.
 */

export const BUYER_ONLY_PATTERN = /must be signed in as a buyer/i;

export function isBuyerOnlyMessage(message: string | null | undefined): boolean {
  return typeof message === "string" && BUYER_ONLY_PATTERN.test(message);
}

/** Only same-site relative paths are honoured; anything else (absolute URLs, //host, backslashes) is dropped. */
export function safeCallbackUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (/[\u0000-\u001f]/.test(raw)) return null;
  return raw;
}

/** The buyer sign-in page: the home page with its sign-in modal open, returning to callbackUrl afterwards. */
export function buyerSignInHref(callbackUrl: string | null | undefined): string {
  const safe = safeCallbackUrl(callbackUrl);
  return safe ? `/?login=1&callbackUrl=${encodeURIComponent(safe)}` : "/?login=1";
}

/**
 * Where to come back to: the current path plus its query, so a selected dealer conversation (?dealer=…) survives
 * when the page keeps it in the URL. The hash is dropped.
 */
export function currentCallbackUrl(pathname: string, search: string): string {
  const q = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `${pathname}${q}`;
}

export type BuyerSignInMode = "sign_in" | "switch_account";

/** Signed out (or role unknown) gets a plain Sign in; any signed-in non-buyer role gets the switch. */
export function buyerSignInMode(role: string | null | undefined): BuyerSignInMode {
  return role && role !== "buyer" ? "switch_account" : "sign_in";
}
