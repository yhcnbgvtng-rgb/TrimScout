/**
 * Hand-off from buyer search to step 1 of "Request a quote": the picked vehicles' VINs and listing (VDP) links.
 * The search page writes them to sessionStorage on the buyer's click; the home page reads and clears them on arrival and
 * opens the wizard, which feeds each one through its normal paste/confirm path. Nothing is sent, invited or submitted here.
 */
export const QUOTE_SEED_KEY = "trimscout.quoteSeed.v1";
export const QUOTE_SEED_MAX = 3;

export interface QuoteSeedVehicle {
  vin: string;
  /** The dealer's listing page for this car; null when the row had no link. */
  vdpUrl: string | null;
  /** The store the search row listed the car at; lets the wizard prefill the dealership list. Optional. */
  dealerName?: string;
  dealerState?: string | null;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/i;
const httpUrl = (u: unknown): string | null => {
  if (typeof u !== "string") return null;
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:" ? p.toString() : null; } catch { return null; }
};

/** Valid, de-duplicated (by VIN), capped list. A non-http(s) link is dropped; a bad VIN drops the entry. */
export function sanitizeQuoteSeed(raw: unknown): QuoteSeedVehicle[] {
  const out: QuoteSeedVehicle[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const o = (item && typeof item === "object" ? item : {}) as { vin?: unknown; vdpUrl?: unknown; dealerName?: unknown; dealerState?: unknown };
    const vin = typeof o.vin === "string" ? o.vin.trim().toUpperCase() : "";
    if (!VIN.test(vin) || out.some((v) => v.vin === vin)) continue;
    const dealerName = typeof o.dealerName === "string" ? o.dealerName.trim().slice(0, 200) : "";
    const state = typeof o.dealerState === "string" ? o.dealerState.trim().toUpperCase() : "";
    out.push({ vin, vdpUrl: httpUrl(o.vdpUrl), ...(dealerName ? { dealerName, dealerState: /^[A-Z]{2}$/.test(state) ? state : null } : {}) });
    if (out.length >= QUOTE_SEED_MAX) break;
  }
  return out;
}

export function writeQuoteSeed(store: StorageLike, vehicles: QuoteSeedVehicle[]): QuoteSeedVehicle[] {
  const seed = sanitizeQuoteSeed(vehicles);
  try { store.setItem(QUOTE_SEED_KEY, JSON.stringify(seed)); } catch { /* storage blocked: the button then opens a plain wizard */ }
  return seed;
}

/** Reads the seed and removes it, so a refresh never re-seeds. */
export function takeQuoteSeed(store: StorageLike): QuoteSeedVehicle[] {
  try {
    const raw = store.getItem(QUOTE_SEED_KEY);
    store.removeItem(QUOTE_SEED_KEY);
    return raw ? sanitizeQuoteSeed(JSON.parse(raw)) : [];
  } catch { return []; }
}
