/**
 * A vehicle the buyer chose to keep for later — typically one whose factory
 * build isn't published yet — parked in localStorage so the next open of
 * Configure Quote Request can offer it back. Distinct from the quote draft
 * (lib/quoteDraft.ts): that is an auth round-trip's whole wizard state and
 * is wiped on every dismiss; this survives a close, on purpose, because the
 * buyer asked. Holds only what a retry needs. Pure over a Storage-like.
 */
export const PARKED_VEHICLE_KEY = "trimscout.parkedVehicle.v1";
/** Stickers usually post within a few weeks of listing; a month covers it. */
export const PARKED_VEHICLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ParkedVehicle {
  version: 1;
  savedAt: number;
  vin: string;
  /** The listing link, when the paste was one — retrying through it keeps the rooftop. */
  url: string | null;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  dealerName: string | null;
  /** The buyer asked to be told when the build posts (no alerts are sent yet — this is the record of the ask). */
  notify: boolean;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(explicit?: StorageLike | null): StorageLike | null {
  if (explicit) return explicit;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function parkVehicle(input: Omit<ParkedVehicle, "version" | "savedAt">, store?: StorageLike | null): boolean {
  const s = storage(store);
  if (!s) return false;
  try {
    s.setItem(PARKED_VEHICLE_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), ...input } satisfies ParkedVehicle));
    return true;
  } catch {
    return false;
  }
}

export function readParkedVehicle(store?: StorageLike | null, now = Date.now()): ParkedVehicle | null {
  const s = storage(store);
  if (!s) return null;
  try {
    const raw = s.getItem(PARKED_VEHICLE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ParkedVehicle>;
    if (p.version !== 1 || typeof p.savedAt !== "number" || typeof p.vin !== "string" || !/^[A-HJ-NPR-Z0-9]{17}$/.test(p.vin) || now - p.savedAt > PARKED_VEHICLE_TTL_MS) {
      s.removeItem(PARKED_VEHICLE_KEY);
      return null;
    }
    return { ...p, make: p.make || "", model: p.model || "", url: p.url || null, year: p.year ?? null, trim: p.trim ?? null, dealerName: p.dealerName ?? null, notify: Boolean(p.notify) } as ParkedVehicle;
  } catch {
    try {
      s.removeItem(PARKED_VEHICLE_KEY);
    } catch {
      // nothing to clean
    }
    return null;
  }
}

export function clearParkedVehicle(store?: StorageLike | null): void {
  const s = storage(store);
  if (!s) return;
  try {
    s.removeItem(PARKED_VEHICLE_KEY);
  } catch {
    // nothing to clean
  }
}

/** "2026 Acura ADX · Key Acura of Atlantic City" */
export function parkedVehicleLabel(p: Pick<ParkedVehicle, "year" | "make" | "model" | "trim" | "dealerName">): string {
  const car = [p.year, p.make, p.model, p.trim].filter(Boolean).join(" ");
  return p.dealerName ? `${car} · ${p.dealerName}` : car;
}
