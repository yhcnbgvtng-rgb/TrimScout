"use client";

import React, { useState } from "react";
import type { RfqRequest } from "../lib/rfq";
import { unsubscribedDealers, unsubscribedBannerCopy } from "../lib/inviteState";
import type { RfqLane } from "../lib/alternateAsk";

/**
 * Buyer notice on the Deal Tracker and the RFQ page: a rooftop the buyer was
 * waiting on has unsubscribed from TrimScout, so no reply is coming there.
 * Neutral copy (lib/inviteState), a "Choose another vehicle" CTA that reopens
 * the Configure Quote Request wizard with the request's Step 1 intent, and a
 * per-session Dismiss. Renders nothing when no rooftop unsubscribed.
 */
export function UnsubscribedBanner({ rfq, onChooseAnother }: { rfq: Pick<RfqRequest, "id" | "invites" | "lane">; onChooseAnother?: (intent: RfqLane) => void }) {
  const dealers = unsubscribedDealers(rfq);
  const copy = unsubscribedBannerCopy(dealers);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return typeof sessionStorage !== "undefined" && sessionStorage.getItem(`unsub-dismissed-${rfq.id}`) === "1";
    } catch {
      return false;
    }
  });
  if (!copy || dismissed) return null;

  const intent = rfq.lane ?? "same_spec";
  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(`unsub-dismissed-${rfq.id}`, "1");
    } catch {
      // a dismissal we can't remember is not the buyer's problem
    }
  };
  const chooseHref = `/?repick=1&intent=${intent}`;

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-950/25 px-4 py-3 text-amber-100" data-testid="unsub-banner">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-bold text-amber-100">{copy.title}</p>
          <p className="text-[12px] leading-relaxed text-amber-200/90">{copy.body}</p>
        </div>
        <button type="button" onClick={dismiss} className="shrink-0 text-[11px] text-amber-300/70 hover:text-amber-200" data-testid="unsub-dismiss">
          Dismiss
        </button>
      </div>
      <div className="mt-2.5">
        {onChooseAnother ? (
          <button type="button" onClick={() => onChooseAnother(intent)} className="rounded-lg bg-amber-400 px-3 py-1.5 text-[12px] font-extrabold text-black hover:bg-amber-300" data-testid="unsub-choose-another">
            Choose another vehicle
          </button>
        ) : (
          <a href={chooseHref} className="inline-block rounded-lg bg-amber-400 px-3 py-1.5 text-[12px] font-extrabold text-black hover:bg-amber-300" data-testid="unsub-choose-another">
            Choose another vehicle
          </a>
        )}
      </div>
    </div>
  );
}
