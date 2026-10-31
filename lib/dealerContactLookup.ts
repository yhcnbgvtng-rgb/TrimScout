/**
 * Matching a vehicle's dealership against the contact directory, so the wizard
 * can tell a buyer whether we can actually reach the dealer holding their car.
 *
 * Pure logic and types only — the route supplies the directory rows. Kept out
 * of dealerEmail.ts because that module carries send-side secrets and the SAFE
 * MODE override; this is read-only and safe to reason about on its own.
 */

import { normalizeDealerKey } from "./dealerName";
import { deskFromDealership } from "./quotePackage";
import { isPlausibleDealerEmail } from "./emailShape";
import { classifyContactEmail, isQuoteReachable, reachabilityBucket, type ReachabilityBucket } from "./quoteReachable";

export interface DirectoryDealership {
  /** The directory row id (= the inventory's dealer_id). Optional because the lookup route's rows may omit it. */
  id?: string;
  dealerName: string;
  /** For the reachability rule: does the mail domain belong to this store, or to a dealer group. */
  website?: string | null;
  domains?: string[] | null;
  emailInGroupDomain?: boolean;
  /** Optional here (the lookup route's rows may omit them); the full directory row always carries them. */
  contactName?: string | null;
  notes?: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  contactEmail: string | null;
  emailOptOut: boolean;
}

export interface DealerContactQuery {
  dealerName: string;
  state?: string | null;
  /** The inventory's dealer_id when the vehicle carries one. Matched first; name + state is only the fallback for a car with no id. */
  dealerId?: string | number | null;
}

/** What the buyer is allowed to see. Deliberately no email address — see below. */
export interface DealerContactStatus {
  dealerName: string;
  matched: boolean;
  addressLine: string | null;
  phone: string | null;
  /**
   * Whether a usable email exists — never the address itself. The directory is
   * dealer contact data the buyer has no claim to; they only need to know if we
   * can reach them, and leaking it would turn the wizard into a scrapeable
   * dealer-email export.
   */
  hasEmail: boolean;
  /**
   * "reachable" = a valid address a quote request can go to (the shared rule, lib/quoteReachable.ts — same as the admin tile);
   * "unverified" = an address we cannot tie to the store (public mail, an unrelated domain); "none" = nothing usable.
   * hasEmail is true only for "reachable".
   */
  emailStatus: ReachabilityBucket;
  /** A dealer who used the unsubscribe link. Reachable in theory, off-limits in practice. */
  emailOptOut: boolean;
}

/**
 * THE rule for "contact on file", shared by /search's Contact column, the
 * wizard's Step 3 desk lookup and the dealer-contact lookup. A dealership has
 * a contact on file when it has an active, deliverable email: a plausible
 * address, and the dealer has not unsubscribed. (Deleted rows are hard-deleted
 * by the directory API, so a row that is present is not deleted.)
 *
 *   named      — reachable email AND a real person's name on a personal mailbox
 *   email_only — reachable email, but no person we can name (the request goes
 *                to the store's sales desk at that address)
 *   unverified — an address we cannot tie to the store (public mail, an unrelated
 *                domain): shown to the buyer as "Unverified email", never sent to
 *   none       — nothing reachable (blank, invalid, vendor/department address, unsubscribed)
 *
 * "Reachable" is isQuoteReachable (lib/quoteReachable.ts) — the same function the
 * admin analytics tile runs on the box, so the three surfaces cannot disagree.
 */
export type ContactState = "named" | "email_only" | "unverified" | "none";

export function hasDeliverableEmail(row: DirectoryDealership | null | undefined): boolean {
  return Boolean(row) && isQuoteReachable(toContact(row!));
}

function addressStatus(row: DirectoryDealership | null | undefined) {
  return row ? classifyContactEmail({ ...toContact(row), emailOptOut: false }).status : "none";
}

function toContact(row: DirectoryDealership) {
  return { contactEmail: row.contactEmail, dealerName: row.dealerName, website: row.website, domains: row.domains, emailOptOut: row.emailOptOut, emailInGroupDomain: row.emailInGroupDomain };
}

export function contactStateOf(row: DirectoryDealership | null | undefined): ContactState {
  if (!row) return "none";
  if (!hasDeliverableEmail(row)) return reachabilityBucket(toContact(row)) === "unverified" ? "unverified" : "none";
  const named = deskFromDealership({
    dealerName: row.dealerName,
    state: row.state,
    contactName: row.contactName ?? null,
    contactEmail: row.contactEmail,
    notes: row.notes ?? null,
    emailOptOut: row.emailOptOut,
    website: row.website,
    domains: row.domains ?? undefined,
    emailInGroupDomain: row.emailInGroupDomain,
  });
  return named?.knownNamed ? "named" : "email_only";
}

/** A contact state whose email passes isQuoteReachable: a named person, or an unnamed sales desk. Unverified and none are not. */
export function isReachableState(state: ContactState | null | undefined): boolean {
  return state === "named" || state === "email_only";
}

/**
 * "Contact on file" means a reachable email (isQuoteReachable), named or not — the one rule behind /search's Contact column, its filter and
 * counts, and Step 3's green badge. A name only changes how the To line reads.
 */
export function hasContactOnFile(row: DirectoryDealership | null | undefined): boolean {
  return isReachableState(contactStateOf(row));
}

/**
 * The key a vehicle's dealer name and a directory row are matched on. Like normalizeDealerKey, but a trailing
 * "(City, ST)" tag the directory adds to tell same-named rooftops apart ("Bayside Chrysler Dodge Jeep Ram (Bayside, NY)")
 * is dropped, so those rows compete on state instead of the tagged one being unreachable.
 */
export function dealerMatchKey(name: string): string {
  return normalizeDealerKey((name || "").replace(/\s*\([^()]*\)\s*$/, ""));
}

/** Directory rows (by dealerMatchKey) for one dealer name — the one grouping both /search and Step 3 use. */
export function directoryRowsFor<T extends DirectoryDealership>(directory: T[], dealerName: string): T[] {
  const key = dealerMatchKey(dealerName);
  return key ? directory.filter((d) => dealerMatchKey(d.dealerName || "") === key) : [];
}

const STATE_RANK: Record<ContactState, number> = { named: 3, email_only: 2, unverified: 1, none: 0 };

/**
 * One dealership out of the rows sharing a normalized name: the one in the
 * vehicle's own state when there is one, and — when a chain has duplicate rows
 * for the same store — the one with the best contact, not whichever sorts first.
 */
export function pickDirectoryMatch<T extends DirectoryDealership>(matches: T[], state?: string | null): T | null {
  if (matches.length === 0) return null;
  const wanted = (state || "").trim().toUpperCase();
  // A row from another state is a different store that shares the name — never its contact. Rows with no state stay eligible.
  const pool = wanted ? matches.filter((d) => { const s = (d.state || "").trim().toUpperCase(); return s === wanted || s === ""; }) : matches;
  if (pool.length === 0) return null;
  return pool.reduce((best, d) => (STATE_RANK[contactStateOf(d)] > STATE_RANK[contactStateOf(best)] ? d : best), pool[0]);
}

/**
 * Same rule dealerEmail.ts sends by: normalized name, preferring the row in the
 * vehicle's own state when a chain shares a name across states.
 */
export function matchDirectoryDealership<T extends DirectoryDealership>(
  directory: T[],
  query: DealerContactQuery
): T | null {
  // The vehicle's own dealer_id names its row exactly; a name match can land on a sister store or a duplicate row
  // (audit 2026-10-30: 108 of 9,486 active dealers resolved to a different row by name). Name + state only when there is no id.
  const id = query.dealerId == null ? "" : String(query.dealerId).trim();
  if (id) {
    const byId = directory.find((d) => d.id != null && String(d.id) === id);
    if (byId) return byId;
  }
  return pickDirectoryMatch(directoryRowsFor(directory, query.dealerName), query.state);
}

/** "123 Main St, Butler, NJ 07405" from whichever parts the row actually has. */
export function formatDealershipAddress(dealership: DirectoryDealership | null): string | null {
  if (!dealership) return null;
  const street = (dealership.address || "").trim();
  const city = (dealership.city || "").trim();
  const state = (dealership.state || "").trim().toUpperCase();
  const zip = (dealership.zipCode || "").trim();
  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const full = [street, cityStateZip].filter(Boolean).join(", ");
  return full || null;
}

export function dealerContactStatus(
  directory: DirectoryDealership[],
  query: DealerContactQuery
): DealerContactStatus {
  const match = matchDirectoryDealership(directory, query);
  return {
    dealerName: query.dealerName,
    matched: Boolean(match),
    addressLine: formatDealershipAddress(match),
    phone: match?.phone?.trim() || null,
    // The address check alone; the dealer's unsubscribe is its own field (emailOptOut), as it always was here.
    hasEmail: addressStatus(match) === "valid",
    emailStatus: ({ valid: "reachable", unverified: "unverified", invalid: "none", none: "none" } as const)[addressStatus(match)],
    emailOptOut: Boolean(match?.emailOptOut),
  };
}

/** A dealer id off the wire: digits only (the inventory's dealer_id). Anything else — "pick:name|st" placeholders, junk — is "no id". */
export function dealerIdFrom(value: unknown): string | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  return /^\d{1,12}$/.test(raw) ? raw : null;
}

export { isPlausibleDealerEmail };
