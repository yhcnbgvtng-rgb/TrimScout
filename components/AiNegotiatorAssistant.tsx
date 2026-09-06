"use client";

import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Bot,
  ChevronRight,
  Handshake,
  Loader2,
  CircleCheck as CheckCircle2,
  TriangleAlert as AlertTriangle,
  Ban,
  Clock,
} from "lucide-react";
import { formatCurrency } from "../lib/otdCalculator";
import type { DealRequestRecord, DealBidRecord } from "../lib/dealsApi";
import type { NegotiateAction } from "../lib/negotiationPolicy";

interface GuardrailForm {
  walkAwayOtd: string;
  concessionStep: string;
  maxCountersPerDealer: string;
  autoAcceptUnderOtd: string;
  fairOtdMid: string;
  draftMessageWithAi: boolean;
}

const DEFAULT_GUARDRAILS: GuardrailForm = {
  walkAwayOtd: "",
  concessionStep: "500",
  maxCountersPerDealer: "3",
  autoAcceptUnderOtd: "",
  fairOtdMid: "",
  draftMessageWithAi: false,
};

interface NegotiateResult {
  bidId: string;
  action: NegotiateAction;
  reason: string;
  message: string;
  nextTargetOtd: number | null;
  persisted: boolean;
  needsCheckout: { bidId: string } | null;
}

const ACTION_STYLE: Record<NegotiateAction, { label: string; icon: React.ReactNode; className: string }> = {
  recommend_accept: {
    label: "Recommend accept",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  counter: {
    label: "Countered",
    icon: <Handshake className="h-3.5 w-3.5" />,
    className: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  },
  hold: {
    label: "Holding",
    icon: <Clock className="h-3.5 w-3.5" />,
    className: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  walk: {
    label: "Walked",
    icon: <Ban className="h-3.5 w-3.5" />,
    className: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  },
};

export const AiNegotiatorAssistant: React.FC = () => {
  const { data: session, status } = useSession();
  const user = session?.user as { id?: string; role?: string } | undefined;

  const [requests, setRequests] = useState<DealRequestRecord[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [bids, setBids] = useState<DealBidRecord[]>([]);
  const [loadingBids, setLoadingBids] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [guardrails, setGuardrails] = useState<GuardrailForm>(DEFAULT_GUARDRAILS);
  const [runningBidId, setRunningBidId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, NegotiateResult>>({});

  useEffect(() => {
    if (status !== "authenticated" || user?.role !== "buyer") {
      setLoadingRequests(false);
      return;
    }
    fetch("/api/deal-requests")
      .then((res) => res.json())
      .then((json) => {
        const active = (json.dealRequests || []).filter((r: DealRequestRecord) => r.status === "active");
        setRequests(active);
        if (active.length > 0) setSelectedRequestId(active[0].id);
      })
      .catch(() => setError("Could not load your deal requests."))
      .finally(() => setLoadingRequests(false));
  }, [status, user?.role]);

  useEffect(() => {
    if (!selectedRequestId) {
      setBids([]);
      return;
    }
    setLoadingBids(true);
    setResults({});
    fetch(`/api/deal-requests/${selectedRequestId}/bids`)
      .then((res) => res.json())
      .then((json) => setBids(json.bids || []))
      .catch(() => setError("Could not load bids for this deal."))
      .finally(() => setLoadingBids(false));
  }, [selectedRequestId]);

  const selectedRequest = requests.find((r) => r.id === selectedRequestId) || null;

  const runNegotiation = async (bid: DealBidRecord) => {
    if (!selectedRequestId) return;
    setRunningBidId(bid.id);
    setError(null);
    try {
      const res = await fetch(`/api/deal-requests/${selectedRequestId}/negotiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidId: bid.id,
          draftMessageWithAi: guardrails.draftMessageWithAi,
          guardrails: {
            walkAwayOtd: Number(guardrails.walkAwayOtd) || undefined,
            concessionStep: Number(guardrails.concessionStep) || 500,
            maxCountersPerDealer: Number(guardrails.maxCountersPerDealer) || 3,
            autoAcceptUnderOtd: guardrails.autoAcceptUnderOtd ? Number(guardrails.autoAcceptUnderOtd) : null,
            fairOtdMid: guardrails.fairOtdMid ? Number(guardrails.fairOtdMid) : null,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Negotiation failed");
      setResults((prev) => ({
        ...prev,
        [bid.id]: {
          bidId: bid.id,
          action: json.decision.action,
          reason: json.decision.reason,
          message: json.message,
          nextTargetOtd: json.decision.nextTargetOtd,
          persisted: json.persisted,
          needsCheckout: json.needsCheckout,
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Negotiation failed");
    } finally {
      setRunningBidId(null);
    }
  };

  if (status === "loading" || loadingRequests) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center text-ink-muted text-sm">
        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-3" />
        Loading…
      </div>
    );
  }

  if (status !== "authenticated" || user?.role !== "buyer") {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center space-y-3">
        <p className="text-sm text-ink-muted">Sign in as a buyer to use the AI Negotiator Assistant.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          <Bot className="h-5.5 w-5.5" />
        </div>
        <div>
          <h1 className="text-xl font-black text-white">AI Negotiator Assistant</h1>
          <p className="text-xs text-ink-muted">
            Set your walk-away price, then run it against each bid — the numbers are decided by a fixed policy,
            never guessed by AI.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/50 bg-rose-950/40 p-3 text-xs text-rose-200 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {requests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-12 text-center text-sm text-ink-muted">
          No active deal requests to negotiate on right now.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {requests.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedRequestId(r.id)}
                className={`rounded-xl border px-3.5 py-2 text-xs font-bold transition-all ${
                  r.id === selectedRequestId
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                    : "border-border bg-surface text-ink-muted hover:text-white"
                }`}
              >
                {r.referenceYear} {r.referenceMake} {r.referenceModel}
                {r.referenceTrim ? ` ${r.referenceTrim}` : ""}
              </button>
            ))}
          </div>

          {selectedRequest && (
            <div className="rounded-2xl border border-border bg-surface p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-ink-faint">
                    Target OTD (from your request)
                  </span>
                  <div className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono text-white">
                    {typeof selectedRequest.targetOtdPrice === "number" && selectedRequest.targetOtdPrice > 0
                      ? formatCurrency(selectedRequest.targetOtdPrice)
                      : "Not set"}
                  </div>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-ink-faint">Walk-away OTD (max you'll pay)</span>
                  <input
                    type="number"
                    value={guardrails.walkAwayOtd}
                    onChange={(e) => setGuardrails((g) => ({ ...g, walkAwayOtd: e.target.value }))}
                    placeholder="e.g. 61000"
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-ink-faint">Counter step ($)</span>
                  <input
                    type="number"
                    value={guardrails.concessionStep}
                    onChange={(e) => setGuardrails((g) => ({ ...g, concessionStep: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-ink-faint">Max counters per dealer</span>
                  <input
                    type="number"
                    value={guardrails.maxCountersPerDealer}
                    onChange={(e) => setGuardrails((g) => ({ ...g, maxCountersPerDealer: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-ink-faint">Auto-accept under (optional)</span>
                  <input
                    type="number"
                    value={guardrails.autoAcceptUnderOtd}
                    onChange={(e) => setGuardrails((g) => ({ ...g, autoAcceptUnderOtd: e.target.value }))}
                    placeholder="Never, unless set"
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-ink-faint">Fair-mid estimate (optional)</span>
                  <input
                    type="number"
                    value={guardrails.fairOtdMid}
                    onChange={(e) => setGuardrails((g) => ({ ...g, fairOtdMid: e.target.value }))}
                    placeholder="Hold for more bids under this"
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={guardrails.draftMessageWithAi}
                  onChange={(e) => setGuardrails((g) => ({ ...g, draftMessageWithAi: e.target.checked }))}
                  className="h-3.5 w-3.5 rounded border-border text-emerald-500 focus:ring-0"
                />
                Polish the counter message with AI (wording only — never changes the numbers or the action)
              </label>
            </div>
          )}

          <div className="space-y-3">
            {loadingBids ? (
              <div className="text-center text-ink-muted text-sm py-8">
                <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" /> Loading bids…
              </div>
            ) : bids.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-sm text-ink-muted">
                No dealer bids on this request yet.
              </div>
            ) : (
              bids.map((bid) => {
                const result = results[bid.id];
                const style = result ? ACTION_STYLE[result.action] : null;
                return (
                  <div key={bid.id} className="rounded-2xl border border-border bg-surface p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-white">{bid.dealerName}</div>
                        <div className="text-xs text-ink-muted">
                          {bid.matchedVehicleTitle} {bid.matchedVehicleSpec ? `· ${bid.matchedVehicleSpec}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-lg font-black text-white font-mono">
                            {formatCurrency(bid.totalOtdPrice)}
                          </div>
                          <div className="text-[10px] text-ink-faint uppercase">Out-the-door</div>
                        </div>
                        <button
                          onClick={() => runNegotiation(bid)}
                          disabled={runningBidId === bid.id || !guardrails.walkAwayOtd}
                          title={!guardrails.walkAwayOtd ? "Set a walk-away OTD above first" : undefined}
                          className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-black hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                          {runningBidId === bid.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Bot className="h-3.5 w-3.5" />
                          )}
                          Run AI
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {result && style && (
                      <div className="rounded-xl border border-border-strong bg-surface-elevated p-3.5 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase ${style.className}`}
                          >
                            {style.icon}
                            {style.label}
                          </span>
                          {!result.persisted && (
                            <span className="text-[10px] text-amber-400">
                              (couldn't save this move — decision shown anyway)
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-ink-muted">{result.reason}</p>
                        {result.message && (
                          <p className="text-xs text-ink-light italic border-l-2 border-border-strong pl-3">
                            &ldquo;{result.message}&rdquo;
                          </p>
                        )}
                        {result.needsCheckout && (
                          <p className="text-xs text-emerald-400 font-semibold">
                            Under your auto-accept threshold — head to checkout to lock this in.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
};
