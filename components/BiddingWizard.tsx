"use client";

import React, { useState, useEffect } from "react";
import { Vehicle, BiddingStrategy, PaymentMethod, BiddingRequest, TradeInVehicle, TradeInPhoto } from "../lib/types";
import { formatCurrency, getEstimatedTaxRate } from "../lib/otdCalculator";
import { MOCK_POPULAR_PACKAGES, SAMPLE_TRADE_IN_VEHICLE } from "../lib/mockData";
import { decodeVin, SAMPLE_TEST_VINS, DecodedVehicle } from "../lib/vinDecoder";
import {
  X,
  ShieldCheck,
  Zap,
  ArrowRight,
  ArrowLeft,
  Search,
  CheckCircle2,
  Percent,
  RefreshCw,
  DollarSign,
  Car,
  MapPin,
  Camera,
  UploadCloud,
  Trash2,
  Image as ImageIcon,
  Sparkles,
  HelpCircle,
  Link2,
  Globe,
  Loader2,
  ExternalLink,
  Layers,
  Coins,
  CreditCard,
  KeyRound
} from "lucide-react";

interface BiddingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  vehicles: Vehicle[];
  preselectedVehicle?: Vehicle | null;
  initialStrategy?: BiddingStrategy;
  onSubmitBidRequest: (request: BiddingRequest) => void;
}

export const BiddingWizard: React.FC<BiddingWizardProps> = ({
  isOpen,
  onClose,
  vehicles,
  preselectedVehicle,
  initialStrategy = "flexible_discount",
  onSubmitBidRequest,
}) => {
  const [step, setStep] = useState<number>(1);
  const [strategy, setStrategy] = useState<BiddingStrategy>(initialStrategy);

  // Step 1: Vehicle Selection Mode (Dealer Link vs Catalog Search)
  const [selectionMode, setSelectionMode] = useState<"paste_link" | "catalog_search">("paste_link");
  const [dealerUrlInput, setDealerUrlInput] = useState<string>(
    "https://www.bmwsanrafael.com/inventory/new-2026-bmw-3-series-330i-m-sport-wba33ay08rf892110/"
  );
  const [isParsingLink, setIsParsingLink] = useState<boolean>(false);
  const [parseSuccessMsg, setParseSuccessMsg] = useState<string | null>(null);

  // Vehicle Search & Selection inside Wizard
  const [vehicleSearchQuery, setVehicleSearchQuery] = useState<string>("");
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(preselectedVehicle || null);

  // Custom/Flexible Spec Fields
  const [make, setMake] = useState<string>("BMW");
  const [model, setModel] = useState<string>("3 Series");
  const [selectedTrims, setSelectedTrims] = useState<string[]>(["330i M Sport", "330i xDrive"]);
  const [mustHavePackages, setMustHavePackages] = useState<string[]>(["M Sport Package", "Premium Package"]);

  // Trade-In Evaluation & Photo Upload State
  const [hasTradeIn, setHasTradeIn] = useState<boolean>(true);
  const [tradeInYear, setTradeInYear] = useState<number>(2022);
  const [tradeInMake, setTradeInMake] = useState<string>("Audi");
  const [tradeInModel, setTradeInModel] = useState<string>("A4");
  const [tradeInTrim, setTradeInTrim] = useState<string>("45 TFSI Quattro Premium Plus");
  const [tradeInMileage, setTradeInMileage] = useState<number>(28450);
  const [tradeInVin, setTradeInVin] = useState<string>("WAUZZAF42NA091482");
  const [tradeInCondition, setTradeInCondition] = useState<"excellent" | "very_good" | "good" | "fair">("very_good");
  const [tradeInPhotos, setTradeInPhotos] = useState<TradeInPhoto[]>(SAMPLE_TRADE_IN_VEHICLE.photos);

  // Live NHTSA VIN Decoder State
  const [isDecodingVin, setIsDecodingVin] = useState<boolean>(false);
  const [decodedVinResult, setDecodedVinResult] = useState<DecodedVehicle | null>(null);
  const [vinLookupError, setVinLookupError] = useState<string | null>(null);

  const handleDecodeVin = async (vinToDecode: string) => {
    const cleanVin = (vinToDecode || "").trim().toUpperCase();
    if (cleanVin.length !== 17) {
      setVinLookupError("Please enter a full 17-character VIN");
      return;
    }
    setVinLookupError(null);
    setIsDecodingVin(true);
    try {
      const data = await decodeVin(cleanVin);
      if (data) {
        setDecodedVinResult(data);
        setTradeInVin(data.vin);
        if (data.year) setTradeInYear(data.year);
        if (data.make) setTradeInMake(data.make);
        if (data.model) setTradeInModel(data.model);
        if (data.trim) setTradeInTrim(data.trim);
      }
    } catch (err: any) {
      setVinLookupError(err.message || "Failed to decode VIN from NHTSA database");
    } finally {
      setIsDecodingVin(false);
    }
  };

  // Step 4: Deal Structuring Fields (All 3 / Cash / Finance / Lease)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("all_three");
  const [financeTerm, setFinanceTerm] = useState<number>(60);
  const [downPayment, setDownPayment] = useState<number>(5000);
  const [leaseMileage, setLeaseMileage] = useState<number>(12000);
  const [leaseTerm, setLeaseTerm] = useState<number>(36);

  // Financial & Geographic fields
  const [targetOtdPrice, setTargetOtdPrice] = useState<number>(52000);
  const [targetDiscountPercent, setTargetDiscountPercent] = useState<number>(8.5);
  const [buyerZip, setBuyerZip] = useState<string>("94107");
  const [searchRadius, setSearchRadius] = useState<number>(150);

  useEffect(() => {
    if (preselectedVehicle) {
      setSelectedVehicle(preselectedVehicle);
      setMake(preselectedVehicle.make);
      setModel(preselectedVehicle.model);
      setSelectedTrims([preselectedVehicle.trim]);
      setMustHavePackages(preselectedVehicle.packages);
      setTargetOtdPrice(Math.round(preselectedVehicle.msrp * 0.92));
      setSelectionMode("catalog_search");
    }
  }, [preselectedVehicle]);

  const handleParseDealerUrl = (urlToParse?: string) => {
    const url = (urlToParse || dealerUrlInput).trim().toLowerCase();
    if (!url) return;

    setIsParsingLink(true);
    setParseSuccessMsg(null);

    setTimeout(() => {
      // Smart matching against vehicles network
      let matched = vehicles.find((v) => {
        if (url.includes(v.vin.toLowerCase())) return true;
        if (url.includes("porsche") && v.make === "Porsche") return true;
        if (url.includes("toyota") && v.make === "Toyota") return true;
        if (url.includes("mercedes") && v.make === "Mercedes-Benz") return true;
        if (url.includes("bmw") && v.make === "BMW") return true;
        if (url.includes(v.make.toLowerCase())) return true;
        return false;
      }) || vehicles[0];

      setSelectedVehicle(matched);
      setMake(matched.make);
      setModel(matched.model);
      setSelectedTrims([matched.trim]);
      setMustHavePackages(matched.packages);
      setTargetOtdPrice(Math.round(matched.msrp * 0.92));
      setIsParsingLink(false);
      setParseSuccessMsg(`✓ Decoded Window Sticker from ${matched.location.dealerName}! (VIN: ${matched.vin} • ${formatCurrency(matched.msrp)} MSRP)`);
    }, 700);
  };

  if (!isOpen) return null;

  const estimatedTaxPercent = (getEstimatedTaxRate(buyerZip) * 100).toFixed(2);

  // Filter vehicles within wizard search
  const matchingVehicles = vehicles.filter((v) => {
    if (!vehicleSearchQuery.trim()) return true;
    const q = vehicleSearchQuery.toLowerCase();
    return (
      v.make.toLowerCase().includes(q) ||
      v.model.toLowerCase().includes(q) ||
      v.trim.toLowerCase().includes(q) ||
      v.vin.toLowerCase().includes(q) ||
      v.packages.some((p) => p.toLowerCase().includes(q))
    );
  });

  const handleSelectVehicleCard = (v: Vehicle) => {
    setSelectedVehicle(v);
    setMake(v.make);
    setModel(v.model);
    setSelectedTrims([v.trim]);
    setMustHavePackages(v.packages);
    setTargetOtdPrice(Math.round(v.msrp * 0.92));
    setStep(2); // Advance to strategy choice
  };

  const toggleTrim = (trim: string) => {
    if (selectedTrims.includes(trim)) {
      if (selectedTrims.length > 1) {
        setSelectedTrims(selectedTrims.filter((t) => t !== trim));
      }
    } else {
      setSelectedTrims([...selectedTrims, trim]);
    }
  };

  const togglePackage = (pkgName: string) => {
    if (mustHavePackages.includes(pkgName)) {
      setMustHavePackages(mustHavePackages.filter((p) => p !== pkgName));
    } else {
      setMustHavePackages([...mustHavePackages, pkgName]);
    }
  };

  const handleRemovePhoto = (photoId: string) => {
    setTradeInPhotos(tradeInPhotos.filter((p) => p.id !== photoId));
  };

  const handleAddSamplePhoto = (angle: TradeInPhoto["angle"], label: string, imageUrl: string) => {
    const existing = tradeInPhotos.find((p) => p.angle === angle);
    if (existing) {
      setTradeInPhotos(tradeInPhotos.map((p) => (p.angle === angle ? { ...p, imageUrl } : p)));
    } else {
      setTradeInPhotos([...tradeInPhotos, { id: `tp-${Date.now()}`, angle, label, imageUrl }]);
    }
  };

  const handleLaunchDeal = () => {
    const newRequest: BiddingRequest = {
      id: `req-${Date.now()}`,
      strategy,
      targetVin: selectedVehicle?.vin,
      targetVehicle: selectedVehicle || undefined,
      flexibleCriteria: {
        make,
        model,
        trims: selectedTrims,
        minMsrp: selectedVehicle ? Math.round(selectedVehicle.msrp * 0.9) : 45000,
        maxMsrp: selectedVehicle ? Math.round(selectedVehicle.msrp * 1.1) : 65000,
        mustHavePackages,
        preferredColors: ["Mineral Grey", "Black Sapphire", "Brooklyn Grey"],
        dealbreakers: ["Red Interior"],
        allowedStatuses: ["on_lot", "in_transit"],
      },
      tradeIn: hasTradeIn
        ? {
            hasTradeIn: true,
            year: tradeInYear,
            make: tradeInMake,
            model: tradeInModel,
            trim: tradeInTrim,
            mileage: tradeInMileage,
            vin: tradeInVin,
            condition: tradeInCondition,
            estimatedValueMin: 24500,
            estimatedValueMax: 26800,
            photos: tradeInPhotos,
          }
        : undefined,
      targetOtdPrice: strategy === "firm_offer" ? targetOtdPrice : undefined,
      targetDiscountPercent: strategy === "flexible_discount" ? targetDiscountPercent : undefined,
      paymentMethod,
      dealStructurePreferences: {
        requestedStructures:
          paymentMethod === "all_three"
            ? ["cash", "finance", "lease"]
            : [paymentMethod],
        financeTermMonths: financeTerm,
        downPayment,
        leaseMileagePerYear: leaseMileage,
        leaseTermMonths: leaseTerm,
      },
      buyerZip,
      searchRadiusMiles: searchRadius,
      createdAt: "Just now",
      expiresAt: "48 Hours",
      status: "active",
    };

    onSubmitBidRequest(newRequest);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-border-strong bg-surface shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-surface-elevated px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <Zap className="h-4 w-4 fill-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Launch Dealership Bidding Hunt</h2>
              <p className="text-xs text-ink-muted">Step {step} of 5 • Certified Dealer Reverse Auction</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-border hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Wizard Body */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* ========================================================================= */}
          {/* STEP 1: SEARCH & SELECT THE TARGET VEHICLE                                */}
          {/* ========================================================================= */}
          {/* ========================================================================= */}
          {/* STEP 1: SEARCH & SELECT THE TARGET VEHICLE                                */}
          {/* ========================================================================= */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                  Step 1: Choose Your Target Car
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  Paste a direct dealership listing link, or search our nationwide inventory network.
                </p>
              </div>

              {/* Mode Selector Tabs */}
              <div className="grid grid-cols-2 gap-2 bg-surface p-1 rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => setSelectionMode("paste_link")}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                    selectionMode === "paste_link"
                      ? "bg-emerald-500 text-black shadow-md"
                      : "text-ink-muted hover:text-white"
                  }`}
                >
                  <Link2 className="h-4 w-4" />
                  <span>Paste Dealer Link (Fastest)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectionMode("catalog_search")}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                    selectionMode === "catalog_search"
                      ? "bg-emerald-500 text-black shadow-md"
                      : "text-ink-muted hover:text-white"
                  }`}
                >
                  <Search className="h-4 w-4" />
                  <span>Search Network Catalog</span>
                </button>
              </div>

              {/* TAB 1: PASTE DEALER LINK */}
              {selectionMode === "paste_link" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-ink-light uppercase flex items-center justify-between">
                      <span>Paste Dealer / Listing URL (Autotrader, Dealer Website, Cars.com):</span>
                    </label>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-400" />
                        <input
                          type="url"
                          value={dealerUrlInput}
                          onChange={(e) => setDealerUrlInput(e.target.value)}
                          placeholder="https://www.bmwsanrafael.com/inventory/new-2026-bmw-3-series..."
                          className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-3 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleParseDealerUrl()}
                        disabled={isParsingLink || !dealerUrlInput.trim()}
                        className="rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-md flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 active:scale-95"
                      >
                        {isParsingLink ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Decoding Window Sticker...</span>
                          </>
                        ) : (
                          <>
                            <Zap className="h-4 w-4 fill-black" />
                            <span>Import Car →</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Quick 1-Click Preset Samples */}
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[10px] uppercase font-bold text-ink-faint">
                        Or click a sample dealer link to test:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const url = "https://www.bmwsanrafael.com/new/BMW/2026-BMW-330i-M-Sport-wba33ay08rf892110.htm";
                            setDealerUrlInput(url);
                            handleParseDealerUrl(url);
                          }}
                          className="rounded-lg bg-surface-elevated hover:bg-emerald-500/20 border border-border hover:border-emerald-500/40 px-2.5 py-1 text-[11px] text-ink-light hover:text-white transition-all flex items-center gap-1"
                        >
                          <Sparkles className="h-3 w-3 text-emerald-400" />
                          <span>BMW of San Rafael (330i M Sport)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const url = "https://www.porschesanfrancisco.com/inventory/new-2026-porsche-911-carrera-s-coupe-wp0ab2a98ts198231/";
                            setDealerUrlInput(url);
                            handleParseDealerUrl(url);
                          }}
                          className="rounded-lg bg-surface-elevated hover:bg-emerald-500/20 border border-border hover:border-emerald-500/40 px-2.5 py-1 text-[11px] text-ink-light hover:text-white transition-all flex items-center gap-1"
                        >
                          <Sparkles className="h-3 w-3 text-emerald-400" />
                          <span>Porsche San Francisco (911 Carrera S)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const url = "https://www.marintoyota.com/new-inventory/2026-toyota-prius-prime-xse-jtdekabf3r3089124.htm";
                            setDealerUrlInput(url);
                            handleParseDealerUrl(url);
                          }}
                          className="rounded-lg bg-surface-elevated hover:bg-emerald-500/20 border border-border hover:border-emerald-500/40 px-2.5 py-1 text-[11px] text-ink-light hover:text-white transition-all flex items-center gap-1"
                        >
                          <Sparkles className="h-3 w-3 text-emerald-400" />
                          <span>Marin Toyota (Prius Prime XSE)</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Decoded Vehicle Preview Box */}
                  {parseSuccessMsg && selectedVehicle && (
                    <div className="rounded-2xl border-2 border-emerald-500/60 bg-gradient-to-r from-emerald-950/40 via-surface to-surface p-4 space-y-3 shadow-lg animate-fadeIn">
                      <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        <span>{parseSuccessMsg}</span>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-border/50 pt-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-emerald-500 text-black px-1.5 py-0.2 text-[10px] font-black">
                              {selectedVehicle.year} {selectedVehicle.make}
                            </span>
                            <span className="font-extrabold text-white text-sm">
                              {selectedVehicle.model} <span className="text-emerald-400">{selectedVehicle.trim}</span>
                            </span>
                          </div>
                          <p className="text-xs text-ink-muted">
                            VIN: <span className="font-mono text-ink-light">{selectedVehicle.vin}</span> • {selectedVehicle.engine} • {selectedVehicle.exteriorColor}
                          </p>
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {selectedVehicle.packages.map((p, i) => (
                              <span key={i} className="rounded bg-surface-elevated px-1.5 py-0.2 text-[10px] text-ink-light border border-border">
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="sm:text-right shrink-0 space-y-1">
                          <div>
                            <div className="text-[11px] text-ink-muted line-through">MSRP {formatCurrency(selectedVehicle.msrp)}</div>
                            <div className="text-base font-black text-white">{formatCurrency(selectedVehicle.dealerPrice)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setStep(2)}
                            className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all flex items-center gap-1 shadow-md"
                          >
                            <span>Lock This Car & Continue →</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: SEARCH CATALOG */}
              {selectionMode === "catalog_search" && (
                <div className="space-y-4">
                  {/* Vehicle Search Bar */}
                  <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
                    <input
                      type="text"
                      value={vehicleSearchQuery}
                      onChange={(e) => setVehicleSearchQuery(e.target.value)}
                      placeholder="Search Make, Model, Trim, Option (e.g. BMW 330i, Porsche 911, Prius)..."
                      className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-4 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
                      autoFocus
                    />
                  </div>

                  {/* Quick Model Cards */}
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {matchingVehicles.map((v) => {
                      const isSelected = selectedVehicle?.id === v.id;
                      return (
                        <div
                          key={v.id}
                          onClick={() => handleSelectVehicleCard(v)}
                          className={`cursor-pointer rounded-xl border p-3 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                            isSelected
                              ? "border-emerald-500 bg-emerald-500/10 shadow-md ring-1 ring-emerald-500"
                              : "border-border bg-surface-elevated hover:border-border-strong hover:bg-background"
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[10px] font-bold text-emerald-400">
                                {v.year} {v.make}
                              </span>
                              <span className="font-bold text-white text-xs">
                                {v.model} <span className="text-ink-light">{v.trim}</span>
                              </span>
                            </div>
                            <p className="text-[11px] text-ink-muted">
                              {v.engine} • {v.drivetrain} • {v.exteriorColor}
                            </p>
                          </div>

                          <div className="sm:text-right shrink-0 flex items-center sm:flex-col sm:items-end gap-2">
                            <div>
                              <div className="text-[10px] text-ink-muted line-through">MSRP {formatCurrency(v.msrp)}</div>
                              <div className="text-xs font-extrabold text-white">{formatCurrency(v.dealerPrice)}</div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectVehicleCard(v);
                              }}
                              className="rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-bold text-black hover:bg-emerald-400 transition-all"
                            >
                              Select →
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 2: CHOOSE STRATEGY                                                   */}
          {/* ========================================================================= */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                  Step 2: Choose Your Bidding Strategy
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  Selected Car: <strong className="text-white">{selectedVehicle ? `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model} ${selectedVehicle.trim}` : `${make} ${model}`}</strong>
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {/* Strategy 1: Find your car based on Make and Model */}
                <div
                  onClick={() => setStrategy("flexible_discount")}
                  className={`cursor-pointer rounded-xl border p-4 transition-all ${
                    strategy === "flexible_discount"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-md ring-1 ring-emerald-500"
                      : "border-border bg-surface-elevated hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-black font-bold shrink-0">
                      <Percent className="h-4 w-4 stroke-[2.5]" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-white text-sm">Find your car based on Make and Model</h4>
                        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-extrabold text-emerald-400 border border-emerald-500/30">
                          RECOMMENDED
                        </span>
                      </div>
                      <p className="text-xs text-ink-muted mt-1">
                        Select your make and model with must-have options. Dealers attach matching in-stock & in-transit units and compete on <strong>highest % discount from MSRP</strong>.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Strategy 2: Find your car based on must have specs */}
                <div
                  onClick={() => setStrategy("exact_auction")}
                  className={`cursor-pointer rounded-xl border p-4 transition-all ${
                    strategy === "exact_auction"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-md ring-1 ring-emerald-500"
                      : "border-border bg-surface-elevated hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 font-bold shrink-0">
                      <RefreshCw className="h-4 w-4 stroke-[2.5]" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-sm">Find your car based on must have specs</h4>
                      <p className="text-xs text-ink-muted mt-1">
                        Dealers battle over 48 hours with their <strong>lowest Out-The-Door (OTD) price</strong> on your required build or exact VIN.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Strategy 3: Firm Target Offer */}
                <div
                  onClick={() => setStrategy("firm_offer")}
                  className={`cursor-pointer rounded-xl border p-4 transition-all ${
                    strategy === "firm_offer"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-md ring-1 ring-emerald-500"
                      : "border-border bg-surface-elevated hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400 font-bold shrink-0">
                      <DollarSign className="h-4 w-4 stroke-[2.5]" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-sm">Firm Buyer Target Offer</h4>
                      <p className="text-xs text-ink-muted mt-1">
                        Set a firm buy-it-now price (e.g. <i>"$48,500 OTD"</i>). The first dealer to accept locks the sale immediately.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Must-Have Option Packages Selection */}
              <div className="space-y-2 pt-3 border-t border-border/50">
                <label className="text-xs font-semibold text-ink-light">
                  Confirm Must-Have Factory Packages:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {MOCK_POPULAR_PACKAGES.map((pkg) => {
                    const isChecked = mustHavePackages.includes(pkg.name);
                    return (
                      <div
                        key={pkg.name}
                        onClick={() => togglePackage(pkg.name)}
                        className={`flex items-center gap-2 rounded-lg border p-2 text-xs cursor-pointer transition-all ${
                          isChecked
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-300 font-semibold"
                            : "border-border bg-surface-elevated text-ink-muted hover:border-border-strong"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="rounded border-border text-emerald-500 focus:ring-0"
                        />
                        <span className="truncate">{pkg.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 3: TRADE-IN EVALUATION & PHOTO UPLOAD                                */}
          {/* ========================================================================= */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                    Step 3: Trade-In Vehicle & Photo Appraisal
                  </h3>
                  <p className="text-xs text-ink-muted mt-0.5">
                    Dealers submit firm, binding trade-in allowances when photos are attached.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted font-medium">Have a trade-in?</span>
                  <button
                    type="button"
                    onClick={() => setHasTradeIn(!hasTradeIn)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      hasTradeIn ? "bg-emerald-500" : "bg-border"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        hasTradeIn ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {hasTradeIn ? (
                <div className="space-y-4">
                  {/* Live NHTSA VIN Lookup Tool */}
                  <div className="rounded-xl border border-emerald-500/30 bg-surface-elevated p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                        <Sparkles className="h-4 w-4" />
                        <span>Live VIN Decoder (NHTSA Database)</span>
                      </div>
                      <span className="text-[10px] text-ink-muted">Auto-populates verified factory specs</span>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={17}
                        placeholder="Paste 17-digit VIN (e.g. WAUZZAF42NA091482)..."
                        value={tradeInVin}
                        onChange={(e) => setTradeInVin(e.target.value.toUpperCase())}
                        className="flex-1 rounded-lg border border-border bg-background py-1.5 px-3 text-xs font-mono uppercase text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={isDecodingVin || tradeInVin.length !== 17}
                        onClick={() => handleDecodeVin(tradeInVin)}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-emerald-400 disabled:opacity-50 transition-all shrink-0"
                      >
                        {isDecodingVin ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Search className="h-3.5 w-3.5" />
                        )}
                        <span>Decode VIN</span>
                      </button>
                    </div>

                    {/* Quick Test VIN Pills */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="text-ink-faint">Try sample VINs:</span>
                      {SAMPLE_TEST_VINS.map((t) => (
                        <button
                          key={t.vin}
                          type="button"
                          onClick={() => {
                            setTradeInVin(t.vin);
                            handleDecodeVin(t.vin);
                          }}
                          className="rounded bg-surface px-2 py-0.5 text-ink-muted hover:text-white hover:bg-border transition-colors font-mono border border-border"
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>

                    {/* Decoded Spec Badge */}
                    {decodedVinResult && (
                      <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2.5 text-xs space-y-1 animate-fadeIn">
                        <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>NHTSA Verified: {decodedVinResult.year} {decodedVinResult.make} {decodedVinResult.model} {decodedVinResult.trim || ""}</span>
                        </div>
                        <div className="text-[10px] text-ink-muted flex flex-wrap gap-2">
                          {decodedVinResult.displacementL && <span>Engine: {decodedVinResult.displacementL}</span>}
                          {decodedVinResult.driveType && <span>• Drivetrain: {decodedVinResult.driveType}</span>}
                          {decodedVinResult.bodyClass && <span>• Body: {decodedVinResult.bodyClass}</span>}
                          {decodedVinResult.plantCountry && <span>• Plant: {decodedVinResult.plantCountry}</span>}
                        </div>
                      </div>
                    )}

                    {vinLookupError && (
                      <p className="text-[11px] text-rose-400">{vinLookupError}</p>
                    )}
                  </div>

                  {/* Vehicle Spec Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-ink-light uppercase">Year & Make:</label>
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          type="number"
                          value={tradeInYear}
                          onChange={(e) => setTradeInYear(Number(e.target.value))}
                          className="rounded-lg border border-border bg-background py-1.5 px-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        />
                        <input
                          type="text"
                          value={tradeInMake}
                          onChange={(e) => setTradeInMake(e.target.value)}
                          className="rounded-lg border border-border bg-background py-1.5 px-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-ink-light uppercase">Model & Trim:</label>
                      <input
                        type="text"
                        value={`${tradeInModel} ${tradeInTrim}`}
                        onChange={(e) => {
                          const parts = e.target.value.split(" ");
                          setTradeInModel(parts[0] || "");
                          setTradeInTrim(parts.slice(1).join(" ") || "");
                        }}
                        className="w-full rounded-lg border border-border bg-background py-1.5 px-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1 col-span-2 sm:col-span-1">
                      <label className="text-[11px] font-bold text-ink-light uppercase">Mileage:</label>
                      <input
                        type="number"
                        value={tradeInMileage}
                        onChange={(e) => setTradeInMileage(Number(e.target.value))}
                        className="w-full rounded-lg border border-border bg-background py-1.5 px-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none font-mono"
                      />
                    </div>
                  </div>

                  {/* Condition & KBB Valuation Estimate Badge */}
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase font-bold text-emerald-400 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> Estimated Trade-In Range
                      </div>
                      <div className="text-xl font-black text-white font-mono">
                        $24,500 – $26,800
                      </div>
                      <p className="text-[10px] text-ink-muted">
                        Dealer bids will compete with confirmed cash values reducing your taxable price.
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-ink-muted">Condition:</span>
                      <select
                        value={tradeInCondition}
                        onChange={(e: any) => setTradeInCondition(e.target.value)}
                        className="rounded-lg border border-border bg-surface py-1.5 px-2 text-xs font-bold text-white focus:border-emerald-500 focus:outline-none"
                      >
                        <option value="excellent">Excellent (Showroom)</option>
                        <option value="very_good">Very Good (Clean)</option>
                        <option value="good">Good (Normal Wear)</option>
                        <option value="fair">Fair (Needs Work)</option>
                      </select>
                    </div>
                  </div>

                  {/* Photo Submission Section */}
                  <div className="space-y-2.5 pt-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-ink-light uppercase tracking-wider flex items-center gap-1.5">
                        <Camera className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Submit Trade-In Photos ({tradeInPhotos.length} Attached):</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setTradeInPhotos(SAMPLE_TRADE_IN_VEHICLE.photos)}
                        className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                      >
                        <Sparkles className="h-3 w-3" /> Reset Sample Photos
                      </button>
                    </div>

                    {/* Photo Grid Preview */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {tradeInPhotos.map((photo) => (
                        <div
                          key={photo.id}
                          className="group relative rounded-xl border border-border bg-surface-elevated overflow-hidden shadow-sm"
                        >
                          <img
                            src={photo.imageUrl}
                            alt={photo.label}
                            className="h-24 w-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-between p-1.5">
                            <button
                              type="button"
                              onClick={() => handleRemovePhoto(photo.id)}
                              className="self-end rounded-md bg-black/60 p-1 text-red-400 hover:bg-red-500 hover:text-white transition-colors"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                            <span className="text-[9px] font-bold text-white truncate drop-shadow">
                              {photo.label}
                            </span>
                          </div>
                        </div>
                      ))}

                      {/* Add Photo Slot Button */}
                      <button
                        type="button"
                        onClick={() =>
                          handleAddSamplePhoto(
                            "damage_cosmetic",
                            "Additional Angle",
                            "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=800&q=80"
                          )
                        }
                        className="flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border hover:border-emerald-500 bg-background/50 h-24 p-2 text-ink-muted hover:text-white transition-all cursor-pointer"
                      >
                        <UploadCloud className="h-5 w-5 text-emerald-400" />
                        <span className="text-[10px] font-bold text-center">Add Photo</span>
                      </button>
                    </div>

                    {/* Photo Angle Helper Checklist */}
                    <div className="rounded-lg bg-surface p-2.5 text-[11px] text-ink-muted flex flex-wrap items-center justify-between gap-2 border border-border/50">
                      <span className="font-semibold text-white">Recommended angles:</span>
                      <span className="flex items-center gap-1 text-emerald-400">✓ Front 3/4</span>
                      <span className="flex items-center gap-1 text-emerald-400">✓ Rear 3/4</span>
                      <span className="flex items-center gap-1 text-emerald-400">✓ Dashboard / Odometer</span>
                      <span className="flex items-center gap-1 text-emerald-400">✓ Tires</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-surface-elevated p-8 text-center space-y-2">
                  <Car className="h-8 w-8 text-ink-muted mx-auto" />
                  <div className="text-sm font-bold text-white">No Trade-In Vehicle Selected</div>
                  <p className="text-xs text-ink-muted max-w-sm mx-auto">
                    You can proceed without a trade-in, or toggle the switch above to add your car and photos for instant dealer equity offers.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 4: DEAL STRUCTURE & FINANCIAL TERMS                                  */}
          {/* ========================================================================= */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                  Step 4: How Would You Like Dealers to Structure Your Deal?
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  Request binding bids for all 3 structures (Cash, Finance & Lease) or choose a single payment model.
                </p>
              </div>

              {/* Deal Structure Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Option 1: ALL 3 (Full Width Featured Card) */}
                <div
                  onClick={() => setPaymentMethod("all_three")}
                  className={`sm:col-span-2 cursor-pointer rounded-xl border p-4 transition-all ${
                    paymentMethod === "all_three"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-md ring-1 ring-emerald-500"
                      : "border-border bg-surface-elevated hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-black font-extrabold shrink-0 shadow-md">
                        <Layers className="h-5 w-5 stroke-[2.5]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-extrabold text-white text-sm">Quote All 3 Structures (Cash, Finance & Lease)</h4>
                          <span className="rounded bg-emerald-500 text-black px-1.5 py-0.2 text-[9px] font-black uppercase">
                            RECOMMENDED
                          </span>
                        </div>
                        <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                          Dealers will submit side-by-side bids showing full <strong>Cash Out-The-Door price</strong>, <strong>60-mo Finance payments</strong>, and <strong>36-mo Lease terms</strong> so you can compare the best mathematical option.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Option 2: Cash Only */}
                <div
                  onClick={() => setPaymentMethod("cash")}
                  className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
                    paymentMethod === "cash"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-md ring-1 ring-emerald-500"
                      : "border-border bg-surface-elevated hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 font-bold shrink-0">
                      <Coins className="h-4 w-4 stroke-[2.5]" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-xs">Cash Out-The-Door Only</h4>
                      <p className="text-[11px] text-ink-muted mt-0.5">
                        Single lump-sum payment with $0 surprise dealer fee markups.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Option 3: Finance Only */}
                <div
                  onClick={() => setPaymentMethod("finance")}
                  className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
                    paymentMethod === "finance"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-md ring-1 ring-emerald-500"
                      : "border-border bg-surface-elevated hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 font-bold shrink-0">
                      <CreditCard className="h-4 w-4 stroke-[2.5]" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-xs">Finance Deal (Loan)</h4>
                      <p className="text-[11px] text-ink-muted mt-0.5">
                        Dealers compete on vehicle selling price & monthly loan rate.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Option 4: Lease Only */}
                <div
                  onClick={() => setPaymentMethod("lease")}
                  className={`sm:col-span-2 cursor-pointer rounded-xl border p-3.5 transition-all ${
                    paymentMethod === "lease"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-md ring-1 ring-emerald-500"
                      : "border-border bg-surface-elevated hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/20 text-purple-400 font-bold shrink-0">
                      <KeyRound className="h-4 w-4 stroke-[2.5]" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-xs">Lease Deal Structure</h4>
                      <p className="text-[11px] text-ink-muted mt-0.5">
                        Dealers compete on capitalized cost reduction, money factor & monthly lease price.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Deal Structure Parameters Box */}
              {(paymentMethod === "all_three" || paymentMethod === "finance" || paymentMethod === "lease") && (
                <div className="rounded-xl border border-border bg-surface-elevated p-3.5 space-y-3">
                  <div className="text-[11px] font-bold text-ink-light uppercase tracking-wider flex items-center justify-between border-b border-border/50 pb-2">
                    <span>Customize Finance & Lease Guidelines:</span>
                    <span className="text-emerald-400 font-mono text-[10px]">Dealers will calculate exact terms</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Down Payment */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-ink-muted">Cash Down Payment:</label>
                      <div className="relative">
                        <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
                        <input
                          type="number"
                          value={downPayment}
                          onChange={(e) => setDownPayment(Number(e.target.value))}
                          className="w-full rounded-lg border border-border bg-background py-1.5 pl-7 pr-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Finance Term */}
                    {(paymentMethod === "all_three" || paymentMethod === "finance") && (
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-ink-muted">Finance Loan Term:</label>
                        <select
                          value={financeTerm}
                          onChange={(e) => setFinanceTerm(Number(e.target.value))}
                          className="w-full rounded-lg border border-border bg-background py-1.5 px-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        >
                          <option value={36}>36 Months</option>
                          <option value={48}>48 Months</option>
                          <option value={60}>60 Months (Standard)</option>
                          <option value={72}>72 Months</option>
                        </select>
                      </div>
                    )}

                    {/* Lease Mileage */}
                    {(paymentMethod === "all_three" || paymentMethod === "lease") && (
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-ink-muted">Annual Lease Mileage:</label>
                        <select
                          value={leaseMileage}
                          onChange={(e) => setLeaseMileage(Number(e.target.value))}
                          className="w-full rounded-lg border border-border bg-background py-1.5 px-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        >
                          <option value={10000}>10,000 mi / year</option>
                          <option value={12000}>12,000 mi / year (Standard)</option>
                          <option value={15000}>15,000 mi / year</option>
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Target Price or Discount */}
              {strategy === "firm_offer" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-ink-light">
                    Your Firm Target Out-The-Door (OTD) Offer:
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                    <input
                      type="number"
                      value={targetOtdPrice}
                      onChange={(e) => setTargetOtdPrice(Number(e.target.value))}
                      className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-4 text-sm text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <p className="text-[11px] text-ink-faint">
                    Includes all vehicle costs, {estimatedTaxPercent}% sales tax, registration, and doc fees.
                  </p>
                </div>
              )}

              {strategy === "flexible_discount" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-ink-light">
                    Target Discount from MSRP:
                  </label>
                  <div className="relative">
                    <Percent className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                    <input
                      type="number"
                      step="0.5"
                      value={targetDiscountPercent}
                      onChange={(e) => setTargetDiscountPercent(Number(e.target.value))}
                      className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-4 text-sm text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <p className="text-[11px] text-ink-faint">
                    Dealers will compete to beat this discount percentage across all matching inventory.
                  </p>
                </div>
              )}

              {/* Zip & Radius */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-light">Buyer Zip Code:</label>
                  <input
                    type="text"
                    value={buyerZip}
                    onChange={(e) => setBuyerZip(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background py-2 px-3 text-sm text-white focus:border-emerald-500 focus:outline-none font-mono"
                  />
                  <span className="text-[10px] text-emerald-400 font-medium">
                    Est. Tax Rate: {estimatedTaxPercent}%
                  </span>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-light">Dealer Radius:</label>
                  <select
                    value={searchRadius}
                    onChange={(e) => setSearchRadius(Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-background py-2 px-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  >
                    <option value={50}>50 Miles (Local)</option>
                    <option value={150}>150 Miles (Regional)</option>
                    <option value={500}>500 Miles (Statewide)</option>
                    <option value={2000}>Nationwide</option>
                  </select>
                  <span className="text-[10px] text-ink-faint">14 dealers eligible</span>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 5: REVIEW & BROADCAST                                                */}
          {/* ========================================================================= */}
          {step === 5 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                  Step 5: Review & Privacy Shield
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  Your personal identity is 100% masked to prevent annoying dealer sales calls.
                </p>
              </div>

              {/* Summary Box */}
              <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2 text-xs">
                <div className="flex justify-between border-b border-border/50 pb-2">
                  <span className="text-ink-muted">Target Vehicle:</span>
                  <span className="text-white font-bold">
                    {selectedVehicle ? `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model} ${selectedVehicle.trim}` : `${make} ${model}`}
                  </span>
                </div>

                <div className="flex justify-between border-b border-border/50 pb-2">
                  <span className="text-ink-muted">Bidding Strategy:</span>
                  <span className="text-emerald-400 font-bold">
                    {strategy === "flexible_discount"
                      ? "Find your car based on Make and Model"
                      : strategy === "exact_auction"
                      ? "Find your car based on must have specs"
                      : "Firm Target Offer"}
                  </span>
                </div>

                {hasTradeIn && (
                  <div className="flex justify-between border-b border-border/50 pb-2">
                    <span className="text-ink-muted">Trade-In Vehicle:</span>
                    <span className="text-emerald-400 font-medium flex items-center gap-1">
                      <Camera className="h-3 w-3" />
                      {tradeInYear} {tradeInMake} {tradeInModel} ({tradeInPhotos.length} Photos Attached)
                    </span>
                  </div>
                )}

                <div className="flex justify-between border-b border-border/50 pb-2">
                  <span className="text-ink-muted">Must-Have Packages:</span>
                  <span className="text-emerald-400 font-medium text-right">
                    {mustHavePackages.slice(0, 3).join(", ")}{mustHavePackages.length > 3 ? ` +${mustHavePackages.length - 3} more` : ""}
                  </span>
                </div>

                <div className="flex justify-between border-b border-border/50 pb-2">
                  <span className="text-ink-muted">Deal Structure:</span>
                  <span className="text-white font-semibold text-right">
                    {paymentMethod === "all_three"
                      ? "All 3 Structures (Cash, 60-mo Finance, 36-mo Lease)"
                      : paymentMethod === "cash"
                      ? "Cash Out-The-Door Only"
                      : paymentMethod === "finance"
                      ? `${financeTerm}-Month Finance (${formatCurrency(downPayment)} Down)`
                      : `36-Month Lease (${leaseMileage.toLocaleString()} mi/yr)`}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-ink-muted">Assigned Buyer Alias:</span>
                  <span className="text-emerald-400 font-mono font-bold">Buyer #CA-4921</span>
                </div>
              </div>

              {/* Protection Pledge Box */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 flex items-start gap-2.5 text-xs text-ink-light">
                <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-emerald-400">The TrimScout Price Protection Pledge</div>
                  <p className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">
                    Dealers are legally bound to honor their itemized bids with $0 surprise dealer add-ons or hidden markups upon vehicle delivery.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="flex items-center justify-between border-t border-border bg-surface-elevated px-6 py-4">
          {step > 1 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink-light hover:bg-border transition-colors"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
          ) : (
            <div />
          )}

          {step < 5 ? (
            <button
              onClick={() => setStep(step + 1)}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-5 py-2 text-xs font-bold text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={handleLaunchDeal}
              className="flex items-center gap-2 rounded-lg bg-emerald-500 px-6 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
            >
              <Zap className="h-4 w-4 fill-black" /> Broadcast Deal Request
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
