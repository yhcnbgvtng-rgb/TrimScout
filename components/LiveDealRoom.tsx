"use client";

import React, { useState, useEffect } from "react";
import { BiddingRequest, DealerBid, OfferCloseClockView } from "../lib/types";
import { formatCurrency, formatPercent } from "../lib/otdCalculator";
import { formatDealStructures } from "../lib/dealStructure";
import { reviewTargetFromVehicle } from "../lib/fordCompetitionUi";
import { offerPathLabel } from "../lib/shopperDeal";
import { DealVehiclesSummary } from "./DealVehiclesSummary";
import { DealerEngagementChips, OfferCloseClockCard } from "./DealEngagementPanel";
import {
  ShieldCheck,
  Trophy,
  FileText,
  Lock,
  Camera,
  Eye,
  AlertTriangle
} from "lucide-react";

interface LiveDealRoomProps {
  request: BiddingRequest;
  bids: DealerBid[];
  onInspectFee: (bid: DealerBid) => void;
  // True only for the real reverse-auction flow (a real vehicle the buyer
  // selected from live inventory) — polls the box for real competing bids.
  // The out-of-scope mock demo path (BidProgramIntro's "View Demo Deal
  // Room") leaves this unset and just renders whatever `bids` it was
  // given, unchanged.
  pollBids?: boolean;
}

export const LiveDealRoom: React.FC<LiveDealRoomProps> = ({
  request,
  bids,
  onInspectFee,
  pollBids,
}) => {
  const [sortBy, setSortBy] = useState<"discount" | "quoted">("discount");
  const [isTradeInModalOpen, setIsTradeInModalOpen] = useState(false);
  const bidsForRequest = bids.filter((b) => b.dealRequestId === request.id);
  const [liveBids, setLiveBids] = useState<DealerBid[]>(() => (pollBids ? [] : bidsForRequest));
  const [countdownClock, setCountdownClock] = useState<OfferCloseClockView | undefined>(request.offerClock);
  const [liveDealers, setLiveDealers] = useState(request.dealerEngagement);
  const [pollTrouble, setPollTrouble] = useState(false);
  const reviewTarget = reviewTargetFromVehicle(request.targetVehicle);
  const paymentLabel = formatDealStructures(request.dealStructurePreferences?.requestedStructures || []);
  const pathLabel = offerPathLabel(request.directOffer);

  // Non-real flow: just mirror whatever bids the parent passes in for this request.
  useEffect(() => {
    if (!pollBids) setLiveBids(bids.filter((b) => b.dealRequestId === request.id));
  }, [bids, pollBids, request.id]);

  useEffect(() => {
    setCountdownClock(request.offerClock);
    setLiveDealers(request.dealerEngagement);
  }, [request.offerClock, request.dealerEngagement, request.id]);

  // Real flow: poll bids + engagement every ~9s.
  useEffect(() => {
    if (!pollBids) return;
    let cancelled = false;
    let consecutiveFailures = 0;
    const poll = async () => {
      try {
        const [bidsRes, engagementRes] = await Promise.all([
          fetch(`/api/deal-requests/${request.id}/bids`),
          fetch(`/api/deal-requests/${request.id}/engagement`),
        ]);
        if (bidsRes.ok) {
          const json = await bidsRes.json();
          if (cancelled) return;
          const mapped: DealerBid[] = (json.bids || []).map((b: DealerBid & { dealerCity?: string; dealerState?: string; distanceMiles?: number; matchedVehicleSpec?: string; matchedVehicleImageUrl?: string }) => ({
            ...b,
            dealerCity: b.dealerCity || "",
            dealerState: b.dealerState || "",
            distanceMiles: b.distanceMiles || 0,
            matchedVehicleSpec: b.matchedVehicleSpec || "",
            matchedVehicleImageUrl: b.matchedVehicleImageUrl || "",
          }));
          setLiveBids(mapped);
          consecutiveFailures = 0;
          setPollTrouble(false);
        } else {
          throw new Error(`bids poll failed (${bidsRes.status})`);
        }
        if (engagementRes.ok) {
          const json = await engagementRes.json();
          if (cancelled) return;
          if (json.offerClock) setCountdownClock(json.offerClock);
          if (Array.isArray(json.dealers)) setLiveDealers(json.dealers);
        }
      } catch {
        // A single miss isn't worth alarming anyone — transient blips
        // happen. But this box has been dead before for extended periods,
        // where every single poll fails identically forever; after a few
        // in a row, say so instead of silently freezing on stale data with
        // no indication anything is wrong.
        if (cancelled) return;
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) setPollTrouble(true);
      }
    };
    poll();
    const interval = setInterval(poll, 9000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollBids, request.id]);

  const sortedBids = [...liveBids].sort((a, b) => {
    if (sortBy === "discount") {
      return b.dealerDiscountPercent - a.dealerDiscountPercent;
    }
    return a.quotedOtdPrice - b.quotedOtdPrice;
  });

  const buyerAlias = request.buyerState ? `Buyer #${request.buyerState}` : "Buyer";

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {/* War Room Header & Timer */}
      <div className="rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-r from-surface via-surface-elevated to-surface p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
              <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/20">
                LIVE BIDDING IN PROGRESS
              </span>
              <span className="rounded-md bg-black/50 px-2 py-0.5 text-xs font-medium text-ink-muted border border-border">
                Masked Alias: <strong className="text-white font-mono">{buyerAlias}</strong>
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Deal Room{reviewTarget?.title ? `: ${reviewTarget.title}` : ""}
            </h1>
            {reviewTarget?.vin ? (
              <p className="mt-1 text-xs text-ink-muted">
                VIN:{" "}
                {reviewTarget.vdpHref ? (
                  <a
                    href={reviewTarget.vdpHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-emerald-400 hover:underline"
                  >
                    {reviewTarget.vin}
                  </a>
                ) : (
                  <span className="font-mono text-ink-light">{reviewTarget.vin}</span>
                )}
              </p>
            ) : null}
            {reviewTarget?.dealerName ? (
              <p className="mt-0.5 text-xs text-ink-light">{reviewTarget.dealerName}</p>
            ) : null}
            {reviewTarget?.locationLine ? (
              <p className="text-xs text-ink-muted">{reviewTarget.locationLine}</p>
            ) : null}

            <p className="mt-1 text-xs text-ink-muted">
              {pathLabel}
              {paymentLabel ? (
                <>
                  {" "}
                  • Payment: <span className="text-white font-semibold">{paymentLabel}</span>
                </>
              ) : null}
              {typeof request.targetOtdPrice === "number" && request.targetOtdPrice > 0 ? (
                <>
                  {" "}
                  • Target:{" "}
                  <span className="text-white font-semibold font-mono">{formatCurrency(request.targetOtdPrice)}</span>
                </>
              ) : null}
              {request.searchRadiusMiles ? (
                <>
                  {" "}
                  • Radius:{" "}
                  <span className="text-white font-semibold">
                    {request.searchRadiusMiles} Miles
                    {request.sameStateOnly ? ` (${request.buyerState || "your state"} only)` : ""}
                  </span>
                </>
              ) : null}
              {request.flexibleCriteria?.mustHavePackages?.length ? (
                <>
                  {" "}
                  • Must-haves:{" "}
                  <span className="text-white font-semibold">
                    {request.flexibleCriteria.mustHavePackages.slice(0, 3).join(", ")}
                    {request.flexibleCriteria.mustHavePackages.length > 3
                      ? ` +${request.flexibleCriteria.mustHavePackages.length - 3} more`
                      : ""}
                  </span>
                </>
              ) : null}
            </p>
          </div>

          <OfferCloseClockCard
            clock={countdownClock}
            dealRequestId={request.id}
            onUpdated={setCountdownClock}
          />
        </div>
      </div>

      {/* Vehicles in this deal */}
      <DealVehiclesSummary request={request} compareHref="/compare" />

      <DealerEngagementChips dealers={liveDealers} />

      {/* Trade-In Vehicle Appraisal Bar */}
      {request.tradeIn && request.tradeIn.hasTradeIn && (
        <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-r from-blue-950/40 via-surface-elevated to-surface p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30 shrink-0">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs sm:text-sm font-bold text-white">
                  Trade-In Attached: {request.tradeIn.year} {request.tradeIn.make} {request.tradeIn.model} {request.tradeIn.trim}
                </h4>
                <span className="rounded bg-blue-500/20 px-1.5 py-0.2 text-[10px] font-bold text-blue-300">
                  {request.tradeIn.photos.length} Photos Attached
                </span>
              </div>
              <p className="text-[11px] text-ink-muted mt-0.5">
                Mileage: <strong className="text-white font-mono">{request.tradeIn.mileage.toLocaleString()} mi</strong> • Condition: <strong className="text-white capitalize">{request.tradeIn.condition.replace("_", " ")}</strong> • Est. Market Value: <strong className="text-emerald-400 font-mono">{formatCurrency(request.tradeIn.estimatedValueMin)} – {formatCurrency(request.tradeIn.estimatedValueMax)}</strong>
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsTradeInModalOpen(true)}
            className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs font-bold text-blue-300 hover:bg-blue-500 hover:text-black transition-all flex items-center gap-1.5 shrink-0 self-start sm:self-auto"
          >
            <Eye className="h-3.5 w-3.5" />
            <span>View Submitted Photos ({request.tradeIn.photos.length})</span>
          </button>
        </div>
      )}

      {/* Leaderboard */}
      <div className="space-y-4">
        {pollBids && pollTrouble && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-950/20 px-4 py-2.5 text-xs text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Having trouble reaching the server — what you see below may be out of date. Still retrying.</span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Ranked Dealer Offers ({sortedBids.length})
            </h2>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-muted font-medium">Sort Leaderboard By:</span>
            <button
              onClick={() => setSortBy("discount")}
              className={`rounded-lg px-2.5 py-1 font-semibold transition-all ${
                sortBy === "discount"
                  ? "bg-emerald-500 text-black shadow-sm"
                  : "border border-border bg-surface text-ink-muted hover:text-white"
              }`}
            >
              🔥 % Discount off MSRP
            </button>
            <button
              onClick={() => setSortBy("quoted")}
              className={`rounded-lg px-2.5 py-1 font-semibold transition-all ${
                sortBy === "quoted"
                  ? "bg-emerald-500 text-black shadow-sm"
                  : "border border-border bg-surface text-ink-muted hover:text-white"
              }`}
            >
              💲 Lowest Quoted Price
            </button>
          </div>
        </div>

        {sortedBids.length === 0 && (
          <div className="rounded-2xl border border-border bg-surface p-10 text-center text-sm text-ink-muted">
            No dealer bids yet — dealers matching this vehicle are being notified. Check back shortly.
          </div>
        )}

        {/* Dealer Bid Cards */}
        <div className="space-y-4">
          {sortedBids.map((bid, index) => {
            const isFirst = index === 0;

            return (
              <div
                key={bid.id}
                className={`rounded-2xl border transition-all p-5 space-y-4 ${
                  isFirst
                    ? "border-emerald-500 bg-surface-elevated shadow-xl ring-1 ring-emerald-500/50"
                    : "border-border bg-surface hover:border-border-strong"
                }`}
              >
                {/* Card Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {/* Rank Badge */}
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-xl font-black text-sm ${
                        index === 0
                          ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20"
                          : index === 1
                          ? "bg-slate-300 text-black"
                          : "bg-amber-700 text-white"
                      }`}
                    >
                      #{index + 1}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-extrabold text-white text-base">{bid.dealerName}</h3>
                        <span className="text-xs text-ink-muted">
                          ({bid.dealerCity ? `${bid.dealerCity}, ` : ""}{bid.dealerState}{bid.distanceMiles ? ` • ${bid.distanceMiles} mi` : ""})
                        </span>
                      </div>
                      <p className="text-xs text-ink-light font-medium">
                        {bid.matchedVehicleTitle}
                        {bid.matchedVin && (
                          <span className="font-mono text-[11px] text-ink-faint"> • VIN: {bid.matchedVin}</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Inventory Status */}
                  <div>
                    {bid.vehicleStatus === "on_lot" ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-950/80 px-2.5 py-1 text-xs font-bold text-emerald-400 border border-emerald-500/30">
                        🟢 On Lot (Immediate Delivery)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-blue-950/80 px-2.5 py-1 text-xs font-bold text-blue-400 border border-blue-500/30">
                        🚚 In Transit (Allocated)
                      </span>
                    )}
                  </div>
                </div>

                {/* Financial Breakdown Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-border bg-background p-3.5 text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-ink-faint">Window MSRP</span>
                    <div className="font-bold text-ink-light font-mono text-sm">
                      {formatCurrency(bid.msrp)}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-emerald-400">Dealer Discount</span>
                    <div className="font-bold text-emerald-400 font-mono text-sm">
                      -{formatCurrency(bid.dealerDiscountDollars)} ({formatPercent(bid.dealerDiscountPercent)})
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-ink-faint">Doc Fee</span>
                    <div className="font-semibold text-ink-muted font-mono text-sm">
                      +{formatCurrency(bid.docFee)}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-emerald-400">Quoted Price</span>
                    <div className="font-black text-white font-mono text-base">
                      {formatCurrency(bid.quotedOtdPrice)}
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-ink-faint -mt-2">
                  Quoted price excludes sales tax & registration fees, which depend on your location — those are computed exactly at checkout.
                </p>

                {/* Dealer Notes */}
                {bid.notes && (
                  <p className="text-xs text-ink-muted bg-surface p-2.5 rounded-lg border border-border/60 italic">
                    "{bid.notes}"
                  </p>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button
                    onClick={() => onInspectFee(bid)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:underline"
                  >
                    <FileText className="h-3.5 w-3.5" /> Inspect Itemized Line Items
                  </button>

                  <button
                    onClick={() => onInspectFee(bid)}
                    className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-extrabold transition-all shadow-md active:scale-95 ${
                      isFirst
                        ? "bg-emerald-500 text-black hover:bg-emerald-400 shadow-emerald-500/20"
                        : "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500 hover:text-black"
                    }`}
                  >
                    <Lock className="h-3.5 w-3.5" /> Accept This Deal & Lock OTD Price
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Safe Purchase Info Card */}
        <div className="rounded-2xl border border-border bg-surface-elevated p-4 flex items-start gap-3 text-xs">
          <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-white">Transparent Transaction Policy</h4>
            <p className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">
              Dealer identity, contact info, and VIN stay hidden until you lock in a deal — all doc fees are legally capped, and unwanted dealer add-ons are strictly forbidden.
            </p>
          </div>
        </div>
      </div>

      {/* Customer Trade-In Photos Lightbox Modal */}
      {isTradeInModalOpen && request.tradeIn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl border border-border-strong bg-surface shadow-2xl overflow-hidden my-8">
            <div className="flex items-center justify-between border-b border-border bg-surface-elevated px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
                  <Camera className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    Your Trade-In Appraisal Photos
                  </h2>
                  <p className="text-xs text-ink-muted">
                    {request.tradeIn.year} {request.tradeIn.make} {request.tradeIn.model} {request.tradeIn.trim}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsTradeInModalOpen(false)}
                className="rounded-lg p-1.5 text-ink-muted hover:bg-border hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {request.tradeIn.photos.map((photo) => (
                  <div
                    key={photo.id}
                    className="rounded-xl border border-border bg-background overflow-hidden space-y-2 group"
                  >
                    <div className="relative aspect-video overflow-hidden bg-black/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.imageUrl}
                        alt={photo.label}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <span className="absolute bottom-2 left-2 rounded-md bg-black/80 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm border border-white/10">
                        {photo.label}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3 text-[11px] text-ink-light">
                <strong className="text-blue-400">Transmitted to Dealers:</strong> Dealers review these photos to formulate binding trade-in allowances on your leaderboard bids.
              </div>
            </div>

            <div className="flex justify-end border-t border-border bg-surface-elevated px-6 py-4">
              <button
                onClick={() => setIsTradeInModalOpen(false)}
                className="rounded-lg bg-emerald-500 px-5 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-md"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
