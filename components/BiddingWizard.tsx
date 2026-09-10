"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Vehicle, BiddingStrategy, BiddingRequest, UserProfile, type DealStructureMethod, type PurchaseTimeline, type TradeInVehicle } from "../lib/types";
import {
  DEAL_STRUCTURE_LABELS,
  formatDealStructures,
  paymentMethodFromStructures,
  toggleDealStructure,
} from "../lib/dealStructure";
import { formatCurrency, getZipCoordinates } from "../lib/otdCalculator";
import { findContactInfo } from "../lib/piiFilter";
import { formatDealerResponsivenessLabel, type DealerResponsivenessStats } from "../lib/dealerResponsiveness";
import { formatTypicalOtdLabel, type TypicalOtdStats } from "../lib/typicalOtd";
import { discountRealismWarning } from "../lib/discountRealism";
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
  ChevronDown,
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

/** One labeled group inside a wizard step — keeps every section's heading, hint, and spacing identical. */
function WizardSection({
  title,
  hint,
  className = "",
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`space-y-3 ${className}`}>
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">{title}</h4>
        {hint ? <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">{hint}</p> : null}
      </div>
      {children}
    </section>
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

/** One alternate-vehicle slot in Step 1 — resolved via the same real factory-build import as the primary VIN. */
function AlternateVinField({
  label,
  value,
  onChange,
  onImport,
  vehicle,
  error,
  parsing,
  onRemove,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onImport: () => void;
  vehicle: Vehicle | null;
  error: string | null;
  parsing: boolean;
  onRemove: () => void;
}) {
  if (vehicle) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase text-emerald-400">{label} — added</p>
          <p className="text-xs text-white font-semibold truncate">
            {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label.toLowerCase()}`}
          className="shrink-0 text-ink-muted hover:text-rose-400 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <span className="text-[10px] font-bold uppercase text-ink-faint">{label} (optional)</span>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="17-character VIN or dealer listing URL"
          className="w-full rounded-lg border border-border bg-background py-2 px-3 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono"
        />
        <button
          type="button"
          onClick={onImport}
          disabled={parsing || !value.trim()}
          className="rounded-lg border border-border px-3.5 py-2 text-[11px] font-bold text-ink-light hover:border-emerald-500 hover:text-white transition-all disabled:opacity-50 shrink-0"
        >
          {parsing ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
    </div>
  );
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
  // Alternate vehicles are optional, so Step 1 keeps them behind a link
  // until asked for — or auto-reveals them once one is actually imported.
  const [showAlternates, setShowAlternates] = useState(false);

  // Up to 2 alternate vehicles to ride along with the primary in the same
  // offer (see lib/offerCompare.ts's collectDealVehicles, which already
  // caps a deal at 3 vehicles total — this just finally feeds it real
  // ones instead of the hardcoded empty array the wizard used before).
  // Each resolves through the same real factory-build import as the
  // primary, so the compare page can show real specs/photos for them too.
  const [altVin1, setAltVin1] = useState("");
  const [altVehicle1, setAltVehicle1] = useState<Vehicle | null>(null);
  const [altParsing1, setAltParsing1] = useState(false);
  const [altError1, setAltError1] = useState<string | null>(null);
  const [altVin2, setAltVin2] = useState("");
  const [altVehicle2, setAltVehicle2] = useState<Vehicle | null>(null);
  const [altParsing2, setAltParsing2] = useState(false);
  const [altError2, setAltError2] = useState<string | null>(null);

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
  const [financingSource, setFinancingSource] = useState<"buyer_own" | "dealer" | null>(null);

  // The flag itself is real and worth sending — the Deal Tracker shows and
  // lets the buyer toggle it after the fact. Every detail field beyond the
  // flag stays honestly empty/zero rather than a fabricated value, since
  // that appraisal genuinely hasn't happened yet.
  const tradeInForRequest: TradeInVehicle | undefined = hasTradeIn
    ? { hasTradeIn: true, year: 0, make: "", model: "", trim: "", mileage: 0, condition: "good", estimatedValueMin: 0, estimatedValueMax: 0, photos: [] }
    : undefined;

  // Step 1: independently checked cash / finance / lease (at least one required)
  const [requestedStructures, setRequestedStructures] = useState<DealStructureMethod[]>(["cash"]);
  const paymentMethod = paymentMethodFromStructures(requestedStructures);
  const financeTerm = 60;
  const downPayment = 5000;
  const leaseMileage = 12000;
  const leaseTerm = 36;

  // Financial & Geographic fields
  const [targetOtdPrice, setTargetOtdPrice] = useState<number>(52000);
  // Who sets the price: the dealer quotes their own best OTD (blind bid, no
  // targetOtdPrice sent), or the buyer names a firm target the dealer can
  // accept or counter. Defaults follow chooseDirectOffer/chooseMultiDealer
  // below — direct offers used to always send targetOtdPrice silently, and
  // the auction path never did; this just makes that choice visible and
  // buyer-editable instead of flipping the previous defaults.
  const [pricingChoice, setPricingChoice] = useState<"dealer_names" | "buyer_names">("dealer_names");
  const [buyerZip, setBuyerZip] = useState<string>("94107");
  const [searchRadius, setSearchRadius] = useState<number>(100);
  // Checked by default — buyer can uncheck to widen the match to any state
  // within the radius, per Step 1's location controls.
  const [sameStateOnly, setSameStateOnly] = useState<boolean>(true);
  const [isSubmittingReal, setIsSubmittingReal] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 5: optional free-text note to the dealer. Real-time-checked for
  // contact info (email/phone/link/handle) — the masked-identity system
  // only holds if a buyer can't just paste it in here; server-side
  // (app/api/deal-requests and the box) re-checks authoritatively.
  const [dealComment, setDealComment] = useState("");
  const dealCommentContactWarning = findContactInfo(dealComment);

  // Step 3: how soon the buyer wants to close — round-trips through the
  // existing deal_structure_json blob, no new column needed.
  const [purchaseTimeline, setPurchaseTimeline] = useState<PurchaseTimeline | "">("");

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
      // Mirrors handleParseDealerUrl's success state — a preselected vehicle
      // (e.g. from the factory-match flow) already has a confirmed build, so
      // Step 1's "already imported" preview and must-have picker should show
      // immediately instead of leaving the paste-a-VIN box stuck open.
      setParseSuccessMsg(`${preselectedVehicle.year} ${preselectedVehicle.make} ${preselectedVehicle.trim} — confirmed`);
      setFordStickerStatus("released");
      setFordFilterableOptions(
        preselectedVehicle.options.map((o) => ({
          name: o.name,
          code: o.code,
          description: o.name,
          price: o.price,
        }))
      );
    }
  }, [preselectedVehicle, lockVehicleSelection]);

  // 3 steps total: (1) payment + vehicle + trade-in flag, (2) direct offer
  // vs. multi-dealer, (3) review & broadcast. Payment and vehicle selection
  // used to be separate steps and are now merged into step 1.
  const TOTAL_STEPS = 3;
  // Single source of the step's short label — shown once in the header
  // subtitle, not repeated as a "Step N:" prefix inside each step's own
  // heading below.
  const STEP_LABELS = ["Payment & Vehicle", "Dealers & Location", "Review & Send"];
  // Step 1's Continue is blocked until Import Car actually loaded a
  // vehicle — unless a real vehicle was already locked in via
  // lockVehicleSelection, in which case there's nothing to import.
  // Typing a VIN/URL, or merely arriving on this step, is not enough.
  const vehicleImported = Boolean(lockVehicleSelection || (parseSuccessMsg && selectedVehicle));
  const financingSourceMissing = requestedStructures.includes("finance") && financingSource == null;
  const reviewTarget = reviewTargetFromVehicle(selectedVehicle);

  // Real dealer responsiveness — computed from actual bid timing on the
  // box, never a fabricated "usually responds within..." default. Fetched
  // as soon as the dealer name is known (not gated to step 3) so it's
  // ready by the time the buyer reaches the review screen.
  const [dealerResponsiveness, setDealerResponsiveness] = useState<DealerResponsivenessStats | null>(null);
  useEffect(() => {
    const dealerName = reviewTarget?.dealerName;
    if (!dealerName) {
      setDealerResponsiveness(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/dealer-responsiveness?dealerName=${encodeURIComponent(dealerName)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) setDealerResponsiveness(json);
      })
      .catch(() => {
        // Purely a nice-to-have — a failed lookup just shows nothing.
      });
    return () => {
      cancelled = true;
    };
  }, [reviewTarget?.dealerName]);

  // Market context for the buyer's own target price — real, computed from
  // actual bid history, never a fabricated industry number. Shown as
  // information only, not a floor the buyer must beat.
  const [typicalOtd, setTypicalOtd] = useState<TypicalOtdStats | null>(null);
  useEffect(() => {
    const make = selectedVehicle?.make;
    const model = selectedVehicle?.model;
    if (!make || !model) {
      setTypicalOtd(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/typical-otd?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) setTypicalOtd(json);
      })
      .catch(() => {
        // Purely a nice-to-have — a failed lookup just shows nothing.
      });
    return () => {
      cancelled = true;
    };
  }, [selectedVehicle?.make, selectedVehicle?.model]);

  const goNext = () => {
    if (step === 1 && (requestedStructures.length === 0 || !vehicleImported || financingSourceMissing)) return;
    if (step === 2 && (!offerPath || step2LocationMissing)) return;
    setStep(step + 1);
  };
  const goBack = () => {
    setStep(step - 1);
  };

  const huntReady = /^\d{5}$/.test(huntZip.trim()) && Number(huntRadius) > 0;
  const huntLocationMissing = !huntReady;
  // Only paint location as a problem once the buyer has started filling it in —
  // an untouched form shouldn't open in an error state. The "(required)" labels
  // and the disabled Continue button already say what's needed.
  const huntLocationInvalid =
    huntLocationMissing && (huntZip.trim() !== "" || huntRadius.trim() !== "");
  // Location only decides anything on the multi-dealer path — /api/dealer-requests
  // skips the distance and same-state filters entirely for a direct (firm_offer)
  // request, so don't hold that path up for a ZIP it will never use.
  const step2LocationMissing = offerPath === "auction" && huntLocationMissing;

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

  // Resolves an alternate VIN/link through the same real import used for
  // the primary vehicle — never a lighter/fake lookup — but never touches
  // the primary's own state (must-haves, selected trim, etc.).
  const handleParseAlt1 = async () => {
    const raw = altVin1.trim();
    if (!raw) return;
    setAltParsing1(true);
    setAltError1(null);
    const result = await importPastedFactoryVehicle(raw);
    if (!result.ok) {
      setAltError1(result.error);
      setAltParsing1(false);
      return;
    }
    setAltVehicle1(result.vehicle);
    setAltParsing1(false);
  };
  const removeAlt1 = () => {
    setAltVehicle1(null);
    setAltVin1("");
    setAltError1(null);
  };

  const handleParseAlt2 = async () => {
    const raw = altVin2.trim();
    if (!raw) return;
    setAltParsing2(true);
    setAltError2(null);
    const result = await importPastedFactoryVehicle(raw);
    if (!result.ok) {
      setAltError2(result.error);
      setAltParsing2(false);
      return;
    }
    setAltVehicle2(result.vehicle);
    setAltParsing2(false);
  };
  const removeAlt2 = () => {
    setAltVehicle2(null);
    setAltVin2("");
    setAltError2(null);
  };

  const chooseDirectOffer = () => {
    setOfferPath("direct");
    setDirectOfferMode(true);
    setStrategy("firm_offer");
    setPricingChoice("buyer_names");
  };

  const chooseMultiDealer = () => {
    setOfferPath("auction");
    setDirectOfferMode(false);
    setStrategy("exact_auction");
    setPricingChoice("dealer_names");
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
  const otherLotsForDeal: Vehicle[] = [altVehicle1, altVehicle2].filter((v): v is Vehicle => v != null);

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
    tradeIn: tradeInForRequest,
    buyerComment: dealComment.trim() || undefined,
    targetOtdPrice: pricingChoice === "buyer_names" ? targetOtdPrice : undefined,
    paymentMethod,
    dealStructurePreferences: {
      requestedStructures,
      financeTermMonths: financeTerm,
      downPayment,
      ...(requestedStructures.includes("finance") && financingSource ? { financingSource } : {}),
      leaseMileagePerYear: leaseMileage,
      leaseTermMonths: leaseTerm,
      vehicleTerms: vehicleTermsForDeal,
      purchaseTimeline: purchaseTimeline || undefined,
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
      otherLots: otherLotsForDeal,
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
    if (pricingChoice === "buyer_names" && !(targetOtdPrice > 0)) {
      setSubmitError("Enter your target out-the-door price, or switch to letting the dealer name their price.");
      return;
    }
    if (!purchaseTimeline) {
      setSubmitError("Select your purchase timeline.");
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
          targetOtdPrice: pricingChoice === "buyer_names" ? targetOtdPrice : undefined,
          paymentMethod,
          dealStructure: shopperDealStructurePayload({
            requestedStructures,
            financeTermMonths: financeTerm,
            downPayment,
            financingSource: financingSource || undefined,
            leaseMileagePerYear: leaseMileage,
            leaseTermMonths: leaseTerm,
            directOffer: directOfferMode,
            vehicle: selectedVehicle,
            mustHavePackages,
            otherLots: otherLotsForDeal,
            vehicleTerms: vehicleTermsForDeal,
            purchaseTimeline: purchaseTimeline || undefined,
          }),
          // See tradeInForRequest above — the flag only, honestly empty
          // detail fields, no appraisal fabricated.
          tradeIn: tradeInForRequest,
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
              <h2 className="text-base font-bold text-white">Configure Offer Package</h2>
              <p className="text-xs text-ink-muted">Step {step} of {TOTAL_STEPS} • {STEP_LABELS[step - 1]}</p>
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
            <div className="divide-y divide-border/50">
              {/* ---------------------------------------------------------- */}
              {/* Payment                                                     */}
              {/* ---------------------------------------------------------- */}
              <WizardSection
                title="Payment"
                hint="Payment shapes every offer dealers send you — pick all that apply."
                className="pb-6"
              >
                <div className="flex flex-wrap gap-2">
                  {/* Display order only (Finance, Lease, Cash) — the
                      underlying DEAL_STRUCTURE_METHODS order stays
                      Cash/Finance/Lease since formatDealStructures and
                      paymentMethodFromStructures rely on it elsewhere. */}
                  {(["finance", "lease", "cash"] as const).map((id) => {
                    const isChecked = requestedStructures.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={isChecked}
                        onClick={() => setRequestedStructures((current) => toggleDealStructure(current, id))}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-all ${
                          isChecked
                            ? "border-emerald-500 bg-emerald-500/10 text-white"
                            : "border-border text-ink-light hover:border-border-strong"
                        }`}
                      >
                        {isChecked && <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />}
                        {DEAL_STRUCTURE_LABELS[id]}
                      </button>
                    );
                  })}
                </div>

                {requestedStructures.length === 0 && (
                  <p className="text-[11px] text-rose-400">Select at least one payment method to continue.</p>
                )}

                {requestedStructures.includes("finance") && (
                  <div className="rounded-xl border border-border bg-surface-elevated p-3.5 space-y-2">
                    <span className="text-xs font-semibold text-ink-light">Who&apos;s financing this?</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition-colors ${
                          financingSource === "buyer_own"
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-border hover:border-border-strong"
                        }`}
                      >
                        <input
                          type="radio"
                          name="financingSource"
                          checked={financingSource === "buyer_own"}
                          onChange={() => setFinancingSource("buyer_own")}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500 focus:ring-0"
                        />
                        <span>
                          <span className="block font-semibold text-white">I&apos;ll bring my own financing</span>
                          <span className="block text-ink-muted text-[11px] mt-0.5">
                            A bank or credit union pre-approval — dealers quote you an out-the-door price only.
                          </span>
                        </span>
                      </label>
                      <label
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition-colors ${
                          financingSource === "dealer"
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-border hover:border-border-strong"
                        }`}
                      >
                        <input
                          type="radio"
                          name="financingSource"
                          checked={financingSource === "dealer"}
                          onChange={() => setFinancingSource("dealer")}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500 focus:ring-0"
                        />
                        <span>
                          <span className="block font-semibold text-white">Use the dealer&apos;s financing</span>
                          <span className="block text-amber-400 text-[11px] mt-0.5">
                            Not recommended — dealer financing often costs more than a bank or credit union rate you arrange yourself.
                          </span>
                        </span>
                      </label>
                    </div>
                    {financingSource == null && (
                      <p className="text-[11px] text-rose-400">Pick a financing source to continue.</p>
                    )}
                  </div>
                )}
              </WizardSection>

              {/* ---------------------------------------------------------- */}
              {/* Vehicle                                                     */}
              {/* ---------------------------------------------------------- */}
              <WizardSection
                title="Vehicle"
                hint="Paste a dealer listing URL or a 17-character VIN. One car is required to continue."
                className="py-6"
              >
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

                {parseError && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
                    {parseError}
                  </div>
                )}

                {/* Decoded vehicle preview — sits directly under the import
                    box so the buyer confirms what they got before touching
                    must-haves or alternates. */}
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

                {/* Must-haves collapse behind a one-line summary — the full
                    option list is long enough to bury everything else. */}
                {selectedVehicle && fordStickerStatus === "released" && fordFilterableOptions.length > 0 && (
                  <details className="group rounded-xl border border-border bg-surface-elevated">
                    <summary className="cursor-pointer list-none px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white">
                        {FORD_MUST_HAVE_HEADING}
                        <span className="ml-2 text-[11px] font-normal text-ink-muted">
                          {mustHavePackages.length} of {fordFilterableOptions.length} selected
                        </span>
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-border/60 px-3.5 py-3 space-y-2">
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
                  </details>
                )}

                {/* Alternates stay behind a link until asked for, or until
                    one is actually imported. */}
                {showAlternates || altVehicle1 || altVehicle2 ? (
                  <div className="space-y-2">
                    <p className="text-[10px] text-ink-faint">
                      Up to 2 similar vehicles — dealers can quote on any of the three.
                    </p>
                    <AlternateVinField
                      label="Alternate vehicle 1"
                      value={altVin1}
                      onChange={setAltVin1}
                      onImport={handleParseAlt1}
                      vehicle={altVehicle1}
                      error={altError1}
                      parsing={altParsing1}
                      onRemove={removeAlt1}
                    />
                    <AlternateVinField
                      label="Alternate vehicle 2"
                      value={altVin2}
                      onChange={setAltVin2}
                      onImport={handleParseAlt2}
                      vehicle={altVehicle2}
                      error={altError2}
                      parsing={altParsing2}
                      onRemove={removeAlt2}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAlternates(true)}
                    className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    + Add additional vehicles to the offer package
                  </button>
                )}
              </WizardSection>

              {/* ---------------------------------------------------------- */}
              {/* Trade-in                                                    */}
              {/* ---------------------------------------------------------- */}
              <WizardSection title="Trade-in" className="pt-6">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-ink-light">I have a vehicle to trade in</span>
                  <button
                    type="button"
                    onClick={() => setHasTradeIn(!hasTradeIn)}
                    aria-pressed={hasTradeIn}
                    aria-label="I have a vehicle to trade in"
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
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
                  <p className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-[11px] leading-snug text-ink-light">
                    Your trade-in will be handled after we finalize the price of the new car.
                  </p>
                )}
              </WizardSection>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 2: DIRECT OFFER OR MULTI-DEALER                                      */}
          {/* ========================================================================= */}
          {step === 2 && (
            <div className="divide-y divide-border/50">
              <WizardSection
                title="Who gets this offer"
                hint="Send it to the dealer holding this car, or open it to other dealers nearby."
                className="pb-6"
              >
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
              </WizardSection>

              {/* ---------------------------------------------------------- */}
              {/* Location — only the multi-dealer path uses it               */}
              {/* ---------------------------------------------------------- */}
              {offerPath === "auction" && (
              <WizardSection
                title="Where to look"
                hint="Sets which dealers can see this request. Radius is capped at 100 miles."
                className="pt-6"
              >
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span
                      className={`text-[10px] font-bold uppercase ${
                        huntLocationInvalid ? "text-amber-300" : "text-ink-faint"
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
                        aria-invalid={huntLocationInvalid}
                        autoComplete="off"
                        className={`w-full rounded-xl border bg-background py-2 pl-9 pr-3 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono ${
                          huntLocationInvalid
                            ? "border-amber-500 ring-1 ring-amber-500/40"
                            : "border-border"
                        }`}
                      />
                    </div>
                  </label>
                  <label className="space-y-1">
                    <span
                      className={`text-[10px] font-bold uppercase ${
                        huntLocationInvalid ? "text-amber-300" : "text-ink-faint"
                      }`}
                    >
                      Radius miles (required, 100 mi max)
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={huntRadius}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
                        const clamped = digits === "" ? "" : String(Math.min(100, Number(digits)));
                        setHuntRadius(clamped);
                        const n = Number(clamped);
                        if (Number.isFinite(n) && n > 0) setSearchRadius(n);
                      }}
                      placeholder="up to 100"
                      aria-required="true"
                      aria-invalid={huntLocationInvalid}
                      aria-label="Search radius in miles, maximum 100"
                      autoComplete="off"
                      className={`w-full rounded-xl border bg-background py-2 px-3 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono ${
                        huntLocationInvalid
                          ? "border-amber-500 ring-1 ring-amber-500/40"
                          : "border-border"
                      }`}
                    />
                  </label>
                </div>

                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sameStateOnly}
                    onChange={(e) => setSameStateOnly(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border text-emerald-500 focus:ring-0"
                  />
                  <span className="leading-snug text-ink-light">
                    Keep results within my state
                    <span className="block text-[10px] text-ink-faint">
                      Uncheck to widen the match to any state within the radius
                    </span>
                  </span>
                </label>
              </WizardSection>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 3: REVIEW & BROADCAST                                                */}
          {/* ========================================================================= */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                  Review & Privacy Shield
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  {directOfferMode
                    ? `Sending a direct, anonymized offer to ${selectedVehicle?.location.dealerName ?? "the dealer"} — your identity stays masked until they accept.`
                    : "Your personal identity is 100% masked to prevent annoying dealer sales calls."}
                </p>
              </div>

              {/* Pricing — who names the price: the dealer quotes their own
                  best OTD (blind), or the buyer sets a firm target the
                  dealer can accept or counter. */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-ink-light">Pricing</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPricingChoice("dealer_names")}
                    className={`text-left rounded-xl border p-3 transition-all ${
                      pricingChoice === "dealer_names"
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-border bg-surface-elevated hover:border-border-strong"
                    }`}
                  >
                    <div className={`text-xs font-bold ${pricingChoice === "dealer_names" ? "text-emerald-400" : "text-white"}`}>
                      Dealer Names Price
                    </div>
                    <div className="text-[10.5px] text-ink-faint mt-0.5">They quote their best out-the-door price</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPricingChoice("buyer_names")}
                    className={`text-left rounded-xl border p-3 transition-all ${
                      pricingChoice === "buyer_names"
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-border bg-surface-elevated hover:border-border-strong"
                    }`}
                  >
                    <div className={`text-xs font-bold ${pricingChoice === "buyer_names" ? "text-emerald-400" : "text-white"}`}>
                      I&apos;ll Set My Price
                    </div>
                    <div className="text-[10.5px] text-ink-faint mt-0.5">Offer a firm target OTD price</div>
                  </button>
                </div>

                {pricingChoice === "buyer_names" && (
                  <div className="rounded-xl border border-border bg-background p-3 space-y-1.5">
                    <label className="text-[10px] uppercase font-bold text-ink-faint">Your Target Out-The-Door Price</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint text-xs font-bold">$</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={targetOtdPrice > 0 ? targetOtdPrice.toLocaleString("en-US") : ""}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "").slice(0, 7);
                          setTargetOtdPrice(digits ? Number(digits) : 0);
                        }}
                        placeholder="52,000"
                        className="w-full rounded-xl border border-border bg-surface-elevated py-2 pl-6 pr-3 text-sm font-bold text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono"
                      />
                    </div>
                    <p className="text-[11px] text-ink-faint">
                      We&apos;ll send this to the dealer as your firm target — they can accept it or counter if they can&apos;t meet it.
                    </p>
                    {formatTypicalOtdLabel(typicalOtd) ? (
                      <p className="text-[11px] text-ink-muted">
                        {formatTypicalOtdLabel(typicalOtd)} — for context only, not a floor you have to beat.
                      </p>
                    ) : null}
                    {selectedVehicle?.msrp
                      ? (() => {
                          const warning = discountRealismWarning(selectedVehicle.msrp, targetOtdPrice);
                          return warning ? (
                            <p className="text-[11px] text-amber-400">{warning}</p>
                          ) : null;
                        })()
                      : null}
                  </div>
                )}
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
                      {reviewTarget.dealerName && formatDealerResponsivenessLabel(dealerResponsiveness) ? (
                        <div
                          className={`text-[10.5px] font-medium ${
                            dealerResponsiveness?.bidCount ? "text-emerald-400" : "text-ink-faint"
                          }`}
                        >
                          {formatDealerResponsivenessLabel(dealerResponsiveness)}
                        </div>
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

                <div className="flex justify-between border-b border-border/50 pb-2">
                  <span className="text-ink-muted">Pricing:</span>
                  <span className="text-emerald-400 font-bold text-right">
                    {pricingChoice === "buyer_names"
                      ? `You set the price — $${targetOtdPrice.toLocaleString("en-US")}`
                      : "Dealer names their price"}
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

              {/* Purchase Timeline */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink-light">Purchase Timeline</label>
                <select
                  value={purchaseTimeline}
                  onChange={(e) => setPurchaseTimeline(e.target.value as PurchaseTimeline)}
                  className={`w-full rounded-xl border bg-background py-2.5 px-3.5 text-xs text-white focus:outline-none ${
                    purchaseTimeline ? "border-border focus:border-emerald-500" : "border-amber-500/50 focus:border-amber-500"
                  }`}
                >
                  <option value="" disabled>
                    When are you looking to buy?
                  </option>
                  <option value="asap">ASAP</option>
                  <option value="this_week">This Week</option>
                  <option value="this_month">This Month</option>
                </select>
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
                    {pricingChoice === "buyer_names"
                      ? "We send the dealer your target Out-The-Door price — vehicle, taxes, fees, everything. They can accept it or counter if they can't meet it."
                      : "We ask the dealer to quote their own Out-The-Door price — vehicle, taxes, fees, everything — so you can see their best number."}{" "}
                    Once you and the dealer finalize that price together, we&apos;ll work through any trade-in value from there.
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
                  (step === 1 && (requestedStructures.length === 0 || !vehicleImported || financingSourceMissing)) ||
                  (step === 2 && (!offerPath || step2LocationMissing))
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
