"use client";

import { BuyerTradeCard } from "@/components/trade/BuyerTradeCard";
import React, { useCallback, useEffect, useState } from "react";
import { LeaseCompare } from "@/components/LeaseCompare";
import { analyzeLeaseQuotes, type LeaseCompare as LeaseCompareData } from "@/lib/leaseCompare";
import { LeaseQuoteSheet } from "@/components/LeaseQuoteSheet";
import { UsedCompare } from "@/components/UsedCompare";
import { DealThreadPanel } from "@/components/DealThreadPanel";
import { StagedDeals } from "../../../components/StagedDeals";
import { AddTradeInPrompt } from "../../../components/AddTradeInPrompt";
import { BuyerTradeConfirm } from "../../../components/trade/BuyerTradeConfirm";
import { isStagedRfq } from "../../../lib/dealStages";
import { UnsubscribedBanner } from "@/components/UnsubscribedBanner";
import { SiteFooter } from "@/components/SiteFooter";
import { rfqVehicles } from "@/lib/rfqTracker";
import { LEASE_NON_BINDING_COPY } from "@/lib/leaseQuote";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { CONTACT_SHARED_LINE } from "../../../lib/acceptShare";
import { useAcceptShare } from "../../../components/AcceptShareConfirm";
import { inviteOfQuote } from "../../../lib/rfqClose";
import { useGuestAccess } from "../../../lib/guestToken";
import {
  CircleCheck as CheckCircle2,
  CircleX as XCircle,
  Clock,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X as XIcon,
} from "lucide-react";
import type { RfqDeclineReason, RfqInvite, RfqRequest } from "@/lib/rfq";
import { RFQ_DECLINE_REASON_LABELS } from "@/lib/rfq";
import { LeaseCalculatorSheet } from "@/components/LeaseCalculatorSheet";
import type { CounterEditsPayload } from "@/lib/buyerCounter";
import { isQuoteComplete, quoteMatchesLockedSpec } from "@/lib/rfqLogic";
import { NON_BINDING_COPY } from "@/lib/quotePackage";
import { formatFactoryOptionLine } from "@/lib/fordCompetitionUi";
import { formatCurrency } from "@/lib/otdCalculator";

interface DraftFee {
  label: string;
  amount: string;
}

function QuoteIntakeForm({
  rfqVin,
  rfqStockNumber,
  onSubmit,
  onCancel,
}: {
  rfqVin: string;
  rfqStockNumber: string | null;
  onSubmit: (input: {
    price: number;
    fees: { label: string; amount: number }[];
    vin: string;
    stockNumber: string | null;
    expiresAt: string;
    mustHaveAcknowledgement: boolean;
    notes: string | null;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState<DraftFee[]>([{ label: "Doc fee", amount: "" }]);
  const [vin, setVin] = useState(rfqVin);
  const [stockNumber, setStockNumber] = useState(rfqStockNumber || "");
  const [expiresAt, setExpiresAt] = useState("");
  const [ack, setAck] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateFee = (i: number, field: keyof DraftFee, value: string) => {
    setFees((prev) => prev.map((f, idx) => (idx === i ? { ...f, [field]: value } : f)));
  };
  const addFee = () => setFees((prev) => [...prev, { label: "", amount: "" }]);
  const removeFee = (i: number) => setFees((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        price: Number(price),
        fees: fees.filter((f) => f.label.trim()).map((f) => ({ label: f.label.trim(), amount: Number(f.amount) || 0 })),
        vin: vin.trim(),
        stockNumber: stockNumber.trim() || null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "",
        mustHaveAcknowledgement: ack,
        notes: notes.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record this quote.");
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-4">
      <p className="text-[11px] text-ink-muted">
        Enter exactly what the dealer quoted — over email, phone, or text. This is a record of their response, not a new
        request.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-ink-light">Price (before fees)</span>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 px-2.5 text-xs text-white focus:border-brand-500 focus:outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-ink-light">Quote expires</span>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 px-2.5 text-xs text-white focus:border-brand-500 focus:outline-none"
          />
        </label>
      </div>

      <div className="space-y-1.5">
        <span className="text-[10px] font-bold uppercase text-ink-light">Itemized fees</span>
        {fees.map((f, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="text"
              value={f.label}
              onChange={(e) => updateFee(i, "label", e.target.value)}
              placeholder="Fee label"
              className="flex-1 rounded-lg border border-border bg-surface py-1.5 px-2.5 text-xs text-white placeholder-ink-faint focus:border-brand-500 focus:outline-none"
            />
            <input
              type="number"
              value={f.amount}
              onChange={(e) => updateFee(i, "amount", e.target.value)}
              placeholder="Amount"
              className="w-28 rounded-lg border border-border bg-surface py-1.5 px-2.5 text-xs text-white placeholder-ink-faint focus:border-brand-500 focus:outline-none"
            />
            {fees.length > 1 && (
              <button onClick={() => removeFee(i)} className="text-ink-muted hover:text-rose-400">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        <button onClick={addFee} className="flex items-center gap-1 text-[11px] font-bold text-brand-400 hover:text-brand-300">
          <Plus className="h-3 w-3" />
          Add fee
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-ink-light">VIN quoted</span>
          <input
            type="text"
            value={vin}
            onChange={(e) => setVin(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 px-2.5 text-xs text-white font-mono focus:border-brand-500 focus:outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-ink-light">Stock # (optional)</span>
          <input
            type="text"
            value={stockNumber}
            onChange={(e) => setStockNumber(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 px-2.5 text-xs text-white focus:border-brand-500 focus:outline-none"
          />
        </label>
      </div>

      <label className="space-y-1 block">
        <span className="text-[10px] font-bold uppercase text-ink-light">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border bg-surface py-2 px-2.5 text-xs text-white focus:border-brand-500 focus:outline-none"
        />
      </label>

      <label className="flex items-start gap-2 text-[11px] text-ink-light cursor-pointer">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-border text-brand-500 focus:ring-0" />
        <span>The dealer confirmed all locked must-haves are on this VIN before quoting.</span>
      </label>

      {error && <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">{error}</div>}

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex-1 rounded-lg bg-brand-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-brand-400 transition-all disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save Quote"}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-ink-light hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  );
}

function DeclineForm({ onSubmit, onCancel }: { onSubmit: (reason: RfqDeclineReason) => Promise<void>; onCancel: () => void }) {
  const [reason, setReason] = useState<RfqDeclineReason>("soft_lead");
  const [submitting, setSubmitting] = useState(false);
  return (
    <div className="space-y-2 rounded-xl border border-border bg-background p-4">
      <span className="text-[10px] font-bold uppercase text-ink-light">Why did the desk decline?</span>
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value as RfqDeclineReason)}
        className="w-full rounded-lg border border-border bg-surface py-2 px-2.5 text-xs text-white focus:border-brand-500 focus:outline-none"
      >
        {(Object.keys(RFQ_DECLINE_REASON_LABELS) as RfqDeclineReason[]).map((r) => (
          <option key={r} value={r}>
            {RFQ_DECLINE_REASON_LABELS[r]}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <button
          onClick={async () => {
            setSubmitting(true);
            await onSubmit(reason);
          }}
          disabled={submitting}
          className="flex-1 rounded-lg bg-rose-500/90 px-4 py-2 text-xs font-extrabold text-black hover:bg-rose-400 transition-all disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Record Decline"}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-ink-light hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The buyer's per-dealer actions, rendered inside that dealer's compare-column header for a dealer who
 * hasn't answered yet: log a quote the dealer gave by phone/email, or mark them declined. Same handlers
 * and routes as before; the forms open in an overlay because a column is narrow.
 */
function InviteActions({ invite, rfq, onAction }: { invite: RfqInvite; rfq: RfqRequest; onAction: () => void }) {
  const [mode, setMode] = useState<"idle" | "quote" | "decline">("idle");
  if (invite.status !== "invited") return null;

  const submitQuote = async (input: Parameters<React.ComponentProps<typeof QuoteIntakeForm>["onSubmit"]>[0] | Parameters<React.ComponentProps<typeof LeaseCalculatorSheet>["onSubmit"]>[0]) => {
    const res = await fetch(`/api/rfqs/${rfq.id}/invites/${invite.id}/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not record this quote.");
    setMode("idle");
    onAction();
  };

  const submitDecline = async (reason: RfqDeclineReason) => {
    const res = await fetch(`/api/rfqs/${rfq.id}/invites/${invite.id}/decline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ declineReason: reason }),
    });
    if (res.ok) {
      setMode("idle");
      onAction();
    }
  };

  return (
    <div data-testid="invite-actions">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => setMode("quote")} className="text-[11px] font-bold text-ink-muted underline underline-offset-2 hover:text-white" data-testid="record-quote">
          Record quote
        </button>
        <button type="button" onClick={() => setMode("decline")} className="text-[11px] font-bold text-ink-muted underline underline-offset-2 hover:text-white" data-testid="mark-declined">
          Mark declined
        </button>
      </div>
      {mode !== "idle" ? (
        <div className="fixed inset-0 z-50 overflow-auto bg-black/70 p-4" role="dialog" aria-label={mode === "quote" ? `Record a quote from ${invite.dealerName}` : `Mark ${invite.dealerName} declined`}>
          <div className="mx-auto max-w-3xl space-y-3 rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-sm font-bold text-white">{mode === "quote" ? `Record a quote from ${invite.dealerName}` : `Mark ${invite.dealerName} declined`}</h2>
            {mode === "quote" && rfq.leasePrefs ? (
              <LeaseCalculatorSheet prefs={rfq.leasePrefs} vin={invite.vehicle?.vin || rfq.vin} stockNumber={rfq.stockNumber} onSubmit={submitQuote} onCancel={() => setMode("idle")} />
            ) : null}
            {mode === "quote" && !rfq.leasePrefs ? (
              <QuoteIntakeForm rfqVin={rfq.vin} rfqStockNumber={rfq.stockNumber} onSubmit={submitQuote} onCancel={() => setMode("idle")} />
            ) : null}
            {mode === "decline" ? <DeclineForm onSubmit={submitDecline} onCancel={() => setMode("idle")} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function QuoteCompareCard({ invite, rfq, onPick, picking }: { invite: RfqInvite; rfq: RfqRequest; onPick: () => void; picking: boolean }) {
  const q = invite.quote;
  if (!q) return null;
  const specOk = quoteMatchesLockedSpec(q, rfq);
  const complete = isQuoteComplete(q);
  const isPicked = rfq.pickedQuoteId === q.id;

  return (
    <div className={`rounded-2xl border p-4 space-y-3 bg-surface ${isPicked ? "border-brand-500/60" : "border-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-bold text-white">{invite.dealerName}</div>
        <div className="text-sm font-extrabold text-brand-400">{formatCurrency(q.totalOtdPrice)}</div>
      </div>
      <div className="space-y-1 text-[11px] text-ink-muted">
        <div>Price: {formatCurrency(q.price)}</div>
        {q.fees.map((f, i) => (
          <div key={i}>
            {f.label}: {formatCurrency(f.amount)}
          </div>
        ))}
        <div>Expires: {new Date(q.expiresAt).toLocaleDateString()}</div>
      </div>
      <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
        <span className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold border ${specOk ? "bg-brand-500/15 text-brand-300 border-brand-500/30" : "bg-rose-500/15 text-rose-300 border-rose-500/30"}`}>
          {specOk ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
          {specOk ? "Same VIN/stock" : "Different VIN/stock"}
        </span>
        <span className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold border ${complete ? "bg-positive-500/15 text-positive-300 border-positive-500/30" : "bg-amber-500/15 text-amber-300 border-amber-500/30"}`}>
          {complete ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {complete ? "Complete quote" : "Missing fields"}
        </span>
      </div>
      {rfq.status === "collecting" && (
        <button
          onClick={onPick}
          disabled={picking}
          className="w-full rounded-lg bg-brand-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-brand-400 transition-all disabled:opacity-50"
        >
          Choose This Quote
        </button>
      )}
      {rfq.status === "collecting" && <p className="text-center text-[10px] text-ink-faint" data-testid="contact-shared-line">{CONTACT_SHARED_LINE}</p>}
      {isPicked && <div className="text-center text-[11px] font-bold text-brand-400">You chose this quote</div>}
    </div>
  );
}

export default function RfqWorkspacePage() {
  const params = useParams();
  const rfqId = params.id as string;
  const router = useRouter();
  const { data: sessionData, status: sessionStatus } = useSession();
  const guest = useGuestAccess(rfqId);
  // A guest link counts as a way in; the API decides whether it is honoured (REQUIRE_BUYER_LOGIN).
  const canLoad = sessionStatus === "authenticated" || Boolean(guest.token);

  const [rfq, setRfq] = useState<RfqRequest | null>(null);
  // Server-computed lease comparison (counter / expired / best). Pick and
  // walk responses carry only the rfq, so the page recomputes from the same
  // pure function until the next load.
  const [leaseCompare, setLeaseCompare] = useState<LeaseCompareData | null>(null);
  // Factory stickers found on a later re-check (Hyundai lists before the label exists), by VIN.
  const [stickerRecheck, setStickerRecheck] = useState<Record<string, { msrp: number | null; pdfUrl: string; make: string }>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [walking, setWalking] = useState(false);
  const [threadInviteId, setThreadInviteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/rfqs/${rfqId}`, { headers: guest.headers });
    const json = await res.json();
    if (!res.ok) {
      setLoadError(json.error || "Could not load this request.");
      return;
    }
    setRfq(json.rfq);
    setLeaseCompare((json.leaseCompare as LeaseCompareData | null) ?? null);
    setStickerRecheck((json.stickerRecheck as typeof stickerRecheck) || {});
  }, [rfqId, guest.token]);

  useEffect(() => {
    if (canLoad) load();
  }, [canLoad, load]);

  // Every "Choose this quote" goes through the confirm dialog first; the pick itself is unchanged and only runs on confirm.
  const buyerContact = (sessionData?.user ?? null) as { name?: string | null; email?: string | null; phone?: string | null } | null;
  const acceptShare = useAcceptShare(buyerContact);
  const requestPick = (quoteId: string) => {
    const winner = rfq ? inviteOfQuote(rfq, quoteId) : null;
    acceptShare.request(winner?.dealerName || "this dealer", () => handlePick(quoteId));
  };

  const handlePick = async (quoteId: string) => {
    setPicking(true);
    setPickError(null);
    const res = await fetch(`/api/rfqs/${rfqId}/pick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...guest.headers },
      body: JSON.stringify({ quoteId }),
    });
    const json = await res.json();
    if (res.ok) {
      setRfq(json.rfq);
      setLeaseCompare(null);
    } else {
      setPickError(json.error || "Could not record your pick.");
    }
    setPicking(false);
  };

  // Buyer counter to one desk: the box supersedes that quote and reopens
  // the invite; the response carries the refreshed rfq.
  const handleCounter = async (inviteId: string, counter: CounterEditsPayload) => {
    const res = await fetch(`/api/rfqs/${rfqId}/invites/${inviteId}/counter`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...guest.headers },
      body: JSON.stringify({ counter }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not send your counter.");
    // Straight to the before/after page — the same table the dealer gets.
    router.push(`/rfq/${rfqId}/counter/${inviteId}`);
    setRfq(json.rfq);
    setLeaseCompare(null);
  };

  const handleWalk = async () => {
    setWalking(true);
    const res = await fetch(`/api/rfqs/${rfqId}/walk`, { method: "POST", headers: guest.headers });
    const json = await res.json();
    if (res.ok) {
      setRfq(json.rfq);
      setLeaseCompare(null);
    }
    setWalking(false);
  };

  if (sessionStatus === "loading" || !guest.ready) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-ink-muted">Loading…</div>;
  }
  if (!canLoad) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center space-y-2">
        <p className="text-sm text-white font-semibold">Please sign in to view this request.</p>
        <button onClick={() => router.push("/")} className="text-xs text-brand-400 hover:text-brand-300">
          Back to TrimScout
        </button>
      </div>
    );
  }
  if (loadError) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-rose-400">{loadError}</div>;
  }
  if (!rfq) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-ink-muted">Loading your request…</div>;
  }

  const quotedInvites = rfq.invites.filter((i) => i.quote);
  const respondedCount = rfq.invites.filter((i) => i.status !== "invited").length;
  const hasQuotes = quotedInvites.length > 0;
  const requestSummary = [
    rfq.leasePrefs ? `${rfq.leasePrefs.termMonths} mo · ${rfq.leasePrefs.milesPerYear.toLocaleString()} mi/yr · ZIP ${rfq.leasePrefs.zip}` : rfq.quotePrefs?.quoteType === "finance" ? `${rfq.quotePrefs.finance.termMonths} mo · $${rfq.quotePrefs.finance.downPayment.toLocaleString()} down` : rfq.quotePrefs ? "Cash" : null,
    `${rfq.invites.length} dealer${rfq.invites.length === 1 ? "" : "s"} invited`,
    rfq.leaseSheetLockedAt ? "sheet locked" : null,
    rfq.dealReference || null,
  ].filter(Boolean).join(" · ");

  const threadInvites = rfq.invites.filter((i) => i.status !== "declined" && i.status !== "expired");
  const threadInvite = threadInvites.find((i) => i.id === threadInviteId) || threadInvites.find((i) => i.quote) || threadInvites[0] || null;

  return (
    <div className="mx-auto max-w-[96rem] lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-2 lg:pr-8" data-testid="deal-screen">
    {acceptShare.dialog}
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 space-y-8 animate-fadeIn">
      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-black text-white">Your Quote Request</h1>
        <p className="text-sm text-ink-muted">
          {rfq.vehicleYear} {rfq.vehicleMake} {rfq.vehicleModel} {rfq.vehicleTrim} · VIN{" "}
          <span className="font-mono">{rfq.vin}</span>
        </p>
      </div>

      <UnsubscribedBanner rfq={rfq} />

      {Object.values(stickerRecheck).map((hit) => (
        <p key={hit.pdfUrl} className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/5 px-4 py-2.5 text-xs text-ink-light" data-testid="sticker-published">
          <span className="rounded bg-positive-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-positive-300">Factory verified</span>
          The factory window sticker for this {hit.make} has been published{hit.msrp ? <> — MSRP ${hit.msrp.toLocaleString()}</> : null}.
          <a href={hit.pdfUrl} target="_blank" rel="noreferrer" className="font-bold text-brand-400 hover:text-brand-300">View sticker</a>
        </p>
      ))}

      {rfq.status === "picked" && (
        <div className="rounded-2xl border border-brand-500/60 bg-brand-950/20 p-5 text-center">
          <p className="text-sm font-bold text-brand-400">You chose this quote</p>
          {rfq.tradeIn ? <p className="mt-1 text-xs text-ink-muted">Your trade value is confirmed in the next step below.</p> : null}
        </div>
      )}
      {rfq.status === "walked" && (
        <div className="rounded-2xl border border-border bg-surface p-5 text-center">
          <p className="text-sm font-bold text-ink-light">No quote chosen</p>
        </div>
      )}

      <BuyerTradeConfirm rfq={rfq} headers={guest.headers} onRfq={(r) => { setRfq(r); setLeaseCompare(null); }} />

      <AddTradeInPrompt rfq={rfq} headers={guest.headers} onRfq={setRfq} />

      {rfq.tradeIn ? <BuyerTradeCard rfqId={rfqId} headers={guest.headers} version={rfq} /> : null}

      {/* Once a dealer has quoted, the compare is the decision surface: it takes the first screen and the
          locked sheet + invited-dealer audit fold into "Request details". Before any quote, the sheet leads. */}
      {hasQuotes ? (
        <>
          {pickError && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
              {pickError}
            </div>
          )}

          {rfq.leasePrefs && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-white">Compare lease quotes</h2>
              <p className="text-[11px] text-ink-muted" data-testid="responded-line">
                {respondedCount} of {rfq.invites.length} dealers have responded so far.
              </p>
              <p className="text-[11px] text-ink-muted">
                You asked for {rfq.leasePrefs.termMonths} months · {rfq.leasePrefs.milesPerYear.toLocaleString()} mi/yr. Counters on term or miles sit in their own block; expired quotes can&apos;t be chosen.
              </p>
              <LeaseCompare data={leaseCompare || analyzeLeaseQuotes(rfq)!} trade={rfq.tradeIn ? { record: rfq.tradeIn, byInvite: Object.fromEntries(rfq.invites.map((i) => [i.id, i.tradeAppraisal ?? null])), confirmations: Object.fromEntries(rfq.invites.map((i) => [i.id, i.tradeConfirmation ?? null])) } : null} collecting={rfq.status === "collecting"} onPick={requestPick} onWalk={handleWalk} onCounter={handleCounter} busy={picking || walking} inviteActions={(id) => { const inv = rfq.invites.find((i) => i.id === id); return inv ? <InviteActions key={id} invite={inv} rfq={rfq} onAction={load} /> : null; }} />
            </div>
          )}

          {rfq.quotePrefs && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-white">Compare {rfq.quotePrefs.quoteType === "finance" ? "finance" : "cash"} quotes</h2>
              <p className="text-[11px] text-ink-muted" data-testid="responded-line">
                {respondedCount} of {rfq.invites.length} dealers have responded so far.
              </p>
              <p className="text-[11px] text-ink-muted">
                {rfq.quotePrefs.quoteType === "finance"
                  ? `You asked for ${rfq.quotePrefs.finance.termMonths} months · $${rfq.quotePrefs.finance.downPayment.toLocaleString()} down. Counters on term or down are flagged; expired quotes can't be chosen.`
                  : isStagedRfq(rfq)
                    ? "Out-the-door = selling price + itemized fees and taxes. Counter here; accept, trade-in and payment are in the steps above."
                    : "Out-the-door = selling price + itemized fees and taxes. Expired quotes can't be chosen."}
              </p>
              {isStagedRfq(rfq) ? <StagedDeals rfq={rfq} buyerContact={buyerContact} headers={guest.headers} onRfq={setRfq} onWalkAll={handleWalk} /> : null}
              <UsedCompare rfq={rfq} prefs={rfq.quotePrefs} staged={isStagedRfq(rfq)} onPick={requestPick} onWalk={handleWalk} onCounter={handleCounter} busy={picking || walking} />
            </div>
          )}

        </>
      ) : null}
      <details className="group rounded-2xl border border-border bg-surface" open={!hasQuotes} data-testid="request-details">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 py-3.5">
          <span className="text-sm font-bold text-white">Request details</span>
          <span className="text-[11px] text-ink-muted">{requestSummary}</span>
        </summary>
        <div className="space-y-6 border-t border-border/60 px-5 pb-5 pt-4">
            {rfq.leasePrefs ? <LeaseQuoteSheet rfq={rfq} onSaved={setRfq} /> : null}

            {/* Used cars: what the buyer told us about the car. */}
            {rfqVehicles(rfq).filter((v) => v.condition !== "new").map((v) => (
              <section key={v.vin} className="rounded-2xl border border-border bg-surface p-5 space-y-2" data-testid="used-ask-sheet">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-white">Used car</h2>
                  <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-300">{v.condition === "cpo" ? "CPO" : "USED"}</span>
                </div>
                <p className="text-[11px] text-ink-muted">
                  VIN <span className="font-mono">{v.vin}</span>
                  {v.mileage != null ? ` · ${v.mileage.toLocaleString()} miles (buyer-entered)` : ""}
                  {v.stockNumber ? ` · stock ${v.stockNumber}` : ""}
                </p>
              </section>
            ))}

            {rfq.packageKind === "links" ? (
              <div className="rounded-2xl border border-border bg-surface p-5 space-y-2">
                <p className="text-[11px] font-bold text-ink-light uppercase tracking-wide">
                  Quote request{rfq.dealReference ? ` · ${rfq.dealReference}` : ""}
                </p>
                <p className="text-[11px] leading-snug text-ink-muted">{rfq.leasePrefs ? LEASE_NON_BINDING_COPY : NON_BINDING_COPY}</p>
                <p className="text-[11px] text-ink-faint">
                  {(rfq.linkPastes || []).length} vehicle{(rfq.linkPastes || []).length === 1 ? "" : "s"} in this request — each desk quotes its own car.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-surface p-5 space-y-2">
                <p className="text-[11px] font-bold text-ink-light uppercase tracking-wide">Locked must-haves</p>
                {rfq.mustHaves.map((m) => (
                  <div key={m.code} className="flex items-start gap-1.5 text-[11px] text-white">
                    <CheckCircle2 className="h-3.5 w-3.5 text-brand-400 shrink-0 mt-0.5" />
                    <span>{formatFactoryOptionLine({ code: m.code, description: m.name })}</span>
                  </div>
                ))}
              </div>
            )}
        </div>
      </details>
      {!hasQuotes ? (
        <>
          {pickError && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
              {pickError}
            </div>
          )}

          {rfq.leasePrefs && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-white">Compare lease quotes</h2>
              <p className="text-[11px] text-ink-muted" data-testid="responded-line">
                {respondedCount} of {rfq.invites.length} dealers have responded so far.
              </p>
              <p className="text-[11px] text-ink-muted">
                You asked for {rfq.leasePrefs.termMonths} months · {rfq.leasePrefs.milesPerYear.toLocaleString()} mi/yr. Counters on term or miles sit in their own block; expired quotes can&apos;t be chosen.
              </p>
              <LeaseCompare data={leaseCompare || analyzeLeaseQuotes(rfq)!} trade={rfq.tradeIn ? { record: rfq.tradeIn, byInvite: Object.fromEntries(rfq.invites.map((i) => [i.id, i.tradeAppraisal ?? null])), confirmations: Object.fromEntries(rfq.invites.map((i) => [i.id, i.tradeConfirmation ?? null])) } : null} collecting={rfq.status === "collecting"} onPick={requestPick} onWalk={handleWalk} onCounter={handleCounter} busy={picking || walking} inviteActions={(id) => { const inv = rfq.invites.find((i) => i.id === id); return inv ? <InviteActions key={id} invite={inv} rfq={rfq} onAction={load} /> : null; }} />
            </div>
          )}

          {rfq.quotePrefs && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-white">Compare {rfq.quotePrefs.quoteType === "finance" ? "finance" : "cash"} quotes</h2>
              <p className="text-[11px] text-ink-muted" data-testid="responded-line">
                {respondedCount} of {rfq.invites.length} dealers have responded so far.
              </p>
              <p className="text-[11px] text-ink-muted">
                {rfq.quotePrefs.quoteType === "finance"
                  ? `You asked for ${rfq.quotePrefs.finance.termMonths} months · $${rfq.quotePrefs.finance.downPayment.toLocaleString()} down. Counters on term or down are flagged; expired quotes can't be chosen.`
                  : isStagedRfq(rfq)
                    ? "Out-the-door = selling price + itemized fees and taxes. Counter here; accept, trade-in and payment are in the steps above."
                    : "Out-the-door = selling price + itemized fees and taxes. Expired quotes can't be chosen."}
              </p>
              {isStagedRfq(rfq) ? <StagedDeals rfq={rfq} buyerContact={buyerContact} headers={guest.headers} onRfq={setRfq} onWalkAll={handleWalk} /> : null}
              <UsedCompare rfq={rfq} prefs={rfq.quotePrefs} staged={isStagedRfq(rfq)} onPick={requestPick} onWalk={handleWalk} onCounter={handleCounter} busy={picking || walking} />
            </div>
          )}

        </>
      ) : null}
      {quotedInvites.length > 0 && !rfq.leasePrefs && !rfq.quotePrefs && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-white">Compare quotes</h2>
              <p className="text-[11px] text-ink-muted" data-testid="responded-line">
                {respondedCount} of {rfq.invites.length} dealers have responded so far.
              </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {quotedInvites.map((invite) => (
              <QuoteCompareCard
                key={invite.id}
                invite={invite}
                rfq={rfq}
                picking={picking}
                onPick={() => invite.quote && requestPick(invite.quote.id)}
              />
            ))}
          </div>
        </div>
      )}

      {rfq.status === "collecting" && !rfq.leasePrefs && !rfq.quotePrefs && (
        <button
          onClick={handleWalk}
          disabled={walking}
          className="flex items-center gap-2 text-xs font-bold text-ink-muted hover:text-rose-400 transition-colors"
        >
          <XIcon className="h-3.5 w-3.5" />
          {walking ? "Recording…" : "Walk away from this request"}
        </button>
      )}

      {rfq.status === "collecting" && quotedInvites.length === 0 && !rfq.leasePrefs && !rfq.quotePrefs && (
        <div className="flex items-center gap-2 text-[11px] text-ink-faint">
          <Clock className="h-3.5 w-3.5" />
          {rfq.leasePrefs
            ? "No lease quotes yet. Each dealer replies through the calculator on their own time — there's no deadline on them and nothing you need to do. We'll show quotes here as they come in."
            : "No quotes yet — check back after dealers respond, or record one above as it comes in."}
        </div>
      )}
      <SiteFooter className="mt-12" />
    </div>
    {threadInvite ? (
      <div className="lg:py-10">
        <DealThreadPanel
          key={threadInvite.id}
          endpoint={`/api/rfqs/${rfq.id}/invites/${threadInvite.id}/thread`}
          viewer="buyer"
          headers={guest.headers}
          seenKey={`thread-seen:buyer:${rfq.id}:${threadInvite.id}`}
          heading={`Conversation with ${threadInvite.dealerName}`}
          headerExtra={threadInvites.length > 1 ? (
            <select value={threadInvite.id} onChange={(e) => setThreadInviteId(e.target.value)} aria-label="Choose a dealer conversation" data-testid="thread-dealer-select" className="mt-1.5 w-full rounded-lg border border-border bg-background px-2 py-1 text-[11px] text-white">
              {threadInvites.map((i) => <option key={i.id} value={i.id}>{i.dealerName}</option>)}
            </select>
          ) : null}
        />
      </div>
    ) : null}
    </div>
  );
}
