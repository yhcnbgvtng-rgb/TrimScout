/**
 * Client-safe paste routing and shopper-facing factory-build errors.
 * Never substitute a catalog / demo VIN for the pasted one.
 */

import {
  isAudiVin,
  isBmwVin,
  isFordOrLincolnVin,
  isGenesisVin,
  isGmVin,
  isHondaVin,
  isHyundaiVin,
  isKiaVin,
  isMazdaVin,
  isMercedesVin,
  isMiniVin,
  isMitsubishiVin,
  isNissanVin,
  isPorscheVin,
  isStellantisVin,
  isSubaruVin,
  isToyotaVin,
  isVolkswagenVin,
  isVolvoVin,
  looksLikeAudiPaste,
  looksLikeBmwPaste,
  looksLikeFordPaste,
  looksLikeGenesisPaste,
  looksLikeGmPaste,
  looksLikeHondaPaste,
  looksLikeHyundaiPaste,
  looksLikeKiaPaste,
  looksLikeMazdaPaste,
  looksLikeMercedesPaste,
  looksLikeMiniPaste,
  looksLikeMitsubishiPaste,
  looksLikeNissanPaste,
  looksLikePorschePaste,
  looksLikeStellantisPaste,
  looksLikeSubaruPaste,
  looksLikeToyotaPaste,
  looksLikeVolkswagenPaste,
  looksLikeVolvoPaste,
  pastedVinCandidate,
} from "./oemWmi";
import type { Vehicle, BuildConfidence } from "./types";

export type FactoryBuildOem =
  | "ford"
  | "gm"
  | "stellantis"
  | "genesis"
  | "porsche"
  | "toyota"
  | "honda"
  | "nissan"
  | "hyundai"
  | "kia"
  | "subaru"
  | "mazda"
  | "volkswagen"
  | "audi"
  | "bmw"
  | "mini"
  | "mercedes"
  | "volvo"
  | "mitsubishi";
export type FactoryBuildEndpoint =
  | "/api/ford-sticker"
  | "/api/gm-sticker"
  | "/api/stellantis-sticker"
  | "/api/genesis-sticker"
  | "/api/porsche-sticker"
  | "/api/toyota-sticker"
  | "/api/honda-sticker"
  | "/api/nissan-sticker"
  | "/api/hyundai-sticker"
  | "/api/kia-sticker"
  | "/api/subaru-sticker"
  | "/api/mazda-sticker"
  | "/api/volkswagen-sticker"
  | "/api/audi-sticker"
  | "/api/bmw-sticker"
  | "/api/mini-sticker"
  | "/api/mercedes-sticker"
  | "/api/volvo-sticker"
  | "/api/mitsubishi-sticker";

export const PAUL_CHEVY_VIN = "2GC4KREY7T1167690";
export const MOCK_CATALOG_PORSCHE_VIN = "WP0AB2A98SS160032";

/**
 * Per-OEM "does this VIN belong to it" / "does this paste text mention it"
 * checks, keyed the same way across both — used to generalize dispatch and
 * the cross-fallback retry to any number of OEMs without hardcoding pairwise
 * branches. Order matters only as a tie-break when a VIN or paste text could
 * plausibly match more than one (should not happen in practice — the WMI
 * ranges and paste keywords don't overlap across OEMs; the one confirmed
 * near-collision, Genesis/Hyundai both touching WMI 5NM, is resolved inside
 * isHyundaiVin itself by excluding that prefix, not by ordering here).
 */
const OEM_ORDER: FactoryBuildOem[] = [
  "gm",
  "ford",
  "stellantis",
  "genesis",
  "porsche",
  "toyota",
  "honda",
  "nissan",
  "hyundai",
  "kia",
  "subaru",
  "mazda",
  "volkswagen",
  "audi",
  "bmw",
  "mini",
  "mercedes",
  "volvo",
  "mitsubishi",
];
const OEM_ENDPOINT: Record<FactoryBuildOem, FactoryBuildEndpoint> = {
  gm: "/api/gm-sticker",
  ford: "/api/ford-sticker",
  stellantis: "/api/stellantis-sticker",
  genesis: "/api/genesis-sticker",
  porsche: "/api/porsche-sticker",
  toyota: "/api/toyota-sticker",
  honda: "/api/honda-sticker",
  nissan: "/api/nissan-sticker",
  hyundai: "/api/hyundai-sticker",
  kia: "/api/kia-sticker",
  subaru: "/api/subaru-sticker",
  mazda: "/api/mazda-sticker",
  volkswagen: "/api/volkswagen-sticker",
  audi: "/api/audi-sticker",
  bmw: "/api/bmw-sticker",
  mini: "/api/mini-sticker",
  mercedes: "/api/mercedes-sticker",
  volvo: "/api/volvo-sticker",
  mitsubishi: "/api/mitsubishi-sticker",
};
const OEM_BY_ENDPOINT: Record<FactoryBuildEndpoint, FactoryBuildOem> = {
  "/api/gm-sticker": "gm",
  "/api/ford-sticker": "ford",
  "/api/stellantis-sticker": "stellantis",
  "/api/genesis-sticker": "genesis",
  "/api/porsche-sticker": "porsche",
  "/api/toyota-sticker": "toyota",
  "/api/honda-sticker": "honda",
  "/api/nissan-sticker": "nissan",
  "/api/hyundai-sticker": "hyundai",
  "/api/kia-sticker": "kia",
  "/api/subaru-sticker": "subaru",
  "/api/mazda-sticker": "mazda",
  "/api/volkswagen-sticker": "volkswagen",
  "/api/audi-sticker": "audi",
  "/api/bmw-sticker": "bmw",
  "/api/mini-sticker": "mini",
  "/api/mercedes-sticker": "mercedes",
  "/api/volvo-sticker": "volvo",
  "/api/mitsubishi-sticker": "mitsubishi",
};
const VIN_IS_OEM: Record<FactoryBuildOem, (vin: string) => boolean> = {
  gm: isGmVin,
  ford: isFordOrLincolnVin,
  stellantis: isStellantisVin,
  genesis: isGenesisVin,
  porsche: isPorscheVin,
  toyota: isToyotaVin,
  honda: isHondaVin,
  nissan: isNissanVin,
  hyundai: isHyundaiVin,
  kia: isKiaVin,
  subaru: isSubaruVin,
  mazda: isMazdaVin,
  volkswagen: isVolkswagenVin,
  audi: isAudiVin,
  bmw: isBmwVin,
  mini: isMiniVin,
  mercedes: isMercedesVin,
  volvo: isVolvoVin,
  mitsubishi: isMitsubishiVin,
};
const PASTE_LOOKS_LIKE_OEM: Record<FactoryBuildOem, (paste: string) => boolean> = {
  gm: looksLikeGmPaste,
  ford: looksLikeFordPaste,
  stellantis: looksLikeStellantisPaste,
  genesis: looksLikeGenesisPaste,
  porsche: looksLikePorschePaste,
  toyota: looksLikeToyotaPaste,
  honda: looksLikeHondaPaste,
  nissan: looksLikeNissanPaste,
  hyundai: looksLikeHyundaiPaste,
  kia: looksLikeKiaPaste,
  subaru: looksLikeSubaruPaste,
  mazda: looksLikeMazdaPaste,
  volkswagen: looksLikeVolkswagenPaste,
  audi: looksLikeAudiPaste,
  bmw: looksLikeBmwPaste,
  mini: looksLikeMiniPaste,
  mercedes: looksLikeMercedesPaste,
  volvo: looksLikeVolvoPaste,
  mitsubishi: looksLikeMitsubishiPaste,
};
/** e.g. "notPorsche" — the flag a listing-feed route uses to signal "not my VIN", so pasteImport falls through to another OEM. PDF-sticker OEMs (Ford/GM/Stellantis/Genesis) use the same shape. */
const NOT_FLAG: Record<FactoryBuildOem, string> = {
  gm: "notGm",
  ford: "notFord",
  stellantis: "notStellantis",
  genesis: "notGenesis",
  porsche: "notPorsche",
  toyota: "notToyota",
  honda: "notHonda",
  nissan: "notNissan",
  hyundai: "notHyundai",
  kia: "notKia",
  subaru: "notSubaru",
  mazda: "notMazda",
  volkswagen: "notVolkswagen",
  audi: "notAudi",
  bmw: "notBmw",
  mini: "notMini",
  mercedes: "notMercedes",
  volvo: "notVolvo",
  mitsubishi: "notMitsubishi",
};

/** True when some *other* OEM's paste heuristic also matches — a conflicting
 * signal, so the caller should not trust `self` for this paste. */
function otherOemLooksLikeToo(paste: string, self: FactoryBuildOem): boolean {
  return OEM_ORDER.some((oem) => oem !== self && PASTE_LOOKS_LIKE_OEM[oem](paste));
}

/** Pure VIN → endpoint, no paste-text heuristics — used for the
 * cross-fallback retry, where the VIN itself (not the original paste) is
 * already known. */
function endpointForVin(vin: string): FactoryBuildEndpoint | null {
  for (const oem of OEM_ORDER) {
    if (VIN_IS_OEM[oem](vin)) return OEM_ENDPOINT[oem];
  }
  return null;
}

/** The most a package holds: one primary and two alternates. */
export const MAX_PACKAGE_VEHICLES = 3;

/**
 * Hosts that are never a dealer's vehicle page. Not a security list — the
 * server has its own SSRF guard — just the places people paste by mistake,
 * so they get "that's not a listing" instead of "couldn't read a VIN".
 */
const NON_LISTING_HOSTS = [
  "google.com", "google.", "bing.com", "duckduckgo.com",
  "facebook.com", "instagram.com", "tiktok.com", "youtube.com", "youtu.be",
  "twitter.com", "x.com", "reddit.com", "linkedin.com", "pinterest.com",
  "wikipedia.org", "amazon.com", "ebay.com", "craigslist.org",
  "apple.com", "microsoft.com", "netflix.com",
];

export type PasteKind =
  | { kind: "vin"; vin: string }
  | { kind: "url"; url: URL }
  | { kind: "invalid"; reason: "invalid_input" | "unsupported_host"; error: string };

export function classifyPaste(raw: string): PasteKind {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return { kind: "invalid", reason: "invalid_input", error: "Paste a 17-character VIN or the link to a dealer's vehicle page." };
  }
  const vin = pastedVinCandidate(trimmed);
  if (vin && trimmed.length <= 24 && /^[A-HJ-NPR-Z0-9\s-]*$/i.test(trimmed)) {
    return { kind: "vin", vin };
  }
  if (/^https?:\/\//i.test(trimmed) || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
      return { kind: "invalid", reason: "invalid_input", error: "That link isn't a valid web address. Copy it again from the browser's address bar." };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { kind: "invalid", reason: "invalid_input", error: "That link isn't a valid web address. Copy it again from the browser's address bar." };
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (NON_LISTING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`) || (h.endsWith(".") && host.startsWith(h)))) {
      return {
        kind: "invalid",
        reason: "unsupported_host",
        error: `${host} isn't a dealer listing. Open the car's page on the dealership's own website and paste that link, or paste the 17-character VIN.`,
      };
    }
    return { kind: "url", url };
  }
  if (vin) return { kind: "vin", vin };
  return {
    kind: "invalid",
    reason: "invalid_input",
    error: "That's not a VIN or a link. Paste the 17-character VIN, or the link to the car's page on the dealer's site.",
  };
}

/** True when this VIN is already in the package. */
export function isDuplicateVehicle(vin: string | null | undefined, existing: Array<{ vin?: string } | null | undefined>): boolean {
  const want = (vin || "").trim().toUpperCase();
  if (want.length !== 17) return false;
  return existing.some((v) => (v?.vin || "").trim().toUpperCase() === want);
}

function blockedDealerFromJson(json: Record<string, unknown>): BlockedListingDealer | undefined {
  const d = json.dealer as Record<string, unknown> | undefined;
  if (!d || typeof d.name !== "string" || !d.name.trim()) return undefined;
  return {
    name: d.name.trim(),
    city: typeof d.city === "string" && d.city ? d.city : null,
    state: typeof d.state === "string" && d.state ? d.state : null,
  };
}

/**
 * Turns a server-side error message into a reason. The routes predate the
 * reason codes and only speak in prose, so this reads the prose.
 */
function reasonFromServerError(message: string, json: Record<string, unknown>): PasteImportFailureReason {
  if (json.dealerBlocked) return "blocked";
  if (/blocked/i.test(message)) return "blocked";
  if (/could not (read|find) a .*vin|17-character vin/i.test(message)) return "no_vin";
  if (/doesn't check out|check digit|couldn't read enough/i.test(message)) return "not_found";
  return "not_found";
}

export function factoryBuildUnavailableError(vin: string | null | undefined): string {
  const named = (vin || "").trim().toUpperCase();
  if (named.length === 17) {
    return `We don't have a factory build for VIN ${named} yet.`;
  }
  return "We don't have a factory build for this VIN yet.";
}

export function factoryBuildFailedError(vin: string | null | undefined, detail?: string): string {
  const named = (vin || "").trim().toUpperCase();
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (named.length === 17) {
    return `Could not load a factory build for VIN ${named}.`;
  }
  return "Could not load a factory build for that VIN.";
}

export function factoryBuildUnreleasedError(vin: string | null | undefined): string {
  const named = (vin || "").trim().toUpperCase();
  if (named.length === 17) {
    return `The factory build for VIN ${named} has not yet been released. Dealer ad copy is not proof — status is unconfirmed.`;
  }
  return "The factory build has not yet been released. Dealer ad copy is not proof — status is unconfirmed.";
}

export function preferredFactoryBuildEndpoint(paste: string): FactoryBuildEndpoint | null {
  const vin = pastedVinCandidate(paste);
  if (vin) {
    // A VIN's WMI is assigned by the manufacturer — when it names exactly one
    // OEM, that's the answer, and no guess made from the surrounding text gets
    // to veto it. The text heuristics used to be allowed to: a BMW listing at
    // a dealer in Rockford, IL tripped the Ford heuristic on "rockford", the
    // two "conflicted", and the paste fell through to the Ford route, which
    // refused the BMW VIN. Same failure for Hartford, Bradford, Stanford,
    // Medford, Milford, Oxford, Waterford — and any dealer with a city like
    // that in its URL.
    const byVin = OEM_ORDER.filter((oem) => VIN_IS_OEM[oem](vin));
    if (byVin.length === 1) return OEM_ENDPOINT[byVin[0]];
    // Two OEMs claim this WMI (shouldn't happen, but don't guess): let the
    // paste text break the tie, and only accept an unambiguous one.
    for (const oem of byVin) {
      if (!otherOemLooksLikeToo(paste, oem)) return OEM_ENDPOINT[oem];
    }
  }
  for (const oem of OEM_ORDER) {
    if (PASTE_LOOKS_LIKE_OEM[oem](paste) && !otherOemLooksLikeToo(paste, oem)) return OEM_ENDPOINT[oem];
  }
  return null;
}

export function vehicleVinMatchesPaste(
  vehicleVin: string | null | undefined,
  pastedVin: string | null | undefined
): boolean {
  const got = (vehicleVin || "").trim().toUpperCase();
  const want = (pastedVin || "").trim().toUpperCase();
  if (!got || got.length !== 17) return false;
  if (!want) return true;
  return got === want;
}

/** Drop a vehicle whose VIN is not the one the shopper pasted. Never a catalog stand-in. */
export function acceptImportedVehicle<T extends { vin?: string }>(
  vehicle: T | null | undefined,
  pastedVin: string | null | undefined
): T | null {
  if (!vehicle?.vin) return null;
  if (!vehicleVinMatchesPaste(vehicle.vin, pastedVin)) return null;
  return vehicle;
}

/**
 * A vehicle the buyer can actually be shown. "0 Ford F-150" — a released
 * sticker whose year the parser missed — used to sail through
 * acceptImportedVehicle because only the VIN was checked.
 */
export function hasUsableVehicleBasics(vehicle: { year?: number; make?: string } | null | undefined): boolean {
  if (!vehicle) return false;
  const year = Number(vehicle.year);
  return Number.isInteger(year) && year >= 1980 && year <= new Date().getFullYear() + 2 && Boolean((vehicle.make || "").trim());
}

export type FactoryFilterableOption = {
  name: string;
  code?: string | null;
  description?: string;
  price: number | null;
  isPackageChild?: boolean;
};

export type PasteImportSuccess = {
  ok: true;
  vehicle: Vehicle;
  oem: FactoryBuildOem;
  pdfUrl: string | null;
  msrp: number | null;
  mustHaveLines: string[];
  niceToHaveLines: string[];
  filterableOptions: FactoryFilterableOption[];
  /**
   * The import succeeded but there is no factory build behind it — the vehicle
   * came from a free VIN decode plus the listing page. Callers should not offer
   * must-have option matching on it, but the car itself is real.
   */
  factoryBuildUnavailable?: boolean;
  /** "verified_factory" when a real sticker/build sheet was read; otherwise "dealer_listing_only". */
  buildConfidence: BuildConfidence;
  /**
   * The listing page refused us (Cloudflare and friends); the VIN came from
   * the link and the dealer from the link's hostname. The UI must not add
   * the car silently — it opens the listing and asks the buyer to confirm.
   */
  pageUnread?: boolean;
};

/**
 * Why a paste didn't produce a vehicle. Every failure carries one, so the
 * UI can say what actually went wrong instead of a generic "couldn't read".
 *
 *   invalid_input    — not a VIN and not a URL
 *   unsupported_host — a URL to something that isn't a dealer listing
 *   blocked          — the dealer site refused our fetch
 *   no_vin           — page fetched, no VIN on it or in the URL
 *   not_found        — VIN read, but no vehicle could be built from it
 *   parse_failed     — a vehicle came back missing the basics (year/make)
 *   duplicate        — already in the package
 *   network          — the lookup itself failed
 */
export type PasteImportFailureReason =
  | "invalid_input"
  | "unsupported_host"
  | "blocked"
  | "no_vin"
  | "not_found"
  | "parse_failed"
  | "duplicate"
  | "network";

/** The store a blocked link belongs to, when the hostname resolved it. */
export type BlockedListingDealer = { name: string; city: string | null; state: string | null };

export type PasteImportFailure = {
  ok: false;
  error: string;
  reason: PasteImportFailureReason;
  unreleased?: boolean;
  oem?: FactoryBuildOem;
  pdfUrl?: string | null;
  /**
   * On "blocked": we know the dealership even though the page kept the
   * VIN from us. The UI opens the listing for the buyer and asks for the
   * VIN with the store already named, instead of a bare "paste the VIN".
   */
  dealer?: BlockedListingDealer;
  listingUrl?: string;
};

export type PasteImportResult = PasteImportSuccess | PasteImportFailure;

function interpretFactoryBuildJson(
  json: Record<string, unknown>,
  ok: boolean,
  oem: FactoryBuildOem,
  pastedVin: string | null
): PasteImportResult {
  const sticker = json.sticker as { status?: string; pdfUrl?: string; msrp?: number } | undefined;
  const responseVin =
    (typeof json.vin === "string" && json.vin.trim().toUpperCase()) || pastedVin || null;
  // An unreleased sticker's pdfUrl is the address we *tried*, not a document
  // — offering it as "Factory build" on an unconfirmed car sends the buyer to
  // a "not yet released" page. Only a released sticker has a sheet to link.
  const pdfUrl =
    (typeof json.pdfUrl === "string" && json.pdfUrl) ||
    (sticker?.status === "released" ? sticker.pdfUrl : null) ||
    null;

  if (!ok) {
    const serverError = typeof json.error === "string" ? json.error : "";
    return {
      ok: false,
      reason: reasonFromServerError(serverError, json),
      error: factoryBuildFailedError(responseVin, serverError || undefined),
    };
  }

  const matched = acceptImportedVehicle(json.vehicle as Vehicle | null, responseVin);

  // Every route now returns a vehicle when it has a VIN — an unreleased
  // sticker imports on the free path rather than as vehicle: null. So an
  // unreleased status with no vehicle means the free path itself failed.
  if (sticker?.status === "unreleased" && !matched) {
    return {
      ok: false,
      reason: "not_found",
      error: factoryBuildUnreleasedError(responseVin),
      unreleased: true,
      oem,
      pdfUrl,
    };
  }

  if (!matched) {
    return {
      ok: false,
      reason: "not_found",
      error: factoryBuildFailedError(
        responseVin,
        typeof json.error === "string" ? json.error : undefined
      ),
    };
  }

  // A vehicle with no year or make is a parser miss, not a car — never show
  // "0 Ford F-150" as though it were one.
  if (!hasUsableVehicleBasics(matched)) {
    return {
      ok: false,
      reason: "parse_failed",
      error: `We found VIN ${matched.vin} but couldn't read the vehicle's details from that page. Paste the 17-character VIN by itself, or try the listing's main page.`,
    };
  }

  const buildConfidence: BuildConfidence =
    json.buildConfidence === "verified_factory"
      ? "verified_factory"
      : json.buildConfidence === "dealer_listing_only" || sticker?.status === "unreleased"
        ? "dealer_listing_only"
        : matched.buildConfidence || "verified_factory";

  return {
    ok: true,
    vehicle: { ...matched, buildConfidence },
    buildConfidence,
    pageUnread: json.pageUnread === true,
    oem,
    pdfUrl: pdfUrl || matched.oemBuildSheetUrl || null,
    msrp: typeof sticker?.msrp === "number" && sticker.msrp > 0 ? sticker.msrp : null,
    mustHaveLines: Array.isArray(json.mustHaveLines)
      ? json.mustHaveLines.map(String).filter(Boolean)
      : [],
    niceToHaveLines: Array.isArray(json.niceToHaveLines)
      ? json.niceToHaveLines.map(String).filter(Boolean)
      : [],
    filterableOptions: Array.isArray(json.filterableOptions)
      ? (json.filterableOptions as FactoryFilterableOption[])
      : [],
    factoryBuildUnavailable: sticker?.status === "unreleased",
  };
}

/**
 * Same Ford Direct / GM CWS factory-build import the wizard uses.
 * Never swaps in a catalog VIN. Callers must mock fetch in tests.
 */
export async function importPastedFactoryVehicle(
  paste: string,
  fetchImpl: typeof fetch = fetch,
  options: {
    existingVehicles?: Array<{ vin?: string } | null | undefined>;
    /**
     * A VIN the buyer read off a listing we couldn't: sent alongside the
     * link so the route keeps the link's dealership and skips the page.
     */
    vin?: string;
  } = {}
): Promise<PasteImportResult> {
  const raw = paste.trim();
  const suppliedVin = (options.vin || "").trim().toUpperCase();

  // Say what's wrong before spending a network round-trip on it.
  const kind = classifyPaste(raw);
  if (kind.kind === "invalid") {
    return { ok: false, reason: kind.reason, error: kind.error };
  }
  if (suppliedVin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(suppliedVin)) {
    return {
      ok: false,
      reason: "invalid_input",
      error: "A VIN is 17 letters and digits, with no I, O or Q. Copy it again from the listing.",
    };
  }
  const pastedVin = suppliedVin || pastedVinCandidate(raw);
  if (options.existingVehicles && isDuplicateVehicle(pastedVin, options.existingVehicles)) {
    return {
      ok: false,
      reason: "duplicate",
      error: `VIN ${pastedVin} is already in your package. Paste a different vehicle.`,
    };
  }

  try {
    // A supplied VIN settles the make outright — no guessing from the URL.
    const endpoint =
      (suppliedVin ? endpointForVin(suppliedVin) : null) || preferredFactoryBuildEndpoint(raw) || "/api/ford-sticker";
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(suppliedVin ? { paste: raw, vin: suppliedVin } : { paste: raw }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const jsonVin =
      typeof json.vin === "string" ? json.vin.trim().toUpperCase() : pastedVin;

    if (json.needsVin || json.dealerBlocked) {
      const message =
        (typeof json.error === "string" && json.error) ||
        "Could not read a VIN from that page. Paste the 17-character VIN.";
      return {
        ok: false,
        reason: reasonFromServerError(message, json),
        error: message,
        dealer: blockedDealerFromJson(json),
        listingUrl: typeof json.listingUrl === "string" && json.listingUrl ? json.listingUrl : undefined,
      };
    }

    // A URL with no VIN in it only reveals its VIN once the first route has
    // read the page — so the duplicate check has to run again here, before
    // any retry spends a second round-trip on a car already in the package.
    if (jsonVin && options.existingVehicles && isDuplicateVehicle(jsonVin, options.existingVehicles)) {
      return {
        ok: false,
        reason: "duplicate",
        error: `VIN ${jsonVin} is already in your package. Paste a different vehicle.`,
      };
    }

    const triedOem = OEM_BY_ENDPOINT[endpoint];
    const notThisOem = Boolean(json[NOT_FLAG[triedOem]]);
    if (notThisOem && json.handled === false) {
      const retryEndpoint = jsonVin ? endpointForVin(jsonVin) : null;
      if (retryEndpoint && retryEndpoint !== endpoint) {
        const retryRes = await fetchImpl(retryEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paste: raw, vin: jsonVin }),
        });
        const retryJson = (await retryRes.json().catch(() => ({}))) as Record<string, unknown>;
        return interpretFactoryBuildJson(retryJson, retryRes.ok, OEM_BY_ENDPOINT[retryEndpoint], jsonVin);
      }
      return { ok: false, reason: "not_found", error: factoryBuildUnavailableError(jsonVin || pastedVin) };
    }

    return interpretFactoryBuildJson(json, res.ok, triedOem, jsonVin || pastedVin);
  } catch (err: unknown) {
    return { ok: false, reason: "network", error: err instanceof Error ? err.message : "Lookup failed" };
  }
}
