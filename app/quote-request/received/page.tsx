"use client";

export const dynamic = "force-dynamic";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LEASE_NON_BINDING_COPY, type LeaseQuote, type LeaseRequestPrefs } from "../../../lib/leaseQuote";
import { LeaseCalculatorForm } from "../../../components/LeaseCalculatorForm";
import { counterSummary } from "../../../lib/buyerCounter";
import type { BuyerCounter } from "../../../lib/rfq";
import { UsedQuoteForm } from "../../../components/UsedQuoteForm";
import type { QuotePrefs } from "../../../lib/usedQuote";

// Where a dealer lands from the tracked link in a lease-quote-request
// email. The calculator is the only reply path — a free-text "monthly"
// can't become a quote. No login; the invite token is the whole context.
type Context = {
  vin: string;
  stockNumber: string | null;
  vehicle: { year?: number; make?: string; model?: string; trim?: string; exteriorColor?: string; drivetrain?: string } | null;
  dealerName: string;
  leasePrefs: LeaseRequestPrefs | null;
  quotePrefs: QuotePrefs | null;
  inviteStatus: string;
  rfqStatus: string;
  dealReference: string | null;
  /** Set when the buyer countered this desk's last quote — the invite is open again for a revised one. */
  buyerCounter: BuyerCounter | null;
  priorLease: LeaseQuote | null;
  condition: "new" | "used" | "cpo";
  buyerMiles: number | null;
  /** The buyer's note, shown above whichever sheet applies. */
  buyerNote: string | null;
};

function BuyerNote({ note }: { note: string }) {
  return (
    <div className="rounded-2xl border border-sky-500/30 bg-sky-950/20 p-5 text-sm text-sky-100" data-testid="buyer-note">
      <p className="text-[10px] font-bold uppercase tracking-wide text-sky-300">From the buyer</p>
      <p className="mt-1 whitespace-pre-wrap">{note}</p>
    </div>
  );
}

function ReceivedBody() {
  const params = useSearchParams();
  const token = params.get("t") || "";
  const car = params.get("car");
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ warnings: string[]; dueAtSigningTotal: number } | null>(null);
  const [declined, setDeclined] = useState(false);
  const [declining, setDeclining] = useState(false);

  const decline = async () => {
    setDeclining(true);
    try {
      const res = await fetch("/api/quote-invite/decline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, reason: "other" }) });
      if (res.ok) setDeclined(true);
      else setError((await res.json().catch(() => ({}))).error || "Could not record that.");
    } finally {
      setDeclining(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    fetch(`/api/quote-invite/context?t=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "This link is no longer valid.");
        setCtx(j as Context);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "This link is no longer valid."));
  }, [token]);

  const title = ctx?.vehicle ? [ctx.vehicle.year, ctx.vehicle.make, ctx.vehicle.model, ctx.vehicle.trim].filter(Boolean).join(" ") : car;

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
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-black text-white tracking-tight">{ctx?.quotePrefs ? `${ctx.quotePrefs.quoteType === "finance" ? "Finance" : "Cash"} quote request` : ctx?.leasePrefs ? "Lease quote request" : "Quote request"}</h1>
            {title ? (
              <p className="text-sm text-ink-light">
                For the <strong className="text-white">{title}</strong>
                {ctx?.vin ? <> · VIN <span className="font-mono">{ctx.vin}</span></> : null}
                {ctx?.stockNumber ? <> · stock {ctx.stockNumber}</> : null}
                {ctx?.dealReference ? <> · ref {ctx.dealReference}</> : null}
              </p>
            ) : null}
          </div>

          {!token ? (
            <p className="rounded-2xl border border-border bg-surface p-5 text-sm text-ink-light">
              Open this page from the link in your quote-request email — that link carries the request.
            </p>
          ) : error ? (
            <p className="rounded-2xl border border-amber-500/40 bg-amber-950/20 p-5 text-sm text-amber-200">{error}</p>
          ) : !ctx ? (
            <p className="text-sm text-ink-muted">Loading the request…</p>
          ) : declined ? (
            <div className="rounded-2xl border border-border bg-surface p-5 space-y-1 text-sm text-ink-light">
              <p className="font-bold text-white">Recorded — the buyer will see you couldn&apos;t go further on this one.</p>
              <p className="text-xs text-ink-muted">Your earlier quote stays on their compare for reference. Thanks for looking.</p>
            </div>
          ) : done ? (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5 space-y-2 text-sm text-ink-light">
              <p className="font-bold text-white">Quote submitted. Thank you.</p>
              {done.dueAtSigningTotal > 0 ? (
                <p>
                  The buyer sees your monthly, the itemized due at signing (
                  <span className="font-mono">${done.dueAtSigningTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  ), cap cost, money factor, residual and term/miles side by side with any other quotes, and picks one or walks away.
                </p>
              ) : (
                <p>The buyer sees your numbers line by line next to any other quotes, and picks one or walks away.</p>
              )}
              {done.warnings.length ? (
                <ul className="text-xs text-amber-200">
                  {done.warnings.map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : ctx.rfqStatus !== "collecting" ? (
            <p className="rounded-2xl border border-border bg-surface p-5 text-sm text-ink-light">
              The buyer has closed this request — no quote is needed. Thanks for looking.
            </p>
          ) : ctx.inviteStatus !== "invited" ? (
            <p className="rounded-2xl border border-border bg-surface p-5 text-sm text-ink-light">
              This invite already has a response ({ctx.inviteStatus}). Nothing more to do.
            </p>
          ) : ctx.quotePrefs ? (
            <>
              {ctx.buyerNote ? <BuyerNote note={ctx.buyerNote} /> : null}
              <div className="rounded-2xl border border-border bg-surface p-5 space-y-2 text-sm text-ink-light leading-relaxed">
                <p>
                  <strong className="text-white">Quote through the sheet below.</strong> Selling price, itemized fees with a sales-tax line, add-ons listed (or none), {ctx.condition === "new" ? "" : "miles, "}and a good-until date are required
                  {ctx.quotePrefs.quoteType === "finance" ? "; term and down must equal the buyer's lock, and the monthly is calculated from amount financed, APR and term — a monthly-only reply can't be submitted" : ""}.
                </p>
                <p className="text-xs text-ink-muted border-t border-border/60 pt-3">This is a non-binding quote request — not an auction, not a bid, and no response deadline. The buyer compares and picks one, or walks away.</p>
              </div>
              <UsedQuoteForm token={token} vin={ctx.vin} stockNumber={ctx.stockNumber} prefs={ctx.quotePrefs} condition={ctx.condition} buyerMiles={ctx.buyerMiles} onSubmitted={(r) => setDone({ warnings: r.warnings, dueAtSigningTotal: 0 })} />
            </>
          ) : !ctx.leasePrefs ? (
            <div className="rounded-2xl border border-border bg-surface p-5 space-y-3 text-sm text-ink-light" data-testid="login-to-quote">
              <p>
                <strong className="text-white">Submit this quote in TrimScout.</strong> Log in to your dealer account — or sign up if your store doesn&apos;t have one yet. Quotes don&apos;t go by email reply.
              </p>
              <p className="flex flex-wrap gap-2">
                <a href="/?login=1" className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-emerald-400">Log in to quote</a>
                <a href="/signup" className="rounded-lg border border-emerald-500/60 px-4 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/10">Sign up</a>
              </p>
              <p className="text-xs text-ink-muted border-t border-border/60 pt-3">This is a non-binding quote request — not an auction, not a bid, and no response deadline.</p>
            </div>
          ) : (
            <>
              {ctx.buyerNote ? <BuyerNote note={ctx.buyerNote} /> : null}
              {ctx.buyerCounter ? (
                <div className="rounded-2xl border border-amber-500/40 bg-amber-950/20 p-5 space-y-2 text-sm text-amber-100 leading-relaxed" data-testid="buyer-counter-panel">
                  <p className="font-bold text-white">The buyer countered your quote.</p>
                  <p>
                    {ctx.priorLease ? <>Your quote: <strong>${Math.round(ctx.priorLease.monthlyPaymentPreTax).toLocaleString()}/mo</strong> · {ctx.priorLease.termMonths} mo · {ctx.priorLease.milesPerYear.toLocaleString()} mi/yr. </> : null}
                    They&apos;re asking for <strong>{counterSummary(ctx.buyerCounter)}</strong>.
                    {ctx.buyerCounter.note ? <> Their note: &ldquo;{ctx.buyerCounter.note}&rdquo;</> : null}
                  </p>
                  <p className="text-xs text-amber-200/90">
                    The calculator below is prefilled with your last quote — revise and submit, or say you can&apos;t go further. A request, not a bid; no deadline on you.
                  </p>
                  <button type="button" onClick={decline} disabled={declining} className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-100 hover:bg-amber-500/10 disabled:opacity-50" data-testid="decline-counter">
                    {declining ? "Recording…" : "I can't do better than my quote"}
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border border-border bg-surface p-5 space-y-2 text-sm text-ink-light leading-relaxed">
                  <p>
                    <strong className="text-white">Quote through the calculator below.</strong> Every field the buyer compares on is required —
                    cap cost, residual, money factor, monthly, and due at signing itemized. A monthly-only reply can&apos;t be submitted.
                  </p>
                  <p className="text-xs text-ink-muted border-t border-border/60 pt-3">{LEASE_NON_BINDING_COPY}</p>
                </div>
              )}
              <LeaseCalculatorForm
                token={token}
                vin={ctx.vin}
                stockNumber={ctx.stockNumber}
                prefs={ctx.buyerCounter ? { ...ctx.leasePrefs, termMonths: (ctx.buyerCounter.termMonths as LeaseRequestPrefs["termMonths"]) || ctx.leasePrefs.termMonths, milesPerYear: (ctx.buyerCounter.milesPerYear as LeaseRequestPrefs["milesPerYear"]) || ctx.leasePrefs.milesPerYear } : ctx.leasePrefs}
                initial={ctx.priorLease}
                onSubmitted={setDone}
              />
            </>
          )}
          <p className="text-xs text-ink-faint">
            We pass messages between you and the buyer without sharing their email. Replies come back through TrimScout.
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
