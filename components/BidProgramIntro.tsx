"use client";

import React from "react";
import {
  Zap,
  ArrowRight,
  SlidersHorizontal,
  UserRound,
  FileText,
  Check,
  X,
} from "lucide-react";
import { MarketPulse } from "./MarketPulse";

interface BidProgramIntroProps {
  /** Opens Configure Quote Request; the placement names which button. */
  onStartWizard: (placement: "hero" | "intro_footer") => void;
  onViewDemoDealRoom: () => void;
}

const REASONS = [
  {
    icon: SlidersHorizontal,
    title: "Your terms",
    body: "Set your must-haves and budget. We match real, verified inventory to what matters to you — trim, packages and color, not just year and model.",
  },
  {
    icon: UserRound,
    title: "No broker cut",
    body: "Invite a few dealers directly. You deal with them, not through a middleman.",
  },
  {
    icon: FileText,
    title: "Quotes you can compare",
    body: "Get structured, itemized quotes with clear monthly payments and due-at-signing amounts, so every offer reads the same way.",
  },
];

const USUAL_WAY = [
  "Inquiry forms that trigger days of calls and texts",
  "Quotes that bury fees until you're at the desk",
  "Hard to tell if a car really has the options you want",
  "Every dealer's numbers laid out differently",
];

const WITH_TRIMSCOUT = [
  "One request, sent through TrimScout — replies come to you in one place",
  "Itemized quotes with payment and due-at-signing up front",
  "Factory build record read from the VIN, so the spec is real",
  "Quotes side by side, in the same format",
];

const STEPS = [
  {
    title: "Paste a link or VIN",
    body: "We pull the factory record for the exact car. You confirm the car and the store.",
  },
  {
    title: "Choose who to ask",
    body: "Send it to the dealer who has the car, or add a few more with a similar match.",
  },
  {
    title: "Compare real quotes",
    body: "Each dealer replies with their number, on their own time. Take the best one straight to the dealer if you like.",
  },
];

export const BidProgramIntro: React.FC<BidProgramIntroProps> = ({
  onStartWizard,
  onViewDemoDealRoom,
}) => {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8 space-y-20 animate-fadeIn">
      {/* HERO SECTION */}
      <div className="text-center space-y-6 max-w-3xl mx-auto pt-4">
        <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
          Paste Your Link. <br />
          <span className="bg-gradient-to-r from-brand-400 via-brand-200 to-brand-400 bg-clip-text text-transparent">
            No Calls. No Spam. Just Quotes.
          </span>
        </h1>

        <div className="flex flex-col items-center justify-center gap-4 pt-2">
          <button
            type="button"
            onClick={() => onStartWizard("hero")}
            data-testid="cta-request-quote-hero"
            className="flex items-center gap-2 rounded-xl bg-brand-500 px-8 py-3.5 font-extrabold text-sm text-black hover:bg-brand-400 transition-all shadow-xl shadow-brand-500/20 active:scale-95"
          >
            <Zap className="h-4 w-4 fill-black" />
            <span>Request a Quote</span>
            <ArrowRight className="h-4 w-4 stroke-[2.5]" />
          </button>
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-xs text-ink-faint">
            {["Free to request & compare", "Takes about 2 minutes", "Your number stays private"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-brand-400" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* WHY TRIMSCOUT */}
      <div className="space-y-8">
        <div className="text-center space-y-2">
          <p className="text-xs font-extrabold uppercase tracking-widest text-brand-400">Why TrimScout</p>
          <h2 className="text-2xl sm:text-3xl font-black text-white">
            Three reasons buyers use it instead of walking in
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {REASONS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-border bg-surface p-6">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700">
                <Icon className="h-7 w-7 text-brand-950" strokeWidth={1.9} />
              </div>
              <h3 className="mb-2 text-lg font-bold text-white">{title}</h3>
              <p className="text-sm text-ink-muted leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>

      <MarketPulse />

      {/* THE DIFFERENCE */}
      <div className="space-y-8">
        <div className="text-center space-y-2">
          <p className="text-xs font-extrabold uppercase tracking-widest text-brand-400">The difference</p>
          <h2 className="text-2xl sm:text-3xl font-black text-white">Stop negotiating on their turf</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
          <div className="rounded-2xl border border-border bg-surface p-7">
            <h3 className="mb-4 text-xs font-extrabold uppercase tracking-wider text-ink-faint">The usual way</h3>
            <ul className="space-y-3 text-sm text-ink-muted">
              {USUAL_WAY.map((t) => (
                <li key={t} className="flex gap-3">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border-2 border-brand-500 bg-gradient-to-b from-brand-500/10 to-surface p-7">
            <h3 className="mb-4 text-xs font-extrabold uppercase tracking-wider text-brand-400">With TrimScout</h3>
            <ul className="space-y-3 text-sm text-ink-light">
              {WITH_TRIMSCOUT.map((t) => (
                <li key={t} className="flex gap-3">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div className="space-y-8">
        <div className="text-center space-y-2">
          <p className="text-xs font-extrabold uppercase tracking-widest text-brand-400">How it works</p>
          <h2 className="text-2xl sm:text-3xl font-black text-white">From link to quote in three steps</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {STEPS.map((s, i) => (
            <div key={s.title} className="px-2">
              <div className="text-4xl font-black leading-none text-border-strong">{i + 1}</div>
              <h3 className="mt-2 mb-1.5 text-lg font-bold text-white">{s.title}</h3>
              <p className="text-sm text-ink-muted leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
        <p className="max-w-3xl mx-auto text-center text-xs text-ink-faint leading-relaxed">
          <strong className="text-ink-muted">Honest about where we are:</strong> our inventory is a curated,
          hand-verified set of listings, not the whole market yet. We expand make by make and never show a match we
          haven&apos;t checked.
        </p>
      </div>

      {/* FINAL CTA */}
      <div className="rounded-3xl border border-brand-500/40 bg-gradient-to-r from-surface via-surface-elevated to-surface p-10 text-center space-y-5">
        <div className="max-w-xl mx-auto space-y-2">
          <h2 className="text-2xl sm:text-3xl font-black text-white">
            Know the real price before you set foot in a dealership
          </h2>
          <p className="text-sm text-ink-muted">
            Paste a VIN or dealer link. About 2 minutes, and your quote request is moving today.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onStartWizard("intro_footer")}
          data-testid="cta-request-quote-intro-footer"
          className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-8 py-3.5 font-extrabold text-sm text-black hover:bg-brand-400 transition-all shadow-xl shadow-brand-500/20 active:scale-95"
        >
          <Zap className="h-4 w-4 fill-black" />
          <span>Request a Quote</span>
          <ArrowRight className="h-4 w-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
