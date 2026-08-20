"use client";

import React, { useState } from "react";
import { Compass, Zap, Search, Layers, Building2, Menu, X } from "lucide-react";

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navLinks: {
    id: "search" | "bid_program" | "deal_room" | "dealer_portal";
    label: string;
    icon?: React.ReactNode;
    badge?: number;
  }[] = [
    { id: "search", label: "Search Market" },
    { id: "bid_program", label: "How Bidding Works" },
    { id: "deal_room", label: "Live Deal Room", badge: activeDealCount },
    { id: "dealer_portal", label: "Dealer Portal" },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/80 bg-background/80 backdrop-blur-xl transition-all">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Logo */}
        <div
          className="flex items-center gap-2.5 cursor-pointer select-none group"
          onClick={() => onToggleView("search")}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-black shadow-sm group-hover:scale-105 transition-transform">
            <Compass className="h-4.5 w-4.5 stroke-[2.5]" />
          </div>
          <span className="font-extrabold text-lg tracking-tight text-white flex items-center">
            Trim<span className="text-emerald-400">Scout</span>
          </span>
        </div>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive = currentView === link.id;
            return (
              <button
                key={link.id}
                onClick={() => onToggleView(link.id)}
                className={`relative px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? "text-emerald-400 bg-emerald-500/10 font-bold"
                    : "text-ink-muted hover:text-white hover:bg-surface-elevated"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {link.label}
                  {typeof link.badge === "number" && link.badge > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-black text-black">
                      {link.badge}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Right Action */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => onToggleView("bid_program")}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-sm active:scale-95"
          >
            <Zap className="h-3.5 w-3.5 fill-black" />
            <span>Bid Out a Deal</span>
          </button>

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden rounded-lg p-1.5 text-ink-muted hover:bg-surface-elevated hover:text-white transition-colors"
            aria-label="Toggle Menu"
          >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-surface-elevated/95 backdrop-blur-xl px-4 py-3 space-y-1 animate-fadeIn">
          {navLinks.map((link) => {
            const isActive = currentView === link.id;
            return (
              <button
                key={link.id}
                onClick={() => {
                  onToggleView(link.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-400 font-bold"
                    : "text-ink-muted hover:text-white hover:bg-surface"
                }`}
              >
                <span>{link.label}</span>
                {typeof link.badge === "number" && link.badge > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-black text-black">
                    {link.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
};
