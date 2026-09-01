"use client";

import React, { useState, useEffect } from "react";
import { Vehicle, BiddingStrategy, BiddingRequest, TradeInVehicle, TradeInPhoto, UserProfile, type DealStructureMethod } from "../lib/types";
import {
  DEAL_STRUCTURE_LABELS,
  DEAL_STRUCTURE_METHODS,
  formatDealStructures,
  paymentMethodFromStructures,
  toggleDealStructure,
} from "../lib/dealStructure";
import { formatCurrency, getEstimatedTaxRate } from "../lib/otdCalculator";
import { findContactInfo } from "../lib/piiFilter";
import { MOCK_POPULAR_PACKAGES, SAMPLE_TRADE_IN_VEHICLE } from "../lib/mockData";
import { decodeVin, SAMPLE_TEST_VINS, DecodedVehicle } from "../lib/vinDecoder";
import {
  FORD_BUILD_SHEET_LINK,
  FORD_COMPETITION_FACTORY_OPTIONS,
  FORD_COMPETITION_FACTORY_OPTIONS_UNAVAILABLE,
  FORD_COMPETITION_LOADING,
  FORD_COMPETITION_NEED_LOCATION,
  FORD_MUST_HAVE_HEADING,
  FORD_MUST_HAVE_HELP,
  FORD_OTHER_LOTS_HEADING,
  FORD_OTHER_LOTS_HELP,
  FORD_OTHER_LOTS_HELP_FIND,
  FORD_OTHER_LOTS_HELP_PASTE,
  FORD_OTHER_LOTS_MODE_FIND,
  FORD_OTHER_LOTS_MODE_PASTE,
  advertisedOrStickerPrice,
  autoFillCompetitionSlots,
  fordCompetitionEmptyCopy,
  formatFactoryOptionLine,
  formatPriceAmount,
  listingVdpHref,
  shopperPriceSourceLabel,
  type FactoryOptionDisplay,
  type OtherLotsMode,
} from "../lib/fordCompetitionUi";
import { isFordOrLincolnVin, isGmVin, pastedVinCandidate } from "../lib/oemWmi";
import {
  acceptImportedVehicle,
  factoryBuildFailedError,
  factoryBuildUnavailableError,
  factoryBuildUnreleasedError,
  preferredFactoryBuildEndpoint,
  type FactoryBuildOem,
} from "../lib/pasteImport";
import {
  X,
  ShieldCheck,
  Zap,
  ArrowRight,
  ArrowLeft,
  Search,
  CircleCheck as CheckCircle2,
  Percent,
  RefreshCw,
  DollarSign,
  Car,
  MapPin,
  Camera,
  CloudUpload as UploadCloud,
  Trash2,
  Image as ImageIcon,
  Sparkles,
  CircleHelp as HelpCircle,
  Link2,
  Globe,
  LoaderCircle as Loader2,
  Plus,
  Handshake,
  FileText
} from "lucide-react";

interface FordSuggestionCard {
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  engine?: string;
  exteriorColor?: string;
  dealerName: string;
  city: string;
  state: string;
  distanceMiles: number | null;
  listingPrice: number | null;
  listingPriceSource: "listing" | "sticker" | "unconfirmed";
  msrp: number | null;
  msrpSource: "listing" | "sticker" | "unconfirmed";
  dealerUrl: string | null;
  pdfUrl: string;
  matchedMustHaves: string[];
  matchedNiceToHaves: string[];
  factoryOptions?: FactoryOptionDisplay[];
  factoryOptionsStatus?: "ok" | "unavailable";
}

interface FilterableFactoryOption {
  name: string;
  code?: string | null;
  description?: string;
  price: number | null;
  isPackageChild?: boolean;
}

function formatStickerMsrp(amount: number | null | undefined): string {
  return formatPriceAmount(amount);
}

function milesFromUserZip(miles: number | null | undefined, zip: string): string | null {
  if (miles == null || !/^\d{5}$/.test(zip.trim())) return null;
  return `${miles} mi from ${zip.trim()}`;
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

function competitionFactoryLines(
  suggestion: FordSuggestionCard | null,
  vehicle: Vehicle
): { status: "ok" | "unavailable"; lines: FactoryOptionDisplay[] } {
  if (suggestion?.factoryOptionsStatus === "unavailable") {
    return { status: "unavailable", lines: [] };
  }
  if (suggestion?.factoryOptions && suggestion.factoryOptions.length > 0) {
    return { status: "ok", lines: suggestion.factoryOptions };
  }
  if (vehicle.options && vehicle.options.length > 0) {
    return {
      status: "ok",
      lines: vehicle.options.map((o) => ({
        code: o.code || null,
        description: o.name,
        price: o.price,
        isPackageChild: o.category === "standalone",
      })),
    };
  }
  return { status: "unavailable", lines: [] };
}

function CompetitionFactoryOptions({
  suggestion,
  vehicle,
}: {
  suggestion: FordSuggestionCard | null;
  vehicle: Vehicle;
}) {
  const { status, lines } = competitionFactoryLines(suggestion, vehicle);
  if (status === "unavailable") {
    return (
      <p className="text-[11px] text-ink-muted mt-1.5">{FORD_COMPETITION_FACTORY_OPTIONS_UNAVAILABLE}</p>
    );
  }
  return (
    <div className="mt-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {FORD_COMPETITION_FACTORY_OPTIONS}
      </div>
      <ul className="mt-0.5 max-h-40 overflow-y-auto space-y-0.5">
        {lines.map((opt, i) => (
          <li
            key={`${opt.code || ""}-${opt.description}-${i}`}
            className={`text-[11px] leading-snug text-ink-light ${opt.isPackageChild ? "pl-3 text-ink-muted" : ""}`}
          >
            {formatFactoryOptionLine(opt)}
            {opt.price != null && opt.price > 0 ? (
              <span className="text-ink-faint"> · {formatCurrency(opt.price)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function fordSuggestionToVehicle(s: FordSuggestionCard): Vehicle {
  return {
    id: `ford-${s.vin}`,
    vin: s.vin,
    year: s.year || 0,
    make: s.make || "Ford",
    model: s.model || "",
    trim: s.trim || "",
    bodyType: "SUV",
    engine: s.engine || "",
    drivetrain: "",
    transmission: "",
    exteriorColor: s.exteriorColor || "",
    interiorColor: "",
    msrp: s.msrp || 0,
    dealerPrice: s.listingPrice || 0,
    daysOnLot: 0,
    status: "on_lot",
    condition: "new",
    location: {
      dealerName: s.dealerName,
      city: s.city,
      state: s.state,
      distanceMiles: s.distanceMiles || 0,
    },
    packages: (s.factoryOptions || [])
      .filter((o) => !o.isPackageChild)
      .map((o) => o.description),
    options: (s.factoryOptions || []).map((o) => ({
      code: o.code || "",
      name: o.description,
      price: o.price || 0,
      category: o.isPackageChild ? ("standalone" as const) : ("package" as const),
    })),
    imageUrl: "",
    mileage: 0,
    dealerUrl: s.dealerUrl || undefined,
    oemBuildSheetUrl: s.pdfUrl,
  };
}

// A real, live-inventory competing vehicle suggested by /api/comparable-vehicles
// (same make/model, same state, within 50 miles of the buyer) — only ever
// populated from a real box query, never fabricated.
interface ComparableSuggestion {
  vin: string;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  price: number | null;
  msrp: number | null;
  mileage: number | null;
  status: string | null;
  dealerName: string | null;
  city: string | null;
  state: string | null;
  distanceMiles: number | null;
  url: string | null;
}

function suggestionToVehicle(s: ComparableSuggestion): Vehicle {
  return {
    id: s.vin,
    vin: s.vin,
    year: s.year || 0,
    make: s.make,
    model: s.model,
    trim: s.trim || "",
    bodyType: "",
    engine: "",
    drivetrain: "",
    transmission: "",
    exteriorColor: "",
    interiorColor: "",
    msrp: s.msrp || s.price || 0,
    dealerPrice: s.price || s.msrp || 0,
    daysOnLot: 0,
    status: "on_lot",
    location: {
      dealerName: s.dealerName || "",
      city: s.city || "",
      state: s.state || "",
      distanceMiles: s.distanceMiles || 0,
    },
    packages: [],
    options: [],
    imageUrl: "",
    mileage: s.mileage || 0,
    dealerUrl: s.url || undefined,
  };
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
  const [step, setStep] = useState<number>(1);
  const [strategy, setStrategy] = useState<BiddingStrategy>(initialStrategy);

  const [dealerUrlInput, setDealerUrlInput] = useState<string>("");
  const [isParsingLink, setIsParsingLink] = useState<boolean>(false);
  const [parseSuccessMsg, setParseSuccessMsg] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [factoryBuildOem, setFactoryBuildOem] = useState<FactoryBuildOem | null>(null);
  const [fordStickerStatus, setFordStickerStatus] = useState<"released" | "unreleased" | "error" | null>(null);
  const [fordPdfUrl, setFordPdfUrl] = useState<string | null>(null);
  const [fordFilterableOptions, setFordFilterableOptions] = useState<FilterableFactoryOption[]>([]);
  const [niceToHavePackages, setNiceToHavePackages] = useState<string[]>([]);
  const [fordSuggestions, setFordSuggestions] = useState<FordSuggestionCard[]>([]);
  const [isLoadingFordSuggestions, setIsLoadingFordSuggestions] = useState(false);
  const [fordSearchNote, setFordSearchNote] = useState<string | null>(null);
  const [fordHuntError, setFordHuntError] = useState<string | null>(null);
  const [fordDroppedCount, setFordDroppedCount] = useState(0);
  const [huntZip, setHuntZip] = useState("");
  const [huntRadius, setHuntRadius] = useState("");
  const [otherLotsMode, setOtherLotsMode] = useState<OtherLotsMode>("find");

  // Step 2: up to 2 optional secondary vehicle links, to widen competition
  // beyond just the favorite pick.
  const [secondaryUrls, setSecondaryUrls] = useState<string[]>(["", ""]);
  const [secondaryVehicles, setSecondaryVehicles] = useState<(Vehicle | null)[]>([null, null]);
  const [isParsingSecondary, setIsParsingSecondary] = useState<boolean[]>([false, false]);

  // Real, live comparable vehicles (same make/model, same state, <=50mi of
  // the buyer) — fetched from the box's real inventory, never fabricated.
  const [aiSuggestions, setAiSuggestions] = useState<ComparableSuggestion[]>([]);
  const [isLoadingAiSuggestions, setIsLoadingAiSuggestions] = useState(false);
  const [aiSuggestionsSupported, setAiSuggestionsSupported] = useState(true);

  // Set when the buyer explicitly chooses to skip the multi-dealer auction
  // and send a single, anonymized offer straight to the favorite vehicle's
  // dealer instead (only offered when no secondary vehicles are attached).
  const [directOfferMode, setDirectOfferMode] = useState(false);

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

  // Step 1: independently checked cash / finance / lease (at least one required)
  const [requestedStructures, setRequestedStructures] = useState<DealStructureMethod[]>(["cash"]);
  const paymentMethod = paymentMethodFromStructures(requestedStructures);
  const wantsFinance = requestedStructures.includes("finance");
  const wantsLease = requestedStructures.includes("lease");
  const [financeTerm, setFinanceTerm] = useState<number>(60);
  const [downPayment, setDownPayment] = useState<number>(5000);
  const [leaseMileage, setLeaseMileage] = useState<number>(12000);
  const [leaseTerm, setLeaseTerm] = useState<number>(36);

  // Financial & Geographic fields
  const [targetOtdPrice, setTargetOtdPrice] = useState<number>(52000);
  const [targetDiscountPercent, setTargetDiscountPercent] = useState<number>(8.5);
  const [buyerZip, setBuyerZip] = useState<string>("94107");
  const [searchRadius, setSearchRadius] = useState<number>(100);
  const [sameStateOnly, setSameStateOnly] = useState<boolean>(true);
  const [isSubmittingReal, setIsSubmittingReal] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 6: optional free-text note to the dealer. Real-time-checked for
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
      // Vehicle selection (step 2) is skipped via goNext/goBack below — the
      // payment-method question (step 1) still shows first for every flow,
      // real-vehicle or not, so we don't jump away from it here.
    }
  }, [preselectedVehicle, lockVehicleSelection]);

  const TOTAL_STEPS = 6;
  // Step 2 Continue is blocked until Import Car actually loaded a vehicle.
  // Typing a VIN/URL, or merely arriving on this step, is not enough.
  const vehicleImported = Boolean(parseSuccessMsg && selectedVehicle);
  // Step 2 (vehicle selection) is skipped when a real vehicle is already
  // locked in — the payment-method question (step 1) still always shows
  // first, so the skip happens on navigation, not on mount.
  const goNext = () => {
    if (step === 1 && requestedStructures.length === 0) return;
    if (step === 2 && !vehicleImported) return;
    if (step === 1 && lockVehicleSelection) {
      setStep(3);
    } else {
      setStep(step + 1);
    }
  };
  const goBack = () => {
    if (step === 3 && lockVehicleSelection) {
      setStep(1);
    } else if (step === 4 && directOfferMode) {
      setDirectOfferMode(false);
      setStep(2);
    } else {
      setStep(step - 1);
    }
  };

  const huntReady = /^\d{5}$/.test(huntZip.trim()) && Number(huntRadius) > 0;
  const findLotsMode = otherLotsMode === "find";
  const fordHuntActive = factoryBuildOem === "ford" && fordStickerStatus === "released";

  const selectOtherLotsMode = (mode: OtherLotsMode) => {
    if (mode === otherLotsMode) return;
    setOtherLotsMode(mode);
    if (mode === "paste") {
      setSecondaryVehicles([null, null]);
      setSecondaryUrls(["", ""]);
    }
  };

  // Matching lots for the two "other lots" slots on the find path only.
  // Warehouse /api/comparable-vehicles is intentionally NOT the source of
  // truth for Ford factory options. ZIP + radius are required user input.
  // Paste-own mode must not call /api/ford-comparables.
  useEffect(() => {
    if (!findLotsMode || factoryBuildOem !== "ford" || fordStickerStatus !== "released" || !selectedVehicle?.vin) {
      setFordSuggestions([]);
      setFordHuntError(null);
      setFordSearchNote(null);
      setIsLoadingFordSuggestions(false);
      return;
    }
    if (!huntReady) {
      setFordSuggestions([]);
      setFordHuntError(null);
      setFordSearchNote(FORD_COMPETITION_NEED_LOCATION);
      setFordDroppedCount(0);
      setIsLoadingFordSuggestions(false);
      return;
    }
    let cancelled = false;
    setIsLoadingFordSuggestions(true);
    setFordHuntError(null);
    setFordSuggestions([]);
    setFordSearchNote(null);
    setFordDroppedCount(0);
    fetch("/api/ford-comparables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectVin: selectedVehicle.vin,
        mustHaveLines: mustHavePackages,
        niceToHaveLines: niceToHavePackages,
        zip: huntZip.trim(),
        radiusMiles: Number(huntRadius),
      }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || json.error) {
          const message =
            typeof json.error === "string" && json.error.trim()
              ? json.error
              : `Could not load similar lots (${res.status || "network error"}).`;
          setFordSuggestions([]);
          setFordDroppedCount(0);
          setFordHuntError(message);
          setFordSearchNote(message);
          return;
        }
        setFordHuntError(null);
        setFordSuggestions(json.matches || []);
        setFordSearchNote(json.note || null);
        setFordDroppedCount(Array.isArray(json.dropped) ? json.dropped.length : 0);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Could not load similar lots.";
        setFordSuggestions([]);
        setFordDroppedCount(0);
        setFordHuntError(message);
        setFordSearchNote(message);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFordSuggestions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    findLotsMode,
    factoryBuildOem,
    fordStickerStatus,
    selectedVehicle?.vin,
    mustHavePackages,
    niceToHavePackages,
    huntZip,
    huntRadius,
    huntReady,
  ]);

  useEffect(() => {
    if (!findLotsMode) {
      setAiSuggestions([]);
      setIsLoadingAiSuggestions(false);
      return;
    }
    if (!selectedVehicle || fordStickerStatus === "released") return;
    if (!buyerZip || buyerZip.trim().length < 5) {
      setAiSuggestions([]);
      return;
    }
    let cancelled = false;
    setIsLoadingAiSuggestions(true);
    const params = new URLSearchParams({
      make: selectedVehicle.make,
      model: selectedVehicle.model,
      zip: buyerZip,
      excludeVin: selectedVehicle.vin,
    });
    fetch(`/api/comparable-vehicles?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setAiSuggestionsSupported(!!json.supported);
        setAiSuggestions(json.vehicles || []);
      })
      .catch(() => {
        if (!cancelled) setAiSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAiSuggestions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [findLotsMode, fordStickerStatus, selectedVehicle?.vin, selectedVehicle?.make, selectedVehicle?.model, buyerZip]);

  // Find path only: the two slots ARE the nearest match plus the nearest
  // different dealer (including lots with no dealerUrl). Paste-own never auto-fills.
  useEffect(() => {
    if (!findLotsMode || factoryBuildOem !== "ford" || fordStickerStatus !== "released") return;
    const [first, second] = autoFillCompetitionSlots(fordSuggestions);
    setSecondaryVehicles([
      first ? fordSuggestionToVehicle(first) : null,
      second ? fordSuggestionToVehicle(second) : null,
    ]);
    setSecondaryUrls([first?.dealerUrl || "", second?.dealerUrl || ""]);
  }, [findLotsMode, factoryBuildOem, fordSuggestions, fordStickerStatus]);

  const applyFactoryBuildJson = (
    json: Record<string, unknown>,
    ok: boolean,
    oem: FactoryBuildOem,
    pastedVin: string | null
  ) => {
    const sticker = json.sticker as { status?: string; pdfUrl?: string; msrp?: number } | undefined;
    const responseVin =
      (typeof json.vin === "string" && json.vin.trim().toUpperCase()) || pastedVin || null;

    if (!ok) {
      setParseError(
        factoryBuildFailedError(
          responseVin,
          typeof json.error === "string" ? json.error : undefined
        )
      );
      setIsParsingLink(false);
      return;
    }

    if (sticker?.status === "unreleased") {
      setFactoryBuildOem(oem);
      setFordStickerStatus("unreleased");
      setFordPdfUrl((typeof json.pdfUrl === "string" && json.pdfUrl) || sticker?.pdfUrl || null);
      setParseError(factoryBuildUnreleasedError(responseVin));
      setIsParsingLink(false);
      return;
    }

    const matched = acceptImportedVehicle(json.vehicle as Vehicle | null, responseVin);
    if (!matched) {
      setParseError(
        factoryBuildFailedError(
          responseVin,
          typeof json.error === "string" ? json.error : undefined
        )
      );
      setIsParsingLink(false);
      return;
    }

    setSelectedVehicle(matched);
    setMake(matched.make);
    setModel(matched.model);
    setSelectedTrims([matched.trim]);
    setMustHavePackages(Array.isArray(json.mustHaveLines) ? (json.mustHaveLines as string[]) : []);
    setNiceToHavePackages(Array.isArray(json.niceToHaveLines) ? (json.niceToHaveLines as string[]) : []);
    setFordFilterableOptions((json.filterableOptions as FilterableFactoryOption[]) || []);
    setFactoryBuildOem(oem);
    setFordStickerStatus("released");
    setFordPdfUrl(
      (typeof json.pdfUrl === "string" && json.pdfUrl) || matched.oemBuildSheetUrl || null
    );
    if (typeof sticker?.msrp === "number" && sticker.msrp > 0) {
      setTargetOtdPrice(Math.round(sticker.msrp * 0.92));
    }
    setParseSuccessMsg(
      `VIN ${matched.vin}${sticker?.msrp ? ` · MSRP ${formatStickerMsrp(sticker.msrp)}` : ""}`
    );
    setIsParsingLink(false);
  };

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
    setFordSuggestions([]);
    setFordFilterableOptions([]);
    setNiceToHavePackages([]);
    setMustHavePackages([]);
    setSecondaryVehicles([null, null]);
    setSecondaryUrls(["", ""]);
    setFordHuntError(null);

    const pastedVin = pastedVinCandidate(raw);

    try {
      const endpoint = preferredFactoryBuildEndpoint(raw) || "/api/ford-sticker";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paste: raw }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const jsonVin =
        typeof json.vin === "string" ? json.vin.trim().toUpperCase() : pastedVin;

      if (json.needsVin || json.dealerBlocked) {
        setParseError(
          (typeof json.error === "string" && json.error) ||
            "Could not read a VIN from that page. Paste the 17-character VIN."
        );
        setIsParsingLink(false);
        return;
      }

      if (endpoint === "/api/ford-sticker" && json.notFord && json.handled === false) {
        if (jsonVin && isGmVin(jsonVin)) {
          const gmRes = await fetch("/api/gm-sticker", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paste: raw, vin: jsonVin }),
          });
          const gmJson = (await gmRes.json().catch(() => ({}))) as Record<string, unknown>;
          applyFactoryBuildJson(gmJson, gmRes.ok, "gm", jsonVin);
          return;
        }
        setParseError(factoryBuildUnavailableError(jsonVin || pastedVin));
        setIsParsingLink(false);
        return;
      }

      if (endpoint === "/api/gm-sticker" && json.notGm && json.handled === false) {
        if (jsonVin && isFordOrLincolnVin(jsonVin)) {
          const fordRes = await fetch("/api/ford-sticker", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paste: raw, vin: jsonVin }),
          });
          const fordJson = (await fordRes.json().catch(() => ({}))) as Record<string, unknown>;
          applyFactoryBuildJson(fordJson, fordRes.ok, "ford", jsonVin);
          return;
        }
        setParseError(factoryBuildUnavailableError(jsonVin || pastedVin));
        setIsParsingLink(false);
        return;
      }

      applyFactoryBuildJson(
        json,
        res.ok,
        endpoint === "/api/gm-sticker" ? "gm" : "ford",
        jsonVin || pastedVin
      );
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : "Lookup failed");
      setIsParsingLink(false);
    }
  };

  const handleParseSecondaryUrl = async (idx: number, urlToParse?: string) => {
    const raw = (urlToParse ?? secondaryUrls[idx] ?? "").trim();
    if (!raw) return;
    setIsParsingSecondary((prev) => prev.map((v, i) => (i === idx ? true : v)));
    try {
      const endpoint = preferredFactoryBuildEndpoint(raw) || "/api/ford-sticker";
      let res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paste: raw }),
      });
      let json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (endpoint === "/api/ford-sticker" && json.notFord && typeof json.vin === "string" && isGmVin(json.vin)) {
        res = await fetch("/api/gm-sticker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paste: raw, vin: json.vin }),
        });
        json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      }
      const pastedVin = pastedVinCandidate(raw) || (typeof json.vin === "string" ? json.vin : null);
      const matched = acceptImportedVehicle(json.vehicle as Vehicle | null, pastedVin);
      if (matched) {
        setSecondaryVehicles((prev) => prev.map((v, i) => (i === idx ? matched : v)));
      }
    } finally {
      setIsParsingSecondary((prev) => prev.map((v, i) => (i === idx ? false : v)));
    }
  };

  const handleRemoveSecondary = (idx: number) => {
    setSecondaryUrls((prev) => prev.map((v, i) => (i === idx ? "" : v)));
    setSecondaryVehicles((prev) => prev.map((v, i) => (i === idx ? null : v)));
  };

  const handleImportAiSuggestions = () => {
    const emptySlots = secondaryVehicles.reduce<number[]>((acc, v, i) => {
      if (!v) acc.push(i);
      return acc;
    }, []);
    if (emptySlots.length === 0 || aiSuggestions.length === 0) return;
    const picks = aiSuggestions.slice(0, emptySlots.length);
    setSecondaryVehicles((prev) => {
      const next = [...prev];
      emptySlots.forEach((slotIdx, i) => {
        if (picks[i]) next[slotIdx] = suggestionToVehicle(picks[i]);
      });
      return next;
    });
    setSecondaryUrls((prev) => {
      const next = [...prev];
      emptySlots.forEach((slotIdx, i) => {
        if (picks[i]?.url) next[slotIdx] = picks[i].url as string;
      });
      return next;
    });
  };

  const hasCompetition = secondaryVehicles.some((v) => !!v);
  const huntLocationMissing = findLotsMode && fordHuntActive && !huntReady;
  const fordEmptySlots = fordHuntActive
    ? fordCompetitionEmptyCopy({
          huntReady,
          loading: isLoadingFordSuggestions,
          error: fordHuntError,
          note: fordSearchNote,
          droppedCount: fordDroppedCount,
          matchCount: fordSuggestions.length,
        })
      : null;

  const handleSubmitDirectOffer = () => {
    setStrategy("firm_offer");
    setDirectOfferMode(true);
    setStep(4); // skip the strategy-choice step — it's implicitly decided
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

  const estimatedTaxPercent = (getEstimatedTaxRate(buyerZip) * 100).toFixed(2);

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

  const toggleFordMustHave = (name: string) => {
    setMustHavePackages((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]
    );
    setNiceToHavePackages((prev) => prev.filter((p) => p !== name));
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

  const buildTradeIn = (): TradeInVehicle | undefined =>
    hasTradeIn
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
      : undefined;

  const handleLaunchDeal = async () => {
    if (dealCommentContactWarning) {
      setSubmitError(`Your comment appears to contain ${dealCommentContactWarning} — remove it before submitting.`);
      return;
    }
    if (lockVehicleSelection) {
      if (!currentUser) {
        onClose();
        onRequireLogin?.();
        return;
      }
      if (!selectedVehicle) return;
      setIsSubmittingReal(true);
      setSubmitError(null);
      try {
        const res = await fetch("/api/deal-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy,
            referenceBrandCode,
            referenceVin: selectedVehicle.vin,
            referenceYear: selectedVehicle.year,
            referenceMake: selectedVehicle.make,
            referenceModel: selectedVehicle.model,
            referenceTrim: selectedVehicle.trim,
            referencePrice: selectedVehicle.dealerPrice,
            referenceMsrp: selectedVehicle.msrp,
            referenceImageUrl: selectedVehicle.imageUrl,
            targetOtdPrice: strategy === "firm_offer" ? targetOtdPrice : undefined,
            targetDiscountPercent: strategy === "flexible_discount" ? targetDiscountPercent : undefined,
            paymentMethod,
            dealStructure: {
              requestedStructures,
              financeTermMonths: financeTerm,
              downPayment,
              leaseMileagePerYear: leaseMileage,
              leaseTermMonths: leaseTerm,
            },
            tradeIn: buildTradeIn(),
            buyerZip,
            searchRadiusMiles: searchRadius,
            sameStateOnly,
            buyerComment: dealComment.trim() || undefined,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not submit your request.");

        const dr = json.dealRequest;
        const newRequest: BiddingRequest = {
          id: dr.id,
          strategy: dr.strategy,
          targetVin: dr.referenceVin,
          targetVehicle: selectedVehicle,
          paymentMethod: dr.paymentMethod,
          buyerZip: dr.buyerZip,
          buyerState: dr.buyerState,
          searchRadiusMiles: dr.searchRadiusMiles,
          sameStateOnly: dr.sameStateOnly,
          tradeIn: buildTradeIn(),
          buyerComment: dr.buyerComment ?? undefined,
          createdAt: dr.createdAt,
          expiresAt: dr.expiresAt,
          status: dr.status,
        };
        onRealBidRequestCreated?.(newRequest);
        setCreatedDealId(dr.id);
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : "Could not submit your request.");
      } finally {
        setIsSubmittingReal(false);
      }
      return;
    }

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
      tradeIn: buildTradeIn(),
      buyerComment: dealComment.trim() || undefined,
      targetOtdPrice: strategy === "firm_offer" ? targetOtdPrice : undefined,
      targetDiscountPercent: strategy === "flexible_discount" ? targetDiscountPercent : undefined,
      paymentMethod,
      dealStructurePreferences: {
        requestedStructures,
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
          {/* STEP 1: PAYMENT METHOD — CASH, FINANCE, OR LEASE                          */}
          {/* ========================================================================= */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                  Step 1: How Are You Paying?
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  This shapes every offer dealers send you — we'll ask for the details next.
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
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 2: SELECT THE TARGET VEHICLE                                         */}
          {/* ========================================================================= */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                  Step 2: Pick Your Favorite Car
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  This is the one you actually want — paste a dealer listing URL or a 17-character VIN.
                </p>
              </div>

              <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span
                          className={`text-[10px] font-bold uppercase ${
                            huntLocationMissing ? "text-amber-300" : "text-ink-faint"
                          }`}
                        >
                          Your ZIP{findLotsMode ? " (required)" : ""}
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
                          Radius miles{findLotsMode ? " (required)" : ""}
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
                      ZIP and radius are required before we recommend two other lots. Suggestions use your ZIP, not the dealer&apos;s.
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

              {/* Once a favorite is locked in, offer to widen the field */}
              {selectedVehicle && (
                <div className="space-y-5 pt-4 border-t border-border/50">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-ink-light">Other lots</span>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                      {(
                        [
                          { id: "find" as const, label: FORD_OTHER_LOTS_MODE_FIND },
                          { id: "paste" as const, label: FORD_OTHER_LOTS_MODE_PASTE },
                        ]
                      ).map((opt) => (
                        <label key={opt.id} className="flex items-center gap-2 py-0.5 text-xs cursor-pointer">
                          <input
                            type="radio"
                            name="otherLotsMode"
                            checked={otherLotsMode === opt.id}
                            onChange={() => selectOtherLotsMode(opt.id)}
                            className="h-3.5 w-3.5 shrink-0 border-border text-emerald-500 focus:ring-0"
                          />
                          <span className={otherLotsMode === opt.id ? "text-white" : "text-ink-light"}>
                            {opt.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {findLotsMode && fordStickerStatus === "released" && fordFilterableOptions.length > 0 && (
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        {FORD_MUST_HAVE_HEADING}
                      </h4>
                      <p className="text-[11px] text-ink-muted">{FORD_MUST_HAVE_HELP}</p>
                      <FactoryMustHavePicker
                        options={fordFilterableOptions}
                        checked={mustHavePackages}
                        onToggle={toggleFordMustHave}
                      />
                    </div>
                  )}
                  {/* Other lots: hunt auto-fill on the find path; two paste fields on the paste path */}
                  <div className="space-y-2.5">
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        {FORD_OTHER_LOTS_HEADING}{" "}
                        <span className="text-ink-faint font-normal normal-case">(optional)</span>
                      </h4>
                      <p className="text-[11px] text-ink-muted mt-0.5">
                        {FORD_OTHER_LOTS_HELP}{" "}
                        {findLotsMode ? FORD_OTHER_LOTS_HELP_FIND : FORD_OTHER_LOTS_HELP_PASTE}
                      </p>
                      {huntLocationMissing && (
                        <p className="text-[11px] text-amber-300 mt-1">
                          ZIP and radius are required above to fill these two slots.
                        </p>
                      )}
                    </div>

                    {findLotsMode && fordStickerStatus === "released" && fordEmptySlots?.kind === "loading" ? (
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-elevated px-3 py-4">
                        <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                        <span className="text-xs text-ink-muted">{FORD_COMPETITION_LOADING}</span>
                      </div>
                    ) : findLotsMode && fordStickerStatus === "released" && fordEmptySlots && !hasCompetition ? (
                      <>
                        <div
                          className={`rounded-xl border px-3 py-3 text-xs leading-relaxed ${
                            fordEmptySlots.kind === "error" || fordEmptySlots.kind === "need_location"
                              ? "border-amber-500/50 bg-amber-950/30 text-amber-100"
                              : "border-border bg-surface-elevated text-ink-muted"
                          }`}
                        >
                          {fordEmptySlots.message}
                        </div>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
                            <input
                              type="text"
                              value={secondaryUrls[0]}
                              onChange={(e) =>
                                setSecondaryUrls((prev) => prev.map((v, i) => (i === 0 ? e.target.value : v)))
                              }
                              placeholder="Or paste a VIN or listing link (optional)"
                              className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleParseSecondaryUrl(0)}
                            disabled={isParsingSecondary[0] || !secondaryUrls[0].trim()}
                            className="rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs font-bold text-ink-light hover:text-white hover:border-border-strong transition-all shrink-0 disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {isParsingSecondary[0] ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Plus className="h-3.5 w-3.5" />
                            )}
                            <span>Add</span>
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {[0, 1].map((idx) => {
                          const matchedVehicle = secondaryVehicles[idx];
                          const suggestion = autoFillCompetitionSlots(fordSuggestions)[idx];
                          return (
                            <div key={idx} className="space-y-1.5">
                              {matchedVehicle ? (
                                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-start gap-2 min-w-0">
                                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                                      <div className="min-w-0">
                                        <span className="text-xs font-bold text-white truncate block">
                                          {matchedVehicle.year} {matchedVehicle.make} {matchedVehicle.model}{" "}
                                          {matchedVehicle.trim}
                                        </span>
                                        <span className="text-[11px] text-ink-muted">
                                          {matchedVehicle.location.dealerName}
                                          {matchedVehicle.location.city ? ` · ${matchedVehicle.location.city}` : ""}
                                          {matchedVehicle.location.state
                                            ? `, ${matchedVehicle.location.state}`
                                            : ""}
                                          {milesFromUserZip(matchedVehicle.location.distanceMiles, huntZip)
                                            ? ` · ${milesFromUserZip(matchedVehicle.location.distanceMiles, huntZip)}`
                                            : ""}
                                          {" · "}
                                          {(() => {
                                            const shown = advertisedOrStickerPrice(
                                              matchedVehicle.dealerPrice,
                                              matchedVehicle.msrp
                                            );
                                            return `${formatPriceAmount(shown.amount)} ${shopperPriceSourceLabel(shown.source)}`;
                                          })()}
                                          {" · "}
                                          {(() => {
                                            const vdpHref = listingVdpHref(
                                              matchedVehicle.dealerUrl ||
                                                suggestion?.dealerUrl ||
                                                secondaryUrls[idx]
                                            );
                                            return vdpHref ? (
                                              <a
                                                href={vdpHref}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-mono text-emerald-400 hover:underline"
                                              >
                                                {matchedVehicle.vin}
                                              </a>
                                            ) : (
                                              <span className="font-mono">{matchedVehicle.vin}</span>
                                            );
                                          })()}
                                        </span>
                                        <CompetitionFactoryOptions
                                          suggestion={suggestion}
                                          vehicle={matchedVehicle}
                                        />
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveSecondary(idx)}
                                      className="shrink-0 rounded-lg p-1.5 text-ink-muted hover:bg-border hover:text-white transition-colors"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex gap-2">
                                  <div className="relative flex-1">
                                    <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
                                    <input
                                      type="text"
                                      value={secondaryUrls[idx]}
                                      onChange={(e) =>
                                        setSecondaryUrls((prev) =>
                                          prev.map((v, i) => (i === idx ? e.target.value : v))
                                        )
                                      }
                                      placeholder={`Paste a ${idx === 0 ? "2nd" : "3rd"} VIN or listing link (optional)`}
                                      className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleParseSecondaryUrl(idx)}
                                    disabled={isParsingSecondary[idx] || !secondaryUrls[idx].trim()}
                                    className="rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs font-bold text-ink-light hover:text-white hover:border-border-strong transition-all shrink-0 disabled:opacity-50 flex items-center gap-1.5"
                                  >
                                    {isParsingSecondary[idx] ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Plus className="h-3.5 w-3.5" />
                                    )}
                                    <span>Add</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {findLotsMode &&
                          fordStickerStatus !== "released" &&
                          !hasCompetition &&
                          aiSuggestions.length > 0 && (
                            <button
                              type="button"
                              onClick={handleImportAiSuggestions}
                              className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/5 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/10 transition-all"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              <span>Import AI Suggestions Below ↓</span>
                            </button>
                          )}
                      </>
                    )}
                    {findLotsMode && fordHuntActive && (
                      <p className="text-[10px] text-ink-faint">
                        Must-haves filter matching lots from each factory build. Dealer ads are not
                        proof. Distance is from your ZIP
                        {huntReady ? ` (${huntZip} · ${huntRadius} mi)` : ""}.
                      </p>
                    )}
                  </div>

                  {fordStickerStatus === "released" || !findLotsMode ? null : (
                  <div className="rounded-xl border border-border bg-surface-elevated p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-white">
                        <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                        <span>AI-Suggested Close Competition</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <MapPin className="h-3 w-3 text-ink-faint" />
                        <input
                          type="text"
                          value={buyerZip}
                          onChange={(e) => setBuyerZip(e.target.value)}
                          placeholder="ZIP"
                          className="w-16 rounded-lg border border-border bg-background py-1 px-2 text-[11px] text-white font-mono focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-ink-muted -mt-1.5">
                      Real matching inventory in-state, within 50 miles — dealers you didn't have to find yourself.
                    </p>

                    {isLoadingAiSuggestions ? (
                      <div className="flex items-center gap-2 text-ink-muted text-xs py-3">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning nearby inventory…
                      </div>
                    ) : !aiSuggestionsSupported ? (
                      <p className="text-[11px] text-ink-faint py-1">
                        We don't have live crawl coverage for {selectedVehicle.make} yet, so no real suggestions to show here.
                      </p>
                    ) : aiSuggestions.length === 0 ? (
                      <p className="text-[11px] text-ink-faint py-1">
                        No matching {selectedVehicle.model} found within 50 miles of {buyerZip || "your ZIP"} yet.
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {aiSuggestions.map((s) => (
                          <div
                            key={s.vin}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-[11px]"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-white truncate">
                                {s.year} {s.make} {s.model} {s.trim}
                              </div>
                              <div className="text-ink-faint truncate">
                                {s.dealerName} · {s.distanceMiles ?? "?"} mi
                              </div>
                            </div>
                            <div className="text-right shrink-0 font-mono text-white font-bold">
                              {s.price ? formatCurrency(s.price) : "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  )}

                  {/* DIRECT OFFER SHORTCUT: only one car, skip the auction */}
                  {!hasCompetition && (
                    <div className="rounded-xl border border-border bg-surface p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Handshake className="h-5 w-5 text-emerald-400 shrink-0" />
                        <div>
                          <div className="text-xs font-bold text-white">Only want this one car?</div>
                          <p className="text-[11px] text-ink-muted">
                            Skip the multi-dealer auction — send {selectedVehicle.location.dealerName} a reasonable, anonymized offer directly for their review.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleSubmitDirectOffer}
                        className="shrink-0 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3.5 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all"
                      >
                        Submit Direct Offer →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 3: CHOOSE STRATEGY                                                   */}
          {/* ========================================================================= */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                  Step 3: Choose Your Bidding Strategy
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
                {fordStickerStatus === "released" && fordFilterableOptions.length > 0 ? (
                  <>
                    <label className="text-xs font-semibold text-ink-light">{FORD_MUST_HAVE_HEADING}</label>
                    <p className="text-[10px] text-ink-faint">Same list as Step 2. Ticked lines are hard filters.</p>
                    <FactoryMustHavePicker
                      options={fordFilterableOptions}
                      checked={mustHavePackages}
                      onToggle={toggleFordMustHave}
                    />
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 4: TRADE-IN EVALUATION & PHOTO UPLOAD                                */}
          {/* ========================================================================= */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                    Step 4: Trade-In Vehicle & Photo Appraisal
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
          {/* STEP 5: DEAL STRUCTURE & FINANCIAL TERMS                                  */}
          {/* ========================================================================= */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                    Step 5: Set Your Deal Parameters
                  </h3>
                  <p className="text-xs text-ink-muted mt-0.5">
                    Fine-tune the terms dealers will bid against.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="shrink-0 rounded-lg border border-border bg-surface-elevated px-2.5 py-1 text-[10px] font-bold text-ink-muted hover:text-white hover:border-border-strong transition-colors"
                >
                  {formatDealStructures(requestedStructures) || "Payment methods"} · Change
                </button>
              </div>

              {/* Deal Structure Parameters Box */}
              {(wantsFinance || wantsLease) && (
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
                    {wantsFinance && (
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
                    {wantsLease && (
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
                    <option value={100}>100 Miles (Recommended)</option>
                    <option value={250}>250 Miles</option>
                    <option value={500}>500 Miles (Statewide)</option>
                    <option value={2000}>Nationwide</option>
                  </select>
                </div>
              </div>

              {lockVehicleSelection && (
                <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background p-3 cursor-pointer">
                  <div>
                    <div className="text-xs font-semibold text-ink-light">Prefer dealers in my state</div>
                    <p className="text-[10px] text-ink-faint">
                      On by default — turn off to also see dealers in other states within your radius.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={sameStateOnly}
                    onChange={(e) => setSameStateOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-border bg-surface-elevated text-emerald-500 focus:ring-emerald-500/20"
                  />
                </label>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* STEP 6: REVIEW & BROADCAST                                                */}
          {/* ========================================================================= */}
          {step === 6 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                  Step 6: Review & Privacy Shield
                </h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  {directOfferMode
                    ? `Sending a direct, anonymized offer to ${selectedVehicle?.location.dealerName ?? "the dealer"} — your identity stays masked until they accept.`
                    : "Your personal identity is 100% masked to prevent annoying dealer sales calls."}
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
                    {formatDealStructures(requestedStructures)}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-ink-muted">Assigned Buyer Alias:</span>
                  <span className="text-emerald-400 font-mono font-bold">Buyer #CA-4921</span>
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
                  (step === 1 && requestedStructures.length === 0) ||
                  (step === 2 && !vehicleImported)
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
                    : "Broadcasting…"
                  : directOfferMode
                  ? "Send Direct Offer"
                  : "Broadcast Deal Request"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
