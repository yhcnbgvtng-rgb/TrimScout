/**
 * GM (Chevrolet / GMC / Buick / Cadillac) window-sticker fetch, parse, and cache.
 *
 * Official PDF (roughly 2020+):
 *   https://cws.gm.com/vs-cws/vehshop/v2/vehicle/windowsticker?vin={VIN}
 *
 * GM layout is NOT Ford Direct. Expect "Total Vehicle Price", "Destination Charge",
 * "OPTIONAL EQUIPMENT", and RPO-prefixed option lines — never Ford's
 * "INCLUDED ON THIS VEHICLE" / "TOTAL MSRP" / "EQUIPMENT GROUP 800A" block.
 *
 * User-initiated only (subject VIN + up to 25–50 hunt candidates).
 * Released stickers are cached forever. Unreleased / Akamai-empty bodies are not.
 *
 * Akamai on cws.gm.com: datacenter curl AND headless Chrome from this host both
 * get HTTP 200 + application/pdf with a 0-byte body (plus `_abck` cookies), while
 * Ford Direct from the same machine returns a real PDF. After the empty HTTP
 * probe we try the small Chrome/CDP worker in gmStickerBrowser.ts. If that is
 * also empty, bundled fixtures cover the demo Silverado VIN only.
 */

import fs from "fs";
import path from "path";
import {
  extractVin,
  extractVinFromDealerPage,
  looksLikeUrl,
  normalizeForMatch,
  parseColorMustHave,
  parseMoney,
  resolvePasteVin,
  colorsMatch,
  exteriorColorMustHaveName,
  interiorColorMustHaveName,
  type PasteVinResolution,
} from "./fordSticker";
import { browserWorkerConfigured, fetchGmPdfViaBrowser } from "./gmStickerBrowser";
import { isGmVin, looksLikeGmPaste } from "./oemWmi";

export { extractVin, looksLikeUrl, resolvePasteVin, extractVinFromDealerPage };
export { isGmVin, looksLikeGmPaste } from "./oemWmi";
export type { PasteVinResolution };

export const GM_STICKER_PDF_URL =
  "https://cws.gm.com/vs-cws/vehshop/v2/vehicle/windowsticker";

export const DEMO_GM_SUBJECT_VIN = "1GCUKDED9TZ134987";

export type StickerStatus = "released" | "unreleased" | "error";
export type GmFetchKind =
  | "pdf"
  | "unreleased_json"
  | "akamai_empty"
  | "html_denied"
  | "unknown";
export type GmFetchSource = "live" | "browser" | "fixture" | "cache";

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
  fetchSource?: GmFetchSource;
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
  return (
    n.includes("MULTI FLEX") ||
    n.includes("MULTIFLEX") ||
    (n.includes("QT6") && n.includes("TAILGATE"))
  );
}

export function isSuperCruiseLine(name: string): boolean {
  const n = normalizeForMatch(name);
  return n.includes("SUPER CRUISE") || n.includes("SUPERCRUISE");
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export function classifyGmFetchBody(bytes: Uint8Array, contentType?: string | null): GmFetchKind {
  if (looksLikePdf(bytes) && bytes.length > 500) return "pdf";
  const text = new TextDecoder().decode(bytes);
  if (UNRELEASED_PATTERNS.some((re) => re.test(text))) return "unreleased_json";
  if (bytes.length === 0) return "akamai_empty";
  if (/pdf_embedder\.css|chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai/i.test(text)) {
    return "akamai_empty";
  }
  if (/access denied|errors\.edgesuite|akamai-grn|_abck/i.test(text)) return "html_denied";
  if (looksLikePdf(bytes)) return "pdf";
  if ((contentType || "").includes("pdf") && bytes.length < 500) return "akamai_empty";
  return "unknown";
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
      note: "The GM window sticker has not yet been released. Dealer ad copy is not proof.",
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
    const rest = headline[3].replace(/\s+/g, " ").trim();
    const modelParts = rest.split(/\s+/);
    // Silverado 1500 LT … — keep series in the model when present.
    if (/^SILVERADO$/i.test(modelParts[0]) && modelParts[1] && /^\d{3,4}$/.test(modelParts[1])) {
      sticker.model = `Silverado ${modelParts[1]}`;
      sticker.trim = modelParts.slice(2).join(" ") || undefined;
    } else if (modelParts.length >= 2 && /SPORT/i.test(modelParts[1])) {
      sticker.model = titleCase(`${modelParts[0]} ${modelParts[1]}`);
      sticker.trim = modelParts.slice(2).join(" ") || undefined;
    } else {
      sticker.model = titleCase(modelParts[0]);
      sticker.trim = modelParts.slice(1).join(" ") || undefined;
    }
  } else {
    const yearOnly = text.match(/\b(20\d{2})\s+SILVERADO(?:\s+1500)?/i);
    if (yearOnly) {
      sticker.year = Number.parseInt(yearOnly[1], 10);
      sticker.model = "Silverado 1500";
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

  const cab = text.match(/\b(CREW CAB|DOUBLE CAB|REGULAR CAB|SHORT BOX|STANDARD BOX|LONG BOX)\b/i);
  if (cab && sticker.trim && !new RegExp(cab[1], "i").test(sticker.trim)) {
    // cab/box stay on the vehicle description, not the trim filter list
  }

  const base = text.match(/BASE PRICE\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (base) sticker.basePrice = parseMoney(base[1]);
  const opts =
    text.match(/TOTAL OPTIONS\s*\$?\s*([\d,]+(?:\.\d{2})?)/i) ||
    text.match(/\bOPTIONS\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (opts) sticker.optionsPrice = parseMoney(opts[1]);
  const dest = text.match(
    /DESTINATION(?:\s+FREIGHT)?(?:\s+CHARGE)?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i
  );
  if (dest) sticker.destination = parseMoney(dest[1]);

  const totalVehicle = text.match(/TOTAL VEHICLE PRICE\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (totalVehicle) sticker.msrp = parseMoney(totalVehicle[1]);
  if (
    sticker.msrp == null &&
    sticker.basePrice != null &&
    sticker.optionsPrice != null &&
    sticker.destination != null
  ) {
    sticker.msrp =
      Math.round((sticker.basePrice + sticker.optionsPrice + sticker.destination) * 100) / 100;
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
  const skipHeaders =
    /^(OPTIONAL EQUIPMENT(?:\s+AND\s+PACKAGES)?|ADDITIONAL EQUIPMENT|PACKAGES|OPTIONS)$/i;
  for (const line of optionalBlock.split("\n").map((l) => l.trim()).filter(Boolean)) {
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
        l &&
        !/^(STANDARD EQUIPMENT|MECHANICAL|INTERIOR|EXTERIOR|SAFETY(?:\/SECURITY)?|COMFORT)$/i.test(l)
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

export function confirmGmMustHavesFromSticker(
  sticker: GmSticker,
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

function cachePath(vin: string): string {
  return path.join(CACHE_DIR, `${vin.toUpperCase()}.json`);
}

function readDiskCache(vin: string): GmSticker | null {
  try {
    const raw = fs.readFileSync(cachePath(vin), "utf8");
    const parsed = JSON.parse(raw) as GmSticker & { parserVersion?: number };
    if (parsed?.status === "released" && parsed.vin && parsed.parserVersion === PARSER_VERSION) {
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
    fs.writeFileSync(
      cachePath(sticker.vin),
      JSON.stringify({ ...sticker, parserVersion: PARSER_VERSION })
    );
  } catch {
    /* /tmp may be unavailable */
  }
}

export function getCachedGmSticker(vin: string): GmSticker | null {
  const key = vin.trim().toUpperCase();
  return MEMORY_CACHE.get(key) || readDiskCache(key);
}

export function putCachedGmSticker(sticker: GmSticker): void {
  MEMORY_CACHE.set(sticker.vin, sticker);
  writeDiskCache(sticker);
}

export function gmDemoFixturePaths(vin: string): string[] {
  const file = `${vin.trim().toUpperCase()}.txt`;
  const paths = [path.join(process.cwd(), "lib/testdata/gm-stickers", file)];
  try {
    paths.unshift(path.join(import.meta.dirname, "testdata/gm-stickers", file));
  } catch {
    /* import.meta.dirname unavailable in some bundles */
  }
  return paths;
}

export function stickerFromGmDemoFixture(vin: string): GmSticker | null {
  for (const filePath of gmDemoFixturePaths(vin)) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const sticker = parseGmStickerText(vin, fs.readFileSync(filePath, "utf8"));
      sticker.fetchSource = "fixture";
      return sticker;
    } catch {
      /* try next path */
    }
  }
  return null;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(bytes, { mergePages: true });
  const text = result.text;
  return Array.isArray(text) ? text.join("\n") : String(text || "");
}

export interface GmPdfProbe {
  vin: string;
  url: string;
  httpStatus: number;
  byteLength: number;
  contentType: string | null;
  kind: GmFetchKind;
  magic: string;
}

export async function probeGmPdfFetch(vin: string): Promise<GmPdfProbe> {
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
  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get("content-type");
  return {
    vin: vin.toUpperCase(),
    url,
    httpStatus: res.status,
    byteLength: bytes.length,
    contentType,
    kind: classifyGmFetchBody(bytes, contentType),
    magic: Buffer.from(bytes.slice(0, 8)).toString("latin1"),
  };
}

async function fetchGmStickerBytesHttp(vin: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
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
  if (!res.ok && res.status !== 200) {
    throw new Error(`GM CWS returned HTTP ${res.status} for VIN ${vin}`);
  }
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
}

const AKAMAI_NOTE =
  "GM CWS returned HTTP 200 with an empty PDF body (Akamai bot cookies). " +
  "Ford Direct from the same host returns a real PDF. A Chrome/CDP browser worker is the fallback; " +
  "set GM_STICKER_BROWSER_WS or CHROME_PATH. This is not dealer-site scraping.";

export async function getGmSticker(vin: string): Promise<GmSticker> {
  const cleanVin = vin.trim().toUpperCase();
  if (cleanVin.length !== 17) {
    throw new Error("VIN must be exactly 17 characters");
  }
  const cached = getCachedGmSticker(cleanVin);
  if (cached) {
    return { ...cached, fetchSource: "cache" };
  }

  let source: GmFetchSource = "live";
  let kind: GmFetchKind = "unknown";
  let bytes: Uint8Array | null = null;

  try {
    const http = await fetchGmStickerBytesHttp(cleanVin);
    kind = classifyGmFetchBody(http.bytes, http.contentType);
    if (kind === "pdf") bytes = http.bytes;
    if (kind === "unreleased_json") {
      const sticker = parseGmStickerText(cleanVin, new TextDecoder().decode(http.bytes));
      sticker.fetchSource = "live";
      sticker.fetchKind = kind;
      MEMORY_CACHE.set(cleanVin, sticker);
      return sticker;
    }
  } catch (err) {
    kind = "unknown";
    console.error("GM CWS HTTP fetch failed:", err);
  }

  if (!bytes && (kind === "akamai_empty" || kind === "html_denied" || kind === "unknown")) {
    const skipBrowser =
      process.env.GM_STICKER_SKIP_BROWSER === "1" || Boolean(process.env.NODE_TEST_CONTEXT);
    if (!skipBrowser && browserWorkerConfigured()) {
      try {
        const browserBytes = await fetchGmPdfViaBrowser(gmStickerPdfUrl(cleanVin));
        const browserKind = classifyGmFetchBody(browserBytes, "application/pdf");
        if (browserKind === "pdf") {
          bytes = browserBytes;
          source = "browser";
          kind = "pdf";
        } else if (browserKind === "unreleased_json") {
          const sticker = parseGmStickerText(cleanVin, new TextDecoder().decode(browserBytes));
          sticker.fetchSource = "browser";
          sticker.fetchKind = browserKind;
          MEMORY_CACHE.set(cleanVin, sticker);
          return sticker;
        } else {
          kind = browserKind;
        }
      } catch (err) {
        console.error("GM sticker browser worker failed:", err);
      }
    }
  }

  if (bytes && looksLikePdf(bytes)) {
    const text = await extractPdfText(bytes);
    const sticker = parseGmStickerText(cleanVin, text);
    sticker.fetchSource = source;
    sticker.fetchKind = "pdf";
    if (sticker.status === "released") putCachedGmSticker(sticker);
    else MEMORY_CACHE.set(cleanVin, sticker);
    return sticker;
  }

  const fixture = stickerFromGmDemoFixture(cleanVin);
  if (fixture) {
    fixture.note = [fixture.note, AKAMAI_NOTE].filter(Boolean).join(" ");
    fixture.fetchKind = kind;
    fixture.fetchSource = "fixture";
    MEMORY_CACHE.set(cleanVin, fixture);
    return fixture;
  }

  throw new Error(
    `GM window sticker fetch returned ${kind} (${bytes?.length ?? 0} bytes) for VIN ${cleanVin}. ${AKAMAI_NOTE}`
  );
}

export async function confirmGmMustHaves(
  vin: string,
  mustHaveLines: string[]
): Promise<MustHaveCheck> {
  const sticker = await getGmSticker(vin);
  return confirmGmMustHavesFromSticker(sticker, mustHaveLines);
}
