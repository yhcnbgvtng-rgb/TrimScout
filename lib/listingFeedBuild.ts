/**
 * Factory build from the dealer's own equipment feed, as carried by
 * MarketCheck's listing detail — the shared engine behind the Porsche,
 * Toyota, and Honda sticker routes.
 *
 * Why a feed and not a sticker: these makes publish no public per-VIN
 * sticker endpoint, and dealer VDPs 403 any server-side fetch (confirmed
 * live 2026-09-04). What *is* reachable, under the listings contract we
 * already have, is `GET /v2/listing/car/{id}`, whose `extra` block carries
 * the dealer feed. Three tiers, in order of how much they say:
 *
 *   1. `options_packages` — the installed factory option/package codes
 *      (Porsche PR codes like KA6, Toyota codes like CY/DA, Honda codes like
 *      18BR). Named via the make's catalog; an unknown code is named
 *      honestly, never guessed.
 *   2. `high_value_features` typed "Optional" — named, uncoded, unpriced.
 *   3. `options` — the dealer feed's equipment lines, minus universal
 *      baseline equipment (airbags, power windows, cupholders…). This is
 *      where a make with no codes (most Hondas) actually lists its
 *      equipment.
 *
 * Two calls per import (search-by-VIN → listing detail), the same two
 * lib/listingSheet.ts already makes for every vehicle in a deal. No
 * per-option prices come from the provider — prices appear only from a
 * make's catalog, and only where confirmed. Unknown is null, never 0.
 */

import { marketcheckGet, marketcheckUrl } from "./listingSheet";
import { listingVdpHref } from "./fordCompetitionUi";
import { serverSecret } from "./serverSecret";
import type { FactoryFilterableOption } from "./pasteImport";
import type { Vehicle } from "./types";

export type ListingFeedBuildStatus = "found" | "not_found" | "error";

export type ListingFeedOptionCategory =
  | "package"
  | "exterior"
  | "interior"
  | "performance"
  | "tech"
  | "option";

export interface ListingFeedOptionLine {
  /** Factory option code when the feed gave one (e.g. "KA6", "CY", "18BR"); null for a named-only line. */
  code: string | null;
  name: string;
  /** Full feed text when `name` is a shortened form of it. */
  description?: string;
  /** Retail price when the make's catalog knows it; null when nobody said. Never 0-as-unknown. */
  price: number | null;
  category: ListingFeedOptionCategory;
  /** "code" = options_packages; "feature" = typed-Optional high-value feature; "listing" = dealer equipment line. */
  source: "code" | "feature" | "listing";
}

export interface ListingFeedBuild {
  status: ListingFeedBuildStatus;
  vin: string;
  year: number | null;
  /** As reported by the feed's decoded build (so a Toyota-group VIN can come back "Lexus"). */
  make: string;
  model: string;
  trim: string | null;
  msrp: number | null;
  listingPrice: number | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  bodyType: string | null;
  /** Raw installed codes straight from the feed, normalized, in feed order. */
  optionCodes: string[];
  options: ListingFeedOptionLine[];
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

export interface OptionCodeEntry {
  name: string;
  price: number | null;
  category: ListingFeedOptionCategory;
  /** Which real listing the price was confirmed against, when it was. */
  confirmedOn?: string;
}

export interface ListingFeedMake {
  /** Route/dispatch key — also the Vehicle id prefix. */
  key: string;
  /** Human label used in honest unknown-code names and the fallback make. */
  label: string;
  isVin: (vin: string) => boolean;
  catalog: Record<string, OptionCodeEntry>;
  /**
   * The feed's raw exterior color → the name a shopper recognizes (Porsche
   * sends its paint as a doubled order code, "0Q0Q"). Absent = pass through.
   */
  exteriorColorName?: (raw: string) => string;
}

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().replace(/\s+/g, " ");
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

function namedExteriorColor(make: Pick<ListingFeedMake, "exteriorColorName">, raw: string | null): string | null {
  return raw && make.exteriorColorName ? make.exteriorColorName(raw) : raw;
}

function normalizeCode(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  const code = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{2,5}$/.test(code) ? code : null;
}

/** Dedupe key: case/punctuation-insensitive, and blind to a trailing parenthetical. */
function nameKey(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Equipment every new vehicle lists regardless of trim or options — the
 * vocabulary is shared across dealer platforms and feeds, so one list
 * covers Porsche, Toyota, and Honda alike. Anything matching is standard
 * kit, not a factory option a buyer shops by.
 */
export const BASELINE_EQUIPMENT = [
  /airbag/i,
  /\babs\b|anti-lock|4-wheel disc brakes|four wheel disc|disc brakes/i,
  /brake assist|traction control|electronic stability|stability control/i,
  /power (windows|steering|door mirrors|door locks)/i,
  /bumpers?: body-colou?r|body-colou?r bumpers/i,
  /vanity mirror|door bin|reading lights?|beverage holders?|cup ?holders?/i,
  /trip computer|tachometer|compass|outside temperature display|clock/i,
  /illuminated entry|panic alarm|security system|ignition disable/i,
  /^speed control$|^cruise control$/i,
  /tilt steering|telescoping steering|tilt\/telescop/i,
  /rear window defroster|variably intermittent wipers|speed-sensitive wipers|delay-off headlights|fully automatic headlights/i,
  /low tire pressure|tire pressure (monitor|warning)|occupant sensing/i,
  /overhead console|overhead airbag|front anti-roll|rear anti-roll|anti-roll bar/i,
  /four wheel independent suspension|independent suspension|speed-sensing steering/i,
  /split folding rear seat|rear seat center armrest|front center armrest|seatback storage/i,
  /radio data system|am\/fm radio|diversity antenna|steering wheel mounted audio/i,
  /remote keyless entry|keyless entry/i,
  /50 state emissions|emissions/i,
  /rear window wiper|heated door mirrors|turn signal indicator mirrors|auto-dimming door mirrors/i,
  /front dual zone a\/c|air conditioning|automatic temperature control|climate control/i,
  /driver door bin|passenger door bin|front reading|rear reading/i,
  /^wheels?: |alloy wheels|steel wheels/i,
  /spoiler|exterior parking camera rear|backup camera|rearview camera/i,
  /apple carplay|android auto|bluetooth|usb|smart device integration/i,
  /trip odometer|digital odometer|garage door transmitter|homelink/i,
  /^power (driver|passenger) seat$|^front bucket seats$|cloth seat trim|^[a-z-]+ seat trim$/i,
];

export function isBaselineEquipment(line: string): boolean {
  return BASELINE_EQUIPMENT.some((re) => re.test(line));
}

/**
 * Brand camel-words that a lowercase→Capital boundary must never split.
 * ("Wireless Apple CarPlay" is not "Wireless Apple Car".)
 */
const PROTECTED_CAMEL = new Set([
  "carplay", "hondalink", "homelink", "ecoboost", "bluecruise", "onstar", "softex", "siriusxm",
  "powershift", "safetysense", "toyotacare", "uconnect", "hondasensing", "idrive", "mbux", "supercruise",
]);

/**
 * Feed equipment lines often arrive as a name glued to its own description
 * — either doubled ("Cold Weather Package Cold Weather PackageHeated
 * leather…", "Mudguards Mudguards help protect…") or just run together
 * ("…PackageHeated leather…"). Return the short name and the rest as the
 * description; leave an ordinary line alone.
 */
export function splitEquipmentLine(line: string): { name: string; description: string | null } {
  const cleaned = line.replace(/\s+/g, " ").trim();
  const lower = cleaned.toLowerCase();

  // 1. Doubled name: the longest prefix that immediately repeats itself
  //    (case-insensitively — Toyota writes "Package … package").
  let doubledAt = -1;
  for (let i = 4; i < cleaned.length; i++) {
    if (cleaned[i] !== " ") continue;
    if (lower.startsWith(lower.slice(0, i), i + 1)) doubledAt = i;
  }
  if (doubledAt > 0) {
    const name = cleaned.slice(0, doubledAt).trim();
    const rest = cleaned.slice(doubledAt + 1 + name.length).replace(/^[\s:,\-–—.]+/, "").trim();
    return { name: name.slice(0, 90), description: rest || null };
  }

  // 2. Glued sentence: split at a lowercase→Capital boundary, unless it sits
  //    inside a brand camel-word or right after a short word.
  const boundary = /(?<=[a-z0-9)])(?=[A-Z][a-z])/g;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(cleaned))) {
    boundary.lastIndex = m.index + 1; // zero-width match — advance by hand
    const idx = m.index;
    const leftWord = (cleaned.slice(0, idx).match(/[A-Za-z0-9]+$/) || [""])[0];
    const rightWord = (cleaned.slice(idx).match(/^[A-Za-z0-9]+/) || [""])[0];
    if (leftWord.length < 5) continue;
    if (PROTECTED_CAMEL.has((leftWord + rightWord).toLowerCase())) continue;
    return { name: cleaned.slice(0, idx).trim().slice(0, 90), description: cleaned.slice(idx).trim() || null };
  }

  return { name: cleaned.slice(0, 90), description: cleaned.length > 90 ? cleaned : null };
}

export function equipmentLineName(line: string): string {
  return splitEquipmentLine(line).name;
}

/** Honest name for a code the make's catalog doesn't know yet. */
export function unknownCodeName(makeLabel: string, code: string): string {
  return `${makeLabel} factory option ${code}`;
}

/** Pure parser: MarketCheck search row + listing detail → build. Exported for tests. */
export function buildFromMarketCheck(
  make: Pick<ListingFeedMake, "label" | "catalog" | "exteriorColorName">,
  vin: string,
  searchRow: unknown,
  listingDetail: unknown
): ListingFeedBuild {
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

  const options: ListingFeedOptionLine[] = codes.map((code) => {
    const known = make.catalog[code];
    return {
      code,
      name: known?.name || unknownCodeName(make.label, code),
      price: known?.price ?? null,
      category: known?.category || "option",
      source: "code",
    };
  });
  const named = new Set(options.map((o) => nameKey(o.name)));

  const hv = Array.isArray(extra.high_value_features) ? extra.high_value_features : [];
  for (const item of hv) {
    const f = rec(item);
    if (!f || str(f.type)?.toLowerCase() !== "optional") continue;
    const name = str(f.description);
    if (!name || named.has(nameKey(name))) continue;
    named.add(nameKey(name));
    options.push({ code: null, name, price: null, category: "option", source: "feature" });
  }

  if (Array.isArray(extra.options)) {
    for (const item of extra.options) {
      const line = str(item);
      if (!line) continue;
      // Judge baseline-ness by the shortened name, not the whole line — a
      // "Convenience Package … HomeLink …" line is a package, not HomeLink.
      const { name, description } = splitEquipmentLine(line);
      if (!name || isBaselineEquipment(name) || named.has(nameKey(name))) continue;
      named.add(nameKey(name));
      options.push({
        code: null,
        name,
        description: description ? description.slice(0, 240) : undefined,
        price: null,
        category: /package/i.test(name) ? "package" : "option",
        source: "listing",
      });
    }
  }

  const standardFeatures: string[] = [];
  const seenStd = new Set<string>();
  for (const item of hv) {
    const f = rec(item);
    if (!f || str(f.type)?.toLowerCase() !== "standard") continue;
    const name = str(f.description);
    if (!name || seenStd.has(nameKey(name))) continue;
    seenStd.add(nameKey(name));
    standardFeatures.push(name);
  }

  const model = str(build.model) || "";
  const status: ListingFeedBuildStatus = model ? "found" : "not_found";

  return {
    status,
    vin,
    year: num(build.year),
    make: str(build.make) || make.label,
    model,
    trim: str(build.trim) || str(build.version),
    msrp: num(detail.msrp) ?? num(row.msrp),
    listingPrice: num(detail.price) ?? num(row.price),
    exteriorColor: namedExteriorColor(make, str(detail.exterior_color) || str(row.exterior_color)),
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
        ? `Factory options come from the dealer's live listing. Prices are shown only where ${make.label}'s option price is known.`
        : undefined,
  };
}

export function emptyBuild(makeLabel: string, vin: string, status: ListingFeedBuildStatus, note: string): ListingFeedBuild {
  return {
    status,
    vin,
    year: null,
    make: makeLabel,
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
export async function getListingFeedBuild(
  make: ListingFeedMake,
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<ListingFeedBuild> {
  const clean = vin.trim().toUpperCase();
  if (!make.isVin(clean)) return emptyBuild(make.label, clean, "error", `Not a ${make.label} VIN.`);
  const key = opts?.apiKey !== undefined ? opts.apiKey : serverSecret("MARKETCHECK_API_KEY");
  if (!key) return emptyBuild(make.label, clean, "error", "Live listings provider is not configured.");
  const fetchImpl = opts?.fetchImpl || fetch;

  const searchRes = await marketcheckGet(fetchImpl, marketcheckUrl("/v2/search/car/active", key, { vin: clean }));
  if (!searchRes.ok) {
    return emptyBuild(make.label, clean, searchRes.empty ? "not_found" : "error", searchRes.note);
  }
  const payload = rec(searchRes.payload) || {};
  const first = Array.isArray(payload.listings) ? rec(payload.listings[0]) : null;
  if (!first) {
    return emptyBuild(
      make.label,
      clean,
      "not_found",
      `No active dealer listing found for VIN ${clean} — factory options come from the dealer's live listing.`
    );
  }
  const listingId = str(first.id);
  let detail: unknown = null;
  if (listingId) {
    const detailRes = await marketcheckGet(
      fetchImpl,
      marketcheckUrl(`/v2/listing/car/${encodeURIComponent(listingId)}`, key)
    );
    if (detailRes.ok) detail = detailRes.payload;
  }
  return buildFromMarketCheck(make, clean, first, detail);
}

export function filterableFactoryOptions(build: ListingFeedBuild): FactoryFilterableOption[] {
  // The picker shows `description`, so keep it the short name — the feed's
  // glued long text stays on the build, not in the checkbox label.
  return build.options.map((o) => ({
    name: o.name,
    code: o.code,
    description: o.code ? `${o.code}  ${o.name}` : o.name,
    price: o.price,
    // Dealer equipment lines sit a step below coded options in the picker.
    isPackageChild: o.source === "listing",
  }));
}

export function defaultMustHaveLines(_build?: ListingFeedBuild): string[] {
  return [];
}

/** Coded options and typed-Optional features first — what a buyer actually shops by. */
export function defaultNiceToHaveLines(build: ListingFeedBuild, mustHaves: string[]): string[] {
  const taken = new Set(mustHaves.map(nameKey));
  return build.options
    .filter((o) => o.source !== "listing" && !taken.has(nameKey(o.name)))
    .map((o) => o.name);
}

function optionCategory(cat: ListingFeedOptionCategory): Vehicle["options"][number]["category"] {
  if (cat === "package") return "package";
  if (cat === "exterior") return "exterior";
  if (cat === "interior") return "interior";
  if (cat === "performance") return "performance";
  return "standalone";
}

export function buildToVehicle(makeKey: string, build: ListingFeedBuild, listingUrl: string | null): Vehicle {
  return {
    id: `${makeKey}-${build.vin}`,
    vin: build.vin,
    year: build.year || 0,
    make: build.make,
    model: build.model || build.make,
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
    packages: build.options.filter((o) => o.source !== "listing").map((o) => o.name),
    // Vehicle.options.price is a required number; an unknown price is
    // carried as 0 here and the UI already hides $0 prices, so it reads as
    // "no price shown," not "no cost." The build itself keeps null.
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
