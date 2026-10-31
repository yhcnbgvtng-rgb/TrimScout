// The buyer's "Accept and share my info" confirm step. Nothing that releases the buyer's details (the stage route's accept_final,
// which emails the winning dealer) or picks a winner runs until the buyer confirms; "Go back" runs nothing. The gate is a tiny
// state machine so the rule is testable without a DOM: request() parks the action, only confirm() runs it, cancel() drops it.

export const ACCEPT_SHARE_BUTTON = "Accept and share my info";
export const ACCEPT_SHARE_CANCEL = "Go back";
export const CONTACT_SHARED_LINE = "Your contact info is shared only with the dealer you choose.";

export const ACCEPT_CONTINUE_BUTTON = "Continue";

/** "early": choosing a quote / accepting the price, nothing is released yet. "final": Accept final deal, the release itself. */
export type AcceptMode = "early" | "final";

export const acceptShareBody = (dealerName: string, mode: AcceptMode = "final"): string =>
  mode === "early"
    ? `Nothing is shared yet. When you accept the final deal, your name, phone and email go to ${dealerName} only, and they'll contact you directly. Other dealers won't get your info.`
    : `Accepting shares your name, phone and email with ${dealerName} only. They'll contact you directly to finish the deal. Other dealers won't get your info.`;

/** `guest`: no signed-in session; `email` is then the guest's own address, the only thing accept_final releases. */
export interface ShareContact { name?: string | null; phone?: string | null; email?: string | null; guest?: boolean }

/** The email of a guest-owned request ("guest:<email>" buyer id), or null for a signed-in buyer's. */
export function guestEmailFromBuyerId(id: string | null | undefined): string | null {
  const e = typeof id === "string" && id.startsWith("guest:") ? id.slice(6).trim() : "";
  return e || null;
}

/** "Your email pat@outlook.com goes to Smith Ford" — the guest's confirm line. Null when no email is on file. */
export const guestShareLine = (email: string | null | undefined, dealerName: string): string | null => {
  const e = (email ?? "").trim();
  return e ? `Your email ${e} goes to ${dealerName}` : null;
};

export interface SharedField { key: "name" | "phone" | "email"; label: string; value: string | null }

const clean = (v: string | null | undefined): string | null => (v ?? "").trim() || null;

/** The three fields the dealer will receive, in full; `value` is null when we have nothing on file for it. */
export function sharedFields(c: ShareContact | null | undefined): SharedField[] {
  return [
    { key: "name", label: "Name", value: clean(c?.name) },
    { key: "phone", label: "Phone", value: clean(c?.phone) },
    { key: "email", label: "Email", value: clean(c?.email) },
  ];
}

export interface AcceptGate<T> {
  /** The parked action's dealer, or null when no dialog is open. */
  pending(): { dealerName: string; mode: AcceptMode } | null;
  /** Open the dialog. Runs nothing. */
  request(dealerName: string, action: () => T | Promise<T>, mode?: AcceptMode): void;
  /** "Accept and share my info": run the parked action once. */
  confirm(): Promise<T | undefined>;
  /** "Go back": drop the parked action. Runs nothing. */
  cancel(): void;
}

export function createAcceptGate<T = void>(onChange: () => void = () => {}): AcceptGate<T> {
  let parked: { dealerName: string; mode: AcceptMode; action: () => T | Promise<T> } | null = null;
  return {
    pending: () => (parked ? { dealerName: parked.dealerName, mode: parked.mode } : null),
    request(dealerName, action, mode = "early") { parked = { dealerName, mode, action }; onChange(); },
    async confirm() {
      const p = parked;
      parked = null;
      onChange();
      return p ? await p.action() : undefined;
    },
    cancel() { parked = null; onChange(); },
  };
}
