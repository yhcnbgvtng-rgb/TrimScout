"use client";

import React from "react";
import { DealerBid } from "../lib/types";
import { formatCurrency, formatPercent } from "../lib/otdCalculator";
import { X, ShieldCheck, FileText, CheckCircle2, Lock } from "lucide-react";

interface FeeBreakdownModalProps {
  bid: DealerBid | null;
  isOpen: boolean;
  onClose: () => void;
  onAcceptDeal: (bid: DealerBid) => void;
}

export const FeeBreakdownModal: React.FC<FeeBreakdownModalProps> = ({
  bid,
  isOpen,
  onClose,
  onAcceptDeal,
}) => {
  if (!isOpen || !bid) return null;

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
              <p className="text-xs text-ink-muted">{bid.dealerName} • VIN #{bid.matchedVin.slice(-6)}</p>
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border bg-surface-elevated px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink-light hover:bg-border transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => {
              onAcceptDeal(bid);
              onClose();
            }}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-5 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20 active:scale-95"
          >
            <Lock className="h-3.5 w-3.5" /> Lock In This Deal
          </button>
        </div>
      </div>
    </div>
  );
};
