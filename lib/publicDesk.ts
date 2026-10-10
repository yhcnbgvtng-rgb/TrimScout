/** What Step 3 shows for a dealership — the single place a directory row becomes a desk. Never the email address itself. */
import type { Dealership } from "./dealershipsApi";
import { matchDirectoryDealership, contactStateOf, type ContactState } from "./dealerContactLookup";
import { deskFromDealership, deskFromRooftop, inviteRouting, type InviteRouting, maskEmail, INVITE_BLOCK_MESSAGES, type DealerDesk } from "./quotePackage";

export interface PublicDesk {
  dealerName: string;
  found: boolean;
  /** The shared contact-on-file state (lib/dealerContactLookup): named person, email with no name, or nothing deliverable. */
  contactState: ContactState;
  knownNamed: boolean;
  contactName: string | null;
  role: DealerDesk["role"] | null;
  emailMasked: string | null;
  emailDomain: string | null;
  emailOptOut: boolean;
  blockedReason: keyof typeof INVITE_BLOCK_MESSAGES | null;
  blockedMessage: string | null;
  /** Where the request goes: a named person, the rooftop's shared inbox, or our routing queue. */
  routing: InviteRouting;
}

export function publicDeskFor(rows: Dealership[], d: { dealerName: string; state: string }): PublicDesk {
  const row = matchDirectoryDealership(rows, d);
  const named = row ? deskFromDealership(row) : null;
  const desk = named?.knownNamed ? named : row ? deskFromRooftop(row) : null;
  const blocked: PublicDesk["blockedReason"] = desk?.emailOptOut ? "dealer_opted_out" : null;
  return {
    dealerName: d.dealerName,
    found: Boolean(row),
    contactState: contactStateOf(row),
    knownNamed: Boolean(desk?.knownNamed),
    contactName: desk?.contactName || null,
    role: desk?.role || null,
    emailMasked: desk?.knownNamed ? maskEmail(desk.email) : null,
    emailDomain: desk?.knownNamed ? desk.emailDomain : null,
    emailOptOut: Boolean(desk?.emailOptOut),
    blockedReason: blocked,
    blockedMessage: blocked ? INVITE_BLOCK_MESSAGES[blocked] : null,
    routing: inviteRouting(desk),
  };
}

