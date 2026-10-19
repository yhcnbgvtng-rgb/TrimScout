// Paid-only factory options display (flag OPTIONS_PAID_ONLY, default OFF). Client-safe: no node imports.
//
// ON:  a car's options list shows only rows with a price above 0, one row at a time (never per label), each with its price
//      as "+$1,225"; a package row shows the package's own price. $0 rows go under "Standard features". A car with no paid
//      row says "No paid factory options listed".
// OFF: nothing changes. Every caller keeps its existing list.
//
// next.config.js inlines OPTIONS_PAID_ONLY into the client bundle, so changing it needs a redeploy.

export const OPTIONS_PAID_ONLY_ENV = "OPTIONS_PAID_ONLY";
export const NO_PAID_FACTORY_OPTIONS = "No paid factory options listed";
export const STANDARD_FEATURES_HEADING = "Standard features";

const ON = /^(1|true|yes|on)$/i;

/** Off unless explicitly turned on. `source` is for tests; the app reads process.env. */
export function optionsPaidOnlyEnabled(source: Record<string, string | undefined> = process.env): boolean {
  const raw = source[OPTIONS_PAID_ONLY_ENV];
  return raw != null && ON.test(raw.trim());
}

/** "+$1,225". Whole dollars with no decimals; a fractional price keeps its cents ("+$1,225.50"). */
export function formatOptionPrice(price: number): string {
  const fixed = Number.isInteger(price) ? String(price) : price.toFixed(2);
  const [whole, cents] = fixed.split(".");
  return `+$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${cents ? `.${cents}` : ""}`;
}

interface PricedOption {
  name: string;
  price?: number | null;
  /** "dealer" rows are dealer add-ons, never factory options. Absent means factory. */
  kind?: string | null;
}

export interface PaidOptionView<T extends PricedOption> {
  /** price > 0, in the order given, with the price text ready to show. */
  paid: Array<T & { priceLabel: string }>;
  /** Factory rows priced 0 or unknown: shown under "Standard features". */
  standard: T[];
  /** True when there is nothing paid to list: show NO_PAID_FACTORY_OPTIONS. */
  noPaid: boolean;
}

/**
 * Splits one car's option rows. The test is per row: a label that is $0 on one row and paid on another stays paid on
 * the paid row. Dealer-kind rows are dropped. Repeats of the same name and price collapse to one.
 */
export function paidOptionView<T extends PricedOption>(options: readonly T[] | null | undefined): PaidOptionView<T> {
  const paid: Array<T & { priceLabel: string }> = [];
  const standard: T[] = [];
  const seenPaid = new Set<string>();
  const seenStandard = new Set<string>();
  for (const o of options ?? []) {
    if (o.kind != null && o.kind !== "" && o.kind !== "factory") continue;
    const name = String(o.name ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const price = typeof o.price === "number" && Number.isFinite(o.price) ? o.price : 0;
    const key = name.toLowerCase();
    if (price > 0) {
      const id = `${key}|${price}`;
      if (seenPaid.has(id)) continue;
      seenPaid.add(id);
      paid.push({ ...o, name, priceLabel: formatOptionPrice(price) });
    } else {
      if (seenStandard.has(key)) continue;
      seenStandard.add(key);
      standard.push({ ...o, name });
    }
  }
  return { paid, standard, noPaid: paid.length === 0 };
}

/** The wizard's must-have picker: with the flag on, only rows priced above 0. With it off, the list as given. */
export function filterMustHaveOptions<T extends PricedOption>(options: readonly T[], paidOnly: boolean): T[] {
  return paidOnly ? options.filter((o) => typeof o.price === "number" && o.price > 0 && (o.kind == null || o.kind === "" || o.kind === "factory")) : [...options];
}
