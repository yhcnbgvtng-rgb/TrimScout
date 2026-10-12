"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, RefreshCw, ShieldOff, X } from "lucide-react";
import type { ChatPause, ChatReviewItem } from "../../../lib/rfqApi";

/**
 * The conversation review desk. Two things land here: messages held because the AI check failed or timed out (the sender was told
 * it is being reviewed; nothing was delivered), and dealer messages a buyer reported (still visible until decided). Release delivers a
 * held message or dismisses a report; Block drops a held message or hides a reported one, and counts as an attempt against the dealer
 * (3 in 30 days pauses that dealer's chat on all deals). Paused dealers are listed below with a Lift button. Admin session only.
 */
export default function ChatReviewClient() {
  const [items, setItems] = useState<ChatReviewItem[] | null>(null);
  const [pauses, setPauses] = useState<ChatPause[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/chat-review", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || "Could not load the queue."); return; }
    setItems(json.items || []);
    setPauses(json.pauses || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (id: number, decision: "release" | "block") => {
    setBusy(`d${id}`);
    try {
      const res = await fetch(`/api/admin/chat-review/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error || "Could not record that.");
      await load();
    } finally { setBusy(null); }
  };
  const lift = async (dealerKey: string) => {
    setBusy(`p${dealerKey}`);
    try {
      const res = await fetch("/api/admin/chat-pauses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dealerKey }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error || "Could not lift the pause.");
      await load();
    } finally { setBusy(null); }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <Link href="/admin" className="inline-flex items-center gap-1 text-xs font-bold text-ink-muted hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Admin</Link>
            <h1 className="text-2xl font-black text-white">Chat review</h1>
            <p className="text-xs text-ink-muted">Held messages (the AI check was unavailable) and messages buyers reported. Neither side has seen a blocked message.</p>
          </div>
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white" data-testid="chat-review-refresh"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
        </div>
        {error ? <p className="rounded-xl border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200" data-testid="chat-review-error">{error}</p> : null}

        <section className="space-y-3" data-testid="chat-review-queue">
          <h2 className="text-sm font-extrabold text-white">Waiting for a decision {items ? `(${items.length})` : ""}</h2>
          {items === null && !error ? <p className="text-xs text-ink-muted">Loading…</p> : null}
          {items && items.length === 0 ? <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-muted" data-testid="chat-review-empty">Nothing waiting.</p> : null}
          {(items || []).map((it) => (
            <article key={it.id} className="space-y-2 rounded-2xl border border-border bg-surface p-4" data-testid="chat-review-item" data-kind={it.kind}>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wide">
                <span className={`rounded px-1.5 py-0.5 ${it.kind === "reported" ? "bg-rose-500/20 text-rose-200" : "bg-amber-500/20 text-amber-200"}`}>{it.kind === "reported" ? "Reported by the buyer" : "Held for review"}</span>
                <span className="text-ink-faint">{it.sender === "dealer" ? (it.dealerName || "Dealer") : "Buyer"} · request {it.rfqId} · {new Date(it.createdAt).toLocaleString()}</span>
              </div>
              <p className="whitespace-pre-wrap break-words rounded-lg bg-background px-3 py-2 text-sm text-white" data-testid="chat-review-text">{it.text}</p>
              {it.reason ? <p className="text-[11px] text-ink-muted">Why: {it.reason}</p> : null}
              <div className="flex gap-2">
                <button type="button" disabled={busy === `d${it.id}`} onClick={() => decide(it.id, "release")} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-extrabold text-black hover:bg-emerald-400 disabled:opacity-50" data-testid="chat-review-release"><Check className="h-3.5 w-3.5" /> Release</button>
                <button type="button" disabled={busy === `d${it.id}`} onClick={() => decide(it.id, "block")} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/50 px-3 py-1.5 text-xs font-bold text-rose-200 hover:bg-rose-500/10 disabled:opacity-50" data-testid="chat-review-block"><X className="h-3.5 w-3.5" /> Block</button>
              </div>
              <p className="text-[10px] text-ink-faint">{it.kind === "held" ? "Release delivers it now. Block drops it and counts as an attempt against the sender's dealership." : "Release dismisses the report and leaves the message. Block hides it for both sides and counts as an attempt against the dealership."}</p>
            </article>
          ))}
        </section>

        <section className="space-y-3" data-testid="chat-pauses">
          <h2 className="text-sm font-extrabold text-white">Paused dealers ({pauses.length})</h2>
          {pauses.length === 0 ? <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-ink-muted">No dealer is paused.</p> : null}
          {pauses.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3" data-testid="chat-pause-row">
              <div className="min-w-0 text-xs">
                <p className="inline-flex items-center gap-1.5 font-bold capitalize text-white"><ShieldOff className="h-3.5 w-3.5 text-rose-300" /> {p.dealerKey}</p>
                <p className="text-ink-muted">Paused {new Date(p.pausedAt).toLocaleString()}{p.reason ? ` · ${p.reason}` : ""}</p>
              </div>
              <button type="button" disabled={busy === `p${p.dealerKey}`} onClick={() => lift(p.dealerKey)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50" data-testid="chat-pause-lift">Lift pause</button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
