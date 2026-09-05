"use client";

import React, { useState } from "react";
import { UserProfile, BiddingRequest, DealerBid, OfferCloseClockView } from "../lib/types";
import { formatCurrency } from "../lib/otdCalculator";
import { formatDealStructures } from "../lib/dealStructure";
import { reviewTargetFromVehicle } from "../lib/fordCompetitionUi";
import { offerPathLabel } from "../lib/shopperDeal";
import { DealVehiclesSummary } from "./DealVehiclesSummary";
import { DealerEngagementChips, OfferCloseClockCard } from "./DealEngagementPanel";
import {
  ShieldCheck,
  Zap,
  Building2,
  ChevronRight,
  TrendingDown,
  ArrowRight,
  Car,
} from "lucide-react";

interface DealTrackerDashboardProps {
  user: UserProfile;
  requests: BiddingRequest[];
  bids: DealerBid[];
  onOpenLiveDealRoom: (request: BiddingRequest) => void;
  onStartNewBid: () => void;
  onToggleTradeIn: (requestId: string, hasTradeIn: boolean) => void;
}

export const DealTrackerDashboard: React.FC<DealTrackerDashboardProps> = ({
  user,
  requests,
  bids,
  onOpenLiveDealRoom,
  onStartNewBid,
  onToggleTradeIn,
}) => {
  const [clockById, setClockById] = useState<Record<string, OfferCloseClockView>>({});

  const activeRequests = requests.filter((r) => r.status === "active" || r.status === "expired");

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8 animate-fadeIn">
      {/* Account Profile & Summary Strip */}
      <div className="rounded-2xl border border-border-strong bg-gradient-to-r from-surface via-surface-elevated to-surface p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="flex items-start sm:items-center gap-4 relative z-10">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={user.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80"}
              alt={user.name}
              className="h-16 w-16 rounded-2xl object-cover border-2 border-emerald-500/50 shadow-lg"
            />
            <div className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs font-black text-black">
              ✓
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-black text-white">{user.name}</h1>
              {user.buyerAlias && (
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-mono font-bold text-ink-light border border-border">
                  {user.buyerAlias}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-ink-muted">
              <span>Email: <strong className="text-ink-light">{user.email}</strong></span>
              <span>•</span>
              <span>Zip: <strong className="text-ink-light">{user.zipCode}</strong></span>
              <span>•</span>
              <span>Phone: <strong className="text-ink-light">{user.phone}</strong></span>
            </div>
          </div>
        </div>

        {/* Privacy Protection Banner */}
        <div className="mt-6 pt-5 border-t border-border/60 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-muted">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold">
            <ShieldCheck className="h-4 w-4" />
            <span>TrimScout Privacy Shield Active: Dealerships only see your Buyer Alias until a deal is locked.</span>
          </div>
          <div className="font-mono text-[11px] text-ink-faint">
            Session ID: #TS-{user.id.slice(-6)}
          </div>
        </div>
      </div>

      {/* Metrics Highlights Bar */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">Active Bidding Requests</div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
            {activeRequests.length}
          </div>
          <p className="text-[10px] text-ink-muted">Competing across network</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">Dealers Competing</div>
          <div className="text-2xl sm:text-3xl font-black text-blue-400 font-mono">
            {bids.length}
          </div>
          <p className="text-[10px] text-ink-muted">Total itemized bids received</p>
        </div>
      </div>

      {/* Active Bidding Requests */}
      <div className="space-y-6">
        {activeRequests.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface p-12 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
              <Car className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">No Active Bidding Requests</h3>
              <p className="text-xs text-ink-muted max-w-md mx-auto">
                You don’t have any active reverse bidding auctions running right now. Choose a car to let dealerships compete for your business.
              </p>
            </div>
            <button
              onClick={onStartNewBid}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-black text-black hover:bg-emerald-400 shadow-md shadow-emerald-500/20 transition-all"
            >
              <Zap className="h-4 w-4" /> Start a Bidding Request
            </button>
          </div>
        ) : (
          activeRequests.map((req) => {
            const reviewTarget = reviewTargetFromVehicle(req.targetVehicle);
            const paymentLabel = formatDealStructures(req.dealStructurePreferences?.requestedStructures || []);
            const hasTradeIn = Boolean(req.tradeIn?.hasTradeIn);
            return (
              <div
                key={req.id}
                className="rounded-2xl border border-border bg-surface shadow-xl overflow-hidden hover:border-emerald-500/40 transition-all"
              >
                {/* Request Header Banner */}
                <div className="border-b border-border bg-surface-elevated px-6 py-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                      <Zap className="h-5 w-5 fill-emerald-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-extrabold text-white text-base">
                          {reviewTarget?.title || "Imported vehicle unavailable"}
                        </h3>
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-400 border border-emerald-500/30 uppercase">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> {req.directOffer ? "Direct offer" : "Live Auction"}
                        </span>
                      </div>
                      {reviewTarget?.vin ? (
                        <p className="text-xs text-ink-muted mt-0.5 font-mono">
                          VIN: {reviewTarget.vin}
                        </p>
                      ) : null}
                      {reviewTarget?.dealerName || reviewTarget?.locationLine ? (
                        <p className="text-xs text-ink-light">
                          {[reviewTarget.dealerName, reviewTarget.locationLine].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                      <p className="text-xs text-ink-muted mt-0.5">
                        {offerPathLabel(req.directOffer)}
                        {paymentLabel ? ` • ${paymentLabel}` : ""}
                        {typeof req.targetOtdPrice === "number" && req.targetOtdPrice > 0
                          ? ` • Target ${formatCurrency(req.targetOtdPrice)}`
                          : ""}
                        {req.searchRadiusMiles ? (
                          <>
                            {" "}
                            • Search Radius:{" "}
                            <span className="text-ink-light font-semibold">{req.searchRadiusMiles} miles</span>
                          </>
                        ) : null}
                        {req.buyerZip ? (
                          <>
                            {" "}
                            • Buyer Zip:{" "}
                            <span className="text-ink-light font-mono font-semibold">{req.buyerZip}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <OfferCloseClockCard
                      clock={clockById[req.id] || req.offerClock}
                      dealRequestId={req.id}
                      onUpdated={(next) => setClockById((prev) => ({ ...prev, [req.id]: next }))}
                    />
                  </div>
                </div>

                {/* Body Content */}
                <div className="p-6 space-y-6">
                  <DealVehiclesSummary request={req} compareHref="/compare" />

                  <DealerEngagementChips dealers={req.dealerEngagement} />

                  {/* Top Bid Announcement Card */}
                  {(() => {
                    const bidsForReq = bids.filter((b) => b.dealRequestId === req.id);
                    const leading = bidsForReq[0] || null;
                    if (!leading) {
                      return (
                    <div className="rounded-xl border border-border bg-surface-elevated p-4 text-xs text-ink-muted">
                      {req.directOffer
                        ? `Waiting for ${req.targetVehicle?.location.dealerName || "this dealer"} to review your offer.`
                        : "Waiting for dealerships in your area to transmit their first out-the-door bids..."}
                    </div>
                      );
                    }
                    return (
                    <div className="rounded-xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-surface-elevated to-surface-elevated p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-emerald-500 text-black px-2 py-0.5 text-[10px] font-black uppercase tracking-wider">
                            {req.directOffer ? "Dealer response" : "#1 Leading Dealership Bid"}
                          </span>
                          <span className="text-xs font-bold text-white">{leading.dealerName}</span>
                          <span className="text-xs text-ink-muted">({leading.distanceMiles} mi away)</span>
                        </div>

                        <div className="text-sm font-bold text-ink-light">
                          {leading.matchedVehicleTitle} • <span className="text-ink-muted text-xs">{leading.matchedVehicleSpec}</span>
                        </div>

                        <p className="text-xs text-emerald-400 italic">
                          &ldquo;{leading.notes}&rdquo;
                        </p>
                      </div>

                      {/* Pricing Box */}
                      <div className="flex items-center gap-4 bg-background/80 border border-border p-3.5 rounded-xl">
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-ink-faint">Out-The-Door Price</span>
                          <div className="text-2xl font-black text-white font-mono">
                            {formatCurrency(leading.totalOtdPrice)}
                          </div>
                          <div className="text-[11px] text-emerald-400 font-semibold flex items-center justify-end gap-1">
                            <TrendingDown className="h-3 w-3" /> Save {formatCurrency(leading.dealerDiscountDollars)} ({leading.dealerDiscountPercent}% OFF)
                          </div>
                        </div>

                        <button
                          onClick={() => onOpenLiveDealRoom(req)}
                          className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20 active:scale-95"
                        >
                          <span>{req.directOffer ? "View offer" : "Open Live Deal Room"}</span>
                          <ArrowRight className="h-3.5 w-3.5 stroke-[2.5]" />
                        </button>
                      </div>
                    </div>
                    );
                  })()}

                  {/* Criteria Tags */}
                  {req.flexibleCriteria && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
                        <span className="text-[10px] uppercase font-bold text-ink-faint">Must-Have Packages</span>
                        <div className="font-semibold text-white">
                          {req.flexibleCriteria.mustHavePackages.join(", ") || "Any"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
                        <span className="text-[10px] uppercase font-bold text-ink-faint">Target Discount Range</span>
                        <div className="font-semibold text-emerald-400 font-mono">
                          {req.targetDiscountPercent ? `${req.targetDiscountPercent}% Off MSRP` : "Market Best"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] uppercase font-bold text-ink-faint">Trade-In Inclusion</span>
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
                        <div className="font-semibold text-white">
                          {hasTradeIn
                            ? req.tradeIn && req.tradeIn.year > 0
                              ? `${req.tradeIn.year} ${req.tradeIn.make} ${req.tradeIn.model}${
                                  req.tradeIn.estimatedValueMin > 0 && req.tradeIn.estimatedValueMax > 0
                                    ? ` (${formatCurrency(req.tradeIn.estimatedValueMin)} – ${formatCurrency(req.tradeIn.estimatedValueMax)})`
                                    : ""
                                }`
                              : "Trade-in attached"
                            : "No Trade-In Attached"}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer Controls */}
                <div className="flex items-center justify-between border-t border-border bg-surface-elevated px-6 py-3.5 text-xs">
                  <div className="flex items-center gap-2 text-ink-muted">
                    <Building2 className="h-4 w-4 text-emerald-400" />
                    <span>
                      {req.directOffer
                        ? (req.targetVehicle?.location.dealerName || "This dealer")
                        : <><strong>{bids.filter((b) => b.dealRequestId === req.id).length} dealerships</strong> currently active in your deal room</>}
                    </span>
                  </div>

                  <button
                    onClick={() => onOpenLiveDealRoom(req)}
                    className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-bold"
                  >
                    <span>{req.directOffer ? "View offer" : `View all ${bids.filter((b) => b.dealRequestId === req.id).length} competing offers`}</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
