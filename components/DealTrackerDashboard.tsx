"use client";

import React, { useState } from "react";
import { UserProfile, BiddingRequest, DealerBid, LockedDeal, Vehicle } from "../lib/types";
import { formatCurrency, formatPercent } from "../lib/otdCalculator";
import {
  ShieldCheck,
  Zap,
  Clock,
  CircleCheck as CheckCircle2,
  FileText,
  Lock,
  Building2,
  Phone,
  Printer,
  ChevronRight,
  Sparkles,
  ArrowRight,
  TrendingDown,
  Heart,
  Car,
  CircleAlert as AlertCircle,
  ExternalLink,
  Plus
} from "lucide-react";

interface DealTrackerDashboardProps {
  user: UserProfile;
  requests: BiddingRequest[];
  bids: DealerBid[];
  lockedDeal: LockedDeal | null;
  savedVehicles: Vehicle[];
  onOpenLiveDealRoom: (request: BiddingRequest) => void;
  onOpenVoucherModal: (deal: LockedDeal) => void;
  onStartNewBid: () => void;
  onInspectSavedVehicle: (vehicle: Vehicle) => void;
  onRemoveSavedVehicle: (vehicleId: string) => void;
}

export const DealTrackerDashboard: React.FC<DealTrackerDashboardProps> = ({
  user,
  requests,
  bids,
  lockedDeal,
  savedVehicles,
  onOpenLiveDealRoom,
  onOpenVoucherModal,
  onStartNewBid,
  onInspectSavedVehicle,
  onRemoveSavedVehicle,
}) => {
  const [activeTab, setActiveTab] = useState<"active_bids" | "locked_deals" | "saved_cars" | "history">("active_bids");

  const activeRequests = requests.filter((r) => r.status === "active");
  const topBid = bids.length > 0 ? bids[0] : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8 animate-fadeIn">
      {/* Account Profile & Summary Strip */}
      <div className="rounded-2xl border border-border-strong bg-gradient-to-r from-surface via-surface-elevated to-surface p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 relative z-10">
          <div className="flex items-start sm:items-center gap-4">
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
                <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-extrabold text-emerald-400 border border-emerald-500/30">
                  {user.role === "buyer" ? "Verified Buyer" : "Verified Dealer Partner"}
                </span>
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

          {/* Quick Action Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={onStartNewBid}
              className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20 active:scale-95"
            >
              <Plus className="h-4 w-4 stroke-[2.5]" />
              <span>Launch New Bidding Request</span>
            </button>
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">Locked Deals</div>
          <div className="text-2xl sm:text-3xl font-black text-amber-400 font-mono">
            {lockedDeal ? "1" : "0"}
          </div>
          <p className="text-[10px] text-ink-muted">Vouchers ready for signing</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">Top OTD Savings</div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
            {topBid ? `-${formatPercent(topBid.dealerDiscountPercent)}` : "—"}
          </div>
          <p className="text-[10px] text-ink-muted">Below window sticker MSRP</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <button
          onClick={() => setActiveTab("active_bids")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${
            activeTab === "active_bids"
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-surface text-ink-muted hover:text-white border border-border"
          }`}
        >
          <Zap className="h-3.5 w-3.5" />
          <span>Active Bidding Requests</span>
          <span className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-black ${
            activeTab === "active_bids" ? "bg-black text-emerald-400" : "bg-emerald-500/20 text-emerald-400"
          }`}>
            {activeRequests.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("locked_deals")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${
            activeTab === "locked_deals"
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-surface text-ink-muted hover:text-white border border-border"
          }`}
        >
          <Lock className="h-3.5 w-3.5" />
          <span>Locked Vouchers & Paperwork</span>
          {lockedDeal && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-black text-black">
              1
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("saved_cars")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${
            activeTab === "saved_cars"
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-surface text-ink-muted hover:text-white border border-border"
          }`}
        >
          <Heart className="h-3.5 w-3.5" />
          <span>Saved Vehicles Watchlist</span>
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-elevated px-1 text-[9px] font-bold text-ink-light border border-border">
            {savedVehicles.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${
            activeTab === "history"
              ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
              : "bg-surface text-ink-muted hover:text-white border border-border"
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Deal History & Archive</span>
        </button>
      </div>

      {/* TAB 1: ACTIVE BIDDING REQUESTS */}
      {activeTab === "active_bids" && (
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
            activeRequests.map((req) => (
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
                          {req.flexibleCriteria
                            ? `${req.flexibleCriteria.make} ${req.flexibleCriteria.model} (${req.flexibleCriteria.trims.join(", ")})`
                            : req.targetVehicle
                            ? `${req.targetVehicle.year} ${req.targetVehicle.make} ${req.targetVehicle.model} ${req.targetVehicle.trim}`
                            : "Custom Bidding Request"}
                        </h3>
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-400 border border-emerald-500/30 uppercase">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Auction
                        </span>
                      </div>
                      <p className="text-xs text-ink-muted mt-0.5">
                        Strategy: <span className="text-ink-light capitalize font-semibold">{req.strategy.replace("_", " ")}</span> • Search Radius: <span className="text-ink-light font-semibold">{req.searchRadiusMiles} miles</span> • Buyer Zip: <span className="text-ink-light font-mono font-semibold">{req.buyerZip}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-[10px] uppercase font-bold text-ink-faint flex items-center gap-1 justify-end">
                        <Clock className="h-3 w-3 text-amber-400" /> Auction Countdown
                      </div>
                      <div className="font-mono font-bold text-amber-400 text-xs">
                        {req.expiresAt} Remaining
                      </div>
                    </div>
                  </div>
                </div>

                {/* Body Content */}
                <div className="p-6 space-y-6">
                  {/* Top Bid Announcement Card */}
                  {topBid ? (
                    <div className="rounded-xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-surface-elevated to-surface-elevated p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-emerald-500 text-black px-2 py-0.5 text-[10px] font-black uppercase tracking-wider">
                            #1 Leading Dealership Bid
                          </span>
                          <span className="text-xs font-bold text-white">{topBid.dealerName}</span>
                          <span className="text-xs text-ink-muted">({topBid.distanceMiles} mi away)</span>
                        </div>

                        <div className="text-sm font-bold text-ink-light">
                          {topBid.matchedVehicleTitle} • <span className="text-ink-muted text-xs">{topBid.matchedVehicleSpec}</span>
                        </div>

                        <p className="text-xs text-emerald-400 italic">
                          &ldquo;{topBid.notes}&rdquo;
                        </p>
                      </div>

                      {/* Pricing Box */}
                      <div className="flex items-center gap-4 bg-background/80 border border-border p-3.5 rounded-xl">
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-ink-faint">Out-The-Door Price</span>
                          <div className="text-2xl font-black text-white font-mono">
                            {formatCurrency(topBid.totalOtdPrice)}
                          </div>
                          <div className="text-[11px] text-emerald-400 font-semibold flex items-center justify-end gap-1">
                            <TrendingDown className="h-3 w-3" /> Save {formatCurrency(topBid.dealerDiscountDollars)} ({topBid.dealerDiscountPercent}% OFF)
                          </div>
                        </div>

                        <button
                          onClick={() => onOpenLiveDealRoom(req)}
                          className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20 active:scale-95"
                        >
                          <span>Open Live Deal Room</span>
                          <ArrowRight className="h-3.5 w-3.5 stroke-[2.5]" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border bg-surface-elevated p-4 text-xs text-ink-muted">
                      Waiting for dealerships in your area to transmit their first out-the-door bids...
                    </div>
                  )}

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

                      <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
                        <span className="text-[10px] uppercase font-bold text-ink-faint">Trade-In Inclusion</span>
                        <div className="font-semibold text-white">
                          {req.tradeIn?.hasTradeIn
                            ? `${req.tradeIn.year} ${req.tradeIn.make} ${req.tradeIn.model} (Valued $24.5k - $26.8k)`
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
                    <span><strong>{bids.length} dealerships</strong> currently active in your deal room</span>
                  </div>

                  <button
                    onClick={() => onOpenLiveDealRoom(req)}
                    className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-bold"
                  >
                    <span>View all {bids.length} competing offers</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 2: LOCKED DEALS & PAPERWORK */}
      {activeTab === "locked_deals" && (
        <div className="space-y-6">
          {!lockedDeal ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface p-12 text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
                <Lock className="h-7 w-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">No Locked Deals Yet</h3>
                <p className="text-xs text-ink-muted max-w-md mx-auto">
                  When you accept a winning dealer’s out-the-door bid in the Live Deal Room, your official Price Voucher and digital sales contract will appear here for e-signing.
                </p>
              </div>
              {activeRequests.length > 0 && (
                <button
                  onClick={() => onOpenLiveDealRoom(activeRequests[0])}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-black text-black hover:bg-emerald-400 shadow-md shadow-emerald-500/20 transition-all"
                >
                  <Zap className="h-4 w-4" /> Go to Live Deal Room
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-emerald-500 bg-surface shadow-2xl overflow-hidden space-y-6">
              {/* Header Banner */}
              <div className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 p-6 text-black flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-1 rounded-full bg-black/20 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-black mb-1">
                    <CheckCircle2 className="h-3 w-3" /> Locked & Guaranteed Price
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black">
                    Out-The-Door Deal Voucher #{lockedDeal.certificateId}
                  </h2>
                  <p className="text-xs font-semibold text-black/80 mt-0.5">
                    Locked on {lockedDeal.lockedAt} • Valid for {lockedDeal.expiresAt}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onOpenVoucherModal(lockedDeal)}
                    className="flex items-center gap-1.5 rounded-xl bg-black px-4 py-2 text-xs font-bold text-white hover:bg-black/80 shadow-md transition-all"
                  >
                    <FileText className="h-3.5 w-3.5 text-emerald-400" />
                    <span>View Voucher Certificate</span>
                  </button>
                </div>
              </div>

              {/* Progress Milestones Tracker */}
              <div className="px-6 space-y-3">
                <h4 className="text-xs uppercase font-bold text-ink-faint tracking-wider">
                  Transaction & Delivery Tracker
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                  {/* Step 1 */}
                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3.5 space-y-1">
                    <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                      <CheckCircle2 className="h-4 w-4" /> 1. Deal Locked
                    </div>
                    <p className="text-[11px] text-ink-muted">
                      Accepted {formatCurrency(lockedDeal.winningBid.totalOtdPrice)} OTD
                    </p>
                  </div>

                  {/* Step 2 */}
                  <div className={`rounded-xl border p-3.5 space-y-1 ${
                    lockedDeal.paperworkStatus === "uploaded" || lockedDeal.paperworkStatus === "customer_signed"
                      ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-400"
                      : "border-blue-500/40 bg-blue-950/20 text-blue-300"
                  }`}>
                    <div className="flex items-center gap-1.5 font-bold">
                      {lockedDeal.paperworkStatus === "uploaded" || lockedDeal.paperworkStatus === "customer_signed" ? (
                        <><CheckCircle2 className="h-4 w-4" /> 2. Dealer Paperwork</>
                      ) : (
                        <><Clock className="h-4 w-4 animate-spin" /> 2. Contract Prep</>
                      )}
                    </div>
                    <p className="text-[11px] text-ink-muted">
                      {lockedDeal.paperworkStatus === "uploaded"
                        ? `${lockedDeal.uploadedContractName}`
                        : "Sales Director uploading PDF"}
                    </p>
                  </div>

                  {/* Step 3 */}
                  <div className="rounded-xl border border-border bg-surface-elevated p-3.5 space-y-1 text-ink-muted">
                    <div className="flex items-center gap-1.5 font-bold text-ink-light">
                      <FileText className="h-4 w-4 text-ink-faint" /> 3. Digital E-Sign
                    </div>
                    <p className="text-[11px] text-ink-faint">
                      Sign from laptop / phone
                    </p>
                  </div>

                  {/* Step 4 */}
                  <div className="rounded-xl border border-border bg-surface-elevated p-3.5 space-y-1 text-ink-muted">
                    <div className="flex items-center gap-1.5 font-bold text-ink-light">
                      <Car className="h-4 w-4 text-ink-faint" /> 4. Vehicle Delivery
                    </div>
                    <p className="text-[11px] text-ink-faint capitalize">
                      {lockedDeal.deliveryMethod?.replace("_", " ") || "Driveway Delivery"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Deal Summary Grid */}
              <div className="px-6 grid grid-cols-1 md:grid-cols-2 gap-4 pb-6">
                {/* Selling Dealer Card */}
                <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-ink-faint">Selling Dealership</span>
                    <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                      Certified Dealer Partner
                    </span>
                  </div>
                  <div className="font-bold text-white text-sm">{lockedDeal.winningBid.dealerName}</div>
                  <p className="text-ink-muted text-xs">
                    {lockedDeal.winningBid.dealerCity}, {lockedDeal.winningBid.dealerState} ({lockedDeal.winningBid.distanceMiles} miles from {user.zipCode})
                  </p>

                  {lockedDeal.winningBid.salesRep && (
                    <div className="pt-2 border-t border-border flex items-center justify-between">
                      <div>
                        <div className="font-bold text-white">{lockedDeal.winningBid.salesRep.name}</div>
                        <div className="text-[11px] text-ink-muted">{lockedDeal.winningBid.salesRep.title}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold text-emerald-400">{lockedDeal.winningBid.salesRep.phone}</div>
                        <span className="text-[10px] text-ink-faint">Direct Phone Line</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Pricing & Guarantee Card */}
                <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2 text-xs">
                  <span className="text-[10px] uppercase font-bold text-ink-faint">Final Locked Financials</span>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Agreed Out-The-Door:</span>
                    <span className="text-lg font-black text-white font-mono">
                      {formatCurrency(lockedDeal.winningBid.totalOtdPrice)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-emerald-400">
                    <span>MSRP Discount:</span>
                    <span className="font-mono font-bold">
                      -{formatCurrency(lockedDeal.winningBid.dealerDiscountDollars)} ({lockedDeal.winningBid.dealerDiscountPercent}%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-ink-muted">
                    <span>Dealer Accessories / Add-ons:</span>
                    <span className="font-mono font-bold text-emerald-400">$0 (Verified $0)</span>
                  </div>

                  <div className="pt-2 border-t border-border flex items-center gap-2 text-[11px] text-ink-muted">
                    <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>Protected by TrimScout $500 Price Protection Policy against dealer markup.</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: SAVED VEHICLES WATCHLIST */}
      {activeTab === "saved_cars" && (
        <div className="space-y-4">
          {savedVehicles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface p-12 text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-elevated text-ink-faint">
                <Heart className="h-7 w-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">No Saved Vehicles in Watchlist</h3>
                <p className="text-xs text-ink-muted max-w-md mx-auto">
                  Click the heart icon on any vehicle in Market Search to bookmark cars and request dealer bids whenever you are ready.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {savedVehicles.map((v) => (
                <div
                  key={v.id}
                  className="rounded-2xl border border-border bg-surface overflow-hidden shadow-lg hover:border-emerald-500/40 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="relative aspect-[16/10] overflow-hidden bg-surface-elevated">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={v.imageUrl}
                        alt={`${v.year} ${v.make} ${v.model}`}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <div className="absolute top-3 right-3">
                        <button
                          onClick={() => onRemoveSavedVehicle(v.id)}
                          className="rounded-full bg-black/60 p-2 text-rose-400 backdrop-blur-md hover:bg-black/90 transition-colors"
                          title="Remove from watchlist"
                        >
                          <Heart className="h-4 w-4 fill-rose-500 text-rose-500" />
                        </button>
                      </div>
                      <div className="absolute bottom-3 left-3">
                        <span className="rounded-md bg-black/80 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm border border-white/10">
                          {v.daysOnLot} Days On Lot
                        </span>
                      </div>
                    </div>

                    <div className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-bold text-white text-sm">
                            {v.year} {v.make} {v.model}
                          </h4>
                          <p className="text-xs text-ink-muted">{v.trim}</p>
                        </div>
                        <div className="text-right font-mono font-black text-white text-sm">
                          {formatCurrency(v.msrp)}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1 pt-1">
                        {v.packages.slice(0, 2).map((pkg) => (
                          <span
                            key={pkg}
                            className="rounded bg-surface-elevated px-2 py-0.5 text-[10px] font-medium text-ink-muted border border-border truncate"
                          >
                            {pkg}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="p-4 pt-0">
                    <button
                      onClick={() => onInspectSavedVehicle(v)}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-xs font-black text-black hover:bg-emerald-400 shadow-md shadow-emerald-500/20 transition-all active:scale-95"
                    >
                      <Zap className="h-3.5 w-3.5 fill-black" />
                      <span>Request Dealership Bids</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: DEAL HISTORY */}
      {activeTab === "history" && (
        <div className="rounded-2xl border border-border bg-surface p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-sm">Archived Purchase Contracts & Invoices</h3>
              <p className="text-xs text-ink-muted">Historical records of your past bids and locked certificates.</p>
            </div>
          </div>

          <div className="divide-y divide-border/60 text-xs">
            <div className="py-3 flex items-center justify-between text-ink-light">
              <div className="space-y-0.5">
                <div className="font-bold text-white">2026 BMW 330i M Sport (OTD-BMW-4921)</div>
                <div className="text-ink-muted text-[11px]">BMW of San Rafael • Locked on August 20, 2026</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold text-emerald-400">$53,623 OTD</span>
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                  Active
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
