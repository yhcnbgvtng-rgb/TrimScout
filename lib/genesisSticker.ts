/**
 * Genesis factory-build fetch, parse, and cache.
 *
 * Official PDF, no auth required:
 *   https://www.genesis.com/us/en/services/windowsticker?refreshToken=2024-03-28&vehicleType=new&VIN={VIN}&vehicleModel={anything-non-empty}
 * Confirmed live: no bot protection (Cloudflare only). VIN alone drives the
 * lookup — `vehicleModel` just needs to be present and non-empty (a
 * deliberately wrong model value returns an identical PDF).
 *
 * Unlike Ford/GM/Stellantis, a miss is not a small "unavailable" PDF — it's
 * HTTP 200 with a genuinely empty body (`content-length: 0`). Validity is by
 * content length, not status code, same "validity by content" convention as
 * every other OEM module here.
 *
 * Released PDFs are cached per VIN under /tmp.
 */

import fs from "fs";
import path from "path";
import { colorsMatch, exteriorColorMustHaveName, interiorColorMustHaveName, normalizeForMatch, parseColorMustHave, parseMoney, type FordFactoryOptionLine } from "./fordSticker";
import { isGenesisVin, looksLikeGenesisPaste } from "./oemWmi";
import type { CurrentDealerLookup } from "./listingSheet";
import type { Vehicle } from "./types";

export { isGenesisVin, looksLikeGenesisPaste };

export const GENESIS_STICKER_PDF_URL = "https://www.genesis.com/us/en/services/windowsticker";

export type StickerStatus = "released" | "unreleased" | "error";
export type GenesisFetchKind = "pdf" | "empty" | "html_denied" | "unknown";

export interface GenesisOptionLine {
  name: string;
  code?: string;
  price: number | null;
  isStandard: boolean;
  isPackageChild: boolean;
  source: "sticker";
}

export interface GenesisSoldTo {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  source: "sticker";
}

export interface GenesisSticker {
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
  dealerSoldTo?: GenesisSoldTo;
  options: GenesisOptionLine[];
  standardEquipment: string[];
  rawText: string;
  pdfUrl: string;
  fetchedAt: string;
  note?: string;
  fetchKind?: GenesisFetchKind;
}

export interface MustHaveCheck {
  vin: string;
  pass: boolean;
  matched: string[];
  missing: string[];
  status: StickerStatus;
}

const MEMORY_CACHE = new Map<string, GenesisSticker>();
const CACHE_DIR = path.join("/tmp", "trimscout-genesis-stickers");
const PARSER_VERSION = 1;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function genesisStickerPdfUrl(vin: string): string {
  const params = new URLSearchParams({
    refreshToken: "2024-03-28",
    vehicleType: "new",
    VIN: vin.trim().toUpperCase(),
    // Ignored server-side beyond needing to be non-empty — VIN alone drives
    // the lookup (confirmed live: a deliberately wrong model value returns
    // an identical PDF).
    vehicleModel: "genesis",
  });
  return `${GENESIS_STICKER_PDF_URL}?${params.toString()}`;
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export function classifyGenesisFetchBody(bytes: Uint8Array, contentType?: string | null): GenesisFetchKind {
  if (bytes.length === 0) return "empty";
  if (looksLikePdf(bytes) && bytes.length > 2000) return "pdf";
  const text = new TextDecoder().decode(bytes);
  if (/access denied|errors\.edgesuite|akamai-grn|cloudflare/i.test(text)) return "html_denied";
  if (looksLikePdf(bytes)) return "pdf";
  if ((contentType || "").includes("pdf") && bytes.length < 2000) return "empty";
  return "unknown";
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function sliceSection(text: string, startRe: RegExp, endRe: RegExp): string {
  const start = text.search(startRe);
  if (start < 0) return "";
  const from = text.slice(start);
  const end = from.search(endRe);
  return end > 0 ? from.slice(0, end) : from;
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
 * Known current nameplates. A positional line-grab doesn't work here — the
 * headline shape genuinely varies (a 3-line "2024 G90 3.5T\nE-SUPERCHARGER\n
 * AWD" vs. a 2-line "2023 G80 AWD 2.5T\nSPORT PRESTIGE", confirmed on two
 * real fixtures) — so this matches the nameplate token, slices the headline
 * block, then strips known non-trim tokens from what's left. Extend the
 * nameplate list as a real sticker surfaces one it's missing, same
 * incremental-discovery approach as every other OEM module here.
 */
function parseYearModelTrim(text: string): { year?: number; model?: string; trim?: string } {
  const yearNameplate = text.match(
    /\b(20\d{2})\s+(ELECTRIFIED\s+G80|ELECTRIFIED\s+GV70|G70|G80|G90|GV60|GV70|GV80)\b/i
  );
  if (!yearNameplate) return {};
  const year = Number.parseInt(yearNameplate[1], 10);
  const model = titleCase(yearNameplate[2].replace(/\s+/g, " "));
  const headlineEnd = text.search(/THE GENESIS EXPERIENCE/i);
  const headlineBlock = text.slice(
    text.indexOf(yearNameplate[0]),
    headlineEnd > 0 ? headlineEnd : undefined
  );
  const trim = headlineBlock
    .replace(yearNameplate[0], "")
    .replace(/\b(AWD|RWD|4WD|2WD)\b/gi, "")
    .replace(/\b\d(?:\.\d)?T\b/gi, "")
    .replace(/\bE-SUPERCHARGER\b/gi, "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { year, model, trim: trim ? titleCase(trim) : undefined };
}

export function parseGenesisStickerText(vin: string, text: string): GenesisSticker {
  const cleanVin = vin.trim().toUpperCase();
  const pdfUrl = genesisStickerPdfUrl(cleanVin);
  const fetchedAt = new Date().toISOString();

  const sticker: GenesisSticker = {
    vin: cleanVin,
    status: "released",
    make: "Genesis",
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

  const { year, model, trim } = parseYearModelTrim(text);
  sticker.year = year;
  sticker.model = model;
  sticker.trim = trim;

  const drive = text.match(/\b(4WD|AWD|RWD|2WD)\b/i);
  if (drive) sticker.drivetrain = drive[1].toUpperCase();

  const ext = text.match(/EXTERIOR COLOR:\s*\n?\s*([^\n]+)/i);
  if (ext) sticker.exteriorColor = titleCase(ext[1].replace(/\s+/g, " ").trim());

  const intCol = text.match(/INTERIOR\/SEAT COLOR:\s*\n?\s*([^\n]+)/i);
  if (intCol) sticker.interiorColor = titleCase(intCol[1].replace(/\s+/g, " ").trim());

  // The engine bullet can wrap across two physical lines (confirmed on the
  // real G90 fixture: "3.5L V6 T-GDI w/ 48V e-Supercharger (409 HP /\n405
  // lb.-ft)") — re-join continuation lines while parens are unbalanced
  // rather than truncating mid-parenthetical.
  const powertrainBlock = sliceSection(text, /POWERTRAIN TECHNOLOGY/i, /\bEXTERIOR\b/i);
  const powertrainLines = powertrainBlock
    .split("\n")
    .map((l) => l.replace(/^[·•\-]\s*/, "").trim())
    .filter((l) => l && !/^POWERTRAIN TECHNOLOGY$/i.test(l));
  if (powertrainLines.length > 0) {
    let engine = powertrainLines[0];
    let i = 1;
    while (
      i < powertrainLines.length &&
      (engine.match(/\(/g) || []).length > (engine.match(/\)/g) || []).length
    ) {
      engine += " " + powertrainLines[i++];
    }
    sticker.engine = engine.replace(/\s+/g, " ").trim();
    const transLine = powertrainLines.find((l) => /\d+-?speed[^\n]*transmission/i.test(l));
    if (transLine) sticker.transmission = transLine.trim();
  }

  const base = text.match(/Manufacturer'?s Suggested Retail Price:\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (base) sticker.basePrice = parseMoney(base[1]);
  const dest = text.match(/Inland Freight & Handling\s*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (dest) sticker.destination = parseMoney(dest[1]);
  const totalPrice = text.match(/TOTAL PRICE:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (totalPrice) sticker.msrp = parseMoney(totalPrice[1]);

  // Genesis's SOLD TO line carries an inline dealer code before the newline
  // ("SOLD TO: NJ701\nGENESIS OF CHERRY HILL\n..."), unlike GM's bare
  // "SOLD TO\n{name}" — consume the code first so it isn't mistaken for the
  // dealer name.
  const sold = text.match(
    /SOLD TO:\s*\S+\s*\n([A-Za-z0-9][A-Za-z0-9 .,&'\-]*)\n(?:([^\n]+)\n)?([A-Za-z][A-Za-z .'\-]+?)\s+([A-Z]{2})\s+(\d{5})\b/
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

  // Options: priced standalone items carry a "·" bullet; a package header
  // ("*Advanced Package: $4,700.00") carries no bullet and a trailing
  // ": $price"; its included contents follow as bulletless, priceless
  // lines until the next bulleted/header line or "Accessories" (which
  // resets back to standalone-priced-item mode for its own "·" lines) —
  // the inverse of GM/Stellantis's leading-punctuation child marker, so
  // this needs a stateful scan rather than a per-line prefix check.
  const optionalBlock = sliceSection(text, /ADDED FEATURES:/i, /Inland Freight & Handling/i);
  let inPackage = false;
  for (const raw of optionalBlock
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (/^ADDED FEATURES:$/i.test(raw)) continue;
    if (/^Accessories$/i.test(raw)) {
      inPackage = false;
      continue;
    }
    const bulleted = raw.match(/^[·•\-]\s*\*?\s*(.*)$/);
    if (bulleted) {
      inPackage = false;
      const parsed = parseOptionPriceTail(bulleted[1]);
      if (!parsed.name || parsed.name.length < 3) continue;
      sticker.options.push({
        name: titleCase(parsed.name),
        price: parsed.price,
        isStandard: false,
        isPackageChild: false,
        source: "sticker",
      });
      continue;
    }
    const pkgHeader = raw.match(/^\*(.+?):\s*\$?\s*([\d,]+(?:\.\d{2})?)\s*$/);
    if (pkgHeader) {
      inPackage = true;
      sticker.options.push({
        name: titleCase(pkgHeader[1]),
        price: parseMoney(pkgHeader[2]),
        isStandard: false,
        isPackageChild: false,
        source: "sticker",
      });
      continue;
    }
    // A leading "*" with no trailing price is still a standalone priced
    // item on some templates (e.g. "*MAKALU GRAY(NCM) Paint $1,500.00"
    // when it lacks a "·" bullet) — treat it the same as a bulleted line.
    if (raw.startsWith("*")) {
      inPackage = false;
      const parsed = parseOptionPriceTail(raw.replace(/^\*/, ""));
      if (!parsed.name || parsed.name.length < 3) continue;
      sticker.options.push({
        name: titleCase(parsed.name),
        price: parsed.price,
        isStandard: false,
        isPackageChild: false,
        source: "sticker",
      });
      continue;
    }
    if (inPackage) {
      if (raw.length < 3) continue;
      sticker.options.push({
        name: titleCase(raw),
        price: null,
        isStandard: false,
        isPackageChild: true,
        source: "sticker",
      });
    }
  }

  // optionsPrice is summed from real itemized prices above — Genesis, unlike
  // Stellantis, prints a real per-item price on every option line, so this
  // is more accurate than deriving from the three totals. Only fall back to
  // derivation if itemization somehow yielded nothing.
  const summed = sticker.options.reduce((sum, o) => sum + (o.price || 0), 0);
  if (sticker.options.some((o) => o.price != null)) {
    sticker.optionsPrice = Math.round(summed * 100) / 100;
  } else if (sticker.msrp != null && sticker.basePrice != null && sticker.destination != null) {
    sticker.optionsPrice = Math.round((sticker.msrp - sticker.basePrice - sticker.destination) * 100) / 100;
  }

  const standardBlock = sliceSection(
    text,
    /STANDARD FEATURES:/i,
    /Manufacturer'?s Suggested Retail Price/i
  );
  const skipHeaders =
    /^(ADVANCED SAFETY TECHNOLOGY|POWERTRAIN TECHNOLOGY|EXTERIOR|COMFORT & CONVENIENCE(?:\(cont\.\))?|INTERIOR & CONVENIENCE|MULTIMEDIA & (?:CONNECTIVITY|TECHNOLOGY)(?:\(cont\.\))?|Additional Standard Features|GENESIS WARRANTY|THE GENESIS EXPERIENCE|STANDARD FEATURES:)$/i;
  sticker.standardEquipment = standardBlock
    .split("\n")
    .map((l) => l.replace(/^[·•\-]\s*/, "").trim())
    .filter((l) => l && !skipHeaders.test(l));

  return sticker;
}

export function optionMatchesQuery(optionName: string, query: string): boolean {
  const q = normalizeForMatch(query);
  const n = normalizeForMatch(optionName);
  if (!q || !n) return false;
  return n.includes(q) || q.includes(n);
}

export function stickerHasMustHave(sticker: GenesisSticker, query: string): boolean {
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
  const optional = sliceSection(sticker.rawText, /ADDED FEATURES:/i, /Inland Freight & Handling/i);
  const q = normalizeForMatch(query);
  return normalizeForMatch(optional).includes(q);
}

export function confirmGenesisMustHavesFromSticker(
  sticker: GenesisSticker,
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

export function stickerColorOptionLines(sticker: GenesisSticker): GenesisOptionLine[] {
  const lines: GenesisOptionLine[] = [];
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

export function defaultMustHaveLines(_sticker?: GenesisSticker): string[] {
  return [];
}

export function defaultNiceToHaveLines(sticker: GenesisSticker, mustHaves: string[]): string[] {
  const mustNorm = new Set(mustHaves.map(normalizeForMatch));
  return sticker.options
    .filter((o) => !o.isStandard && !o.isPackageChild)
    .map((o) => o.name)
    .filter((name) => !mustNorm.has(normalizeForMatch(name)));
}

export function filterableFactoryOptions(sticker: GenesisSticker): GenesisOptionLine[] {
  const opts = sticker.options.filter((o) => !o.isStandard && !o.isPackageChild);
  return [...stickerColorOptionLines(sticker), ...opts];
}

/** Optional-equipment lines from a released sticker, including package children. */
export function genesisFactoryOptionBreakout(sticker: GenesisSticker): FordFactoryOptionLine[] {
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

function readDiskCache(vin: string): GenesisSticker | null {
  try {
    const raw = fs.readFileSync(cacheJsonPath(vin), "utf8");
    const parsed = JSON.parse(raw) as GenesisSticker & { parserVersion?: number };
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

function writeDiskCache(sticker: GenesisSticker): void {
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

export function getCachedGenesisSticker(vin: string): GenesisSticker | null {
  const key = vin.trim().toUpperCase();
  return MEMORY_CACHE.get(key) || readDiskCache(key);
}

export function putCachedGenesisSticker(sticker: GenesisSticker): void {
  MEMORY_CACHE.set(sticker.vin, sticker);
  writeDiskCache(sticker);
}

/** Test-only: drop in-memory cache so mocked HTTP is observed. */
export function clearGenesisStickerMemoryCache(): void {
  MEMORY_CACHE.clear();
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(bytes, { mergePages: true });
  const text = result.text;
  return Array.isArray(text) ? text.join("\n") : String(text || "");
}

export function genesisStickerFromFetchedBytes(
  vin: string,
  bytes: Uint8Array,
  contentType?: string | null
): { kind: GenesisFetchKind; sticker?: GenesisSticker } {
  const kind = classifyGenesisFetchBody(bytes, contentType);
  if (kind === "empty") {
    return {
      kind,
      sticker: {
        vin: vin.trim().toUpperCase(),
        status: "unreleased",
        msrp: null,
        basePrice: null,
        optionsPrice: null,
        destination: null,
        options: [],
        standardEquipment: [],
        rawText: "",
        pdfUrl: genesisStickerPdfUrl(vin),
        fetchedAt: new Date().toISOString(),
        note: "Genesis has no factory build on file for this VIN.",
      },
    };
  }
  return { kind };
}

async function fetchGenesisStickerBytesHttp(
  vin: string
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const url = genesisStickerPdfUrl(vin);
  const res = await fetch(url, {
    headers: {
      Accept: "application/pdf,*/*;q=0.5",
      "User-Agent": BROWSER_UA,
      Referer: "https://www.genesis.com/",
      Origin: "https://www.genesis.com",
    },
    cache: "no-store",
  });
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
}

export async function getGenesisSticker(vin: string): Promise<GenesisSticker> {
  const cleanVin = vin.trim().toUpperCase();
  if (cleanVin.length !== 17) {
    throw new Error("VIN must be exactly 17 characters");
  }
  const cached = getCachedGenesisSticker(cleanVin);
  if (cached && cached.vin === cleanVin) return cached;

  const cachedPdf = readPdfCache(cleanVin);
  if (cachedPdf) {
    const text = await extractPdfText(cachedPdf);
    const sticker = parseGenesisStickerText(cleanVin, text);
    if (sticker.status === "released" && sticker.vin === cleanVin) {
      putCachedGenesisSticker(sticker);
      return sticker;
    }
  }

  const http = await fetchGenesisStickerBytesHttp(cleanVin);
  const classified = genesisStickerFromFetchedBytes(cleanVin, http.bytes, http.contentType);

  if (classified.kind === "empty" && classified.sticker) {
    classified.sticker.fetchKind = classified.kind;
    MEMORY_CACHE.set(cleanVin, classified.sticker);
    return classified.sticker;
  }

  if (classified.kind === "pdf" && looksLikePdf(http.bytes)) {
    writePdfCache(cleanVin, http.bytes);
    const text = await extractPdfText(http.bytes);
    const sticker = parseGenesisStickerText(cleanVin, text);
    sticker.fetchKind = "pdf";
    if (sticker.vin !== cleanVin) {
      throw new Error(`Genesis factory build VIN mismatch for ${cleanVin}.`);
    }
    if (sticker.status === "released") putCachedGenesisSticker(sticker);
    else MEMORY_CACHE.set(cleanVin, sticker);
    return sticker;
  }

  throw new Error(
    `Could not load a factory build for VIN ${cleanVin} (Genesis returned ${classified.kind}, ${http.bytes.length} bytes).`
  );
}

export function genesisStickerToVehicle(
  sticker: GenesisSticker,
  listingUrl?: string | null,
  listingPrice?: number | null,
  currentDealer?: CurrentDealerLookup | null
): Vehicle {
  return {
    id: `genesis-${sticker.vin}`,
    vin: sticker.vin,
    year: sticker.year || 0,
    make: sticker.make || "Genesis",
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
          // Unlike Stellantis, SOLD TO is actually populated on real Genesis
          // stickers — prefer it over the generic default, but still prefer
          // a live listing lookup (currentDealer) over it, same as GM.
          dealerName: sticker.dealerSoldTo?.name || "Genesis dealer",
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
