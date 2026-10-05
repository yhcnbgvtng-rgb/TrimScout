/**
 * Buyer search: the vehicles a buyer ticked (up to 3, the vehicles for step 1 of a quote) and the results they
 * have already opened ("viewed"). Pure — storage and the network live in components/search/useBuyerSearchState.ts.
 * Nothing here opens a quote, sends email, or creates a dealer invite.
 */
export const MAX_PICKS = 3;
export const MAX_VIEWED = 2000;

/** Identity of one listing: the same VIN at two stores is two rows, so the store is part of the key. */
export function vehicleKey(v: { vin: string; dealerId?: string | null; dealerName: string }): string {
  return `${v.vin}|${v.dealerId ?? v.dealerName}`;
}

/** What is kept about a ticked vehicle — enough to list it in the bottom bar when it is not in the current results. */
export interface PickedVehicle {
  key: string;
  vin: string;
  dealerId: string | null;
  dealerName: string;
  dealerState: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  mileage: number | null;
  price: number | null;
  vdpUrl: string | null;
}

export interface BuyerSearchState {
  picks: PickedVehicle[];
  viewed: string[];
}

export const EMPTY_STATE: BuyerSearchState = { picks: [], viewed: [] };

export function toPick(v: { vin: string; dealerId?: string | null; dealerName: string; dealerState: string | null; year: number | null; make: string | null; model: string | null; trim: string | null; mileage: number | null; price: number | null; vdpUrl: string | null }): PickedVehicle {
  return { key: vehicleKey(v), vin: v.vin, dealerId: v.dealerId ?? null, dealerName: v.dealerName, dealerState: v.dealerState, year: v.year, make: v.make, model: v.model, trim: v.trim, mileage: v.mileage, price: v.price, vdpUrl: v.vdpUrl };
}

export type ToggleResult = { picks: PickedVehicle[]; outcome: "added" | "removed" | "blocked" };

/** Tick/untick. A fourth tick changes nothing and reports "blocked" so the page can say the limit is 3. */
export function togglePick(picks: PickedVehicle[], v: PickedVehicle): ToggleResult {
  if (picks.some((p) => p.key === v.key)) return { picks: picks.filter((p) => p.key !== v.key), outcome: "removed" };
  if (picks.length >= MAX_PICKS) return { picks, outcome: "blocked" };
  return { picks: [...picks, v], outcome: "added" };
}

/** Add to the viewed list (most recent last), keeping each key once and only the newest MAX_VIEWED. */
export function markViewed(viewed: string[], key: string): string[] {
  if (viewed[viewed.length - 1] === key) return viewed;
  const next = [...viewed.filter((k) => k !== key), key];
  return next.length > MAX_VIEWED ? next.slice(next.length - MAX_VIEWED) : next;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v.slice(0, 300) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Untrusted JSON (storage, network) -> a valid state. Bad entries are dropped; picks are capped at MAX_PICKS. */
export function sanitizeState(raw: unknown): BuyerSearchState {
  const o = (raw && typeof raw === "object" ? raw : {}) as { picks?: unknown; viewed?: unknown };
  const picks: PickedVehicle[] = [];
  for (const p of Array.isArray(o.picks) ? o.picks : []) {
    const r = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const vin = str(r.vin), dealerName = str(r.dealerName);
    if (!vin || !dealerName) continue;
    const pick: PickedVehicle = { key: "", vin, dealerId: str(r.dealerId), dealerName, dealerState: str(r.dealerState), year: num(r.year), make: str(r.make), model: str(r.model), trim: str(r.trim), mileage: num(r.mileage), price: num(r.price), vdpUrl: str(r.vdpUrl) };
    pick.key = vehicleKey(pick);
    if (!picks.some((x) => x.key === pick.key)) picks.push(pick);
    if (picks.length >= MAX_PICKS) break;
  }
  const viewed = Array.from(new Set((Array.isArray(o.viewed) ? o.viewed : []).filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 300)));
  return { picks, viewed: viewed.length > MAX_VIEWED ? viewed.slice(viewed.length - MAX_VIEWED) : viewed };
}

export function parseStored(json: string | null): BuyerSearchState {
  if (!json) return { picks: [], viewed: [] };
  try { return sanitizeState(JSON.parse(json)); } catch { return { picks: [], viewed: [] }; }
}
