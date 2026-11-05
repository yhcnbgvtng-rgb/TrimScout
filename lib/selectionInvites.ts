/**
 * Turns a saved selection into invitations, and records what happened to EVERY selected vehicle.
 *
 * Server-side and sequential, so a closed tab or a failure part-way can't leave vehicles without an outcome. Dependencies
 * are injected so the tests run on fixtures with no network, no box and no email.
 *
 * Idempotent: a vehicle that already has an invitation on the request is linked to it ("reused"), never invited twice,
 * and a dealership that already holds an invitation is never given a second one. Nothing here sends email: invitations
 * are created queued, and the admin release gate and the dealer-mail outbox decide when (and whether) they go.
 * No retry loops: a failure is recorded and stays recorded until the buyer submits again.
 */
import type { RfqInvite, RfqRequest } from "./rfq";
import { RFQ_MAX_INVITES } from "./rfq";
import { rfqVehicles } from "./rfqTracker";
import { excluded, invited, inviteForVehicle, type SelectionOutcome, type SelectionReasonCode } from "./selectionOutcomes";
import type { DealerDesk, InviteBlockReason } from "./quotePackage";
import type { InviteDeskOutcome } from "./inviteDesk";

/** What the browser tells us about each selected vehicle. It never supplies an address to send to. */
export interface SelectionChoice {
  vin: string;
  /** The dealership's tick on the review screen. */
  checked: boolean;
  dealerId?: string | number | null;
  /** The buyer's own sales adviser address, if they typed one (the desk resolver validates it). */
  buyerProvidedEmail?: string | null;
}

export interface SelectionDeps {
  resolveDesk: (rfq: RfqRequest, input: { dealerName: string; dealerState: string; dealerId?: string | number | null; providedEmail?: string | null }) => Promise<InviteDeskOutcome>;
  queue: (rfq: RfqRequest, dealerName: string, desk: DealerDesk | null, vin: string) => Promise<{ ok: true; invite: RfqInvite } | { ok: false; code: InviteBlockReason; error: string; status: number }>;
  /** Per-dealership daily cap (lib/apiSpendGuard guardPerDeskCap): true when one more request is allowed. */
  deskCapAllows: (dealerName: string) => boolean;
  /** Most invitations this buyer may hold on one request (reputation cap), or null for the box's own limit only. */
  maxInvites: number | null;
  now?: () => string;
}

const BLOCK_TO_REASON: Partial<Record<InviteBlockReason, SelectionReasonCode>> = {
  dealer_opted_out: "dealer_opted_out",
  sister_store: "sister_store",
  desk_already_invited: "desk_already_invited",
  no_rooftop: "ineligible_vehicle",
};

const live = (i: RfqInvite) => i.status !== "declined" && i.status !== "expired";
const key = (s: string | null | undefined) => (s || "").trim().toLowerCase();
/** One physical store: name + state. Two same-named stores in different states are two stores. */
const storeKey = (name: string | null | undefined, state: string | null | undefined) => `${key(name)}|${(state || "").trim().toUpperCase()}`;

export interface SelectionRunResult {
  outcomes: SelectionOutcome[];
  /** Invitations created in this run (not the reused ones). */
  created: RfqInvite[];
}

export async function createSelectionInvites(rfqIn: RfqRequest, choices: SelectionChoice[], deps: SelectionDeps): Promise<SelectionRunResult> {
  const now = deps.now || (() => new Date().toISOString());
  // Work on a copy so the sister-store check sees the invitations created earlier in this same run.
  const rfq: RfqRequest = { ...rfqIn, invites: [...rfqIn.invites] };
  const byVin = new Map(choices.map((c) => [String(c.vin || "").trim().toUpperCase(), c]));
  const outcomes: SelectionOutcome[] = [];
  const created: RfqInvite[] = [];
  const dealerHasInvite = new Map<string, string>(); // dealer key → invite id

  const vehicles = rfqVehicles(rfq);
  // A live invite occupies its store: found through the vehicle it carries (which knows the state), else by name alone.
  for (const i of rfq.invites) {
    if (!live(i)) continue;
    const car = vehicles.find((c) => inviteForVehicle(rfq, c)?.id === i.id);
    dealerHasInvite.set(storeKey(i.dealerName, car?.dealerState), i.id);
  }

  for (const v of vehicles) {
    const at = now();
    // Retry / double click: this vehicle already has its invitation.
    const existing = inviteForVehicle(rfq, v);
    if (existing && !outcomes.some((o) => o.inviteId === existing.id)) {
      outcomes.push(invited(v, existing.id, at, true));
      continue;
    }
    const choice = byVin.get(v.vin);
    if (!choice) { outcomes.push(excluded(v, "not_attempted", at)); continue; }
    if (!choice.checked) { outcomes.push(excluded(v, "dealer_unchecked", at)); continue; }
    if (!v.dealerName) { outcomes.push(excluded(v, "ineligible_vehicle", at)); continue; }
    const dealerKey = storeKey(v.dealerName, v.dealerState);
    if (dealerHasInvite.has(dealerKey)) { outcomes.push(excluded(v, "same_dealer_other_vehicle", at)); continue; }
    const holding = rfq.invites.filter(live).length;
    if (holding >= Math.min(RFQ_MAX_INVITES, deps.maxInvites ?? RFQ_MAX_INVITES)) { outcomes.push(excluded(v, "invite_limit_reached", at)); continue; }
    if (!deps.deskCapAllows(v.dealerName)) { outcomes.push(excluded(v, "dealer_daily_cap", at)); continue; }

    try {
      const resolved = await deps.resolveDesk(rfq, { dealerName: v.dealerName, dealerState: v.dealerState || "", dealerId: choice.dealerId, providedEmail: choice.buyerProvidedEmail ?? null });
      if (!resolved.ok) { outcomes.push(excluded(v, BLOCK_TO_REASON[resolved.code] || "invite_creation_failed", at)); continue; }
      const queued = await deps.queue(rfq, v.dealerName, resolved.desk, v.vin);
      if (!queued.ok) { outcomes.push(excluded(v, BLOCK_TO_REASON[queued.code] || "invite_creation_failed", at)); continue; }
      rfq.invites.push(queued.invite);
      created.push(queued.invite);
      dealerHasInvite.set(dealerKey, queued.invite.id);
      outcomes.push(invited(v, queued.invite.id, at));
    } catch {
      // Raw error text can hold addresses or internals; the reason code is all we keep.
      outcomes.push(excluded(v, "invite_creation_failed", at));
    }
  }
  return { outcomes, created };
}

// One submission per request at a time inside this server process: a double click or a retry waits for the first run
// and then finds every vehicle already linked. (Across processes the box's own per-dealership guard is the backstop.)
const inFlight = new Map<string, Promise<unknown>>();
export async function withRequestLock<T>(rfqId: string, work: () => Promise<T>): Promise<T> {
  const prior = inFlight.get(rfqId) || Promise.resolve();
  const run = prior.catch(() => undefined).then(work);
  inFlight.set(rfqId, run);
  try {
    return await run;
  } finally {
    if (inFlight.get(rfqId) === run) inFlight.delete(rfqId);
  }
}
