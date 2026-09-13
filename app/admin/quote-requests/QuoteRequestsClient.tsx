"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calculator, ExternalLink, RefreshCw, Search } from "lucide-react";
import type { AdminRfq } from "../../api/admin/rfqs/route";
import { DESK_ROLE_LABELS, inviteStage } from "../../../lib/quotePackage";
import { relativeTime, rfqDealNumber, rfqQuoteTypeLabel, rfqTrackerStatus, rfqTrackerStatusLabel, rfqVehicleSummary } from "../../../lib/rfqTracker";
import { dueAtSigningTotal } from "../../../lib/leaseQuote";

/**
 * The master desk: every quote request, every buyer, every invited dealer —
 * and, per invite, the dealer's own calculator page so an admin can reply
 * as that desk. Opening a calculator is a real dealer view (marks viewed,
 * locks the buyer's lease sheet), so each button says so.
 */
type Filter = "all" | "awaiting" | "quotes_in" | "closed";

export default function QuoteRequestsClient() {
  const [rfqs, setRfqs] = useState<AdminRfq[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/rfqs?limit=300");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load quote requests.");
      setRfqs(json.rfqs as AdminRfq[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load quote requests.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rfqs || []).filter((r) => {
      const st = rfqTrackerStatus(r as never);
      if (filter === "awaiting" && st !== "awaiting") return false;
      if (filter === "quotes_in" && st !== "quotes_in") return false;
      if (filter === "closed" && !st.startsWith("closed")) return false;
      if (!needle) return true;
      const hay = [rfqDealNumber(r), r.buyerUserId, r.vin, rfqVehicleSummary(r), ...r.invites.map((i) => `${i.dealerName} ${i.desk?.contactName || ""} ${i.dealerContactEmail || ""}`)].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [rfqs, filter, q]);

  const counts = useMemo(() => {
    const c = { all: 0, awaiting: 0, quotes_in: 0, closed: 0 };
    for (const r of rfqs || []) {
      c.all++;
      const st = rfqTrackerStatus(r as never);
      if (st === "awaiting") c.awaiting++;
      else if (st === "quotes_in") c.quotes_in++;
      else c.closed++;
    }
    return c;
  }, [rfqs]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-surface/50 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="inline-flex items-center gap-1 text-xs font-bold text-ink-muted hover:text-white">
              <ArrowLeft className="h-3.5 w-3.5" /> Admin
            </Link>
            <h1 className="text-sm font-black text-white">All quote requests</h1>
          </div>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <p className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
          <strong>Master desk.</strong> Every buyer&apos;s request and every invited dealer. <em>Quote as dealer</em> opens that desk&apos;s own calculator page — a real dealer view: it marks the invite viewed and locks the buyer&apos;s lease sheet, exactly as if the dealer had opened their email.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {(["all", "awaiting", "quotes_in", "closed"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold ${filter === f ? "border-emerald-500 bg-emerald-500/10 text-white" : "border-border text-ink-muted hover:text-white"}`}
            >
              {f === "all" ? "All" : f === "awaiting" ? "Awaiting quotes" : f === "quotes_in" ? "Quotes in" : "Closed"} · {counts[f]}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] text-ink-muted">
            <Search className="h-3.5 w-3.5" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Deal #, buyer, VIN, dealer, contact…" className="w-64 bg-transparent text-white placeholder-ink-faint focus:outline-none" />
          </label>
        </div>

        {error ? <p className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">{error}</p> : null}
        {rfqs === null && !error ? <p className="text-xs text-ink-muted">Loading…</p> : null}
        {rfqs && shown.length === 0 ? <p className="text-xs text-ink-muted">Nothing matches.</p> : null}

        <div className="space-y-3">
          {shown.map((r) => {
            const st = rfqTrackerStatus(r as never);
            const tone = st === "quotes_in" ? "bg-emerald-500/15 text-emerald-300" : st === "awaiting" ? "bg-amber-500/15 text-amber-300" : "bg-border text-ink-muted";
            return (
              <section key={r.id} className="rounded-2xl border border-border bg-surface p-4 space-y-3" data-testid="admin-rfq">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-black text-emerald-400">{rfqDealNumber(r)}</span>
                      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-300">{rfqQuoteTypeLabel(r)}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone}`}>{rfqTrackerStatusLabel(r as never)}</span>
                      {r.leaseSheetLockedAt ? <span className="rounded bg-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-muted">Sheet locked</span> : null}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-white">{rfqVehicleSummary(r)}</p>
                    <p className="text-[11px] text-ink-muted">
                      buyer <span className="font-mono">{r.buyerUserId}</span> · VIN <span className="font-mono">{r.vin}</span> · {relativeTime(r.createdAt)} · rfq #{r.id}
                      {r.leasePrefs ? ` · ${r.leasePrefs.termMonths} mo · ${r.leasePrefs.milesPerYear.toLocaleString()} mi/yr${r.leasePrefs.zip ? ` · ZIP ${r.leasePrefs.zip}` : ""}${r.leasePrefs.maxCashDueAtSigning != null ? ` · max $${r.leasePrefs.maxCashDueAtSigning.toLocaleString()} DAS` : ""}` : ""}
                    </p>
                  </div>
                  <Link href={`/rfq/${r.id}`} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white">
                    Buyer view <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>

                <ul className="divide-y divide-border/60 rounded-xl border border-border bg-background">
                  {r.invites.length === 0 ? <li className="px-3 py-2 text-[11px] text-ink-faint">No dealers invited.</li> : null}
                  {r.invites.map((i) => {
                    const stage = inviteStage(i as never);
                    const lease = i.quote?.lease;
                    return (
                      <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold text-white">
                            {i.dealerName}
                            <span className="ml-2 rounded bg-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-muted">{stage}</span>
                          </div>
                          <div className="text-[10px] text-ink-muted">
                            {i.desk?.contactName || "—"}
                            {i.desk?.role ? ` · ${(DESK_ROLE_LABELS as Record<string, string>)[i.desk.role] || i.desk.role}` : ""}
                            {i.dealerContactEmail ? <span className="font-mono"> · {i.dealerContactEmail}</span> : null}
                            {i.viewedAt ? ` · viewed ${new Date(i.viewedAt).toLocaleString()}` : i.sentAt ? ` · sent ${new Date(i.sentAt).toLocaleString()}` : ""}
                          </div>
                          {lease ? (
                            <div className="text-[10px] text-emerald-300">
                              Quoted ${lease.monthlyPaymentPreTax.toLocaleString()}/mo · DAS ${dueAtSigningTotal(lease.dueAtSigning).toLocaleString()} · {lease.termMonths} mo / {lease.milesPerYear.toLocaleString()} mi
                              {lease.counter?.counterOffer ? " · counter" : ""}
                            </div>
                          ) : i.quote ? (
                            <div className="text-[10px] text-emerald-300">Quoted ${i.quote.price.toLocaleString()}</div>
                          ) : null}
                        </div>
                        {i.calculatorUrl && i.status === "invited" ? (
                          <a
                            href={i.calculatorUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Opens this desk's calculator page. Counts as a dealer view: marks the invite viewed and locks the buyer's lease sheet."
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-extrabold text-black hover:bg-emerald-400"
                          >
                            <Calculator className="h-3.5 w-3.5" /> Quote as dealer
                          </a>
                        ) : i.calculatorUrl ? (
                          <a href={i.calculatorUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white">
                            Dealer page <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
