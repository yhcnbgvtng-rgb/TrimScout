/**
 * Live per-VIN listing facts for the post-Step-5 compare page.
 *
 * MarketCheck ToS: query live on this request. Do not cache, warehouse, or
 * store raw listing payloads. Transient in-memory for this request is fine.
 * The mapped shopper sheet is the only shape that leaves the server.
 */

import {
  FORD_LISTINGS_LOAD_FAILED,
  FORD_LISTINGS_RATE_LIMIT,
  LISTING_DETAILS_UNAVAILABLE,
  listingVdpHref,
  sanitizeShopperListingsCopy,
} from "./fordCompetitionUi";
import { exteriorColorNameFor } from "./porscheColors";
import { serverSecret } from "./serverSecret";

export const MARKETCHECK_SHOPPER_ATTRIBUTION = "Data powered by MarketCheck";

export const MAX_LISTING_SHEET_VINS = 3;

/** Most recent distinct prices shown on a compare column. */
export const MAX_SHOPPER_PRICE_HISTORY = 10;

export interface ShopperPriceHistoryEntry {
  date: string;
  price: number;
  /** Delta vs the previous distinct price; null on the first row. */
  change: number | null;
}

export interface ShopperListingSheet {
  vin: string;
  available: boolean;
  /** Present only on a successful mapped sheet. Never on errors/empty. */
  attribution: string | null;
  advertisedPrice: number | null;
  msrp: number | null;
  priceChange: number | null;
  priceHistory: ShopperPriceHistoryEntry[];
  daysOnMarket: number | null;
  daysOnMarketActive: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  stockNumber: string | null;
  inventoryType: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  mileage: number | null;
  dealerName: string | null;
  dealerStreet: string | null;
  dealerCity: string | null;
  dealerState: string | null;
  dealerZip: string | null;
  dealerPhone: string | null;
  vdpUrl: string | null;
  inTransit: boolean | null;
  photoUrl: string | null;
  note: string | null;
}

export function normalizeListingVins(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const vin = String(value || "")
      .trim()
      .toUpperCase();
    if (vin.length !== 17 || seen.has(vin)) continue;
    seen.add(vin);
    out.push(vin);
    if (out.length >= MAX_LISTING_SHEET_VINS) break;
  }
  return out;
}

function emptySheet(vin: string, note: string): ShopperListingSheet {
  return {
    vin,
    available: false,
    attribution: null,
    advertisedPrice: null,
    msrp: null,
    priceChange: null,
    priceHistory: [],
    daysOnMarket: null,
    daysOnMarketActive: null,
    firstSeen: null,
    lastSeen: null,
    stockNumber: null,
    inventoryType: null,
    exteriorColor: null,
    interiorColor: null,
    mileage: null,
    dealerName: null,
    dealerStreet: null,
    dealerCity: null,
    dealerState: null,
    dealerZip: null,
    dealerPhone: null,
    vdpUrl: null,
    inTransit: null,
    photoUrl: null,
    note: sanitizeShopperListingsCopy(note) || LISTING_DETAILS_UNAVAILABLE,
  };
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number.parseFloat(value.replace(/[$,]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asPositivePrice(value: unknown): number | null {
  const n = asFiniteNumber(value);
  return n != null && n > 0 ? n : null;
}

function asNonNegativeInt(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n == null || n < 0) return null;
  return Math.round(n);
}

function asTrimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function formatSeenAt(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && value.trim()) {
    const iso = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function inventoryTypeLabel(value: unknown): string | null {
  const raw = asTrimmed(value)?.toLowerCase();
  if (!raw) return null;
  if (raw === "new") return "new";
  if (raw === "used") return "used";
  if (raw === "cpo" || raw.includes("certified")) return "cpo";
  return null;
}

function firstPhotoUrl(media: Record<string, unknown> | null): string | null {
  if (!media) return null;
  const links = media.photo_links;
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    const href = asTrimmed(link);
    if (href && /^https?:\/\//i.test(href) && !/api[_-]?key=/i.test(href)) return href;
  }
  return null;
}

function dealerPhone(value: unknown): string | null {
  const raw = asTrimmed(value);
  if (!raw) return null;
  if (/@/.test(raw)) return null;
  return raw;
}

function listingIdFrom(row: Record<string, unknown>): string | null {
  for (const key of ["id", "listing_id"]) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    const text = asTrimmed(value);
    if (text) return text;
  }
  return null;
}

function historyListingRows(payload: unknown): unknown[] {
  const root = record(payload);
  if (Array.isArray(root?.listings)) return root!.listings;
  if (Array.isArray(payload)) return payload;
  return [];
}

function historyPrices(payload: unknown): number[] {
  const prices: number[] = [];
  for (const row of historyListingRows(payload)) {
    const rec = record(row);
    const price = asPositivePrice(rec?.price);
    if (price) prices.push(price);
  }
  return prices;
}

function snapshotSortMs(rec: Record<string, unknown>, date: string): number {
  for (const key of ["first_seen_at", "last_seen_at", "scraped_at", "ref_price_dt"]) {
    const value = rec[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      const ms = value > 1e12 ? value : value * 1000;
      if (!Number.isNaN(new Date(ms).getTime())) return ms;
    }
    if (typeof value === "string" && value.trim()) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.getTime();
    }
  }
  const fromDate = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(fromDate) ? fromDate : 0;
}

function snapshotFromHistoryRow(
  rec: Record<string, unknown> | null
): { price: number; date: string; sortMs: number } | null {
  if (!rec) return null;
  const price = asPositivePrice(rec.price);
  if (!price) return null;
  const date =
    formatSeenAt(rec.first_seen_at_date) ||
    formatSeenAt(rec.first_seen_at) ||
    formatSeenAt(rec.last_seen_at_date) ||
    formatSeenAt(rec.last_seen_at) ||
    formatSeenAt(rec.scraped_at_date) ||
    formatSeenAt(rec.scraped_at) ||
    formatSeenAt(rec.ref_price_dt);
  if (!date) return null;
  return { price, date, sortMs: snapshotSortMs(rec, date) };
}

function publicPriceHistory(entries: ShopperPriceHistoryEntry[] | undefined): ShopperPriceHistoryEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const out: ShopperPriceHistoryEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) continue;
    if (typeof entry.price !== "number" || !Number.isFinite(entry.price) || entry.price <= 0) continue;
    const change =
      entry.change == null || typeof entry.change !== "number" || !Number.isFinite(entry.change)
        ? null
        : entry.change;
    out.push({ date: entry.date, price: entry.price, change });
    if (out.length >= MAX_SHOPPER_PRICE_HISTORY) break;
  }
  return out;
}

/**
 * Dated shopper price history from VIN history snapshots (and optional
 * listing-detail ref_price). Consecutive identical prices are dropped.
 * Chronological (oldest first); capped to the most recent distinct prices.
 */
export function mapShopperPriceHistory(history: unknown, listingDetail?: unknown): ShopperPriceHistoryEntry[] {
  const rows: Array<{ price: number; date: string; sortMs: number; idx: number }> = [];
  for (const row of historyListingRows(history)) {
    const snap = snapshotFromHistoryRow(record(row));
    if (snap) rows.push({ ...snap, idx: rows.length });
  }
  const detail = record(listingDetail);
  if (detail) {
    const refPrice = asPositivePrice(detail.ref_price);
    const refDate = formatSeenAt(detail.ref_price_dt);
    if (refPrice && refDate) {
      rows.push({
        price: refPrice,
        date: refDate,
        sortMs: snapshotSortMs({ ref_price_dt: detail.ref_price_dt }, refDate),
        idx: rows.length,
      });
    }
  }
  rows.sort((a, b) => a.sortMs - b.sortMs || a.idx - b.idx);
  const deduped: Array<{ price: number; date: string }> = [];
  for (const row of rows) {
    const last = deduped[deduped.length - 1];
    if (last && last.price === row.price) continue;
    deduped.push({ price: row.price, date: row.date });
  }
  const withChange: ShopperPriceHistoryEntry[] = deduped.map((row, i) => ({
    date: row.date,
    price: row.price,
    change: i === 0 ? null : row.price - deduped[i - 1].price,
  }));
  return withChange.slice(-MAX_SHOPPER_PRICE_HISTORY);
}

function priceChangeVsPrior(
  current: number | null,
  listingChange: unknown,
  history: number[]
): number | null {
  const fromListing = asFiniteNumber(listingChange);
  if (fromListing != null && fromListing !== 0) return fromListing;
  if (current == null) return null;
  const prior = history.find((price) => price !== current);
  if (prior == null) return null;
  return current - prior;
}

/**
 * Map MarketCheck search / history / optional listing-detail payloads into a
 * shopper sheet. Drops internal ids, data_source, API keys, and dealer emails.
 */
export function shopperSheetFromMarketCheckPayloads(opts: {
  vin: string;
  searchListing: unknown;
  history?: unknown;
  listingDetail?: unknown;
}): ShopperListingSheet {
  const vin = opts.vin.trim().toUpperCase();
  const search = record(opts.searchListing);
  const detail = record(opts.listingDetail);
  const row = detail || search;
  if (!row) return emptySheet(vin, LISTING_DETAILS_UNAVAILABLE);

  const dealer = record(row.dealer) || {};
  const media = record(row.media);
  const extra = record(row.extra);
  const advertisedPrice = asPositivePrice(row.price) ?? asPositivePrice(row.asking_price);
  const msrp = asPositivePrice(row.msrp);
  const mileage = asNonNegativeInt(row.miles ?? row.mileage);
  const inventoryType =
    inventoryTypeLabel(row.inventory_type) || inventoryTypeLabel(extra?.inventory_type);
  const inTransit =
    typeof row.in_transit === "boolean"
      ? row.in_transit
      : typeof extra?.in_transit === "boolean"
        ? (extra.in_transit as boolean)
        : null;
  const firstSeen =
    formatSeenAt(row.first_seen_at_date) ||
    formatSeenAt(row.first_seen_at) ||
    formatSeenAt(row.scraped_at_date);
  const lastSeen =
    formatSeenAt(row.last_seen_at_date) || formatSeenAt(row.last_seen_at) || formatSeenAt(row.scraped_at);

  const sheet: ShopperListingSheet = {
    vin,
    available: true,
    attribution: MARKETCHECK_SHOPPER_ATTRIBUTION,
    advertisedPrice,
    msrp,
    priceChange: priceChangeVsPrior(advertisedPrice, row.price_change, historyPrices(opts.history)),
    priceHistory: mapShopperPriceHistory(opts.history, opts.listingDetail),
    daysOnMarket: asNonNegativeInt(row.dom),
    daysOnMarketActive: asNonNegativeInt(row.dom_active),
    firstSeen,
    lastSeen,
    stockNumber: asTrimmed(row.stock_no) || asTrimmed(row.stock),
    inventoryType,
    // A Porsche feed says "0q0q" where a shopper needs "White".
    exteriorColor: exteriorColorNameFor({ vin }, asTrimmed(row.exterior_color)),
    interiorColor: asTrimmed(row.interior_color),
    mileage,
    dealerName: asTrimmed(dealer.name),
    dealerStreet: asTrimmed(dealer.street) || asTrimmed(dealer.address),
    dealerCity: asTrimmed(dealer.city),
    dealerState: asTrimmed(dealer.state),
    dealerZip: asTrimmed(dealer.zip),
    dealerPhone: dealerPhone(dealer.phone),
    vdpUrl: listingVdpHref(asTrimmed(row.vdp_url)),
    inTransit,
    photoUrl: firstPhotoUrl(media),
    note: null,
  };

  const hasFacts =
    sheet.advertisedPrice != null ||
    sheet.msrp != null ||
    sheet.dealerName != null ||
    sheet.vdpUrl != null ||
    sheet.stockNumber != null ||
    sheet.daysOnMarket != null ||
    sheet.photoUrl != null;
  if (!hasFacts) return emptySheet(vin, LISTING_DETAILS_UNAVAILABLE);
  return sheet;
}

function firstSearchListing(payload: unknown): unknown {
  const root = record(payload);
  if (Array.isArray(root?.listings) && root!.listings.length > 0) return root!.listings[0];
  if (Array.isArray(payload) && payload.length > 0) return payload[0];
  return null;
}

function shopperNoteForStatus(status: number): string {
  if (status === 429) return FORD_LISTINGS_RATE_LIMIT;
  return FORD_LISTINGS_LOAD_FAILED;
}

export async function marketcheckGet(
  fetchImpl: typeof fetch,
  url: URL
): Promise<{ ok: true; payload: unknown } | { ok: false; note: string; empty: boolean }> {
  const res = await fetchImpl(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 404) return { ok: false, note: LISTING_DETAILS_UNAVAILABLE, empty: true };
  if (!res.ok) return { ok: false, note: shopperNoteForStatus(res.status), empty: false };
  try {
    return { ok: true, payload: await res.json() };
  } catch {
    return { ok: false, note: FORD_LISTINGS_LOAD_FAILED, empty: false };
  }
}

export function marketcheckUrl(path: string, key: string, query?: Record<string, string>): URL {
  const url = new URL(`https://api.marketcheck.com${path}`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("append_api_key", "false");
  if (query) {
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  }
  return url;
}

export async function fetchShopperListingSheets(
  vins: string[],
  opts?: {
    fetchImpl?: typeof fetch;
    apiKey?: string | null;
  }
): Promise<ShopperListingSheet[]> {
  const capped = normalizeListingVins(vins);
  const key = opts?.apiKey !== undefined ? opts.apiKey : serverSecret("MARKETCHECK_API_KEY");
  if (!key) {
    return capped.map((vin) => emptySheet(vin, LISTING_DETAILS_UNAVAILABLE));
  }
  const fetchImpl = opts?.fetchImpl || fetch;

  return Promise.all(
    capped.map(async (vin) => {
      try {
        const searchUrl = marketcheckUrl("/v2/search/car/active", key, { vin });
        const historyUrl = marketcheckUrl(`/v2/history/car/${encodeURIComponent(vin)}`, key);
        const [searchRes, historyRes] = await Promise.all([
          marketcheckGet(fetchImpl, searchUrl),
          marketcheckGet(fetchImpl, historyUrl),
        ]);

        if (!searchRes.ok && !searchRes.empty) {
          return emptySheet(vin, searchRes.note);
        }
        const searchListing = searchRes.ok ? firstSearchListing(searchRes.payload) : null;
        if (!searchListing) return emptySheet(vin, LISTING_DETAILS_UNAVAILABLE);

        let listingDetail: unknown;
        const listingId = listingIdFrom(record(searchListing) || {});
        if (listingId) {
          const detailUrl = marketcheckUrl(`/v2/listing/car/${encodeURIComponent(listingId)}`, key);
          const detailRes = await marketcheckGet(fetchImpl, detailUrl);
          if (detailRes.ok) listingDetail = detailRes.payload;
        }

        return shopperSheetFromMarketCheckPayloads({
          vin,
          searchListing,
          history: historyRes.ok ? historyRes.payload : undefined,
          listingDetail,
        });
      } catch {
        return emptySheet(vin, FORD_LISTINGS_LOAD_FAILED);
      }
    })
  );
}

export interface CurrentDealerLookup {
  dealerName: string;
  dealerStreet: string | null;
  dealerCity: string;
  dealerState: string;
  dealerZip: string | null;
  dealerPhone: string | null;
  vdpUrl: string | null;
}

/**
 * Who currently has this VIN listed, straight off one search-only MarketCheck
 * call — never the history or listing-detail calls, since only dealer
 * identity is needed here. Used at VIN-import time so the vehicle's dealer is
 * the one actually advertising it, not the factory's ship-to dealer on the
 * window sticker (which never updates after a car changes hands). Never
 * throws — a MarketCheck failure must not block a sticker import.
 */
export async function currentDealerForVin(
  vin: string,
  opts?: { fetchImpl?: typeof fetch; apiKey?: string | null }
): Promise<CurrentDealerLookup | null> {
  const cleanVin = vin.trim().toUpperCase();
  if (cleanVin.length !== 17) return null;
  const key = opts?.apiKey !== undefined ? opts.apiKey : serverSecret("MARKETCHECK_API_KEY");
  if (!key) return null;
  const fetchImpl = opts?.fetchImpl || fetch;

  try {
    const searchUrl = marketcheckUrl("/v2/search/car/active", key, { vin: cleanVin });
    const searchRes = await marketcheckGet(fetchImpl, searchUrl);
    if (!searchRes.ok) return null;
    const row = record(firstSearchListing(searchRes.payload));
    if (!row) return null;
    const dealer = record(row.dealer) || {};
    const dealerName = asTrimmed(dealer.name);
    if (!dealerName) return null;
    return {
      dealerName,
      dealerStreet: asTrimmed(dealer.street) || asTrimmed(dealer.address),
      dealerCity: asTrimmed(dealer.city) || "",
      dealerState: asTrimmed(dealer.state) || "",
      dealerZip: asTrimmed(dealer.zip),
      dealerPhone: dealerPhone(dealer.phone),
      vdpUrl: listingVdpHref(asTrimmed(row.vdp_url)),
    };
  } catch {
    return null;
  }
}

/** Drop any accidental raw-provider keys before JSON goes to the browser. */
export function publicListingSheets(sheets: ShopperListingSheet[]): ShopperListingSheet[] {
  return sheets.map((sheet) => ({
    vin: sheet.vin,
    available: sheet.available,
    attribution: sheet.available ? MARKETCHECK_SHOPPER_ATTRIBUTION : null,
    advertisedPrice: sheet.advertisedPrice,
    msrp: sheet.msrp,
    priceChange: sheet.priceChange,
    priceHistory: publicPriceHistory(sheet.priceHistory),
    daysOnMarket: sheet.daysOnMarket,
    daysOnMarketActive: sheet.daysOnMarketActive,
    firstSeen: sheet.firstSeen,
    lastSeen: sheet.lastSeen,
    stockNumber: sheet.stockNumber,
    inventoryType: sheet.inventoryType,
    exteriorColor: sheet.exteriorColor,
    interiorColor: sheet.interiorColor,
    mileage: sheet.mileage,
    dealerName: sheet.dealerName,
    dealerStreet: sheet.dealerStreet,
    dealerCity: sheet.dealerCity,
    dealerState: sheet.dealerState,
    dealerZip: sheet.dealerZip,
    dealerPhone: sheet.dealerPhone,
    vdpUrl: listingVdpHref(sheet.vdpUrl),
    inTransit: sheet.inTransit,
    photoUrl: sheet.photoUrl,
    note: sheet.available ? null : sanitizeShopperListingsCopy(sheet.note || LISTING_DETAILS_UNAVAILABLE),
  }));
}
