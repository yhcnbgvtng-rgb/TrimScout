"use client";

export const dynamic = "force-dynamic";

import React from "react";
import Link from "next/link";

export default function TermsPage() {
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
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Terms of Use</h1>
            <p className="text-xs text-ink-faint">Last updated September 2026</p>
          </div>

          <div className="space-y-6 text-sm text-ink-light leading-relaxed">
            <p>
              TrimScout is an online platform operated by LyDar Enterprises LLC (&quot;TrimScout,&quot;
              &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;). By using trimscout.com you agree to these terms. If
              you don&apos;t agree, please don&apos;t use the site.
            </p>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">What TrimScout Does</h2>
              <p>
                TrimScout lets you identify a specific vehicle at a dealership, package it with up to two
                alternates, and send an anonymized quote request to the dealerships holding those cars or
                to other dealers nearby. Dealers respond with out-the-door quotes. TrimScout is not a party to
                any resulting sale, lease, or financing — see our{" "}
                <Link href="/disclaimer" className="text-emerald-400 hover:underline">Disclaimer</Link>.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Your Account</h2>
              <p>
                You must be at least 18 and provide accurate information when you create an account. You&apos;re
                responsible for activity under your account and for keeping your sign-in details private. One
                person, one buyer account; one dealership location, one dealer account.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Quote Requests Are Real</h2>
              <p>
                When you send a request, real dealership staff spend time preparing a quote. Send requests only
                for vehicles you genuinely intend to buy or lease. We may limit or suspend accounts that repeatedly
                request quotes and disappear, submit requests for vehicles they have no intention of purchasing,
                or supply false information about themselves or a trade-in.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Dealer Accounts</h2>
              <p>
                Dealers may use TrimScout only to respond to buyer requests routed to them. Quotes must be
                genuine, honored for the vehicle and terms quoted, and free of undisclosed add-ons. A buyer&apos;s
                masked identity may not be used to contact them outside the platform before they accept a deal.
                Dealers may unsubscribe from requests at any time using the link in any request email.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Fees</h2>
              <p>
                Matching and sending quote requests is free. If you choose to lock in an accepted dealer offer
                through TrimScout, a flat platform fee is shown to you before you pay and is charged by card
                through Stripe. Fees are non-refundable once the dealer has been notified of your acceptance,
                except where required by law.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Content You Provide</h2>
              <p>
                You keep ownership of what you upload — listing links, comments, trade-in details, and photos.
                You give us a license to store, display, and transmit that content to the dealers your request
                is sent to, and to use it to operate and improve the service. Don&apos;t upload anything you
                don&apos;t have the right to share, and don&apos;t include personal contact details in comments
                meant for dealers — the platform masks your identity for a reason.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Acceptable Use</h2>
              <p>
                Don&apos;t scrape, crawl, or bulk-export the site or its data; don&apos;t attempt to identify
                masked buyers or extract dealer contact information; don&apos;t interfere with the service or
                try to bypass its protections; and don&apos;t use TrimScout for anything unlawful.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Vehicle and Pricing Data</h2>
              <p>
                Vehicle details come from manufacturer window stickers, government VIN decoders, dealer
                listings, and third-party data providers. We check what we can, but data can be wrong or go
                stale. Confirm the exact vehicle, options, and price with the dealer before you sign anything.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Termination</h2>
              <p>
                You can close your account at any time by contacting us. We may suspend or terminate accounts
                that violate these terms. Sections that by their nature should survive — content licenses,
                disclaimers, limitations of liability — survive termination.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Disclaimers and Limitation of Liability</h2>
              <p>
                TrimScout is provided &quot;as is&quot; and &quot;as available.&quot; To the fullest extent
                permitted by law, we disclaim all warranties and are not liable for indirect, incidental, or
                consequential damages, or for loss arising from reliance on vehicle data, dealer quotes, or dealer
                conduct. Our total liability to you for any claim is limited to the fees you paid us in the twelve
                months before the claim arose. Our{" "}
                <Link href="/disclaimer" className="text-emerald-400 hover:underline">Disclaimer</Link> is part
                of these terms.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Governing Law</h2>
              <p>
                These terms are governed by the laws of the State of New Jersey, without regard to its conflict
                of law rules. Disputes will be brought in the state or federal courts located in New Jersey.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Changes</h2>
              <p>
                We may update these terms. When we do, we&apos;ll change the date at the top of this page.
                Continuing to use TrimScout after a change means you accept the updated terms.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Contact</h2>
              <p>
                Questions about these terms:{" "}
                <a href="mailto:general@trimscout.com" className="text-emerald-400 hover:underline">
                  general@trimscout.com
                </a>
                .
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
