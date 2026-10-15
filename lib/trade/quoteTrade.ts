/**
 * "Every invited dealer quotes the trade WITH the car", enforced on the server. Every route that records a vehicle quote calls
 * this first: on a request with a trade-in the body must carry an allowance (or "can't quote this trade"), or the desk must
 * already hold a live one. The box refuses the quote again if this is ever skipped (2026-10-16-rfq-trade-confirm.sh).
 */
import { submitTradeAppraisal } from "../rfqApi";
import type { RfqInvite, RfqRequest } from "../rfq";
import { resolveTradeForQuote } from "./dealer";
import { guideValue, isOutlier } from "./guide";
import { allowanceOf } from "./otd";

export type RecordTradeResult = { ok: true } | { ok: false; status: number; body: Record<string, unknown> };

export async function recordTradeWithQuote(i: {
  rfq: Pick<RfqRequest, "id" | "tradeIn">;
  invite: Pick<RfqInvite, "id" | "tradeAppraisal">;
  body: { trade?: unknown } | null | undefined;
  quoteExpiresAt: string | null;
  now?: Date;
}): Promise<RecordTradeResult> {
  const r = resolveTradeForQuote(i.rfq, i.invite, i.body, i.quoteExpiresAt, i.now);
  if (!r.ok) return { ok: false, status: r.status, body: { error: r.errors.join(" "), errors: r.errors, code: "trade_allowance_required" } };
  if (!("appraisal" in r)) return { ok: true };
  if (r.kind === "appraisal" && i.rfq.tradeIn) {
    // Optional value-guide sanity check: only when a guide is configured; never a silent paid call.
    const guide = await guideValue({ vin: i.rfq.tradeIn.vin, mileage: i.rfq.tradeIn.mileage, zip: i.rfq.tradeIn.zip });
    const mid = allowanceOf(r.appraisal)?.mid ?? 0;
    const confirmed = (i.body?.trade as { confirmOutlier?: unknown } | undefined)?.confirmOutlier === true;
    if (isOutlier(mid, guide) && !confirmed) {
      return { ok: false, status: 409, body: { error: `That's more than 50% away from the value guide ($${Math.round(guide as number).toLocaleString()}). Confirm it's right to continue.`, needsConfirmation: true, guideValue: guide } };
    }
  }
  await submitTradeAppraisal(i.rfq.id, i.invite.id, r.appraisal);
  return { ok: true };
}
