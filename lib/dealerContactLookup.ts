/**
 * Matching a vehicle's dealership against the contact directory, so the wizard
 * can tell a buyer whether we can actually reach the dealer holding their car.
 *
 * Pure logic and types only — the route supplies the directory rows. Kept out
 * of dealerEmail.ts because that module carries send-side secrets and the SAFE
 * MODE override; this is read-only and safe to reason about on its own.
 */

import { normalizeDealerKey } from "./dealerName";

export interface DirectoryDealership {
  dealerName: string;
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
 * Same rule dealerEmail.ts sends by: normalized name, preferring the row in the
 * vehicle's own state when a chain shares a name across states.
 */
export function matchDirectoryDealership<T extends DirectoryDealership>(
  directory: T[],
  query: DealerContactQuery
): T | null {
  const key = normalizeDealerKey(query.dealerName || "");
  if (!key) return null;
  const matches = directory.filter((d) => normalizeDealerKey(d.dealerName || "") === key);
  if (matches.length === 0) return null;
  const wanted = (query.state || "").trim().toUpperCase();
  if (wanted) {
    const inState = matches.find((d) => (d.state || "").trim().toUpperCase() === wanted);
    if (inState) return inState;
  }
  return matches[0];
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
    hasEmail: Boolean(match?.contactEmail?.trim()),
    emailOptOut: Boolean(match?.emailOptOut),
  };
}

/** A buyer-supplied sales-adviser address, before it's allowed anywhere near a send. */
export function isPlausibleDealerEmail(value: string): boolean {
  const clean = (value || "").trim();
  if (clean.length < 6 || clean.length > 254) return false;
  if (/\s/.test(clean)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(clean);
}
