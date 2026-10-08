/**
 * Hand-off from buyer search to step 1 of "Request a quote": the picked vehicles' VINs and listing (VDP) links.
 * The search page writes them to sessionStorage on the buyer's click; the home page reads and clears them on arrival and
 * opens the wizard, which feeds each one through its normal paste/confirm path. Nothing is sent, invited or submitted here.
 */
export const QUOTE_SEED_KEY = "trimscout.quoteSeed.v1";
export const QUOTE_SEED_MAX = 3;
/**
 * The lane the wizard opens on for picked cars, one car or three. Never "alternate" (Open to anything): that lane sends
 * dealers only, so the cars would be left out of the request and Step 3 would ask for dealers from scratch. On the
 * specific-vehicle lane the cars ride in the request and Step 3's dealer list is built from them.
 */
export const QUOTE_SEED_LANE = "same_spec" as const;

export interface QuoteSeedVehicle {
  vin: string;
  /** The dealer's listing page for this car; null when the row had no link. */
  vdpUrl: string | null;
  /** What the listing says. Step 1 seats a used car only beside other used cars, a new one beside new; null = unknown, treated as new. */
  condition: "new" | "used" | "cpo" | null;
  /** The store that lists this car (from the search row); optional so seeds written before this still parse. */
  dealerId?: string | null;
  dealerName?: string | null;
  dealerState?: string | null;
}

export type SeedDealer = { deskId: string; dealerName: string; state: string | null };

/** One entry per distinct store behind the picked cars (same id, else same name + state), in pick order, max QUOTE_SEED_MAX. */
export function seedDealersFrom(cars: Array<Pick<QuoteSeedVehicle, "dealerId" | "dealerName" | "dealerState">>): SeedDealer[] {
  const out: SeedDealer[] = [];
  const seen = new Set<string>();
  for (const c of cars) {
    const name = (c.dealerName || "").trim();
    if (!name) continue;
    const state = (c.dealerState || "").trim().toUpperCase() || null;
    const key = c.dealerId ? `id:${c.dealerId}` : `n:${name.toLowerCase()}|${state ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ deskId: c.dealerId || `pick:${name.toLowerCase()}|${state ?? ""}`, dealerName: name, state });
    if (out.length >= QUOTE_SEED_MAX) break;
  }
  return out;
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
    const o = (item && typeof item === "object" ? item : {}) as { vin?: unknown; vdpUrl?: unknown; condition?: unknown; dealerId?: unknown; dealerName?: unknown; dealerState?: unknown };
    const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 200) : null);
    const vin = typeof o.vin === "string" ? o.vin.trim().toUpperCase() : "";
    if (!VIN.test(vin) || out.some((v) => v.vin === vin)) continue;
    out.push({ vin, vdpUrl: httpUrl(o.vdpUrl), condition: o.condition === "new" || o.condition === "used" || o.condition === "cpo" ? o.condition : null, dealerId: str(o.dealerId), dealerName: str(o.dealerName), dealerState: str(o.dealerState) });
    if (out.length >= QUOTE_SEED_MAX) break;
  }
  return out;
}

export function writeQuoteSeed(store: StorageLike, vehicles: Array<{ vin: string; vdpUrl: string | null; condition?: QuoteSeedVehicle["condition"]; dealerId?: string | null; dealerName?: string | null; dealerState?: string | null }>): QuoteSeedVehicle[] {
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
