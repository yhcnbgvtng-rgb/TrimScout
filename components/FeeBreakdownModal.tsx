"use client";

import React, { useState } from "react";
import { DealerBid, UserProfile } from "../lib/types";
import { formatCurrency, formatPercent } from "../lib/otdCalculator";
import { PLATFORM_FEE_CENTS } from "../lib/pricing";
import {
  X,
  ShieldCheck,
  FileText,
  CircleCheck as CheckCircle2,
  Lock,
  Loader2
} from "lucide-react";

interface FeeBreakdownModalProps {
  bid: DealerBid | null;
  isOpen: boolean;
  currentUser: UserProfile | null;
  onClose: () => void;
  onRequireLogin: () => void;
}

export const FeeBreakdownModal: React.FC<FeeBreakdownModalProps> = ({
  bid,
  isOpen,
  currentUser,
  onClose,
  onRequireLogin,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !bid) return null;

  const handleLockIn = async () => {
    if (!currentUser) {
      onClose();
      onRequireLogin();
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      // Real bids have purely numeric DB ids; the older client-fabricated
      // demo bids (BidProgramIntro's mock path) use ids like "bid-1" —
      // only send {dealRequestId, bidId} when both are real, so the server
      // fetches authoritative unmasked data instead of trusting this
      // (possibly masked) client object.
      const isReal = /^\d+$/.test(bid.id) && /^\d+$/.test(bid.dealRequestId);
      const res = await fetch("/api/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isReal ? { dealRequestId: bid.dealRequestId, bidId: bid.id } : { winningBid: bid }
        ),
      });
      const json = await res.json();
      if (!res.ok || !json.url) {
        throw new Error(json.error || "Could not start checkout.");
      }
      // Full redirect to Stripe's hosted checkout page — the buyer enters
      // their card there, never on this page.
      window.location.href = json.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-surface-elevated px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Itemized Out-The-Door (OTD) Invoice</h2>
              <p className="text-xs text-ink-muted">
                {bid.dealerName}
                {bid.matchedVin && ` • VIN #${bid.matchedVin.slice(-6)}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-muted hover:bg-border hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Invoice Body */}
        <div className="p-6 space-y-5 text-xs">
          {/* Matched Car Summary */}
          <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
            <div className="text-[10px] uppercase font-bold text-emerald-400">Matched Spec</div>
            <div className="font-bold text-white text-sm">{bid.matchedVehicleTitle}</div>
            <div className="text-ink-muted text-[11px]">{bid.matchedVehicleSpec}</div>
          </div>

          {/* Line Items */}
          <div className="space-y-2 border-t border-border/60 pt-3">
            <div className="flex justify-between py-1 text-ink-muted">
              <span>Total Window Sticker MSRP:</span>
              <span className="text-white font-mono font-medium">{formatCurrency(bid.msrp)}</span>
            </div>

            <div className="flex justify-between py-1 text-emerald-400 font-medium bg-emerald-500/5 px-2 rounded-lg">
              <span>Dealer Discount ({formatPercent(bid.dealerDiscountPercent)} off MSRP):</span>
              <span className="font-mono font-bold">-{formatCurrency(bid.dealerDiscountDollars)}</span>
            </div>

            {bid.manufacturerRebates > 0 && (
              <div className="flex justify-between py-1 text-emerald-400 font-medium bg-emerald-500/5 px-2 rounded-lg">
                <span>Manufacturer Rebates / Bonus Cash:</span>
                <span className="font-mono font-bold">-{formatCurrency(bid.manufacturerRebates)}</span>
              </div>
            )}

            <div className="flex justify-between py-1 text-ink-light font-bold border-t border-border/40 pt-2">
              <span>Net Vehicle Selling Price:</span>
              <span className="text-white font-mono text-sm">{formatCurrency(bid.sellingPrice)}</span>
            </div>
          </div>

          {/* Taxes & Mandatory Gov Fees */}
          <div className="space-y-2 border-t border-border/60 pt-3">
            <div className="text-[10px] uppercase font-bold text-ink-faint tracking-wider">
              Mandatory Government & State Fees
            </div>

            <div className="flex justify-between py-1 text-ink-muted">
              <span>State & County Sales Tax:</span>
              <span className="text-ink-light font-mono">+{formatCurrency(bid.salesTax)}</span>
            </div>

            <div className="flex justify-between py-1 text-ink-muted">
              <span>DMV Registration & Title Fees:</span>
              <span className="text-ink-light font-mono">+{formatCurrency(bid.dmvFees)}</span>
            </div>

            <div className="flex justify-between py-1 text-ink-muted">
              <span>State-Capped Documentation Fee:</span>
              <span className="text-ink-light font-mono">+{formatCurrency(bid.docFee)}</span>
            </div>

            <div className="flex justify-between py-1 text-emerald-400 font-medium">
              <span>Mandatory Dealer Accessories / Add-ons:</span>
              <span className="font-mono font-bold">$0 (Verified $0)</span>
            </div>
          </div>

          {/* Grand Total OTD */}
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-4 space-y-1">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-extrabold text-emerald-400 tracking-wider">
                  FINAL OUT-THE-DOOR (OTD) PRICE
                </span>
                <div className="text-2xl font-extrabold text-white">
                  {formatCurrency(bid.totalOtdPrice)}
                </div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-black shadow-lg">
                <CheckCircle2 className="h-6 w-6 stroke-[2.5]" />
              </div>
            </div>
            <p className="text-[11px] text-ink-muted pt-1">
              Includes vehicle price, all taxes, DMV registration, and dealer fees. $0 extra fees permitted at signing.
            </p>
          </div>

          {/* Protection Note */}
          <div className="flex items-center gap-2 text-[11px] text-ink-muted bg-surface-elevated p-2.5 rounded-lg border border-border">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>Protected by TrimScout $500 Price Protection Policy against dealer markup.</span>
          </div>

          {/* Platform Fee — separate from the OTD price above, which is paid
              to the dealer directly at signing/delivery. */}
          <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-white">TrimScout Deal Lock-In Fee</span>
              <span className="font-mono font-bold text-white text-sm">
                {formatCurrency(PLATFORM_FEE_CENTS / 100)}
              </span>
            </div>
            <p className="text-[10px] text-ink-faint leading-relaxed">
              Charged now to lock this price with {bid.dealerName} and hold them to it. Paid to TrimScout, separate
              from the vehicle price/taxes/fees above, which are paid to the dealer at signing.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border bg-surface-elevated px-6 py-4">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink-light hover:bg-border transition-colors disabled:opacity-50"
          >
            Close
          </button>
          <button
            onClick={handleLockIn}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-5 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20 active:scale-95 disabled:opacity-60 disabled:active:scale-100"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Redirecting to payment…
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5" /> Lock In This Deal — Pay {formatCurrency(PLATFORM_FEE_CENTS / 100)}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
