/**
 * Used / CPO on the same blind quote-request pipe as new cars — without
 * pretending a used car is a factory build. Detection is from the pasted
 * link's own words (path, query, title) and the buyer's Step 1 toggle;
 * the dealer's page is never fetched.
 */
import type { VehicleCondition } from "./types";

export type UsedCondition = Extract<VehicleCondition, "used" | "cpo">;

/** Feature flag — leave on; flip via env if used cars need to be hidden in a hurry. */
export const USED_VEHICLES_ENABLED = process.env.NEXT_PUBLIC_USED_VEHICLES !== "off";

const CPO_RE = /\b(certified[\s-]*pre[\s-]*owned|certified|cpo)\b/i;
const USED_RE = /\b(used|pre[\s-]*owned|preowned)\b/i;

/**
 * "cpo" beats "used"; null when nothing in the text says either. Only the
 * URL's own path/query (or a page title the buyer pasted) is read — never
 * the dealer's HTML.
 */
export function detectUsedCondition(text: string | null | undefined): UsedCondition | null {
  const t = (text || "").toLowerCase();
  if (!t) return null;
  // Path words like /used/, /pre-owned/, ?condition=used, "Certified Pre-Owned".
  const probe = t.replace(/[_/?=&#.+-]+/g, " ");
  if (CPO_RE.test(probe)) return "cpo";
  if (USED_RE.test(probe)) return "used";
  return null;
}

export function isUsedCondition(c: VehicleCondition | null | undefined): c is UsedCondition {
  return c === "used" || c === "cpo";
}

export function conditionBadge(c: VehicleCondition | null | undefined): "USED" | "CPO" | null {
  return c === "cpo" ? "CPO" : c === "used" ? "USED" : null;
}

/** Buyer-facing line under a used car — no factory sticker is implied. */
export const USED_BUILD_COPY = "Used — details come from the VIN and the dealer confirms the rest. No factory sticker needed to continue.";
export const CPO_BUILD_COPY = "Certified pre-owned — details come from the VIN; the dealer confirms certification and the rest. No factory sticker needed to continue.";

/** 0–999,999 whole miles, or null when blank/junk. */
export function normalizeMiles(raw: string | number | null | undefined): number | null {
  const t = typeof raw === "number" ? String(raw) : (raw || "").replace(/[,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 999999) return null;
  return Math.round(n);
}
