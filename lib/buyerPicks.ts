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
  /** new / used / cpo as the listing says; null when unknown (older saved picks). Step 1 needs it to seat each car. */
  condition: PickCondition | null;
  /** When this pick was SAVED (ms since epoch); null while it is only ticked in this session. Saved picks expire PICK_TTL_MS later. */
  savedAt: number | null;
}

export type PickCondition = "new" | "used" | "cpo";

export interface BuyerSearchState {
  picks: PickedVehicle[];
  viewed: string[];
  /**
   * Kept in the browser only (never sent to the box): when the buyer last changed their SAVED picks here (save, ×, clear).
   * If a clear/remove could not reach the account store, this lets the next load see that the local change is newer than the
   * account's copy and push it again instead of letting the old picks come back.
   */
  picksEditedAt?: number | null;
}

export const EMPTY_STATE: BuyerSearchState = { picks: [], viewed: [] };

export function toPick(v: { vin: string; dealerId?: string | null; dealerName: string; dealerState: string | null; year: number | null; make: string | null; model: string | null; trim: string | null; mileage: number | null; price: number | null; vdpUrl: string | null; condition?: PickCondition | null }): PickedVehicle {
  return { key: vehicleKey(v), vin: v.vin, dealerId: v.dealerId ?? null, dealerName: v.dealerName, dealerState: v.dealerState, year: v.year, make: v.make, model: v.model, trim: v.trim, mileage: v.mileage, price: v.price, vdpUrl: v.vdpUrl, condition: v.condition ?? null, savedAt: null };
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
// A listing link is kept whole (a cut-off URL is a broken link); anything absurdly long is dropped instead.
const link = (v: unknown): string | null => (typeof v === "string" && v && v.length <= 2000 ? v : null);
const cond = (v: unknown): PickCondition | null => (v === "new" || v === "used" || v === "cpo" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const time = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null);

/** Untrusted JSON (storage, network) -> a valid state. Bad entries are dropped; picks are capped at MAX_PICKS. */
export function sanitizeState(raw: unknown): BuyerSearchState {
  const o = (raw && typeof raw === "object" ? raw : {}) as { picks?: unknown; viewed?: unknown; picksEditedAt?: unknown };
  const picks: PickedVehicle[] = [];
  for (const p of Array.isArray(o.picks) ? o.picks : []) {
    const r = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const vin = str(r.vin), dealerName = str(r.dealerName);
    if (!vin || !dealerName) continue;
    const pick: PickedVehicle = { key: "", vin, dealerId: str(r.dealerId), dealerName, dealerState: str(r.dealerState), year: num(r.year), make: str(r.make), model: str(r.model), trim: str(r.trim), mileage: num(r.mileage), price: num(r.price), vdpUrl: link(r.vdpUrl), condition: cond(r.condition), savedAt: time(r.savedAt) };
    pick.key = vehicleKey(pick);
    if (!picks.some((x) => x.key === pick.key)) picks.push(pick);
    if (picks.length >= MAX_PICKS) break;
  }
  const viewed = Array.from(new Set((Array.isArray(o.viewed) ? o.viewed : []).filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 300)));
  const state: BuyerSearchState = { picks, viewed: viewed.length > MAX_VIEWED ? viewed.slice(viewed.length - MAX_VIEWED) : viewed };
  const editedAt = time(o.picksEditedAt);
  if (editedAt !== null) state.picksEditedAt = editedAt;
  return state;
}

export function parseStored(json: string | null): BuyerSearchState {
  if (!json) return { picks: [], viewed: [] };
  try { return sanitizeState(JSON.parse(json)); } catch { return { picks: [], viewed: [] }; }
}

// ---- saved picks: expiry, unsaving, and dropping cars that are no longer listed -------------------------------------------

/** A saved pick lives 7 days from the moment it was saved. */
export const PICK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Stamp the picks being saved. A pick that is already saved keeps its ORIGINAL time: saving again does not extend it. */
export function stampSaved(picks: PickedVehicle[], now: number): PickedVehicle[] {
  return picks.map((p) => (p.savedAt ? p : { ...p, savedAt: now }));
}

/** Split saved picks into those still valid and those past 7 days. A pick with no time (ticked, or saved before expiry existed) is not expired here. */
export function dropExpired(picks: PickedVehicle[], now: number): { live: PickedVehicle[]; expired: PickedVehicle[] } {
  const live: PickedVehicle[] = [], expired: PickedVehicle[] = [];
  for (const p of picks) (p.savedAt && now - p.savedAt > PICK_TTL_MS ? expired : live).push(p);
  return { live, expired };
}

export function removeKey(picks: PickedVehicle[], key: string): PickedVehicle[] {
  return picks.filter((p) => p.key !== key);
}

/** Whether a saved pick's car is still for sale. "unknown" (the check could not be made) keeps the pick: never drop on doubt. */
export type PickListing = "listed" | "gone" | "unknown";

export function dropGone(picks: PickedVehicle[], listing: Record<string, PickListing>): { live: PickedVehicle[]; gone: PickedVehicle[] } {
  const live: PickedVehicle[] = [], gone: PickedVehicle[] = [];
  for (const p of picks) (listing[p.key] === "gone" ? gone : live).push(p);
  return { live, gone };
}

/** One short line for the bar after picks were dropped on load; null when nothing was. */
export function pickNotice({ gone, expired }: { gone: number; expired: number }): string | null {
  const n = (c: number) => `${c} pick${c === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (gone > 0) parts.push(`${n(gone)} removed — no longer listed`);
  if (expired > 0) parts.push(`${n(expired)} removed — saved over 7 days ago`);
  return parts.length ? parts.join(" · ") : null;
}

/** Decide, from every listing of a VIN, whether this pick's car is still listed at its store. */
export function listingFor(pick: { vin: string; dealerId: string | null; dealerName: string }, listings: Array<{ dealerId: string | null; dealerName: string; removedAt: string | null }>): PickListing {
  if (listings.length === 0) return "unknown"; // the box has no record: say nothing rather than drop a car it never indexed
  const norm = (s: string) => s.trim().toLowerCase();
  const here = listings.filter((l) => (pick.dealerId && l.dealerId ? String(l.dealerId) === String(pick.dealerId) : norm(l.dealerName) === norm(pick.dealerName)));
  if (here.length === 0) return "gone"; // the VIN is known but not at this store any more
  return here.some((l) => l.removedAt == null) ? "listed" : "gone";
}
