"use client";

import React from "react";
import {
  ShieldCheck,
  Zap,
  ListChecks,
  CircleCheck as CheckCircle2,
  Handshake,
  ArrowRight,
  Search,
  SendHorizontal,
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
          Paste Your VIN. <br />
          <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
            No Calls. No Spam. Just Quotes.
          </span>
        </h1>

        <p className="text-sm sm:text-base text-ink-muted leading-relaxed max-w-2xl mx-auto font-normal">
          Paste a VIN or dealer link. We&apos;ll pull the factory record for the VIN, you confirm the car and the store,
          and we send your quote request to the dealer through TrimScout.
        </p>

        {/* Hero CTA */}
        <div className="flex flex-col items-center justify-center gap-3 pt-2">
          <button
            onClick={onStartWizard}
            className="flex items-center gap-2 rounded-xl bg-emerald-500 px-8 py-3.5 font-extrabold text-sm text-black hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 active:scale-95"
          >
            <Zap className="h-4 w-4 fill-black" />
            <span>Request a Quote</span>
            <ArrowRight className="h-4 w-4 stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div className="space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-xl sm:text-2xl font-black text-white">How It Works</h2>
          <p className="text-xs text-ink-muted">Three steps. No dealership visit required to get started.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border-2 border-emerald-500 bg-surface p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 font-black text-sm">
                1
              </div>
              <ListChecks className="h-5 w-5 text-emerald-400" />
            </div>
            <h3 className="text-lg font-bold text-white">Tell Us Your Must-Haves</h3>
            <p className="text-xs text-ink-muted leading-relaxed">
              Trim, factory packages, color — the options you won&apos;t compromise on. Not just year, make, and
              model.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 font-black text-sm">
                2
              </div>
              <Search className="h-5 w-5 text-ink-muted" />
            </div>
            <h3 className="text-lg font-bold text-white">See an Honest Shortlist</h3>
            <p className="text-xs text-ink-muted leading-relaxed">
              We match your must-haves against our verified inventory. If it&apos;s not a real, checked match, it
              doesn&apos;t make your list.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 font-black text-sm">
                3
              </div>
              <SendHorizontal className="h-5 w-5 text-ink-muted" />
            </div>
            <h3 className="text-lg font-bold text-white">Request a Quote</h3>
            <p className="text-xs text-ink-muted leading-relaxed">
              Send your spec to the dealer who has the car. It&apos;s a real quote request — the dealer replies
              with their number, on their own time.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface-elevated p-5 flex items-start gap-3 max-w-3xl mx-auto">
          <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-xs text-ink-muted leading-relaxed">
            <strong className="text-ink-light">Our inventory right now is a curated, hand-verified set of
            listings</strong> — not the whole market yet. We&apos;re expanding coverage make by make, and we&apos;ll
            never show you a &quot;match&quot; we haven&apos;t actually checked the options on.
          </p>
        </div>
      </div>

      {/* OFFER / MODES */}
      <div className="space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-xl sm:text-2xl font-black text-white">How Your Quote Request Works</h2>
          <p className="text-xs text-ink-muted">
            You&apos;ve found the car. Choose where your request goes.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border-2 border-emerald-500 bg-surface p-5 space-y-3 relative overflow-hidden">
            <div className="rounded bg-emerald-500 text-black px-2 py-0.5 text-[10px] font-black uppercase tracking-wider w-fit">
              ONE DEALER
            </div>
            <div className="flex items-center gap-2 font-extrabold text-white text-base">
              <Handshake className="h-5 w-5 text-emerald-400" />
              <h3>Request From This Dealer</h3>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              Send your spec straight to the dealer who has the exact car you matched with. They follow up with a
              quote directly.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
            <div className="rounded bg-blue-500/20 text-blue-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider w-fit border border-blue-500/30">
              A FEW MORE
            </div>
            <div className="flex items-center gap-2 font-extrabold text-white text-base">
              <Zap className="h-5 w-5 text-blue-400" />
              <h3>Request From a Few More</h3>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              Send the same request to other dealers with a similar match, and compare what comes back. Each
              dealer quotes you separately, on their own timeline — not a live auction.
            </p>
          </div>
        </div>
      </div>

      {/* PRICING */}
      <div className="space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-xl sm:text-2xl font-black text-white">Simple, Honest Pricing</h2>
          <p className="text-xs text-ink-muted">No hidden fees. No percentage cut of your savings.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl mx-auto">
          <div className="rounded-2xl border-2 border-emerald-500 bg-surface p-5 space-y-2 text-center">
            <div className="flex items-center justify-center gap-2 text-sm font-extrabold text-white">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Requesting and comparing quotes is free.</span>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              No cost to identify the car, send the request, or see every quote that comes back. Take the best one
              straight to the dealer if you like — nothing owed to us.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-5 space-y-2 text-center">
            <div className="flex items-center justify-center gap-2 text-sm font-extrabold text-white">
              <span>Deal Certificate — $299, optional</span>
            </div>
            <p className="text-xs text-ink-muted leading-relaxed">
              If you pick a quote through TrimScout, a flat fee holds the dealer to that out-the-door price and
              unlocks your voucher, paperwork verification, and trade-in appraisal. Shown before you pay, never
              a percentage of your savings.
            </p>
          </div>
        </div>
      </div>

      {/* COMING NEXT */}
      <div className="rounded-2xl border border-border bg-surface-elevated p-6 space-y-4 max-w-3xl mx-auto">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-black uppercase tracking-wider text-amber-400">Coming Next</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-ink-muted leading-relaxed">
          <div className="space-y-1">
            <div className="font-bold text-ink-light">Multiple dealers, one live comparison</div>
            <p>
              Today, dealers you request from quote you back on their own time. Next, we&apos;re building a way to
              see multiple real quotes on the same request side by side as they come in.
            </p>
          </div>
          <div className="space-y-1">
            <div className="font-bold text-ink-light">Paperwork verification</div>
            <p>
              Once you&apos;re ready to sign, we want to check your contract against the quote you were given —
              flagging padded fees or terms that don&apos;t match. Not live yet.
            </p>
          </div>
        </div>
      </div>

      {/* FINAL LAUNCHPAD */}
      <div className="rounded-3xl border border-emerald-500/40 bg-gradient-to-r from-surface via-surface-elevated to-surface p-8 text-center space-y-5 shadow-2xl relative overflow-hidden">
        <div className="max-w-xl mx-auto space-y-2">
          <h2 className="text-2xl sm:text-3xl font-black text-white">Ready to Get a Real Quote?</h2>
          <p className="text-xs sm:text-sm text-ink-muted">
            Paste a VIN or dealer link — takes about 2 minutes. We&apos;ll read the real build and get your quote
            request moving today.
          </p>
        </div>

        <button
          onClick={onStartWizard}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-8 py-3.5 font-extrabold text-sm text-black hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 active:scale-95"
        >
          <Zap className="h-4 w-4 fill-black" />
          <span>Request a Quote</span>
          <ArrowRight className="h-4 w-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
