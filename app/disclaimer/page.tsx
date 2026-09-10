"use client";

export const dynamic = "force-dynamic";

import React from "react";
import Link from "next/link";

export default function DisclaimerPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border/70 bg-surface/50 backdrop-blur-xl sticky top-0 z-30">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5 group select-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/scoutmark.png"
              alt="TrimScout"
              className="h-8 w-8 rounded-lg shadow-sm group-hover:scale-105 transition-transform"
            />
            <span className="font-extrabold text-lg tracking-tight text-white">
              Trim<span className="text-emerald-400">Scout</span>
            </span>
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white hover:border-border-strong transition-colors"
          >
            Home
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8 space-y-8">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Disclaimer</h1>
            <p className="text-xs text-ink-faint">Last updated September 2026</p>
          </div>

          <div className="space-y-6 text-sm text-ink-light leading-relaxed">
            <p>
              TrimScout is an online platform operated by LyDar Enterprises LLC (&quot;TrimScout,&quot;
              &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;). References to TrimScout throughout this page
              refer to LyDar Enterprises LLC.
            </p>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Not a Dealer or Broker</h2>
              <p>
                TrimScout is not a licensed motor vehicle dealer or vehicle broker, and is not a party to any
                sale, lease, or financing transaction between you and a dealership. We match your vehicle
                criteria to dealerships and route quote requests on your behalf — we don&apos;t sell the car, and
                we don&apos;t set the price. Nothing on this site is an offer to sell, and no quote, price
                estimate, or matched vehicle listing is a binding commitment by TrimScout or any dealer.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Quotes Aren&apos;t Binding</h2>
              <p>
                A quote request sent through TrimScout is a request for a quote, not a bid and not subject to
                any response deadline. A dealer&apos;s response is informational only until you and the dealer
                separately agree to terms — TrimScout doesn&apos;t guarantee any dealer will respond, or that a
                quote will still be honored by the time you&apos;re ready to buy.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Match Honesty Has Limits</h2>
              <p>
                We verify vehicle specifications, factory build, and options against manufacturer window-sticker
                data, dealer listings, and third-party data providers wherever we can — we don&apos;t show you a
                match we haven&apos;t checked. But inventory, options, and pricing can change after we&apos;ve
                checked them, so always confirm the exact vehicle and price with the dealer before you buy.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">No Guarantee of Savings or Availability</h2>
              <p>
                TrimScout doesn&apos;t promise you&apos;ll get a deal, a specific discount, or that any vehicle
                stays in stock or available at a quoted price. Availability and pricing are set solely by the
                dealer and can change or be withdrawn at any time, including after you&apos;ve submitted a
                request.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Privacy Shield</h2>
              <p>
                Until you accept a specific dealer&apos;s offer, we mask your name, phone number, and email from
                that dealer, communicating on your behalf through an anonymized buyer alias. This isn&apos;t a
                guarantee of anonymity in every circumstance — information you voluntarily share in a message, or
                steps needed to complete a purchase (financing, title, delivery), will require sharing your real
                identity with the dealer you choose to work with.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">No Financial or Legal Advice</h2>
              <p>
                Nothing on TrimScout is financial, legal, or tax advice. You&apos;re solely responsible for
                evaluating any financing, lease, or purchase terms before agreeing to them.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Limitation of Liability</h2>
              <p>
                TrimScout is provided &quot;as is.&quot; To the fullest extent permitted by law, TrimScout
                disclaims liability for loss or damage arising from reliance on vehicle data, dealer quotes, or
                dealer conduct.
              </p>
            </section>
          </div>
        </div>
      </main>

      <footer className="border-t border-border/60 py-6 text-center text-xs text-ink-faint">
        <p>© 2026 LyDar Enterprises LLC. Built for honest option matches and real dealer quotes.</p>
        <p className="mt-2 flex items-center justify-center gap-4">
          <Link href="/terms" className="hover:text-white transition-colors">Terms of Use</Link>
          <span className="text-border-strong">•</span>
          <Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
          <span className="text-border-strong">•</span>
          <Link href="/disclaimer" className="hover:text-white transition-colors">Disclaimer</Link>
          <span className="text-border-strong">•</span>
          <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
        </p>
      </footer>
    </div>
  );
}
