/**
 * State defaults the dealer's lease form prefills. Both tables are intentionally
 * EMPTY until a state's rule is verified against its revenue department — a wrong
 * prefill would put a wrong tax method on a quote, so the form leaves the field
 * blank (tax method) or falls back to the generic rule (fee taxability) instead.
 * Add a row only with a source (see dealer-sales-tax-research-2026-10-15.md).
 */
import type { LeaseTaxMethod } from "./leaseQuote";

/** State (2-letter) → how that state collects sales tax on a lease. */
export const STATE_LEASE_TAX_METHOD: Partial<Record<string, LeaseTaxMethod>> = {};

/** State → per-fee-kind taxability overrides. Keys: "doc", "title", "registration". */
export const STATE_FEE_TAXABLE: Partial<Record<string, Partial<Record<"doc" | "title" | "registration", boolean>>>> = {};

export const leaseTaxMethodDefault = (state: string | null | undefined): LeaseTaxMethod | "" => (state && STATE_LEASE_TAX_METHOD[state.toUpperCase()]) || "";

/** Taxable default for a fee row: the state table when it has the row, else doc fee = taxable and every other line = not (the dealer edits it). */
export function feeTaxableDefault(state: string | null | undefined, kind: "doc" | "title" | "registration" | "other"): boolean {
  const fromState = state && kind !== "other" ? STATE_FEE_TAXABLE[state.toUpperCase()]?.[kind] : undefined;
  return typeof fromState === "boolean" ? fromState : kind === "doc";
}
