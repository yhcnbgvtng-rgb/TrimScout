"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { coerceTradeIn } from "../../lib/trade/coerce";
import type { TradeConfirmation } from "../../lib/trade/confirm";
import { checkTradeForm, emptyTradeForm, tradeFormFrom, tradeFormReady, type TradeFormCheck, type TradeFormState } from "../../lib/trade/dealerForm";
import type { DealerTradeAppraisal, TradeInRecord, TradePhotoRequest } from "../../lib/trade/types";
import type { SignedView } from "./TradeSummary";
import { TradeAllowanceFields } from "./TradeAllowanceFields";

export interface DealerTradeFeed {
  tradeIn: TradeInRecord | null; signed: SignedView[]; appraisal: DealerTradeAppraisal | null; photoRequest: TradePhotoRequest | null;
  inviteStatus: string; rfqStatus: string; appraisalOpen?: boolean;
  confirmation?: TradeConfirmation | null; confirmationStatus?: string | null; quoteExpiresAt?: string | null; thresholdPct?: number;
}

/** The dealer's view of the request's trade (summary, photos, this desk's appraisal and confirm step), loaded once behind the invite token. */
export function useDealerTradeFeed(token: string, enabled: boolean) {
  const [data, setData] = useState<DealerTradeFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    if (!enabled || !token) return Promise.resolve();
    return fetch(`/api/quote-invite/trade?t=${encodeURIComponent(token)}`).then((r) => r.json()).then((j) => (j.error ? setError(j.error) : setData(j))).catch(() => setError("Couldn't load the trade-in."));
  }, [token, enabled]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload };
}

/** What a vehicle-quote form needs to carry the trade allowance with it. */
export interface TradeQuoteForm {
  /** The request has a trade: the quote can't be sent without an allowance (or "can't quote this trade"). */
  hasTrade: boolean;
  /** The allowance section is complete enough to send. */
  ready: boolean;
  /** The section to render above the submit button. */
  slot: React.ReactNode;
  /** Run the server's own check on the form; `quoteExpiresAt` is the default good-until. */
  check: (quoteExpiresAt: string | null) => TradeFormCheck;
  /** Hand the server's rejection back: returns true if it was about the trade (so the form can show it there). */
  onReject: (json: { needsConfirmation?: boolean; code?: string }) => boolean;
}

export function useTradeQuoteForm(feed: { data: DealerTradeFeed | null }, expected: boolean): TradeQuoteForm {
  const trade = useMemo(() => coerceTradeIn(feed.data?.tradeIn), [feed.data?.tradeIn]);
  const [state, setState] = useState<TradeFormState>(emptyTradeForm());
  const [seeded, setSeeded] = useState(false);
  const [outlier, setOutlier] = useState(false);
  useEffect(() => {
    if (seeded || !feed.data) return;
    setSeeded(true);
    if (feed.data.appraisal) setState(tradeFormFrom(feed.data.appraisal));
  }, [feed.data, seeded]);
  const set = useCallback((patch: Partial<TradeFormState>) => setState((s) => ({ ...s, ...patch })), []);
  const lien = Boolean(trade && (trade.ownership !== "owned" || trade.payoffEstimate > 0));
  const ready = Boolean(trade) && tradeFormReady(state, lien);
  const check = useCallback((quoteExpiresAt: string | null): TradeFormCheck => {
    if (!trade) return { ok: false, errors: ["Loading the buyer's trade-in. Try again in a moment."] };
    return checkTradeForm(state, { payoffEstimate: trade.payoffEstimate, ownership: trade.ownership, quoteExpiresAt });
  }, [state, trade]);
  const onReject = useCallback((json: { needsConfirmation?: boolean; code?: string }) => {
    if (json.needsConfirmation) { setOutlier(true); return true; }
    return json.code === "trade_allowance_required";
  }, []);
  const slot = expected ? (
    <section className="space-y-3 rounded-2xl border border-sky-500/40 bg-sky-950/10 p-4" data-testid="quote-trade-section">
      <div><h3 className="text-sm font-bold text-white">Trade-in allowance <span className="text-rose-300">*</span></h3><p className="text-[11px] text-ink-muted">The buyer included a trade-in. It&apos;s part of the price, so your quote needs a trade number (or a reason you can&apos;t give one). Quote the car on its own, exactly as you would without a trade.</p></div>
      {trade ? <TradeAllowanceFields state={state} set={set} trade={trade} needsOutlierConfirm={outlier} /> : <p className="text-xs text-ink-muted">Loading the trade-in…</p>}
    </section>
  ) : null;
  return { hasTrade: expected, ready, slot, check, onReject };
}
