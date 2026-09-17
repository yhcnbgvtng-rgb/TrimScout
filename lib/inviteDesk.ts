/**
 * The one way a dealer invite's desk and vehicle are settled — shared by the
 * buyer's send route and the admin's "add a dealer" before release, so the
 * desk an admin attaches obeys exactly the rules a buyer's does. Server-only.
 *
 * Desk: a named person from the directory first; else a typed adviser
 * address (a person's mailbox only); else the rooftop's own sales desk — its
 * shared inbox when the directory has one, or no address at all (ops routes
 * it). A known rooftop is never a dead end; callers never supply the address
 * we send to. Opt-outs and sister stores are refused with the reason.
 */
import { listDealerships } from "./dealershipsApi";
import { matchDirectoryDealership } from "./dealerContactLookup";
import { createRfqInvite, RfqApiError } from "./rfqApi";
import type { RfqInvite, RfqRequest } from "./rfq";
import {
  deskFromDealership,
  deskFromBuyerEmail,
  deskFromRooftop,
  maskEmail,
  sisterStoreConflicts,
  INVITE_BLOCK_MESSAGES,
  type DealerDesk,
  type InviteBlockReason,
} from "./quotePackage";

export type InviteDeskOutcome = { ok: true; desk: DealerDesk | null } | { ok: false; code: InviteBlockReason; error: string; status: number };

export async function resolveInviteDesk(rfq: RfqRequest, input: { dealerName: string; dealerState: string; providedEmail?: string | null }): Promise<InviteDeskOutcome> {
  const dealerName = input.dealerName.trim();
  const dealerState = (input.dealerState || "").trim();
  if (rfq.packageKind !== "links") return { ok: true, desk: null };
  const directory = await listDealerships().catch(() => []);
  const row = matchDirectoryDealership(directory, { dealerName, state: dealerState });
  let desk: DealerDesk | null = row ? deskFromDealership(row) : null;
  if (!desk?.knownNamed && typeof input.providedEmail === "string" && input.providedEmail.trim()) {
    desk = deskFromBuyerEmail(dealerName, dealerState, input.providedEmail) || desk;
  }
  if (!desk?.knownNamed) {
    desk = row ? deskFromRooftop(row) : { dealerName, dealerState: dealerState.toUpperCase() || null, contactName: "Sales desk", role: "sales", email: "", emailDomain: "", source: "rooftop", knownNamed: false, emailOptOut: false };
  }
  if (desk.emailOptOut) return { ok: false, code: "dealer_opted_out", error: INVITE_BLOCK_MESSAGES.dealer_opted_out, status: 422 };
  // Sister store: the package already has a desk on this dealer group's domain.
  const existingDesks = rfq.invites
    .filter((i) => i.status !== "declined" && i.status !== "expired")
    .map((i) => (i.dealerContactEmail ? ({ emailDomain: i.dealerContactEmail.split("@")[1] || "" } as DealerDesk) : null));
  if (sisterStoreConflicts([...existingDesks, desk]).has(existingDesks.length)) {
    return { ok: false, code: "sister_store", error: INVITE_BLOCK_MESSAGES.sister_store, status: 422 };
  }
  return { ok: true, desk };
}

/** The vehicle this desk quotes, from the package's own pastes (or the request's headline car). */
export function inviteVehicleFor(rfq: RfqRequest, dealerName: string) {
  const paste = (rfq.linkPastes || []).find((p) => typeof p.dealerName === "string" && p.dealerName.trim().toLowerCase() === dealerName.trim().toLowerCase()) as Record<string, unknown> | undefined;
  return paste
    ? {
        vin: String(paste.vin || rfq.vin),
        year: Number(paste.year || rfq.vehicleYear),
        make: String(paste.make || rfq.vehicleMake),
        model: String(paste.model || rfq.vehicleModel),
        trim: String(paste.trim || rfq.vehicleTrim || ""),
        vdpUrl: typeof paste.vdpUrl === "string" ? paste.vdpUrl : null,
      }
    : { vin: rfq.vin, year: rfq.vehicleYear, make: rfq.vehicleMake, model: rfq.vehicleModel, trim: rfq.vehicleTrim, vdpUrl: null };
}

/** Queue the invite on the box (409 → desk_already_invited). Nothing is sent here. */
export async function queueInvite(rfq: RfqRequest, dealerName: string, desk: DealerDesk | null, fallbackEmail?: string | null): Promise<{ ok: true; invite: RfqInvite } | { ok: false; code: InviteBlockReason; error: string; status: number }> {
  try {
    const invite = await createRfqInvite(rfq.id, {
      dealerName,
      dealerContactEmail: desk ? desk.email || null : fallbackEmail || null,
      desk: desk ? { contactName: desk.contactName, role: desk.role, emailMasked: maskEmail(desk.email), source: desk.source } : undefined,
      vehicle: inviteVehicleFor(rfq, dealerName),
    });
    return { ok: true, invite };
  } catch (err) {
    if (err instanceof RfqApiError && err.status === 409) return { ok: false, code: "desk_already_invited", error: INVITE_BLOCK_MESSAGES.desk_already_invited, status: 409 };
    throw err;
  }
}
