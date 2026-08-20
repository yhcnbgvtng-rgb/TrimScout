"use client";

import React from "react";
import {
  ShieldCheck,
  Zap,
  Home,
  CheckCircle2,
  XCircle,
  Percent,
  RefreshCw,
  DollarSign,
  ArrowRight,
  Sparkles,
  Truck,
  PhoneOff
} from "lucide-react";

interface BidProgramIntroProps {
  onStartWizard: () => void;
  onViewDemoDealRoom: () => void;
}

export const BidProgramIntro: React.FC<BidProgramIntroProps> = ({
  onStartWizard,
  onViewDemoDealRoom,
}) => {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8 space-y-16 animate-fadeIn">
      {/* HERO SECTION */}
      <div className="text-center space-y-6 max-w-3xl mx-auto pt-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-4 py-1.5 text-xs font-bold text-emerald-400 shadow-sm">
          <Sparkles className="h-3.5 w-3.5" />
          <span>The TrimScout Reverse Bidding Program</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
          Never Step Foot in a Dealership Again. <br />
          <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
            Buy Your Next Car 100% on Your Terms.
          </span>
        </h1>

        <p className="text-sm sm:text-base text-ink-muted leading-relaxed max-w-2xl mx-auto font-normal">
          Stop spending entire weekends getting haggled in dealership back rooms. Set your exact vehicle spec, watch certified dealerships compete with transparent Out-The-Door bids, and finalize delivery straight from your couch.
        </p>

        {/* Hero CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            onClick={onStartWizard}
            className="flex items-center gap-2 rounded-xl bg-emerald-500 px-7 py-3.5 font-extrabold text-sm text-black hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 active:scale-95"
          >
            <Zap className="h-4 w-4 fill-black" />
            <span>Start Your Deal Hunt</span>
            <ArrowRight className="h-4 w-4 stroke-[2.5]" />
          </button>

          <button
            onClick={onViewDemoDealRoom}
            className="flex items-center gap-2 rounded-xl border border-border bg-surface px-6 py-3.5 font-bold text-sm text-ink-light hover:border-border-strong hover:text-white transition-all"
          >
            <span>See Live Deal Room Demo</span>
          </button>
        </div>
      </div>

      {/* 3 CORE PILLARS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-surface p-6 space-y-3 hover:border-border-strong transition-all">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
            <Home className="h-6 w-6 stroke-[2]" />
          </div>
          <h3 className="text-lg font-bold text-white">100% From Home & Driveway Delivery</h3>
          <p className="text-xs text-ink-muted leading-relaxed">
            Never sit at a dealer desk waiting for a finance manager. Lock your deal online, complete paperwork digitally, and have your car delivered directly to your driveway or ready for express 10-minute pickup.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 space-y-3 hover:border-border-strong transition-all">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
            <PhoneOff className="h-6 w-6 stroke-[2]" />
          </div>
          <h3 className="text-lg font-bold text-white">Zero Sales Calls or Email Spam</h3>
          <p className="text-xs text-ink-muted leading-relaxed">
            We assign you a masked identity (e.g. Buyer #CA-4921). Dealerships never see your phone number or real email address. Communications happen through our secure anonymized relay.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 space-y-3 hover:border-border-strong transition-all">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
            <Truck className="h-6 w-6 stroke-[2]" />
          </div>
          <h3 className="text-lg font-bold text-white">Dealers Compete for You</h3>
          <p className="text-xs text-ink-muted leading-relaxed">
            Instead of you contacting dealerships individually, certified dealerships in your area receive your deal request and compete against each other to offer the lowest price or highest discount.
          </p>
        </div>
      </div>

      {/* COMPARISON TABLE */}
      <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-xl sm:text-2xl font-black text-white">The Old Way vs. The TrimScout Way</h2>
          <p className="text-xs text-ink-muted">Why thousands of car buyers will never walk into a showroom to negotiate again.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="rounded-xl border border-red-500/20 bg-red-950/10 p-5 space-y-3">
            <div className="flex items-center gap-2 text-red-400 font-bold text-sm uppercase tracking-wide">
              <XCircle className="h-4 w-4" /> The Traditional Way
            </div>
            <ul className="space-y-2.5 text-xs text-ink-muted">
              <li className="flex items-start gap-2">
                <span className="text-red-400 font-bold">✕</span>
                <span>Spend 4–8 hours sitting in a showroom negotiating back and forth.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 font-bold">✕</span>
                <span>Phone gets spammed with 20+ calls from aggressive sales reps.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 font-bold">✕</span>
                <span>Surprise $1,500+ dealer prep, tint, or GPS add-ons added at signing.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 font-bold">✕</span>
                <span>No idea if you got the best price in the market.</span>
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5 space-y-3">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm uppercase tracking-wide">
              <CheckCircle2 className="h-4 w-4" /> The TrimScout Way
            </div>
            <ul className="space-y-2.5 text-xs text-ink-light">
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>5 minutes from home:</strong> Configure your deal on your phone or laptop.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>100% Privacy Shield:</strong> Masked identity prevents all phone calls & spam.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>Legally Protected OTD Vouchers:</strong> Guaranteed $0 hidden dealer fees.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>Dealers compete:</strong> Live leaderboard ensures you get the absolute best price.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* 3 STRATEGIES */}
      <div className="space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-xl sm:text-2xl font-black text-white">Choose Your Bidding Strategy</h2>
          <p className="text-xs text-ink-muted">Three flexible ways to get dealers competing for your business.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border-2 border-emerald-500 bg-surface p-5 space-y-3 relative overflow-hidden">
            <div className="rounded bg-emerald-500 text-black px-2 py-0.5 text-[10px] font-black uppercase tracking-wider w-fit">
              ULTIMATE FLEXIBILITY
            </div>
            <div className="flex items-center gap-2 font-extrabold text-white text-base">
              <Percent className="h-5 w-5 text-emerald-400" />
              <h3>Ultimate Flexibility</h3>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              If you&apos;re not picky about the spec, let TrimScout help source a great deal among dealers in your area.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
            <div className="rounded bg-blue-500/20 text-blue-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider w-fit border border-blue-500/30">
              EXACT BUILD
            </div>
            <div className="flex items-center gap-2 font-extrabold text-white text-base">
              <RefreshCw className="h-5 w-5 text-blue-400" />
              <h3>Find your car based on must have specs</h3>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              Have non-negotiable options or targeting a specific build? Dealers battle with their lowest total Out-The-Door price over a 48-hour window.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
            <div className="rounded bg-amber-500/20 text-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider w-fit border border-amber-500/30">
              INSTANT BUY
            </div>
            <div className="flex items-center gap-2 font-extrabold text-white text-base">
              <DollarSign className="h-5 w-5 text-amber-400" />
              <h3>Firm Target Offer</h3>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              Have a firm budget? Submit your target price (e.g. <i>$48,500 OTD</i>). The first dealer to accept wins your business immediately.
            </p>
          </div>
        </div>
      </div>

      {/* FINAL LAUNCHPAD */}
      <div className="rounded-3xl border border-emerald-500/40 bg-gradient-to-r from-surface via-surface-elevated to-surface p-8 text-center space-y-5 shadow-2xl relative overflow-hidden">
        <div className="max-w-xl mx-auto space-y-2">
          <h2 className="text-2xl sm:text-3xl font-black text-white">Ready to Buy on Your Terms?</h2>
          <p className="text-xs sm:text-sm text-ink-muted">
            It takes less than 2 minutes to broadcast your spec. Dealers will submit binding bids within 24 hours.
          </p>
        </div>

        <button
          onClick={onStartWizard}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-8 py-3.5 font-extrabold text-sm text-black hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 active:scale-95"
        >
          <Zap className="h-4 w-4 fill-black" />
          <span>Launch Your Deal Hunt Now</span>
          <ArrowRight className="h-4 w-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
