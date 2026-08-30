"use client";

import React, { useState, useEffect } from "react";
import { BiddingRequest, DealerBid } from "../lib/types";
import { formatCurrency, formatPercent } from "../lib/otdCalculator";
import {
  Clock,
  ShieldCheck,
  Zap,
  Trophy,
  MessageSquare,
  FileText,
  Lock,
  Plus,
  Send,
  Camera,
  Eye,
  Image as ImageIcon
} from "lucide-react";

interface LiveDealRoomProps {
  request: BiddingRequest;
  bids: DealerBid[];
  onInspectFee: (bid: DealerBid) => void;
  onSimulateNewBid: () => void;
}

export const LiveDealRoom: React.FC<LiveDealRoomProps> = ({
  request,
  bids,
  onInspectFee,
  onSimulateNewBid,
}) => {
  const [sortBy, setSortBy] = useState<"discount" | "otd">("discount");
  const [isTradeInModalOpen, setIsTradeInModalOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState<{ hours: number; minutes: number; seconds: number }>({
    hours: 23,
    minutes: 58,
    seconds: 44,
  });

  const [chatMessages, setChatMessages] = useState<
    { sender: "buyer" | "dealer"; name: string; text: string; time: string }[]
  >([
    {
      sender: "dealer",
      name: "BMW of San Rafael (Sales Director)",
      text: "Hi Buyer #CA-4921, our 330i M Sport just came off the transport truck today. We unlocked our maximum 8.5% discount for you.",
      time: "5m ago",
    },
  ]);
  const [newMessage, setNewMessage] = useState("");

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev.seconds > 0) return { ...prev, seconds: prev.seconds - 1 };
        if (prev.minutes > 0) return { ...prev, minutes: 59, seconds: 59 };
        if (prev.hours > 0) return { hours: prev.hours - 1, minutes: 59, seconds: 59 };
        return prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    setChatMessages((prev) => [
      ...prev,
      {
        sender: "buyer",
        name: "You (Buyer #CA-4921)",
        text: newMessage,
        time: "Just now",
      },
    ]);
    setNewMessage("");

    setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        {
          sender: "dealer",
          name: "BMW of San Rafael (Sales Director)",
          text: "Confirmed! This unit has the factory Shadowline trim and 19-inch Style 791M wheels with Michelin Pilot Sport tires.",
          time: "Just now",
        },
      ]);
    }, 1500);
  };

  const sortedBids = [...bids].sort((a, b) => {
    if (sortBy === "discount") {
      return b.dealerDiscountPercent - a.dealerDiscountPercent;
    }
    return a.totalOtdPrice - b.totalOtdPrice;
  });

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
                Masked Alias: <strong className="text-white font-mono">Buyer #CA-4921</strong>
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Deal Room: 2026 {request.targetVehicle ? `${request.targetVehicle.make} ${request.targetVehicle.model}` : `${request.flexibleCriteria?.make} ${request.flexibleCriteria?.model}`}
            </h1>

            <p className="mt-1 text-xs text-ink-muted">
              Strategy: <strong className="text-emerald-400">{request.strategy === "flexible_discount" ? "Find your car based on Make and Model" : request.strategy === "exact_auction" ? "Find your car based on must have specs" : "Firm Target Offer"}</strong> • Payment: <span className="uppercase text-white font-semibold">{request.paymentMethod}</span> • Radius: <span className="text-white font-semibold">{request.searchRadiusMiles} Miles</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-black/60 px-4 py-2.5 shadow-inner">
              <Clock className="h-5 w-5 text-emerald-400" />
              <div>
                <span className="text-[10px] uppercase font-bold text-ink-faint">Time Remaining</span>
                <div className="font-mono text-lg font-bold text-white tracking-wider">
                  {String(timeLeft.hours).padStart(2, "0")}h : {String(timeLeft.minutes).padStart(2, "0")}m : {String(timeLeft.seconds).padStart(2, "0")}s
                </div>
              </div>
            </div>

            <button
              onClick={onSimulateNewBid}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-bold text-emerald-400 hover:bg-emerald-500 hover:text-black transition-all shadow-md active:scale-95"
            >
              <Plus className="h-4 w-4 stroke-[2.5]" />
              <span>Simulate New Dealer Bid</span>
            </button>
          </div>
        </div>
      </div>

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
                Mileage: <strong className="text-white font-mono">{request.tradeIn.mileage.toLocaleString()} mi</strong> • Condition: <strong className="text-white capitalize">{request.tradeIn.condition.replace("_", " ")}</strong> • Est. Market Value: <strong className="text-emerald-400 font-mono">$24,500 – $26,800</strong>
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

      {/* Main Grid: Leaderboard + Masked Chat */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left 2 Cols: Live Dealer Leaderboard */}
        <div className="lg:col-span-2 space-y-4">
          {/* Controls Bar */}
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
                onClick={() => setSortBy("otd")}
                className={`rounded-lg px-2.5 py-1 font-semibold transition-all ${
                  sortBy === "otd"
                    ? "bg-emerald-500 text-black shadow-sm"
                    : "border border-border bg-surface text-ink-muted hover:text-white"
                }`}
              >
                💲 Lowest Out-The-Door
              </button>
            </div>
          </div>

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
                            ({bid.dealerCity}, {bid.dealerState} • {bid.distanceMiles} mi)
                          </span>
                        </div>
                        <p className="text-xs text-ink-light font-medium">
                          {bid.matchedVehicleTitle} • <span className="font-mono text-[11px] text-ink-faint">VIN: {bid.matchedVin}</span>
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
                      <span className="text-[10px] uppercase font-bold text-ink-faint">Est. Tax & DMV</span>
                      <div className="font-semibold text-ink-muted font-mono text-sm">
                        +{formatCurrency(bid.salesTax + bid.dmvFees)}
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase font-bold text-emerald-400">Total OTD Price</span>
                      <div className="font-black text-white font-mono text-base">
                        {formatCurrency(bid.totalOtdPrice)}
                      </div>
                    </div>
                  </div>

                  {/* 3-Way Deal Structure Comparison Strip */}
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-[10px] uppercase font-bold text-emerald-400">
                      Multi-Structure Quote:
                    </span>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1">
                        <span className="text-ink-muted text-[11px]">💵 Cash:</span>
                        <span className="font-bold text-white font-mono">{formatCurrency(bid.totalOtdPrice)}</span>
                      </div>

                      <span className="text-border">|</span>

                      <div className="flex items-center gap-1">
                        <span className="text-ink-muted text-[11px]">🏦 Finance:</span>
                        <span className="font-bold text-emerald-400 font-mono">
                          ${bid.financeMonthlyEstimate || Math.round(bid.totalOtdPrice / 65)} / mo
                        </span>
                        <span className="text-[10px] text-ink-faint">(60 mo)</span>
                      </div>

                      <span className="text-border">|</span>

                      <div className="flex items-center gap-1">
                        <span className="text-ink-muted text-[11px]">🔑 Lease:</span>
                        <span className="font-bold text-purple-400 font-mono">
                          ${bid.leaseMonthlyEstimate || Math.round(bid.totalOtdPrice / 90)} / mo
                        </span>
                        <span className="text-[10px] text-ink-faint">(36 mo • 12k mi)</span>
                      </div>
                    </div>
                  </div>

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
        </div>

        {/* Right Col: Masked Dealer Q&A Relay */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-surface p-5 space-y-4 flex flex-col h-[560px]">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-emerald-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Masked Dealer Q&A Relay
                </h3>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                Anonymized
              </span>
            </div>

            <p className="text-[11px] text-ink-muted">
              Ask questions to sales managers without revealing your phone number or email.
            </p>

            {/* Chat Log */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-xl p-3 text-xs space-y-1 ${
                    msg.sender === "buyer"
                      ? "bg-emerald-500/10 border border-emerald-500/20 ml-4 text-emerald-100"
                      : "bg-surface-elevated border border-border mr-4 text-ink-light"
                  }`}
                >
                  <div className="flex justify-between text-[10px] font-semibold text-ink-faint">
                    <span>{msg.name}</span>
                    <span>{msg.time}</span>
                  </div>
                  <p className="leading-relaxed">{msg.text}</p>
                </div>
              ))}
            </div>

            {/* Message Input */}
            <form onSubmit={handleSendMessage} className="relative pt-2 border-t border-border">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Ask dealer about tire specs, arrival date, etc..."
                className="w-full rounded-xl border border-border bg-surface-elevated py-2.5 pl-3 pr-10 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-emerald-500 p-1.5 text-black hover:bg-emerald-400 transition-colors"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>

          {/* Safe Purchase Info Card */}
          <div className="rounded-2xl border border-border bg-surface-elevated p-4 flex items-start gap-3 text-xs">
            <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-white">Transparent Transaction Policy</h4>
              <p className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">
                Every dealer in the TrimScout network is certified. All doc fees are legally capped, and unwanted dealer add-ons are strictly forbidden.
              </p>
            </div>
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
                <strong className="text-blue-400">Transmitted to Dealers:</strong> Certified dealerships review these photos to formulate binding trade-in allowances on your leaderboard bids.
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
