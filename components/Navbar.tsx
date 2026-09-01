"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { UserProfile } from "../lib/types";
import {
  Compass,
  Zap,
  Menu,
  X,
  User,
  LogIn,
  LogOut,
  ShieldCheck,
  Building2,
  ChevronDown,
  Lock,
  Layers,
  UserPlus,
  ShieldAlert,
  Presentation
} from "lucide-react";

interface NavbarProps {
  user: UserProfile | null;
  activeDealCount: number;
  currentView: "bid_program" | "deal_room" | "dealer_portal" | "dealer_analytics" | "track_deals" | "signup" | "admin";
  onToggleView: (view: "bid_program" | "deal_room" | "dealer_portal" | "dealer_analytics" | "track_deals" | "signup" | "admin") => void;
  onOpenAuthModal: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  activeDealCount,
  currentView,
  onToggleView,
  onOpenAuthModal,
  onLogout,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const navLinks: {
    id: "dealer_analytics" | "bid_program";
    label: string;
    badge?: string | number;
  }[] = [
    { id: "dealer_analytics", label: "AI Sales Analytics" },
    { id: "bid_program", label: "How It Works" },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/80 bg-background/80 backdrop-blur-xl transition-all">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Logo */}
        <div
          className="flex items-center gap-2.5 cursor-pointer select-none group"
          onClick={() => onToggleView("bid_program")}
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

        {/* Right Actions: User Profile / Login Button + Bid Out CTA */}
        <div className="flex items-center gap-2.5">
          {/* User Profile Pill / Login Trigger */}
          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-2 rounded-xl border border-border bg-surface-elevated py-1.5 pl-2 pr-3 text-xs font-bold text-white hover:border-emerald-500/50 hover:bg-surface transition-all shadow-sm"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={user.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80"}
                  alt={user.name}
                  className="h-6 w-6 rounded-lg object-cover border border-emerald-500/40"
                />
                <span className="hidden sm:inline max-w-[100px] truncate">{user.name}</span>
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[9px] font-extrabold text-emerald-400 uppercase hidden md:inline">
                  {user.role === "buyer" ? "Buyer" : "Dealer"}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-ink-faint" />
              </button>

              {/* Profile Dropdown Menu */}
              {isUserMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-border-strong bg-surface shadow-2xl p-2 z-50 text-xs space-y-1 animate-fadeIn">
                  <div className="px-3 py-2 border-b border-border/80 space-y-0.5">
                    <div className="font-bold text-white truncate">{user.name}</div>
                    <div className="text-[11px] text-ink-muted truncate">{user.email}</div>
                    {user.buyerAlias && (
                      <div className="text-[10px] text-emerald-400 font-mono pt-0.5">
                        {user.buyerAlias}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      onToggleView("track_deals");
                      setIsUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-ink-light hover:bg-emerald-500/10 hover:text-emerald-400 font-medium transition-colors text-left"
                  >
                    <Layers className="h-4 w-4" />
                    <span className="flex-1">My Deal Tracker</span>
                    {activeDealCount > 0 && (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-black text-black">
                        {activeDealCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      onToggleView("deal_room");
                      setIsUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-ink-light hover:bg-emerald-500/10 hover:text-emerald-400 font-medium transition-colors text-left"
                  >
                    <Presentation className="h-4 w-4" />
                    <span>Live Deal Room</span>
                  </button>

                  <button
                    onClick={() => {
                      onOpenAuthModal();
                      setIsUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-ink-light hover:bg-surface-elevated font-medium transition-colors text-left"
                  >
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <span>Switch Test Account</span>
                  </button>

                  <button
                    onClick={() => {
                      onToggleView("admin");
                      setIsUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-rose-300 hover:bg-rose-950/40 hover:text-rose-200 font-medium transition-colors text-left"
                  >
                    <ShieldAlert className="h-4 w-4 text-rose-400" />
                    <span>Admin Portal</span>
                  </button>

                  <div className="pt-1 border-t border-border">
                    <button
                      onClick={() => {
                        onLogout();
                        setIsUserMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-rose-400 hover:bg-rose-500/10 font-medium transition-colors text-left"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={onOpenAuthModal}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white hover:border-emerald-500/50 hover:bg-surface transition-all shadow-sm"
              >
                <LogIn className="h-3.5 w-3.5 text-emerald-400" />
                <span>Log In</span>
              </button>

              <Link
                href="/signup"
                className="hidden sm:flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-950/40 hover:bg-emerald-900/50 px-3 py-1.5 text-xs font-extrabold text-emerald-400 hover:text-emerald-300 transition-all shadow-sm"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Sign Up</span>
              </Link>
            </div>
          )}

          {/* Primary CTA */}
          <button
            onClick={() => onToggleView("bid_program")}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-1.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-sm active:scale-95"
          >
            <Zap className="h-3.5 w-3.5 fill-black" />
            <span className="hidden sm:inline">Bid Out a Deal</span>
            <span className="sm:hidden">Bid</span>
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

          {!user && (
            <div className="pt-2 border-t border-border flex items-center gap-2">
              <Link
                href="/signup"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2 text-xs font-extrabold text-black"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Create Free Account / Sign Up</span>
              </Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
};
