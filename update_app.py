import os

BASE = "/Users/paulsmith/.gemini/antigravity/scratch/trimscout"

def write_f(path, content):
    p = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(content.strip() + chr(10))
    print("Wrote " + path)

# Update page.tsx
page_tsx = """"use client";

import React, { useState } from "react";
import { Vehicle, BiddingRequest, DealerBid, LockedDeal } from "../lib/types";
import { MOCK_VEHICLES, INITIAL_DEMO_BIDS } from "../lib/mockData";
import { calculateOtd } from "../lib/otdCalculator";
import { Navbar } from "../components/Navbar";
import { MarketSearch } from "../components/MarketSearch";
import { BidProgramIntro } from "../components/BidProgramIntro";
import { BiddingWizard } from "../components/BiddingWizard";
import { LiveDealRoom } from "../components/LiveDealRoom";
import { FeeBreakdownModal } from "../components/FeeBreakdownModal";
import { VoucherModal } from "../components/VoucherModal";

export default function Home() {
  const [vehicles] = useState<Vehicle[]>(MOCK_VEHICLES);
  const [currentView, setCurrentView] = useState<"search" | "bid_program" | "deal_room">("search");

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
          notes: "Vehicle in stock on showroom floor. Guaranteed $0 add-ons.",
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
    };
    setLockedDeal(deal);
    setIsVoucherModalOpen(true);
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
      matchedVehicleSpec: "Mineral White • Shadowline Pro • Harman Kardon • 19 Wheels",
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

    setBids((prev) => [newBid, ...prev]);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Navigation Header */}
      <Navbar
        onOpenBidProgram={() => setCurrentView("bid_program")}
        activeDealCount={bids.length > 0 ? 1 : 0}
        currentView={currentView}
        onToggleView={setCurrentView}
      />

      {/* View 1: Clean Opening Search (Carvana-Style) */}
      {currentView === "search" && (
        <MarketSearch
          vehicles={vehicles}
          onSelectForBid={handleSelectForBid}
          onOpenFlexibleWizard={handleOpenFlexibleWizard}
        />
      )}

      {/* View 2: Reverse Bidding Program Intro Page */}
      {currentView === "bid_program" && (
        <BidProgramIntro
          onStartWizard={handleOpenFlexibleWizard}
          onViewDemoDealRoom={() => setCurrentView("deal_room")}
        />
      )}

      {/* View 3: Live Deal Room */}
      {currentView === "deal_room" && (
        <LiveDealRoom
          request={activeRequest}
          bids={bids}
          onInspectFee={handleInspectFee}
          onAcceptDeal={handleAcceptDeal}
          onSimulateNewBid={handleSimulateNewBid}
        />
      )}

      {/* Bidding Wizard Modal */}
      <BiddingWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
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
    </main>
  );
}
"""

write_f("app/page.tsx", page_tsx)
