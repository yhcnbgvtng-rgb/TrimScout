"use client";

import React from "react";
import { LockedDeal } from "../lib/types";
import { formatCurrency } from "../lib/otdCalculator";
import {
  X,
  CircleCheck as CheckCircle2,
  ShieldCheck,
  Printer,
  Download,
  Phone,
  Calendar,
  Clock
} from "lucide-react";

interface VoucherModalProps {
  deal: LockedDeal | null;
  isOpen: boolean;
  onClose: () => void;
}

export const VoucherModal: React.FC<VoucherModalProps> = ({
  deal,
  isOpen,
  onClose,
}) => {
  if (!isOpen || !deal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-2xl border-2 border-emerald-500 bg-surface shadow-2xl overflow-hidden my-8">
        {/* Certificate Header Banner */}
        <div className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 p-6 text-black relative overflow-hidden">
          <div className="flex items-start justify-between relative z-10">
            <div>
              <div className="inline-flex items-center gap-1 rounded-full bg-black/20 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-black mb-1">
                <CheckCircle2 className="h-3 w-3" /> Deal Locked & Confirmed
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight">
                Out-The-Door Deal Voucher
              </h2>
              <p className="text-xs font-semibold text-black/80 mt-0.5">
                Certificate #{deal.certificateId}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg bg-black/20 p-1 text-black hover:bg-black/40 transition-colors"
            >
              <X className="h-5 w-5 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Certificate Details */}
        <div className="p-6 space-y-5 text-xs">
          {/* Main Locked Price Card */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-emerald-400">Locked Out-The-Door Price</span>
              <div className="text-2xl sm:text-3xl font-black text-white">
                {formatCurrency(deal.winningBid.totalOtdPrice)}
              </div>
              <p className="text-[11px] text-ink-muted mt-0.5">
                Includes MSRP, {deal.winningBid.dealerDiscountPercent}% dealer discount, taxes, DMV, and fees.
              </p>
            </div>
            <div className="text-right">
              <span className="rounded bg-emerald-500/20 px-2 py-1 text-[11px] font-bold text-emerald-400 border border-emerald-500/30">
                {deal.winningBid.dealerDiscountPercent}% OFF MSRP
              </span>
            </div>
          </div>

          {/* Vehicle & Dealer Info Grid */}
          <div className="grid grid-cols-2 gap-3">
            {/* Vehicle Box */}
            <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
              <span className="text-[10px] uppercase font-bold text-ink-faint">Matched Vehicle</span>
              <div className="font-bold text-white text-xs truncate">{deal.winningBid.matchedVehicleTitle}</div>
              <div className="text-ink-muted text-[11px] font-mono truncate">VIN: {deal.winningBid.matchedVin}</div>
            </div>

            {/* Dealer Box */}
            <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
              <span className="text-[10px] uppercase font-bold text-ink-faint">Selling Dealership</span>
              <div className="font-bold text-emerald-400 text-xs truncate">{deal.winningBid.dealerName}</div>
              <div className="text-ink-muted text-[11px] truncate">
                {deal.winningBid.dealerCity}, {deal.winningBid.dealerState} ({deal.winningBid.distanceMiles} mi away)
              </div>
            </div>
          </div>

          {/* Live Paperwork Status & Dispatch Tracker */}
          <div className={`rounded-xl border p-3.5 space-y-1.5 ${
            deal.paperworkStatus === "uploaded"
              ? "border-emerald-500/40 bg-emerald-950/20"
              : "border-blue-500/30 bg-blue-950/20"
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-ink-light flex items-center gap-1.5">
                {deal.paperworkStatus === "uploaded" ? (
                  <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Digital Sales Contract Ready</>
                ) : (
                  <><Clock className="h-3.5 w-3.5 text-blue-400 animate-spin" /> Dealership Paperwork Upload In Progress</>
                )}
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                deal.paperworkStatus === "uploaded"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-blue-500/20 text-blue-300"
              }`}>
                {deal.paperworkStatus === "uploaded" ? "Ready for E-Sign" : "Message Sent to Dealer"}
              </span>
            </div>

            <p className="text-[11px] text-ink-muted leading-relaxed">
              {deal.paperworkStatus === "uploaded" ? (
                <>
                  <strong className="text-white">{deal.winningBid.dealerName}</strong> uploaded{" "}
                  <span className="text-emerald-400 font-mono font-semibold">{deal.uploadedContractName}</span>. Review and e-sign from your phone or laptop.
                </>
              ) : (
                <>
                  An automated alert was sent to <strong className="text-white">{deal.winningBid.dealerName}</strong> to upload the completed purchase agreement matching your exact{" "}
                  <strong className="text-emerald-400">{formatCurrency(deal.winningBid.totalOtdPrice)} OTD price</strong>.
                </>
              )}
            </p>
          </div>

          {/* Assigned Sales Director Contact */}
          <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2">
            <div className="text-[10px] uppercase font-bold text-ink-light flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-emerald-400" /> Assigned Dealership Executive Contact
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-white text-sm">{deal.winningBid.salesRep.name}</div>
                <div className="text-ink-muted text-xs">{deal.winningBid.salesRep.title}</div>
              </div>
              <div className="text-right">
                <div className="font-mono font-bold text-emerald-400 text-sm">{deal.winningBid.salesRep.phone}</div>
                <span className="text-[10px] text-ink-faint">Direct Line</span>
              </div>
            </div>
          </div>

          {/* Protection Policy */}
          <div className="rounded-xl border border-border bg-surface-elevated p-3 flex items-start gap-2.5 text-[11px] text-ink-light">
            <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-white">$500 Purchase Protection Policy</div>
              <p className="text-ink-muted mt-0.5 leading-relaxed">
                Show this voucher upon arrival. If the dealership attempts to charge a higher price or add unauthorized accessories, report it to claim your $500 protection credit.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-border bg-surface-elevated px-6 py-4">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink-light hover:bg-border transition-colors"
          >
            <Printer className="h-4 w-4" /> Print Voucher
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-5 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20"
          >
            <Calendar className="h-4 w-4 stroke-[2.5]" /> Schedule Delivery
          </button>
        </div>
      </div>
    </div>
  );
};
