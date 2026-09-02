"use client";

import React from "react";
import {
  ShieldCheck,
  Zap,
  House as Home,
  CircleCheck as CheckCircle2,
  Handshake,
  ArrowRight,
  Truck,
  PhoneOff,
  Clock
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
        <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
          Never Step Foot in a Dealership Again. <br />
          <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
            Buy Your Next Car 100% on Your Terms.
          </span>
        </h1>

        <p className="text-sm sm:text-base text-ink-muted leading-relaxed max-w-2xl mx-auto font-normal">
          Skip the pressure room and get the real price. Send your offer straight to the dealer who has the car, get a transparent Out-The-Door response, and let us check the paperwork before you sign.
        </p>

        {/* Hero CTA */}
        <div className="flex items-center justify-center pt-2">
          <button
            onClick={onStartWizard}
            className="flex items-center gap-2 rounded-xl bg-emerald-500 px-8 py-3.5 font-extrabold text-sm text-black hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 active:scale-95"
          >
            <Zap className="h-4 w-4 fill-black" />
            <span>Structure Your Deal Now</span>
            <ArrowRight className="h-4 w-4 stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* PRODUCT PILLARS */}
      <div className="space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-xl sm:text-2xl font-black text-white">How TrimScout Works For You</h2>
          <p className="text-xs text-ink-muted">Free to start. You only ever pay for what you actually use.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border-2 border-emerald-500 bg-surface p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                <Zap className="h-6 w-6 stroke-[2]" />
              </div>
              <span className="rounded bg-emerald-500 text-black px-2 py-0.5 text-[10px] font-black uppercase tracking-wider">
                Flagship
              </span>
            </div>
            <h3 className="text-lg font-bold text-white">Dealers Respond With Real Offers</h3>
            <p className="text-xs text-ink-muted leading-relaxed">
              Send your offer once. The dealer responds directly with transparent Out-The-Door pricing — no dealership visits, no sales calls. This is what the rest of this page walks through.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-6 space-y-3 opacity-90">
            <div className="flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
                <ShieldCheck className="h-6 w-6 stroke-[2]" />
              </div>
              <span className="flex items-center gap-1 rounded bg-amber-500/20 text-amber-400 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider border border-amber-500/30">
                <Clock className="h-2.5 w-2.5" />
                Coming Soon
              </span>
            </div>
            <h3 className="text-lg font-bold text-white">We Check the Paperwork</h3>
            <p className="text-xs text-ink-muted leading-relaxed">
              Before you sign, we review your deal sheet for padded fees, bad financing terms, and other common dealer tricks — so nothing catches you off guard at the last minute.
            </p>
          </div>
        </div>
      </div>

      {/* WHAT YOU GET FROM NEGOTIATE */}
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
            We assign you a masked identity (e.g. Buyer #CA-4921). Dealerships never see your phone number, real email, or who you are — just your spec. So the price you're offered depends on the car you want, not on who's asking.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 space-y-3 hover:border-border-strong transition-all">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
            <Truck className="h-6 w-6 stroke-[2]" />
          </div>
          <h3 className="text-lg font-bold text-white">Dealers Respond to You</h3>
          <p className="text-xs text-ink-muted leading-relaxed">
            Instead of you calling dealerships one by one, your offer goes straight to the dealer with your car — or, if you'd rather widen the field, to others nearby too.
          </p>
        </div>
      </div>

      {/* 2 PATHS */}
      <div className="space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-xl sm:text-2xl font-black text-white">Two Ways to Send Your Offer</h2>
          <p className="text-xs text-ink-muted">You&apos;ve found the car. Choose how you want to make your move.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border-2 border-emerald-500 bg-surface p-5 space-y-3 relative overflow-hidden">
            <div className="rounded bg-emerald-500 text-black px-2 py-0.5 text-[10px] font-black uppercase tracking-wider w-fit">
              STRAIGHT TO THE DEALER
            </div>
            <div className="flex items-center gap-2 font-extrabold text-white text-base">
              <Handshake className="h-5 w-5 text-emerald-400" />
              <h3>Offer This Dealer Directly</h3>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              Send your Out-The-Door offer straight to the dealer who has the car — no competing bids, just a real number for them to accept.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
            <div className="rounded bg-blue-500/20 text-blue-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider w-fit border border-blue-500/30">
              WIDEN THE FIELD
            </div>
            <div className="flex items-center gap-2 font-extrabold text-white text-base">
              <Zap className="h-5 w-5 text-blue-400" />
              <h3>Get Prices From Other Dealers</h3>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              Want more than one number to compare? Let other dealers respond with their best price on the same car too.
            </p>
          </div>
        </div>
      </div>

      {/* PRICING TRANSPARENCY */}
      <div className="space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-xl sm:text-2xl font-black text-white">Simple, Honest Pricing</h2>
          <p className="text-xs text-ink-muted">No hidden fees. No percentage cut of your savings. Ever.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border-2 border-emerald-500 bg-surface p-5 space-y-2">
            <div className="flex items-center gap-2 text-sm font-extrabold text-white">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Negotiate</span>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">A flat fee, only if you lock in a deal — never a percentage of your savings.</p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-5 space-y-2 opacity-90">
            <div className="flex items-center gap-2 text-sm font-extrabold text-white">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Verify</span>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">A small flat fee, paid only when you use it. Coming soon.</p>
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
          <span>Structure Your Deal Now</span>
          <ArrowRight className="h-4 w-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
