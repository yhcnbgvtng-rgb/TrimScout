// The buyer's "Accept and share my info" confirm step. Nothing that releases the buyer's details (the stage route's accept_final,
// which emails the winning dealer) or picks a winner runs until the buyer confirms; "Go back" runs nothing. The gate is a tiny
// state machine so the rule is testable without a DOM: request() parks the action, only confirm() runs it, cancel() drops it.

export const ACCEPT_SHARE_BUTTON = "Accept and share my info";
export const ACCEPT_SHARE_CANCEL = "Go back";
export const CONTACT_SHARED_LINE = "Your contact info is shared only with the dealer you choose.";

export const ACCEPT_CONTINUE_BUTTON = "Continue";
export const GUEST_CONTACT_LINE = "We'll ask for your contact info before sharing";

/** "early": choosing a quote / accepting the price, nothing is released yet. "final": Accept final deal, the release itself. */
export type AcceptMode = "early" | "final";

export const acceptShareBody = (dealerName: string, mode: AcceptMode = "final"): string =>
  mode === "early"
    ? `Nothing is shared yet. When you accept the final deal, your name, phone and email go to ${dealerName} only, and they'll contact you directly. Other dealers won't get your info.`
    : `Accepting shares your name, phone and email with ${dealerName} only. They'll contact you directly to finish the deal. Other dealers won't get your info.`;

export interface ShareContact { name?: string | null; phone?: string | null; email?: string | null }

const DOT = "•••";

/** p•••@outlook.com — first letter of the mailbox, the domain in full. */
export function maskEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return null;
  return `${e[0]}${DOT}${e.slice(at)}`;
}

/** •••-•••-0142 — only the last four digits survive. */
export function maskPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `${DOT}-${DOT}-${digits.slice(-4)}`;
}

/** P••• B••• — the first letter of each word. */
export function maskName(name: string | null | undefined): string | null {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return words.map((w) => `${w[0]}${DOT}`).join(" ");
}

export interface SharedField { key: "name" | "phone" | "email"; label: string; masked: string | null }

/** The three fields the dealer will receive, masked; `masked` is null when we have nothing on file for it. */
export function sharedFields(c: ShareContact | null | undefined): SharedField[] {
  return [
    { key: "name", label: "Name", masked: maskName(c?.name) },
    { key: "phone", label: "Phone", masked: maskPhone(c?.phone) },
    { key: "email", label: "Email", masked: maskEmail(c?.email) },
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
