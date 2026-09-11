"use client";

export const dynamic = "force-dynamic";

import React from "react";
import Link from "next/link";

export default function PrivacyPage() {
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
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Privacy Policy</h1>
            <p className="text-xs text-ink-faint">Last updated September 2026</p>
          </div>

          <div className="space-y-6 text-sm text-ink-light leading-relaxed">
            <p>
              TrimScout is operated by LyDar Enterprises LLC (&quot;TrimScout,&quot; &quot;we,&quot;
              &quot;us,&quot; or &quot;our&quot;). Keeping your identity away from dealers until you choose to
              share it is the point of the product, so this page is specific about what we collect, what dealers
              see, and what they don&apos;t.
            </p>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">What We Collect</h2>
              <p>
                <strong className="text-white">Account details</strong> — name, email address, phone number, and
                ZIP code when you sign up. Dealers also provide a dealership name and location.
              </p>
              <p>
                <strong className="text-white">Request details</strong> — the dealer listing links or VINs you
                paste, the vehicles they resolve to, your payment preference and purchase timeline, whether you
                have a trade-in, comments you write for dealers, and, if you supply one, a sales adviser&apos;s
                email for a dealership we have no contact for.
              </p>
              <p>
                <strong className="text-white">Trade-in details</strong> — if you accept an offer and have a
                trade-in, the vehicle&apos;s year, make, model, mileage, condition, any loan balance, and the
                photos you upload.
              </p>
              <p>
                <strong className="text-white">Technical data</strong> — the usual server logs (IP address,
                browser, pages visited) and anonymous performance analytics.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">What Dealers See — and Don&apos;t</h2>
              <p>
                Until you accept a specific dealer&apos;s offer, that dealer sees your request under a masked
                alias (for example &quot;Buyer #K7M3Q&quot;), the vehicles you asked about, your state, your
                payment preference, purchase timeline, and the comment you wrote. They do not see your name,
                email, phone number, or exact ZIP code. Comments are automatically screened for email
                addresses, phone numbers, and links before they leave your browser.
              </p>
              <p>
                When you accept an offer, the winning dealer receives your contact details so the purchase can
                be completed. If you submit trade-in details and photos, they go to that dealer only. Dealers
                who did not win never learn who you are.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">How We Use It</h2>
              <p>
                To route your request to the right dealerships, show you their quotes, let you compare them,
                complete a deal you accept, calculate estimated taxes and fees for your location, prevent abuse
                (for example, repeated requests that are never followed through), and improve the service. We
                don&apos;t sell your personal information, and we don&apos;t use it for advertising.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Who We Share It With</h2>
              <p>
                <strong className="text-white">Dealerships</strong> — as described above, and only what&apos;s
                described above.
              </p>
              <p>
                <strong className="text-white">Service providers</strong> that run parts of the platform on our
                behalf: Vercel (hosting and analytics), Stripe (card payments — we never see or store your card
                number), Resend (email delivery), Cloudflare Turnstile (bot protection at sign-up), and vehicle
                data providers used to decode VINs and verify factory builds. Each receives only what it needs to
                do its job.
              </p>
              <p>
                <strong className="text-white">Legal</strong> — if required by law, or to protect the rights,
                safety, or property of TrimScout, its users, or the public.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Cookies</h2>
              <p>
                We use a session cookie to keep you signed in and a small amount of browser storage to remember
                in-progress form entries. We don&apos;t use advertising or cross-site tracking cookies.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Retention</h2>
              <p>
                Account information is kept while your account is open. Quote requests, dealer responses, and
                deal records are kept so that both you and the dealer have a record of what was quoted and
                agreed. Trade-in photos are kept for the life of the related deal. You can ask us to delete your
                account and associated data at any time; we&apos;ll keep only what we&apos;re legally required to.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Your Choices</h2>
              <p>
                You can review and update your account details, close your account, or request a copy or
                deletion of your data by emailing us. Dealers can stop receiving quote requests using the
                unsubscribe link in any request email. Residents of states with consumer privacy laws (including
                California) may have additional rights to access, correct, delete, or limit use of their data —
                contact us to exercise them.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Security</h2>
              <p>
                Data is transmitted over HTTPS and stored on access-controlled systems. No method of storage is
                perfectly secure; if we learn of a breach affecting your data, we&apos;ll notify you as the law
                requires.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Children</h2>
              <p>
                TrimScout is for adults buying vehicles. We don&apos;t knowingly collect information from anyone
                under 18.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Changes</h2>
              <p>
                If we change this policy we&apos;ll update the date at the top. Material changes will be flagged
                on the site.
              </p>
            </section>

            <section className="space-y-1.5">
              <h2 className="text-sm font-bold text-white">Contact</h2>
              <p>
                Privacy questions or requests:{" "}
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
