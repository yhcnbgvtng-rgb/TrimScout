"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useSession, signOut as authSignOut } from "next-auth/react";
import { Vehicle, BiddingRequest, DealerBid, LockedDeal, UserProfile } from "../lib/types";
import { MOCK_VEHICLES, INITIAL_DEMO_BIDS, SAMPLE_TRADE_IN_VEHICLE, DEMO_BUYER_USER } from "../lib/mockData";
import { fetchLiveInventory } from "../lib/inventoryConnector";
import { mapDealRequestJson } from "../lib/shopperDeal";
import { consumeLandingView, loadShopperRequests, upsertShopperRequest } from "../lib/offerCompare";
import { Navbar } from "../components/Navbar";
import { BidProgramIntro } from "../components/BidProgramIntro";
import { BiddingWizard } from "../components/BiddingWizard";
import { LiveDealRoom } from "../components/LiveDealRoom";
import { DealerPortal } from "../components/DealerPortal";
import { FeeBreakdownModal } from "../components/FeeBreakdownModal";
import { VoucherModal } from "../components/VoucherModal";
import { AuthModal } from "../components/AuthModal";
import { DealTrackerDashboard } from "../components/DealTrackerDashboard";
import { SignupView } from "../components/SignupView";
import { AdminPortal } from "../components/AdminPortal";
import { DealerAnalytics } from "../components/DealerAnalytics";

function isPersistedDealId(id: string): boolean {
  return /^\d+$/.test(id);
}

export default function Home() {
  const [vehicles, setVehicles] = useState<Vehicle[]>(MOCK_VEHICLES);
  const [currentView, setCurrentView] = useState<"bid_program" | "deal_room" | "dealer_portal" | "dealer_analytics" | "track_deals" | "signup" | "admin">("bid_program");
  const [isImpersonating, setIsImpersonating] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("trimscout_impersonating") !== null;
    }
    return false;
  });

  // User Authentication State — currentUser is populated either from a real
  // Auth.js session (see the sync effect below) or from a demo-profile pick
  // in AuthModal's "1-Click Demo" tab. No default: a fresh visit is
  // genuinely logged out now that real auth exists (this used to default to
  // DEMO_BUYER_USER, which silently auto-logged in every visitor).
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const { data: session, status: sessionStatus } = useSession();
  const [savedVehicleIds, setSavedVehicleIds] = useState<string[]>(["veh-1", "veh-4"]);

  // Live Inventory Connector State & Pagination
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
  const [shopperRequests, setShopperRequests] = useState<BiddingRequest[]>([]);

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
      const storedRequests = loadShopperRequests();
      if (storedRequests.length > 0) {
        setShopperRequests(storedRequests);
        setActiveRequest(storedRequests[0]);
      }
      const landing = consumeLandingView();
      if (landing) setCurrentView(landing);
    }
    handleSyncLiveInventory("94107", 25, undefined, undefined, 500);
  }, []);

  // Real Auth.js session -> currentUser sync. Runs whenever the session
  // resolves (page load, after sign-in, after OAuth redirect back). Admin
  // impersonation (see AdminPortal's onImpersonateUser below) is a
  // separate, real-session-free path and this effect leaves it alone — it
  // only acts when Auth.js actually has something to report.
  //
  // Navigation to the role dashboard only fires on a genuine sign-in
  // transition within this browser session (status flips from
  // "unauthenticated" to "authenticated" — tracked via prevSessionStatusRef)
  // — not on a fresh page load/reload with an already-valid session, where
  // status goes straight "loading" -> "authenticated" and the site should
  // land on the Bid Program Intro like any other fresh visit. The
  // lastSyncedUserIdRef check on top of that still guards against
  // re-navigating on Auth.js's window-focus session re-polls.
  const lastSyncedUserIdRef = React.useRef<string | null>(null);
  const prevSessionStatusRef = React.useRef(sessionStatus);
  useEffect(() => {
    if (sessionStatus === "authenticated" && session?.user) {
      const su = session.user as any;
      setCurrentUser({
        id: su.id,
        name: su.name || su.email?.split("@")[0] || "Member",
        email: su.email || "",
        role: su.role || "buyer",
        phone: su.phone || "",
        zipCode: su.zipCode || "94107",
        dealerName: su.dealerName || undefined,
        avatarUrl: su.image || undefined,
        buyerAlias: su.role === "buyer" ? `Buyer #${su.id}` : undefined,
        savedVehicleIds: [],
      });
      const isFreshSignIn = prevSessionStatusRef.current === "unauthenticated";
      if (isFreshSignIn && lastSyncedUserIdRef.current !== su.id) {
        lastSyncedUserIdRef.current = su.id;
        setCurrentView(su.role === "dealer" ? "dealer_analytics" : "track_deals");
      } else {
        lastSyncedUserIdRef.current = su.id;
      }
    }
    prevSessionStatusRef.current = sessionStatus;
  }, [session, sessionStatus]);

  const persistedShopperIds = shopperRequests.map((r) => r.id).filter(isPersistedDealId).join(",");

  useEffect(() => {
    if (currentView !== "track_deals") return;
    if (!currentUser || currentUser.role !== "buyer") return;
    let cancelled = false;

    const loadRequests = async () => {
      try {
        const res = await fetch("/api/deal-requests");
        if (!res.ok) return;
        const json = await res.json();
        const rows = Array.isArray(json.dealRequests) ? json.dealRequests : [];
        if (cancelled || rows.length === 0) return;
        setShopperRequests((prev) => {
          const byId = new Map(prev.map((r) => [r.id, r]));
          for (const row of rows) {
            const mapped = mapDealRequestJson(row as Record<string, unknown>, byId.get(String((row as { id?: string }).id)));
            byId.set(mapped.id, mapped);
          }
          return Array.from(byId.values());
        });
      } catch {
        // Local tracker rows from this session still show if the box is down.
      }
    };

    const loadBids = async () => {
      const ids = persistedShopperIds.split(",").filter(Boolean);
      if (ids.length === 0) return;
      const collected: DealerBid[] = [];
      for (const id of ids) {
        try {
          const res = await fetch(`/api/deal-requests/${id}/bids`);
          if (!res.ok) continue;
          const json = await res.json();
          for (const b of json.bids || []) {
            collected.push({
              ...b,
              dealerCity: b.dealerCity || "",
              dealerState: b.dealerState || "",
              distanceMiles: b.distanceMiles || 0,
              matchedVehicleSpec: b.matchedVehicleSpec || "",
              matchedVehicleImageUrl: b.matchedVehicleImageUrl || "",
            });
          }
        } catch {
          // Next poll retries.
        }
      }
      if (cancelled || collected.length === 0) return;
      setBids((prev) => {
        const keep = prev.filter((b) => !ids.includes(b.dealRequestId));
        return [...keep, ...collected];
      });
    };

    loadRequests();
    loadBids();
    const interval = setInterval(loadBids, 9000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentView, currentUser, persistedShopperIds]);

  const handleLogout = () => {
    setCurrentUser(null);
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("trimscout_current_user");
      } catch (e) {}
    }
    setCurrentView("bid_program");
    // Only real Auth.js sessions (email/password, Google, Apple) need this;
    // a demo-tab profile never created one, and signOut() is a harmless
    // no-op when there's no session to clear.
    if (sessionStatus === "authenticated") {
      authSignOut({ redirect: false });
    }
  };

  // Sync Live Inventory from Connector
  const handleSyncLiveInventory = async (
    zip: string = "94107",
    radius: number = 25,
    query?: string,
    make?: string,
    limit: number = 500
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
        limit, // Load up to 500-1000 vehicles across parallel stream pages
      });
      if (res.success && res.data.length > 0) {
        setVehicles(res.data);
        setTotalFoundVehicles(res.totalFound || res.data.length);
        setHasMoreVehicles(res.hasMore ?? (res.totalFound ? res.totalFound > res.data.length : res.data.length >= limit));
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
        limit: 150,
      });
      if (res.success && res.data.length > 0) {
        setVehicles(prev => {
          const existingIds = new Set(prev.map(v => v.id || v.vin));
          const newUnique = res.data.filter(v => !existingIds.has(v.id || v.vin));
          return [...prev, ...newUnique];
        });
        setCurrentPage(nextPage);
        setHasMoreVehicles(res.hasMore ?? (res.totalFound ? res.totalFound > (vehicles.length + res.data.length) : res.data.length >= 150));
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

  const rememberShopperRequest = (request: BiddingRequest) => {
    setShopperRequests((prev) => [request, ...prev.filter((r) => r.id !== request.id)]);
    setActiveRequest(request);
    upsertShopperRequest(request);
  };

  const handleRealBidRequestCreated = (request: BiddingRequest) => {
    rememberShopperRequest(request);
  };

  const handleSubmitBidRequest = (newRequest: BiddingRequest) => {
    rememberShopperRequest(newRequest);
  };

  const handleInspectFee = (bid: DealerBid) => {
    setInspectedBid(bid);
    setIsFeeModalOpen(true);
  };

  // Called only after a real Stripe payment is confirmed (see the checkout
  // verification effect below) — certificateId comes from the deals table
  // on the box, not generated client-side, since it's now a real paid
  // record rather than a demo placeholder.
  const finalizeLockedDeal = (certificateId: string, bid: DealerBid) => {
    const deal: LockedDeal = {
      certificateId,
      winningBid: bid,
      lockedAt: new Date().toLocaleDateString(),
      expiresAt: "5 Business Days",
      paperworkStatus: "pending_dealer_upload",
      deliveryMethod: "driveway_delivery",
    };
    setLockedDeal(deal);
    setIsVoucherModalOpen(true);
  };

  // After a buyer completes payment on Stripe's hosted checkout, they're
  // redirected back here with ?checkout=success&dealId=... in the URL. The
  // SPA has remounted at that point (Stripe Checkout is a real navigation
  // away from the page), so the locked deal has to be reconstructed from
  // the server rather than from in-memory state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get("checkout");
    const dealId = params.get("dealId");
    if (!checkoutStatus || !dealId) return;

    window.history.replaceState({}, "", window.location.pathname);

    if (checkoutStatus !== "success") return;

    let cancelled = false;
    const verify = async (attempt: number) => {
      try {
        const res = await fetch(`/api/checkout/verify?dealId=${dealId}`);
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json.deal?.status === "paid") {
          finalizeLockedDeal(json.deal.certificateId, json.deal.winningBid as DealerBid);
          return;
        }
        // The Stripe webhook can land a beat after the redirect — retry
        // briefly before giving up.
        if (attempt < 3) {
          setTimeout(() => verify(attempt + 1), 1500);
        }
      } catch {
        // Silent — worst case the buyer's payment succeeded but the
        // voucher didn't auto-open; nothing destructive happened.
      }
    };
    verify(0);
    return () => {
      cancelled = true;
    };
  }, []);

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

      {/* Impersonation Active Banner */}
      {isImpersonating && currentUser && (
        <div className="bg-amber-500/20 border-b border-amber-500/40 px-4 py-2 text-xs text-amber-200 flex items-center justify-between gap-2 z-30">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-ping" />
            <span>
              <strong>Admin Mode:</strong> Currently impersonating <strong>{currentUser.name}</strong> ({currentUser.role === "buyer" ? (currentUser.buyerAlias || "Buyer") : (currentUser.dealerName || "Dealer")}).
            </span>
          </div>
          <button
            onClick={() => {
              if (typeof window !== "undefined") {
                localStorage.removeItem("trimscout_impersonating");
              }
              setIsImpersonating(false);
              setCurrentView("admin");
            }}
            className="rounded-lg bg-amber-500 hover:bg-amber-400 px-3 py-1 text-[11px] font-black text-black transition-all shadow-sm"
          >
            Return to Admin Portal →
          </button>
        </div>
      )}

      {/* View 0: Deal Tracking Hub & User Dashboard */}
      {currentView === "track_deals" && (
        currentUser ? (
          <DealTrackerDashboard
            user={currentUser}
            requests={shopperRequests}
            bids={bids}
            lockedDeal={lockedDeal}
            savedVehicles={savedVehiclesList}
            onOpenLiveDealRoom={(request) => {
              setActiveRequest(request);
              setCurrentView("deal_room");
            }}
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
          bids={bids.filter((b) => b.dealRequestId === activeRequest.id)}
          onInspectFee={handleInspectFee}
          pollBids={isPersistedDealId(activeRequest.id)}
        />
      )}

      {/* View: AI Sales Analytics — the new default landing view for dealers
          on login, real inventory data (see app/api/dealer-analytics). */}
      {currentView === "dealer_analytics" && currentUser && (
        <div className="animate-fadeIn">
          <DealerAnalytics user={currentUser} />
          <div className="max-w-6xl mx-auto px-4 pb-8">
            <button
              onClick={() => setCurrentView("dealer_portal")}
              className="text-xs text-ink-muted hover:text-emerald-400 transition-colors"
            >
              Manage active bids & deals →
            </button>
          </div>
        </div>
      )}

      {/* View 4: Dealer Partner Portal (Dealer Sales Manager View) */}
      {currentView === "dealer_portal" && (
        currentUser?.role === "dealer" ? (
          <DealerPortal
            currentUser={currentUser}
            lockedDeal={lockedDeal}
            onDealerUploadPaperwork={handleDealerUploadPaperwork}
            onSwitchToBuyerView={() => setCurrentView("deal_room")}
          />
        ) : (
          <div className="mx-auto max-w-md px-4 py-24 text-center space-y-4">
            <p className="text-sm text-ink-muted">Sign in with a dealer account to view the Dealer Portal.</p>
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="rounded-xl bg-emerald-500 px-5 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all"
            >
              Sign In
            </button>
          </div>
        )
      )}

      {/* View 5: Dedicated Signup & Registration View */}
      {currentView === "signup" && (
        <div className="animate-fadeIn">
          <SignupView
            onSuccess={() => setCurrentView("bid_program")}
            onNavigateHome={() => setCurrentView("bid_program")}
          />
        </div>
      )}

      {/* View 6: Secret Admin Command Center */}
      {currentView === "admin" && (
        <div className="animate-fadeIn">
          <AdminPortal
            onImpersonateUser={(targetUser) => {
              setCurrentUser(targetUser);
              setIsImpersonating(true);
              if (typeof window !== "undefined") {
                try {
                  localStorage.setItem("trimscout_current_user", JSON.stringify(targetUser));
                  localStorage.setItem("trimscout_impersonating", JSON.stringify({
                    originalAdmin: true,
                    target: targetUser.name,
                  }));
                } catch {}
              }
              if (targetUser.role === "dealer") {
                setCurrentView("dealer_portal");
              } else {
                setCurrentView("track_deals");
              }
            }}
            onExitAdmin={() => setCurrentView("bid_program")}
          />
        </div>
      )}

      {/* Site Footer */}
      <footer className="border-t border-border/60 mt-12 py-6 text-center text-xs text-ink-faint">
        <p>© 2026 TrimScout Inc. Built for transparent, reverse-bid automotive transactions.</p>
        <p className="mt-2 flex items-center justify-center gap-4">
          <Link href="/terms" className="hover:text-white transition-colors">Terms of Use</Link>
          <span className="text-border-strong">•</span>
          <Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
        </p>
      </footer>

      {/* Bidding Wizard Modal */}
      <BiddingWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        vehicles={vehicles}
        preselectedVehicle={preselectedVehicle}
        currentUser={currentUser}
        onRequireLogin={() => setIsAuthModalOpen(true)}
        onRealBidRequestCreated={handleRealBidRequestCreated}
        onSubmitBidRequest={handleSubmitBidRequest}
      />

      {/* Fee Breakdown Modal */}
      <FeeBreakdownModal
        bid={inspectedBid}
        isOpen={isFeeModalOpen}
        currentUser={currentUser}
        onClose={() => setIsFeeModalOpen(false)}
        onRequireLogin={() => setIsAuthModalOpen(true)}
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
      />
    </main>
  );
}
