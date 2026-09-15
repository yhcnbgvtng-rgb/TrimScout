/**
 * Hyundai factory window sticker (Monroney) — the real OEM PDF, fetched
 * without touching a dealer's page.
 *
 * Fetch order (strict):
 *   1. DealerFire's public sticker host — a generic VIN-keyed URL every
 *      Hyundai dealer platform pulls from. The body is the OEM PDF
 *      (Hyundai Motor America's SAP Monroney form), base64-encoded under an
 *      application/pdf content type; a miss is a small base64 JSON
 *      {"error": "NEW document not found for VIN …", "statusCode": 404}.
 *   2. Hyundai's own dealer-external Monroney endpoint (same system of
 *      record, usually behind a bot wall — tried, never relied on).
 *   3. For a 5NM (Alabama) VIN, which Hyundai and Genesis share: Genesis's
 *      own sticker service, since the car may be a GV70.
 *
 * Nothing found → status "unreleased" (sticker pending): new Hyundais list
 * before the digital Monroney exists, often by a few weeks. The import
 * still goes through on the free decode; nothing is gated on the sticker.
 *
 * The parsed shape and the buyer-facing helpers are the Genesis ones —
 * same SAP form family, same sections ("EXTERIOR COLOR:", "ADDED
 * FEATURES:", "Inland Freight & Handling", "SOLD TO:") — with the handful
 * of Hyundai differences patched on top.
 */
import fs from "fs";
import path from "path";
import { isHyundaiVin, looksLikeHyundaiPaste, isGenesisVin } from "./oemWmi";
import {
  getGenesisSticker,
  genesisStickerToVehicle,
  looksLikePdf,
  parseGenesisStickerText,
  type GenesisSticker,
  type GenesisOptionLine,
} from "./genesisSticker";
import type { CurrentDealerLookup } from "./listingSheet";
import type { Vehicle } from "./types";

export { isHyundaiVin, looksLikeHyundaiPaste };
export type HyundaiSticker = GenesisSticker;
export type HyundaiStickerSource = "dealerfire" | "hyundai_oem" | "genesis";

export const HYUNDAI_DEALERFIRE_STICKER_URL = "https://hyundai-sticker.dealerfire.com/new";
export const HYUNDAI_OEM_STICKER_URL = "https://prevapp.hyundaiusa.com/DealerExternalService.svc/Monroney/pdf/GetMonroneyLabelPDF";
export const HYUNDAI_STICKER_PENDING_COPY = "Factory window sticker not published yet — we'll keep checking.";

const MEMORY_CACHE = new Map<string, HyundaiSticker>();
const CACHE_DIR = path.join("/tmp", "trimscout-hyundai-stickers");
const PARSER_VERSION = 1;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function hyundaiDealerFireUrl(vin: string): string {
  return `${HYUNDAI_DEALERFIRE_STICKER_URL}/${encodeURIComponent(vin.trim().toUpperCase())}`;
}
export function hyundaiOemStickerUrl(vin: string): string {
  return `${HYUNDAI_OEM_STICKER_URL}?VIN=${encodeURIComponent(vin.trim().toUpperCase())}`;
}

/** Current Hyundai nameplates as they print on the label's headline ("2026 TUCSON LIMITED AWD"). Longest first. */
const HYUNDAI_NAMEPLATES = [
  "SANTA FE HYBRID", "SANTA FE", "SANTA CRUZ", "IONIQ 5 N", "IONIQ 5", "IONIQ 6", "IONIQ 9", "TUCSON HYBRID", "TUCSON PLUG-IN HYBRID", "TUCSON",
  "ELANTRA HYBRID", "ELANTRA N", "ELANTRA", "SONATA HYBRID", "SONATA", "KONA ELECTRIC", "KONA N", "KONA", "PALISADE HYBRID", "PALISADE", "VENUE", "NEXO",
];

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (m, p, c) => p + c.toUpperCase());
}
function parseMoney(s: string): number | null {
  const n = Number.parseFloat(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Year / model / trim / drivetrain from the headline; the Genesis nameplate matcher knows none of these. */
export function parseHyundaiHeadline(text: string): { year?: number; model?: string; trim?: string; drivetrain?: string } {
  const names = HYUNDAI_NAMEPLATES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const m = text.match(new RegExp(`\\b(20\\d{2})\\s+(${names})\\b([^\\n]*)`, "i"));
  if (!m) return {};
  const rest = m[3] || "";
  const drive = rest.match(/\b(AWD|4WD|RWD|FWD|2WD|HTRAC)\b/i);
  const trim = rest.replace(/\b(AWD|4WD|RWD|FWD|2WD|HTRAC)\b/gi, "").replace(/\s+/g, " ").trim();
  return { year: Number.parseInt(m[1], 10), model: titleCase(m[2]), trim: trim ? titleCase(trim) : undefined, drivetrain: drive ? drive[1].toUpperCase().replace("HTRAC", "AWD") : undefined };
}

const HYUNDAI_SKIP_HEADERS =
  /^(AMERICA'S BEST WARRANTY|ADVANCED SAFETY TECHNOLOGIES|POWERTRAIN TECHNOLOGY|EXTERIOR|INTERIOR|COMFORT & CONVENIENCE(?:\(cont\.\))?|MULTIMEDIA & CONNECTIVITY(?:\(cont\.\))?|STANDARD FEATURES:|\*Limited warranties, see dealer for details)$/i;

/** The Genesis parser (same SAP form family), then Hyundai's headline, total-price and sold-to shapes on top. */
export function parseHyundaiStickerText(vin: string, text: string, pdfUrl: string = hyundaiDealerFireUrl(vin)): HyundaiSticker {
  const cleanVin = vin.trim().toUpperCase();
  const s = parseGenesisStickerText(cleanVin, text);
  s.make = "Hyundai";
  s.pdfUrl = pdfUrl;
  const head = parseHyundaiHeadline(text);
  if (head.year) s.year = head.year;
  if (head.model) s.model = head.model;
  if (head.trim !== undefined) s.trim = head.trim;
  if (head.drivetrain) s.drivetrain = head.drivetrain;
  // "Total Price : $44,110.00" — a space before the colon the Genesis regex doesn't allow.
  const total = text.match(/Total Price\s*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (total) s.msrp = parseMoney(total[1]);
  // "SOLD TO: PA018 SHIPPED TO: PA018\nMOTORWORLD HYUNDAI\n150 MOTORWORLD DR.\nWILKES-BARRE PA 18702"
  const sold = text.match(/SOLD TO:\s*\S+(?:\s+SHIPPED TO:\s*\S+)?\s*\n([A-Za-z0-9][A-Za-z0-9 .,&'\-]*)\n(?:([^\n]+)\n)?([A-Za-z][A-Za-z .'\-]+?)\s+([A-Z]{2})\s+(\d{5})\b/);
  if (sold) s.dealerSoldTo = { name: sold[1].trim(), address: sold[2]?.trim(), city: sold[3].trim(), state: sold[4], zip: sold[5], source: "sticker" };
  s.standardEquipment = s.standardEquipment.filter((l) => !HYUNDAI_SKIP_HEADERS.test(l) && !/^Manufacturer'?s Suggested Retail Price/i.test(l));
  // The label prints the VIN several times; none of them matching means the document isn't this car's.
  if (!text.toUpperCase().includes(cleanVin)) s.status = "error";
  return s;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------
export type HyundaiFetchKind = "pdf" | "not_found" | "denied" | "unknown";

/** DealerFire wraps the PDF (or its JSON miss) in base64 — undo that, then classify. */
export function decodeDealerFireBody(bytes: Uint8Array): { kind: HyundaiFetchKind; pdf?: Uint8Array } {
  if (looksLikePdf(bytes)) return { kind: "pdf", pdf: bytes };
  const head = Buffer.from(bytes.subarray(0, 64)).toString("latin1");
  if (/^\s*<!DOCTYPE|^\s*<html/i.test(head)) return { kind: "denied" };
  if (/^[A-Za-z0-9+/=\s]+$/.test(head)) {
    try {
      const decoded = Buffer.from(Buffer.from(bytes).toString("latin1").replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
      if (looksLikePdf(decoded)) return { kind: "pdf", pdf: new Uint8Array(decoded) };
      const asText = decoded.toString("utf8");
      if (/document not found|statusCode"\s*:\s*404/i.test(asText)) return { kind: "not_found" };
    } catch {
      /* fall through */
    }
  }
  if (/document not found/i.test(Buffer.from(bytes).toString("utf8"))) return { kind: "not_found" };
  return { kind: "unknown" };
}

async function fetchBytes(url: string, referer: string): Promise<{ bytes: Uint8Array; contentType: string | null; status: number }> {
  const res = await fetch(url, { headers: { Accept: "application/pdf,*/*;q=0.5", "User-Agent": BROWSER_UA, Referer: referer }, cache: "no-store" });
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type"), status: res.status };
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(bytes, { mergePages: true });
  const text = result.text;
  return Array.isArray(text) ? text.join("\n") : String(text || "");
}

function cacheJsonPath(vin: string): string { return path.join(CACHE_DIR, `${vin.toUpperCase()}.json`); }
function cachePdfPath(vin: string): string { return path.join(CACHE_DIR, `${vin.toUpperCase()}.pdf`); }
function readDiskCache(vin: string): HyundaiSticker | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheJsonPath(vin), "utf8")) as HyundaiSticker & { parserVersion?: number };
    if (parsed?.status === "released" && parsed.vin === vin.toUpperCase() && parsed.parserVersion === PARSER_VERSION) return parsed;
  } catch { /* miss */ }
  return null;
}
function writeDiskCache(sticker: HyundaiSticker): void {
  if (sticker.status !== "released") return;
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(cacheJsonPath(sticker.vin), JSON.stringify({ ...sticker, parserVersion: PARSER_VERSION })); } catch { /* /tmp may be unavailable */ }
}
function writePdfCache(vin: string, bytes: Uint8Array): void {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(cachePdfPath(vin), bytes); } catch { /* ignore */ }
}
function readPdfCache(vin: string): Uint8Array | null {
  try { const buf = fs.readFileSync(cachePdfPath(vin)); if (buf.length > 2000 && looksLikePdf(buf)) return new Uint8Array(buf); } catch { /* miss */ }
  return null;
}
export function clearHyundaiStickerMemoryCache(): void { MEMORY_CACHE.clear(); }

function pendingSticker(vin: string, note: string): HyundaiSticker {
  return { vin, status: "unreleased", make: "Hyundai", msrp: null, basePrice: null, optionsPrice: null, destination: null, options: [], standardEquipment: [], rawText: "", pdfUrl: hyundaiDealerFireUrl(vin), fetchedAt: new Date().toISOString(), note };
}

/**
 * The factory sticker for a Hyundai VIN, or an "unreleased" (pending)
 * record when no source has it yet. Misses are never cached — the next
 * paste checks again, which is the retry.
 */
export async function getHyundaiSticker(
  vin: string,
  deps: { fetchImpl?: (url: string, referer: string) => Promise<{ bytes: Uint8Array; contentType: string | null; status: number }>; genesis?: (vin: string) => Promise<GenesisSticker> } = {}
): Promise<HyundaiSticker & { source?: HyundaiStickerSource }> {
  const cleanVin = vin.trim().toUpperCase();
  if (cleanVin.length !== 17) throw new Error("VIN must be exactly 17 characters");
  const cached = MEMORY_CACHE.get(cleanVin) || readDiskCache(cleanVin);
  if (cached && cached.vin === cleanVin) return cached;
  const get = deps.fetchImpl || fetchBytes;

  const cachedPdf = readPdfCache(cleanVin);
  if (cachedPdf) {
    const s = parseHyundaiStickerText(cleanVin, await extractPdfText(cachedPdf));
    if (s.status === "released") { MEMORY_CACHE.set(cleanVin, s); writeDiskCache(s); return { ...s, source: "dealerfire" }; }
  }

  // 1. DealerFire
  const df = await get(hyundaiDealerFireUrl(cleanVin), "https://www.hyundaiusa.com/").catch(() => null);
  const decoded = df ? decodeDealerFireBody(df.bytes) : { kind: "unknown" as const };
  if (decoded.kind === "pdf" && decoded.pdf) {
    const s = parseHyundaiStickerText(cleanVin, await extractPdfText(decoded.pdf));
    if (s.status === "released") { writePdfCache(cleanVin, decoded.pdf); MEMORY_CACHE.set(cleanVin, s); writeDiskCache(s); return { ...s, source: "dealerfire" }; }
  }

  // 2. Hyundai's own endpoint (usually walled)
  const oem = await get(hyundaiOemStickerUrl(cleanVin), "https://www.hyundaiusa.com/").catch(() => null);
  if (oem && oem.status === 200 && looksLikePdf(oem.bytes)) {
    const s = parseHyundaiStickerText(cleanVin, await extractPdfText(oem.bytes), hyundaiOemStickerUrl(cleanVin));
    if (s.status === "released") { writePdfCache(cleanVin, oem.bytes); MEMORY_CACHE.set(cleanVin, s); writeDiskCache(s); return { ...s, source: "hyundai_oem" }; }
  }

  // 3. Shared Alabama WMI: it may be a Genesis.
  if (isGenesisVin(cleanVin)) {
    const g = await (deps.genesis || getGenesisSticker)(cleanVin).catch(() => null);
    if (g && g.status === "released" && g.vin === cleanVin) { MEMORY_CACHE.set(cleanVin, g); return { ...g, source: "genesis" }; }
  }

  return pendingSticker(cleanVin, decoded.kind === "not_found" ? HYUNDAI_STICKER_PENDING_COPY : `Factory window sticker not available right now (${decoded.kind}).`);
}

export function hyundaiStickerToVehicle(sticker: HyundaiSticker, listingUrl?: string | null, listingPrice?: number | null, currentDealer?: CurrentDealerLookup | null): Vehicle {
  const v = genesisStickerToVehicle(sticker, listingUrl, listingPrice, currentDealer);
  const make = sticker.make || "Hyundai";
  return { ...v, id: `${make.toLowerCase()}-${sticker.vin}`, make, location: { ...v.location, dealerName: v.location.dealerName === "Genesis dealer" ? "" : v.location.dealerName } };
}

/** Same picker rules as Genesis: colors first, then every priced/added feature. */
export function filterableHyundaiOptions(sticker: HyundaiSticker): GenesisOptionLine[] {
  const colors: GenesisOptionLine[] = [];
  if (sticker.exteriorColor) colors.push({ name: `Exterior color: ${sticker.exteriorColor}`, price: null, isStandard: false, isPackageChild: false, source: "sticker" });
  if (sticker.interiorColor) colors.push({ name: `Interior color: ${sticker.interiorColor}`, price: null, isStandard: false, isPackageChild: false, source: "sticker" });
  return [...colors, ...sticker.options.filter((o) => !o.isStandard && !o.isPackageChild)];
}
