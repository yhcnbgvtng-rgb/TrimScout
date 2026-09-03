/**
 * GM (Chevrolet / GMC / Buick / Cadillac) factory-build fetch, parse, and cache.
 *
 * Official PDF (~2020+):
 *   https://cws.gm.com/vs-cws/vehshop/v2/vehicle/windowsticker?vin={VIN}
 *
 * HTTP 200 on a miss is JSON `errorCode 1001`. A hit is a PDF.
 * Validity is by **content**, not status code. Never substitute another VIN.
 *
 * Released PDFs are cached per VIN under /tmp. Unreleased JSON is not cached forever.
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
} from "./fordSticker";
import { isGmVin, looksLikeGmPaste } from "./oemWmi";
import type { CurrentDealerLookup } from "./listingSheet";
import type { Vehicle } from "./types";

export { isGmVin, looksLikeGmPaste };

export const GM_STICKER_PDF_URL =
  "https://cws.gm.com/vs-cws/vehshop/v2/vehicle/windowsticker";

export type StickerStatus = "released" | "unreleased" | "error";
export type GmFetchKind = "pdf" | "unreleased_json" | "empty" | "html_denied" | "text" | "unknown";

export interface GmOptionLine {
  name: string;
  rpo?: string;
  price: number | null;
  isStandard: boolean;
  isPackageChild: boolean;
  source: "sticker";
}

export interface GmSoldTo {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  source: "sticker";
}

export interface GmSticker {
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
  dealerSoldTo?: GmSoldTo;
  options: GmOptionLine[];
  standardEquipment: string[];
  rawText: string;
  pdfUrl: string;
  fetchedAt: string;
  note?: string;
  fetchKind?: GmFetchKind;
}

export interface MustHaveCheck {
  vin: string;
  pass: boolean;
  matched: string[];
  missing: string[];
  status: StickerStatus;
}

const MEMORY_CACHE = new Map<string, GmSticker>();
const CACHE_DIR = path.join("/tmp", "trimscout-gm-stickers");
const PARSER_VERSION = 1;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const UNRELEASED_PATTERNS = [
  /no window sticker found for the requested vin/i,
  /errorcode["\s:]+1001/i,
  /window sticker has not yet been\s+released/i,
  /please check back later/i,
];

export function gmStickerPdfUrl(vin: string): string {
  return `${GM_STICKER_PDF_URL}?vin=${encodeURIComponent(vin.toUpperCase())}`;
}

export function isZ71Line(name: string): boolean {
  const n = normalizeForMatch(name);
  return n.includes("Z71") && (n.includes("OFF ROAD") || n.includes("PACKAGE") || n === "Z71");
}

export function isMultiFlexLine(name: string): boolean {
  const n = normalizeForMatch(name);
  return n.includes("MULTI FLEX") || n.includes("MULTIFLEX") || (n.includes("QT6") && n.includes("TAILGATE"));
}

export function isSuperCruiseLine(name: string): boolean {
  const n = normalizeForMatch(name);
  return n.includes("SUPER CRUISE") || n.includes("SUPERCRUISE");
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export function looksLikeGmBuildText(text: string): boolean {
  if (!text) return false;
  const hasBrand = /\b(CHEVROLET|GMC|BUICK|CADILLAC)\b/i.test(text);
  const hasPrice =
    /TOTAL VEHICLE PRICE/i.test(text) || /OPTIONAL EQUIPMENT/i.test(text) || /BASE PRICE/i.test(text);
  return hasBrand && hasPrice;
}

export function classifyGmFetchBody(bytes: Uint8Array, contentType?: string | null): GmFetchKind {
  if (looksLikePdf(bytes) && bytes.length > 500) return "pdf";
  const text = new TextDecoder().decode(bytes);
  if (UNRELEASED_PATTERNS.some((re) => re.test(text))) return "unreleased_json";
  if (looksLikeGmBuildText(text)) return "text";
  if (bytes.length === 0) return "empty";
  if (/access denied|errors\.edgesuite|akamai-grn/i.test(text)) return "html_denied";
  if (looksLikePdf(bytes)) return "pdf";
  if ((contentType || "").includes("pdf") && bytes.length < 500) return "empty";
  return "unknown";
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function titleTrim(s: string): string {
  const u = s.trim().toUpperCase();
  if (["LT", "LTZ", "WT", "RST", "ZR2", "Z71", "LS", "RS", "SS"].includes(u)) return u;
  if (/^HIGH COUNTRY$/i.test(s)) return "High Country";
  if (/^TRAIL BOSS$/i.test(s)) return "Trail Boss";
  return titleCase(s);
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

function parseOptionPriceTail(line: string): { name: string; rpo?: string; price: number | null } {
  const trimmed = line.replace(/^\s+/, "").replace(/\s+/g, " ").trim();
  const noCharge = trimmed.match(/^(.*)\s+NO CHARGE\s*$/i);
  if (noCharge) return splitRpoName(noCharge[1].trim(), 0);
  const priced = trimmed.match(/^(.*?)(?:\s+\$?\s*([\d]{1,3}(?:,\d{3})*(?:\.\d{2})?))\s*$/);
  if (priced && parseMoney(priced[2]) != null) {
    return splitRpoName(priced[1].trim(), parseMoney(priced[2]));
  }
  return splitRpoName(trimmed, null);
}

function splitRpoName(name: string, price: number | null): { name: string; rpo?: string; price: number | null } {
  const rpo = name.match(/^([A-Z]{2,4}[0-9]?)\s{1,}(.+)$/);
  if (rpo && rpo[1].length <= 4 && /[A-Z]/.test(rpo[1]) && /[A-Z]/.test(rpo[2])) {
    return { name: rpo[2].trim(), rpo: rpo[1], price };
  }
  return { name: name.trim(), price };
}

function titleOption(name: string): string {
  const trimmed = name.replace(/^\./, "").replace(/\s+/g, " ").trim();
  if (isZ71Line(trimmed)) return "Z71 Off-Road Package";
  if (isMultiFlexLine(trimmed)) return "Multi-Flex Tailgate";
  if (isSuperCruiseLine(trimmed)) return "Super Cruise";
  return trimmed;
}

function parseModelAndTrim(rest: string): { model: string; trim?: string } {
  const modelParts = rest.replace(/\s+/g, " ").trim().split(/\s+/);
  if (/^SILVERADO$/i.test(modelParts[0]) && modelParts[1] && /^\d{3,4}(HD)?$/i.test(modelParts[1])) {
    return {
      model: `Silverado ${modelParts[1].toUpperCase()}`,
      trim: modelParts.slice(2).join(" ") || undefined,
    };
  }
  if (/^SIERRA$/i.test(modelParts[0]) && modelParts[1] && /^\d{3,4}(HD)?$/i.test(modelParts[1])) {
    return {
      model: `Sierra ${modelParts[1].toUpperCase()}`,
      trim: modelParts.slice(2).join(" ") || undefined,
    };
  }
  if (modelParts.length >= 2 && /SPORT/i.test(modelParts[1])) {
    return {
      model: titleCase(`${modelParts[0]} ${modelParts[1]}`),
      trim: modelParts.slice(2).join(" ") || undefined,
    };
  }
  return {
    model: titleCase(modelParts[0] || ""),
    trim: modelParts.slice(1).join(" ") || undefined,
  };
}

export function parseGmStickerText(vin: string, text: string): GmSticker {
  const cleanVin = vin.trim().toUpperCase();
  const pdfUrl = gmStickerPdfUrl(cleanVin);
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
      note: "The GM factory build has not yet been released. Dealer ad copy is not proof.",
    };
  }

  const makeMatch = text.match(/\b(CHEVROLET|GMC|BUICK|CADILLAC)\b/i);
  const sticker: GmSticker = {
    vin: cleanVin,
    status: "released",
    make: makeMatch ? titleCase(makeMatch[1]) : "Chevrolet",
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

  const headline = text.match(
    /\b(20\d{2})\s+(CHEVROLET|GMC|BUICK|CADILLAC)\s+([A-Z0-9][A-Z0-9 \-]{2,40})/i
  );
  if (headline) {
    sticker.year = Number.parseInt(headline[1], 10);
    sticker.make = titleCase(headline[2]);
    const parsed = parseModelAndTrim(headline[3]);
    sticker.model = parsed.model;
    sticker.trim = parsed.trim;
  } else {
    const yearOnly = text.match(/\b(20\d{2})\s+SILVERADO(?:\s+(\d{3,4}(?:HD)?))?/i);
    if (yearOnly) {
      sticker.year = Number.parseInt(yearOnly[1], 10);
      sticker.model = yearOnly[2] ? `Silverado ${yearOnly[2].toUpperCase()}` : "Silverado 1500";
    }
  }
  if (sticker.trim) sticker.trim = titleTrim(sticker.trim);
  if (!sticker.trim) {
    const trimLine = text.match(
      /^\s*(WT|CUSTOM|LT|RST|LTZ|HIGH COUNTRY|TRAIL BOSS|ZR2|LS|PREMIER|ACTIV|Z71)\b/im
    );
    if (trimLine) sticker.trim = titleTrim(trimLine[1]);
  }

  const drive = text.match(/\b(4WD|AWD|RWD|2WD|FWD|4X4|4X2)\b/i);
  if (drive) sticker.drivetrain = drive[1].toUpperCase();

  const ext =
    text.match(/EXTERIOR(?:\s+COLOR)?\s*[:\-]?\s*([A-Z][A-Z0-9 \-\/]+)/i) ||
    text.match(/\bEXTERIOR\s+([A-Z][A-Z0-9 \-\/]{3,40})/i);
  if (ext) sticker.exteriorColor = titleCase(ext[1].replace(/\s+/g, " ").trim());

  const intCol =
    text.match(/INTERIOR(?:\s+COLOR)?\s*[:\-]?\s*([A-Z][A-Z0-9 \-\/]+)/i) ||
    text.match(/\bINTERIOR\s+([A-Z][A-Z0-9 \-\/]{3,40})/i);
  if (intCol) sticker.interiorColor = titleCase(intCol[1].replace(/\s+/g, " ").trim());

  const engineLine = text.match(
    /(\d(?:\.\d)?L\s+(?:ECOTEC3\s+)?(?:TURBO(?:CHARGED)?\s+)?(?:DURAMAX\s+)?(?:V\d|I-\d|I\d)[^\n]{0,40})/i
  );
  if (engineLine) sticker.engine = engineLine[1].replace(/\s+/g, " ").trim();

  const transLine = text.match(/(\d+-SPEED[^\n]{0,40}(?:AUTOMATIC|TRANSMISSION)[^\n]*)/i);
  if (transLine) sticker.transmission = transLine[1].replace(/\s+/g, " ").trim();

  const base = text.match(/BASE PRICE\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (base) sticker.basePrice = parseMoney(base[1]);
  const opts =
    text.match(/TOTAL OPTIONS\s*\$?\s*([\d,]+(?:\.\d{2})?)/i) ||
    text.match(/\bOPTIONS\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (opts) sticker.optionsPrice = parseMoney(opts[1]);
  const dest = text.match(/DESTINATION(?:\s+FREIGHT)?(?:\s+CHARGE)?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (dest) sticker.destination = parseMoney(dest[1]);

  const totalVehicle = text.match(/TOTAL VEHICLE PRICE\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (totalVehicle) sticker.msrp = parseMoney(totalVehicle[1]);
  if (
    sticker.msrp == null &&
    sticker.basePrice != null &&
    sticker.optionsPrice != null &&
    sticker.destination != null
  ) {
    sticker.msrp = Math.round((sticker.basePrice + sticker.optionsPrice + sticker.destination) * 100) / 100;
  }

  const sold = text.match(
    /SOLD TO\s*\n([A-Za-z0-9][A-Za-z0-9 .,&'\-]*)\n(?:([^\n]+)\n)?([A-Za-z][A-Za-z .'\-]+?)\s+([A-Z]{2})\s+(\d{5})\b/
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
    /OPTIONAL EQUIPMENT/i,
    /MANUFACTURER'?S SUGGESTED RETAIL PRICE|BASE PRICE|STANDARD EQUIPMENT|EPA |FUEL ECONOMY|WARRANTY\b/i
  );
  const skipHeaders = /^(OPTIONAL EQUIPMENT(?:\s+AND\s+PACKAGES)?|ADDITIONAL EQUIPMENT|PACKAGES|OPTIONS)$/i;
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
      name: titleOption(parsed.name),
      rpo: parsed.rpo,
      price: parsed.price,
      isStandard: false,
      isPackageChild: isChild,
      source: "sticker",
    });
  }

  const standardBlock = sliceSection(
    text,
    /STANDARD EQUIPMENT/i,
    /OPTIONAL EQUIPMENT|MANUFACTURER'?S SUGGESTED RETAIL PRICE|WARRANTY\b|EPA /i
  );
  sticker.standardEquipment = standardBlock
    .split("\n")
    .map((l) => l.replace(/^[•\-\u00a0]+\s*/, "").trim())
    .filter(
      (l) =>
        l && !/^(STANDARD EQUIPMENT|MECHANICAL|INTERIOR|EXTERIOR|SAFETY(?:\/SECURITY)?|COMFORT)$/i.test(l)
    );

  return sticker;
}

export function optionMatchesQuery(optionName: string, query: string): boolean {
  if (/Z71/i.test(query)) return isZ71Line(optionName);
  if (/MULTI\s*-?\s*FLEX|MULTIFLEX|TAILGATE/i.test(query) && /flex|tailgate/i.test(query)) {
    return isMultiFlexLine(optionName);
  }
  if (/SUPER\s*CRUISE/i.test(query)) return isSuperCruiseLine(optionName);
  const q = normalizeForMatch(query);
  const n = normalizeForMatch(optionName);
  if (!q || !n) return false;
  return n.includes(q) || q.includes(n);
}

export function stickerHasMustHave(sticker: GmSticker, query: string): boolean {
  if (sticker.status !== "released") return false;
  const colorReq = parseColorMustHave(query);
  if (colorReq) {
    const actual = colorReq.kind === "exterior" ? sticker.exteriorColor : sticker.interiorColor;
    return colorsMatch(actual, colorReq.color);
  }
  for (const opt of sticker.options) {
    if (optionMatchesQuery(opt.name, query)) return true;
    if (opt.rpo && optionMatchesQuery(opt.rpo, query)) return true;
  }
  if (sticker.trim && optionMatchesQuery(sticker.trim, query) && /Z71/i.test(query)) {
    return /Z71/i.test(sticker.trim);
  }
  if (sticker.engine && optionMatchesQuery(sticker.engine, query)) return true;
  const optional = sliceSection(
    sticker.rawText,
    /OPTIONAL EQUIPMENT/i,
    /MANUFACTURER'?S SUGGESTED RETAIL PRICE|BASE PRICE|STANDARD EQUIPMENT/i
  );
  if (/SUPER\s*CRUISE/i.test(query)) return /SUPER\s*CRUISE/i.test(optional);
  if (/MULTI\s*-?\s*FLEX/i.test(query)) return /MULTI\s*-?\s*FLEX/i.test(optional);
  if (/Z71/i.test(query)) return /Z71/i.test(optional);
  const q = normalizeForMatch(query);
  return normalizeForMatch(optional).includes(q);
}

export function confirmGmMustHavesFromSticker(sticker: GmSticker, mustHaveLines: string[]): MustHaveCheck {
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

export function stickerColorOptionLines(sticker: GmSticker): GmOptionLine[] {
  const lines: GmOptionLine[] = [];
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

export function defaultMustHaveLines(_sticker?: GmSticker): string[] {
  return [];
}

export function defaultNiceToHaveLines(sticker: GmSticker, mustHaves: string[]): string[] {
  const mustNorm = new Set(mustHaves.map(normalizeForMatch));
  return sticker.options
    .filter((o) => !o.isStandard && !o.isPackageChild)
    .map((o) => o.name)
    .filter((name) => !mustNorm.has(normalizeForMatch(name)));
}

export function filterableFactoryOptions(sticker: GmSticker): GmOptionLine[] {
  const opts = sticker.options.filter((o) => !o.isStandard && !o.isPackageChild);
  return [...stickerColorOptionLines(sticker), ...opts];
}

function cacheJsonPath(vin: string): string {
  return path.join(CACHE_DIR, `${vin.toUpperCase()}.json`);
}

function cachePdfPath(vin: string): string {
  return path.join(CACHE_DIR, `${vin.toUpperCase()}.pdf`);
}

function readDiskCache(vin: string): GmSticker | null {
  try {
    const raw = fs.readFileSync(cacheJsonPath(vin), "utf8");
    const parsed = JSON.parse(raw) as GmSticker & { parserVersion?: number };
    if (parsed?.status === "released" && parsed.vin === vin.toUpperCase() && parsed.parserVersion === PARSER_VERSION) {
      return parsed;
    }
  } catch {
    /* miss */
  }
  return null;
}

function writeDiskCache(sticker: GmSticker): void {
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
    if (buf.length > 500 && looksLikePdf(buf)) return new Uint8Array(buf);
  } catch {
    /* miss */
  }
  return null;
}

export function getCachedGmSticker(vin: string): GmSticker | null {
  const key = vin.trim().toUpperCase();
  return MEMORY_CACHE.get(key) || readDiskCache(key);
}

export function putCachedGmSticker(sticker: GmSticker): void {
  MEMORY_CACHE.set(sticker.vin, sticker);
  writeDiskCache(sticker);
}

/** Test-only: drop in-memory cache so mocked HTTP is observed. */
export function clearGmStickerMemoryCache(): void {
  MEMORY_CACHE.clear();
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(bytes, { mergePages: true });
  const text = result.text;
  return Array.isArray(text) ? text.join("\n") : String(text || "");
}

export function gmStickerFromFetchedBytes(
  vin: string,
  bytes: Uint8Array,
  contentType?: string | null
): { kind: GmFetchKind; sticker?: GmSticker } {
  const cleanVin = vin.trim().toUpperCase();
  const kind = classifyGmFetchBody(bytes, contentType);
  if (kind === "unreleased_json" || kind === "text") {
    return { kind, sticker: parseGmStickerText(cleanVin, new TextDecoder().decode(bytes)) };
  }
  return { kind };
}

async function fetchGmStickerBytesHttp(
  vin: string
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const url = gmStickerPdfUrl(vin);
  const res = await fetch(url, {
    headers: {
      Accept: "application/pdf,application/json;q=0.9,*/*;q=0.5",
      "User-Agent": BROWSER_UA,
      Referer: "https://www.chevrolet.com/",
      Origin: "https://www.chevrolet.com",
    },
    cache: "no-store",
  });
  // Validity is by content. HTTP 200 can be a miss (JSON 1001) or a PDF.
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
}

export async function getGmSticker(vin: string): Promise<GmSticker> {
  const cleanVin = vin.trim().toUpperCase();
  if (cleanVin.length !== 17) {
    throw new Error("VIN must be exactly 17 characters");
  }
  const cached = getCachedGmSticker(cleanVin);
  if (cached && cached.vin === cleanVin) return cached;

  const cachedPdf = readPdfCache(cleanVin);
  if (cachedPdf) {
    const text = await extractPdfText(cachedPdf);
    const sticker = parseGmStickerText(cleanVin, text);
    if (sticker.status === "released" && sticker.vin === cleanVin) {
      putCachedGmSticker(sticker);
      return sticker;
    }
  }

  const http = await fetchGmStickerBytesHttp(cleanVin);
  const classified = gmStickerFromFetchedBytes(cleanVin, http.bytes, http.contentType);

  if (classified.kind === "unreleased_json" && classified.sticker) {
    classified.sticker.fetchKind = classified.kind;
    MEMORY_CACHE.set(cleanVin, classified.sticker);
    return classified.sticker;
  }

  if (classified.kind === "text" && classified.sticker) {
    classified.sticker.fetchKind = classified.kind;
    if (classified.sticker.status === "released" && classified.sticker.vin === cleanVin) {
      putCachedGmSticker(classified.sticker);
    }
    return classified.sticker;
  }

  if (classified.kind === "pdf" && looksLikePdf(http.bytes)) {
    writePdfCache(cleanVin, http.bytes);
    const text = await extractPdfText(http.bytes);
    const sticker = parseGmStickerText(cleanVin, text);
    sticker.fetchKind = "pdf";
    if (sticker.vin !== cleanVin) {
      throw new Error(`GM factory build VIN mismatch for ${cleanVin}.`);
    }
    if (sticker.status === "released") putCachedGmSticker(sticker);
    else MEMORY_CACHE.set(cleanVin, sticker);
    return sticker;
  }

  throw new Error(
    `Could not load a factory build for VIN ${cleanVin} (GM returned ${classified.kind}, ${http.bytes.length} bytes).`
  );
}

export function gmStickerToVehicle(
  sticker: GmSticker,
  listingUrl?: string | null,
  listingPrice?: number | null,
  currentDealer?: CurrentDealerLookup | null
): Vehicle {
  return {
    id: `gm-${sticker.vin}`,
    vin: sticker.vin,
    year: sticker.year || 0,
    make: sticker.make || "Chevrolet",
    model: sticker.model || "",
    trim: sticker.trim || "",
    bodyType: "Truck",
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
          dealerName: sticker.dealerSoldTo?.name || "Chevrolet dealer",
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
        code: o.rpo || "",
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
