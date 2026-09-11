"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
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
import { isQuoteComplete, quoteMatchesLockedSpec } from "@/lib/rfqLogic";
import { inviteStage, DESK_ROLE_LABELS, NON_BINDING_COPY } from "@/lib/quotePackage";
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
            className="w-full rounded-lg border border-border bg-surface py-2 px-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-ink-light">Quote expires</span>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 px-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
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
              className="flex-1 rounded-lg border border-border bg-surface py-1.5 px-2.5 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
            />
            <input
              type="number"
              value={f.amount}
              onChange={(e) => updateFee(i, "amount", e.target.value)}
              placeholder="Amount"
              className="w-28 rounded-lg border border-border bg-surface py-1.5 px-2.5 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
            />
            {fees.length > 1 && (
              <button onClick={() => removeFee(i)} className="text-ink-muted hover:text-rose-400">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        <button onClick={addFee} className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300">
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
            className="w-full rounded-lg border border-border bg-surface py-2 px-2.5 text-xs text-white font-mono focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-ink-light">Stock # (optional)</span>
          <input
            type="text"
            value={stockNumber}
            onChange={(e) => setStockNumber(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 px-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
          />
        </label>
      </div>

      <label className="space-y-1 block">
        <span className="text-[10px] font-bold uppercase text-ink-light">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border bg-surface py-2 px-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
        />
      </label>

      <label className="flex items-start gap-2 text-[11px] text-ink-light cursor-pointer">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-border text-emerald-500 focus:ring-0" />
        <span>The dealer confirmed all locked must-haves are on this VIN before quoting.</span>
      </label>

      {error && <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">{error}</div>}

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex-1 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all disabled:opacity-50"
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
        className="w-full rounded-lg border border-border bg-surface py-2 px-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
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

function InviteRow({ invite, rfq, onAction }: { invite: RfqInvite; rfq: RfqRequest; onAction: () => void }) {
  const [mode, setMode] = useState<"idle" | "quote" | "decline">("idle");

  const submitQuote = async (input: Parameters<React.ComponentProps<typeof QuoteIntakeForm>["onSubmit"]>[0]) => {
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

  const stage = inviteStage(invite);
  const statusChip = {
    queued: { label: "Queued", cls: "bg-border text-ink-muted border-border" },
    sent: { label: "Sent", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    viewed: { label: "Opened by dealer", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    quoted: { label: "Quoted", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
    declined: { label: "Declined", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
    expired: { label: "Expired", cls: "bg-border text-ink-muted border-border" },
  }[stage];
  const audit = [
    invite.queuedAt ? `queued ${new Date(invite.queuedAt).toLocaleString()}` : null,
    invite.sentAt ? `sent ${new Date(invite.sentAt).toLocaleString()}` : null,
    invite.viewedAt ? `opened ${new Date(invite.viewedAt).toLocaleString()}` : null,
    invite.respondedAt ? `replied ${new Date(invite.respondedAt).toLocaleString()}` : null,
  ].filter(Boolean);

  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-white">{invite.dealerName}</div>
          {invite.desk ? (
            <div className="text-[11px] text-ink-muted">
              {invite.desk.contactName}
              {invite.desk.role ? ` · ${(DESK_ROLE_LABELS as Record<string, string>)[invite.desk.role] || invite.desk.role}` : ""}
              {invite.desk.emailMasked ? <span className="font-mono"> · {invite.desk.emailMasked}</span> : null}
            </div>
          ) : null}
          {invite.vehicle ? (
            <div className="text-[11px] text-ink-faint">
              {[invite.vehicle.year, invite.vehicle.make, invite.vehicle.model, invite.vehicle.trim].filter(Boolean).join(" ")}
              <span className="font-mono"> · {invite.vehicle.vin}</span>
            </div>
          ) : null}
          {audit.length > 0 ? <div className="text-[10px] text-ink-faint">{audit.join(" · ")}</div> : null}
        </div>
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase border ${statusChip.cls}`}>{statusChip.label}</span>
      </div>
      {invite.status === "declined" && invite.declineReason && (
        <p className="text-[11px] text-ink-muted">Reason: {RFQ_DECLINE_REASON_LABELS[invite.declineReason]}</p>
      )}
      {invite.status === "invited" && mode === "idle" && (
        <div className="flex gap-2">
          <button
            onClick={() => setMode("quote")}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-extrabold text-black hover:bg-emerald-400"
          >
            Record Dealer&apos;s Quote
          </button>
          <button
            onClick={() => setMode("decline")}
            className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-ink-light hover:text-white"
          >
            Mark Declined
          </button>
        </div>
      )}
      {mode === "quote" && (
        <QuoteIntakeForm rfqVin={rfq.vin} rfqStockNumber={rfq.stockNumber} onSubmit={submitQuote} onCancel={() => setMode("idle")} />
      )}
      {mode === "decline" && <DeclineForm onSubmit={submitDecline} onCancel={() => setMode("idle")} />}
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
    <div className={`rounded-2xl border p-4 space-y-3 bg-surface ${isPicked ? "border-emerald-500/60" : "border-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-bold text-white">{invite.dealerName}</div>
        <div className="text-sm font-extrabold text-emerald-400">{formatCurrency(q.totalOtdPrice)}</div>
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
        <span className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold border ${specOk ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-rose-500/15 text-rose-300 border-rose-500/30"}`}>
          {specOk ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
          {specOk ? "Same VIN/stock" : "Different VIN/stock"}
        </span>
        <span className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold border ${complete ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-amber-500/15 text-amber-300 border-amber-500/30"}`}>
          {complete ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {complete ? "Complete quote" : "Missing fields"}
        </span>
      </div>
      {rfq.status === "collecting" && (
        <button
          onClick={onPick}
          disabled={picking}
          className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all disabled:opacity-50"
        >
          Choose This Quote
        </button>
      )}
      {isPicked && <div className="text-center text-[11px] font-bold text-emerald-400">You chose this quote</div>}
    </div>
  );
}

export default function RfqWorkspacePage() {
  const params = useParams();
  const rfqId = params.id as string;
  const router = useRouter();
  const { status: sessionStatus } = useSession();

  const [rfq, setRfq] = useState<RfqRequest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [walking, setWalking] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/rfqs/${rfqId}`);
    const json = await res.json();
    if (!res.ok) {
      setLoadError(json.error || "Could not load this request.");
      return;
    }
    setRfq(json.rfq);
  }, [rfqId]);

  useEffect(() => {
    if (sessionStatus === "authenticated") load();
  }, [sessionStatus, load]);

  const handlePick = async (quoteId: string) => {
    setPicking(true);
    setPickError(null);
    const res = await fetch(`/api/rfqs/${rfqId}/pick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteId }),
    });
    const json = await res.json();
    if (res.ok) {
      setRfq(json.rfq);
    } else {
      setPickError(json.error || "Could not record your pick.");
    }
    setPicking(false);
  };

  const handleWalk = async () => {
    setWalking(true);
    const res = await fetch(`/api/rfqs/${rfqId}/walk`, { method: "POST" });
    const json = await res.json();
    if (res.ok) setRfq(json.rfq);
    setWalking(false);
  };

  if (sessionStatus === "loading") {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-ink-muted">Loading…</div>;
  }
  if (sessionStatus !== "authenticated") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center space-y-2">
        <p className="text-sm text-white font-semibold">Please sign in to view this request.</p>
        <button onClick={() => router.push("/")} className="text-xs text-emerald-400 hover:text-emerald-300">
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 space-y-8 animate-fadeIn">
      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-black text-white">Your Quote Request</h1>
        <p className="text-sm text-ink-muted">
          {rfq.vehicleYear} {rfq.vehicleMake} {rfq.vehicleModel} {rfq.vehicleTrim} · VIN{" "}
          <span className="font-mono">{rfq.vin}</span>
        </p>
      </div>

      {rfq.packageKind === "links" ? (
        <div className="rounded-2xl border border-border bg-surface p-5 space-y-2">
          <p className="text-[11px] font-bold text-ink-light uppercase tracking-wide">
            Quote request{rfq.dealReference ? ` · ${rfq.dealReference}` : ""}
          </p>
          <p className="text-[11px] leading-snug text-ink-muted">{NON_BINDING_COPY}</p>
          <p className="text-[11px] text-ink-faint">
            {(rfq.linkPastes || []).length} vehicle{(rfq.linkPastes || []).length === 1 ? "" : "s"} in this request — each desk quotes its own car.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-5 space-y-2">
          <p className="text-[11px] font-bold text-ink-light uppercase tracking-wide">Locked must-haves</p>
          {rfq.mustHaves.map((m) => (
            <div key={m.code} className="flex items-start gap-1.5 text-[11px] text-white">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <span>{formatFactoryOptionLine({ code: m.code, description: m.name })}</span>
            </div>
          ))}
        </div>
      )}

      {rfq.status === "picked" && (
        <div className="rounded-2xl border border-emerald-500/60 bg-emerald-950/20 p-5 text-center">
          <p className="text-sm font-bold text-emerald-400">You chose this quote</p>
        </div>
      )}
      {rfq.status === "walked" && (
        <div className="rounded-2xl border border-border bg-surface p-5 text-center">
          <p className="text-sm font-bold text-ink-light">No quote chosen</p>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-bold text-white">Invited dealers</h2>
        {rfq.invites.length === 0 ? (
          <p className="text-xs text-ink-muted">No dealers invited yet.</p>
        ) : (
          <>
            <p className="text-[11px] text-ink-muted">
              {respondedCount} of {rfq.invites.length} dealers have responded so far.
            </p>
            {rfq.invites.map((invite) => (
              <InviteRow key={invite.id} invite={invite} rfq={rfq} onAction={load} />
            ))}
          </>
        )}
      </div>

      {pickError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
          {pickError}
        </div>
      )}

      {quotedInvites.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-white">Compare quotes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {quotedInvites.map((invite) => (
              <QuoteCompareCard
                key={invite.id}
                invite={invite}
                rfq={rfq}
                picking={picking}
                onPick={() => invite.quote && handlePick(invite.quote.id)}
              />
            ))}
          </div>
        </div>
      )}

      {rfq.status === "collecting" && (
        <button
          onClick={handleWalk}
          disabled={walking}
          className="flex items-center gap-2 text-xs font-bold text-ink-muted hover:text-rose-400 transition-colors"
        >
          <XIcon className="h-3.5 w-3.5" />
          {walking ? "Recording…" : "Walk away from this request"}
        </button>
      )}

      {rfq.status === "collecting" && quotedInvites.length === 0 && (
        <div className="flex items-center gap-2 text-[11px] text-ink-faint">
          <Clock className="h-3.5 w-3.5" />
          No quotes yet — check back after dealers respond, or record one above as it comes in.
        </div>
      )}
    </div>
  );
}
