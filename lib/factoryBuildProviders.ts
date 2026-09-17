/**
 * Brand sticker provider registry — the pipeline's "acquire" stage. Each
 * provider wraps an existing per-brand OEM sticker fetcher (fordSticker.ts,
 * gmSticker.ts, genesisSticker.ts, hyundaiSticker.ts, ...) behind one
 * interface, keyed by the VIN-WMI classifiers already in lib/oemWmi.ts.
 *
 * Adding a brand is: write the fetch+parse module the way the existing ones
 * do (see docs/FACTORY_BUILD_PROVIDERS.md), then register it here. Nothing
 * downstream (normalize/enrich/store/pipeline) needs to change.
 */
import { getGenesisSticker, type GenesisSticker } from "./genesisSticker";
import { getHyundaiSticker } from "./hyundaiSticker";
import { isGenesisVin, isHyundaiVin } from "./oemWmi";

export interface StickerProviderResult {
  providerId: string;
  url: string | null;
  sticker: GenesisSticker;
}

export interface StickerProvider {
  id: string;
  make: string;
  matchesVin: (vin: string) => boolean;
  fetch: (vin: string) => Promise<StickerProviderResult>;
}

/**
 * 5NM is a WMI Hyundai and Genesis share (Hyundai Motor Manufacturing
 * Alabama, which also builds the Genesis GV70). isHyundaiVin already claims
 * it, and getHyundaiSticker already falls back to Genesis's own sticker
 * service for that WMI — so hyundaiStickerProvider must be checked before
 * genesisStickerProvider for routing to land on the right internal fallback.
 */
export const hyundaiStickerProvider: StickerProvider = {
  id: "hyundai_dealerfire",
  make: "Hyundai",
  matchesVin: isHyundaiVin,
  fetch: async (vin) => {
    const sticker = await getHyundaiSticker(vin);
    const providerId = sticker.source ? `hyundai_${sticker.source}` : "hyundai_dealerfire";
    return { providerId, url: sticker.pdfUrl, sticker };
  },
};

export const genesisStickerProvider: StickerProvider = {
  id: "genesis_oem",
  make: "Genesis",
  matchesVin: isGenesisVin,
  fetch: async (vin) => {
    const sticker = await getGenesisSticker(vin);
    return { providerId: "genesis_oem", url: sticker.pdfUrl, sticker };
  },
};

/** Checked in order — hyundaiStickerProvider first so the shared 5NM WMI resolves the way getHyundaiSticker already handles it. */
export const STICKER_PROVIDERS: StickerProvider[] = [hyundaiStickerProvider, genesisStickerProvider];

export function stickerProviderForVin(vin: string): StickerProvider | null {
  return STICKER_PROVIDERS.find((p) => p.matchesVin(vin)) || null;
}
