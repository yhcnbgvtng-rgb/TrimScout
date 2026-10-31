/**
 * The /search VIN box: a full 17-character VIN (exact match) or the last 6-8 characters (suffix match).
 * Pure and client-safe — the same rules run in the input and again in the route.
 */

export type VinQuery = { ok: true; kind: "full" | "suffix"; vin: string } | { ok: false; error: string };

export const VIN_NO_MATCH = "No vehicle with this VIN in current inventory";
export const VIN_LENGTH_ERROR = "Enter a full 17-character VIN, or the last 6 to 8 characters.";
export const VIN_SUFFIX_MIN = 6;
export const VIN_SUFFIX_MAX = 8;

export function normalizeVinQuery(raw: string): VinQuery {
  const vin = String(raw ?? "").replace(/\s+/g, "").toUpperCase();
  if (!vin) return { ok: false, error: VIN_LENGTH_ERROR };
  const banned = [...new Set(vin.match(/[IOQ]/g) ?? [])];
  if (banned.length) return { ok: false, error: `A VIN never contains ${banned.join(", ")} — check for a 1 or 0 typed as a letter.` };
  if (!/^[A-Z0-9]+$/.test(vin)) return { ok: false, error: "A VIN has only letters and digits." };
  if (vin.length === 17) return { ok: true, kind: "full", vin };
  if (vin.length >= VIN_SUFFIX_MIN && vin.length <= VIN_SUFFIX_MAX) return { ok: true, kind: "suffix", vin };
  return { ok: false, error: VIN_LENGTH_ERROR };
}
