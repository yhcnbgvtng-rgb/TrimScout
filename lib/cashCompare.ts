/**
 * Pure maths for the buyer's cash-quote compare table (components/UsedCompare.tsx):
 * % off MSRP, fees, out the door excluding add-ons, the gap to the best quote, and which dealer earns which badge.
 * Only the quotes the caller passes in are compared — the caller hands over ranked vehicles, never alternates.
 */
import { dueAtSigningSum, provenRebateTotal, type UsedCashQuote } from "./usedQuote";

const TAX_RE = /tax/i;
const r2 = (n: number) => Math.round(n * 100) / 100;

export type CashFigures = Pick<UsedCashQuote, "sellingPrice" | "dueAtSigning"> & Partial<Pick<UsedCashQuote, "addOns" | "surcharges" | "rebates" | "msrp" | "expiresAt">>;

export type MsrpDiscount =
  | { status: "none" }
  | { status: "off" | "above" | "at"; msrp: number; dollars: number; pct: number; ratio: number };

/** (MSRP − selling price) / MSRP — selling price only: no surcharges, fees, taxes or add-ons. No usable MSRP (older quotes) → "none". */
export function msrpDiscount(q: Pick<CashFigures, "sellingPrice" | "msrp">): MsrpDiscount {
  const msrp = q.msrp;
  if (typeof msrp !== "number" || !Number.isFinite(msrp) || msrp <= 0) return { status: "none" };
  const price = q.sellingPrice;
  const dollars = r2(msrp - price);
  const ratio = (msrp - price) / msrp;
  const pct = Math.round(Math.abs(ratio) * 1000) / 10;
  return { status: dollars > 0 ? "off" : dollars < 0 ? "above" : "at", msrp, dollars: Math.abs(dollars), pct, ratio };
}

/** Named fees only: everything due at signing that is not sales tax (doc fee, title & registration, …). Add-ons and surcharges are not fees — the lowest-fees badge never counts them. */
export function feesTotal(q: Pick<CashFigures, "dueAtSigning">): number {
  return r2(dueAtSigningSum(q.dueAtSigning.filter((l) => !TAX_RE.test(l.name))));
}

/** Out the door with the dealer add-ons taken out: selling price + fees + tax − proven rebates. Surcharges stay out too — they sit in "Out the door" only. */
export function otdExcludingAddOns(q: CashFigures): number {
  return r2(q.sellingPrice + dueAtSigningSum(q.dueAtSigning) - provenRebateTotal(q.rebates));
}

const expiryMs = (q: Pick<CashFigures, "expiresAt">): number => (q.expiresAt ? new Date(q.expiresAt).getTime() || Infinity : Infinity); // no end date = never ends

/**
 * Order for quotes with the same out-the-door: fewer dealer add-ons first, then the quote whose expiry comes later ahead —
 * the one that expires earlier goes last. Anything still tied keeps the caller's order. Never looks at % off MSRP.
 */
export function tieBreakCash(a: CashFigures, b: CashFigures): number {
  const ac = (a.addOns || []).length, bc = (b.addOns || []).length;
  if (ac !== bc) return ac - bc;
  const ea = expiryMs(a), eb = expiryMs(b);
  return ea === eb ? 0 : ea > eb ? -1 : 1;
}

export interface CashCompareInput {
  id: string;
  /** The figure the table ranks on (out the door, after trade when there is one). */
  otd: number;
  quote: CashFigures;
}

export interface CashCompareResult {
  /** Dollar gap to the lowest out the door among the compared quotes, per id (0 for the best). */
  gapToBest: Record<string, number>;
  /** At most one id: the lowest out the door, ties settled by tieBreakCash. Empty unless the quotes differ. */
  lowestOtd: string[];
  biggestDiscount: string[];
  lowestFees: string[];
}

const lowestIds = <T extends { id: string }>(items: T[], value: (t: T) => number): string[] => {
  if (!items.length) return [];
  const min = Math.min(...items.map(value));
  return items.filter((t) => Math.abs(value(t) - min) < 0.005).map((t) => t.id);
};

/**
 * Best-value picks across the quotes compared. Ties share the badge. A badge needs a real comparison: two or more quotes
 * and a winner that actually differs from the rest. Quotes without an MSRP are ranked on out the door and fees but sit
 * out the % off comparison. "Biggest discount" is never awarded to a quote at or above MSRP.
 */
export function compareCashQuotes(items: CashCompareInput[]): CashCompareResult {
  const gapToBest: Record<string, number> = {};
  if (!items.length) return { gapToBest, lowestOtd: [], biggestDiscount: [], lowestFees: [] };
  const minOtd = Math.min(...items.map((i) => i.otd));
  for (const i of items) gapToBest[i.id] = r2(i.otd - minOtd);

  const distinct = (ids: string[], values: number[]) => items.length > 1 && values.some((v) => Math.abs(v - values[0]) >= 0.005) ? ids : [];
  const tiedLowest = items.filter((i) => Math.abs(i.otd - minOtd) < 0.005).sort((a, b) => tieBreakCash(a.quote, b.quote));
  const lowestOtd = distinct(tiedLowest.slice(0, 1).map((i) => i.id), items.map((i) => i.otd));
  const lowestFees = distinct(lowestIds(items, (i) => feesTotal(i.quote)), items.map((i) => feesTotal(i.quote)));

  const withMsrp = items.map((i) => ({ id: i.id, d: msrpDiscount(i.quote) })).filter((x): x is { id: string; d: Exclude<MsrpDiscount, { status: "none" }> } => x.d.status !== "none");
  let biggestDiscount: string[] = [];
  if (withMsrp.length > 1) {
    const best = Math.max(...withMsrp.map((x) => x.d.ratio));
    const tied = withMsrp.filter((x) => Math.abs(x.d.ratio - best) < 1e-9).map((x) => x.id);
    if (best > 0 && withMsrp.some((x) => Math.abs(x.d.ratio - best) >= 1e-9)) biggestDiscount = tied;
  }
  return { gapToBest, lowestOtd, biggestDiscount, lowestFees };
}

export interface GenericQuoteRow {
  id: string;
  /** The dealer's stated total out the door. */
  otd: number;
  /** Same VIN / locked spec as the buyer asked for. Anything else is an alternate and is never ranked with these. */
  exact: boolean;
  addOns?: number;
  expiresAt?: string | null;
}

/**
 * Order for the plain quote cards (no cash/finance/lease sheet): exact-build quotes by lowest out the door (ties: fewer add-ons,
 * then the later expiry), then the others by their own out the door. Only a quote that beats at least one other exact-build quote
 * is "lowest" — a lone exact build is not a comparison.
 */
export function rankGenericQuotes(rows: GenericQuoteRow[]): { order: string[]; lowestId: string | null } {
  const tie = (a: GenericQuoteRow, b: GenericQuoteRow) => tieBreakCash({ sellingPrice: 0, dueAtSigning: [], addOns: new Array(a.addOns || 0).fill({ name: "", amount: 0 }), expiresAt: a.expiresAt ?? "" }, { sellingPrice: 0, dueAtSigning: [], addOns: new Array(b.addOns || 0).fill({ name: "", amount: 0 }), expiresAt: b.expiresAt ?? "" });
  const by = (a: GenericQuoteRow, b: GenericQuoteRow) => a.otd - b.otd || tie(a, b);
  const exact = rows.filter((r) => r.exact).sort(by);
  const rest = rows.filter((r) => !r.exact).sort(by);
  const lowest = exact.length > 1 && exact[1].otd - exact[0].otd >= 0.005 ? exact[0].id : null;
  return { order: [...exact, ...rest].map((r) => r.id), lowestId: lowest };
}
