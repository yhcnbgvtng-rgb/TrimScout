/**
 * Stellantis (Chrysler / Dodge / Jeep / Ram) factory-build fetch, parse, and cache.
 *
 * Official PDF, no auth required:
 *   https://www.chrysler.com/hostd/windowsticker/getWindowStickerPdf.do?vin={VIN}
 * Confirmed live: chrysler.com / dodge.com / jeep.com / ramtrucks.com all serve
 * byte-identical content for the same VIN (one shared backend) — chrysler.com
 * is used here as the canonical domain, no brand routing needed for the fetch.
 *
 * Always HTTP 200. A miss is a small (~1KB) PDF whose text reads "We are
 * unable to retrieve a window sticker for this VIN at this time." — validity
 * is by content, not status code, same convention as the Ford/GM modules.
 *
 * Released PDFs are cached per VIN under /tmp.
 */

import fs from "fs";
import path from "path";
import {
  colorsMatch,
  exteriorColorMustHaveName,
  interiorColorMustHaveName,
  normalizeForMatch,
  parseColorMustHave,
  parseMoney,
  type FordFactoryOptionLine,
} from "./fordSticker";
import { isStellantisVin, looksLikeStellantisPaste } from "./oemWmi";
import type { CurrentDealerLookup } from "./listingSheet";
import type { Vehicle } from "./types";

export { isStellantisVin, looksLikeStellantisPaste };

export const STELLANTIS_STICKER_PDF_URL =
  "https://www.chrysler.com/hostd/windowsticker/getWindowStickerPdf.do";

export type StickerStatus = "released" | "unreleased" | "error";
export type StellantisFetchKind = "pdf" | "unreleased_pdf" | "empty" | "html_denied" | "text" | "unknown";

export interface StellantisOptionLine {
  name: string;
  code?: string;
  price: number | null;
  isStandard: boolean;
  isPackageChild: boolean;
  source: "sticker";
}

export interface StellantisSoldTo {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  source: "sticker";
}

export interface StellantisSticker {
  vin: string;
  status: StickerStatus;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  drivetrain?: string;
  engine?: string;
  transmission?: string;
  exteriorColor?: string;
  interiorColor?: string;
  msrp: number | null;
  basePrice: number | null;
  optionsPrice: number | null;
  destination: number | null;
  dealerSoldTo?: StellantisSoldTo;
  options: StellantisOptionLine[];
  standardEquipment: string[];
  rawText: string;
  pdfUrl: string;
  fetchedAt: string;
  note?: string;
  fetchKind?: StellantisFetchKind;
}

export interface MustHaveCheck {
  vin: string;
  pass: boolean;
  matched: string[];
  missing: string[];
  status: StickerStatus;
}

const MEMORY_CACHE = new Map<string, StellantisSticker>();
const CACHE_DIR = path.join("/tmp", "trimscout-stellantis-stickers");
const PARSER_VERSION = 1;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Confirmed live literal text of the "no sticker for this VIN" response PDF. */
const UNRELEASED_PATTERNS = [/unable to retrieve a window sticker/i];

export function stellantisStickerPdfUrl(vin: string): string {
  return `${STELLANTIS_STICKER_PDF_URL}?vin=${encodeURIComponent(vin.toUpperCase())}`;
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export function looksLikeStellantisBuildText(text: string): boolean {
  if (!text) return false;
  const hasBrand = /\b(JEEP|RAM|DODGE|CHRYSLER)\b/i.test(text);
  const hasPrice = /TOTAL PRICE|BASE PRICE/i.test(text);
  return hasBrand && hasPrice;
}

export function classifyStellantisFetchBody(bytes: Uint8Array, contentType?: string | null): StellantisFetchKind {
  const text = new TextDecoder().decode(bytes);
  if (UNRELEASED_PATTERNS.some((re) => re.test(text))) return "unreleased_pdf";
  if (looksLikePdf(bytes) && bytes.length > 2000) return "pdf";
  if (looksLikeStellantisBuildText(text)) return "text";
  if (bytes.length === 0) return "empty";
  if (/access denied|errors\.edgesuite|akamai-grn/i.test(text)) return "html_denied";
  if (looksLikePdf(bytes)) return "pdf";
  if ((contentType || "").includes("pdf") && bytes.length < 2000) return "empty";
  return "unknown";
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Preserve short, conventionally-uppercase trim/performance codes as-is. */
function titleTrim(s: string): string {
  return s
    .split(/\s+/)
    .map((word) => {
      const u = word.toUpperCase();
      if (["SRT", "GT", "RT", "SXT", "TRX", "4XE", "392", "GT350"].includes(u)) return u;
      return titleCase(word);
    })
    .join(" ");
}

function sliceSection(text: string, startRe: RegExp, endRe: RegExp): string {
  const start = text.search(startRe);
  if (start < 0) return "";
  const from = text.slice(start);
  const end = from.search(endRe);
  return end > 0 ? from.slice(0, end) : from;
}

function isUnreleasedText(text: string): boolean {
  return UNRELEASED_PATTERNS.some((re) => re.test(text));
}

function parseOptionPriceTail(line: string): { name: string; price: number | null } {
  const trimmed = line.replace(/^\s+/, "").replace(/\s+/g, " ").trim();
  const noCharge = trimmed.match(/^(.*)\s+NO CHARGE\s*$/i);
  if (noCharge) return { name: noCharge[1].trim(), price: 0 };
  const priced = trimmed.match(/^(.*?)(?:\s+\$?\s*([\d]{1,3}(?:,\d{3})*(?:\.\d{2})?))\s*$/);
  if (priced && parseMoney(priced[2]) != null) {
    return { name: priced[1].trim(), price: parseMoney(priced[2]) };
  }
  return { name: trimmed, price: null };
}

/**
 * Known current nameplates. Everything after the recognized nameplate word(s)
 * becomes trim (verbatim, cab/bed qualifiers included) — same
 * incremental-discovery approach as lib/gmSticker.ts's parseModelAndTrim:
 * extend this list as a real sticker surfaces a nameplate it's missing.
 */
function parseModelAndTrim(make: string | undefined, rest: string): { model: string; trim?: string } {
  const parts = rest.replace(/\s+/g, " ").trim().split(/\s+/);
  // The make is already stripped from `rest` by the caller, so a bare Ram
  // model number ("1500") needs the make passed in separately to rebuild
  // "Ram 1500" — unlike Jeep/Dodge/Chrysler nameplates, which stand alone.
  if (/^RAM$/i.test(make || "") && parts[0] && /^(1500|2500|3500)$/.test(parts[0])) {
    return { model: `Ram ${parts[0]}`, trim: parts.slice(1).join(" ") || undefined };
  }
  const oneWordModels = [
    "WRANGLER", "GLADIATOR", "CHEROKEE", "COMPASS", "RENEGADE", "WAGONEER",
    "CHARGER", "CHALLENGER", "DURANGO", "HORNET", "PACIFICA", "VOYAGER",
  ];
  const first = (parts[0] || "").toUpperCase();
  if (first === "GRAND" && parts[1] && /^(CHEROKEE|WAGONEER)$/i.test(parts[1])) {
    return { model: titleCase(`Grand ${parts[1]}`), trim: parts.slice(2).join(" ") || undefined };
  }
  if (oneWordModels.includes(first)) {
    return { model: titleCase(parts[0]), trim: parts.slice(1).join(" ") || undefined };
  }
  if (/^300C?$/i.test(first)) {
    return { model: "300", trim: parts.slice(1).join(" ") || undefined };
  }
  return { model: titleCase(parts[0] || ""), trim: parts.slice(1).join(" ") || undefined };
}

export function parseStellantisStickerText(vin: string, text: string): StellantisSticker {
  const cleanVin = vin.trim().toUpperCase();
  const pdfUrl = stellantisStickerPdfUrl(cleanVin);
  const fetchedAt = new Date().toISOString();

  if (isUnreleasedText(text)) {
    return {
      vin: cleanVin,
      status: "unreleased",
      msrp: null,
      basePrice: null,
      optionsPrice: null,
      destination: null,
      options: [],
      standardEquipment: [],
      rawText: text,
      pdfUrl,
      fetchedAt,
      note: "The Stellantis factory build has not yet been released. Dealer ad copy is not proof.",
    };
  }

  const sticker: StellantisSticker = {
    vin: cleanVin,
    status: "released",
    msrp: null,
    basePrice: null,
    optionsPrice: null,
    destination: null,
    options: [],
    standardEquipment: [],
    rawText: text,
    pdfUrl,
    fetchedAt,
  };

  // The headline right after "Base Price:" reliably includes the brand
  // (e.g. "JEEP WRANGLER UNLIMITED RUBICON 392") — the very first headline
  // line sometimes omits it (confirmed: Jeep's first line is just "WRANGLER
  // UNLIMITED RUBICON 392").
  const afterBase = text.match(
    /Base Price:[^\n]*\n\s*(JEEP|RAM|DODGE|CHRYSLER)\s+([A-Z0-9][A-Z0-9 \-]{2,50})/i
  );
  const yearMatch = text.match(/\b(20\d{2})\s+MODEL YEAR\b/i);
  if (yearMatch) sticker.year = Number.parseInt(yearMatch[1], 10);

  if (afterBase) {
    sticker.make = titleCase(afterBase[1]);
    const parsed = parseModelAndTrim(sticker.make, afterBase[2]);
    sticker.model = parsed.model;
    sticker.trim = parsed.trim;
  } else {
    const headlineLine = text.match(/^.*\b(WRANGLER|GLADIATOR|CHEROKEE|COMPASS|RENEGADE|WAGONEER|CHARGER|CHALLENGER|DURANGO|HORNET|PACIFICA|VOYAGER|RAM\s+\d{3,4}|300C?)\b.*$/im);
    if (headlineLine) {
      const makeMatch = headlineLine[0].match(/\b(JEEP|RAM|DODGE|CHRYSLER)\b/i);
      if (makeMatch) sticker.make = titleCase(makeMatch[1]);
      const parsed = parseModelAndTrim(sticker.make, headlineLine[0]);
      sticker.model = parsed.model;
      sticker.trim = parsed.trim;
    }
  }
  if (sticker.trim) sticker.trim = titleTrim(sticker.trim);

  const drive = text.match(/\b(4WD|AWD|RWD|2WD|FWD|4X4|4X2)\b/i);
  if (drive) sticker.drivetrain = drive[1].toUpperCase();

  // The label's own value repeats itself as a trailing word ("Exterior
  // Color: Sting-Gray Clear-Coat Exterior Paint") — strip that echo so
  // colorsMatch() (exact-equality, not substring) isn't broken by it.
  const ext = text.match(/Exterior Color:\s*([^\n]+)/i);
  if (ext) {
    sticker.exteriorColor = titleCase(
      ext[1].replace(/\s+/g, " ").replace(/\s*Exterior\s+Paint\s*$/i, "").trim()
    );
  }

  const intCol = text.match(/Interior Color:\s*([^\n]+)/i);
  if (intCol) {
    sticker.interiorColor = titleCase(
      intCol[1].replace(/\s+/g, " ").replace(/\s*Interior\s+(?:Color|Trim)\s*$/i, "").trim()
    );
  }

  const engineLine = text.match(/Engine:\s*([^\n]+)/i);
  if (engineLine) sticker.engine = engineLine[1].replace(/\s+/g, " ").trim();

  const transLine = text.match(/Transmission:\s*([^\n]+)/i);
  if (transLine) sticker.transmission = transLine[1].replace(/\s+/g, " ").trim();

  const base = text.match(/Base Price:\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (base) sticker.basePrice = parseMoney(base[1]);
  const dest = text.match(/Destination Charge\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (dest) sticker.destination = parseMoney(dest[1]);
  // Footnote marker sits between the label and the amount, e.g.
  // "TOTAL PRICE: * $76,280" — confirmed on both real samples.
  const totalPrice = text.match(/TOTAL PRICE:?\s*\*?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (totalPrice) sticker.msrp = parseMoney(totalPrice[1]);
  // Unlike Ford/GM, this template never prints a "TOTAL OPTIONS" subtotal —
  // derive it from the three cleanly-labeled figures instead.
  if (
    sticker.msrp != null &&
    sticker.basePrice != null &&
    sticker.destination != null &&
    sticker.optionsPrice == null
  ) {
    sticker.optionsPrice = Math.round((sticker.msrp - sticker.basePrice - sticker.destination) * 100) / 100;
  }

  const sold = text.match(
    /SOLD\s*TO\s*[:\n]\s*([A-Za-z0-9][A-Za-z0-9 .,&'\-]*)\n(?:([^\n]+)\n)?([A-Za-z][A-Za-z .'\-]+?)\s+([A-Z]{2})\s+(\d{5})\b/i
  );
  if (sold) {
    sticker.dealerSoldTo = {
      name: sold[1].trim(),
      address: sold[2]?.trim(),
      city: sold[3].trim(),
      state: sold[4],
      zip: sold[5],
      source: "sticker",
    };
  }

  const optionalBlock = sliceSection(
    text,
    /OPTIONAL EQUIPMENT\s*\(May Replace/i,
    /Destination Charge|TOTAL PRICE|WARRANTY COVERAGE/i
  );
  const skipHeaders = /^(OPTIONAL EQUIPMENT(?:\s*\(May Replace Standard Equipment\))?)$/i;
  for (const line of optionalBlock
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (skipHeaders.test(line)) continue;
    if (/^VIN\b/i.test(line)) continue;
    const isChild = line.startsWith(".") || line.startsWith("- ");
    const parsed = parseOptionPriceTail(line.replace(/^[-•]\s*/, ""));
    if (!parsed.name || parsed.name.length < 3) continue;
    sticker.options.push({
      name: titleCase(parsed.name),
      price: parsed.price,
      isStandard: false,
      isPackageChild: isChild,
      source: "sticker",
    });
  }

  // The standard-equipment header itself says "(UNLESS REPLACED BY OPTIONAL
  // EQUIPMENT)" — the end marker must not fire on that self-reference.
  const standardBlock = sliceSection(
    text,
    /STANDARD EQUIPMENT/i,
    /OPTIONAL EQUIPMENT\s*\(May Replace/i
  );
  sticker.standardEquipment = standardBlock
    .split("\n")
    .map((l) => l.replace(/^[•\- ]+\s*/, "").trim())
    .filter(
      (l) =>
        l &&
        !/^(STANDARD EQUIPMENT(?:\s*\(UNLESS REPLACED BY OPTIONAL EQUIPMENT\))?|FUNCTIONAL\/SAFETY FEATURES|INTERIOR FEATURES|EXTERIOR FEATURES|SAFETY(?:\/SECURITY)?|MECHANICAL|COMFORT)$/i.test(
          l
        )
    );

  return sticker;
}

export function optionMatchesQuery(optionName: string, query: string): boolean {
  const q = normalizeForMatch(query);
  const n = normalizeForMatch(optionName);
  if (!q || !n) return false;
  return n.includes(q) || q.includes(n);
}

export function stickerHasMustHave(sticker: StellantisSticker, query: string): boolean {
  if (sticker.status !== "released") return false;
  const colorReq = parseColorMustHave(query);
  if (colorReq) {
    const actual = colorReq.kind === "exterior" ? sticker.exteriorColor : sticker.interiorColor;
    return colorsMatch(actual, colorReq.color);
  }
  for (const opt of sticker.options) {
    if (optionMatchesQuery(opt.name, query)) return true;
  }
  if (sticker.trim && optionMatchesQuery(sticker.trim, query)) return true;
  if (sticker.engine && optionMatchesQuery(sticker.engine, query)) return true;
  const optional = sliceSection(
    sticker.rawText,
    /OPTIONAL EQUIPMENT\s*\(May Replace/i,
    /Destination Charge|TOTAL PRICE|WARRANTY COVERAGE/i
  );
  const q = normalizeForMatch(query);
  return normalizeForMatch(optional).includes(q);
}

export function confirmStellantisMustHavesFromSticker(
  sticker: StellantisSticker,
  mustHaveLines: string[]
): MustHaveCheck {
  if (sticker.status !== "released") {
    return {
      vin: sticker.vin,
      pass: false,
      matched: [],
      missing: [...mustHaveLines],
      status: sticker.status,
    };
  }
  const matched: string[] = [];
  const missing: string[] = [];
  for (const line of mustHaveLines) {
    if (stickerHasMustHave(sticker, line)) matched.push(line);
    else missing.push(line);
  }
  return {
    vin: sticker.vin,
    pass: missing.length === 0,
    matched,
    missing,
    status: sticker.status,
  };
}

export function stickerColorOptionLines(sticker: StellantisSticker): StellantisOptionLine[] {
  const lines: StellantisOptionLine[] = [];
  if (sticker.exteriorColor) {
    lines.push({
      name: exteriorColorMustHaveName(sticker.exteriorColor),
      price: null,
      isStandard: false,
      isPackageChild: false,
      source: "sticker",
    });
  }
  if (sticker.interiorColor) {
    lines.push({
      name: interiorColorMustHaveName(sticker.interiorColor),
      price: null,
      isStandard: false,
      isPackageChild: false,
      source: "sticker",
    });
  }
  return lines;
}

export function defaultMustHaveLines(_sticker?: StellantisSticker): string[] {
  return [];
}

export function defaultNiceToHaveLines(sticker: StellantisSticker, mustHaves: string[]): string[] {
  const mustNorm = new Set(mustHaves.map(normalizeForMatch));
  return sticker.options
    .filter((o) => !o.isStandard && !o.isPackageChild)
    .map((o) => o.name)
    .filter((name) => !mustNorm.has(normalizeForMatch(name)));
}

export function filterableFactoryOptions(sticker: StellantisSticker): StellantisOptionLine[] {
  const opts = sticker.options.filter((o) => !o.isStandard && !o.isPackageChild);
  return [...stickerColorOptionLines(sticker), ...opts];
}

/** Optional-equipment lines from a released sticker, including package children. */
export function stellantisFactoryOptionBreakout(sticker: StellantisSticker): FordFactoryOptionLine[] {
  if (sticker.status !== "released") return [];
  return sticker.options
    .filter((o) => !o.isStandard)
    .map((o) => ({
      code: o.code || null,
      description: o.name,
      price: o.price,
      isPackageChild: o.isPackageChild,
    }));
}

function cacheJsonPath(vin: string): string {
  return path.join(CACHE_DIR, `${vin.toUpperCase()}.json`);
}

function cachePdfPath(vin: string): string {
  return path.join(CACHE_DIR, `${vin.toUpperCase()}.pdf`);
}

function readDiskCache(vin: string): StellantisSticker | null {
  try {
    const raw = fs.readFileSync(cacheJsonPath(vin), "utf8");
    const parsed = JSON.parse(raw) as StellantisSticker & { parserVersion?: number };
    if (
      parsed?.status === "released" &&
      parsed.vin === vin.toUpperCase() &&
      parsed.parserVersion === PARSER_VERSION
    ) {
      return parsed;
    }
  } catch {
    /* miss */
  }
  return null;
}

function writeDiskCache(sticker: StellantisSticker): void {
  if (sticker.status !== "released") return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheJsonPath(sticker.vin), JSON.stringify({ ...sticker, parserVersion: PARSER_VERSION }));
  } catch {
    /* /tmp may be unavailable */
  }
}

function writePdfCache(vin: string, bytes: Uint8Array): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePdfPath(vin), bytes);
  } catch {
    /* /tmp may be unavailable */
  }
}

function readPdfCache(vin: string): Uint8Array | null {
  try {
    const buf = fs.readFileSync(cachePdfPath(vin));
    if (buf.length > 2000 && looksLikePdf(buf)) return new Uint8Array(buf);
  } catch {
    /* miss */
  }
  return null;
}

export function getCachedStellantisSticker(vin: string): StellantisSticker | null {
  const key = vin.trim().toUpperCase();
  return MEMORY_CACHE.get(key) || readDiskCache(key);
}

export function putCachedStellantisSticker(sticker: StellantisSticker): void {
  MEMORY_CACHE.set(sticker.vin, sticker);
  writeDiskCache(sticker);
}

/** Test-only: drop in-memory cache so mocked HTTP is observed. */
export function clearStellantisStickerMemoryCache(): void {
  MEMORY_CACHE.clear();
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(bytes, { mergePages: true });
  const text = result.text;
  return Array.isArray(text) ? text.join("\n") : String(text || "");
}

export function stellantisStickerFromFetchedBytes(
  vin: string,
  bytes: Uint8Array,
  contentType?: string | null
): { kind: StellantisFetchKind; sticker?: StellantisSticker } {
  const cleanVin = vin.trim().toUpperCase();
  const kind = classifyStellantisFetchBody(bytes, contentType);
  if (kind === "unreleased_pdf") {
    return { kind, sticker: parseStellantisStickerText(cleanVin, new TextDecoder().decode(bytes)) };
  }
  return { kind };
}

async function fetchStellantisStickerBytesHttp(
  vin: string
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const url = stellantisStickerPdfUrl(vin);
  const res = await fetch(url, {
    headers: {
      Accept: "application/pdf,*/*;q=0.5",
      "User-Agent": BROWSER_UA,
      Referer: "https://www.chrysler.com/",
      Origin: "https://www.chrysler.com",
    },
    cache: "no-store",
  });
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
}

export async function getStellantisSticker(vin: string): Promise<StellantisSticker> {
  const cleanVin = vin.trim().toUpperCase();
  if (cleanVin.length !== 17) {
    throw new Error("VIN must be exactly 17 characters");
  }
  const cached = getCachedStellantisSticker(cleanVin);
  if (cached && cached.vin === cleanVin) return cached;

  const cachedPdf = readPdfCache(cleanVin);
  if (cachedPdf) {
    const text = await extractPdfText(cachedPdf);
    const sticker = parseStellantisStickerText(cleanVin, text);
    if (sticker.status === "released" && sticker.vin === cleanVin) {
      putCachedStellantisSticker(sticker);
      return sticker;
    }
  }

  const http = await fetchStellantisStickerBytesHttp(cleanVin);
  const classified = stellantisStickerFromFetchedBytes(cleanVin, http.bytes, http.contentType);

  if (classified.kind === "unreleased_pdf" && classified.sticker) {
    classified.sticker.fetchKind = classified.kind;
    MEMORY_CACHE.set(cleanVin, classified.sticker);
    return classified.sticker;
  }

  if (classified.kind === "text" && classified.sticker) {
    classified.sticker.fetchKind = classified.kind;
    if (classified.sticker.status === "released" && classified.sticker.vin === cleanVin) {
      putCachedStellantisSticker(classified.sticker);
    }
    return classified.sticker;
  }

  if (classified.kind === "pdf" && looksLikePdf(http.bytes)) {
    writePdfCache(cleanVin, http.bytes);
    const text = await extractPdfText(http.bytes);
    const sticker = parseStellantisStickerText(cleanVin, text);
    sticker.fetchKind = "pdf";
    if (sticker.vin !== cleanVin) {
      throw new Error(`Stellantis factory build VIN mismatch for ${cleanVin}.`);
    }
    if (sticker.status === "released") putCachedStellantisSticker(sticker);
    else MEMORY_CACHE.set(cleanVin, sticker);
    return sticker;
  }

  throw new Error(
    `Could not load a factory build for VIN ${cleanVin} (Stellantis returned ${classified.kind}, ${http.bytes.length} bytes).`
  );
}

export function stellantisStickerToVehicle(
  sticker: StellantisSticker,
  listingUrl?: string | null,
  listingPrice?: number | null,
  currentDealer?: CurrentDealerLookup | null
): Vehicle {
  return {
    id: `stellantis-${sticker.vin}`,
    vin: sticker.vin,
    year: sticker.year || 0,
    make: sticker.make || "",
    model: sticker.model || "",
    trim: sticker.trim || "",
    bodyType: "",
    engine: sticker.engine || "",
    drivetrain: sticker.drivetrain || "",
    transmission: sticker.transmission || "",
    exteriorColor: sticker.exteriorColor || "",
    interiorColor: sticker.interiorColor || "",
    msrp: sticker.msrp || 0,
    dealerPrice: listingPrice && listingPrice > 0 ? listingPrice : 0,
    daysOnLot: 0,
    status: "on_lot",
    condition: "new",
    location: currentDealer
      ? {
          dealerName: currentDealer.dealerName,
          city: currentDealer.dealerCity,
          state: currentDealer.dealerState,
          zip: currentDealer.dealerZip || undefined,
          distanceMiles: 0,
          dealerConfirmed: true,
        }
      : {
          // SHIP TO / SOLD TO print blank on every real sticker seen so far —
          // never invent a dealer name here; "Unknown dealer" is honest,
          // "{make} dealer" (Ford/GM's convention) would not be.
          dealerName: sticker.dealerSoldTo?.name || "Unknown dealer",
          city: sticker.dealerSoldTo?.city || "",
          state: sticker.dealerSoldTo?.state || "",
          zip: sticker.dealerSoldTo?.zip,
          distanceMiles: 0,
          dealerConfirmed: false,
        },
    packages: sticker.options.filter((o) => !o.isStandard && !o.isPackageChild).map((o) => o.name),
    options: sticker.options
      .filter((o) => !o.isStandard)
      .map((o) => ({
        code: o.code || "",
        name: o.name,
        price: o.price || 0,
        category: o.isPackageChild ? ("standalone" as const) : ("package" as const),
      })),
    imageUrl: "",
    mileage: 0,
    dealerUrl: listingUrl || currentDealer?.vdpUrl || undefined,
    oemBuildSheetUrl: sticker.pdfUrl,
  };
}
