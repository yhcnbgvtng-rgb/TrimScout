"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft } from "lucide-react";
import { CounterComparison } from "@/components/CounterComparison";
import { counterSummary } from "@/lib/buyerCounter";
import { rfqDealNumber, rfqVehicleSummary } from "@/lib/rfqTracker";
import type { RfqRequest } from "@/lib/rfq";

/**
 * The buyer's counter, before vs after, on its own page: the dealer's
 * quote, the buyer's edited numbers, and the difference on every line —
 * the same table the dealer sees on their quote page. Opens right after a
 * counter is sent and from the deal page any time after.
 */
export default function CounterReviewPage() {
  const params = useParams();
  const rfqId = String(params.id);
  const inviteId = String(params.inviteId);
  const { status: sessionStatus } = useSession();
  const [rfq, setRfq] = useState<RfqRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/rfqs/${rfqId}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Could not load this request.");
      return;
    }
    setRfq(json.rfq as RfqRequest);
  }, [rfqId]);
  useEffect(() => {
    if (sessionStatus === "authenticated") load();
    else if (sessionStatus === "unauthenticated") setError("Sign in as the buyer to see this counter.");
  }, [sessionStatus, load]);

  const invite = rfq?.invites.find((i) => i.id === inviteId) || null;
  const counter = invite?.buyerCounter || null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6">
        <Link href={`/rfq/${rfqId}`} className="inline-flex items-center gap-1 text-xs font-bold text-ink-muted hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to the request
        </Link>
        {error ? <p className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">{error}</p> : null}
        {!rfq && !error ? <p className="text-xs text-ink-muted">Loading…</p> : null}
        {rfq && !invite ? <p className="text-xs text-ink-muted">That dealer isn&apos;t on this request.</p> : null}
        {rfq && invite && !counter ? <p className="text-xs text-ink-muted">You haven&apos;t countered {invite.dealerName} on this request.</p> : null}
        {rfq && invite && counter ? (
          <section className="space-y-3 rounded-2xl border border-border bg-surface p-5" data-testid="counter-review">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{rfqDealNumber(rfq)} · {rfqVehicleSummary(rfq)}</p>
              <h1 className="text-lg font-black text-white">Your counter to {invite.dealerName}</h1>
              <p className="text-[11px] text-ink-muted">
                Sent {new Date(counter.sentAt).toLocaleString()} · {counterSummary(counter)}
                {counter.note ? <> · “{counter.note}”</> : null}
              </p>
            </div>
            {counter.sheet ? (
              <>
                <CounterComparison sheet={counter.sheet} />
                <p className="text-[10px] text-ink-faint">
                  Only the highlighted lines changed. Everything the lender or the state sets — {counter.sheet.kind === "lease" ? "money factor, residual, term, miles, acquisition fee, taxes" : counter.sheet.kind === "finance" ? "APR, term, tax, title" : "tax, title"} — is exactly as the dealer quoted, and the bottom line is recomputed with their own numbers. {invite.dealerName} sees this same table and replies through TrimScout. A request, not a binding bid.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-ink-muted">This counter was sent before line-by-line counters existed; the dealer saw the summary above.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Link href={`/rfq/${rfqId}`} className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-[11px] font-black text-black hover:bg-emerald-400">Back to the request</Link>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
