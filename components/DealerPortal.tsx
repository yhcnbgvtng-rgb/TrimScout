"use client";

import React, { useState } from "react";
import { Vehicle, BiddingRequest, DealerBid, LockedDeal, TradeInVehicle, TradeInPhoto } from "../lib/types";
import { formatCurrency, calculateOtd } from "../lib/otdCalculator";
import {
  Building2,
  TrendingUp,
  Zap,
  CircleCheck as CheckCircle2,
  Clock,
  MapPin,
  Percent,
  ShieldCheck,
  Send,
  CloudUpload as UploadCloud,
  FileText,
  FileCheck,
  Truck,
  CircleAlert as AlertCircle,
  Sparkles,
  Camera,
  Eye,
  Image as ImageIcon,
  DollarSign
} from "lucide-react";

interface DealerPortalProps {
  requests: BiddingRequest[];
  bids: DealerBid[];
  vehicles: Vehicle[];
  lockedDeal: LockedDeal | null;
  onDealerSubmitBid: (bid: DealerBid) => void;
  onDealerUploadPaperwork: (contractName: string, deliveryType: "driveway_delivery" | "express_pickup") => void;
  onSwitchToBuyerView: () => void;
}

export const DealerPortal: React.FC<DealerPortalProps> = ({
  requests,
  bids,
  vehicles,
  lockedDeal,
  onDealerSubmitBid,
  onDealerUploadPaperwork,
  onSwitchToBuyerView,
}) => {
  const [activeTab, setActiveTab] = useState<"leads" | "my_bids" | "locked_deals">(
    lockedDeal ? "locked_deals" : "leads"
  );
  const [selectedRequest, setSelectedRequest] = useState<BiddingRequest | null>(requests[0] || null);
  const [isBidModalOpen, setIsBidModalOpen] = useState<boolean>(false);

  // Trade-In Photo Lightbox Modal State
  const [tradeInToInspect, setTradeInToInspect] = useState<TradeInVehicle | null>(null);

  // Paperwork Upload Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [selectedFileName, setSelectedFileName] = useState<string>(
    "BMW_Official_Purchase_Agreement_VIN892110.pdf"
  );
  const [deliveryMethod, setDeliveryMethod] = useState<"driveway_delivery" | "express_pickup">(
    "driveway_delivery"
  );

  // Bid Creation Modal State
  const [selectedVehicleVin, setSelectedVehicleVin] = useState<string>(vehicles[0]?.vin || "");
  const [discountPercent, setDiscountPercent] = useState<number>(8.5);
  const [rebates, setRebates] = useState<number>(1000);
  const [tradeInAllowance, setTradeInAllowance] = useState<number>(25500);
  const [dealerNotes, setDealerNotes] = useState<string>(
    "Vehicle in stock on showroom floor. $0 dealer add-ons. Full trade-in value honored upon physical VIN inspection."
  );

  const matchedVehicle = vehicles.find((v) => v.vin === selectedVehicleVin) || vehicles[0];

  const otdPreview = calculateOtd({
    msrp: matchedVehicle ? matchedVehicle.msrp : 54200,
    discountPercent,
    rebates,
    zipCode: selectedRequest?.buyerZip || "94107",
  });

  const hasCustomerTradeIn = Boolean(selectedRequest?.tradeIn?.hasTradeIn);
  const finalNetOtdWithTrade = hasCustomerTradeIn
    ? Math.max(0, otdPreview.totalOtdPrice - tradeInAllowance)
    : otdPreview.totalOtdPrice;

  const handleOpenBidModal = (req: BiddingRequest) => {
    setSelectedRequest(req);
    setIsBidModalOpen(true);
  };

  const handleTransmitBid = () => {
    if (!selectedRequest || !matchedVehicle) return;

    const newBid: DealerBid = {
      id: `bid-dealer-${Date.now()}`,
      dealRequestId: selectedRequest.id,
      dealerName: "BMW of San Rafael",
      dealerCity: "San Rafael",
      dealerState: "CA",
      distanceMiles: 14,
      matchedVin: matchedVehicle.vin,
      matchedVehicleTitle: `${matchedVehicle.year} ${matchedVehicle.make} ${matchedVehicle.model} ${matchedVehicle.trim}`,
      matchedVehicleSpec: matchedVehicle.packages.slice(0, 3).join(" • "),
      matchedVehicleImageUrl: matchedVehicle.imageUrl,
      vehicleStatus: matchedVehicle.status === "in_transit" ? "in_transit" : "on_lot",
      msrp: otdPreview.msrp,
      dealerDiscountDollars: otdPreview.discountDollars,
      dealerDiscountPercent: otdPreview.discountPercent,
      manufacturerRebates: otdPreview.rebates,
      sellingPrice: otdPreview.sellingPrice,
      salesTax: otdPreview.salesTax,
      dmvFees: otdPreview.dmvFees,
      docFee: otdPreview.docFee,
      dealerAccessories: 0,
      tradeInAllowance: hasCustomerTradeIn ? tradeInAllowance : undefined,
      totalOtdPrice: otdPreview.totalOtdPrice,
      netOtdWithTradeIn: hasCustomerTradeIn ? finalNetOtdWithTrade : undefined,
      notes: dealerNotes,
      rank: 1,
      createdAt: "Just now",
      isTopDeal: true,
      salesRep: {
        name: "Marcus Vance",
        title: "Internet Sales Director",
        phone: "(415) 555-0199",
      },
    };

    onDealerSubmitBid(newBid);
    setIsBidModalOpen(false);
  };

  const handleConfirmUploadPaperwork = () => {
    onDealerUploadPaperwork(selectedFileName, deliveryMethod);
    setIsUploadModalOpen(false);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
            <Building2 className="h-6 w-6 stroke-[2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white">Dealer Partner Portal</h1>
              <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Verified Partner
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              Logged in as: <strong className="text-white">BMW of San Rafael</strong> (San Rafael, CA • Territory: 150 mi)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onSwitchToBuyerView}
            className="rounded-xl border border-border bg-surface px-4 py-2 text-xs font-semibold text-ink-light hover:text-white hover:bg-border transition-all"
          >
            ← Switch to Customer View
          </button>
        </div>
      </div>

      {/* URGENT DEAL WON BANNER */}
      {lockedDeal && (
        <div className="rounded-2xl border-2 border-emerald-500 bg-gradient-to-r from-emerald-950/40 via-surface-elevated to-surface p-5 space-y-3 shadow-xl animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-black font-extrabold shadow-lg">
                <Sparkles className="h-5 w-5 fill-black" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm sm:text-base font-black text-white">
                    Deal Accepted by Buyer #{lockedDeal.certificateId.slice(-4)}!
                  </h3>
                  <span className="rounded bg-emerald-500 text-black px-2 py-0.5 text-[10px] font-black uppercase">
                    ACTION REQUIRED
                  </span>
                </div>
                <p className="text-xs text-ink-muted mt-0.5">
                  Customer accepted your binding OTD bid of <strong className="text-emerald-400 font-mono">{formatCurrency(lockedDeal.winningBid.totalOtdPrice)}</strong>. Please upload the finalized purchase contract and e-sign documents.
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2 shrink-0 active:scale-95"
            >
              <UploadCloud className="h-4 w-4" />
              <span>{lockedDeal.paperworkStatus === "uploaded" ? "Update Paperwork" : "Upload Sales Contract Now →"}</span>
            </button>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Active Inbound Deals</div>
          <div className="text-2xl font-black text-white flex items-center gap-2">
            {requests.length}
            <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">Live</span>
          </div>
          <p className="text-[10px] text-ink-faint">In your 150-mile radius</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Bids Transmitted</div>
          <div className="text-2xl font-black text-blue-400">{bids.length}</div>
          <p className="text-[10px] text-ink-faint">Active in customer war rooms</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Deals Won & Locked</div>
          <div className="text-2xl font-black text-emerald-400">{lockedDeal ? "8" : "7"}</div>
          <p className="text-[10px] text-ink-faint">$0 doc fee policy</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Paperwork Status</div>
          <div className="text-2xl font-black text-amber-400">
            {lockedDeal && lockedDeal.paperworkStatus === "uploaded" ? "Uploaded" : lockedDeal ? "1 Pending" : "All Clear"}
          </div>
          <p className="text-[10px] text-ink-faint">24-hr turnaround target</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <button
          onClick={() => setActiveTab("leads")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
            activeTab === "leads"
              ? "bg-emerald-500 text-black shadow-md"
              : "bg-surface text-ink-muted hover:text-white border border-border"
          }`}
        >
          <Zap className="h-4 w-4" />
          <span>Inbound Deal Opportunities ({requests.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("my_bids")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
            activeTab === "my_bids"
              ? "bg-emerald-500 text-black shadow-md"
              : "bg-surface text-ink-muted hover:text-white border border-border"
          }`}
        >
          <TrendingUp className="h-4 w-4" />
          <span>Active Bids & Tracker ({bids.length})</span>
        </button>

        {lockedDeal && (
          <button
            onClick={() => setActiveTab("locked_deals")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              activeTab === "locked_deals"
                ? "bg-emerald-500 text-black shadow-md"
                : "bg-surface text-emerald-400 hover:text-white border border-emerald-500/30"
            }`}
          >
            <FileCheck className="h-4 w-4" />
            <span>Won Deals & Paperwork (1 Active)</span>
          </button>
        )}
      </div>

      {/* TAB 1: Inbound Deals */}
      {activeTab === "leads" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Certified Deal Broadcasts matching your brand portfolio (BMW)</span>
            <span className="text-emerald-400 font-medium">● Real-Time Feed Active</span>
          </div>

          <div className="space-y-3.5">
            {requests.map((req) => (
              <div
                key={req.id}
                className="rounded-2xl border border-border-strong bg-surface p-5 space-y-4 shadow-lg hover:border-emerald-500/50 transition-all"
              >
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-mono font-bold text-emerald-400 border border-emerald-500/30">
                        Buyer #CA-4921
                      </span>
                      <span className="rounded-md bg-surface-elevated px-2 py-0.5 text-xs font-semibold text-ink-light border border-border flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-emerald-400" /> {req.buyerZip} (14 mi away)
                      </span>
                      <span className="rounded-md bg-blue-500/20 px-2 py-0.5 text-xs font-bold text-blue-400 border border-blue-500/30 flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Expires in 48h
                      </span>
                      <span className="rounded-md bg-purple-500/20 px-2 py-0.5 text-xs font-bold text-purple-400 border border-purple-500/30 uppercase">
                        {req.paymentMethod}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-lg font-black text-white">
                        {req.targetVehicle
                          ? `${req.targetVehicle.year} ${req.targetVehicle.make} ${req.targetVehicle.model} ${req.targetVehicle.trim}`
                          : `2026 ${req.flexibleCriteria?.make} ${req.flexibleCriteria?.model}`}
                      </h3>
                      <p className="text-xs text-ink-muted mt-0.5">
                        Strategy: <strong className="text-emerald-400">{req.strategy === "flexible_discount" ? "Find your car based on Make and Model" : req.strategy === "exact_auction" ? "Find your car based on must have specs" : "Firm Target Offer"}</strong>
                      </p>
                    </div>

                    {req.flexibleCriteria?.mustHavePackages && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[11px] font-semibold text-ink-muted mr-1">Buyer Must-Haves:</span>
                        {req.flexibleCriteria.mustHavePackages.map((pkg, idx) => (
                          <span
                            key={idx}
                            className="rounded bg-background px-2 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/20 flex items-center gap-1"
                          >
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" /> {pkg}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Trade-In Vehicle Attachment Card */}
                    {req.tradeIn && req.tradeIn.hasTradeIn && (
                      <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-blue-400">
                            <Camera className="h-3.5 w-3.5" />
                            <span>Trade-In Vehicle Attached:</span>
                            <span className="text-white font-black">
                              {req.tradeIn.year} {req.tradeIn.make} {req.tradeIn.model} {req.tradeIn.trim}
                            </span>
                          </div>
                          <p className="text-[11px] text-ink-muted">
                            Mileage: <strong className="text-white font-mono">{req.tradeIn.mileage.toLocaleString()} mi</strong> • Condition: <strong className="text-white capitalize">{req.tradeIn.condition.replace("_", " ")}</strong> • {req.tradeIn.photos.length} Verified Photos Attached
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setTradeInToInspect(req.tradeIn || null)}
                          className="rounded-lg bg-blue-500/20 px-3 py-1.5 text-xs font-bold text-blue-300 hover:bg-blue-500 hover:text-black border border-blue-500/30 transition-all flex items-center gap-1.5 shrink-0"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Inspect Trade Photos ({req.tradeIn.photos.length})</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 lg:text-right">
                    <div className="space-y-0.5">
                      <div className="text-[11px] font-semibold text-ink-muted uppercase">Buyer Target</div>
                      <div className="text-xl font-black text-white">
                        {req.targetDiscountPercent
                          ? `${req.targetDiscountPercent}% Off MSRP`
                          : req.targetOtdPrice
                          ? formatCurrency(req.targetOtdPrice)
                          : "Best OTD Bid"}
                      </div>
                      <div className="text-[10px] text-emerald-400 font-medium">
                        Estimated OTD: ~$53,600
                      </div>
                    </div>

                    <button
                      onClick={() => handleOpenBidModal(req)}
                      className="rounded-xl bg-emerald-500 px-6 py-3 font-extrabold text-xs text-black hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2 active:scale-95"
                    >
                      <Zap className="h-4 w-4 fill-black" />
                      <span>Submit Binding OTD Bid</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: Active Bids */}
      {activeTab === "my_bids" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Live status of your submitted bids in customer deal rooms</span>
            <span className="text-emerald-400 font-medium">● Real-Time Leaderboard Active</span>
          </div>

          <div className="space-y-3">
            {bids.map((bid) => (
              <div
                key={bid.id}
                className={`rounded-2xl border p-5 space-y-3 transition-all ${
                  bid.rank === 1
                    ? "border-emerald-500 bg-surface shadow-lg ring-1 ring-emerald-500/40"
                    : "border-border bg-surface"
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      {bid.rank === 1 ? (
                        <span className="rounded-md bg-emerald-500 px-2 py-0.5 text-xs font-black text-black flex items-center gap-1">
                          👑 #1 TOP WINNING DEAL
                        </span>
                      ) : (
                        <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-400 border border-amber-500/30">
                          Rank #{bid.rank} (Outbid)
                        </span>
                      )}
                      <span className="text-xs font-bold text-white">{bid.matchedVehicleTitle}</span>
                      <span className="text-ink-faint text-xs font-mono">VIN: {bid.matchedVin}</span>
                    </div>

                    <div className="text-xs text-ink-muted">
                      Dealer Spec: <strong className="text-ink-light">{bid.matchedVehicleSpec}</strong>
                    </div>

                    <div className="text-[11px] text-ink-faint italic bg-background p-2 rounded-lg border border-border/50 max-w-xl">
                      "{bid.notes}"
                    </div>
                  </div>

                  <div className="flex items-center gap-6 lg:text-right">
                    <div className="space-y-0.5">
                      <div className="text-xs text-ink-muted line-through font-medium">
                        MSRP {formatCurrency(bid.msrp)}
                      </div>
                      <div className="text-xl font-black text-white">
                        {formatCurrency(bid.totalOtdPrice)}{" "}
                        <span className="text-xs font-normal text-ink-muted">OTD</span>
                      </div>
                      <div className="text-xs font-bold text-emerald-400">
                        {bid.dealerDiscountPercent}% Off MSRP (-{formatCurrency(bid.dealerDiscountDollars)})
                      </div>
                    </div>

                    {bid.rank > 1 && (
                      <button
                        onClick={() => handleOpenBidModal(requests[0])}
                        className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-amber-400 transition-all"
                      >
                        Counter to #1 →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: Won Deals & Paperwork Upload */}
      {activeTab === "locked_deals" && lockedDeal && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Official Deal Certificate & Paperwork Fulfillment</span>
            <span className="text-emerald-400 font-medium">● Legally Binding Locked Deal</span>
          </div>

          <div className="rounded-2xl border-2 border-emerald-500/60 bg-surface p-6 space-y-6 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-emerald-500 text-black px-2 py-0.5 text-xs font-mono font-black">
                    {lockedDeal.certificateId}
                  </span>
                  <span className="text-xs text-ink-muted">Locked: {lockedDeal.lockedAt}</span>
                </div>
                <h3 className="text-lg font-black text-white">
                  {lockedDeal.winningBid.matchedVehicleTitle}
                </h3>
                <p className="text-xs text-ink-muted font-mono">
                  VIN: {lockedDeal.winningBid.matchedVin}
                </p>
              </div>

              <div className="sm:text-right space-y-0.5">
                <div className="text-xs text-ink-muted">Agreed Out-The-Door Price</div>
                <div className="text-2xl font-black text-emerald-400 font-mono">
                  {formatCurrency(lockedDeal.winningBid.totalOtdPrice)}
                </div>
                <div className="text-[10px] text-ink-faint">Includes all CA taxes & DMV fees</div>
              </div>
            </div>

            {/* Paperwork Status Pipeline */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> 1. Deal Locked by Buyer
                </div>
                <p className="text-[11px] text-ink-muted">
                  Buyer accepted binding OTD price with $500 protection pledge.
                </p>
              </div>

              <div className={`rounded-xl border p-3.5 space-y-1 ${
                lockedDeal.paperworkStatus === "uploaded"
                  ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-400"
                  : "border-amber-500/40 bg-amber-950/20 text-amber-300"
              }`}>
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  {lockedDeal.paperworkStatus === "uploaded" ? (
                    <><CheckCircle2 className="h-4 w-4 text-emerald-400" /> 2. Contract Uploaded</>
                  ) : (
                    <><AlertCircle className="h-4 w-4 text-amber-400" /> 2. Upload Sales Contract</>
                  )}
                </div>
                <p className="text-[11px] text-ink-muted">
                  {lockedDeal.paperworkStatus === "uploaded"
                    ? `Uploaded: ${lockedDeal.uploadedContractName}`
                    : "Required within 24 hours for buyer e-sign."}
                </p>
              </div>

              <div className="rounded-xl border border-border bg-surface-elevated p-3.5 space-y-1 text-ink-muted">
                <div className="flex items-center gap-1.5 text-xs font-bold text-ink-light">
                  <Truck className="h-4 w-4" /> 3. Driveway Delivery / Pickup
                </div>
                <p className="text-[11px] text-ink-muted">
                  {lockedDeal.deliveryMethod === "driveway_delivery" ? "Driveway Delivery Selected" : "Express 10-Min Pickup"}
                </p>
              </div>
            </div>

            {/* Upload Action Callout */}
            <div className="rounded-xl border border-border bg-surface-elevated p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-0.5">
                <div className="font-bold text-white text-xs flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-400" />
                  <span>
                    {lockedDeal.paperworkStatus === "uploaded"
                      ? "Paperwork Transmitted to Buyer"
                      : "Upload Purchase Agreement & DMV Power of Attorney"}
                  </span>
                </div>
                <p className="text-[11px] text-ink-muted">
                  {lockedDeal.paperworkStatus === "uploaded"
                    ? "Buyer has received the digital contract. Awaiting final digital e-signature."
                    : "Attach the standard buyer's order PDF matching the exact $53,623 OTD price."}
                </p>
              </div>

              <button
                onClick={() => setIsUploadModalOpen(true)}
                className="rounded-xl bg-emerald-500 px-5 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-md flex items-center gap-2 shrink-0"
              >
                <UploadCloud className="h-4 w-4" />
                <span>{lockedDeal.paperworkStatus === "uploaded" ? "Re-Upload New Version" : "Upload Contract PDF →"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PAPERWORK UPLOAD MODAL */}
      {isUploadModalOpen && lockedDeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="relative w-full max-w-xl rounded-2xl border border-border-strong bg-surface shadow-2xl overflow-hidden my-8">
            <div className="flex items-center justify-between border-b border-border bg-surface-elevated px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                  <UploadCloud className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Upload Completed Contract & Paperwork</h2>
                  <p className="text-xs text-ink-muted">Certificate: {lockedDeal.certificateId} • Buyer #CA-4921</p>
                </div>
              </div>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="rounded-lg p-1.5 text-ink-muted hover:bg-border hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5 text-xs">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 flex justify-between items-center">
                <span className="text-ink-muted">Locked Binding OTD Price:</span>
                <span className="text-emerald-400 font-mono font-black text-sm">
                  {formatCurrency(lockedDeal.winningBid.totalOtdPrice)}
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-ink-light uppercase text-[11px]">
                  1. Purchase Agreement / Buyer's Order PDF:
                </label>
                <div className="rounded-xl border-2 border-dashed border-border hover:border-emerald-500 bg-background p-5 text-center space-y-2 cursor-pointer transition-all">
                  <FileText className="h-8 w-8 text-emerald-400 mx-auto" />
                  <div className="text-xs font-semibold text-white">
                    {selectedFileName}
                  </div>
                  <p className="text-[10px] text-ink-muted">
                    Drag and drop or click to replace PDF file (Max 25MB)
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-ink-light uppercase text-[11px]">
                  2. Vehicle Delivery Method:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDeliveryMethod("driveway_delivery")}
                    className={`rounded-xl p-3 text-left border transition-all ${
                      deliveryMethod === "driveway_delivery"
                        ? "border-emerald-500 bg-emerald-500/10 text-white font-bold"
                        : "border-border bg-background text-ink-muted hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <Truck className="h-3.5 w-3.5 text-emerald-400" /> Driveway Delivery
                    </div>
                    <div className="text-[10px] text-ink-muted mt-1">
                      Delivered directly to customer's home in 94107
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeliveryMethod("express_pickup")}
                    className={`rounded-xl p-3 text-left border transition-all ${
                      deliveryMethod === "express_pickup"
                        ? "border-emerald-500 bg-emerald-500/10 text-white font-bold"
                        : "border-border bg-background text-ink-muted hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <Clock className="h-3.5 w-3.5 text-blue-400" /> 10-Min Express Pickup
                    </div>
                    <div className="text-[10px] text-ink-muted mt-1">
                      Pre-washed and staged at San Rafael showroom
                    </div>
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3 text-[11px] text-ink-light leading-relaxed">
                <strong className="text-blue-400">Buyer Relay Notification:</strong> Once you click transmit, TrimScout will immediately notify Buyer #CA-4921 that their contract is ready for digital e-sign.
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border bg-surface-elevated px-6 py-4">
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink-light hover:bg-border"
              >
                Cancel
              </button>

              <button
                onClick={handleConfirmUploadPaperwork}
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-2.5 font-extrabold text-xs text-black hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
              >
                <Send className="h-3.5 w-3.5 fill-black" />
                <span>Transmit Contract to Buyer →</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bid Submission Modal */}
      {isBidModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl border border-border-strong bg-surface shadow-2xl overflow-hidden my-8">
            <div className="flex items-center justify-between border-b border-border bg-surface-elevated px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Zap className="h-4 w-4 fill-emerald-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Submit Binding Out-The-Door Bid</h2>
                  <p className="text-xs text-ink-muted">Transmit direct binding offer to Buyer #CA-4921</p>
                </div>
              </div>
              <button
                onClick={() => setIsBidModalOpen(false)}
                className="rounded-lg p-1.5 text-ink-muted hover:bg-border hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto text-xs">
              <div className="space-y-1.5">
                <label className="font-bold text-ink-light uppercase text-[11px]">
                  1. Select Unit From Your Dealership Inventory:
                </label>
                <select
                  value={selectedVehicleVin}
                  onChange={(e) => setSelectedVehicleVin(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background py-2.5 px-3 text-xs text-white focus:border-emerald-500 focus:outline-none font-mono"
                >
                  {vehicles.filter(v => v.make === "BMW").map((v) => (
                    <option key={v.vin} value={v.vin}>
                      {v.year} {v.make} {v.model} {v.trim} (VIN: {v.vin}) • MSRP {formatCurrency(v.msrp)} • {v.status === "on_lot" ? "On Lot" : "In Transit"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3.5 pt-1">
                <div className="space-y-1">
                  <label className="font-bold text-ink-light uppercase text-[11px]">
                    Dealer Discount Off MSRP (%):
                  </label>
                  <div className="relative">
                    <Percent className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                    <input
                      type="number"
                      step="0.1"
                      value={discountPercent}
                      onChange={(e) => setDiscountPercent(Number(e.target.value))}
                      className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm text-white font-bold focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <span className="text-[10px] text-emerald-400 font-medium">
                    Discount Amount: -{formatCurrency(otdPreview.discountDollars)}
                  </span>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-ink-light uppercase text-[11px]">
                    Manufacturer Rebates ($):
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint font-bold">$</span>
                    <input
                      type="number"
                      value={rebates}
                      onChange={(e) => setRebates(Number(e.target.value))}
                      className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm text-white font-bold focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <span className="text-[10px] text-ink-muted">Applies directly to capitalized cost</span>
                </div>
              </div>

              {/* Real-time OTD invoice */}
              <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2">
                <div className="font-bold text-white text-[11px] uppercase tracking-wider text-emerald-400 border-b border-border pb-1.5 flex justify-between">
                  <span>Binding Itemized Out-The-Door Invoice</span>
                  <span>Buyer Jurisdiction: 94107 ({otdPreview.taxRatePercent}%)</span>
                </div>

                <div className="flex justify-between text-ink-muted">
                  <span>Vehicle Window MSRP:</span>
                  <span className="text-white font-mono font-medium">{formatCurrency(otdPreview.msrp)}</span>
                </div>

                <div className="flex justify-between text-emerald-400 font-medium">
                  <span>Dealer Discount ({discountPercent}%):</span>
                  <span className="font-mono">-{formatCurrency(otdPreview.discountDollars)}</span>
                </div>

                {rebates > 0 && (
                  <div className="flex justify-between text-emerald-400 font-medium">
                    <span>Manufacturer Rebates:</span>
                    <span className="font-mono">-{formatCurrency(rebates)}</span>
                  </div>
                )}

                <div className="flex justify-between text-white font-bold border-t border-border/50 pt-1">
                  <span>Agreed Vehicle Selling Price:</span>
                  <span className="font-mono">{formatCurrency(otdPreview.sellingPrice)}</span>
                </div>

                <div className="flex justify-between text-ink-muted">
                  <span>State Sales Tax ({otdPreview.taxRatePercent}%):</span>
                  <span className="text-white font-mono">+{formatCurrency(otdPreview.salesTax)}</span>
                </div>

                <div className="flex justify-between text-ink-muted">
                  <span>DMV Registration & Title Fees:</span>
                  <span className="text-white font-mono">+{formatCurrency(otdPreview.dmvFees)}</span>
                </div>

                <div className="flex justify-between text-ink-muted">
                  <span>Documentation Fee (Capped):</span>
                  <span className="text-white font-mono">+{formatCurrency(otdPreview.docFee)}</span>
                </div>

                <div className="flex justify-between text-ink-muted">
                  <span>Dealer Add-ons / Accessories:</span>
                  <span className="text-emerald-400 font-mono font-bold">$0 (Verified $0)</span>
                </div>

                <div className="flex justify-between text-sm font-black text-emerald-400 border-t border-border pt-2">
                  <span>TOTAL BINDING OUT-THE-DOOR PRICE:</span>
                  <span className="font-mono text-base">{formatCurrency(otdPreview.totalOtdPrice)}</span>
                </div>

                {hasCustomerTradeIn && (
                  <div className="rounded-xl border border-blue-500/30 bg-blue-950/30 p-3 space-y-2 mt-2">
                    <div className="flex justify-between items-center text-blue-400 font-bold text-xs">
                      <span>Customer Trade-In Evaluation:</span>
                      <span>
                        {selectedRequest?.tradeIn?.year} {selectedRequest?.tradeIn?.make} {selectedRequest?.tradeIn?.model}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-ink-light">
                      <span>Committed Trade-In Allowance ($):</span>
                      <div className="relative w-36">
                        <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
                        <input
                          type="number"
                          value={tradeInAllowance}
                          onChange={(e) => setTradeInAllowance(Number(e.target.value))}
                          className="w-full rounded-lg border border-border bg-background py-1.5 pl-7 pr-2 text-xs font-bold text-white focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex justify-between text-xs font-black text-white border-t border-blue-500/20 pt-1.5">
                      <span>NET OUT-OF-POCKET OTD TO BUYER:</span>
                      <span className="font-mono text-emerald-400 text-sm">
                        {formatCurrency(finalNetOtdWithTrade)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="font-bold text-ink-light uppercase text-[11px]">
                  Notes to Buyer (Masked Relay):
                </label>
                <textarea
                  rows={2}
                  value={dealerNotes}
                  onChange={(e) => setDealerNotes(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3 flex items-start gap-2 text-[11px] text-ink-light">
                <ShieldCheck className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-blue-400">Binding Partner Commitment:</strong> This bid is locked for 48 hours. If the buyer accepts, you agree to execute the deal at this exact OTD price with $0 added dealer fees.
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border bg-surface-elevated px-6 py-4">
              <button
                onClick={() => setIsBidModalOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink-light hover:bg-border"
              >
                Cancel
              </button>

              <button
                onClick={handleTransmitBid}
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-2.5 font-extrabold text-xs text-black hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
              >
                <Send className="h-3.5 w-3.5 fill-black" />
                <span>
                  Transmit Binding Bid (
                  {hasCustomerTradeIn
                    ? `${formatCurrency(finalNetOtdWithTrade)} Net OTD`
                    : `${formatCurrency(otdPreview.totalOtdPrice)} OTD`}
                  )
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TRADE-IN PHOTO LIGHTBOX MODAL */}
      {tradeInToInspect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 overflow-y-auto">
          <div className="relative w-full max-w-3xl rounded-2xl border border-border-strong bg-surface shadow-2xl overflow-hidden my-8">
            <div className="flex items-center justify-between border-b border-border bg-surface-elevated px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
                  <Camera className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    Customer Trade-In Photo Appraisal
                  </h2>
                  <p className="text-xs text-ink-muted">
                    {tradeInToInspect.year} {tradeInToInspect.make} {tradeInToInspect.model} {tradeInToInspect.trim} • {tradeInToInspect.mileage.toLocaleString()} mi
                  </p>
                </div>
              </div>
              <button
                onClick={() => setTradeInToInspect(null)}
                className="rounded-lg p-1.5 text-ink-muted hover:bg-border hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto text-xs">
              {/* Vehicle Specs Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 rounded-xl border border-border bg-surface-elevated p-3 text-center">
                <div>
                  <span className="text-[10px] text-ink-faint uppercase font-bold">Odometer</span>
                  <div className="text-sm font-bold text-white font-mono">{tradeInToInspect.mileage.toLocaleString()} mi</div>
                </div>
                <div>
                  <span className="text-[10px] text-ink-faint uppercase font-bold">Condition</span>
                  <div className="text-sm font-bold text-emerald-400 capitalize">{tradeInToInspect.condition.replace("_", " ")}</div>
                </div>
                <div>
                  <span className="text-[10px] text-ink-faint uppercase font-bold">Market Range</span>
                  <div className="text-sm font-bold text-white font-mono">$24,500 - $26,800</div>
                </div>
                <div>
                  <span className="text-[10px] text-ink-faint uppercase font-bold">VIN</span>
                  <div className="text-xs font-bold text-ink-light font-mono truncate">{tradeInToInspect.vin || "WAUZZAF42NA091482"}</div>
                </div>
              </div>

              {/* Photo Gallery Grid */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <ImageIcon className="h-4 w-4 text-emerald-400" />
                  <span>Submitted Inspection Photos ({tradeInToInspect.photos.length}):</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {tradeInToInspect.photos.map((photo) => (
                    <div
                      key={photo.id}
                      className="rounded-xl border border-border bg-background overflow-hidden space-y-2 group"
                    >
                      <div className="relative aspect-video overflow-hidden bg-black/40">
                        <img
                          src={photo.imageUrl}
                          alt={photo.label}
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <span className="absolute bottom-2 left-2 rounded-md bg-black/80 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm border border-white/10">
                          {photo.label}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-[11px] text-ink-light leading-relaxed">
                <strong className="text-emerald-400">Committed ACV Policy:</strong> As a verified dealer partner, your submitted trade-in allowance is honored upon physical delivery, subject only to accurate condition & odometer matching these photos.
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border bg-surface-elevated px-6 py-4">
              <button
                onClick={() => setTradeInToInspect(null)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink-light hover:bg-border"
              >
                Close Gallery
              </button>

              <button
                onClick={() => {
                  setTradeInToInspect(null);
                  handleOpenBidModal(requests[0]);
                }}
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-md active:scale-95"
              >
                <Zap className="h-3.5 w-3.5 fill-black" />
                <span>Submit Bid on This Deal →</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
