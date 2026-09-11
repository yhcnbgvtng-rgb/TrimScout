"use client";

export const dynamic = "force-dynamic";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { NON_BINDING_COPY } from "../../../lib/quotePackage";

// Where a dealer lands from the tracked link in a quote-request email.
// Deliberately minimal: the only thing they need to do is reply to the
// email, and the only thing we owe them is to say so plainly.
function ReceivedBody() {
  const params = useSearchParams();
  const car = params.get("car");
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border/70 bg-surface/50 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5 select-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/scoutmark.png" alt="TrimScout" className="h-8 w-8 rounded-lg" />
            <span className="font-extrabold text-lg tracking-tight text-white">
              Trim<span className="text-emerald-400">Scout</span>
            </span>
          </Link>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-xl px-4 py-16 sm:px-6 space-y-6">
          <h1 className="text-2xl font-black text-white tracking-tight">Thanks for opening the quote request</h1>
          {car ? <p className="text-sm text-ink-light">For the <strong className="text-white">{car}</strong> on your lot.</p> : null}
          <div className="rounded-2xl border border-border bg-surface p-5 space-y-3 text-sm text-ink-light leading-relaxed">
            <p>
              <strong className="text-white">To quote, reply to the email you received</strong> with your best
              out-the-door price — vehicle plus your dealer fees. Leave sales tax and registration out; those are
              calculated for the buyer&apos;s address once they choose.
            </p>
            <p>If you&apos;d rather not quote this one, a one-line reply saying so is appreciated — it lets the buyer move on.</p>
            <p className="text-xs text-ink-muted border-t border-border/60 pt-3">{NON_BINDING_COPY}</p>
          </div>
          <p className="text-xs text-ink-faint">
            The buyer&apos;s identity is masked until they pick a quote. Replies go to TrimScout and are relayed to them.
          </p>
        </div>
      </main>
    </div>
  );
}


export default function QuoteRequestReceivedPage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <ReceivedBody />
    </Suspense>
  );
}
