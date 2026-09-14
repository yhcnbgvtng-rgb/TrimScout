/**
 * The order the must-have picker shows a factory build in: exterior color
 * first, interior color second, then every other option by price — highest
 * first — and alphabetically within a price. Client-safe (no Node imports;
 * the color labels are duplicated from lib/fordSticker.ts, which pulls in fs).
 */
export const EXTERIOR_COLOR_PREFIX = "Exterior color:";
export const INTERIOR_COLOR_PREFIX = "Interior color:";

export interface OrderableFactoryOption {
  name: string;
  price?: number | null;
}

function rank(o: OrderableFactoryOption): number {
  if (o.name.startsWith(EXTERIOR_COLOR_PREFIX)) return 0;
  if (o.name.startsWith(INTERIOR_COLOR_PREFIX)) return 1;
  return 2;
}

export function orderFactoryOptions<T extends OrderableFactoryOption>(options: readonly T[]): T[] {
  return [...options].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (rank(a) < 2) return 0; // colors keep their own order (exterior, interior)
    const pa = typeof a.price === "number" && Number.isFinite(a.price) ? a.price : 0;
    const pb = typeof b.price === "number" && Number.isFinite(b.price) ? b.price : 0;
    if (pb !== pa) return pb - pa;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
