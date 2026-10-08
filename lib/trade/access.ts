/**
 * Who may see a trade-in and its photos. Exactly two parties:
 *   - the buyer who owns the quote request (session, or a guest holding the request's signed link), and
 *   - a dealer desk INVITED on that request, proven by the invite's own tracked-link token.
 * Photos are never public: every view mints presigned GET URLs that expire in minutes.
 */
import { SIGNED_GET_SECONDS, type TradeStorage } from "./storage";
import { PHOTO_SLOT_INFO, type TradePhoto } from "./types";

/** `found` is what the invite-token lookup returned (or null for a bad token). */
export function dealerMayViewTrade(found: { rfqId: string } | null | undefined, rfqId: string): boolean {
  return Boolean(found && String(found.rfqId) === String(rfqId));
}

export function buyerMayManageTrade(buyerUserId: string, rfq: { buyerUserId: string }): boolean {
  return Boolean(buyerUserId) && buyerUserId === rfq.buyerUserId;
}

export interface SignedTradePhoto { slot: TradePhoto["slot"]; label: string; required: boolean; width: number; height: number; capturedAt: string | null; url: string; expiresInSeconds: number }

export async function signTradePhotos(storage: TradeStorage, photos: TradePhoto[]): Promise<SignedTradePhoto[]> {
  return Promise.all(photos.map(async (p) => ({
    slot: p.slot, label: PHOTO_SLOT_INFO[p.slot].label, required: p.required, width: p.width, height: p.height, capturedAt: p.capturedAt,
    url: await storage.signedGetUrl(p.storageKey, SIGNED_GET_SECONDS), expiresInSeconds: SIGNED_GET_SECONDS,
  })));
}
