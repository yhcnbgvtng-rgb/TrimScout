"use client";

import React, { useState } from "react";
import { BiddingRequest, DealerBid, OfferCloseClockView } from "../lib/types";
import { formatCurrency } from "../lib/otdCalculator";
import { formatDealStructures } from "../lib/dealStructure";
import { reviewTargetFromVehicle } from "../lib/fordCompetitionUi";
import { offerPathLabel } from "../lib/shopperDeal";
import { evaluateOfferClock } from "../lib/offerCloseClock";
import { DealVehiclesSummary } from "./DealVehiclesSummary";
import { DealerEngagementChips, OfferCloseClockCard } from "./DealEngagementPanel";
import {
  Zap,
  Building2,
  ChevronRight,
  TrendingDown,
  ArrowRight,
  Car,
} from "lucide-react";

interface DealTrackerDashboardProps {
  requests: BiddingRequest[];
  bids: DealerBid[];
  onOpenLiveDealRoom: (request: BiddingRequest) => void;
  onStartNewBid: () => void;
  onToggleTradeIn: (requestId: string, hasTradeIn: boolean) => void;
}

// One deal is the hero here — the buyer's own profile, privacy status, and
// zip now live in the header account menu (see Navbar.tsx) instead of a
// competing card at the top of this page. Stats that used to sit in two
// empty tiles are now a single thin strip inside the deal card itself.
export const DealTrackerDashboard: React.FC<DealTrackerDashboardProps> = ({
  requests,
  bids,
  onOpenLiveDealRoom,
  onStartNewBid,
  onToggleTradeIn,
}) => {
  const [clockById, setClockById] = useState<Record<string, OfferCloseClockView>>({});
  const [termsOpenById, setTermsOpenById] = useState<Record<string, boolean>>({});

  const activeRequests = requests.filter((r) => r.status === "active" || r.status === "expired");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 space-y-8 animate-fadeIn">
      {activeRequests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-12 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
            <Car className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white">No quote requests yet</h3>
            <p className="text-xs text-ink-muted max-w-md mx-auto">
              Paste a dealer&apos;s listing for the car you want and we&apos;ll send the dealership a quote request. Quotes show up here.
            </p>
          </div>
          <button
            onClick={onStartNewBid}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-black text-black hover:bg-emerald-400 shadow-md shadow-emerald-500/20 transition-all"
          >
            <Zap className="h-4 w-4 fill-black" /> Request a quote
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {activeRequests.map((req) => {
            const reviewTarget = reviewTargetFromVehicle(req.targetVehicle);
            const paymentLabel = formatDealStructures(req.dealStructurePreferences?.requestedStructures || []);
            const hasTradeIn = Boolean(req.tradeIn?.hasTradeIn);
            const bidsForReq = bids.filter((b) => b.dealRequestId === req.id);
            const leading = bidsForReq[0] || null;
            const clock = clockById[req.id] || req.offerClock;
            const clockStatus = clock
              ? evaluateOfferClock({
                  startedAt: clock.startedAt,
                  allottedRunningMs: clock.allottedRunningMs,
                  closedAt: clock.closedAt,
                  timeZone: clock.timeZone,
                  now: Date.now(),
                }).status
              : "idle";
            const isClosed = clockStatus === "closed";
            const dealerCount =
              req.dealerEngagement?.length ?? (req.directOffer && reviewTarget?.dealerName ? 1 : 0);

            // One status only — not a badge, a waiting box, and a clock all
            // saying different things. Closed beats everything; a leading
            // bid means the deal is actively live; otherwise we're waiting.
            const waitingLabel = req.directOffer
              ? `Waiting on ${reviewTarget?.dealerName || "the dealer"} to quote`
              : "Waiting on dealer quotes";
            const statusLabel = isClosed ? "Closed" : leading ? "Quotes in" : waitingLabel;
            const statusTone = isClosed ? "closed" : leading ? "live" : "waiting";

            const termsOpen = termsOpenById[req.id] ?? false;
            const mustHaves = req.flexibleCriteria?.mustHavePackages || [];
            const mustHaveSummary =
              mustHaves.length > 2
                ? `${mustHaves.slice(0, 2).join(", ")} +${mustHaves.length - 2} more`
                : mustHaves.join(", ") || "Any";
            const discountSummary = req.targetDiscountPercent ? `${req.targetDiscountPercent}% off MSRP` : "Market best";
            const tradeInSummary = hasTradeIn
              ? req.tradeIn && req.tradeIn.year > 0
                ? `${req.tradeIn.year} ${req.tradeIn.make} ${req.tradeIn.model}`
                : "Attached"
              : "None";

            return (
              <div
                key={req.id}
                className="rounded-2xl border border-border bg-surface shadow-xl overflow-hidden"
              >
                {/* Header — title, then the one status strip (replaces the
                    old badge + two stat tiles + separate waiting text). */}
                <div className="px-6 sm:px-8 py-6 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                      <Car className="h-5.5 w-5.5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-lg font-extrabold text-white truncate">
                        {reviewTarget?.title || "Imported vehicle unavailable"}
                      </h2>
                      <p className="text-xs text-ink-muted mt-0.5 truncate">
                        {reviewTarget?.vin ? <span className="font-mono">{reviewTarget.vin}</span> : null}
                        {reviewTarget?.dealerName ? ` · ${reviewTarget.dealerName}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs pl-14">
                    <span className="text-ink-muted">{activeRequests.length} request{activeRequests.length === 1 ? "" : "s"}</span>
                    <span className="text-ink-faint">·</span>
                    <span className="text-ink-muted">{dealerCount} dealer{dealerCount === 1 ? "" : "s"}</span>
                    <span className="text-ink-faint">·</span>
                    {statusTone === "live" ? (
                      <span className="font-bold text-emerald-400">{statusLabel}</span>
                    ) : (
                      <span className={statusTone === "closed" ? "text-ink-faint font-semibold" : "text-ink-muted"}>
                        {statusLabel}
                      </span>
                    )}
                    <OfferCloseClockCard
                      compact
                      clock={clock}
                      dealRequestId={req.id}
                      onUpdated={(next) => setClockById((prev) => ({ ...prev, [req.id]: next }))}
                    />
                  </div>
                </div>

                {/* Body */}
                <div className="px-6 sm:px-8 pb-6 space-y-5">
                  <DealVehiclesSummary request={req} hidePrimary />

                  <DealerEngagementChips dealers={req.dealerEngagement} />

                  {leading ? (
                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-emerald-500 text-black px-2 py-0.5 text-[10px] font-black uppercase tracking-wider">
                            {req.directOffer ? "Dealer response" : "Leading bid"}
                          </span>
                          <span className="text-xs font-bold text-white">{leading.dealerName}</span>
                          <span className="text-xs text-ink-muted">({leading.distanceMiles} mi away)</span>
                        </div>
                        <div className="text-sm font-bold text-ink-light">
                          {leading.matchedVehicleTitle} <span className="text-ink-muted text-xs font-normal">{leading.matchedVehicleSpec}</span>
                        </div>
                        {leading.notes ? (
                          <p className="text-xs text-ink-muted italic">&ldquo;{leading.notes}&rdquo;</p>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <div className="text-[10px] uppercase font-bold text-ink-faint">Out-the-door</div>
                          <div className="text-2xl font-black text-white font-mono">
                            {formatCurrency(leading.totalOtdPrice)}
                          </div>
                          <div className="text-[11px] text-emerald-400 font-semibold flex items-center justify-end gap-1">
                            <TrendingDown className="h-3 w-3" /> Save {formatCurrency(leading.dealerDiscountDollars)} ({leading.dealerDiscountPercent}%)
                          </div>
                        </div>
                        <button
                          onClick={() => onOpenLiveDealRoom(req)}
                          className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20 active:scale-95"
                        >
                          <span>{req.directOffer ? "View quote" : "Compare quotes"}</span>
                          <ArrowRight className="h-3.5 w-3.5 stroke-[2.5]" />
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <p className="text-xs text-ink-muted">
                    {offerPathLabel(req.directOffer)}
                    {paymentLabel ? ` · ${paymentLabel}` : ""}
                    {typeof req.targetOtdPrice === "number" && req.targetOtdPrice > 0
                      ? ` · Target ${formatCurrency(req.targetOtdPrice)}`
                      : ""}
                    {req.searchRadiusMiles ? ` · ${req.searchRadiusMiles} mi radius` : ""}
                    {req.buyerZip ? ` · Zip ${req.buyerZip}` : ""}
                  </p>

                  {/* Deal terms — must-haves, discount preference, and
                      trade-in used to be three sibling cards; now one row
                      that expands for the one control that's actually
                      editable (trade-in). */}
                  {req.flexibleCriteria && (
                    <div className="rounded-xl border border-border bg-surface-elevated px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setTermsOpenById((prev) => ({ ...prev, [req.id]: !termsOpen }))}
                        className="w-full flex items-center justify-between gap-3 text-left"
                      >
                        <span className="text-xs text-ink-muted truncate">
                          <span className="text-[10px] uppercase font-bold text-ink-faint tracking-wider mr-2">Deal terms</span>
                          {mustHaveSummary} · {discountSummary} · Trade-in: {tradeInSummary}
                        </span>
                        <span className="text-xs font-bold text-emerald-400 shrink-0">
                          {termsOpen ? "Done" : "Edit"}
                        </span>
                      </button>

                      {termsOpen && (
                        <div className="mt-4 pt-4 border-t border-border/60 space-y-4 text-xs">
                          <div>
                            <span className="text-[10px] uppercase font-bold text-ink-faint tracking-wider">Must-have packages</span>
                            <div className="text-white font-semibold mt-1">{mustHaves.join(", ") || "Any"}</div>
                          </div>
                          <div>
                            <span className="text-[10px] uppercase font-bold text-ink-faint tracking-wider">Target discount</span>
                            <div className="text-white font-semibold mt-1">{discountSummary}</div>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <span className="text-[10px] uppercase font-bold text-ink-faint tracking-wider">Trade-in</span>
                              <div className="text-white font-semibold mt-1">
                                {hasTradeIn
                                  ? req.tradeIn && req.tradeIn.year > 0
                                    ? `${req.tradeIn.year} ${req.tradeIn.make} ${req.tradeIn.model}${
                                        req.tradeIn.estimatedValueMin > 0 && req.tradeIn.estimatedValueMax > 0
                                          ? ` (${formatCurrency(req.tradeIn.estimatedValueMin)} – ${formatCurrency(req.tradeIn.estimatedValueMax)})`
                                          : ""
                                      }`
                                    : "Trade-in attached"
                                  : "No trade-in attached"}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => onToggleTradeIn(req.id, !hasTradeIn)}
                              aria-pressed={hasTradeIn}
                              aria-label={hasTradeIn ? "Remove trade-in from this deal" : "Attach a trade-in to this deal"}
                              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                                hasTradeIn ? "bg-emerald-500" : "bg-border"
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                                  hasTradeIn ? "translate-x-4" : "translate-x-0.5"
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer — one next action only */}
                <div className="flex items-center justify-between border-t border-border/60 px-6 sm:px-8 py-4 text-xs">
                  <div className="flex items-center gap-2 text-ink-muted">
                    <Building2 className="h-4 w-4 text-ink-faint" />
                    <span>
                      {req.directOffer
                        ? (req.targetVehicle?.location.dealerName || "This dealer")
                        : <>{bidsForReq.length} dealership{bidsForReq.length === 1 ? "" : "s"} active in your deal room</>}
                    </span>
                  </div>

                  {!leading && (
                    <button
                      onClick={() => onOpenLiveDealRoom(req)}
                      className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-bold"
                    >
                      <span>{req.directOffer ? "View quote" : "Compare quotes"}</span>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
