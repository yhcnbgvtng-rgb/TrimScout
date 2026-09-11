/**
 * The v1 core loop's data model and rules, as pure functions.
 *
 *   buyer pastes ≤3 dealer links / VINs      → DealerLinkPaste
 *   each resolves to a vehicle + rooftop     → (already: lib/pasteImport.ts)
 *   rooftop cross-referenced to a named desk → DealerDesk
 *   buyer confirms ≤3 desks                  → QuoteRequestPackage
 *   one invite per desk, with delivery audit → QuoteInvite
 *   dealer's quote, recorded                 → QuoteResponse (= RfqQuote)
 *
 * Persistence is the existing rfq_* tables on the box (lib/rfq.ts,
 * lib/rfqApi.ts) — a package is an RfqRequest of packageKind "links", an
 * invite is an RfqInvite carrying its desk and vehicle. Nothing here does
 * I/O; the API routes and the wizard call these and act on the answers.
 */

import type { Dealership } from "./dealershipsApi";
import type { BuildConfidence } from "./types";
import type { RfqRequest, RfqInvite, RfqQuote } from "./rfq";

// ---------------------------------------------------------------------
// DealerDesk — a named person at a rooftop who can quote a car
// ---------------------------------------------------------------------

export type DeskRole = "gm" | "gsm" | "sales_manager" | "internet" | "new_car" | "sales";

export const DESK_ROLE_LABELS: Record<DeskRole, string> = {
  gm: "General Manager",
  gsm: "General Sales Manager",
  sales_manager: "Sales Manager",
  internet: "Internet Sales",
  new_car: "New Car Sales",
  sales: "Sales",
};

export interface DealerDesk {
  dealerName: string;
  dealerState: string | null;
  contactName: string;
  role: DeskRole;
  email: string;
  emailDomain: string;
  /** "directory" = scraped, admin-maintained dealership_contacts row; "buyer" = typed in by the buyer, unverified. */
  source: "directory" | "buyer";
  /** True when this is a real person at a real mailbox — the only kind that gets an invite. */
  knownNamed: boolean;
  emailOptOut: boolean;
}

/**
 * Mailboxes that are a department, not a person. An invite to one of these
 * lands in a shared inbox nobody owns; the rule is "never info@", and these
 * are the rest of that family.
 */
const GENERIC_MAILBOXES = new Set([
  "info", "sales", "contact", "hello", "hi", "admin", "office", "support", "service",
  "parts", "marketing", "webmaster", "web", "leads", "lead", "inquiries", "inquiry",
  "noreply", "no-reply", "donotreply", "newcars", "newcarsales", "usedcars", "internet",
  "internetsales", "isales", "bdc", "team", "dealer", "dealership", "reception", "frontdesk",
]);

/** Consumer providers — a shared domain here says nothing about a dealer group. */
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com",
  "me.com", "live.com", "msn.com", "comcast.net", "att.net", "verizon.net", "protonmail.com",
]);

export function emailDomainOf(email: string | null | undefined): string {
  const at = (email || "").trim().toLowerCase().lastIndexOf("@");
  return at > 0 ? (email || "").trim().toLowerCase().slice(at + 1) : "";
}

export function isGenericMailbox(email: string | null | undefined): boolean {
  const clean = (email || "").trim().toLowerCase();
  const at = clean.indexOf("@");
  if (at <= 0) return true;
  const local = clean.slice(0, at).replace(/[^a-z]/g, "");
  return GENERIC_MAILBOXES.has(local);
}

function looksLikePersonName(name: string): boolean {
  const clean = name.trim();
  if (clean.length < 3) return false;
  // Two or more words, none of them a department word. "Sales Team" and
  // "Internet Department" are the shapes to reject; a surname that happens
  // to be "Sales" is rare enough to lose.
  if (/\b(team|department|dept|desk|office|sales|manager|staff|internet|bdc)\b/i.test(clean)) {
    return false;
  }
  return /^[A-Za-z][A-Za-z.'\-]+(\s+[A-Za-z][A-Za-z.'\-]+)+$/.test(clean);
}

/**
 * Infers the desk from whatever title text the directory carries — the
 * contact name field sometimes has it ("John Smith, GSM"), and the notes
 * column from the crawl often does ("General Manager").
 */
export function inferDeskRole(contactName: string | null | undefined, notes: string | null | undefined): DeskRole {
  const hay = `${contactName || ""} ${notes || ""}`.toLowerCase();
  if (/\bgeneral sales manager\b|\bgsm\b/.test(hay)) return "gsm";
  if (/\bgeneral manager\b|\bgm\b/.test(hay)) return "gm";
  if (/\binternet\b|\be-?commerce\b|\bdigital\b|\bbdc\b/.test(hay)) return "internet";
  if (/\bnew[- ]car\b|\bnew vehicle\b/.test(hay)) return "new_car";
  if (/\bsales manager\b|\bsales director\b/.test(hay)) return "sales_manager";
  return "sales";
}

/** Strips a trailing title from a name: "John Smith, GSM" → "John Smith". */
function cleanContactName(raw: string | null | undefined): string {
  return (raw || "").replace(/\s*[,(–-]\s*(general|sales|internet|gm|gsm|manager|director).*$/i, "").trim();
}

/** A directory row → the desk it names, or null when there's no named person. */
export function deskFromDealership(row: Pick<Dealership, "dealerName" | "state" | "contactName" | "contactEmail" | "notes" | "emailOptOut">): DealerDesk | null {
  const contactName = cleanContactName(row.contactName);
  const email = (row.contactEmail || "").trim().toLowerCase();
  if (!contactName && !email) return null;
  const knownNamed = looksLikePersonName(contactName) && Boolean(email) && !isGenericMailbox(email);
  return {
    dealerName: (row.dealerName || "").trim(),
    dealerState: (row.state || "").trim().toUpperCase() || null,
    contactName,
    role: inferDeskRole(row.contactName, row.notes),
    email,
    emailDomain: emailDomainOf(email),
    source: "directory",
    knownNamed,
    emailOptOut: Boolean(row.emailOptOut),
  };
}

/** A sales-adviser address the buyer typed in. Never a generic mailbox, and never treated as verified. */
export function deskFromBuyerEmail(dealerName: string, dealerState: string | null, email: string): DealerDesk | null {
  const clean = (email || "").trim().toLowerCase();
  if (!clean || isGenericMailbox(clean)) return null;
  return {
    dealerName: dealerName.trim(),
    dealerState: (dealerState || "").trim().toUpperCase() || null,
    contactName: "Your sales adviser",
    role: "sales",
    email: clean,
    emailDomain: emailDomainOf(clean),
    source: "buyer",
    knownNamed: true,
    emailOptOut: false,
  };
}

/** "john.doe@paulmillerbmw.com" → "j•••••@paulmillerbmw.com" — enough to recognise, not enough to copy. */
export function maskEmail(email: string | null | undefined): string {
  const clean = (email || "").trim();
  const at = clean.indexOf("@");
  if (at <= 0) return "";
  const local = clean.slice(0, at);
  const domain = clean.slice(at + 1);
  const shown = local.slice(0, 1);
  return `${shown}${"•".repeat(Math.max(3, Math.min(local.length - 1, 6)))}@${domain}`;
}

// ---------------------------------------------------------------------
// DealerLinkPaste — what the buyer pasted and what it resolved to
// ---------------------------------------------------------------------

export interface DealerLinkPaste {
  raw: string;
  kind: "url" | "vin";
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  dealerName: string | null;
  dealerState: string | null;
  vdpUrl: string | null;
  listingPrice: number | null;
  buildConfidence: BuildConfidence;
  resolvedAt: string;
}

export const MAX_PACKAGE_LINKS = 3;

// ---------------------------------------------------------------------
// Package assembly and its two caps
// ---------------------------------------------------------------------

export type InviteBlockReason =
  | "no_named_contact"     // rooftop resolved, but no named person with a real mailbox on file
  | "dealer_opted_out"     // the desk used the unsubscribe link
  | "sister_store"         // another desk in this package shares the dealer group's domain
  | "desk_already_invited" // that desk already has an open invite from another package
  | "no_rooftop";          // the link never resolved to a dealership at all

export const INVITE_BLOCK_MESSAGES: Record<InviteBlockReason, string> = {
  no_named_contact: "No sales contact on file for this dealership. We only send quote requests to a named person — never a shared inbox — so this one can't be sent yet.",
  dealer_opted_out: "This dealership asked us to stop emailing them.",
  sister_store: "Same dealer group as another dealership in this request — one request per group, so this one is skipped.",
  desk_already_invited: "This desk already has an open quote request from you. Wait for their reply, or walk away from that request first.",
  no_rooftop: "We couldn't tell which dealership is selling this car, so there's no one to send the request to.",
};

export interface PlannedInvite {
  paste: DealerLinkPaste;
  desk: DealerDesk | null;
  blocked: InviteBlockReason | null;
}

/**
 * Desks that share a dealer-group domain. The directory has no group
 * table, so a shared email domain (lithia.com, swickard.com, …) is the
 * signal — consumer providers don't count. The first desk on a domain
 * stays; the rest are sister stores.
 */
export function sisterStoreConflicts(desks: Array<DealerDesk | null>): Set<number> {
  const seen = new Set<string>();
  const conflicts = new Set<number>();
  desks.forEach((desk, i) => {
    if (!desk?.emailDomain) return;
    if (PUBLIC_EMAIL_DOMAINS.has(desk.emailDomain)) return;
    if (seen.has(desk.emailDomain)) conflicts.add(i);
    else seen.add(desk.emailDomain);
  });
  return conflicts;
}

/** An invite still waiting on the desk — these count against the one-open-invite-per-desk cap. */
export function isOpenInvite(invite: Pick<RfqInvite, "status">): boolean {
  return invite.status === "invited";
}

/**
 * Emails with an open invite across the buyer's *collecting* packages.
 * The box enforces the same rule across all buyers; this is the client's
 * early warning for the buyer's own.
 */
export function desksWithOpenInvites(rfqs: RfqRequest[]): Set<string> {
  const open = new Set<string>();
  for (const rfq of rfqs) {
    if (rfq.status !== "collecting") continue;
    for (const invite of rfq.invites) {
      if (isOpenInvite(invite) && invite.dealerContactEmail) {
        open.add(invite.dealerContactEmail.trim().toLowerCase());
      }
    }
  }
  return open;
}

/**
 * Pairs each pasted vehicle with its desk and decides, per pair, whether an
 * invite can go out. Order is preserved; the package is capped at
 * MAX_PACKAGE_LINKS pairs. A blocked pair stays visible — the buyer sees
 * exactly why and can swap the car — but never becomes an invite.
 */
export function planInvites(
  pastes: DealerLinkPaste[],
  deskFor: (paste: DealerLinkPaste) => DealerDesk | null,
  openDeskEmails: Set<string> = new Set()
): PlannedInvite[] {
  const capped = pastes.slice(0, MAX_PACKAGE_LINKS);
  const desks = capped.map((p) => (p.dealerName ? deskFor(p) : null));
  const sisters = sisterStoreConflicts(desks);
  return capped.map((paste, i) => {
    const desk = desks[i];
    let blocked: InviteBlockReason | null = null;
    if (!paste.dealerName) blocked = "no_rooftop";
    else if (!desk || !desk.knownNamed) blocked = "no_named_contact";
    else if (desk.emailOptOut) blocked = "dealer_opted_out";
    else if (sisters.has(i)) blocked = "sister_store";
    else if (openDeskEmails.has(desk.email)) blocked = "desk_already_invited";
    return { paste, desk, blocked };
  });
}

// ---------------------------------------------------------------------
// QuoteInvite delivery audit
// ---------------------------------------------------------------------

/** Where an invite is in its life: the delivery leg, then the dealer's answer. */
export type QuoteInviteStage = "queued" | "sent" | "viewed" | "quoted" | "declined" | "expired";

export interface QuoteInviteDelivery {
  deliveryStatus: "queued" | "sent" | "viewed";
  queuedAt: string | null;
  sentAt: string | null;
  viewedAt: string | null;
}

/** Collapses the RFQ status and the delivery leg into the one stage the buyer sees. */
export function inviteStage(invite: Pick<RfqInvite, "status"> & Partial<QuoteInviteDelivery>): QuoteInviteStage {
  if (invite.status === "quoted") return "quoted";
  if (invite.status === "declined") return "declined";
  if (invite.status === "expired") return "expired";
  return invite.deliveryStatus === "viewed" ? "viewed" : invite.deliveryStatus === "sent" ? "sent" : "queued";
}

export const INVITE_STAGE_LABELS: Record<QuoteInviteStage, string> = {
  queued: "Queued",
  sent: "Sent",
  viewed: "Opened by dealer",
  quoted: "Quoted",
  declined: "Declined",
  expired: "Expired",
};

export type QuoteResponse = RfqQuote;

/** Non-binding, in the buyer's words and the dealer's. Reused verbatim by the UI and the email. */
export const NON_BINDING_COPY =
  "This is a request for a quote, not a bid or an offer. Nothing here commits the buyer to purchase or the dealer to sell; either side can walk away at any time.";
