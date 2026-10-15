/**
 * Dealer overrides of the fees TrimScout calculates.
 *
 * TrimScout calculates one line on a Cash / Finance sheet: sales tax (the buyer's ZIP-state rate on selling price +
 * add-ons, the same figure the counter sheet uses). The dealer may replace it with their own amount, with a required
 * short reason ("county rate 6.875%"). The doc fee and title & registration are never calculated or overridden — they are
 * the dealer's own numbers, entered as plain required lines.
 *
 * Both values are stored: the quote's due-at-signing line carries the dealer's amount (so every total — out the door,
 * amount financed, cash due — recomputes from the lines with no special case), and `feeOverrides` on the stored quote
 * keeps what TrimScout calculated, what the dealer entered, and why. The server recomputes `calculated` itself; the
 * browser's copy is never trusted.
 *
 * Pure and client-safe: the dealer form, the used-quote route and the buyer's compare share these.
 */
import { isDocFee, isTaxLine, zipStateTax } from "./counterSheet";
import type { LineItem } from "./leaseQuote";
import { sumItems } from "./leaseMath";

export type OverridableFee = "sales_tax";

export interface FeeOverride {
  key: OverridableFee;
  /** The due-at-signing line this replaces, as named on the sheet. */
  label: string;
  /** What TrimScout calculated (server-computed). */
  calculated: number;
  /** What the dealer entered — the amount on the sheet. */
  amount: number;
  reason: string;
  at: string;
}

export const OVERRIDE_REASON_MIN = 3;
export const OVERRIDE_REASON_MAX = 140;
export const OVERRIDE_LABELS: Record<OverridableFee, string> = { sales_tax: "Sales tax" };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Which overridable fee a due-at-signing line is, or null. The doc fee — and every other fee — is never overridable. */
export function overridableKey(name: string): OverridableFee | null {
  if (isDocFee(name)) return null;
  if (isTaxLine(name)) return "sales_tax";
  return null;
}
export const canOverrideFee = (name: string) => overridableKey(name) !== null;

/** TrimScout's sales tax: the buyer's ZIP-state rate on price + add-ons; null with no usable ZIP (nothing calculated, nothing to override). */
export function calcSalesTax(zip: string | null | undefined, sellingPrice: number | null | undefined, addOns: LineItem[] | null | undefined): number | null {
  const t = zipStateTax(zip);
  if (!t || !(typeof sellingPrice === "number" && sellingPrice > 0)) return null;
  return r2(Math.max(0, t.rate * (sellingPrice + sumItems(addOns || []))));
}
export function calcFee(_key: OverridableFee, input: { zip: string | null | undefined; sellingPrice: number | null | undefined; addOns?: LineItem[] | null }): number | null {
  return calcSalesTax(input.zip, input.sellingPrice, input.addOns);
}

/** The first due-at-signing line for a fee. */
export function lineFor(lines: LineItem[] | null | undefined, key: OverridableFee): LineItem | null {
  return (lines || []).find((l) => overridableKey(String(l?.name ?? "")) === key) ?? null;
}

export const overrideDifference = (o: Pick<FeeOverride, "calculated" | "amount">) => r2(o.amount - o.calculated);

/**
 * Validates and rebuilds the overrides for a submitted sheet. A line whose amount differs from TrimScout's calculation
 * must carry an override with a reason; an override on any other line (the doc fee included), on a line that matches the
 * calculation, or without a reason is refused. `calculated` always comes from here, never from `submitted`.
 */
export function normalizeFeeOverrides(input: {
  dueAtSigning: LineItem[] | null | undefined;
  sellingPrice: number | null | undefined;
  addOns?: LineItem[] | null;
  zip: string | null | undefined;
  submitted: unknown;
  now?: Date;
}): { overrides: FeeOverride[]; errors: string[] } {
  const errors: string[] = [];
  const now = (input.now ?? new Date()).toISOString();
  const sent = Array.isArray(input.submitted) ? (input.submitted as Array<Record<string, unknown>>) : [];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const s of sent) {
    const key = String(s?.key ?? "");
    if (key !== "sales_tax") {
      errors.push(`${String(s?.label || key || "That line")} can't be overridden — only sales tax can; the doc fee and title & registration are entered as they are.`);
      continue;
    }
    byKey.set(key, s);
  }
  const overrides: FeeOverride[] = [];
  for (const key of ["sales_tax"] as const) {
    const line = lineFor(input.dueAtSigning, key);
    const calculated = calcFee(key, input);
    const s = byKey.get(key);
    if (!line || calculated == null) {
      if (s) errors.push(`${OVERRIDE_LABELS[key]}: there is no TrimScout calculation on this sheet to override.`);
      continue;
    }
    const differs = Math.abs(line.amount - calculated) >= 0.005;
    if (!differs) {
      if (s) errors.push(`${OVERRIDE_LABELS[key]} matches TrimScout's amount, so there is nothing to override.`);
      continue;
    }
    const reason = typeof s?.reason === "string" ? s.reason.trim().replace(/\s+/g, " ") : "";
    if (reason.length < OVERRIDE_REASON_MIN) {
      errors.push(`${OVERRIDE_LABELS[key]}: you entered ${fmt(line.amount)} instead of TrimScout's ${fmt(calculated)} — add a short reason.`);
      continue;
    }
    if (reason.length > OVERRIDE_REASON_MAX) {
      errors.push(`${OVERRIDE_LABELS[key]}: keep the reason under ${OVERRIDE_REASON_MAX} characters.`);
      continue;
    }
    // The sheet's own amount wins; a browser that sent a different `amount` is simply ignored.
    const prior = typeof s?.at === "string" && !Number.isNaN(new Date(s.at).getTime()) && Number(s?.amount) === line.amount ? (s.at as string) : now;
    overrides.push({ key, label: line.name.trim(), calculated, amount: r2(line.amount), reason, at: prior });
  }
  return { overrides, errors };
}

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Overrides on a stored quote that still describe its lines (stale ones — a line changed since — are ignored). */
export function activeOverrides(quote: { feeOverrides?: FeeOverride[] | null; dueAtSigning?: LineItem[] | null } | null | undefined): FeeOverride[] {
  if (!quote?.feeOverrides?.length) return [];
  return quote.feeOverrides.filter((o) => {
    const line = lineFor(quote.dueAtSigning, o.key);
    return line != null && Math.abs(line.amount - o.amount) < 0.005;
  });
}

/** Net effect of the overrides on the buyer's total (dealer amount − TrimScout amount, summed). */
export const overrideTotalDelta = (overrides: FeeOverride[]) => r2(overrides.reduce((t, o) => t + overrideDifference(o), 0));

/** "Sales tax: TrimScout $2,650 → dealer $2,750 (+$100) — county rate 6.875%". */
export function overrideSummary(o: FeeOverride): string {
  const d = overrideDifference(o);
  return `${o.label}: TrimScout ${fmt(o.calculated)} → dealer ${fmt(o.amount)} (${d < 0 ? "−" : "+"}${fmt(Math.abs(d))}) — ${o.reason}`;
}

/** Reconciles overrides on a quote rebuilt from somewhere else (the accepted counter): only those whose line amount still matches survive. */
export function keepMatchingOverrides(quote: { feeOverrides?: FeeOverride[] | null; dueAtSigning: LineItem[] }): FeeOverride[] {
  return activeOverrides(quote);
}
