/**
 * Porsche factory build — sourced from the dealer's own equipment feed as
 * carried by MarketCheck's listing detail, not from a window sticker.
 *
 * Why not a sticker: Porsche publishes no public per-VIN sticker endpoint,
 * Porsche Finder is behind Vercel bot mitigation, and dealer VDPs
 * (Dealer.com) 403 any server-side fetch. All three confirmed live on
 * 2026-09-04. What *is* reachable, under the listings contract we already
 * have, is `GET /v2/listing/car/{id}` — whose `extra` block carries the
 * dealer feed's `options_packages` (the installed Porsche factory option
 * codes, e.g. PU5 / 3FU / KA6) and `high_value_features` typed
 * Optional vs. Standard. That is the sticker's option block, by code.
 * Confirmed against a real 2026 Macan (WP1AA2A53TLB07942) whose Dealer.com
 * VDP listed the same packages at the same prices.
 *
 * Two calls per import (search-by-VIN → listing detail), the same two
 * lib/listingSheet.ts already makes for every vehicle in a deal. No sticker
 * PDF, no per-option retail prices from the provider — prices come only
 * from PORSCHE_OPTION_CODES below, and only where actually known. Unknown
 * is reported as unknown (null), never as $0 and never guessed.
 */

import { isPorscheVin, looksLikePorschePaste } from "./oemWmi";
import { marketcheckGet, marketcheckUrl } from "./listingSheet";
import { listingVdpHref } from "./fordCompetitionUi";
import { serverSecret } from "./serverSecret";
import type { FactoryFilterableOption } from "./pasteImport";
import type { Vehicle } from "./types";

export { isPorscheVin, looksLikePorschePaste };

export type PorscheBuildStatus = "found" | "not_found" | "error";

export type PorscheOptionCategory = "package" | "exterior" | "interior" | "performance" | "tech" | "option";

export interface PorscheOptionLine {
  /** Porsche PR code when the feed gave one (e.g. "KA6"); null for a feature the feed named but didn't code. */
  code: string | null;
  name: string;
  /** Retail price when known from the catalog; null when Porsche/the feed didn't say. Never 0-as-unknown. */
  price: number | null;
  category: PorscheOptionCategory;
  /** "code" = from options_packages (a real installed PR code); "feature" = from a typed-Optional high-value feature. */
  source: "code" | "feature";
}

export interface PorscheBuild {
  status: PorscheBuildStatus;
  vin: string;
  year: number | null;
  make: "Porsche";
  model: string;
  trim: string | null;
  /** The listing's MSRP as reported by the dealer feed. */
  msrp: number | null;
  /** The dealer's advertised price for this exact VIN. */
  listingPrice: number | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  bodyType: string | null;
  /** Raw installed PR codes straight from the feed, in feed order. */
  optionCodes: string[];
  options: PorscheOptionLine[];
  standardFeatures: string[];
  dealer: {
    name: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
  vdpUrl: string | null;
  note?: string;
}

/**
 * Porsche PR option codes → names (and prices only where actually known).
 *
 * Names are Porsche's own option designations for these codes. Prices are
 * included only when confirmed against a real dealer listing for the
 * model/year noted — everything else is null on purpose: a wrong price is
 * worse than no price on a page that exists to negotiate one. Extend per
 * model year as real listings confirm more.
 */
export const PORSCHE_OPTION_CODES: Record<
  string,
  { name: string; price: number | null; category: PorscheOptionCategory; confirmedOn?: string }
> = {
  // Confirmed on 2026 Macan WP1AA2A53TLB07942 (Paul Miller Porsche, Dealer.com VDP, 2026-09-04).
  PU5: { name: "Premium Package Plus", price: 3790, category: "package", confirmedOn: "2026 Macan" },
  KA6: { name: "Surround View", price: 1240, category: "tech", confirmedOn: "2026 Macan" },
  "1NP": { name: "Wheel Center Caps with Colored Porsche Crest", price: 200, category: "exterior", confirmedOn: "2026 Macan" },
  "2ZH": { name: "Heated Multifunction Steering Wheel", price: 280, category: "interior", confirmedOn: "2026 Macan" },
  // Named only — installed on the same VIN inside Premium Package Plus or as standard, so no standalone price was shown.
  "3FU": { name: "Panoramic Roof System", price: null, category: "exterior" },
  Q2J: { name: "14-Way Power Seats with Memory Package", price: null, category: "interior" },
  "8IU": { name: "LED Headlights with Porsche Dynamic Light System Plus (PDLS+)", price: null, category: "tech" },
  "4A4": { name: "Seat Heating (Front and Rear)", price: null, category: "interior" },
  "4D3": { name: "Seat Ventilation (Front)", price: null, category: "interior" },
  "7Y1": { name: "Lane Change Assist (LCA)", price: null, category: "tech" },
  // Widely documented Porsche codes, names only.
  "8LH": { name: "Sport Chrono Package", price: null, category: "performance" },
  "0P8": { name: "Sport Exhaust System", price: null, category: "performance" },
  "1BK": { name: "Porsche Active Suspension Management (PASM)", price: null, category: "performance" },
  "1P6": { name: "Adaptive Air Suspension incl. PASM", price: null, category: "performance" },
  "3G5": { name: "Rear Axle Steering", price: null, category: "performance" },
  "0N5": { name: "Sport Exhaust System in Black", price: null, category: "performance" },
  "9VL": { name: "BOSE Surround Sound System", price: null, category: "tech" },
  "9VJ": { name: "Burmester High-End Surround Sound System", price: null, category: "tech" },
  "4A3": { name: "Seat Heating (Front)", price: null, category: "interior" },
  "1LL": { name: "Porsche Ceramic Composite Brakes (PCCB)", price: null, category: "performance" },
  "8T3": { name: "Adaptive Cruise Control", price: null, category: "tech" },
  "9WT": { name: "Apple CarPlay / Porsche Connect", price: null, category: "tech" },
  "4X4": { name: "Side Airbags in Rear", price: null, category: "interior" },
  "6XE": { name: "Exterior Mirrors Folding, incl. Auto-Dimming", price: null, category: "exterior" },
};

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  return null;
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const s = str(item);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function normalizeCode(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  const code = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{2,4}$/.test(code) ? code : null;
}

/** Name for a code the catalog doesn't know yet — honest, not invented. */
export function unknownCodeName(code: string): string {
  return `Porsche factory option ${code}`;
}

/**
 * Pure parser: MarketCheck search row + listing-detail payload → PorscheBuild.
 * Exported so tests can drive it with real captured shapes and no HTTP.
 */
export function porscheBuildFromMarketCheck(
  vin: string,
  searchRow: unknown,
  listingDetail: unknown
): PorscheBuild {
  const row = rec(searchRow) || {};
  const detail = rec(listingDetail) || {};
  const build = rec(detail.build) || rec(row.build) || {};
  const extra = rec(detail.extra) || {};
  const dealer = rec(detail.dealer) || rec(row.dealer) || {};

  const codes: string[] = [];
  const seenCodes = new Set<string>();
  if (Array.isArray(extra.options_packages)) {
    for (const item of extra.options_packages) {
      const code = normalizeCode(item);
      if (!code || seenCodes.has(code)) continue;
      seenCodes.add(code);
      codes.push(code);
    }
  }

  const options: PorscheOptionLine[] = codes.map((code) => {
    const known = PORSCHE_OPTION_CODES[code];
    return {
      code,
      name: known?.name || unknownCodeName(code),
      price: known?.price ?? null,
      category: known?.category || "option",
      source: "code",
    };
  });

  // Typed-Optional high-value features: named, uncoded, unpriced. Skip any
  // that a code above already names, so "Surround View" doesn't show twice.
  const named = new Set(options.map((o) => o.name.toLowerCase()));
  if (Array.isArray(extra.high_value_features)) {
    for (const item of extra.high_value_features) {
      const f = rec(item);
      if (!f) continue;
      if (str(f.type)?.toLowerCase() !== "optional") continue;
      const name = str(f.description);
      if (!name) continue;
      const key = name.toLowerCase();
      if (named.has(key)) continue;
      named.add(key);
      options.push({ code: null, name, price: null, category: "option", source: "feature" });
    }
  }

  const standardFeatures = Array.isArray(extra.high_value_features)
    ? strList(
        extra.high_value_features
          .map((item) => {
            const f = rec(item);
            return f && str(f.type)?.toLowerCase() === "standard" ? f.description : null;
          })
          .filter(Boolean)
      )
    : [];

  const model = str(build.model) || "";
  const status: PorscheBuildStatus = model ? "found" : "not_found";

  return {
    status,
    vin,
    year: num(build.year),
    make: "Porsche",
    model,
    trim: str(build.trim) || str(build.version),
    msrp: num(detail.msrp) ?? num(row.msrp),
    listingPrice: num(detail.price) ?? num(row.price),
    exteriorColor: str(detail.exterior_color) || str(row.exterior_color),
    interiorColor: str(detail.interior_color) || str(row.interior_color),
    engine: str(build.engine),
    transmission: str(build.transmission),
    drivetrain: str(build.drivetrain),
    bodyType: str(build.body_type),
    optionCodes: codes,
    options,
    standardFeatures,
    dealer: {
      name: str(dealer.name),
      city: str(dealer.city),
      state: str(dealer.state),
      zip: str(dealer.zip),
    },
    vdpUrl: listingVdpHref(str(detail.vdp_url) || str(row.vdp_url)),
    note:
      status === "found" && options.some((o) => o.price === null)
        ? "Factory options come from the dealer's live listing. Prices are shown only where Porsche's option price is known."
        : undefined,
  };
}

function emptyBuild(vin: string, status: PorscheBuildStatus, note: string): PorscheBuild {
  return {
    status,
    vin,
    year: null,
    make: "Porsche",
    model: "",
    trim: null,
    msrp: null,
    listingPrice: null,
    exteriorColor: null,
    interiorColor: null,
    engine: null,
    transmission: null,
    drivetrain: null,
    bodyType: null,
    optionCodes: [],
    options: [],
    standardFeatures: [],
    dealer: { name: null, city: null, state: null, zip: null },
    vdpUrl: null,
    note,
  };
}

/**
 * Search-by-VIN, then listing detail — the only two calls. A VIN with no
 * active listing is reported as not_found, never padded from a catalog.
 */
export async function getPorscheBuild(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<PorscheBuild> {
  const clean = vin.trim().toUpperCase();
  if (!isPorscheVin(clean)) return emptyBuild(clean, "error", "Not a Porsche VIN.");
  const key = opts?.apiKey !== undefined ? opts.apiKey : serverSecret("MARKETCHECK_API_KEY");
  if (!key) return emptyBuild(clean, "error", "Live listings provider is not configured.");
  const fetchImpl = opts?.fetchImpl || fetch;

  const searchRes = await marketcheckGet(fetchImpl, marketcheckUrl("/v2/search/car/active", key, { vin: clean }));
  if (!searchRes.ok) {
    return emptyBuild(clean, searchRes.empty ? "not_found" : "error", searchRes.note);
  }
  const payload = rec(searchRes.payload) || {};
  const first = Array.isArray(payload.listings) ? rec(payload.listings[0]) : null;
  if (!first) {
    return emptyBuild(clean, "not_found", `No active dealer listing found for VIN ${clean} — factory options come from the dealer's live listing.`);
  }
  const listingId = str(first.id);
  let detail: unknown = null;
  if (listingId) {
    const detailRes = await marketcheckGet(fetchImpl, marketcheckUrl(`/v2/listing/car/${encodeURIComponent(listingId)}`, key));
    if (detailRes.ok) detail = detailRes.payload;
  }
  return porscheBuildFromMarketCheck(clean, first, detail);
}

export function filterableFactoryOptions(build: PorscheBuild): FactoryFilterableOption[] {
  return build.options.map((o) => ({
    name: o.name,
    code: o.code,
    description: o.code ? `${o.code}  ${o.name}` : o.name,
    price: o.price,
    isPackageChild: false,
  }));
}

export function defaultMustHaveLines(_build?: PorscheBuild): string[] {
  return [];
}

/** Coded (real PR-code) options first — those are the ones a buyer actually shops by. */
export function defaultNiceToHaveLines(build: PorscheBuild, mustHaves: string[]): string[] {
  const taken = new Set(mustHaves.map((s) => s.toLowerCase()));
  return build.options
    .filter((o) => o.source === "code" && !taken.has(o.name.toLowerCase()))
    .map((o) => o.name);
}

function optionCategory(cat: PorscheOptionCategory): Vehicle["options"][number]["category"] {
  if (cat === "package") return "package";
  if (cat === "exterior") return "exterior";
  if (cat === "interior") return "interior";
  if (cat === "performance") return "performance";
  return "standalone";
}

export function porscheBuildToVehicle(build: PorscheBuild, listingUrl: string | null): Vehicle {
  const title = build.model || "Porsche";
  return {
    id: `porsche-${build.vin}`,
    vin: build.vin,
    year: build.year || 0,
    make: "Porsche",
    model: title,
    trim: build.trim || "",
    bodyType: build.bodyType || "",
    engine: build.engine || "",
    drivetrain: build.drivetrain || "",
    transmission: build.transmission || "",
    exteriorColor: build.exteriorColor || "",
    interiorColor: build.interiorColor || "",
    msrp: build.msrp || 0,
    dealerPrice: build.listingPrice || 0,
    daysOnLot: 0,
    status: "on_lot",
    condition: "new",
    location: {
      dealerName: build.dealer.name || "",
      city: build.dealer.city || "",
      state: build.dealer.state || "",
      zip: build.dealer.zip || undefined,
      distanceMiles: 0,
      dealerConfirmed: !!build.dealer.name,
    },
    packages: build.options.map((o) => o.name),
    // Vehicle.options.price is a required number; an unknown Porsche option
    // price is carried as 0 here and the UI already hides $0 prices, so it
    // reads as "no price shown," not "no cost." The build itself keeps null.
    options: build.options.map((o) => ({
      code: o.code || "",
      name: o.name,
      price: o.price ?? 0,
      category: optionCategory(o.category),
    })),
    imageUrl: "",
    mileage: 0,
    dealerUrl: listingUrl || build.vdpUrl || undefined,
  };
}
