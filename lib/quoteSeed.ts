/**
 * Hand-off from buyer search to step 1 of "Request a quote": the picked vehicles' VINs and listing (VDP) links.
 * The search page writes them on the buyer's click; the home page reads and clears them on arrival and
 * opens the wizard, which feeds each one through its normal paste/confirm path. Nothing is sent, invited or submitted here.
 *
 * The hand-off is written to sessionStorage AND localStorage (durableSeedStore) with a timestamp, so a blocked or cleared
 * sessionStorage (a new tab, a privacy mode) no longer opens the wizard empty. A seed older than QUOTE_SEED_TTL_MS is ignored.
 */
export const QUOTE_SEED_KEY = "trimscout.quoteSeed.v1";
export const QUOTE_SEED_MAX = 3;
/** How long a written seed stays usable: long enough for a sign-in detour, short enough that an abandoned click never resurfaces. */
export const QUOTE_SEED_TTL_MS = 30 * 60 * 1000;
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
  /** The trim as our inventory row spells it ("LT Trail Boss"); preferred over the VIN decoder's spelling. */
  trim?: string | null;
}

/** Identity of the store behind a car: its id, else its name + state. Null when the row names no store. */
export function seedStoreKey(c: Pick<QuoteSeedVehicle, "dealerId" | "dealerName" | "dealerState">): string | null {
  const name = (c.dealerName || "").trim();
  if (!name) return null;
  const state = (c.dealerState || "").trim().toUpperCase() || null;
  return c.dealerId ? `id:${c.dealerId}` : `n:${name.toLowerCase()}|${state ?? ""}`;
}

export type SeedDealer = { deskId: string; dealerName: string; state: string | null };

/** One entry per distinct store behind the picked cars (same id, else same name + state), in pick order, max QUOTE_SEED_MAX. */
export function seedDealersFrom(cars: Array<Pick<QuoteSeedVehicle, "dealerId" | "dealerName" | "dealerState">>): SeedDealer[] {
  const out: SeedDealer[] = [];
  const seen = new Set<string>();
  for (const c of cars) {
    const key = seedStoreKey(c);
    if (!key) continue;
    const name = (c.dealerName || "").trim();
    const state = (c.dealerState || "").trim().toUpperCase() || null;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ deskId: c.dealerId || `pick:${name.toLowerCase()}|${state ?? ""}`, dealerName: name, state });
    if (out.length >= QUOTE_SEED_MAX) break;
  }
  return out;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The browser's two stores as one: writes go to both (each in its own try/catch), reads take sessionStorage first and then
 * localStorage, and removal clears both. Either may be missing or throw; the seed then simply isn't there.
 */
export function durableSeedStore(win: { sessionStorage?: Storage; localStorage?: Storage }): StorageLike {
  const stores = (): Storage[] => {
    const out: Storage[] = [];
    for (const get of [() => win.sessionStorage, () => win.localStorage]) {
      try { const s = get(); if (s) out.push(s); } catch { /* blocked */ }
    }
    return out;
  };
  return {
    getItem: (k) => { for (const s of stores()) { try { const v = s.getItem(k); if (v != null) return v; } catch { /* blocked */ } } return null; },
    setItem: (k, v) => { for (const s of stores()) { try { s.setItem(k, v); } catch { /* blocked or full */ } } },
    removeItem: (k) => { for (const s of stores()) { try { s.removeItem(k); } catch { /* blocked */ } } },
  };
}

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/i;
const httpUrl = (u: unknown): string | null => {
  if (typeof u !== "string") return null;
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:" ? p.toString() : null; } catch { return null; }
};

/** Valid, de-duplicated (by VIN), capped list. A non-http(s) link is dropped; a bad VIN drops the entry. */
export function sanitizeQuoteSeed(raw: unknown): QuoteSeedVehicle[] {
  const out: QuoteSeedVehicle[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const o = (item && typeof item === "object" ? item : {}) as { vin?: unknown; vdpUrl?: unknown; condition?: unknown; dealerId?: unknown; dealerName?: unknown; dealerState?: unknown; trim?: unknown };
    const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 200) : null);
    const vin = typeof o.vin === "string" ? o.vin.trim().toUpperCase() : "";
    if (!VIN.test(vin) || out.some((v) => v.vin === vin)) continue;
    out.push({ vin, vdpUrl: httpUrl(o.vdpUrl), condition: o.condition === "new" || o.condition === "used" || o.condition === "cpo" ? o.condition : null, dealerId: str(o.dealerId), dealerName: str(o.dealerName), dealerState: str(o.dealerState), trim: str(o.trim) });
    if (out.length >= QUOTE_SEED_MAX) break;
  }
  return out;
}

export function writeQuoteSeed(store: StorageLike, vehicles: Array<{ vin: string; vdpUrl: string | null; condition?: QuoteSeedVehicle["condition"]; dealerId?: string | null; dealerName?: string | null; dealerState?: string | null; trim?: string | null }>, now: number = Date.now()): QuoteSeedVehicle[] {
  const seed = sanitizeQuoteSeed(vehicles);
  try { store.setItem(QUOTE_SEED_KEY, JSON.stringify({ at: now, vehicles: seed })); } catch { /* storage blocked: the button then opens a plain wizard */ }
  return seed;
}

/** Reads the seed and removes it, so a refresh never re-seeds. A seed past its TTL is dropped; a bare list (written before the timestamp) is still read. */
export function takeQuoteSeed(store: StorageLike, now: number = Date.now()): QuoteSeedVehicle[] {
  try {
    const raw = store.getItem(QUOTE_SEED_KEY);
    store.removeItem(QUOTE_SEED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return sanitizeQuoteSeed(parsed);
    const o = (parsed && typeof parsed === "object" ? parsed : {}) as { at?: unknown; vehicles?: unknown };
    if (typeof o.at !== "number" || now - o.at > QUOTE_SEED_TTL_MS || o.at - now > QUOTE_SEED_TTL_MS) return [];
    return sanitizeQuoteSeed(o.vehicles);
  } catch { return []; }
}
