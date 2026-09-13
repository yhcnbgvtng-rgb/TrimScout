"use client";

export const dynamic = "force-dynamic";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LEASE_NON_BINDING_COPY, type LeaseRequestPrefs } from "../../../lib/leaseQuote";
import { LeaseCalculatorForm } from "../../../components/LeaseCalculatorForm";

// Where a dealer lands from the tracked link in a lease-quote-request
// email. The calculator is the only reply path — a free-text "monthly"
// can't become a quote. No login; the invite token is the whole context.
type Context = {
  vin: string;
  stockNumber: string | null;
  vehicle: { year?: number; make?: string; model?: string; trim?: string; exteriorColor?: string; drivetrain?: string } | null;
  dealerName: string;
  leasePrefs: LeaseRequestPrefs | null;
  inviteStatus: string;
  rfqStatus: string;
  dealReference: string | null;
};

function ReceivedBody() {
  const params = useSearchParams();
  const token = params.get("t") || "";
  const car = params.get("car");
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ warnings: string[]; dueAtSigningTotal: number } | null>(null);

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
            <h1 className="text-2xl font-black text-white tracking-tight">Lease quote request</h1>
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
          ) : done ? (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5 space-y-2 text-sm text-ink-light">
              <p className="font-bold text-white">Quote submitted. Thank you.</p>
              <p>
                The buyer sees your monthly, the itemized due at signing (
                <span className="font-mono">${done.dueAtSigningTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                ), cap cost, money factor, residual and term/miles side by side with any other quotes, and picks one or walks away.
              </p>
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
          ) : !ctx.leasePrefs ? (
            <p className="rounded-2xl border border-amber-500/40 bg-amber-950/20 p-5 text-sm text-amber-200">
              This request has no lease preferences on file, so the calculator can&apos;t be used for it.
            </p>
          ) : (
            <>
              <div className="rounded-2xl border border-border bg-surface p-5 space-y-2 text-sm text-ink-light leading-relaxed">
                <p>
                  <strong className="text-white">Quote through the calculator below.</strong> Every field the buyer compares on is required —
                  cap cost, residual, money factor, monthly, and due at signing itemized. A monthly-only reply can&apos;t be submitted.
                </p>
                <p className="text-xs text-ink-muted border-t border-border/60 pt-3">{LEASE_NON_BINDING_COPY}</p>
              </div>
              <LeaseCalculatorForm token={token} vin={ctx.vin} stockNumber={ctx.stockNumber} prefs={ctx.leasePrefs} onSubmitted={setDone} />
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
