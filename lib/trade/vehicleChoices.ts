/** Dropdown choices for entering a trade-in by hand (when the VIN won't decode): common makes, and models from NHTSA vPIC. */

export const TRADE_MAKES = [
  "Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler", "Dodge", "Fiat", "Ford", "Genesis", "GMC", "Honda", "Hyundai",
  "Infiniti", "Jaguar", "Jeep", "Kia", "Land Rover", "Lexus", "Lincoln", "Mazda", "Mercedes-Benz", "Mercury", "MINI", "Mitsubishi", "Nissan",
  "Pontiac", "Porsche", "Ram", "Saturn", "Scion", "Subaru", "Tesla", "Toyota", "Volkswagen", "Volvo",
] as const;

/** Query values go into a vPIC URL path: letters, digits, space, dash and dot only. */
export const isSafeMake = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9][A-Za-z0-9 .\-]{0,39}$/.test(s);
export const isSafeYear = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1981 && (n as number) <= new Date().getFullYear() + 1;

/** vPIC's GetModelsForMakeYear body -> a sorted, de-duplicated list of model names. Anything unexpected -> []. */
export function parseVpicModels(json: unknown): string[] {
  const results = (json && typeof json === "object" ? (json as { Results?: unknown }).Results : null);
  if (!Array.isArray(results)) return [];
  const names = results.map((r) => (r && typeof r === "object" ? (r as { Model_Name?: unknown }).Model_Name : null))
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0 && n.length <= 60).map((n) => n.trim());
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

export async function fetchTradeModels(make: string, year: number, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 86400 } } as RequestInit);
  if (!res.ok) throw new Error(`vPIC ${res.status}`);
  return parseVpicModels(await res.json());
}
