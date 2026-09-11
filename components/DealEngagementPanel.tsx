"use client";

import React, { useEffect, useState } from "react";
import { Clock, Mail, Eye, MessageSquare, Pause, Plus } from "lucide-react";
import type { DealerEngagementStatus, OfferCloseClockView } from "../lib/types";
import {
  evaluateOfferClock,
  formatRemainingClock,
  pauseReasonLabel,
} from "../lib/offerCloseClock";

function liveClock(clock: OfferCloseClockView | undefined, nowMs: number): OfferCloseClockView | undefined {
  if (!clock) return undefined;
  return evaluateOfferClock({
    startedAt: clock.startedAt,
    allottedRunningMs: clock.allottedRunningMs,
    closedAt: clock.closedAt,
    timeZone: clock.timeZone,
    now: new Date(nowMs),
  });
}

function formatResume(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function DealerEngagementChips({ dealers }: { dealers: DealerEngagementStatus[] | undefined }) {
  if (!dealers) return null;
  if (dealers.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-elevated p-4 text-xs text-ink-muted">
        No dealers have been invited on this deal yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-[10px] uppercase font-bold text-ink-faint tracking-wider">Dealer engagement</h4>
      <div className="space-y-2">
        {dealers.map((dealer) => (
          <div
            key={dealer.dealerKey}
            className="rounded-xl border border-border bg-surface-elevated px-3 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
          >
            <div>
              <div className="text-xs font-bold text-white">{dealer.dealerName}</div>
              {dealer.dealerState ? (
                <div className="text-[10px] text-ink-muted">{dealer.dealerState}</div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                  dealer.clicked
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    : "bg-surface text-ink-faint border-border"
                }`}
              >
                <Mail className="h-3 w-3" />
                {dealer.clicked ? "Email link clicked" : "Email link not clicked"}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                  dealer.viewed
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    : "bg-surface text-ink-faint border-border"
                }`}
              >
                <Eye className="h-3 w-3" />
                {dealer.viewed ? "Logged in / viewed" : "Not viewed yet"}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                  dealer.responded
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    : "bg-surface text-ink-faint border-border"
                }`}
              >
                <MessageSquare className="h-3 w-3" />
                {dealer.responded ? "Responded" : "No response yet"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OfferCloseClockCard({
  clock,
  dealRequestId,
  onUpdated,
  compact = false,
}: {
  clock: OfferCloseClockView | undefined;
  dealRequestId: string;
  onUpdated?: (next: OfferCloseClockView) => void;
  /** Renders just the remaining time + an extend link, no border/box and no
   * repeated "Offer close clock" label — for callers (like the Deal Tracker
   * hero card) that already show a single unified status elsewhere and just
   * need the live countdown as a supporting detail. */
  compact?: boolean;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = liveClock(clock, nowMs) || clock;

  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const handleExtend = async () => {
    if (!/^\d+$/.test(dealRequestId)) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/deal-requests/${dealRequestId}/clock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "extend" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Could not extend the response window.");
        return;
      }
      if (json.offerClock) onUpdated?.(json.offerClock as OfferCloseClockView);
    } catch {
      setError("Could not extend the response window.");
    } finally {
      setPending(false);
    }
  };

  const status = live?.status || "idle";
  const remaining = live ? formatRemainingClock(live.remainingMs) : "—";
  const pauseLabel = pauseReasonLabel(live?.pauseReason || null);
  const resumeLabel = formatResume(live?.resumeAt || null, live?.timeZone || "America/New_York");
  const canExtend = Boolean(live) && status !== "closed" && /^\d+$/.test(dealRequestId);

  if (compact) {
    // Idle and closed are already covered by the caller's own status text —
    // only surface something here when there's a live countdown to show.
    if (status !== "running" && status !== "paused") return null;
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-faint font-mono">
        <span>·</span>
        <span>{status === "paused" && pauseLabel ? pauseLabel : `${remaining} left for dealers to reply`}</span>
        {canExtend ? (
          <button
            type="button"
            onClick={handleExtend}
            disabled={pending}
            className="font-sans font-bold text-amber-400 hover:text-amber-300 disabled:opacity-50"
          >
            {pending ? "Extending…" : "Extend +24h"}
          </button>
        ) : null}
        {error ? <span className="font-sans text-rose-300">{error}</span> : null}
      </span>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-black/40 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex items-start gap-3">
        <Clock className={`h-5 w-5 mt-0.5 ${status === "closed" ? "text-ink-faint" : "text-ink-muted"}`} />
        <div>
          <div className="text-[10px] uppercase font-bold text-ink-faint tracking-wider">
            {status === "idle"
              ? "Dealer response window"
              : status === "paused"
                ? "Dealer response window · paused"
                : status === "closed"
                  ? "Response window closed"
                  : "Dealer response window"}
          </div>
          {status === "idle" ? (
            <div className="text-xs text-ink-light mt-0.5">
              Dealers have 48 business hours to reply, starting when the first one opens your request
            </div>
          ) : status === "closed" ? (
            <div className="text-xs text-ink-muted mt-0.5">
              Closed to new quotes. The quotes you received stay here, and you can still pick one or walk away.
            </div>
          ) : (
            <div className="mt-0.5 text-xs text-ink-light">
              <span className="font-mono font-bold text-white">{remaining}</span> left for dealers to reply
            </div>
          )}
          {status === "paused" && pauseLabel ? (
            <div className="flex items-center gap-1 text-[11px] text-amber-300 mt-1">
              <Pause className="h-3 w-3" />
              <span>
                {pauseLabel}
                {resumeLabel ? ` · resumes ${resumeLabel}` : ""}
              </span>
            </div>
          ) : null}
          {error ? <p className="text-[11px] text-rose-300 mt-1">{error}</p> : null}
        </div>
      </div>
      {canExtend ? (
        <button
          type="button"
          onClick={handleExtend}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] font-extrabold text-amber-300 hover:bg-amber-500 hover:text-black transition-all disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          {pending ? "Extending…" : "Extend +24 hours"}
        </button>
      ) : null}
    </div>
  );
}
