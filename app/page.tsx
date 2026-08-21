"use client";

import React, { useState, useEffect } from "react";
import { Vehicle, BiddingRequest, DealerBid, LockedDeal, UserProfile } from "../lib/types";
import { MOCK_VEHICLES, INITIAL_DEMO_BIDS, SAMPLE_TRADE_IN_VEHICLE, DEMO_BUYER_USER } from "../lib/mockData";
import { calculateOtd } from "../lib/otdCalculator";
import { fetchLiveInventory } from "../lib/inventoryConnector";
import { Navbar } from "../components/Navbar";
import { MarketSearch } from "../components/MarketSearch";
import { BidProgramIntro } from "../components/BidProgramIntro";
import { BiddingWizard } from "../components/BiddingWizard";
import { LiveDealRoom } from "../components/LiveDealRoom";
import { DealerPortal } from "../components/DealerPortal";
import { FeeBreakdownModal } from "../components/FeeBreakdownModal";
import { VoucherModal } from "../components/VoucherModal";
import { AuthModal } from "../components/AuthModal";
import { DealTrackerDashboard } from "../components/DealTrackerDashboard";
import { InventoryConnectorModal } from "../components/InventoryConnectorModal";
import { SignupView } from "../components/SignupView";

export default function Home() {
  const [vehicles, setVehicles] = useState<Vehicle[]>(MOCK_VEHICLES);
  const [currentView, setCurrentView] = useState<"search" | "bid_program" | "deal_room" | "dealer_portal" | "track_deals" | "signup">("search");

  // User Authentication State
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(DEMO_BUYER_USER);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [savedVehicleIds, setSavedVehicleIds] = useState<string[]>(["veh-1", "veh-4"]);

  // Live Inventory Connector State & Pagination
  const [isConnectorModalOpen, setIsConnectorModalOpen] = useState(false);
  const [isSyncingInventory, setIsSyncingInventory] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [hasMoreVehicles, setHasMoreVehicles] = useState<boolean>(true);
  const [totalFoundVehicles, setTotalFoundVehicles] = useState<number>(0);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [currentSearchParams, setCurrentSearchParams] = useState<{ zip: string; radius: number; query?: string; make?: string }>({
    zip: "94107",
    radius: 150,
  });

  // Wizard state
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [preselectedVehicle, setPreselectedVehicle] = useState<Vehicle | null>(null);

  // Active Bidding Request state
  const [activeRequest, setActiveRequest] = useState<BiddingRequest>({
    id: "req-demo-1",
    strategy: "flexible_discount",
    flexibleCriteria: {
      make: "BMW",
      model: "3 Series",
      trims: ["330i M Sport", "330i xDrive"],
      minMsrp: 48000,
      maxMsrp: 58000,
      mustHavePackages: ["M Sport Package", "Premium Package"],
      preferredColors: ["Mineral Grey", "Brooklyn Grey"],
      dealbreakers: ["Red Interior"],
      allowedStatuses: ["on_lot", "in_transit"],
    },
    targetDiscountPercent: 8.5,
    paymentMethod: "finance",
    buyerZip: "94107",
    searchRadiusMiles: 150,
    tradeIn: SAMPLE_TRADE_IN_VEHICLE,
    createdAt: "10 mins ago",
    expiresAt: "48 Hours",
    status: "active",
  });

  const [bids, setBids] = useState<DealerBid[]>(INITIAL_DEMO_BIDS);

  // Modals state
  const [inspectedBid, setInspectedBid] = useState<DealerBid | null>(null);
  const [isFeeModalOpen, setIsFeeModalOpen] = useState(false);
  const [lockedDeal, setLockedDeal] = useState<LockedDeal | null>(null);
  const [isVoucherModalOpen, setIsVoucherModalOpen] = useState(false);

  // Initial live inventory sync & user session restore on load
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("trimscout_current_user");
        if (saved) {
          setCurrentUser(JSON.parse(saved));
        }
      } catch (e) {
        console.error("Failed to load user from localStorage:", e);
      }
    }
    handleSyncLiveInventory("94107", 150);
  }, []);

  const handleLogin = (user: UserProfile) => {
    setCurrentUser(user);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("trimscout_current_user", JSON.stringify(user));
      } catch (e) {}
    }
    if (user.role === "dealer") {
      setCurrentView("dealer_portal");
    } else {
      setCurrentView("track_deals");
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("trimscout_current_user");
      } catch (e) {}
    }
    setCurrentView("search");
  };

  // Sync Live Inventory from Connector
  const handleSyncLiveInventory = async (
    zip: string = "94107",
    radius: number = 150,
    query?: string,
    make?: string
  ) => {
    setIsSyncingInventory(true);
    setCurrentSearchParams({ zip, radius, query, make });
    setCurrentPage(1);
    try {
      const res = await fetchLiveInventory({
        zip,
        radius,
        query,
        make: make && make !== "All" ? make : undefined,
        page: 1,
        limit: 100,
      });
      if (res.success && res.data.length > 0) {
        setVehicles(res.data);
        setTotalFoundVehicles(res.totalFound || res.data.length);
        setHasMoreVehicles(res.hasMore ?? res.data.length >= 100);
      }
    } catch (e) {
      console.error("Failed to sync live inventory:", e);
    } finally {
      setIsSyncingInventory(false);
    }
  };

  // Load More (Pagination)
  const handleLoadMoreLiveInventory = async () => {
    if (isLoadingMore || !hasMoreVehicles) return;
    setIsLoadingMore(true);
    const nextPage = currentPage + 1;
    try {
      const res = await fetchLiveInventory({
        zip: currentSearchParams.zip,
        radius: currentSearchParams.radius,
        query: currentSearchParams.query,
        make: currentSearchParams.make && currentSearchParams.make !== "All" ? currentSearchParams.make : undefined,
        page: nextPage,
        limit: 50,
      });
      if (res.success && res.data.length > 0) {
        setVehicles(prev => {
          const existingIds = new Set(prev.map(v => v.id || v.vin));
          const newUnique = res.data.filter(v => !existingIds.has(v.id || v.vin));
          return [...prev, ...newUnique];
        });
        setCurrentPage(nextPage);
        setHasMoreVehicles(res.hasMore ?? (res.data.length >= 50));
        if (res.totalFound) setTotalFoundVehicles(res.totalFound);
      } else {
        setHasMoreVehicles(false);
      }
    } catch (e) {
      console.error("Failed to load more vehicles:", e);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Handlers
  const handleSelectForBid = (vehicle: Vehicle) => {
    setPreselectedVehicle(vehicle);
    setIsWizardOpen(true);
  };

  const handleOpenFlexibleWizard = () => {
    setPreselectedVehicle(null);
    setIsWizardOpen(true);
  };

  const handleSubmitBidRequest = (newRequest: BiddingRequest) => {
    setActiveRequest(newRequest);
    setCurrentView("deal_room");

    if (newRequest.targetVehicle) {
      const v = newRequest.targetVehicle;
      const otd1 = calculateOtd({ msrp: v.msrp, discountPercent: 8.5, rebates: 1000, zipCode: newRequest.buyerZip });
      const otd2 = calculateOtd({ msrp: v.msrp, discountPercent: 7.2, rebates: 1000, zipCode: newRequest.buyerZip });

      setBids([
        {
          id: `bid-${Date.now()}-1`,
          dealRequestId: newRequest.id,
          dealerName: "BMW of San Rafael",
          dealerCity: "San Rafael",
          dealerState: "CA",
          distanceMiles: 14,
          matchedVin: v.vin,
          matchedVehicleTitle: `${v.year} ${v.make} ${v.model} ${v.trim}`,
          matchedVehicleSpec: v.packages.join(" • "),
          matchedVehicleImageUrl: v.imageUrl,
          vehicleStatus: (v.status === "in_production" ? "order_allocation" : v.status === "sold" ? "on_lot" : v.status),
          msrp: otd1.msrp,
          dealerDiscountDollars: otd1.discountDollars,
          dealerDiscountPercent: otd1.discountPercent,
          manufacturerRebates: otd1.rebates,
          sellingPrice: otd1.sellingPrice,
          salesTax: otd1.salesTax,
          dmvFees: otd1.dmvFees,
          docFee: otd1.docFee,
          dealerAccessories: otd1.accessories,
          totalOtdPrice: otd1.totalOtdPrice,
          notes: "Vehicle in stock on showroom floor. Verified $0 add-ons.",
          rank: 1,
          createdAt: "Just now",
          isTopDeal: true,
          salesRep: {
            name: "Marcus Vance",
            title: "Sales Director",
            phone: "(415) 555-0199",
          },
        },
        {
          id: `bid-${Date.now()}-2`,
          dealRequestId: newRequest.id,
          dealerName: "Peter Pan BMW",
          dealerCity: "San Mateo",
          dealerState: "CA",
          distanceMiles: 19,
          matchedVin: "WBA33AY09RF611293",
          matchedVehicleTitle: `${v.year} ${v.make} ${v.model} ${v.trim}`,
          matchedVehicleSpec: "Brooklyn Grey • Shadowline • Premium Pkg",
          matchedVehicleImageUrl: v.imageUrl,
          vehicleStatus: "in_transit",
          msrp: otd2.msrp,
          dealerDiscountDollars: otd2.discountDollars,
          dealerDiscountPercent: otd2.discountPercent,
          manufacturerRebates: otd2.rebates,
          sellingPrice: otd2.sellingPrice,
          salesTax: otd2.salesTax,
          dmvFees: otd2.dmvFees,
          docFee: otd2.docFee,
          dealerAccessories: otd2.accessories,
          totalOtdPrice: otd2.totalOtdPrice,
          notes: "In transit allocation arriving within 5 days. Ready to lock in.",
          rank: 2,
          createdAt: "3m ago",
          salesRep: {
            name: "Elena Rostova",
            title: "Client Advisor",
            phone: "(650) 555-0142",
          },
        },
      ]);
    }
  };

  const handleInspectFee = (bid: DealerBid) => {
    setInspectedBid(bid);
    setIsFeeModalOpen(true);
  };

  const handleAcceptDeal = (bid: DealerBid) => {
    const deal: LockedDeal = {
      certificateId: `OTD-BMW-${Math.floor(10000 + Math.random() * 90000)}`,
      request: activeRequest,
      winningBid: bid,
      lockedAt: new Date().toLocaleDateString(),
      expiresAt: "5 Business Days",
      paperworkStatus: "pending_dealer_upload",
      deliveryMethod: "driveway_delivery",
    };
    setLockedDeal(deal);
    setIsVoucherModalOpen(true);
  };

  const handleDealerUploadPaperwork = (
    contractName: string,
    deliveryType: "driveway_delivery" | "express_pickup"
  ) => {
    if (lockedDeal) {
      setLockedDeal({
        ...lockedDeal,
        paperworkStatus: "uploaded",
        uploadedContractName: contractName,
        uploadedAt: "Just now",
        deliveryMethod: deliveryType,
      });
    }
  };

  const handleDealerSubmitBid = (newBid: DealerBid) => {
    setBids((prev) => {
      const updated = [newBid, ...prev.filter((b) => b.id !== newBid.id)];
      // Re-rank by lowest total OTD price
      updated.sort((a, b) => a.totalOtdPrice - b.totalOtdPrice);
      return updated.map((b, idx) => ({
        ...b,
        rank: idx + 1,
        isTopDeal: idx === 0,
      }));
    });
  };

  const handleSimulateNewBid = () => {
    const otdNew = calculateOtd({
      msrp: 54600,
      discountPercent: 9.4,
      rebates: 1000,
      zipCode: activeRequest.buyerZip,
    });

    const newBid: DealerBid = {
      id: `bid-sim-${Date.now()}`,
      dealRequestId: activeRequest.id,
      dealerName: "BMW of Fremont",
      dealerCity: "Fremont",
      dealerState: "CA",
      distanceMiles: 29,
      matchedVin: "WBA33AY09RF994182",
      matchedVehicleTitle: "2026 BMW 330i M Sport",
      matchedVehicleSpec: "Mineral White • Shadowline Pro • Harman Kardon",
      matchedVehicleImageUrl: "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=800&q=80",
      vehicleStatus: "on_lot",
      msrp: otdNew.msrp,
      dealerDiscountDollars: otdNew.discountDollars,
      dealerDiscountPercent: otdNew.discountPercent,
      manufacturerRebates: otdNew.rebates,
      sellingPrice: otdNew.sellingPrice,
      salesTax: otdNew.salesTax,
      dmvFees: otdNew.dmvFees,
      docFee: otdNew.docFee,
      dealerAccessories: otdNew.accessories,
      totalOtdPrice: otdNew.totalOtdPrice,
      notes: "🔥 Price drop! Just countered with 9.4% off MSRP to win your business today!",
      rank: 1,
      createdAt: "Just now",
      isTopDeal: true,
      salesRep: {
        name: "Alexander Kim",
        title: "General Sales Manager",
        phone: "(510) 555-0177",
      },
    };

    handleDealerSubmitBid(newBid);
  };

  const savedVehiclesList = vehicles.filter((v) => savedVehicleIds.includes(v.id));

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Navigation Header */}
      <Navbar
        user={currentUser}
        activeDealCount={bids.length > 0 ? 1 : 0}
        currentView={currentView}
        onToggleView={setCurrentView}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onLogout={handleLogout}
      />

      {/* View 0: Deal Tracking Hub & User Dashboard */}
      {currentView === "track_deals" && (
        currentUser ? (
          <DealTrackerDashboard
            user={currentUser}
            requests={[activeRequest]}
            bids={bids}
            lockedDeal={lockedDeal}
            savedVehicles={savedVehiclesList}
            onOpenLiveDealRoom={() => setCurrentView("deal_room")}
            onOpenVoucherModal={(deal) => {
              setLockedDeal(deal);
              setIsVoucherModalOpen(true);
            }}
            onStartNewBid={handleOpenFlexibleWizard}
            onInspectSavedVehicle={handleSelectForBid}
            onRemoveSavedVehicle={(id) => setSavedVehicleIds((prev) => prev.filter((vId) => vId !== id))}
          />
        ) : (
          <div className="mx-auto max-w-2xl px-4 py-16 text-center space-y-6">
            <div className="rounded-2xl border border-border bg-surface p-8 space-y-4 shadow-xl">
              <h2 className="text-xl font-black text-white">Sign In to Track Your Car Deals</h2>
              <p className="text-xs text-ink-muted max-w-md mx-auto">
                Log in to your TrimScout account to monitor live reverse bidding, download your locked out-the-door vouchers, and access saved vehicles.
              </p>
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-2.5 text-xs font-black text-black hover:bg-emerald-400 shadow-md shadow-emerald-500/20 transition-all"
              >
                Log In / Switch Account
              </button>
            </div>
          </div>
        )
      )}

      {/* View 1: Clean Opening Search (Carvana-Style) */}
      {currentView === "search" && (
        <MarketSearch
          vehicles={vehicles}
          onSelectForBid={handleSelectForBid}
          onOpenFlexibleWizard={handleOpenFlexibleWizard}
          onOpenConnectorModal={() => setIsConnectorModalOpen(true)}
          onSyncLiveInventory={handleSyncLiveInventory}
          isSyncingInventory={isSyncingInventory}
          onLoadMoreLiveInventory={handleLoadMoreLiveInventory}
          hasMoreVehicles={hasMoreVehicles}
          totalFoundVehicles={totalFoundVehicles}
          isLoadingMore={isLoadingMore}
        />
      )}

      {/* View 2: Reverse Bidding Program Intro Page */}
      {currentView === "bid_program" && (
        <BidProgramIntro
          onStartWizard={handleOpenFlexibleWizard}
          onViewDemoDealRoom={() => setCurrentView("deal_room")}
        />
      )}

      {/* View 3: Live Deal Room (Buyer View) */}
      {currentView === "deal_room" && (
        <LiveDealRoom
          request={activeRequest}
          bids={bids}
          onInspectFee={handleInspectFee}
          onAcceptDeal={handleAcceptDeal}
          onSimulateNewBid={handleSimulateNewBid}
        />
      )}

      {/* View 4: Dealer Partner Portal (Dealer Sales Manager View) */}
      {currentView === "dealer_portal" && (
        <DealerPortal
          requests={[activeRequest]}
          bids={bids}
          vehicles={vehicles}
          lockedDeal={lockedDeal}
          onDealerSubmitBid={handleDealerSubmitBid}
          onDealerUploadPaperwork={handleDealerUploadPaperwork}
          onSwitchToBuyerView={() => setCurrentView("deal_room")}
        />
      )}

      {/* View 5: Dedicated Signup & Registration View */}
      {currentView === "signup" && (
        <div className="animate-fadeIn">
          <SignupView
            onSuccess={(newUser) => {
              handleLogin(newUser);
            }}
            onNavigateHome={() => setCurrentView("search")}
          />
        </div>
      )}

      {/* Bidding Wizard Modal */}
      <BiddingWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        vehicles={vehicles}
        preselectedVehicle={preselectedVehicle}
        onSubmitBidRequest={handleSubmitBidRequest}
      />

      {/* Fee Breakdown Modal */}
      <FeeBreakdownModal
        bid={inspectedBid}
        isOpen={isFeeModalOpen}
        onClose={() => setIsFeeModalOpen(false)}
        onAcceptDeal={handleAcceptDeal}
      />

      {/* Deal Acceptance Voucher Modal */}
      <VoucherModal
        deal={lockedDeal}
        isOpen={isVoucherModalOpen}
        onClose={() => setIsVoucherModalOpen(false)}
      />

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLogin={handleLogin}
      />

      {/* Live Inventory Connector Settings Modal */}
      <InventoryConnectorModal
        isOpen={isConnectorModalOpen}
        onClose={() => setIsConnectorModalOpen(false)}
        onConfigUpdated={() => handleSyncLiveInventory()}
      />
    </main>
  );
}
