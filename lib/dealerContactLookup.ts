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

export interface DirectoryDealership {
  dealerName: string;
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
 *   named      — deliverable email AND a real person's name on a personal mailbox
 *   email_only — deliverable email, but no person we can name (the request goes
 *                to the store's sales desk at that address)
 *   none       — no deliverable email (blank, malformed or unsubscribed)
 */
export type ContactState = "named" | "email_only" | "none";

export function hasDeliverableEmail(row: Pick<DirectoryDealership, "contactEmail" | "emailOptOut"> | null | undefined): boolean {
  return Boolean(row) && !row!.emailOptOut && isPlausibleDealerEmail(row!.contactEmail || "");
}

export function contactStateOf(row: DirectoryDealership | null | undefined): ContactState {
  if (!row || !hasDeliverableEmail(row)) return "none";
  const named = deskFromDealership({
    dealerName: row.dealerName,
    state: row.state,
    contactName: row.contactName ?? null,
    contactEmail: row.contactEmail,
    notes: row.notes ?? null,
    emailOptOut: row.emailOptOut,
  });
  return named?.knownNamed ? "named" : "email_only";
}

export function hasContactOnFile(row: DirectoryDealership | null | undefined): boolean {
  return contactStateOf(row) !== "none";
}

const STATE_RANK: Record<ContactState, number> = { named: 2, email_only: 1, none: 0 };

/**
 * One dealership out of the rows sharing a normalized name: the one in the
 * vehicle's own state when there is one, and — when a chain has duplicate rows
 * for the same store — the one with the best contact, not whichever sorts first.
 */
export function pickDirectoryMatch<T extends DirectoryDealership>(matches: T[], state?: string | null): T | null {
  if (matches.length === 0) return null;
  const wanted = (state || "").trim().toUpperCase();
  const inState = wanted ? matches.filter((d) => (d.state || "").trim().toUpperCase() === wanted) : [];
  const pool = inState.length > 0 ? inState : matches;
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
  const key = normalizeDealerKey(query.dealerName || "");
  if (!key) return null;
  return pickDirectoryMatch(directory.filter((d) => normalizeDealerKey(d.dealerName || "") === key), query.state);
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
    hasEmail: isPlausibleDealerEmail(match?.contactEmail || ""),
    emailOptOut: Boolean(match?.emailOptOut),
  };
}

export { isPlausibleDealerEmail };
