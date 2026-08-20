"use client";

import React from "react";
import { Compass, ShieldCheck, Zap, Search, Layers, Building2 } from "lucide-react";

interface NavbarProps {
  onOpenBidProgram: () => void;
  activeDealCount: number;
  currentView: "search" | "bid_program" | "deal_room" | "dealer_portal";
  onToggleView: (view: "search" | "bid_program" | "deal_room" | "dealer_portal") => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenBidProgram,
  activeDealCount,
  currentView,
  onToggleView,
}) => {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Logo */}
        <div className="flex items-center gap-3 cursor-pointer select-none" onClick={() => onToggleView("search")}>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-black shadow-lg shadow-emerald-500/20">
            <Compass className="h-6 w-6 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-xl tracking-tight text-white">Trim</span>
              <span className="font-extrabold text-xl tracking-tight text-emerald-400">Scout</span>
              <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                MARKET
              </span>
            </div>
            <p className="text-[11px] text-ink-muted -mt-0.5">Option-Level Search & Deal Bidding</p>
          </div>
        </div>

        {/* Center Live Market Ticker */}
        <div className="hidden xl:flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs text-ink-muted shadow-inner">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
          <span className="font-medium text-ink-light">Live Inventory:</span>
          <span>1,248,390 Units Synced</span>
          <span className="text-border">•</span>
          <span className="flex items-center gap-1 text-emerald-400 font-medium">
            <ShieldCheck className="h-3.5 w-3.5" /> $0 Dealership Visit Guarantee
          </span>
        </div>

        {/* Navigation Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex rounded-lg border border-border bg-surface p-1 text-xs">
            <button
              onClick={() => onToggleView("search")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
                currentView === "search"
                  ? "bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30"
                  : "text-ink-muted hover:text-white"
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Search Market</span>
              <span className="sm:hidden">Search</span>
            </button>

            <button
              onClick={() => onToggleView("deal_room")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
                currentView === "deal_room"
                  ? "bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30"
                  : "text-ink-muted hover:text-white"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Deal Room</span>
              {activeDealCount > 0 && (
                <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-black">
                  {activeDealCount}
                </span>
              )}
            </button>

            <button
              onClick={() => onToggleView("dealer_portal")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all ${
                currentView === "dealer_portal"
                  ? "bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30"
                  : "text-ink-muted hover:text-white"
              }`}
            >
              <Building2 className="h-3.5 w-3.5 text-blue-400" />
              <span className="hidden md:inline">Dealer Portal</span>
              <span className="md:hidden">Dealer</span>
            </button>
          </div>

          {/* Primary CTA */}
          <button
            onClick={() => onToggleView("bid_program")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-extrabold transition-all shadow-md active:scale-95 ${
              currentView === "bid_program"
                ? "bg-emerald-400 text-black ring-2 ring-emerald-500/50 shadow-emerald-500/30"
                : "bg-emerald-500 text-black hover:bg-emerald-400 shadow-emerald-500/20"
            }`}
          >
            <Zap className="h-4 w-4 fill-black" />
            <span className="hidden sm:inline">Bid Out a Deal</span>
            <span className="sm:hidden">Bid</span>
          </button>
        </div>
      </div>
    </header>
  );
};
