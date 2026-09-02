"use client";

import React, { useEffect, useState } from "react";
import { UserProfile, DealerBid, LockedDeal, TradeInVehicle, DealerInboundRequest } from "../lib/types";
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
  DollarSign,
  Loader2,
  MessageSquare
} from "lucide-react";

interface DealerInventoryOption {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  msrp: number | null;
  status: string | null;
  imageUrl: string | null;
  packages: string[];
}

interface DealerPortalProps {
  currentUser: UserProfile;
  lockedDeal: LockedDeal | null;
  onDealerUploadPaperwork: (contractName: string, deliveryType: "driveway_delivery" | "express_pickup") => void;
  onSwitchToBuyerView: () => void;
}

export const DealerPortal: React.FC<DealerPortalProps> = ({
  currentUser,
  lockedDeal,
  onDealerUploadPaperwork,
  onSwitchToBuyerView,
}) => {
  const [activeTab, setActiveTab] = useState<"leads" | "my_bids" | "locked_deals">("leads");

  const [inboundRequests, setInboundRequests] = useState<DealerInboundRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(true);
  const [requestsError, setRequestsError] = useState<string | null>(null);

  const [myBids, setMyBids] = useState<DealerBid[]>([]);
  const [isLoadingBids, setIsLoadingBids] = useState(true);
  const [bidsError, setBidsError] = useState<string | null>(null);

  // The buyer's locked deal is only relevant to THIS dealer if their own
  // real dealer name matches who actually won it — a buyer's LockedDeal
  // state in page.tsx isn't scoped per-dealer today, so this filters it.
  const wonDeal = lockedDeal && lockedDeal.winningBid.dealerName === currentUser.dealerName ? lockedDeal : null;

  const refreshInboundRequests = () => {
    setIsLoadingRequests(true);
    setRequestsError(null);
    fetch("/api/dealer-requests")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((json) => setInboundRequests(json.requests || []))
      .catch((e) => setRequestsError(e.message || "Could not load buyer requests."))
      .finally(() => setIsLoadingRequests(false));
  };

  const refreshMyBids = () => {
    setIsLoadingBids(true);
    setBidsError(null);
    fetch("/api/dealer-bids")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((json) => setMyBids(json.bids || []))
      .catch((e) => setBidsError(e.message || "Could not load your bids."))
      .finally(() => setIsLoadingBids(false));
  };

  useEffect(() => {
    if (!currentUser.dealerName) return;
    refreshInboundRequests();
    refreshMyBids();
    if (typeof window === "undefined") return;
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token) return;
    fetch("/api/dealer-invite/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {
      // Best-effort; inbox still loads.
    });
  }, [currentUser.dealerName]);

  // Trade-In Photo Lightbox Modal State
  const [tradeInToInspect, setTradeInToInspect] = useState<TradeInVehicle | null>(null);

  // Paperwork Upload Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [selectedFileName] = useState<string>("Signed_Purchase_Agreement.pdf");
  const [deliveryMethod, setDeliveryMethod] = useState<"driveway_delivery" | "express_pickup">(
    "driveway_delivery"
  );

  // Bid Creation Modal State
  const [isBidModalOpen, setIsBidModalOpen] = useState<boolean>(false);
  const [selectedRequest, setSelectedRequest] = useState<DealerInboundRequest | null>(null);
  const [dealerInventory, setDealerInventory] = useState<DealerInventoryOption[]>([]);
  const [isLoadingInventory, setIsLoadingInventory] = useState(false);
  const [selectedVehicleVin, setSelectedVehicleVin] = useState<string>("");
  const [discountPercent, setDiscountPercent] = useState<number>(8.5);
  const [rebates, setRebates] = useState<number>(1000);
  const [tradeInAllowance, setTradeInAllowance] = useState<number>(25500);
  const [dealerNotes, setDealerNotes] = useState<string>(
    "Vehicle in stock on showroom floor. $0 dealer add-ons."
  );
  const [salesRepName, setSalesRepName] = useState<string>(currentUser.name || "");
  const [salesRepTitle, setSalesRepTitle] = useState<string>(currentUser.dealerTitle || "Sales Director");
  const [salesRepPhone, setSalesRepPhone] = useState<string>(currentUser.phone || "");
  const [isSubmittingBid, setIsSubmittingBid] = useState(false);
  const [bidSubmitError, setBidSubmitError] = useState<string | null>(null);

  const matchedVehicle = dealerInventory.find((v) => v.vin === selectedVehicleVin) || dealerInventory[0] || null;

  const otdPreview = calculateOtd({
    msrp: matchedVehicle?.msrp || selectedRequest?.referenceMsrp || 0,
    discountPercent,
    rebates,
    zipCode: undefined, // buyer's exact zip is withheld from the dealer — tax preview uses default rate
  });

  const hasCustomerTradeIn = Boolean(selectedRequest?.tradeIn?.hasTradeIn);
  const finalNetOtdWithTrade = hasCustomerTradeIn
    ? Math.max(0, otdPreview.totalOtdPrice - tradeInAllowance)
    : otdPreview.totalOtdPrice;

  const handleOpenBidModal = (req: DealerInboundRequest) => {
    setSelectedRequest(req);
    setIsBidModalOpen(true);
    setBidSubmitError(null);
    setIsLoadingInventory(true);
    fetch(`/api/deal-requests/${req.requestId}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {
      // View tracking is best-effort; opening the offer still proceeds.
    });
    fetch(`/api/dealer-inventory?brand=${encodeURIComponent(req.referenceBrandCode)}&make=${encodeURIComponent(req.referenceMake)}`)
      .then((res) => (res.ok ? res.json() : { vehicles: [] }))
      .then((json) => {
        setDealerInventory(json.vehicles || []);
        setSelectedVehicleVin(json.vehicles?.[0]?.vin || "");
      })
      .finally(() => setIsLoadingInventory(false));
  };

  const handleTransmitBid = async () => {
    if (!selectedRequest || !matchedVehicle) return;
    setIsSubmittingBid(true);
    setBidSubmitError(null);
    try {
      const res = await fetch(`/api/deal-requests/${selectedRequest.requestId}/bids`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchedVin: matchedVehicle.vin,
          matchedVehicleTitle: [matchedVehicle.year, matchedVehicle.make, matchedVehicle.model, matchedVehicle.trim]
            .filter(Boolean)
            .join(" "),
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
          quotedOtdPrice: otdPreview.quotedOtdPrice,
          netOtdWithTradeIn: hasCustomerTradeIn ? finalNetOtdWithTrade : undefined,
          notes: dealerNotes,
          salesRepName,
          salesRepTitle,
          salesRepPhone,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not submit bid.");
      setIsBidModalOpen(false);
      refreshMyBids();
    } catch (e) {
      setBidSubmitError(e instanceof Error ? e.message : "Could not submit bid.");
    } finally {
      setIsSubmittingBid(false);
    }
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
                <CheckCircle2 className="h-3 w-3" /> Dealer Account
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              Logged in as: <strong className="text-white">{currentUser.dealerName || currentUser.name}</strong>
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

      {/* WON DEAL BANNER */}
      {wonDeal && (
        <div className="rounded-2xl border-2 border-emerald-500 bg-gradient-to-r from-emerald-950/40 via-surface-elevated to-surface p-5 space-y-3 shadow-xl animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-black font-extrabold shadow-lg">
                <Sparkles className="h-5 w-5 fill-black" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm sm:text-base font-black text-white">
                    Deal Locked — Certificate #{wonDeal.certificateId}
                  </h3>
                  <span className="rounded bg-emerald-500 text-black px-2 py-0.5 text-[10px] font-black uppercase">
                    ACTION REQUIRED
                  </span>
                </div>
                <p className="text-xs text-ink-muted mt-0.5">
                  Buyer paid to lock in your bid at <strong className="text-emerald-400 font-mono">{formatCurrency(wonDeal.winningBid.totalOtdPrice)}</strong>. Please upload the finalized purchase contract.
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2 shrink-0 active:scale-95"
            >
              <UploadCloud className="h-4 w-4" />
              <span>{wonDeal.paperworkStatus === "uploaded" ? "Update Paperwork" : "Upload Sales Contract Now →"}</span>
            </button>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Active Inbound Deals</div>
          <div className="text-2xl font-black text-white flex items-center gap-2">
            {inboundRequests.length}
            <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">Live</span>
          </div>
          <p className="text-[10px] text-ink-faint">Matching your real inventory</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Bids Transmitted</div>
          <div className="text-2xl font-black text-blue-400">{myBids.length}</div>
          <p className="text-[10px] text-ink-faint">Active in buyer deal rooms</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Deals Won</div>
          <div className="text-2xl font-black text-emerald-400">{wonDeal ? 1 : 0}</div>
          <p className="text-[10px] text-ink-faint">$0 doc fee policy</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Paperwork Status</div>
          <div className="text-2xl font-black text-amber-400">
            {wonDeal && wonDeal.paperworkStatus === "uploaded" ? "Uploaded" : wonDeal ? "1 Pending" : "All Clear"}
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
          <span>Inbound Deal Opportunities ({inboundRequests.length})</span>
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
          <span>Active Bids & Tracker ({myBids.length})</span>
        </button>

        {wonDeal && (
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
            <span>Real buyer requests matching your live inventory</span>
            <button onClick={refreshInboundRequests} className="text-emerald-400 font-medium hover:underline">
              ● Refresh
            </button>
          </div>

          {isLoadingRequests && (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-surface p-12 text-ink-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading buyer requests…</span>
            </div>
          )}

          {!isLoadingRequests && requestsError && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-6 text-sm text-rose-300">
              {requestsError}
            </div>
          )}

          {!isLoadingRequests && !requestsError && inboundRequests.length === 0 && (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-ink-muted">
              No active buyer requests currently match your inventory. Check back soon.
            </div>
          )}

          <div className="space-y-3.5">
            {inboundRequests.map((req) => (
              <div
                key={req.requestId}
                className="rounded-2xl border border-border-strong bg-surface p-5 space-y-4 shadow-lg hover:border-emerald-500/50 transition-all"
              >
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-mono font-bold text-emerald-400 border border-emerald-500/30">
                        {req.buyerAlias}
                      </span>
                      <span className="rounded-md bg-surface-elevated px-2 py-0.5 text-xs font-semibold text-ink-light border border-border flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-emerald-400" /> {req.buyerState} ({req.distanceMiles} mi away)
                      </span>
                      <span className="rounded-md bg-blue-500/20 px-2 py-0.5 text-xs font-bold text-blue-400 border border-blue-500/30 flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Expires {new Date(req.expiresAt).toLocaleString()}
                      </span>
                      <span className="rounded-md bg-purple-500/20 px-2 py-0.5 text-xs font-bold text-purple-400 border border-purple-500/30 uppercase">
                        {req.paymentMethod}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-lg font-black text-white">
                        {req.referenceYear} {req.referenceMake} {req.referenceModel} {req.referenceTrim}
                      </h3>
                      <p className="text-xs text-ink-muted mt-0.5">
                        Strategy: <strong className="text-emerald-400">
                          {req.strategy === "flexible_discount" ? "Flexible Discount" : req.strategy === "exact_auction" ? "Exact Match Auction" : "Firm Target Offer"}
                        </strong>
                      </p>
                    </div>

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
                            Mileage: <strong className="text-white font-mono">{req.tradeIn.mileage.toLocaleString()} mi</strong> • Condition: <strong className="text-white capitalize">{req.tradeIn.condition.replace("_", " ")}</strong> • {req.tradeIn.photos.length} Photos Attached
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

                    {req.buyerComment && (
                      <div className="rounded-xl border border-border bg-surface-elevated p-3 flex items-start gap-2.5">
                        <MessageSquare className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wide">Buyer Comment</div>
                          <p className="text-xs text-ink-light mt-0.5 whitespace-pre-wrap">{req.buyerComment}</p>
                        </div>
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
            <span>Status of your submitted real bids</span>
            <button onClick={refreshMyBids} className="text-emerald-400 font-medium hover:underline">
              ● Refresh
            </button>
          </div>

          {isLoadingBids && (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-surface p-12 text-ink-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading your bids…</span>
            </div>
          )}

          {!isLoadingBids && bidsError && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-6 text-sm text-rose-300">
              {bidsError}
            </div>
          )}

          {!isLoadingBids && !bidsError && myBids.length === 0 && (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-ink-muted">
              You haven't submitted any bids yet.
            </div>
          )}

          <div className="space-y-3">
            {myBids.map((bid) => (
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
                          ✓ Best Offer Submitted
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
                        {formatCurrency(bid.quotedOtdPrice)}{" "}
                        <span className="text-xs font-normal text-ink-muted">quoted</span>
                      </div>
                      <div className="text-xs font-bold text-emerald-400">
                        {bid.dealerDiscountPercent}% Off MSRP (-{formatCurrency(bid.dealerDiscountDollars)})
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: Won Deals & Paperwork Upload */}
      {activeTab === "locked_deals" && wonDeal && (
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
                    {wonDeal.certificateId}
                  </span>
                  <span className="text-xs text-ink-muted">Locked: {wonDeal.lockedAt}</span>
                </div>
                <h3 className="text-lg font-black text-white">
                  {wonDeal.winningBid.matchedVehicleTitle}
                </h3>
                <p className="text-xs text-ink-muted font-mono">
                  VIN: {wonDeal.winningBid.matchedVin}
                </p>
              </div>

              <div className="sm:text-right space-y-0.5">
                <div className="text-xs text-ink-muted">Agreed Out-The-Door Price</div>
                <div className="text-2xl font-black text-emerald-400 font-mono">
                  {formatCurrency(wonDeal.winningBid.totalOtdPrice)}
                </div>
                <div className="text-[10px] text-ink-faint">Includes taxes & DMV fees</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> 1. Deal Locked by Buyer
                </div>
                <p className="text-[11px] text-ink-muted">
                  Buyer paid the platform fee and accepted your binding OTD price.
                </p>
              </div>

              <div className={`rounded-xl border p-3.5 space-y-1 ${
                wonDeal.paperworkStatus === "uploaded"
                  ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-400"
                  : "border-amber-500/40 bg-amber-950/20 text-amber-300"
              }`}>
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  {wonDeal.paperworkStatus === "uploaded" ? (
                    <><CheckCircle2 className="h-4 w-4 text-emerald-400" /> 2. Contract Uploaded</>
                  ) : (
                    <><AlertCircle className="h-4 w-4 text-amber-400" /> 2. Upload Sales Contract</>
                  )}
                </div>
                <p className="text-[11px] text-ink-muted">
                  {wonDeal.paperworkStatus === "uploaded"
                    ? `Uploaded: ${wonDeal.uploadedContractName}`
                    : "Required within 24 hours for buyer e-sign."}
                </p>
              </div>

              <div className="rounded-xl border border-border bg-surface-elevated p-3.5 space-y-1 text-ink-muted">
                <div className="flex items-center gap-1.5 text-xs font-bold text-ink-light">
                  <Truck className="h-4 w-4" /> 3. Driveway Delivery / Pickup
                </div>
                <p className="text-[11px] text-ink-muted">
                  {wonDeal.deliveryMethod === "driveway_delivery" ? "Driveway Delivery Selected" : "Express 10-Min Pickup"}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface-elevated p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-0.5">
                <div className="font-bold text-white text-xs flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-400" />
                  <span>
                    {wonDeal.paperworkStatus === "uploaded"
                      ? "Paperwork Transmitted to Buyer"
                      : "Upload Purchase Agreement & DMV Power of Attorney"}
                  </span>
                </div>
                <p className="text-[11px] text-ink-muted">
                  {wonDeal.paperworkStatus === "uploaded"
                    ? "Buyer has received the digital contract. Awaiting final digital e-signature."
                    : `Attach the standard buyer's order PDF matching the exact ${formatCurrency(wonDeal.winningBid.totalOtdPrice)} OTD price.`}
                </p>
              </div>

              <button
                onClick={() => setIsUploadModalOpen(true)}
                className="rounded-xl bg-emerald-500 px-5 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-md flex items-center gap-2 shrink-0"
              >
                <UploadCloud className="h-4 w-4" />
                <span>{wonDeal.paperworkStatus === "uploaded" ? "Re-Upload New Version" : "Upload Contract PDF →"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PAPERWORK UPLOAD MODAL */}
      {isUploadModalOpen && wonDeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="relative w-full max-w-xl rounded-2xl border border-border-strong bg-surface shadow-2xl overflow-hidden my-8">
            <div className="flex items-center justify-between border-b border-border bg-surface-elevated px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                  <UploadCloud className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Upload Completed Contract & Paperwork</h2>
                  <p className="text-xs text-ink-muted">Certificate: {wonDeal.certificateId}</p>
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
                  {formatCurrency(wonDeal.winningBid.totalOtdPrice)}
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
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3 text-[11px] text-ink-light leading-relaxed">
                <strong className="text-blue-400">Buyer Relay Notification:</strong> Once you click transmit, TrimScout will notify the buyer through the masked relay that their contract is ready for digital e-sign.
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
      {isBidModalOpen && selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl border border-border-strong bg-surface shadow-2xl overflow-hidden my-8">
            <div className="flex items-center justify-between border-b border-border bg-surface-elevated px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Zap className="h-4 w-4 fill-emerald-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Submit Binding Out-The-Door Bid</h2>
                  <p className="text-xs text-ink-muted">Transmit direct binding offer to {selectedRequest.buyerAlias}</p>
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
                {isLoadingInventory ? (
                  <div className="flex items-center gap-2 text-ink-muted py-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading your inventory…
                  </div>
                ) : dealerInventory.length === 0 ? (
                  <p className="text-rose-300">No matching in-stock units found in your real inventory for this request.</p>
                ) : (
                  <select
                    value={selectedVehicleVin}
                    onChange={(e) => setSelectedVehicleVin(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background py-2.5 px-3 text-xs text-white focus:border-emerald-500 focus:outline-none font-mono"
                  >
                    {dealerInventory.map((v) => (
                      <option key={v.vin} value={v.vin}>
                        {v.year} {v.make} {v.model} {v.trim} (VIN: {v.vin}) • MSRP {formatCurrency(v.msrp || 0)} • {v.status === "on_lot" ? "On Lot" : "In Transit"}
                      </option>
                    ))}
                  </select>
                )}
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
                </div>
              </div>

              {/* Real-time OTD invoice */}
              <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2">
                <div className="font-bold text-white text-[11px] uppercase tracking-wider text-emerald-400 border-b border-border pb-1.5">
                  Binding Itemized Out-The-Door Invoice (buyer's exact tax/DMV computed at checkout)
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
                  <span>Documentation Fee (Capped):</span>
                  <span className="text-white font-mono">+{formatCurrency(otdPreview.docFee)}</span>
                </div>

                <div className="flex justify-between text-sm font-black text-emerald-400 border-t border-border pt-2">
                  <span>QUOTED PRICE (excl. tax/registration):</span>
                  <span className="font-mono text-base">{formatCurrency(otdPreview.quotedOtdPrice)}</span>
                </div>
                <p className="text-[10px] text-ink-faint">
                  This is the number your bid is ranked/competed on. Sales tax & DMV registration fees are computed separately for the buyer's own location at checkout.
                </p>

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
                      <span>NET OUT-OF-POCKET (approx.):</span>
                      <span className="font-mono text-emerald-400 text-sm">
                        {formatCurrency(Math.max(0, finalNetOtdWithTrade - tradeInAllowance))}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-ink-light uppercase text-[11px]">Your Name:</label>
                  <input
                    value={salesRepName}
                    onChange={(e) => setSalesRepName(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background p-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-ink-light uppercase text-[11px]">Title:</label>
                  <input
                    value={salesRepTitle}
                    onChange={(e) => setSalesRepTitle(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background p-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-ink-light uppercase text-[11px]">Direct Phone:</label>
                  <input
                    value={salesRepPhone}
                    onChange={(e) => setSalesRepPhone(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background p-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
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
                  <strong className="text-blue-400">Binding Partner Commitment:</strong> Your dealer identity, contact info, and this VIN stay hidden from the buyer until they pay to lock in your bid — only your quoted price and vehicle spec are visible to them until then.
                </div>
              </div>

              {bidSubmitError && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">
                  {bidSubmitError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border bg-surface-elevated px-6 py-4">
              <button
                onClick={() => setIsBidModalOpen(false)}
                disabled={isSubmittingBid}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink-light hover:bg-border disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                onClick={handleTransmitBid}
                disabled={isSubmittingBid || !matchedVehicle}
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-2.5 font-extrabold text-xs text-black hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-60"
              >
                {isSubmittingBid ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 fill-black" />}
                <span>
                  {isSubmittingBid ? "Transmitting…" : `Transmit Binding Bid (${formatCurrency(otdPreview.quotedOtdPrice)} Quoted)`}
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 rounded-xl border border-border bg-surface-elevated p-3 text-center">
                <div>
                  <span className="text-[10px] text-ink-faint uppercase font-bold">Odometer</span>
                  <div className="text-sm font-bold text-white font-mono">{tradeInToInspect.mileage.toLocaleString()} mi</div>
                </div>
                <div>
                  <span className="text-[10px] text-ink-faint uppercase font-bold">Condition</span>
                  <div className="text-sm font-bold text-emerald-400 capitalize">{tradeInToInspect.condition.replace("_", " ")}</div>
                </div>
                <div>
                  <span className="text-[10px] text-ink-faint uppercase font-bold">Est. Value</span>
                  <div className="text-sm font-bold text-white font-mono">
                    {formatCurrency(tradeInToInspect.estimatedValueMin)}–{formatCurrency(tradeInToInspect.estimatedValueMax)}
                  </div>
                </div>
              </div>

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
                        {/* eslint-disable-next-line @next/next/no-img-element */}
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
            </div>

            <div className="flex items-center justify-between border-t border-border bg-surface-elevated px-6 py-4">
              <button
                onClick={() => setTradeInToInspect(null)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink-light hover:bg-border"
              >
                Close Gallery
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
