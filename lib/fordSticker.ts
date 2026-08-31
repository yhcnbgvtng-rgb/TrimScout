/**
 * Ford Direct window-sticker fetch, parse, and cache.
 *
 * Source of truth for factory options is the official Ford PDF:
 *   https://www.windowsticker.forddirect.com/windowsticker.pdf?vin={VIN}
 *
 * User-initiated only (subject VIN + up to 25–50 hunt candidates).
 * Released stickers are cached forever. Unreleased placeholders are NOT
 * cached forever — they are not matches, and Ford may publish later.
 *
 * Never treat dealer ad copy as proof of an option.
 */

import fs from "fs";
import path from "path";

export const FORD_STICKER_PDF_URL =
  "https://www.windowsticker.forddirect.com/windowsticker.pdf";

export const DEMO_SUBJECT_VIN = "1FMWK8JCXTGB47204";

export type StickerStatus = "released" | "unreleased" | "error";
export type FactSource = "sticker" | "listing" | "unconfirmed";
export type EngineFamily = "3.0" | "2.3" | "unknown";

export interface FordOptionLine {
  name: string;
  /** Null when the sticker line has no parseable price — never invented. */
  price: number | null;
  isStandard: boolean;
  /** Nested package contents, e.g. ".MOONROOF W/FIXED GL". */
  isPackageChild: boolean;
  source: "sticker";
}

export interface FordSoldTo {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  source: "sticker";
}

export interface FordSticker {
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
  /** Sticker total MSRP. Null if not parseable — never invented. */
  msrp: number | null;
  basePrice: number | null;
  optionsPrice: number | null;
  destination: number | null;
  dealerSoldTo?: FordSoldTo;
  options: FordOptionLine[];
  standardEquipment: string[];
  rawText: string;
  pdfUrl: string;
  fetchedAt: string;
  note?: string;
}

export interface MustHaveCheck {
  vin: string;
  pass: boolean;
  matched: string[];
  missing: string[];
  status: StickerStatus;
}

const VIN_CHAR_RE = /[A-HJ-NPR-Z0-9]{17}/gi;
const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;
const MEMORY_CACHE = new Map<string, FordSticker>();
const CACHE_DIR = path.join("/tmp", "trimscout-ford-stickers");
const PARSER_VERSION = 3;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const NON_FORD_DEMO_HINT = /\b(bmw|porsche|toyota|mercedes|mini|audi|volkswagen|vw)\b/i;

const UNRELEASED_PATTERNS = [
  /window sticker has not yet been\s+released/i,
  /please check back later/i,
];

/** Standard fob/push-button start — NEVER a must-have filter. */
export function isStandardKeylessLine(name: string): boolean {
  const n = normalizeForMatch(name);
  return (
    n.includes("KEYLESS ENTRY W PUSH START") ||
    n.includes("KEYLESS ENTRY WITH PUSH START") ||
    n.includes("KEYLESS ENTRY W PUSH")
  );
}

/** Door-pillar SecuriCode keypad ($455), NOT the standard fob. */
export function isKeypadLine(name: string): boolean {
  const n = normalizeForMatch(name);
  if (isStandardKeylessLine(name)) return false;
  return (
    n.includes("KEYLESS ENTRY KEYPAD") ||
    n.includes("SECURICODE") ||
    (n.includes("KEYPAD") && !n.includes("PUSH START"))
  );
}

export function isUltimateLine(name: string): boolean {
  return normalizeForMatch(name).includes("ULTIMATE PACKAGE");
}

export function isBlueCruiseLine(name: string): boolean {
  return normalizeForMatch(name).includes("BLUECRUISE");
}

/** User said "keyless entry" → they mean the $455 pillar keypad, not the fob. */
export function isKeypadIntent(query: string): boolean {
  const n = normalizeForMatch(query);
  if (isStandardKeylessLine(query)) return false;
  if (n.includes("PUSH START") && !n.includes("KEYPAD")) return false;
  return (
    n.includes("KEYLESS ENTRY KEYPAD") ||
    n.includes("SECURICODE") ||
    n.includes("KEYPAD") ||
    n === "KEYLESS ENTRY" ||
    n === "KEYLESS" ||
    n === "KEYLESS ENTRY KEYPAD"
  );
}

export function normalizeForMatch(s: string): string {
  return s
    .toUpperCase()
    .replace(/[®™]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isHexBlob(candidate: string): boolean {
  return /^[0-9A-F]{17}$/.test(candidate.trim().toUpperCase());
}

/** ISO-3779 VIN check digit (position 9). */
export function vinCheckDigitValid(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  const map: Record<string, number> = {
    A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
    J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
    S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
    "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  };
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const v = map[u[i]];
    if (v == null) return false;
    sum += v * weights[i];
  }
  const rem = sum % 11;
  const expected = rem === 10 ? "X" : String(rem);
  return u[8] === expected;
}

export function isPlausibleVin(candidate: string): boolean {
  const u = candidate.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(u)) return false;
  if (!/[A-Z]/.test(u) || !/\d/.test(u)) return false;
  if (isHexBlob(u)) return false;
  return true;
}

function isAwsInstanceIdContext(haystack: string, index: number): boolean {
  const before = haystack.slice(Math.max(0, index - 4), index).toUpperCase();
  return before.endsWith("I-");
}

function scoreVinCandidate(vin: string): number {
  let score = 0;
  if (vinCheckDigitValid(vin)) score += 5;
  if (isFordOrLincolnVin(vin)) score += 4;
  if (isPlausibleVin(vin)) score += 1;
  return score;
}

function pickBestVin(candidates: string[]): string | null {
  const uniq = [...new Set(candidates.map((c) => c.toUpperCase()))].filter(isPlausibleVin);
  if (uniq.length === 0) return null;
  uniq.sort((a, b) => scoreVinCandidate(b) - scoreVinCandidate(a));
  const preferred = uniq.find((v) => isFordOrLincolnVin(v) || vinCheckDigitValid(v));
  return preferred || uniq[0];
}

function labeledVinCandidates(raw: string): string[] {
  const found: string[] = [];
  const push = (v?: string) => {
    if (v && isPlausibleVin(v)) found.push(v.toUpperCase());
  };

  const param = raw.match(/[?&]vin=([A-HJ-NPR-Z0-9]{17})/i);
  push(param?.[1]);

  for (const m of raw.matchAll(/vehicleIdentificationNumber["'\s:]+([A-HJ-NPR-Z0-9]{17})/gi)) {
    push(m[1]);
  }
  for (const m of raw.matchAll(/itemprop=["']vehicleIdentificationNumber["'][^>]*>([A-HJ-NPR-Z0-9]{17})/gi)) {
    push(m[1]);
  }
  for (const m of raw.matchAll(/["']vin["']\s*:\s*["']([A-HJ-NPR-Z0-9]{17})["']/gi)) {
    push(m[1]);
  }
  for (const m of raw.matchAll(/\b(?:vehicleVin|vehicle_vin|vinNumber)\s*:\s*["']([A-HJ-NPR-Z0-9]{17})["']/gi)) {
    push(m[1]);
  }
  for (const m of raw.matchAll(/property=["']og:description["'][^>]*content=["']([^"']+)/gi)) {
    const nested = unlabeledVinCandidates(m[1]);
    nested.forEach((v) => push(v));
  }
  for (const m of raw.matchAll(/content=["']([^"']+)["'][^>]*property=["']og:description["']/gi)) {
    unlabeledVinCandidates(m[1]).forEach((v) => push(v));
  }
  for (const m of raw.matchAll(/<dt[^>]*>\s*VIN\s*<\/dt>\s*<dd[^>]*>\s*([A-HJ-NPR-Z0-9]{17})/gi)) {
    push(m[1]);
  }
  for (const m of raw.matchAll(/\bVIN[:\s#=-]+([A-HJ-NPR-Z0-9]{17})/gi)) {
    push(m[1]);
  }
  // Concatenated dealer labels: Engine3VIN3FMCR9BN8TRE94740
  for (const m of raw.matchAll(/VIN([A-HJ-NPR-Z0-9]{17})/gi)) {
    push(m[1]);
  }
  return found;
}

function unlabeledVinCandidates(raw: string): string[] {
  const found: string[] = [];
  const text = raw.toUpperCase();
  for (const source of [VIN_RE, VIN_CHAR_RE]) {
    const clone = new RegExp(source.source, source.flags);
    let m: RegExpExecArray | null;
    while ((m = clone.exec(text)) !== null) {
      if (isAwsInstanceIdContext(text, m.index)) continue;
      if (isPlausibleVin(m[0])) found.push(m[0].toUpperCase());
    }
  }
  return found;
}

export function extractVin(input: string): string | null {
  if (!input) return null;
  const raw = input.trim();
  const labeled = pickBestVin(labeledVinCandidates(raw));
  if (labeled) return labeled;
  return pickBestVin(unlabeledVinCandidates(raw));
}

export function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

export function looksLikeFordOrLincolnPaste(paste: string): boolean {
  const raw = (paste || "").trim();
  if (!raw) return false;
  if (looksLikeUrl(raw)) {
    try {
      const u = new URL(raw);
      const hay = `${u.hostname} ${u.pathname} ${u.search}`.toLowerCase();
      if (hay.includes("ford") || hay.includes("lincoln") || hay.includes("forddirect")) return true;
    } catch {
      /* ignore invalid URL */
    }
  }
  const lower = raw.toLowerCase();
  if (lower.includes("ford") || lower.includes("lincoln") || lower.includes("windowsticker")) return true;
  const vin = extractVin(raw);
  return !!(vin && isFordOrLincolnVin(vin));
}

/** BMW/Porsche/Toyota sample chips — never used for a Ford dealer URL. */
export function isExplicitNonFordDemoPaste(paste: string): boolean {
  if (looksLikeFordOrLincolnPaste(paste)) return false;
  return NON_FORD_DEMO_HINT.test(paste);
}

export function isFordOrLincolnVin(vin: string): boolean {
  const u = vin.trim().toUpperCase();
  if (u.length !== 17) return false;
  const wmi = u.slice(0, 3);
  if (/^[123]F/.test(u)) return true;
  if (["1LN", "5LM", "2LM", "3LN", "1L1", "5L1"].includes(wmi)) return true;
  return false;
}

/**
 * 2026 Explorer: VIN prefix 1FMWK = 3.0L EcoBoost V6; 1FMU = 2.3L.
 * A 2.3 is NOT a match for a 3.0 Ultimate hunt and cannot have Ultimate.
 */
export function engineFamilyFromVin(vin: string): EngineFamily {
  const u = vin.trim().toUpperCase();
  if (/^[123]FMWK/.test(u)) return "3.0";
  if (/^[123]FMU/.test(u)) return "2.3";
  return "unknown";
}

export function shouldExcludeByEnginePrefix(
  subjectVin: string,
  candidateVin: string
): boolean {
  const subject = engineFamilyFromVin(subjectVin);
  const candidate = engineFamilyFromVin(candidateVin);
  if (subject === "unknown" || candidate === "unknown") return false;
  return subject !== candidate;
}

export function fordStickerPdfUrl(vin: string): string {
  return `${FORD_STICKER_PDF_URL}?vin=${encodeURIComponent(vin.toUpperCase())}`;
}

export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

function titleOption(name: string): string {
  const trimmed = name.replace(/^\./, "").replace(/\s+/g, " ").trim();
  if (isUltimateLine(trimmed)) return "Ultimate Package";
  if (isKeypadLine(trimmed)) return "Keyless Entry Keypad";
  return trimmed;
}

/** `VEHICLE DESCRIPTION` / `BRONCO SPORT TR E94740` → Bronco Sport */
function modelFromVehicleDescription(text: string): string | undefined {
  const m = text.match(/VEHICLE DESCRIPTION\s+([A-Z0-9][A-Z0-9 \-]{2,50})/i);
  if (!m) return undefined;
  const tokens = m[1].trim().split(/\s+/);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (/\d/.test(last) || last.length <= 2) tokens.pop();
    else break;
  }
  const model = tokens.join(" ").trim();
  return model || undefined;
}

function isUnreleasedText(text: string): boolean {
  return UNRELEASED_PATTERNS.some((re) => re.test(text));
}

function parseOptionPriceTail(line: string): { name: string; price: number | null } {
  const noCharge = line.match(/^(.*)\s+NO CHARGE\s*$/i);
  if (noCharge) return { name: noCharge[1].trim(), price: 0 };
  const priced = line.match(/^(.*)\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*$/);
  if (priced) return { name: priced[1].trim(), price: parseMoney(priced[2]) };
  return { name: line.trim(), price: null };
}

function sliceSection(text: string, startRe: RegExp, endRe: RegExp): string {
  const start = text.search(startRe);
  if (start < 0) return "";
  const from = text.slice(start);
  const end = from.search(endRe);
  return end > 0 ? from.slice(0, end) : from;
}

export function parseFordStickerText(vin: string, text: string): FordSticker {
  const cleanVin = vin.trim().toUpperCase();
  const pdfUrl = fordStickerPdfUrl(cleanVin);
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
      note: "The window sticker has not yet been released. Dealer ad copy is not proof.",
    };
  }

  const sticker: FordSticker = {
    vin: cleanVin,
    status: "released",
    make: "Ford",
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

  const descModel = modelFromVehicleDescription(text);
  if (descModel) sticker.model = descModel;

  const headline = text.match(
    /\b(20\d{2})\s+([A-Z][A-Z0-9\-]+(?:\s+[A-Z0-9\-]+)*)\s+(4WD|AWD|RWD|2WD|FWD|4X4|4X2)\s+EXTERIOR/i
  );
  if (headline) {
    sticker.year = Number.parseInt(headline[1], 10);
    const ymm = headline[2].replace(/\s+/g, " ").trim();
    sticker.drivetrain = headline[3].toUpperCase();
    const modelNorm = (sticker.model || "").toUpperCase();
    if (modelNorm && ymm.toUpperCase().startsWith(modelNorm)) {
      sticker.trim = ymm.slice(modelNorm.length).trim() || ymm;
    } else if (sticker.model) {
      sticker.trim = ymm;
    } else {
      const parts = ymm.split(" ");
      sticker.trim = parts.pop();
      sticker.model = parts.join(" ") || ymm;
    }
  } else {
    const loose = text.match(/\b(20\d{2})\s+EXPLORER\s+(\S+)/i);
    if (loose) {
      sticker.year = Number.parseInt(loose[1], 10);
      sticker.model = sticker.model || "Explorer";
      sticker.trim = loose[2];
    }
  }
  if (sticker.model) {
    sticker.model = sticker.model
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (sticker.trim) {
    sticker.trim = sticker.trim
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const colorLine =
    text.match(/WHEELBASE\s+([A-Z0-9][A-Z0-9 \-\/]+)/i) ||
    text.match(/\d-PASSENGER\s+([A-Z][A-Z0-9 \-\/]+)/i);
  if (colorLine) {
    sticker.exteriorColor = colorLine[1]
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const engineLine = text.match(/(\d\.\dL\s+ECOBOOST[^\n]*?ENGINE)/i);
  if (engineLine) {
    sticker.engine = engineLine[1]
      .replace(/\s+INTERIOR\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const transLine = text.match(/(\d+-SPEED[^\n]*TRANSMISSION)(?:\s+(.+))?/i);
  if (transLine) {
    sticker.transmission = transLine[1].replace(/\s+/g, " ").trim();
    const rest = (transLine[2] || "").replace(/\s+/g, " ").trim();
    if (rest && !/^INTERIOR$/i.test(rest)) {
      sticker.interiorColor = rest.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  const base = text.match(/BASE PRICE\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (base) sticker.basePrice = parseMoney(base[1]);
  const opts = text.match(/TOTAL OPTIONS\/OTHER\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (opts) sticker.optionsPrice = parseMoney(opts[1]);
  const dest = text.match(/DESTINATION\s*(?:&\s*)?DELIVERY\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (dest) sticker.destination = parseMoney(dest[1]);

  if (
    sticker.basePrice != null &&
    sticker.optionsPrice != null &&
    sticker.destination != null
  ) {
    sticker.msrp = Math.round((sticker.basePrice + sticker.optionsPrice + sticker.destination) * 100) / 100;
  }

  const totalMsrpIdx = text.search(/TOTAL MSRP/i);
  const includedIdx = text.search(/INCLUDED ON THIS VEHICLE/i);
  if (sticker.msrp == null && totalMsrpIdx >= 0) {
    const window = text.slice(
      totalMsrpIdx,
      includedIdx > totalMsrpIdx ? includedIdx : totalMsrpIdx + 800
    );
    const dollars = [...window.matchAll(/\$\s*([\d,]+(?:\.\d{2})?)/g)]
      .map((m) => parseMoney(m[1]))
      .filter((n): n is number => n != null && n >= 20000);
    if (dollars.length > 0) sticker.msrp = dollars[dollars.length - 1];
  }

  const msrpBlock = totalMsrpIdx >= 0 ? text.slice(totalMsrpIdx, totalMsrpIdx + 500) : "";
  const dealerFromConcat = msrpBlock.match(/TOTAL MSRP\s*([A-Za-z0-9][A-Za-z0-9 .,&'\-]*)/);
  const cityStateZip = msrpBlock.match(
    /\n([A-Za-z][A-Za-z .'\-]+?)\s+([A-Z]{2})\s+(\d{5})\b/
  );
  const addr = msrpBlock.match(/\n(\d+[^\n]*)\n[A-Za-z]/);
  if (dealerFromConcat || cityStateZip) {
    sticker.dealerSoldTo = {
      name: dealerFromConcat?.[1]?.replace(/\s+\d{2}[A-Z].*$/, "").trim(),
      address: addr?.[1]?.trim(),
      city: cityStateZip?.[1]?.trim(),
      state: cityStateZip?.[2],
      zip: cityStateZip?.[3],
      source: "sticker",
    };
  }

  const optionalBlock = sliceSection(
    text.replace(/(\d)\s*INCLUDED ON THIS VEHICLE/i, "$1\nINCLUDED ON THIS VEHICLE"),
    /INCLUDED ON THIS VEHICLE/i,
    /PRICE INFORMATION|STANDARD EQUIPMENT INCLUDED/i
  );
  const optionLines = optionalBlock
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const skipHeaders = /^(INCLUDED ON THIS VEHICLE|EQUIPMENT GROUP\s+\S+|OPTIONAL EQUIPMENT.*|DEALER INSTALLED OPTIONS|OTHER)$/i;
  for (const line of optionLines) {
    if (skipHeaders.test(line)) {
      if (/^EQUIPMENT GROUP\s+/i.test(line)) {
        sticker.options.push({
          name: titleOption(line),
          price: null,
          isStandard: false,
          isPackageChild: false,
          source: "sticker",
        });
      }
      continue;
    }
    if (/^\d{4}\s+MODEL YEAR$/i.test(line)) continue;
    const isChild = line.startsWith(".");
    const { name, price } = parseOptionPriceTail(line);
    if (!name) continue;
    sticker.options.push({
      name: titleOption(name),
      price,
      isStandard: false,
      isPackageChild: isChild,
      source: "sticker",
    });
  }

  const standardBlock = sliceSection(
    text,
    /STANDARD EQUIPMENT INCLUDED AT NO EXTRA CHARGE/i,
    /WARRANTY\b/i
  );
  const standardLines = standardBlock
    .split("\n")
    .map((l) => l.replace(/^[•\-\u00a0]+\s*/, "").trim())
    .filter((l) => l && !/^(STANDARD EQUIPMENT|EXTERIOR|INTERIOR|FUNCTIONAL|SAFETY\/SECURITY)$/i.test(l));
  sticker.standardEquipment = standardLines;
  for (const line of standardLines) {
    if (isStandardKeylessLine(line)) {
      sticker.options.push({
        name: titleOption(line),
        price: 0,
        isStandard: true,
        isPackageChild: false,
        source: "sticker",
      });
    }
  }

  return sticker;
}

export function optionMatchesQuery(optionName: string, query: string): boolean {
  if (isKeypadIntent(query)) return isKeypadLine(optionName);
  if (/ULTIMATE/i.test(query)) return isUltimateLine(optionName);
  if (/BLUECRUISE/i.test(query)) return isBlueCruiseLine(optionName);
  const q = normalizeForMatch(query);
  const n = normalizeForMatch(optionName);
  if (!q || !n) return false;
  return n.includes(q) || q.includes(n);
}

export function stickerHasMustHave(sticker: FordSticker, query: string): boolean {
  if (sticker.status !== "released") return false;
  const colorReq = parseColorMustHave(query);
  if (colorReq) {
    const actual = colorReq.kind === "exterior" ? sticker.exteriorColor : sticker.interiorColor;
    return colorsMatch(actual, colorReq.color);
  }
  for (const opt of sticker.options) {
    if (opt.isStandard && isStandardKeylessLine(opt.name)) {
      if (isKeypadIntent(query)) continue;
    }
    if (optionMatchesQuery(opt.name, query)) return true;
  }
  if (sticker.engine && optionMatchesQuery(sticker.engine, query)) return true;
  // Last-resort: optional-equipment slice of raw text, still excluding
  // the standard KEYLESS ENTRY W/PUSH START line for keypad intent.
  const optional = sliceSection(
    sticker.rawText,
    /INCLUDED ON THIS VEHICLE/i,
    /STANDARD EQUIPMENT INCLUDED/i
  );
  if (isKeypadIntent(query)) {
    return /KEYLESS ENTRY KEYPAD/i.test(optional) || /SECURICODE/i.test(optional);
  }
  if (/ULTIMATE/i.test(query)) return /ULTIMATE PACKAGE/i.test(optional);
  const q = normalizeForMatch(query);
  return normalizeForMatch(optional).includes(q);
}

export function confirmFordMustHavesFromSticker(
  sticker: FordSticker,
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

export const EXTERIOR_COLOR_LABEL = "Exterior color";
export const INTERIOR_COLOR_LABEL = "Interior color";

export function normalizeColorName(s: string): string {
  return normalizeForMatch(s)
    .replace(/\b(METALLIC|MET TRI COAT|TRI COAT|PEARL EFFECT|PEARL|MATTE|GLOSS)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function colorsMatch(a?: string | null, b?: string | null): boolean {
  const na = normalizeColorName(a || "");
  const nb = normalizeColorName(b || "");
  if (!na || !nb) return false;
  return na === nb;
}

export function exteriorColorMustHaveName(color: string): string {
  return `${EXTERIOR_COLOR_LABEL}: ${color}`;
}

export function interiorColorMustHaveName(color: string): string {
  return `${INTERIOR_COLOR_LABEL}: ${color}`;
}

export function parseColorMustHave(
  query: string
): { kind: "exterior" | "interior"; color: string } | null {
  const n = query.trim();
  const ext = n.match(/^exterior color:\s*(.+)$/i);
  if (ext?.[1]) return { kind: "exterior", color: ext[1].trim() };
  const int = n.match(/^interior color:\s*(.+)$/i);
  if (int?.[1]) return { kind: "interior", color: int[1].trim() };
  return null;
}

export function stickerColorOptionLines(sticker: FordSticker): FordOptionLine[] {
  const lines: FordOptionLine[] = [];
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

export function defaultMustHaveLines(sticker: FordSticker): string[] {
  const lines: string[] = [];
  if (sticker.options.some((o) => !o.isStandard && isUltimateLine(o.name))) {
    lines.push("Ultimate Package");
  }
  if (sticker.options.some((o) => !o.isStandard && isKeypadLine(o.name))) {
    lines.push("Keyless Entry Keypad");
  }
  return lines;
}

export function defaultNiceToHaveLines(sticker: FordSticker, mustHaves: string[]): string[] {
  const mustNorm = new Set(mustHaves.map(normalizeForMatch));
  return sticker.options
    .filter((o) => !o.isStandard && !o.isPackageChild)
    .map((o) => o.name)
    .filter((name) => {
      if (isStandardKeylessLine(name)) return false;
      if (/50 STATE EMISSIONS|FRONT LICENSE PLATE/i.test(name)) return false;
      if (/^EQUIPMENT GROUP\s/i.test(name)) return false;
      return !mustNorm.has(normalizeForMatch(name));
    });
}

export function filterableFactoryOptions(sticker: FordSticker): FordOptionLine[] {
  const opts = sticker.options.filter(
    (o) => !o.isStandard && !isStandardKeylessLine(o.name) && !o.isPackageChild
  );
  return [...stickerColorOptionLines(sticker), ...opts];
}

function cachePath(vin: string): string {
  return path.join(CACHE_DIR, `${vin.toUpperCase()}.json`);
}

function readDiskCache(vin: string): FordSticker | null {
  try {
    const raw = fs.readFileSync(cachePath(vin), "utf8");
    const parsed = JSON.parse(raw) as FordSticker & { parserVersion?: number };
    if (parsed?.status === "released" && parsed.vin && parsed.parserVersion === PARSER_VERSION) {
      return parsed;
    }
  } catch {
    // miss
  }
  return null;
}

function writeDiskCache(sticker: FordSticker): void {
  if (sticker.status !== "released") return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      cachePath(sticker.vin),
      JSON.stringify({ ...sticker, parserVersion: PARSER_VERSION })
    );
  } catch {
    // /tmp may be unavailable; memory cache still works
  }
}

export function getCachedFordSticker(vin: string): FordSticker | null {
  const key = vin.trim().toUpperCase();
  return MEMORY_CACHE.get(key) || readDiskCache(key);
}

export function putCachedFordSticker(sticker: FordSticker): void {
  MEMORY_CACHE.set(sticker.vin, sticker);
  writeDiskCache(sticker);
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(bytes, { mergePages: true });
  const text = result.text;
  return Array.isArray(text) ? text.join("\n") : String(text || "");
}

async function fetchFordStickerBytes(vin: string): Promise<Uint8Array> {
  const url = fordStickerPdfUrl(vin);
  const res = await fetch(url, {
    headers: {
      Accept: "application/pdf,text/html;q=0.8,*/*;q=0.5",
      "User-Agent":
        "Mozilla/5.0 (compatible; TrimScout/1.0; +https://www.trimscout.com)",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Ford Direct returned HTTP ${res.status} for VIN ${vin}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export async function getFordSticker(vin: string): Promise<FordSticker> {
  const cleanVin = vin.trim().toUpperCase();
  if (cleanVin.length !== 17) {
    throw new Error("VIN must be exactly 17 characters");
  }
  const cached = getCachedFordSticker(cleanVin);
  if (cached) return cached;

  const bytes = await fetchFordStickerBytes(cleanVin);
  let text: string;
  if (looksLikePdf(bytes)) {
    text = await extractPdfText(bytes);
  } else {
    text = new TextDecoder().decode(bytes);
  }

  const sticker = parseFordStickerText(cleanVin, text);
  if (sticker.status === "released") {
    putCachedFordSticker(sticker);
  } else {
    MEMORY_CACHE.set(cleanVin, sticker);
  }
  return sticker;
}

export async function confirmFordMustHaves(
  vin: string,
  mustHaveLines: string[]
): Promise<MustHaveCheck> {
  const sticker = await getFordSticker(vin);
  return confirmFordMustHavesFromSticker(sticker, mustHaveLines);
}

export type DealerPageVinResult = {
  vin: string | null;
  blocked: boolean;
  httpStatus?: number;
};

export type PasteVinResolution = {
  vin: string | null;
  dealerBlocked: boolean;
  source: "paste" | "dealer_page" | "none";
};

/**
 * Fetch a user-pasted dealer VDP once to pull a VIN out of the HTML.
 * Not a warehouse crawl — one URL the user just handed us.
 */
export async function extractVinFromDealerPage(url: string): Promise<DealerPageVinResult> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": BROWSER_UA,
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text().catch(() => "");
    const denied = /access denied|akamai|errors\.edgesuite|reference\s+#/i.test(html);
    if (!res.ok || denied) {
      return { vin: null, blocked: true, httpStatus: res.status };
    }
    return { vin: extractVin(html), blocked: false, httpStatus: res.status };
  } catch {
    return { vin: null, blocked: true };
  }
}

export async function resolveVinFromPaste(paste: string): Promise<string | null> {
  const resolved = await resolvePasteVin(paste);
  return resolved.vin;
}

export async function resolvePasteVin(paste: string): Promise<PasteVinResolution> {
  const direct = extractVin(paste);
  if (direct) {
    if (looksLikeFordOrLincolnPaste(paste) && !isFordOrLincolnVin(direct) && looksLikeUrl(paste)) {
      // Hash/AWS-shaped token in the URL is not the vehicle. Fetch the page.
    } else {
      return { vin: direct, dealerBlocked: false, source: "paste" };
    }
  }
  if (looksLikeUrl(paste)) {
    const page = await extractVinFromDealerPage(paste.trim());
    if (page.vin) return { vin: page.vin, dealerBlocked: false, source: "dealer_page" };
    return { vin: null, dealerBlocked: page.blocked, source: "none" };
  }
  return { vin: null, dealerBlocked: false, source: "none" };
}
