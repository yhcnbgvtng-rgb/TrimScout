/**
 * "We'll keep checking": a Hyundai lists ~3 weeks before its digital
 * Monroney exists, so a request made on a fresh listing carries a
 * decode-only car. Every time the request is opened — the buyer's deal
 * page, the dealer's quote page — the pending VINs are asked again. A hit
 * is disk-cached by the sticker module, so it costs one fetch ever; a miss
 * is remembered here for an hour so a busy page doesn't hammer the host.
 *
 * Server-only. The stored request is never rewritten: the sticker rides
 * alongside it, and the MSRP / PDF link show up wherever the car does.
 */
import { getHyundaiSticker, isHyundaiVin } from "./hyundaiSticker";
import { rfqVehicles } from "./rfqTracker";
import type { RfqRequest } from "./rfq";

export interface StickerRecheckHit {
  vin: string;
  make: string;
  msrp: number | null;
  pdfUrl: string;
  exteriorColor: string | null;
  drivetrain: string | null;
  source: string | null;
}

const MISS_TTL_MS = 60 * 60 * 1000;
const lastMiss = new Map<string, number>();

/** True for a new-car paste that came in without a factory build and belongs to a brand we can re-ask. */
export function isStickerRecheckCandidate(v: { vin: string; condition: string; factoryVerified: boolean; msrp: number | null }): boolean {
  return v.condition === "new" && !v.factoryVerified && isHyundaiVin(v.vin);
}

export async function recheckPendingStickers(
  rfq: Pick<RfqRequest, "linkPastes" | "vin" | "vehicleYear" | "vehicleMake" | "vehicleModel" | "vehicleTrim">,
  deps: { getSticker?: typeof getHyundaiSticker; now?: () => number } = {}
): Promise<Record<string, StickerRecheckHit>> {
  const get = deps.getSticker || getHyundaiSticker;
  const now = deps.now || Date.now;
  const out: Record<string, StickerRecheckHit> = {};
  for (const v of rfqVehicles(rfq)) {
    if (!isStickerRecheckCandidate(v)) continue;
    const missedAt = lastMiss.get(v.vin);
    if (missedAt && now() - missedAt < MISS_TTL_MS) continue;
    try {
      const s = await get(v.vin);
      if (s.status === "released" && s.vin === v.vin) {
        lastMiss.delete(v.vin);
        out[v.vin] = { vin: v.vin, make: s.make || "Hyundai", msrp: s.msrp, pdfUrl: s.pdfUrl, exteriorColor: s.exteriorColor || null, drivetrain: s.drivetrain || null, source: s.source || null };
      } else {
        lastMiss.set(v.vin, now());
      }
    } catch {
      lastMiss.set(v.vin, now());
    }
  }
  return out;
}

/** Test-only. */
export function clearStickerRecheckMisses(): void {
  lastMiss.clear();
}
