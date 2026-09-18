/**
 * Brand sticker provider registry — the pipeline's "acquire + normalize"
 * stage. Each provider wraps an existing per-brand OEM sticker fetcher
 * (fordSticker.ts, gmSticker.ts, genesisSticker.ts, hyundaiSticker.ts,
 * stellantisSticker.ts) behind one interface, keyed by the VIN-WMI
 * classifiers already in lib/oemWmi.ts, and returns an already-normalized
 * FactoryBuild.
 *
 * Only brands with a genuine OEM window sticker belong here — the other 14
 * brand modules in lib/*Sticker.ts (Audi, BMW, Honda, Kia, Mazda, Mercedes,
 * MINI, Mitsubishi, Nissan, Porsche, Subaru, Toyota, Volkswagen, Volvo) wrap
 * MarketCheck's dealer-equipment feed (lib/listingFeedBuild.ts), not a
 * factory sticker, and must never be registered as factory_verified.
 *
 * Adding a brand is: write the fetch+parse module the way the existing ones
 * do (see docs/FACTORY_BUILD_PROVIDERS.md), add a normalize{Brand}Sticker in
 * lib/factoryBuild.ts, then register it here. Nothing downstream
 * (enrich/store/pipeline) needs to change.
 */
import { getGenesisSticker } from "./genesisSticker";
import { getHyundaiSticker } from "./hyundaiSticker";
import { getFordSticker } from "./fordSticker";
import { getGmSticker } from "./gmSticker";
import { getStellantisSticker } from "./stellantisSticker";
import { isGenesisVin, isHyundaiVin, isFordOrLincolnVin, isGmVin, isStellantisVin } from "./oemWmi";
import {
  normalizeGenesisFamilySticker,
  normalizeFordSticker,
  normalizeGmSticker,
  normalizeStellantisSticker,
  type FactoryBuild,
  type NormalizeOptions,
} from "./factoryBuild";

export interface StickerProvider {
  id: string;
  make: string;
  matchesVin: (vin: string) => boolean;
  fetch: (vin: string, opts?: NormalizeOptions) => Promise<FactoryBuild>;
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
  fetch: async (vin, opts) => {
    const sticker = await getHyundaiSticker(vin);
    const providerId = sticker.source ? `hyundai_${sticker.source}` : "hyundai_dealerfire";
    return normalizeGenesisFamilySticker(sticker, { providerId, url: sticker.pdfUrl }, opts);
  },
};

export const genesisStickerProvider: StickerProvider = {
  id: "genesis_oem",
  make: "Genesis",
  matchesVin: isGenesisVin,
  fetch: async (vin, opts) => {
    const sticker = await getGenesisSticker(vin);
    return normalizeGenesisFamilySticker(sticker, { providerId: "genesis_oem", url: sticker.pdfUrl }, opts);
  },
};

export const fordStickerProvider: StickerProvider = {
  id: "ford_windowsticker",
  make: "Ford",
  matchesVin: isFordOrLincolnVin,
  fetch: async (vin, opts) => {
    const sticker = await getFordSticker(vin);
    return normalizeFordSticker(sticker, { providerId: "ford_windowsticker", url: sticker.pdfUrl }, opts);
  },
};

export const gmStickerProvider: StickerProvider = {
  id: "gm_cws",
  make: "GM",
  matchesVin: isGmVin,
  fetch: async (vin, opts) => {
    const sticker = await getGmSticker(vin);
    return normalizeGmSticker(sticker, { providerId: "gm_cws", url: sticker.pdfUrl }, opts);
  },
};

export const stellantisStickerProvider: StickerProvider = {
  id: "stellantis_hostd",
  make: "Stellantis",
  matchesVin: isStellantisVin,
  fetch: async (vin, opts) => {
    const sticker = await getStellantisSticker(vin);
    return normalizeStellantisSticker(sticker, { providerId: "stellantis_hostd", url: sticker.pdfUrl }, opts);
  },
};

/** Checked in order — hyundaiStickerProvider first so the shared 5NM WMI resolves the way getHyundaiSticker already handles it. The other four don't share a WMI with any of these. */
export const STICKER_PROVIDERS: StickerProvider[] = [
  hyundaiStickerProvider,
  genesisStickerProvider,
  fordStickerProvider,
  gmStickerProvider,
  stellantisStickerProvider,
];

export function stickerProviderForVin(vin: string): StickerProvider | null {
  return STICKER_PROVIDERS.find((p) => p.matchesVin(vin)) || null;
}
