"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Vehicle, BiddingStrategy, BiddingRequest, UserProfile, type DealStructureMethod } from "../lib/types";
import {
  DEAL_STRUCTURE_LABELS,
  DEAL_STRUCTURE_METHODS,
  formatDealStructures,
  paymentMethodFromStructures,
  toggleDealStructure,
} from "../lib/dealStructure";
import { formatCurrency, getZipCoordinates } from "../lib/otdCalculator";
import { findContactInfo } from "../lib/piiFilter";
import {
  FORD_BUILD_SHEET_LINK,
  FORD_MUST_HAVE_HEADING,
  FORD_MUST_HAVE_HELP,
  advertisedOrStickerPrice,
  formatFactoryOptionLine,
  formatPriceAmount,
  reviewTargetFromVehicle,
  shopperPriceSourceLabel,
} from "../lib/fordCompetitionUi";
import { brandCodeFromMake } from "../lib/oemWmi";
import {
  importPastedFactoryVehicle,
  type FactoryBuildOem,
  type FactoryFilterableOption,
} from "../lib/pasteImport";
import { shopperDealStructurePayload, mapDealRequestJson } from "../lib/shopperDeal";
import { defaultTermsForVehicles } from "../lib/dealTerms";
import {
  buildOfferCompareSnapshot,
  collectDealVehicles,
  saveOfferCompareSnapshot,
  upsertShopperRequest,
} from "../lib/offerCompare";
import {
  X,
  ShieldCheck,
  Zap,
  ArrowRight,
  ArrowLeft,
  CircleCheck as CheckCircle2,
  MapPin,
  Globe,
  LoaderCircle as Loader2,
  Handshake,
  FileText
} from "lucide-react";

type FilterableFactoryOption = FactoryFilterableOption;

function formatStickerMsrp(amount: number | null | undefined): string {
  return formatPriceAmount(amount);
}

function FactoryMustHavePicker({
  options,
  checked,
  onToggle,
}: {
  options: FilterableFactoryOption[];
  checked: string[];
  onToggle: (name: string) => void;
}) {
  return (
    <div className="max-h-56 overflow-y-auto">
      {options.map((opt) => {
        const isChecked = checked.includes(opt.name);
        const line = formatFactoryOptionLine({
          code: opt.code ?? null,
          description: opt.description || opt.name,
        });
        return (
          <label key={opt.name} className="flex items-start gap-2 py-0.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => onToggle(opt.name)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border text-emerald-500 focus:ring-0"
            />
            <span className={`leading-snug ${isChecked ? "text-white" : "text-ink-light"}`}>
              {line}
              {opt.price != null && opt.price > 0 ? (
                <span className="text-ink-faint"> · {formatCurrency(opt.price)}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

interface BiddingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  vehicles: Vehicle[];
  preselectedVehicle?: Vehicle | null;
  initialStrategy?: BiddingStrategy;
  onSubmitBidRequest: (request: BiddingRequest) => void;
  // Real reverse-auction flow: the buyer already picked a specific real
  // vehicle from live inventory, so Step 1's fake paste-link/catalog-search
  // UI is skipped entirely, and submission goes through a real backend
  // instead of building a client-side-only BiddingRequest.
  lockVehicleSelection?: boolean;
  referenceBrandCode?: string;
  currentUser?: UserProfile | null;
  onRequireLogin?: () => void;
  onRealBidRequestCreated?: (request: BiddingRequest) => void;
}

export const BiddingWizard: React.FC<BiddingWizardProps> = ({
  isOpen,
  onClose,
  preselectedVehicle,
  initialStrategy = "flexible_discount",
  onSubmitBidRequest,
  lockVehicleSelection,
  referenceBrandCode,
  currentUser,
  onRequireLogin,
  onRealBidRequestCreated,
}) => {
  const router = useRouter();
  const [step, setStep] = useState<number>(1);
  const [, setStrategy] = useState<BiddingStrategy>(initialStrategy);

  const [dealerUrlInput, setDealerUrlInput] = useState<string>("");
  const [isParsingLink, setIsParsingLink] = useState<boolean>(false);
  const [parseSuccessMsg, setParseSuccessMsg] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [factoryBuildOem, setFactoryBuildOem] = useState<FactoryBuildOem | null>(null);
  const [fordStickerStatus, setFordStickerStatus] = useState<"released" | "unreleased" | "error" | null>(null);
  const [fordPdfUrl, setFordPdfUrl] = useState<string | null>(null);
  const [fordFilterableOptions, setFordFilterableOptions] = useState<FilterableFactoryOption[]>([]);
  const [niceToHavePackages, setNiceToHavePackages] = useState<string[]>([]);
  const [huntZip, setHuntZip] = useState("");
  const [huntRadius, setHuntRadius] = useState("");

  // Set when the buyer explicitly chooses to skip the multi-dealer auction
  // and send a single, anonymized offer straight to the favorite vehicle's
  // dealer instead (only offered when no secondary vehicles are attached).
  const [directOfferMode, setDirectOfferMode] = useState(false);
  const [offerPath, setOfferPath] = useState<"direct" | "auction" | null>(null);

  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(preselectedVehicle || null);

  // Custom/Flexible Spec Fields
  const [make, setMake] = useState<string>("BMW");
  const [model, setModel] = useState<string>("3 Series");
  const [selectedTrims, setSelectedTrims] = useState<string[]>(["330i M Sport", "330i xDrive"]);
  const [mustHavePackages, setMustHavePackages] = useState<string[]>(["M Sport Package", "Premium Package"]);

  // Trade-in is now just a yes/no flag collected here — the actual
  // appraisal (value, photos, condition) happens later, once a selling
  // price is agreed with the dealer (see the note shown when this is on).
  const [hasTradeIn, setHasTradeIn] = useState<boolean>(false);

  // Step 1: independently checked cash / finance / lease (at least one required)
  const [requestedStructures, setRequestedStructures] = useState<DealStructureMethod[]>(["cash"]);
  const paymentMethod = paymentMethodFromStructures(requestedStructures);
  const financeTerm = 60;
  const downPayment = 5000;
  const leaseMileage = 12000;
  const leaseTerm = 36;

  // Financial & Geographic fields
  const [targetOtdPrice, setTargetOtdPrice] = useState<number>(52000);
  const [buyerZip, setBuyerZip] = useState<string>("94107");
  const [searchRadius, setSearchRadius] = useState<number>(100);
  const sameStateOnly = true;
  const [isSubmittingReal, setIsSubmittingReal] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 5: optional free-text note to the dealer. Real-time-checked for
  // contact info (email/phone/link/handle) — the masked-identity system
  // only holds if a buyer can't just paste it in here; server-side
  // (app/api/deal-requests and the box) re-checks authoritatively.
  const [dealComment, setDealComment] = useState("");
  const dealCommentContactWarning = findContactInfo(dealComment);

  // Real deal_requests.id, shown as a confirmation once a real submission
  // (broadcast or direct offer) succeeds.
  const [createdDealId, setCreatedDealId] = useState<string | null>(null);
  const handleCloseConfirmation = () => {
    setCreatedDealId(null);
    onClose();
  };

  useEffect(() => {
    if (preselectedVehicle) {
      setSelectedVehicle(preselectedVehicle);
      setMake(preselectedVehicle.make);
      setModel(preselectedVehicle.model);
      setSelectedTrims([preselectedVehicle.trim]);
      setMustHavePackages(preselectedVehicle.packages);
      setTargetOtdPrice(Math.round(preselectedVehicle.msrp * 0.92));
    }
  }, [preselectedVehicle, lockVehicleSelection]);

  // 3 steps total: (1) payment + vehicle + trade-in flag, (2) direct offer
  // vs. multi-dealer, (3) review & broadcast. Payment and vehicle selection
  // used to be separate steps and are now merged into step 1.
  const TOTAL_STEPS = 3;
  // Step 1's Continue is blocked until Import Car actually loaded a
  // vehicle — unless a real vehicle was already locked in via
  // lockVehicleSelection, in which case there's nothing to import.
  // Typing a VIN/URL, or merely arriving on this step, is not enough.
  const vehicleImported = Boolean(lockVehicleSelection || (parseSuccessMsg && selectedVehicle));
  const reviewTarget = reviewTargetFromVehicle(selectedVehicle);
  const goNext = () => {
    if (step === 1 && (requestedStructures.length === 0 || !vehicleImported)) return;
    if (step === 2 && !offerPath) return;
    setStep(step + 1);
  };
  const goBack = () => {
    setStep(step - 1);
  };

  const huntReady = /^\d{5}$/.test(huntZip.trim()) && Number(huntRadius) > 0;
  const huntLocationMissing = !huntReady;

  const handleParseDealerUrl = async (urlToParse?: string) => {
    const raw = (urlToParse || dealerUrlInput).trim();
    if (!raw) return;

    setIsParsingLink(true);
    setParseSuccessMsg(null);
    setParseError(null);
    setSelectedVehicle(null);
    setFactoryBuildOem(null);
    setFordStickerStatus(null);
    setFordPdfUrl(null);
    setFordFilterableOptions([]);
    setNiceToHavePackages([]);
    setMustHavePackages([]);

    const result = await importPastedFactoryVehicle(raw);
    if (!result.ok) {
      if (result.unreleased) {
        setFactoryBuildOem(result.oem ?? null);
        setFordStickerStatus("unreleased");
        setFordPdfUrl(result.pdfUrl ?? null);
      }
      setParseError(result.error);
      setIsParsingLink(false);
      return;
    }

    setSelectedVehicle(result.vehicle);
    setMake(result.vehicle.make);
    setModel(result.vehicle.model);
    setSelectedTrims([result.vehicle.trim]);
    setMustHavePackages(result.mustHaveLines);
    setNiceToHavePackages(result.niceToHaveLines);
    setFordFilterableOptions(result.filterableOptions);
    setFactoryBuildOem(result.oem);
    setFordStickerStatus("released");
    setFordPdfUrl(result.pdfUrl);
    if (result.msrp && result.msrp > 0) {
      setTargetOtdPrice(Math.round(result.msrp * 0.92));
    }
    setParseSuccessMsg(
      `VIN ${result.vehicle.vin}${result.msrp ? ` · MSRP ${formatStickerMsrp(result.msrp)}` : ""}`
    );
    setIsParsingLink(false);
  };

  const chooseDirectOffer = () => {
    setOfferPath("direct");
    setDirectOfferMode(true);
    setStrategy("firm_offer");
  };

  const chooseMultiDealer = () => {
    setOfferPath("auction");
    setDirectOfferMode(false);
    setStrategy("exact_auction");
  };

  if (!isOpen) return null;

  if (createdDealId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
        <div className="relative w-full max-w-md rounded-2xl border border-emerald-500/40 bg-surface shadow-2xl p-6 space-y-4 text-center animate-fadeIn">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white">
              {directOfferMode ? "Your Direct Offer Has Been Sent" : "Your Deal Request Is Live"}
            </h2>
            <p className="text-xs text-ink-muted mt-1">
              {directOfferMode
                ? `${selectedVehicle?.location.dealerName ?? "The dealer"} will review your anonymized offer and respond.`
                : "Certified dealers in your area are now reviewing your request."}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface-elevated py-3">
            <div className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">Deal Number</div>
            <div className="text-2xl font-mono font-black text-emerald-400">#{createdDealId}</div>
          </div>
          <button
            onClick={handleCloseConfirmation}
            className="w-full rounded-xl bg-emerald-500 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all active:scale-95"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const toggleTrim = (trim: string) => {
    if (selectedTrims.includes(trim)) {
      if (selectedTrims.length > 1) {
        setSelectedTrims(selectedTrims.filter((t) => t !== trim));
      }
    } else {
      setSelectedTrims([...selectedTrims, trim]);
    }
  };

  const toggleFordMustHave = (name: string) => {
    setMustHavePackages((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]
    );
    setNiceToHavePackages((prev) => prev.filter((p) => p !== name));
  };

  const launchStrategy: BiddingStrategy =
    directOfferMode || offerPath === "direct" ? "firm_offer" : "exact_auction";

  const dealVehicles = collectDealVehicles(selectedVehicle, []);
  const otherLotsForDeal: Vehicle[] = [];

  const vehicleTermsForDeal = defaultTermsForVehicles(dealVehicles, {
      requestedStructures,
      financeTermMonths: financeTerm,
      downPayment,
      leaseMileagePerYear: leaseMileage,
      leaseTermMonths: leaseTerm,
    }
  );

  const buildBiddingRequest = (overrides: Partial<BiddingRequest> = {}): BiddingRequest => ({
    id: `req-${Date.now()}`,
    strategy: launchStrategy,
    targetVin: selectedVehicle?.vin,
    targetVehicle: selectedVehicle || undefined,
    otherLots: otherLotsForDeal,
    flexibleCriteria: {
      make: selectedVehicle?.make || "",
      model: selectedVehicle?.model || "",
      trims: selectedVehicle?.trim ? [selectedVehicle.trim] : [],
      minMsrp: selectedVehicle ? Math.round(selectedVehicle.msrp * 0.9) : undefined,
      maxMsrp: selectedVehicle ? Math.round(selectedVehicle.msrp * 1.1) : undefined,
      mustHavePackages,
      preferredColors: [],
      dealbreakers: [],
      allowedStatuses: ["on_lot", "in_transit"],
    },
    // Trade-in detail (value, photos, condition) is no longer collected in
    // this wizard — it's handled after a selling price is agreed with the
    // dealer, per the note shown when the trade-in toggle is on. Sending a
    // fabricated placeholder object here would show up as real data to a
    // dealer downstream, so this stays unset regardless of hasTradeIn.
    tradeIn: undefined,
    buyerComment: dealComment.trim() || undefined,
    targetOtdPrice: launchStrategy === "firm_offer" ? targetOtdPrice : undefined,
    paymentMethod,
    dealStructurePreferences: {
      requestedStructures,
      financeTermMonths: financeTerm,
      downPayment,
      leaseMileagePerYear: leaseMileage,
      leaseTermMonths: leaseTerm,
      vehicleTerms: vehicleTermsForDeal,
    },
    buyerZip,
    searchRadiusMiles: searchRadius,
    sameStateOnly,
    createdAt: "Just now",
    expiresAt: "48 Hours",
    status: "active",
    directOffer: directOfferMode,
    ...overrides,
  });

  const openComparePage = (request: BiddingRequest) => {
    const snapshot = buildOfferCompareSnapshot({
      request,
      favorite: selectedVehicle,
      otherLots: [],
      buyerZip,
      requestedStructures,
      mustHaveLines: mustHavePackages,
      niceToHaveLines: niceToHavePackages,
      searchRadiusMiles: searchRadius,
    });
    if (snapshot) {
      saveOfferCompareSnapshot(snapshot);
      upsertShopperRequest(snapshot.request);
    } else {
      upsertShopperRequest(request);
    }
    onClose();
    router.push("/compare");
  };

  const handleLaunchDeal = async () => {
    if (dealCommentContactWarning) {
      setSubmitError(`Your comment appears to contain ${dealCommentContactWarning} — remove it before submitting.`);
      return;
    }
    if (!currentUser) {
      onClose();
      onRequireLogin?.();
      return;
    }
    if (!selectedVehicle) return;

    setIsSubmittingReal(true);
    setSubmitError(null);
    let launched: BiddingRequest | null = null;
    try {
      const res = await fetch("/api/deal-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy: launchStrategy,
          referenceBrandCode: referenceBrandCode || brandCodeFromMake(selectedVehicle.make),
          referenceVin: selectedVehicle.vin,
          referenceYear: selectedVehicle.year,
          referenceMake: selectedVehicle.make,
          referenceModel: selectedVehicle.model,
          referenceTrim: selectedVehicle.trim,
          referencePrice: selectedVehicle.dealerPrice,
          referenceMsrp: selectedVehicle.msrp,
          referenceImageUrl: selectedVehicle.imageUrl,
          targetOtdPrice: launchStrategy === "firm_offer" ? targetOtdPrice : undefined,
          paymentMethod,
          dealStructure: shopperDealStructurePayload({
            requestedStructures,
            financeTermMonths: financeTerm,
            downPayment,
            leaseMileagePerYear: leaseMileage,
            leaseTermMonths: leaseTerm,
            directOffer: directOfferMode,
            vehicle: selectedVehicle,
            mustHavePackages,
            otherLots: otherLotsForDeal,
            vehicleTerms: vehicleTermsForDeal,
          }),
          // See the comment on buildBiddingRequest's tradeIn field — no
          // longer collected here.
          tradeIn: undefined,
          buyerZip,
          searchRadiusMiles: searchRadius,
          sameStateOnly,
          buyerComment: dealComment.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.dealRequest) {
        const dr = json.dealRequest as Record<string, unknown>;
        const local = buildBiddingRequest({
          id: String(dr.id),
          strategy: (dr.strategy as BiddingRequest["strategy"]) || launchStrategy,
          targetVin: typeof dr.referenceVin === "string" ? dr.referenceVin : selectedVehicle.vin,
          paymentMethod: (dr.paymentMethod as BiddingRequest["paymentMethod"]) || paymentMethod,
          buyerZip: typeof dr.buyerZip === "string" ? dr.buyerZip : buyerZip,
          buyerState: typeof dr.buyerState === "string" ? dr.buyerState : undefined,
          searchRadiusMiles:
            typeof dr.searchRadiusMiles === "number" ? dr.searchRadiusMiles : searchRadius,
          sameStateOnly: dr.sameStateOnly !== false,
          buyerComment: typeof dr.buyerComment === "string" ? dr.buyerComment : undefined,
          createdAt: typeof dr.createdAt === "string" ? dr.createdAt : "Just now",
          expiresAt: typeof dr.expiresAt === "string" ? dr.expiresAt : "48 Hours",
          status: dr.status === "locked" || dr.status === "expired" ? dr.status : "active",
          directOffer: directOfferMode,
        });
        launched = mapDealRequestJson(dr, local);
        onRealBidRequestCreated?.(launched);
      } else if (res.status !== 401 && res.status !== 502 && res.status !== 503) {
        setSubmitError(json.error || "Could not submit your request.");
        return;
      }
    } catch {
      // Deals backend unreachable — still open the compare page with the local snapshot.
    } finally {
      setIsSubmittingReal(false);
    }
    if (!launched) {
      launched = buildBiddingRequest();
      onSubmitBidRequest(launched);
    }
    openComparePage(launched);
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
              <p className="text-xs text-ink-muted">Step {step} of {TOTAL_STEPS} • Dealer Reverse Auction</p>
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
          {/* STEP 1: PAYMENT, VEHICLE & TRADE-IN FLAG                                   */}
          {/* ========================================================================= */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                  Step 1: How Are You Paying &amp; What Do You Want?
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  Payment shapes every offer dealers send you. Then pick the car — paste a dealer listing
                  URL or a 17-character VIN.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                <span className="text-xs font-semibold text-ink-light">Payment methods</span>
                {DEAL_STRUCTURE_METHODS.map((id) => {
                  const isChecked = requestedStructures.includes(id);
                  return (
                    <label key={id} className="flex items-center gap-2 py-0.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => setRequestedStructures((current) => toggleDealStructure(current, id))}
                        className="h-3.5 w-3.5 shrink-0 rounded border-border text-emerald-500 focus:ring-0"
                      />
                      <span className={isChecked ? "text-white" : "text-ink-light"}>
                        {DEAL_STRUCTURE_LABELS[id]}
                      </span>
                    </label>
                  );
                })}
              </div>
              {requestedStructures.length === 0 && (
                <p className="text-[11px] text-rose-400">Select at least one payment method to continue.</p>
              )}

              <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span
                          className={`text-[10px] font-bold uppercase ${
                            huntLocationMissing ? "text-amber-300" : "text-ink-faint"
                          }`}
                        >
                          Your ZIP (required)
                        </span>
                        <div className="relative">
                          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-emerald-400" />
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={5}
                            value={huntZip}
                            onChange={(e) => {
                              const next = e.target.value.replace(/\D/g, "").slice(0, 5);
                              setHuntZip(next);
                              if (next.length === 5) setBuyerZip(next);
                            }}
                            placeholder="e.g. 07405"
                            aria-required="true"
                            aria-invalid={huntLocationMissing}
                            autoComplete="off"
                            className={`w-full rounded-xl border bg-background py-2 pl-9 pr-3 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono ${
                              huntLocationMissing
                                ? "border-amber-500 ring-1 ring-amber-500/40"
                                : "border-border"
                            }`}
                          />
                        </div>
                      </label>
                      <label className="space-y-1">
                        <span
                          className={`text-[10px] font-bold uppercase ${
                            huntLocationMissing ? "text-amber-300" : "text-ink-faint"
                          }`}
                        >
                          Radius miles (required)
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={huntRadius}
                          onChange={(e) => {
                            const next = e.target.value.replace(/\D/g, "").slice(0, 4);
                            setHuntRadius(next);
                            const n = Number(next);
                            if (Number.isFinite(n) && n > 0) setSearchRadius(n);
                          }}
                          placeholder="e.g. 100"
                          aria-required="true"
                          aria-invalid={huntLocationMissing}
                          aria-label="Search radius in miles"
                          autoComplete="off"
                          className={`w-full rounded-xl border bg-background py-2 px-3 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono ${
                            huntLocationMissing
                              ? "border-amber-500 ring-1 ring-amber-500/40"
                              : "border-border"
                          }`}
                        />
                      </label>
                    </div>
                    <p className="text-[10px] text-ink-faint">
                      ZIP and radius are saved with this deal. They do not search listings.
                    </p>

                    <label className="text-[11px] font-bold text-ink-light uppercase flex items-center justify-between pt-2">
                      <span>Paste a dealer VDP URL or 17-character VIN:</span>
                    </label>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-400" />
                        <input
                          type="text"
                          value={dealerUrlInput}
                          onChange={(e) => setDealerUrlInput(e.target.value)}
                          placeholder="17-character VIN or dealer listing URL"
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
                            <span>Importing…</span>
                          </>
                        ) : (
                          <>
                            <Zap className="h-4 w-4 fill-black" />
                            <span>Import Car →</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                    {parseError && (
                      <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
                        {parseError}
                      </div>
                    )}
                    {!vehicleImported && !isParsingLink && (
                      <p className="text-[11px] text-rose-400">Import a car to continue.</p>
                    )}

                  {/* Decoded Vehicle Preview Box */}
                  {parseSuccessMsg && selectedVehicle && (
                    <div className="rounded-2xl border-2 border-emerald-500/60 bg-gradient-to-r from-emerald-950/40 via-surface to-surface p-4 space-y-3 shadow-lg animate-fadeIn">
                      <div className="flex items-center justify-between gap-2 text-xs font-bold text-emerald-400">
                        <span className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          <span>{parseSuccessMsg}</span>
                        </span>
                        {fordPdfUrl && (
                          <a
                            href={fordPdfUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-[10px] font-bold text-emerald-300 hover:text-white"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            {FORD_BUILD_SHEET_LINK}
                          </a>
                        )}
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
                            VIN: <span className="font-mono text-ink-light">{selectedVehicle.vin}</span>
                            {selectedVehicle.engine ? ` • ${selectedVehicle.engine}` : ""}
                            {selectedVehicle.exteriorColor ? ` • ${selectedVehicle.exteriorColor}` : ""}
                          </p>
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {(fordFilterableOptions.length > 0
                              ? fordFilterableOptions.filter((o) => !o.isPackageChild).map((o) => o.name)
                              : selectedVehicle.packages
                            ).slice(0, 8).map((p, i) => (
                              <span key={i} className="rounded bg-surface-elevated px-1.5 py-0.2 text-[10px] text-ink-light border border-border">
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="sm:text-right shrink-0">
                          {(() => {
                            const shown = advertisedOrStickerPrice(
                              selectedVehicle.dealerPrice,
                              selectedVehicle.msrp
                            );
                            const hasListing =
                              typeof selectedVehicle.dealerPrice === "number" &&
                              selectedVehicle.dealerPrice > 0;
                            return (
                              <>
                                {hasListing && selectedVehicle.msrp > 0 && (
                                  <div className="text-[11px] text-ink-muted">
                                    MSRP {formatStickerMsrp(selectedVehicle.msrp)}
                                  </div>
                                )}
                                <div className="text-base font-black text-white">
                                  {formatPriceAmount(shown.amount)}{" "}
                                  <span className="uppercase text-[9px] font-bold text-ink-faint">
                                    {shopperPriceSourceLabel(shown.source)}
                                  </span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              {selectedVehicle && fordStickerStatus === "released" && fordFilterableOptions.length > 0 && (
                <div className="space-y-1 pt-4 border-t border-border/50">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    {FORD_MUST_HAVE_HEADING}
                  </h4>
                  <p className="text-[11px] text-ink-muted">{FORD_MUST_HAVE_HELP}</p>
                  <FactoryMustHavePicker
                    options={fordFilterableOptions}
                    checked={mustHavePackages}
                    onToggle={toggleFordMustHave}
                  />
                  <p className="text-[10px] text-ink-faint">
                    Must-haves are saved with this deal. Dealer ads are not proof.
                  </p>
                </div>
              )}

              <div className="pt-4 border-t border-border/50">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-ink-light">Do you have a trade-in?</span>
                  <button
                    type="button"
                    onClick={() => setHasTradeIn(!hasTradeIn)}
                    aria-pressed={hasTradeIn}
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
                {hasTradeIn && (
                  <p className="text-[11px] text-ink-muted mt-2">
                    Your trade-in will be handled after the selling price has been reached.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 2: DIRECT OFFER OR MULTI-DEALER                                      */}
          {/* ========================================================================= */}
          {step === 2 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                Step 2
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={chooseDirectOffer}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    offerPath === "direct"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-md ring-1 ring-emerald-500"
                      : "border-border bg-surface-elevated hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Handshake className="h-5 w-5 text-emerald-400 shrink-0" />
                    <span className="font-bold text-white text-sm">Offer this dealer directly</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={chooseMultiDealer}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    offerPath === "auction"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-md ring-1 ring-emerald-500"
                      : "border-border bg-surface-elevated hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-emerald-400 shrink-0" />
                    <span className="font-bold text-white text-sm">Get prices from other dealers</span>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 3: REVIEW & BROADCAST                                                */}
          {/* ========================================================================= */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                  Step 3: Review & Privacy Shield
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  {directOfferMode
                    ? `Sending a direct, anonymized offer to ${selectedVehicle?.location.dealerName ?? "the dealer"} — your identity stays masked until they accept.`
                    : "Your personal identity is 100% masked to prevent annoying dealer sales calls."}
                </p>
              </div>

              {/* Summary Box */}
              <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2 text-xs">
                <div className="flex justify-between items-start gap-3 border-b border-border/50 pb-2">
                  <span className="text-ink-muted shrink-0">Target Vehicle:</span>
                  {reviewTarget ? (
                    <div className="text-right min-w-0 space-y-0.5">
                      {reviewTarget.title ? (
                        <div className="text-white font-bold">{reviewTarget.title}</div>
                      ) : (
                        <div className="text-ink-muted">Vehicle details unavailable</div>
                      )}
                      {reviewTarget.vin ? (
                        <div className="text-[11px] text-ink-muted">
                          VIN:{" "}
                          {reviewTarget.vdpHref ? (
                            <a
                              href={reviewTarget.vdpHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-emerald-400 hover:underline"
                            >
                              {reviewTarget.vin}
                            </a>
                          ) : (
                            <span className="font-mono text-ink-light">{reviewTarget.vin}</span>
                          )}
                        </div>
                      ) : null}
                      {reviewTarget.dealerName ? (
                        <div className="text-[11px] text-ink-light">{reviewTarget.dealerName}</div>
                      ) : null}
                      {reviewTarget.locationLine ? (
                        <div className="text-[11px] text-ink-muted">{reviewTarget.locationLine}</div>
                      ) : null}
                      {/* dealerName is only confirmed-current when it came from
                          a live listing lookup. Otherwise it fell back to the
                          window sticker's "SOLD TO" dealer — who the factory
                          originally shipped this VIN to, printed at build time
                          and never updated. If the vehicle was dealer-traded or
                          is advertised elsewhere now, that's not where it
                          currently sits, so say so instead of presenting it as
                          confirmed. */}
                      {factoryBuildOem && reviewTarget.dealerName && !reviewTarget.dealerConfirmed ? (
                        <div className="text-[10px] text-ink-faint italic">
                          Dealer the factory shipped it to — may not be where it&apos;s listed now
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-ink-muted">No imported vehicle</span>
                  )}
                </div>

                <div className="flex justify-between border-b border-border/50 pb-2">
                  <span className="text-ink-muted">Bidding Strategy:</span>
                  <span className="text-emerald-400 font-bold">
                    {directOfferMode ? "Offer this dealer directly" : "Get prices from other dealers"}
                  </span>
                </div>

                {hasTradeIn && (
                  <div className="flex justify-between border-b border-border/50 pb-2">
                    <span className="text-ink-muted">Trade-In:</span>
                    <span className="text-emerald-400 font-medium">
                      Yes — handled after the selling price is set
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
                    {formatDealStructures(requestedStructures)}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-ink-muted">Assigned Buyer Alias:</span>
                  <span className="text-emerald-400 font-mono font-bold">
                    {/^\d{5}$/.test(buyerZip) ? `Buyer #${getZipCoordinates(buyerZip).state}` : "Buyer"}
                  </span>
                </div>
              </div>

              {/* Buyer Comment — scrubbed of contact info before it ever leaves the browser */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink-light flex items-center justify-between">
                  <span>Add a Comment for the Dealer <span className="text-ink-faint font-normal">(optional)</span></span>
                  <span className={`text-[10px] font-mono ${dealComment.length > 900 ? "text-amber-400" : "text-ink-faint"}`}>
                    {dealComment.length}/1000
                  </span>
                </label>
                <textarea
                  value={dealComment}
                  onChange={(e) => setDealComment(e.target.value.slice(0, 1000))}
                  placeholder="e.g. Flexible on color, need delivery within 2 weeks, prior lease customer…"
                  rows={3}
                  className={`w-full rounded-xl border bg-background py-2.5 px-3.5 text-xs text-white placeholder-ink-faint focus:outline-none resize-none ${
                    dealCommentContactWarning
                      ? "border-rose-500 focus:border-rose-500"
                      : "border-border focus:border-emerald-500"
                  }`}
                />
                {dealCommentContactWarning ? (
                  <p className="text-[11px] text-rose-400 flex items-center gap-1.5">
                    <ShieldCheck className="h-3 w-3 shrink-0" />
                    Looks like your comment contains {dealCommentContactWarning} — remove it. Dealers only ever see your masked buyer ID here.
                  </p>
                ) : (
                  <p className="text-[11px] text-ink-faint">
                    Please don't include your name, email, phone number, or any links — dealers only see your masked buyer ID until you accept a deal. We automatically block emails, phone numbers, links, and handles.
                  </p>
                )}
              </div>

              {/* How This Works Box */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 flex items-start gap-2.5 text-xs text-ink-light">
                <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-emerald-400">How This Works</div>
                  <p className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">
                    We send the dealer your Out-The-Door price request first — vehicle, taxes, fees, everything. Once you and the dealer finalize that price together, we'll work through any trade-in value from there.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="flex flex-col gap-2 border-t border-border bg-surface-elevated px-6 py-4">
          {submitError && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">
              {submitError}
            </div>
          )}
          <div className="flex items-center justify-between">
            {step > 1 ? (
              <button
                onClick={goBack}
                disabled={isSubmittingReal}
                className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink-light hover:bg-border transition-colors disabled:opacity-50"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            ) : (
              <div />
            )}

            {step < TOTAL_STEPS ? (
              <button
                onClick={goNext}
                disabled={
                  (step === 1 && (requestedStructures.length === 0 || !vehicleImported)) ||
                  (step === 2 && !offerPath)
                }
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-5 py-2 text-xs font-bold text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleLaunchDeal}
                disabled={isSubmittingReal || !!dealCommentContactWarning}
                className="flex items-center gap-2 rounded-lg bg-emerald-500 px-6 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-60"
              >
                {isSubmittingReal ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4 fill-black" />
                )}
                {isSubmittingReal
                  ? directOfferMode
                    ? "Sending…"
                    : "Building…"
                  : directOfferMode
                  ? "Send Direct Offer"
                  : "Build Competitive Offers"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
