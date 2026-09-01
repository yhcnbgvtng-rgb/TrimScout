/**
 * Per-dealer invite tokens and engagement events for a shopper deal.
 * Pure mutations — persistence lives in dealEngagementStore.ts.
 */

import { randomBytes } from "node:crypto";
import type { Vehicle } from "./types";
import {
  evaluateOfferClock,
  OFFER_CLOCK_EXTEND_MS,
  OFFER_CLOCK_RUNNING_MS,
  type OfferClockSnapshot,
} from "./offerCloseClock";
import { timeZoneForUsState } from "./usTimeZones";

export interface InvitedDealerSeed {
  dealerName: string;
  dealerState: string;
  dealerCity?: string;
  knownRooftop: boolean;
}

export interface StoredDealerInvite {
  dealerKey: string;
  dealerName: string;
  dealerState: string;
  dealerCity: string;
  knownRooftop: boolean;
  token: string;
  clickedAt: string | null;
  viewedAt: string | null;
  respondedAt: string | null;
}

export interface StoredDealEngagement {
  dealRequestId: string;
  timeZone: string;
  allottedRunningMs: number;
  startedAt: string | null;
  closedAt: string | null;
  dealers: StoredDealerInvite[];
}

export interface EngagementStoreData {
  tokens: Record<string, { dealRequestId: string; dealerKey: string }>;
  deals: Record<string, StoredDealEngagement>;
}

export interface DealerEngagementRow {
  dealerKey: string;
  dealerName: string;
  dealerState: string;
  clicked: boolean;
  viewed: boolean;
  responded: boolean;
  clickedAt: string | null;
  viewedAt: string | null;
  respondedAt: string | null;
  knownRooftop: boolean;
}

export interface DealEngagementSnapshot {
  dealRequestId: string;
  dealers: DealerEngagementRow[];
  clock: OfferClockSnapshot;
  acceptingResponses: boolean;
}

export function emptyEngagementStore(): EngagementStoreData {
  return { tokens: {}, deals: {} };
}

export function normalizeDealerKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function dealerOfferPath(token: string): string {
  return `/d/${encodeURIComponent(token)}`;
}

export function invitedDealersFromVehicles(
  favorite: Vehicle | null | undefined,
  otherLots: Array<Vehicle | null | undefined> = []
): InvitedDealerSeed[] {
  const out: InvitedDealerSeed[] = [];
  const seen = new Set<string>();
  const add = (vehicle: Vehicle | null | undefined) => {
    if (!vehicle) return;
    const dealerName = (vehicle.location?.dealerName || "").trim();
    if (!dealerName) return;
    const key = normalizeDealerKey(dealerName);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      dealerName,
      dealerState: (vehicle.location?.state || "").trim().toUpperCase(),
      dealerCity: (vehicle.location?.city || "").trim(),
      knownRooftop: true,
    });
  };
  add(favorite);
  for (const lot of otherLots) add(lot);
  return out;
}

export function primaryDealTimeZone(
  favorite: Vehicle | null | undefined,
  fallbackState?: string
): string {
  const state = (favorite?.location?.state || fallbackState || "").trim();
  return timeZoneForUsState(state);
}

function ensureDeal(store: EngagementStoreData, dealRequestId: string, timeZone?: string): StoredDealEngagement {
  const existing = store.deals[dealRequestId];
  if (existing) return existing;
  const created: StoredDealEngagement = {
    dealRequestId,
    timeZone: timeZone || "America/New_York",
    allottedRunningMs: OFFER_CLOCK_RUNNING_MS,
    startedAt: null,
    closedAt: null,
    dealers: [],
  };
  store.deals[dealRequestId] = created;
  return created;
}

function upsertDealer(
  store: EngagementStoreData,
  deal: StoredDealEngagement,
  seed: Partial<InvitedDealerSeed> & { dealerName: string },
  tokenFactory: () => string
): StoredDealerInvite {
  const dealerKey = normalizeDealerKey(seed.dealerName);
  let row = deal.dealers.find((d) => d.dealerKey === dealerKey);
  if (!row) {
    const token = tokenFactory();
    row = {
      dealerKey,
      dealerName: seed.dealerName.trim(),
      dealerState: (seed.dealerState || "").trim().toUpperCase(),
      dealerCity: (seed.dealerCity || "").trim(),
      knownRooftop: Boolean(seed.knownRooftop),
      token,
      clickedAt: null,
      viewedAt: null,
      respondedAt: null,
    };
    deal.dealers.push(row);
    store.tokens[token] = { dealRequestId: deal.dealRequestId, dealerKey };
  } else {
    if (seed.dealerState && !row.dealerState) row.dealerState = seed.dealerState.trim().toUpperCase();
    if (seed.dealerCity && !row.dealerCity) row.dealerCity = seed.dealerCity.trim();
    if (seed.knownRooftop) row.knownRooftop = true;
  }
  return row;
}

function startClockIfNeeded(deal: StoredDealEngagement, nowIso: string): void {
  if (!deal.startedAt && !deal.closedAt) deal.startedAt = nowIso;
}

export function applySeedInvites(
  store: EngagementStoreData,
  dealRequestId: string,
  seeds: InvitedDealerSeed[],
  timeZone: string,
  tokenFactory: () => string = newInviteToken
): StoredDealEngagement {
  const deal = ensureDeal(store, dealRequestId, timeZone);
  deal.timeZone = timeZone || deal.timeZone;
  for (const seed of seeds) {
    if (!seed.dealerName.trim()) continue;
    upsertDealer(store, deal, seed, tokenFactory);
  }
  return deal;
}

export function applyClick(
  store: EngagementStoreData,
  token: string,
  now: Date
): { deal: StoredDealEngagement; dealer: StoredDealerInvite } | null {
  const ref = store.tokens[token];
  if (!ref) return null;
  const deal = store.deals[ref.dealRequestId];
  if (!deal) return null;
  const dealer = deal.dealers.find((d) => d.dealerKey === ref.dealerKey);
  if (!dealer) return null;
  if (!dealer.clickedAt) dealer.clickedAt = now.toISOString();
  return { deal, dealer };
}

export function applyView(
  store: EngagementStoreData,
  args: {
    token?: string | null;
    dealRequestId?: string | null;
    dealerName: string;
    dealerState?: string;
    dealerCity?: string;
  },
  now: Date,
  tokenFactory: () => string = newInviteToken
): { deal: StoredDealEngagement; dealer: StoredDealerInvite } | null {
  const name = (args.dealerName || "").trim();
  if (!name) return null;
  let deal: StoredDealEngagement | undefined;
  if (args.token && store.tokens[args.token]) {
    deal = store.deals[store.tokens[args.token].dealRequestId];
  } else if (args.dealRequestId) {
    deal =
      store.deals[args.dealRequestId] ||
      ensureDeal(store, args.dealRequestId, timeZoneForUsState(args.dealerState));
  }
  if (!deal) return null;
  const dealer = upsertDealer(
    store,
    deal,
    {
      dealerName: name,
      dealerState: args.dealerState || "",
      dealerCity: args.dealerCity || "",
      knownRooftop: false,
    },
    tokenFactory
  );
  const nowIso = now.toISOString();
  if (!dealer.viewedAt) dealer.viewedAt = nowIso;
  startClockIfNeeded(deal, nowIso);
  return { deal, dealer };
}

export function applyRespond(
  store: EngagementStoreData,
  args: { dealRequestId: string; dealerName: string; dealerState?: string; dealerCity?: string },
  now: Date,
  tokenFactory: () => string = newInviteToken
): { deal: StoredDealEngagement; dealer: StoredDealerInvite } | null {
  const name = (args.dealerName || "").trim();
  if (!name || !args.dealRequestId) return null;
  const deal = store.deals[args.dealRequestId] || ensureDeal(store, args.dealRequestId, timeZoneForUsState(args.dealerState));
  const dealer = upsertDealer(
    store,
    deal,
    {
      dealerName: name,
      dealerState: args.dealerState || "",
      dealerCity: args.dealerCity || "",
      knownRooftop: false,
    },
    tokenFactory
  );
  const nowIso = now.toISOString();
  if (!dealer.viewedAt) dealer.viewedAt = nowIso;
  if (!dealer.respondedAt) dealer.respondedAt = nowIso;
  startClockIfNeeded(deal, nowIso);
  return { deal, dealer };
}

export function applyExtend(
  store: EngagementStoreData,
  dealRequestId: string,
  now: Date
): StoredDealEngagement | null {
  const deal = store.deals[dealRequestId];
  if (!deal) return null;
  applyLazyClose(deal, now);
  if (deal.closedAt) return deal;
  deal.allottedRunningMs += OFFER_CLOCK_EXTEND_MS;
  return deal;
}

export function applyLazyClose(deal: StoredDealEngagement, now: Date): boolean {
  if (deal.closedAt) return true;
  const snap = evaluateOfferClock({
    startedAt: deal.startedAt,
    allottedRunningMs: deal.allottedRunningMs,
    timeZone: deal.timeZone,
    now,
  });
  if (snap.status === "closed") {
    deal.closedAt = snap.closedAt || now.toISOString();
    return true;
  }
  return false;
}

export function snapshotDealEngagement(deal: StoredDealEngagement, now: Date): DealEngagementSnapshot {
  applyLazyClose(deal, now);
  const clock = evaluateOfferClock({
    startedAt: deal.startedAt,
    allottedRunningMs: deal.allottedRunningMs,
    closedAt: deal.closedAt,
    timeZone: deal.timeZone,
    now,
  });
  return {
    dealRequestId: deal.dealRequestId,
    acceptingResponses: clock.status !== "closed" && !deal.closedAt,
    clock,
    dealers: deal.dealers.map((d) => ({
      dealerKey: d.dealerKey,
      dealerName: d.knownRooftop ? d.dealerName : "Additional dealership",
      dealerState: d.knownRooftop ? d.dealerState : "",
      clicked: Boolean(d.clickedAt),
      viewed: Boolean(d.viewedAt),
      responded: Boolean(d.respondedAt),
      clickedAt: d.clickedAt,
      viewedAt: d.viewedAt,
      respondedAt: d.respondedAt,
      knownRooftop: d.knownRooftop,
    })),
  };
}

export function findDealByToken(
  store: EngagementStoreData,
  token: string
): { deal: StoredDealEngagement; dealer: StoredDealerInvite } | null {
  const ref = store.tokens[token];
  if (!ref) return null;
  const deal = store.deals[ref.dealRequestId];
  if (!deal) return null;
  const dealer = deal.dealers.find((d) => d.dealerKey === ref.dealerKey);
  if (!dealer) return null;
  return { deal, dealer };
}
