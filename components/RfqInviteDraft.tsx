"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CircleCheck as CheckCircle2,
  Copy,
  Plus,
  SendHorizontal,
  Trash2,
} from "lucide-react";
import type { UserProfile } from "../lib/types";
import type { VehicleMatchResult } from "../lib/optionsMatch";
import { formatFactoryOptionLine } from "../lib/fordCompetitionUi";
import { formatCurrency } from "../lib/otdCalculator";
import { dealerHandoffText, freezeMustHaves } from "../lib/rfqLogic";
import { RFQ_MAX_INVITES } from "../lib/rfq";

interface DraftDealer {
  name: string;
  email: string;
}

interface RfqInviteDraftProps {
  result: VehicleMatchResult;
  currentUser?: UserProfile | null;
  onRequireLogin?: () => void;
  onCancel: () => void;
}

export const RfqInviteDraft: React.FC<RfqInviteDraftProps> = ({ result, currentUser, onRequireLogin, onCancel }) => {
  const router = useRouter();
  const v = result.vehicle;
  const [dealers, setDealers] = useState<DraftDealer[]>([{ name: v.location.dealerName, email: "" }]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const spec = {
    vin: v.vin,
    stockNumber: null,
    vehicleYear: v.year,
    vehicleMake: v.make,
    vehicleModel: v.model,
    vehicleTrim: v.trim,
    mustHaves: freezeMustHaves(result.mustHavesHit),
  };
  const handoffText = dealerHandoffText(spec);

  const updateDealer = (i: number, field: keyof DraftDealer, value: string) => {
    setDealers((prev) => prev.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)));
  };
  const removeDealer = (i: number) => setDealers((prev) => prev.filter((_, idx) => idx !== i));
  const addDealer = () => {
    if (dealers.length >= RFQ_MAX_INVITES) return;
    setDealers((prev) => [...prev, { name: "", email: "" }]);
  };

  const validDealers = dealers.filter((d) => d.name.trim().length > 0);
  const canSend = validDealers.length > 0 && !isSending;

  const handleCopyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(handoffText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied — the text is still on screen to select manually.
    }
  };

  const handleConfirmAndSend = async () => {
    if (!currentUser) {
      onRequireLogin?.();
      return;
    }
    if (validDealers.length === 0) return;

    setIsSending(true);
    setError(null);
    try {
      const createRes = await fetch("/api/rfqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vin: spec.vin,
          stockNumber: spec.stockNumber,
          vehicleYear: spec.vehicleYear,
          vehicleMake: spec.vehicleMake,
          vehicleModel: spec.vehicleModel,
          vehicleTrim: spec.vehicleTrim,
          mustHaves: spec.mustHaves,
        }),
      });
      const createJson = await createRes.json();
      if (!createRes.ok) throw new Error(createJson.error || "Could not create this request.");
      const rfqId = createJson.rfq.id as string;

      for (const dealer of validDealers) {
        const inviteRes = await fetch(`/api/rfqs/${rfqId}/invites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealerName: dealer.name.trim(), dealerContactEmail: dealer.email.trim() || null }),
        });
        if (!inviteRes.ok) {
          const inviteJson = await inviteRes.json().catch(() => ({}));
          throw new Error(inviteJson.error || `Could not invite ${dealer.name}.`);
        }
      }

      router.push(`/rfq/${rfqId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong sending these invites.");
      setIsSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 space-y-8 animate-fadeIn">
      <button onClick={onCancel} className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-white transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to shortlist
      </button>

      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-black text-white">Confirm Dealers to Invite</h1>
        <p className="text-sm text-ink-muted leading-relaxed max-w-2xl">
          This asks {RFQ_MAX_INVITES <= 3 ? "a couple of" : "a few"} dealers to quote the exact same car and options — not an
          auction, no countdown. Review who&apos;s invited before anything is sent.
        </p>
      </div>

      <div className="rounded-2xl border border-emerald-500/60 bg-surface p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-white">
              {v.year} {v.make} {v.model} {v.trim}
            </div>
            <div className="text-[11px] text-ink-muted font-mono">VIN {v.vin}</div>
          </div>
          <div className="text-sm font-extrabold text-emerald-400">{formatCurrency(v.dealerPrice)}</div>
        </div>
        <div className="space-y-1 pt-2 border-t border-border/50">
          <p className="text-[11px] font-bold text-ink-light uppercase tracking-wide">Locked must-haves</p>
          {spec.mustHaves.map((m) => (
            <div key={m.code} className="flex items-start gap-1.5 text-[11px] text-white">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <span>{formatFactoryOptionLine({ code: m.code, description: m.name })}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
        <h2 className="text-sm font-bold text-white">Dealers to invite ({validDealers.length}/{RFQ_MAX_INVITES})</h2>
        <div className="space-y-2">
          {dealers.map((d, i) => (
            <div key={i} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={d.name}
                onChange={(e) => updateDealer(i, "name", e.target.value)}
                placeholder="Dealer name"
                className="flex-1 rounded-xl border border-border bg-background py-2 px-3 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
              />
              <input
                type="email"
                value={d.email}
                onChange={(e) => updateDealer(i, "email", e.target.value)}
                placeholder="Dealer email (optional)"
                className="flex-1 rounded-xl border border-border bg-background py-2 px-3 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
              />
              {dealers.length > 1 && (
                <button
                  onClick={() => removeDealer(i)}
                  className="flex items-center justify-center rounded-xl border border-border px-3 py-2 text-ink-muted hover:text-rose-400 hover:border-rose-400/40 transition-colors shrink-0"
                  aria-label={`Remove ${d.name || "this dealer"}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        {dealers.length < RFQ_MAX_INVITES && (
          <button
            onClick={addDealer}
            className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add another dealer
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">Request template</h2>
          <button
            onClick={handleCopyTemplate}
            className="flex items-center gap-1.5 text-[11px] font-bold text-ink-light hover:text-white transition-colors"
          >
            <Copy className="h-3 w-3" />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-[11px] text-ink-muted">
          Send this same text to each dealer above (email, text, or read aloud on a call). It says plainly this is a request
          for a quote — never a binding bid or a 24-hour deadline.
        </p>
        <pre className="whitespace-pre-wrap rounded-xl border border-border bg-background p-3 text-[11px] text-ink-light font-mono leading-relaxed">
          {handoffText}
        </pre>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">{error}</div>
      )}

      <button
        onClick={handleConfirmAndSend}
        disabled={!canSend}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 text-sm font-extrabold text-black hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <SendHorizontal className="h-4 w-4" />
        {isSending ? "Sending…" : `Confirm & Invite ${validDealers.length || ""} ${validDealers.length === 1 ? "Dealer" : "Dealers"}`}
      </button>
    </div>
  );
};
