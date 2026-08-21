"use client";

import React, { useState, useEffect } from "react";
import {
  Presentation,
  ChevronLeft,
  ChevronRight,
  Download,
  Shield,
  TrendingUp,
  DollarSign,
  Users,
  Building2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Maximize2,
  FileText,
  Sparkles,
  Zap,
} from "lucide-react";

interface PitchDeckViewProps {
  onClose?: () => void;
}

export const PitchDeckView: React.FC<PitchDeckViewProps> = ({ onClose }) => {
  const [currentSlide, setCurrentSlide] = useState(0);

  const totalSlides = 9;

  const handlePrev = () => {
    setCurrentSlide((prev) => (prev > 0 ? prev - 1 : totalSlides - 1));
  };

  const handleNext = () => {
    setCurrentSlide((prev) => (prev < totalSlides - 1 ? prev + 1 : 0));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Space") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const slideTitles = [
    "1. Executive Overview",
    "2. The Problem",
    "3. The TrimScout Solution",
    "4. Market Sizing (TAM/SAM/SOM)",
    "5. Business & Revenue Model",
    "6. Competitive Matrix",
    "7. Financial Projections",
    "8. Seed Ask & Milestones",
    "9. Strategic Conclusion",
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 space-y-6 animate-fadeIn">
      {/* Top Deck Control Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-3xl border border-border-strong bg-surface p-6 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-inner">
            <Presentation className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-white tracking-tight">TrimScout Business Case & Pitch Deck</h1>
              <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[9.5px] font-black text-emerald-400 uppercase">
                16:9 Presentation
              </span>
            </div>
            <p className="text-xs text-ink-muted">
              Slide {currentSlide + 1} of {totalSlides} • Use Arrow Keys or Controls to Navigate
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {/* Download PowerPoint File Button */}
          <a
            href="/TrimScout_Business_Case_Pitch_Deck.pptx"
            download="TrimScout_Business_Case_Pitch_Deck.pptx"
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20 transition-all cursor-pointer"
          >
            <Download className="h-4 w-4" />
            <span>Download .PPTX File</span>
          </a>

          {onClose && (
            <button
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3.5 py-2 text-xs font-bold text-ink-light hover:text-white transition-all shadow-sm"
            >
              <span>Back to App</span>
            </button>
          )}
        </div>
      </div>

      {/* Main 16:9 Slide Canvas Container */}
      <div className="relative aspect-[16/9] w-full rounded-3xl border border-border-strong bg-slate-950 p-6 sm:p-12 shadow-2xl overflow-hidden flex flex-col justify-between select-none">
        {/* Subtle accent background grid */}
        <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:24px_24px] opacity-10 pointer-events-none" />

        {/* ---------------------------------------------------- */}
        {/* SLIDE 1: COVER */}
        {/* ---------------------------------------------------- */}
        {currentSlide === 0 && (
          <div className="h-full flex flex-col justify-between animate-fadeIn z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-950/50 px-3.5 py-1 text-xs font-extrabold text-emerald-400 w-max">
              <Sparkles className="h-3.5 w-3.5" />
              <span>AUTOMOTIVE MARKETPLACE 2.0</span>
            </div>

            <div className="space-y-4 my-auto">
              <h2 className="text-4xl sm:text-6xl font-black text-white tracking-tight">
                Trim<span className="text-emerald-400">Scout</span>
              </h2>
              <p className="text-lg sm:text-2xl font-bold text-emerald-300">
                The Reverse-Bidding Marketplace for New & In-Transit Automobiles
              </p>
              <p className="text-sm sm:text-base text-ink-muted max-w-2xl leading-relaxed">
                Eliminating dealership haggling by forcing franchise dealers to compete with sealed out-the-door price bids for verified, ready-to-buy consumers.
              </p>
            </div>

            <div className="border-t border-border/80 pt-4 flex items-center justify-between text-xs text-ink-muted">
              <span>Business Case & Investor Pitch Deck</span>
              <span className="text-emerald-400 font-mono font-bold">$1.2T Market • 3.6M+ Factory Feeds</span>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* SLIDE 2: THE PROBLEM */}
        {/* ---------------------------------------------------- */}
        {currentSlide === 1 && (
          <div className="h-full flex flex-col justify-between animate-fadeIn z-10 space-y-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-rose-400 tracking-wider">THE PROBLEM</span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">The Broken Car Buying Paradigm</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 my-auto">
              {/* Buyer Pain */}
              <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5 space-y-3">
                <div className="flex items-center gap-2 font-bold text-rose-400 text-sm">
                  <AlertTriangle className="h-4 w-4" />
                  <span>The Car Buyer's Nightmare</span>
                </div>
                <ul className="space-y-2 text-xs text-ink-light">
                  <li>• <strong>4.5 Hours in Showrooms:</strong> Exhausting F&I office haggling.</li>
                  <li>• <strong>$1,500+ Hidden Junk Fees:</strong> Mandatory paint protection, nitrogen, doc fees.</li>
                  <li>• <strong>Spam Telemarketing Hell:</strong> 15+ unsolicited calls/day after submitting web leads.</li>
                  <li>• <strong>In-Transit Blindness:</strong> Inability to find incoming factory pipeline allocations.</li>
                </ul>
              </div>

              {/* Dealer Pain */}
              <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5 space-y-3">
                <div className="flex items-center gap-2 font-bold text-rose-400 text-sm">
                  <AlertTriangle className="h-4 w-4" />
                  <span>The Dealership Bleed</span>
                </div>
                <ul className="space-y-2 text-xs text-ink-light">
                  <li>• <strong>$680+ Lead Acquisition Cost:</strong> Paying legacy platforms for &lt;3% close rates.</li>
                  <li>• <strong>Flooring Interest Costs:</strong> Cars past 60 days on lot drain dealer cash reserves.</li>
                  <li>• <strong>Wasted Sales Hours:</strong> BDC reps chasing unvetted tire-kickers all day.</li>
                  <li>• <strong>Margin Destruction:</strong> Public discounts ruin dealer brand equity.</li>
                </ul>
              </div>
            </div>

            <div className="border-t border-border/80 pt-3 text-xs text-ink-muted">
              Consumers hate the process; dealerships waste millions on broken lead models.
            </div>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* SLIDE 3: THE SOLUTION */}
        {/* ---------------------------------------------------- */}
        {currentSlide === 2 && (
          <div className="h-full flex flex-col justify-between animate-fadeIn z-10 space-y-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-400 tracking-wider">THE TRIMSCOUT SOLUTION</span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">Reverse-Bidding & Buyer Shield</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-auto">
              <div className="rounded-2xl border border-border bg-surface p-4 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-emerald-400 text-sm">
                  <Shield className="h-4 w-4" />
                  <span>100% Anonymous Buyer Shield</span>
                </div>
                <p className="text-xs text-ink-muted">
                  Buyer identities are masked behind aliases (e.g. <em>Buyer #CA-4921</em>). Dealers compete on price rather than spam calls.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-blue-400 text-sm">
                  <Zap className="h-4 w-4" />
                  <span>Sealed Reverse Auction</span>
                </div>
                <p className="text-xs text-ink-muted">
                  Franchise dealerships submit binding discount offers in a competitive live deal room with real-time rank feedback.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-purple-400 text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Certified Out-The-Door Guarantee</span>
                </div>
                <p className="text-xs text-ink-muted">
                  Automated calculations for city/county sales tax, DMV fees, and zero hidden add-ons locked into a legal voucher.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-emerald-300 text-sm">
                  <Building2 className="h-4 w-4" />
                  <span>3.6M+ Factory Allocations</span>
                </div>
                <p className="text-xs text-ink-muted">
                  Deep integration with on-lot, in-transit rail, and vessel allocations across every major franchise brand nationwide.
                </p>
              </div>
            </div>

            <div className="border-t border-border/80 pt-3 text-xs text-emerald-400">
              Win-Win: Buyers get guaranteed bottom-line pricing; dealerships acquire funded sales at 50% lower CAC.
            </div>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* SLIDE 4: MARKET SIZING */}
        {/* ---------------------------------------------------- */}
        {currentSlide === 3 && (
          <div className="h-full flex flex-col justify-between animate-fadeIn z-10 space-y-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-400 tracking-wider">MARKET OPPORTUNITY</span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">Massive Addressable Automotive Market</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-auto">
              <div className="rounded-2xl border border-border bg-surface p-5 space-y-2 text-center">
                <span className="text-xs font-bold text-ink-muted uppercase">TAM</span>
                <div className="text-3xl sm:text-4xl font-black text-emerald-400">$1.2 Trillion</div>
                <p className="text-xs text-ink-muted">
                  15.5M new vehicles sold annually in the US at an average price of $48,500.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5 space-y-2 text-center">
                <span className="text-xs font-bold text-ink-muted uppercase">SAM</span>
                <div className="text-3xl sm:text-4xl font-black text-blue-400">$240 Billion</div>
                <p className="text-xs text-ink-muted">
                  Digital-first auto shoppers (35% of total market) seeking online price discovery.
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-500/40 bg-surface p-5 space-y-2 text-center">
                <span className="text-xs font-bold text-ink-muted uppercase">SOM</span>
                <div className="text-3xl sm:text-4xl font-black text-emerald-300">$2.8 Billion</div>
                <p className="text-xs text-ink-muted">
                  Capturing 2.5% of Tier-1 metro allocations via dealer success fees & SaaS subscriptions.
                </p>
              </div>
            </div>

            <div className="border-t border-border/80 pt-3 text-xs text-ink-muted">
              Auto retail is the largest consumer expenditure category in America after housing.
            </div>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* SLIDE 5: MONETIZATION */}
        {/* ---------------------------------------------------- */}
        {currentSlide === 4 && (
          <div className="h-full flex flex-col justify-between animate-fadeIn z-10 space-y-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-400 tracking-wider">BUSINESS MODEL</span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">Diversified High-Margin Revenue Model</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-auto">
              <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs">1. Dealer Transaction Fee</span>
                  <span className="font-mono text-emerald-400 font-extrabold text-xs">$299 - $399 / deal</span>
                </div>
                <p className="text-[11px] text-ink-muted">
                  Charged only upon successful funding and redemption of the locked deal voucher.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs">2. Dealer Pro SaaS Tier</span>
                  <span className="font-mono text-blue-400 font-extrabold text-xs">$599 / mo / rooftop</span>
                </div>
                <p className="text-[11px] text-ink-muted">
                  Unlocks CRM webhook integrations, instant SMS bidding gateway, and regional demand analytics.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs">3. Buyer Concierge Tier</span>
                  <span className="font-mono text-purple-400 font-extrabold text-xs">$99 - $149 one-time</span>
                </div>
                <p className="text-[11px] text-ink-muted">
                  Dedicated negotiation advisor, paperwork verification, and doorstep delivery coordination.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs">4. Fintech & Wholesale Ancillaries</span>
                  <span className="font-mono text-emerald-300 font-extrabold text-xs">$150 - $250 / txn</span>
                </div>
                <p className="text-[11px] text-ink-muted">
                  Captive financing contract origination referrals and wholesale trade-in auction feeds.
                </p>
              </div>
            </div>

            <div className="border-t border-border/80 pt-3 text-xs text-ink-muted">
              Blended Unit Economics: $85 Blended CAC against $640 Lifetime Customer Value (7.5x LTV:CAC).
            </div>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* SLIDE 6: COMPETITIVE MATRIX */}
        {/* ---------------------------------------------------- */}
        {currentSlide === 5 && (
          <div className="h-full flex flex-col justify-between animate-fadeIn z-10 space-y-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-400 tracking-wider">COMPETITIVE MATRIX</span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">TrimScout's Unmatched Moat</h2>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border my-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-elevated text-[10px] uppercase font-bold text-ink-faint">
                  <tr>
                    <th className="p-2.5">Feature</th>
                    <th className="p-2.5 text-emerald-400">TrimScout</th>
                    <th className="p-2.5">TrueCar</th>
                    <th className="p-2.5">Carvana</th>
                    <th className="p-2.5">Cars.com</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 text-[11px]">
                  <tr>
                    <td className="p-2.5 font-bold text-white">Reverse Bidding</td>
                    <td className="p-2.5 text-emerald-400 font-bold">✅ Real-time Multi-Dealer</td>
                    <td className="p-2.5 text-ink-muted">❌ Static Curve</td>
                    <td className="p-2.5 text-ink-muted">❌ Fixed Price</td>
                    <td className="p-2.5 text-ink-muted">❌ Classifieds Only</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-bold text-white">Buyer Shield</td>
                    <td className="p-2.5 text-emerald-400 font-bold">✅ Zero Spam Calls</td>
                    <td className="p-2.5 text-rose-400">❌ Sells to 3+ Dealers</td>
                    <td className="p-2.5 text-ink-muted">⚠️ Sign in Req.</td>
                    <td className="p-2.5 text-rose-400">❌ Heavy BDC Spam</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-bold text-white">Factory Allocations</td>
                    <td className="p-2.5 text-emerald-400 font-bold">✅ 3.6M+ In-Transit</td>
                    <td className="p-2.5 text-ink-muted">⚠️ Partial On-Lot</td>
                    <td className="p-2.5 text-rose-400">❌ Used Only</td>
                    <td className="p-2.5 text-ink-muted">⚠️ Inconsistent</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-bold text-white">Out-The-Door Guarantee</td>
                    <td className="p-2.5 text-emerald-400 font-bold">✅ Tax & DMV Locked</td>
                    <td className="p-2.5 text-rose-400">❌ Lot Add-on Surprises</td>
                    <td className="p-2.5 text-white">✅ Fixed Total</td>
                    <td className="p-2.5 text-rose-400">❌ Excludes Fees</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="border-t border-border/80 pt-3 text-xs text-emerald-400">
              TrimScout is the only platform combining anonymous buyer shielding with live reverse dealer bidding.
            </div>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* SLIDE 7: FINANCIAL PROJECTIONS */}
        {/* ---------------------------------------------------- */}
        {currentSlide === 6 && (
          <div className="h-full flex flex-col justify-between animate-fadeIn z-10 space-y-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-400 tracking-wider">FINANCIAL PROJECTIONS</span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">3-Year Growth & Unit Economics</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-auto">
              <div className="rounded-2xl border border-border bg-surface p-5 space-y-2">
                <span className="text-xs font-bold text-ink-muted">Year 1 (Regional CA/TX)</span>
                <div className="text-2xl sm:text-3xl font-black text-white">$4.8M <span className="text-xs text-ink-muted font-normal">ARR</span></div>
                <div className="space-y-1 text-xs text-ink-light pt-2">
                  <div>• 12,500 Funded Deals</div>
                  <div>• 180 Dealership Rooftops</div>
                  <div>• 76% Gross Margin</div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5 space-y-2">
                <span className="text-xs font-bold text-ink-muted">Year 2 (Top 15 Metros)</span>
                <div className="text-2xl sm:text-3xl font-black text-blue-400">$26.2M <span className="text-xs text-ink-muted font-normal">ARR</span></div>
                <div className="space-y-1 text-xs text-ink-light pt-2">
                  <div>• 68,000 Funded Deals</div>
                  <div>• 750 Dealership Rooftops</div>
                  <div>• 82% Gross Margin</div>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-500/40 bg-surface p-5 space-y-2">
                <span className="text-xs font-bold text-emerald-400">Year 3 (Nationwide)</span>
                <div className="text-2xl sm:text-3xl font-black text-emerald-400">$94.5M <span className="text-xs text-ink-muted font-normal">ARR</span></div>
                <div className="space-y-1 text-xs text-ink-light pt-2">
                  <div>• 245,000 Funded Deals</div>
                  <div>• 2,400 Dealership Rooftops</div>
                  <div>• 87% Gross Margin</div>
                </div>
              </div>
            </div>

            <div className="border-t border-border/80 pt-3 text-xs text-ink-muted">
              Capital-efficient marketplace scaling with strong negative working capital dynamics.
            </div>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* SLIDE 8: THE ASK & MILESTONES */}
        {/* ---------------------------------------------------- */}
        {currentSlide === 7 && (
          <div className="h-full flex flex-col justify-between animate-fadeIn z-10 space-y-4">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-400 tracking-wider">THE ASK & MILESTONES</span>
              <h2 className="text-2xl sm:text-3xl font-black text-white">Seed Round: $2.5 Million</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 my-auto">
              <div className="rounded-2xl border border-emerald-500/30 bg-surface p-5 space-y-2.5">
                <h3 className="font-bold text-emerald-400 text-sm">Use of Funds:</h3>
                <ul className="space-y-2 text-xs text-ink-light">
                  <li>• <strong>45% ($1.12M):</strong> Engineering & AI Autonomous Agents.</li>
                  <li>• <strong>30% ($750K):</strong> Dealer Partner B2B Sales Network.</li>
                  <li>• <strong>15% ($375K):</strong> Consumer Acquisition & Viral Growth Loops.</li>
                  <li>• <strong>10% ($250K):</strong> Multi-state DMV & Legal Compliance.</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-blue-500/30 bg-surface p-5 space-y-2.5">
                <h3 className="font-bold text-blue-400 text-sm">12-Month Key Milestones:</h3>
                <ul className="space-y-2 text-xs text-ink-light">
                  <li>• <strong>Q1:</strong> Launch Dealer SMS Bidding Gateway in CA & TX.</li>
                  <li>• <strong>Q2:</strong> Onboard 250 Certified Franchise Dealership Rooftops.</li>
                  <li>• <strong>Q3:</strong> Reach $250K Monthly Recurring Revenue run-rate.</li>
                  <li>• <strong>Q4:</strong> Integrate Captive Lending & Driveway Delivery.</li>
                </ul>
              </div>
            </div>

            <div className="border-t border-border/80 pt-3 text-xs text-ink-muted">
              Accelerating marketplace liquidity in high-density automotive corridors.
            </div>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* SLIDE 9: STRATEGIC CONCLUSION */}
        {/* ---------------------------------------------------- */}
        {currentSlide === 8 && (
          <div className="h-full flex flex-col justify-between animate-fadeIn z-10 text-center space-y-6">
            <div className="my-auto space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-950/50 px-3.5 py-1 text-xs font-extrabold text-emerald-400">
                <Sparkles className="h-3.5 w-3.5" />
                <span>TRANSFORMING HOW AMERICA BUYS CARS</span>
              </div>
              <h2 className="text-3xl sm:text-5xl font-black text-white">
                Join the Reverse-Bidding Future.
              </h2>
              <p className="text-sm sm:text-base text-ink-muted max-w-xl mx-auto">
                TrimScout is bringing radical transparency, locked pricing, and dealer efficiency to the $1.2 Trillion auto industry.
              </p>

              <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
                <a
                  href="/TrimScout_Business_Case_Pitch_Deck.pptx"
                  download="TrimScout_Business_Case_Pitch_Deck.pptx"
                  className="rounded-2xl bg-emerald-500 hover:bg-emerald-400 px-6 py-3 text-xs font-black text-black shadow-lg shadow-emerald-500/25 transition-all flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  <span>Download .PPTX PowerPoint Presentation</span>
                </a>
              </div>
            </div>

            <div className="border-t border-border/80 pt-3 text-xs text-ink-muted">
              TrimScout Inc. • founders@trimscout.com • https://temporary-spry-scarlet-edtu38n.vercel.app
            </div>
          </div>
        )}
      </div>

      {/* Slide Navigation Bottom Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          {slideTitles.map((title, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentSlide(idx)}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all ${
                currentSlide === idx
                  ? "bg-emerald-500 text-black font-black"
                  : "bg-surface-elevated text-ink-muted hover:text-white"
              }`}
            >
              {idx + 1}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePrev}
            className="flex items-center gap-1 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-4 py-2 text-xs font-bold text-white transition-all shadow-sm cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Previous</span>
          </button>

          <span className="text-xs text-ink-muted font-mono px-2">
            {currentSlide + 1} / {totalSlides}
          </span>

          <button
            onClick={handleNext}
            className="flex items-center gap-1 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20 transition-all cursor-pointer"
          >
            <span>Next</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
