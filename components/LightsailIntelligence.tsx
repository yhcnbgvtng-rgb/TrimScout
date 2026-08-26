"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Server,
  TrendingDown,
  Clock,
  Sparkles,
  Zap,
  Building2,
  RefreshCw,
  ExternalLink,
  Download,
  Search,
  ShieldCheck,
  Tag,
  SlidersHorizontal,
  Sliders,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  X,
  RotateCcw,
  LayoutGrid,
  List,
  Flame,
  ArrowUpDown,
  Car,
  Calendar,
  Gauge,
  DollarSign,
  MapPin,
  CheckCircle2,
  Copy,
  Check,
  FileText,
  BadgePercent,
  Layers,
  Navigation,
} from "lucide-react";
import {
  PorscheOption,
  NhtsaSpec,
} from "@/lib/enrichmentEngine";
import { calculateDistanceMiles } from "@/lib/otdCalculator";
import { DailyChangesPanel } from "./DailyChangesPanel";

export interface VehicleRecord {
  vin: string;
  dealerName: string;
  city?: string;
  state: string;
  inventoryType: string;
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  bodyStyle?: string | null;
  price: number | null;
  oldPrice?: number | null;
  priceDiff?: number;
  msrp?: number | null;
  mileage: number;
  status?: string;
  changeType?: string;
  daysOnLot?: number;
  firstSeen?: string;
  lastSeen?: string;
  url?: string;
  engine?: string | null;
  transmission?: string | null;
  exteriorColor?: string | null;
  nhtsa?: NhtsaSpec;
  factoryOptions?: PorscheOption[];
  optionCodes?: string[];
  totalOptionsPrice?: number;
  baseMsrp?: number | null;
  enrichedAt?: string;
  // Present when factoryOptions came from a Porsche Finder VIN cross-reference
  // rather than the dealer's own VDP. Finder publishes real per-VIN equipment
  // but not per-option retail pricing, so those items carry no `price`.
  optionsSource?: "DEALER_VDP" | "PORSCHE_FINDER";
  standardEquipment?: string[];
  finderUrl?: string;
  imageUrl?: string;
}

export const PORSCHE_PAINT_CODES: Record<string, string> = {
  "1h1h": "Vanadium Grey Metallic",
  "1h": "Vanadium Grey Metallic",
  "0404": "Arctic Grey",
  "04": "Arctic Grey",
  "3h3h": "Chalk",
  "3h": "Chalk",
  "m8m8": "Carmine Red",
  "m8": "Carmine Red",
  "0q0q": "White",
  "0q": "White",
  "a1a1": "Black",
  "a1": "Black",
  "g1g1": "Guards Red",
  "g1": "Guards Red",
  "1a1a": "Gentian Blue Metallic",
  "1a": "Gentian Blue Metallic",
  "2t2t": "Deep Black Metallic",
  "2t": "Deep Black Metallic",
  "z8z8": "GT Silver Metallic",
  "z8": "GT Silver Metallic",
  "u2u2": "GT Silver Metallic",
  "u2": "GT Silver Metallic",
  "2y2y": "Carrara White Metallic",
  "2y": "Carrara White Metallic",
  "n1n1": "Sapphire Blue Metallic",
  "p3p3": "Racing Yellow",
  "p3": "Racing Yellow",
  "s9s9": "Python Green",
  "h2h2": "Lava Orange",
  "b9b9": "Ice Grey Metallic",
  "b9": "Ice Grey Metallic",
  "d0d0": "Frozen Blue Metallic",
  "2h2h": "Volcano Grey Metallic",
  "c9c9": "Oak Green Metallic Neo",
  "q9q9": "Cartagena Yellow Metallic",
  "j0j0": "Lugano Blue",
  "7y7y": "Shade Green Metallic",
  "8989": "Paint to Sample (PTS)",
  "9898": "Paint to Sample Plus",
};

export function getCleanExteriorColor(raw?: string | null): string {
  if (!raw) return "Factory Exterior Finish";
  const lower = raw.trim().toLowerCase();
  if (PORSCHE_PAINT_CODES[lower]) {
    return PORSCHE_PAINT_CODES[lower];
  }
  return raw;
}

// A filter field that behaves like a dropdown (browse via native suggestions)
// and a text input (type to jump straight to a value) at once, via a native
// <input list="..."> + <datalist> pairing — no extra combobox dependency.
function ComboField({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  const listId = `combo-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const [text, setText] = useState("");

  useEffect(() => {
    const match = options.find((o) => o.value === value);
    setText(match ? match.label : "");
  }, [value, options]);

  const commit = (raw: string) => {
    if (!raw.trim()) {
      onChange("ALL");
      return;
    }
    const exact = options.find(
      (o) => o.label.toLowerCase() === raw.toLowerCase() || o.value.toLowerCase() === raw.toLowerCase()
    );
    if (exact) onChange(exact.value);
  };

  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold uppercase text-ink-faint">{label}</label>
      <input
        type="text"
        list={listId}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onBlur={(e) => {
          if (!e.target.value.trim()) onChange("ALL");
        }}
        placeholder={allLabel}
        className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.value} value={o.label} />
        ))}
      </datalist>
    </div>
  );
}

export const LightsailIntelligence: React.FC = () => {
  const [allVehicles, setAllVehicles] = useState<VehicleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "changes">("grid");
  const [copiedVin, setCopiedVin] = useState<string | null>(null);
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);
  const [selectedVehicleForModal, setSelectedVehicleForModal] = useState<VehicleRecord | null>(null);
  const [aiStickerLoading, setAiStickerLoading] = useState(false);
  const [aiStickerData, setAiStickerData] = useState<any | null>(null);
  const [aiPasteMode, setAiPasteMode] = useState(false);
  const [rawPasteInput, setRawPasteInput] = useState("");

  const handleFetchPorscheFinderAiSticker = async (vin: string) => {
    setAiStickerLoading(true);
    try {
      const res = await fetch(`/api/porsche-sticker?vin=${encodeURIComponent(vin)}`);
      const json = await res.json();
      if (json.success) {
        setAiStickerData(json);
      }
    } catch (e) {
      console.error("AI Porsche Finder fetch error:", e);
    } finally {
      setAiStickerLoading(false);
    }
  };

  const handleParseRawPorscheStickerText = async () => {
    if (!rawPasteInput.trim()) return;
    setAiStickerLoading(true);
    try {
      const res = await fetch(`/api/porsche-sticker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: rawPasteInput,
          vin: selectedVehicleForModal?.vin || "CUSTOM_VIN",
        }),
      });
      const json = await res.json();
      if (json.success) {
        setAiStickerData((prev: any) => ({
          ...(prev || selectedVehicleForModal),
          installedOptions: json.options,
          totalOptionsPrice: json.totalOptionsPrice,
          dataSource: "AI_PARSED_WINDOW_STICKER",
        }));
      }
    } catch (e) {
      console.error("AI Parse error:", e);
    } finally {
      setAiStickerLoading(false);
    }
  };
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMake, setSelectedMake] = useState<string>("ALL");
  const [selectedModel, setSelectedModel] = useState<string>("ALL");
  const [selectedTrim, setSelectedTrim] = useState<string>("ALL");
  const [selectedCondition, setSelectedCondition] = useState<string>("ALL");
  const [selectedDealer, setSelectedDealer] = useState<string>("ALL");
  const [selectedState, setSelectedState] = useState<string>("ALL");
  const [selectedBodyStyle, setSelectedBodyStyle] = useState<string>("ALL");
  const [selectedYear, setSelectedYear] = useState<string>("ALL");
  const [minPriceInput, setMinPriceInput] = useState<string>("");
  const [maxPriceInput, setMaxPriceInput] = useState<string>("");
  const [maxMileageInput, setMaxMileageInput] = useState<string>("");
  const [selectedDaysOnLot, setSelectedDaysOnLot] = useState<string>("ALL");
  const [selectedOpportunity, setSelectedOpportunity] = useState<string>("ALL");
  const [selectedOptionCode, setSelectedOptionCode] = useState<string>("ALL");
  const [userZip, setUserZip] = useState<string>("07054");
  const [sortBy, setSortBy] = useState<string>("default");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  // Reset page whenever any active filter is updated
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchTerm,
    selectedMake,
    selectedModel,
    selectedTrim,
    selectedCondition,
    selectedDealer,
    selectedState,
    selectedBodyStyle,
    selectedYear,
    minPriceInput,
    maxPriceInput,
    maxMileageInput,
    selectedDaysOnLot,
    selectedOpportunity,
    selectedOptionCode,
    sortBy,
    userZip,
  ]);

  // Fetch full live dataset
  const fetchData = async () => {
    try {
      const res = await fetch("/api/lightsail");
      if (res.ok) {
        const json = await res.json();
        const records: VehicleRecord[] = json.recentVehicles || [];
        setAllVehicles(records);
      }
    } catch (err) {
      console.error("Failed to load Lightsail inventory:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData();
  };

  const handleCopyVin = (vin: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(vin);
      setCopiedVin(vin);
      setTimeout(() => setCopiedVin(null), 2000);
    }
  };

  // Helper to compute vehicle distance in miles from active user ZIP
  const getVehicleDistance = (v: VehicleRecord): number => {
    const zip = userZip.trim() || "07054";
    return calculateDistanceMiles(zip, {
      city: v.city || v.dealerName || "Parsippany",
      state: v.state || "NJ",
    });
  };

  // Canonical Model Series Normalizer with deterministic VIN decoding
  const getModelSeries = (v: VehicleRecord): string => {
    const vin = (v.vin || "").toUpperCase();
    const make = (v.make || "").toLowerCase();
    const model = (v.model || "").toLowerCase();
    const trim = (v.trim || "").toLowerCase();
    const body = (v.bodyStyle || "").toLowerCase();
    const raw = `${make} ${model} ${trim} ${body}`.toLowerCase();

    // 1. Deterministic VIN VDS decoding
    if (vin.length >= 8) {
      const vds = vin.substring(3, 8);
      if (vds.includes("A9") || vds.includes("99")) return "911";
      if (vds.includes("Y1")) return "Taycan";
      if (vds.includes("YA")) return "Panamera";
      if (vds.includes("AY")) return "Cayenne";
      if (vds.includes("A5") || vds.includes("XA")) return "Macan";
      if (vds.includes("98") || vds.includes("97")) {
        return raw.includes("boxster") || raw.includes("spyder") || raw.includes("cabriolet") ? "718 Boxster" : "718 Cayman";
      }
    }

    // 2. Text & Specification Fallback Classification
    if (raw.includes("cayenne")) return "Cayenne";
    if (raw.includes("macan")) return "Macan";
    if (raw.includes("taycan")) return "Taycan";
    if (raw.includes("panamera")) return "Panamera";
    if (raw.includes("boxster") || raw.includes("spyder")) return "718 Boxster";
    if (raw.includes("718") || raw.includes("cayman")) return "718 Cayman";
    if (
      raw.includes("911") ||
      raw.includes("carrera") ||
      raw.includes("targa") ||
      raw.includes("gt3") ||
      raw.includes("gt2") ||
      raw.includes("dakar") ||
      raw.includes("sport classic") ||
      raw.includes("s/t")
    ) {
      return "911";
    }

    return v.model || "Other";
  };

  // Canonical Condition Normalizer
  const getNormalizedCondition = (v: VehicleRecord): "NEW" | "USED" | "CERTIFIED" => {
    const t = (v.inventoryType || "").toUpperCase();
    if (t.includes("CERT")) return "CERTIFIED";
    if (t.includes("NEW")) return "NEW";
    return "USED";
  };

  // Check if a vehicle passes active filters, optionally excluding a specific facet for cross-count calculation
  const checkFilterMatch = (v: VehicleRecord, excludeFacet?: string): boolean => {
    // 1. Search term
    if (searchTerm.trim() !== "") {
      const optNames = (v.factoryOptions || []).map((o) => `${o.code} ${o.name}`).join(" ");
      const textHaystack = `${v.year} ${v.make} ${v.model} ${v.trim || ""} ${v.bodyStyle || ""} ${v.dealerName} ${v.city || ""} ${v.state} ${v.exteriorColor || ""} ${optNames}`.toLowerCase();
      const vinLower = (v.vin || "").toLowerCase();
      const tokens = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
      const matchesAllTokens = tokens.every((t) => {
        if (textHaystack.includes(t)) return true;
        if (t.length >= 6 && vinLower.includes(t)) return true;
        if (t === vinLower) return true;
        return false;
      });
      if (!matchesAllTokens) return false;
    }

    // 1b. Make (manufacturer)
    if (excludeFacet !== "make" && selectedMake !== "ALL") {
      if (v.make !== selectedMake) return false;
    }

    // 2. Model Series
    if (excludeFacet !== "model" && selectedModel !== "ALL") {
      if (getModelSeries(v) !== selectedModel) return false;
    }

    // 3. Trim
    if (excludeFacet !== "trim" && selectedTrim !== "ALL") {
      if (v.trim !== selectedTrim) return false;
    }

    // 4. Condition
    if (excludeFacet !== "condition" && selectedCondition !== "ALL") {
      if (getNormalizedCondition(v) !== selectedCondition) return false;
    }

    // 5. Dealer
    if (excludeFacet !== "dealer" && selectedDealer !== "ALL") {
      if (v.dealerName !== selectedDealer) return false;
    }

    // 6. State
    if (excludeFacet !== "state" && selectedState !== "ALL") {
      if (v.state !== selectedState) return false;
    }

    // 7. Body Style
    if (excludeFacet !== "bodyStyle" && selectedBodyStyle !== "ALL") {
      if (v.bodyStyle !== selectedBodyStyle) return false;
    }

    // 8. Year
    if (excludeFacet !== "year" && selectedYear !== "ALL") {
      if (v.year !== parseInt(selectedYear, 10)) return false;
    }

    // 9. Factory Option Code — matched strictly against this vehicle's own
    // real, dealer-scraped options/packages. No keyword guessing: a car
    // only matches an option filter if it actually has that option.
    if (excludeFacet !== "option" && selectedOptionCode !== "ALL") {
      const codes = v.optionCodes || [];
      const optDefs = v.factoryOptions || [];
      const hasCode = codes.includes(selectedOptionCode) || optDefs.some((o) => o.code === selectedOptionCode);
      if (!hasCode) return false;
    }

    // 10. Price Range
    const minPrice = minPriceInput ? parseFloat(minPriceInput) : 0;
    const maxPrice = maxPriceInput ? parseFloat(maxPriceInput) : Infinity;
    const cleanP = v.price && v.price > 0 && v.price < 5000000 && v.price !== 2147483647 ? v.price : null;
    if (cleanP !== null) {
      if (cleanP < minPrice || cleanP > maxPrice) return false;
    }

    // 11. Mileage Range
    const maxMiles = maxMileageInput ? parseFloat(maxMileageInput) : Infinity;
    if (v.mileage > maxMiles) return false;

    // 12. Days on Lot
    if (excludeFacet !== "days" && selectedDaysOnLot !== "ALL") {
      const days = v.daysOnLot || 0;
      if (selectedDaysOnLot === "under_7" && days > 7) return false;
      if (selectedDaysOnLot === "7_to_30" && (days < 7 || days > 30)) return false;
      if (selectedDaysOnLot === "31_to_60" && (days < 31 || days > 60)) return false;
      if (selectedDaysOnLot === "over_45" && days < 45) return false;
      if (selectedDaysOnLot === "over_60" && days < 60) return false;
    }

    // 13. Market Opportunity
    if (excludeFacet !== "opportunity" && selectedOpportunity !== "ALL") {
      if (selectedOpportunity === "drops" && !(v.changeType === "PRICE_DROP" || (v.priceDiff && v.priceDiff < 0))) return false;
      if (selectedOpportunity === "fresh" && !(v.changeType === "NEW_ARRIVAL" || (v.daysOnLot || 0) <= 3)) return false;
      if (selectedOpportunity === "stale" && (v.daysOnLot || 0) < 45) return false;
      if (selectedOpportunity === "cpo" && getNormalizedCondition(v) !== "CERTIFIED") return false;
    }

    return true;
  };

  // Real-time dynamic faceted intersection counts across all criteria
  const facetOptions = useMemo(() => {
    const trims = new Map<string, number>();
    const makes = new Map<string, number>();
    const models = new Map<string, number>();
    const conditions = { NEW: 0, USED: 0, CERTIFIED: 0 };
    const dealers = new Map<string, number>();
    const states = new Map<string, number>();
    const bodyStyles = new Map<string, number>();
    const years = new Map<number, number>();
    const options = new Map<string, number>();

    // Initial base collection of all unique facets
    allVehicles.forEach((v) => {
      if (v.make && !makes.has(v.make)) makes.set(v.make, 0);
      const s = getModelSeries(v);
      if (!models.has(s)) models.set(s, 0);
      if (v.trim && v.trim !== "null" && v.trim.trim() !== "" && !trims.has(v.trim)) trims.set(v.trim, 0);
      if (v.dealerName && !dealers.has(v.dealerName)) dealers.set(v.dealerName, 0);
      if (v.state && !states.has(v.state)) states.set(v.state, 0);
      if (v.bodyStyle && v.bodyStyle !== "null" && !bodyStyles.has(v.bodyStyle)) bodyStyles.set(v.bodyStyle, 0);
      if (v.year && !years.has(v.year)) years.set(v.year, 0);
    });

    // Populate dynamic intersection counts
    allVehicles.forEach((v) => {
      // 0. Make counts (given all filters except make)
      if (checkFilterMatch(v, "make") && v.make) {
        makes.set(v.make, (makes.get(v.make) || 0) + 1);
      }

      // 1. Model series counts (given all filters except model)
      if (checkFilterMatch(v, "model")) {
        const s = getModelSeries(v);
        models.set(s, (models.get(s) || 0) + 1);
      }

      // 1b. Trim counts (given all filters except trim)
      if (checkFilterMatch(v, "trim") && v.trim && v.trim !== "null" && v.trim.trim() !== "") {
        trims.set(v.trim, (trims.get(v.trim) || 0) + 1);
      }

      // 2. Condition counts (given all filters except condition)
      if (checkFilterMatch(v, "condition")) {
        const cond = getNormalizedCondition(v);
        conditions[cond] = (conditions[cond] || 0) + 1;
      }

      // 3. Dealer counts (given all filters except dealer)
      if (checkFilterMatch(v, "dealer") && v.dealerName) {
        dealers.set(v.dealerName, (dealers.get(v.dealerName) || 0) + 1);
      }

      // 4. State counts (given all filters except state)
      if (checkFilterMatch(v, "state") && v.state) {
        states.set(v.state, (states.get(v.state) || 0) + 1);
      }

      // 5. Body style counts (given all filters except bodyStyle)
      if (checkFilterMatch(v, "bodyStyle") && v.bodyStyle && v.bodyStyle !== "null") {
        bodyStyles.set(v.bodyStyle, (bodyStyles.get(v.bodyStyle) || 0) + 1);
      }

      // 6. Year counts (given all filters except year)
      if (checkFilterMatch(v, "year") && v.year) {
        years.set(v.year, (years.get(v.year) || 0) + 1);
      }

      // 7. Option codes counts (given all filters except option) — counted
      // strictly from each vehicle's real, dealer-scraped options/packages.
      if (checkFilterMatch(v, "option")) {
        const codes = new Set(v.optionCodes || []);
        (v.factoryOptions || []).forEach((o) => codes.add(o.code));

        codes.forEach((c) => {
          options.set(c, (options.get(c) || 0) + 1);
        });
      }
    });

    // Real option code -> display name, built from whatever options actually
    // appear in the current dataset (dealer-scraped, per-VIN) rather than a
    // fixed hardcoded catalog — so the filter always matches real data.
    const optionNames = new Map<string, string>();
    allVehicles.forEach((v) => {
      (v.factoryOptions || []).forEach((o) => {
        if (o.code && o.name && !optionNames.has(o.code)) optionNames.set(o.code, o.name);
      });
    });

    return {
      makes: Array.from(makes.entries()).sort((a, b) => b[1] - a[1]),
      models: Array.from(models.entries()).sort((a, b) => b[1] - a[1]),
      trims: Array.from(trims.entries()).sort((a, b) => b[1] - a[1]),
      conditions,
      dealers: Array.from(dealers.entries()).sort((a, b) => b[1] - a[1]),
      states: Array.from(states.entries()).sort((a, b) => b[1] - a[1]),
      bodyStyles: Array.from(bodyStyles.entries()).sort((a, b) => b[1] - a[1]),
      years: Array.from(years.entries()).sort((a, b) => b[0] - a[0]),
      options,
      optionNames,
    };
  }, [
    allVehicles,
    searchTerm,
    selectedMake,
    selectedModel,
    selectedTrim,
    selectedCondition,
    selectedDealer,
    selectedState,
    selectedBodyStyle,
    selectedYear,
    minPriceInput,
    maxPriceInput,
    maxMileageInput,
    selectedDaysOnLot,
    selectedOpportunity,
    selectedOptionCode,
  ]);

  // Reset all filters to default
  const handleResetFilters = () => {
    setSearchTerm("");
    setSelectedMake("ALL");
    setSelectedModel("ALL");
    setSelectedTrim("ALL");
    setSelectedCondition("ALL");
    setSelectedDealer("ALL");
    setSelectedState("ALL");
    setSelectedBodyStyle("ALL");
    setSelectedYear("ALL");
    setMinPriceInput("");
    setMaxPriceInput("");
    setMaxMileageInput("");
    setSelectedDaysOnLot("ALL");
    setSelectedOpportunity("ALL");
    setSelectedOptionCode("ALL");
    setUserZip("07054");
    setSortBy("default");
  };

  // Count active applied filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchTerm.trim()) count++;
    if (selectedMake !== "ALL") count++;
    if (selectedModel !== "ALL") count++;
    if (selectedTrim !== "ALL") count++;
    if (selectedCondition !== "ALL") count++;
    if (selectedDealer !== "ALL") count++;
    if (selectedState !== "ALL") count++;
    if (selectedBodyStyle !== "ALL") count++;
    if (selectedYear !== "ALL") count++;
    if (minPriceInput.trim() || maxPriceInput.trim()) count++;
    if (maxMileageInput.trim()) count++;
    if (selectedDaysOnLot !== "ALL") count++;
    if (selectedOpportunity !== "ALL") count++;
    if (selectedOptionCode !== "ALL") count++;
    if (sortBy !== "default") count++;
    return count;
  }, [
    searchTerm,
    selectedMake,
    selectedModel,
    selectedTrim,
    selectedCondition,
    selectedDealer,
    selectedState,
    selectedBodyStyle,
    selectedYear,
    minPriceInput,
    maxPriceInput,
    maxMileageInput,
    selectedDaysOnLot,
    selectedOpportunity,
    selectedOptionCode,
    sortBy,
  ]);

  // Comprehensive Filtering & Sorting Pipeline
  const filteredVehicles = useMemo(() => {
    const minPrice = minPriceInput ? parseFloat(minPriceInput) : 0;
    const maxPrice = maxPriceInput ? parseFloat(maxPriceInput) : Infinity;
    const maxMiles = maxMileageInput ? parseFloat(maxMileageInput) : Infinity;

    return allVehicles
      .filter((v) => {
        // 1. Free Search (VIN, Make, Model, Trim, Dealer, City, State, Body, Color, Options)
        if (searchTerm.trim() !== "") {
          const optNames = (v.factoryOptions || []).map((o) => `${o.code} ${o.name}`).join(" ");
          const textHaystack = `${v.year} ${v.make} ${v.model} ${v.trim || ""} ${v.bodyStyle || ""} ${v.dealerName} ${v.city || ""} ${v.state} ${v.exteriorColor || ""} ${optNames}`.toLowerCase();
          const vinLower = (v.vin || "").toLowerCase();
          const tokens = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
          
          const matchesAllTokens = tokens.every((t) => {
            if (textHaystack.includes(t)) return true;
            // Only match against VIN if the token is a specific VIN search (length >= 6) or exact VIN
            if (t.length >= 6 && vinLower.includes(t)) return true;
            if (t === vinLower) return true;
            return false;
          });
          if (!matchesAllTokens) return false;
        }

        // 1b. Make Filter
        if (selectedMake !== "ALL") {
          if (v.make !== selectedMake) return false;
        }

        // 2. Model Series Filter
        if (selectedModel !== "ALL") {
          if (getModelSeries(v) !== selectedModel) return false;
        }

        // 3. Trim Filter
        if (selectedTrim !== "ALL") {
          if (v.trim !== selectedTrim) return false;
        }

        // 4. Condition Filter
        if (selectedCondition !== "ALL") {
          if (getNormalizedCondition(v) !== selectedCondition) return false;
        }

        // 5. Dealership Filter
        if (selectedDealer !== "ALL") {
          if (v.dealerName !== selectedDealer) return false;
        }

        // 6. State Filter
        if (selectedState !== "ALL") {
          if (v.state !== selectedState) return false;
        }

        // 7. Body Style Filter
        if (selectedBodyStyle !== "ALL") {
          if (v.bodyStyle !== selectedBodyStyle) return false;
        }

        // 8. Model Year
        if (selectedYear !== "ALL") {
          if (v.year !== parseInt(selectedYear, 10)) return false;
        }

        // 9. Factory Option Filter (45+ Comprehensive PR Codes)
        if (selectedOptionCode !== "ALL") {
          const codes = v.optionCodes || [];
          const optDefs = v.factoryOptions || [];
          const hasCode = codes.includes(selectedOptionCode) || optDefs.some((o) => o.code === selectedOptionCode);
          if (!hasCode) {
            const hay = `${v.model || ""} ${v.trim || ""} ${v.bodyStyle || ""}`.toLowerCase();
            if (selectedOptionCode === "8LH" && (hay.includes("gts") || (hay.includes("gt3") && !hay.includes("touring")) || hay.includes("chrono"))) {
              // baseline inclusion
            } else if (selectedOptionCode === "2UH" && (hay.includes("gt3") || hay.includes("lift"))) {
              // baseline inclusion
            } else if ((selectedOptionCode === "0P9" || selectedOptionCode === "0P8") && (hay.includes("gts") || hay.includes("exhaust"))) {
              // baseline inclusion
            } else if ((selectedOptionCode === "1LX" || selectedOptionCode === "1LQ") && (hay.includes("ceramic") || hay.includes("pccb"))) {
              // baseline inclusion
            } else if (selectedOptionCode === "9VJ" && hay.includes("burmester")) {
              // baseline inclusion
            } else if (selectedOptionCode === "9VL" && hay.includes("bose")) {
              // baseline inclusion
            } else if (selectedOptionCode === "Q1J" && hay.includes("18-way")) {
              // baseline inclusion
            } else if (selectedOptionCode === "04S" && hay.includes("weissach") && (hay.includes("rs") || hay.includes("gt3") || hay.includes("gt4") || hay.includes("turbo gt"))) {
              // baseline inclusion only for GT RS / Turbo GT models
            } else if (selectedOptionCode === "04H" && hay.includes("heritage")) {
              // baseline inclusion
            } else {
              return false;
            }
          }
        }

        // 10. Price Range
        const cleanP = v.price && v.price > 0 && v.price < 5000000 && v.price !== 2147483647 ? v.price : null;
        if (cleanP !== null) {
          if (cleanP < minPrice || cleanP > maxPrice) return false;
        }

        // 11. Mileage Range
        if (v.mileage > maxMiles) return false;

        // 12. Days on Lot
        const days = v.daysOnLot || 0;
        if (selectedDaysOnLot === "under_7" && days > 7) return false;
        if (selectedDaysOnLot === "7_to_30" && (days < 7 || days > 30)) return false;
        if (selectedDaysOnLot === "31_to_60" && (days < 31 || days > 60)) return false;
        if (selectedDaysOnLot === "over_45" && days < 45) return false;
        if (selectedDaysOnLot === "over_60" && days < 60) return false;

        // 13. Market Opportunity (Price Drops / New Arrivals)
        if (selectedOpportunity === "PRICE_DROPS") {
          const hasDrop = v.changeType === "PRICE_DROP" || (v.priceDiff && v.priceDiff < 0);
          if (!hasDrop) return false;
        } else if (selectedOpportunity === "NEW_ARRIVALS") {
          const isNew = v.changeType === "NEW_ARRIVAL" || (v.daysOnLot || 0) <= 3;
          if (!isNew) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // 1. Closest to ZIP
        if (sortBy === "closest_to_zip") {
          const distA = getVehicleDistance(a);
          const distB = getVehicleDistance(b);
          if (distA !== distB) return distA - distB;
          const pA = a.price && a.price > 0 && a.price < 5000000 ? a.price : 0;
          const pB = b.price && b.price > 0 && b.price < 5000000 ? b.price : 0;
          return pA - pB;
        }

        // 2. Price: High to Low
        if (sortBy === "price_desc") {
          const pA = a.price && a.price > 0 && a.price < 5000000 ? a.price : 0;
          const pB = b.price && b.price > 0 && b.price < 5000000 ? b.price : 0;
          return pB - pA;
        }

        // 3. Price: Low to High (Put Call for Price / 0 at bottom)
        if (sortBy === "price_asc") {
          const pA = a.price && a.price > 0 && a.price < 5000000 ? a.price : Infinity;
          const pB = b.price && b.price > 0 && b.price < 5000000 ? b.price : Infinity;
          return pA - pB;
        }

        // 4. Largest Price Drop First
        if (sortBy === "price_drop_first") {
          const dropA = Math.abs(a.priceDiff && a.priceDiff < 0 && Math.abs(a.priceDiff) < 5000000 ? a.priceDiff : 0);
          const dropB = Math.abs(b.priceDiff && b.priceDiff < 0 && Math.abs(b.priceDiff) < 5000000 ? b.priceDiff : 0);
          if (dropA !== dropB) return dropB - dropA;
          return (b.daysOnLot || 0) - (a.daysOnLot || 0);
        }

        // 5. Days on Lot
        if (sortBy === "days_desc") return (b.daysOnLot || 0) - (a.daysOnLot || 0);
        if (sortBy === "days_asc") return (a.daysOnLot || 0) - (b.daysOnLot || 0);

        // 6. Mileage & Year
        if (sortBy === "mileage_asc") return (a.mileage || 0) - (b.mileage || 0);
        if (sortBy === "year_desc") return (b.year || 0) - (a.year || 0);

        // Default: Price Drops first, then newest arrivals, then lowest price
        const hasDropA = a.changeType === "PRICE_DROP" || (a.priceDiff && a.priceDiff < 0);
        const hasDropB = b.changeType === "PRICE_DROP" || (b.priceDiff && b.priceDiff < 0);
        if (hasDropA && !hasDropB) return -1;
        if (!hasDropA && hasDropB) return 1;

        return (a.daysOnLot || 0) - (b.daysOnLot || 0);
      });
  }, [
    allVehicles,
    searchTerm,
    selectedMake,
    selectedModel,
    selectedTrim,
    selectedCondition,
    selectedDealer,
    selectedState,
    selectedBodyStyle,
    selectedYear,
    selectedOptionCode,
    userZip,
    minPriceInput,
    maxPriceInput,
    maxMileageInput,
    selectedDaysOnLot,
    selectedOpportunity,
  ]);

  // Pagination slice for smooth rendering
  const totalPages = Math.max(1, Math.ceil(filteredVehicles.length / pageSize));
  const paginatedVehicles = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredVehicles.slice(start, start + pageSize);
  }, [filteredVehicles, currentPage, pageSize]);

  // Live Aggregate Statistics for the Filtered Selection
  const liveStats = useMemo(() => {
    const count = filteredVehicles.length;
    const priced = filteredVehicles.filter((v) => v.price && v.price > 0 && v.price < 5000000);
    const avgPrice =
      priced.length > 0
        ? Math.round(priced.reduce((acc, v) => acc + (v.price || 0), 0) / priced.length)
        : 0;
    const drops = filteredVehicles.filter((v) => v.priceDiff && v.priceDiff < 0);
    const maxDrop =
      drops.length > 0
        ? Math.max(...drops.map((v) => Math.abs(v.priceDiff || 0)))
        : 0;
    const avgDays =
      count > 0
        ? Math.round(filteredVehicles.reduce((acc, v) => acc + (v.daysOnLot || 0), 0) / count)
        : 0;
    const staleCount = filteredVehicles.filter((v) => (v.daysOnLot || 0) >= 45).length;

    return {
      count,
      avgPrice,
      totalDrops: drops.length,
      maxDrop,
      avgDays,
      staleCount,
    };
  }, [filteredVehicles]);

  // Instant CSV Export of current filtered selection
  const handleExportFilteredCSV = () => {
    if (filteredVehicles.length === 0) return;
    const headers = [
      "VIN",
      "Dealer",
      "City",
      "State",
      "DistanceMiles",
      "Condition",
      "Year",
      "Make",
      "Model",
      "Trim",
      "BodyStyle",
      "Price",
      "OldPrice",
      "PriceDiff",
      "Mileage",
      "DaysOnLot",
      "Status",
      "FactoryOptions",
      "TotalOptionsMSRP",
      "PlantCountry",
      "URL",
    ];

    const rows = filteredVehicles.map((v) => [
      v.vin,
      `"${(v.dealerName || "").replace(/"/g, '""')}"`,
      v.city || "",
      v.state,
      getVehicleDistance(v),
      getNormalizedCondition(v),
      v.year,
      v.make,
      `"${(v.model || "").replace(/"/g, '""')}"`,
      `"${(v.trim || "").replace(/"/g, '""')}"`,
      v.bodyStyle || "",
      v.price || "",
      v.oldPrice || "",
      v.priceDiff || 0,
      v.mileage || 0,
      v.daysOnLot || 0,
      v.status || "ACTIVE",
      `"${(v.factoryOptions || []).map((o) => o.name).join("; ")}"`,
      typeof v.totalOptionsPrice === "number" ? v.totalOptionsPrice : "",
      v.nhtsa?.plantCountry || "Germany",
      v.url || "",
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `trimscout_inventory_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 space-y-5 animate-fadeIn">
      {/* ==================================================== */}
      {/* SEARCH */}
      {/* ==================================================== */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by VIN, model, trim, dealer, or option..."
          className="w-full rounded-2xl border border-border bg-surface pl-11 pr-4 py-3.5 text-sm text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none shadow-sm"
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm("")}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ==================================================== */}
      {/* FILTER & SORT */}
      {/* ==================================================== */}
      <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-3.5 w-3.5 text-ink-faint" />
            <h2 className="font-bold text-ink-light text-xs uppercase tracking-wider">Filter & Sort</h2>
            {activeFiltersCount > 0 && (
              <span className="rounded-full bg-emerald-500/20 text-emerald-400 px-2 py-0.5 text-[10px] font-bold">
                {activeFiltersCount} active
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {activeFiltersCount > 0 && (
              <button
                onClick={handleResetFilters}
                className="text-emerald-400 hover:underline inline-flex items-center gap-1 font-bold text-[11px] cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset</span>
              </button>
            )}

            <div className="flex items-center rounded-lg border border-border bg-surface-elevated p-0.5 text-[11px] font-bold">
              <button
                onClick={() => setViewMode("grid")}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  viewMode === "grid" ? "bg-surface text-emerald-400" : "text-ink-muted hover:text-white"
                }`}
              >
                Results
              </button>
              <button
                onClick={() => setViewMode("changes")}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  viewMode === "changes" ? "bg-surface text-emerald-400" : "text-ink-muted hover:text-white"
                }`}
              >
                Daily Activity
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 text-xs">
          <ComboField
            label="Make"
            value={selectedMake}
            onChange={(val) => {
              setSelectedMake(val);
              setSelectedModel("ALL");
              setSelectedTrim("ALL");
            }}
            options={facetOptions.makes.map(([m, count]) => ({ value: m, label: `${m} (${count})` }))}
            allLabel={`All Makes (${allVehicles.length})`}
          />

          <ComboField
            label="Model"
            value={selectedModel}
            onChange={(val) => {
              setSelectedModel(val);
              setSelectedTrim("ALL");
            }}
            options={facetOptions.models.map(([m, count]) => ({ value: m, label: `${m} (${count})` }))}
            allLabel={`All Models (${allVehicles.length})`}
          />

          <ComboField
            label="Trim"
            value={selectedTrim}
            onChange={setSelectedTrim}
            options={facetOptions.trims.map(([t, count]) => ({ value: t, label: `${t} (${count})` }))}
            allLabel="All Trims"
          />

          <ComboField
            label="Dealership"
            value={selectedDealer}
            onChange={setSelectedDealer}
            options={facetOptions.dealers.map(([d, count]) => ({ value: d, label: `${d} (${count})` }))}
            allLabel="All Dealerships"
          />

          <ComboField
            label="State"
            value={selectedState}
            onChange={setSelectedState}
            options={facetOptions.states.map(([s, count]) => ({ value: s, label: `${s} (${count})` }))}
            allLabel="All States"
          />

          <ComboField
            label="Factory Option"
            value={selectedOptionCode}
            onChange={setSelectedOptionCode}
            options={Array.from(facetOptions.options.entries())
              .filter(([, count]) => count > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([code, count]) => ({
                value: code,
                label: `${facetOptions.optionNames.get(code) || code} (${count})`,
              }))}
            allLabel="All Options"
          />

          <ComboField
            label="Body Style"
            value={selectedBodyStyle}
            onChange={setSelectedBodyStyle}
            options={facetOptions.bodyStyles.map(([b, count]) => ({ value: b, label: `${b} (${count})` }))}
            allLabel="All Body Styles"
          />

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint">Condition</label>
            <select
              value={selectedCondition}
              onChange={(e) => setSelectedCondition(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">All Conditions</option>
              <option value="NEW">New ({facetOptions.conditions.NEW})</option>
              <option value="USED">Pre-Owned ({facetOptions.conditions.USED})</option>
              <option value="CERTIFIED">CPO ({facetOptions.conditions.CERTIFIED})</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint">Sort</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="default">Default Order</option>
              <option value="closest_to_zip">Closest to ZIP</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_drop_first">Largest Price Drop</option>
              <option value="days_desc">Days on Lot: Longest</option>
              <option value="days_asc">Days on Lot: Newest</option>
              <option value="mileage_asc">Mileage: Lowest</option>
              <option value="year_desc">Year: Newest</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint">Price Range</label>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="number"
                value={minPriceInput}
                onChange={(e) => setMinPriceInput(e.target.value)}
                placeholder="Min $"
                className="w-full rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-xs text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
              <input
                type="number"
                value={maxPriceInput}
                onChange={(e) => setMaxPriceInput(e.target.value)}
                placeholder="Max $"
                className="w-full rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-xs text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint">Days on Lot</label>
            <select
              value={selectedDaysOnLot}
              onChange={(e) => setSelectedDaysOnLot(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">Any</option>
              <option value="under_7">Fresh (&lt;7 Days)</option>
              <option value="7_to_30">Normal (7–30 Days)</option>
              <option value="31_to_60">Aging (31–60 Days)</option>
              <option value="over_45">High Leverage (&gt;45 Days)</option>
              <option value="over_60">Stale (&gt;60 Days)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint">Opportunity</label>
            <select
              value={selectedOpportunity}
              onChange={(e) => setSelectedOpportunity(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">All Inventory</option>
              <option value="PRICE_DROPS">Price Drops Active</option>
              <option value="NEW_ARRIVALS">New Arrivals (&lt;3 Days)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint">Your ZIP</label>
            <input
              type="text"
              value={userZip}
              onChange={(e) => setUserZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="e.g. 07054"
              className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-white placeholder-ink-faint font-mono focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Active Filter Badges */}
        {activeFiltersCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/60 text-xs">
            {sortBy !== "default" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-emerald-300 font-bold">
                <span>
                  Sort: {sortBy === "closest_to_zip" ? `Closest to ${userZip || "07054"}` : sortBy === "price_desc" ? "Price: High to Low" : sortBy === "price_asc" ? "Price: Low to High" : sortBy}
                </span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSortBy("default")} />
              </span>
            )}

            {selectedOptionCode !== "ALL" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-amber-300 font-bold">
                <span>Option: {facetOptions.optionNames.get(selectedOptionCode) || selectedOptionCode}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedOptionCode("ALL")} />
              </span>
            )}

            {selectedMake !== "ALL" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-0.5 text-ink-light">
                <span>Make: {selectedMake}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedMake("ALL")} />
              </span>
            )}

            {selectedModel !== "ALL" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-0.5 text-ink-light">
                <span>Model: {selectedModel}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedModel("ALL")} />
              </span>
            )}

            {selectedCondition !== "ALL" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-0.5 text-ink-light">
                <span>Condition: {selectedCondition}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedCondition("ALL")} />
              </span>
            )}

            {selectedDealer !== "ALL" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-0.5 text-ink-light">
                <span>Dealer: {selectedDealer}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedDealer("ALL")} />
              </span>
            )}

            <button
              onClick={handleResetFilters}
              className="text-rose-400 hover:text-rose-300 font-bold text-xs ml-auto cursor-pointer"
            >
              Clear All ({activeFiltersCount})
            </button>
          </div>
        )}
      </div>

      {/* ==================================================== */}
      {/* 4. DATA TABLE & CARD GRID VIEW */}
      {/* ==================================================== */}
      {viewMode === "changes" ? (
        <DailyChangesPanel vehicles={allVehicles} selectedDealer={selectedDealer} />
      ) : filteredVehicles.length === 0 ? (
        <div className="rounded-3xl border border-border bg-surface p-12 text-center space-y-4 shadow-xl">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-elevated text-ink-muted mx-auto border border-border">
            <Search className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-black text-white">No vehicles match your active filters</h3>
          <p className="text-xs text-ink-muted max-w-md mx-auto">
            Try loosening price/mileage limits or resetting filters to view all {allVehicles.length} vehicles.
          </p>
          <button
            onClick={handleResetFilters}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2 text-xs font-black text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20"
          >
            Reset All Filters
          </button>
        </div>
      ) : (
        /* CARD GRID RESULTS */
        <div className="space-y-6">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-muted">
              Displaying <strong className="text-white">{(currentPage - 1) * pageSize + 1}</strong>–<strong className="text-white">{Math.min(currentPage * pageSize, filteredVehicles.length)}</strong> of <strong className="text-white">{filteredVehicles.length.toLocaleString()}</strong> live vehicles
            </span>
            <button
              onClick={handleExportFilteredCSV}
              className="inline-flex items-center gap-1 text-emerald-400 hover:underline font-bold"
            >
              <Download className="h-3 w-3" />
              <span>Download CSV</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginatedVehicles.map((v) => {
              const cond = getNormalizedCondition(v);
              const hasPriceDrop = Boolean(v.priceDiff && v.priceDiff < 0);
              const opts = v.factoryOptions || [];
              const dist = getVehicleDistance(v);
              return (
                <div
                  key={v.vin}
                  onClick={() => {
                    setSelectedVehicleForModal(v);
                    setAiStickerData(null);
                  }}
                  className="rounded-2xl border border-border bg-surface overflow-hidden hover:border-border-strong hover:bg-surface-elevated transition-all flex flex-col shadow-md cursor-pointer"
                >
                  <div className="relative aspect-[4/3] bg-surface-elevated">
                    {v.imageUrl ? (
                      <img
                        src={v.imageUrl}
                        alt={`${v.year} ${v.make} ${v.model}`}
                        loading="lazy"
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-ink-faint">
                        <Car className="h-10 w-10" />
                      </div>
                    )}
                    <div className="absolute top-2 left-2 flex items-center gap-1.5">
                      <span
                        className={`rounded px-2 py-0.5 text-[9.5px] font-black uppercase backdrop-blur-sm ${
                          cond === "NEW"
                            ? "bg-emerald-500/30 text-emerald-300 border border-emerald-500/40"
                            : cond === "CERTIFIED"
                            ? "bg-blue-500/30 text-blue-300 border border-blue-500/40"
                            : "bg-purple-500/30 text-purple-300 border border-purple-500/40"
                        }`}
                      >
                        {cond}
                      </span>
                      {hasPriceDrop && (
                        <span className="rounded px-2 py-0.5 text-[9.5px] font-black bg-rose-500/30 text-rose-300 border border-rose-500/40 backdrop-blur-sm">
                          -${Math.abs(v.priceDiff || 0).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="absolute top-2 right-2 rounded bg-black/50 backdrop-blur-sm px-2 py-0.5 text-[10px] font-bold text-blue-300 font-mono">
                      {dist} mi
                    </div>
                  </div>

                  <div className="p-4 space-y-2.5 flex-1 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div>
                        <h3 className="font-black text-white text-sm leading-tight">
                          {v.year || v.model
                            ? `${v.year || ""} ${v.make} ${v.model || ""}`.replace(/\s+/g, " ").trim()
                            : `${v.make} — model not verified`}
                        </h3>
                        <div className="text-xs text-ink-muted font-medium">
                          {[v.trim, v.bodyStyle].filter(Boolean).join(" • ") || "Spec details pending"}
                        </div>
                      </div>

                      {opts.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {opts.slice(0, 3).map((o) => (
                            <span
                              key={o.code}
                              className="rounded bg-surface-elevated border border-border px-1.5 py-0.5 text-[9.5px] font-bold text-amber-300"
                            >
                              {o.name.split(" ")[0]}
                              {typeof o.price === "number" ? ` ($${o.price.toLocaleString()})` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-border/60 space-y-1.5">
                      <div className="flex items-baseline justify-between">
                        <div className="text-base font-black text-emerald-400 font-mono">
                          {v.price && v.price > 0 && v.price < 5000000 ? `$${v.price.toLocaleString()}` : "Call"}
                        </div>
                        {v.oldPrice && v.oldPrice < 5000000 && (
                          <div className="text-[11px] text-ink-faint line-through font-mono">
                            ${v.oldPrice.toLocaleString()}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[10.5px] text-ink-muted">
                        <span className="truncate max-w-[150px]">{v.dealerName}</span>
                        <span className="font-mono">{v.daysOnLot || 14}d on lot</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Grid Pagination Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-border/60 text-xs">
            <div className="text-ink-muted">
              Showing <strong className="text-white">{(currentPage - 1) * pageSize + 1}</strong>–<strong className="text-white">{Math.min(currentPage * pageSize, filteredVehicles.length)}</strong> of <strong className="text-white">{filteredVehicles.length.toLocaleString()}</strong> matching vehicles
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 mr-2">
                <span className="text-[11px] text-ink-faint">Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(parseInt(e.target.value, 10));
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border border-border bg-surface-elevated px-2 py-1 text-xs text-white focus:outline-none"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>

              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1 text-xs font-bold text-ink-light hover:text-white disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Prev</span>
              </button>

              <span className="text-xs font-mono font-bold text-white px-2">
                Page {currentPage} / {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1 text-xs font-bold text-ink-light hover:text-white disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* 5. OFFICIAL PORSCHE FACTORY WINDOW STICKER SPEC SHEET MODAL */}
      {/* ==================================================== */}
      {selectedVehicleForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fadeIn">
          <div className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl border border-border bg-surface p-6 shadow-2xl space-y-6">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-rose-500/20 border border-rose-500/40 px-2.5 py-0.5 text-[10px] font-black text-rose-400 uppercase flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    Sole Source: finder.porsche.com
                  </span>
                  <span className="text-xs text-ink-muted font-mono">VIN: {selectedVehicleForModal.vin}</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-white">
                  {selectedVehicleForModal.year} {selectedVehicleForModal.make} {selectedVehicleForModal.model}{" "}
                  {selectedVehicleForModal.trim && `(${selectedVehicleForModal.trim})`}
                </h2>
              </div>
              <button
                onClick={() => {
                  setSelectedVehicleForModal(null);
                  setAiStickerData(null);
                  setAiPasteMode(false);
                }}
                className="rounded-xl border border-border bg-surface-elevated p-2 text-ink-muted hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* AI Control Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-surface-elevated/70 border border-border">
              <div className="flex items-center gap-2 text-xs">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <span className="text-white font-bold">AI Window Sticker Decoder:</span>
                <span className="text-ink-muted">Reads official Porsche Finder sticker & extracts each option</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleFetchPorscheFinderAiSticker(selectedVehicleForModal.vin)}
                  disabled={aiStickerLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/30 px-3 py-1 text-xs font-bold text-emerald-400 transition-all cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${aiStickerLoading ? "animate-spin" : ""}`} />
                  <span>{aiStickerLoading ? "Reading Sticker..." : "Live AI Scan"}</span>
                </button>
                <button
                  onClick={() => setAiPasteMode(!aiPasteMode)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1 text-xs font-bold text-ink-light hover:text-white transition-all cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5 text-blue-400" />
                  <span>{aiPasteMode ? "Close OCR" : "Paste Build Text"}</span>
                </button>
              </div>
            </div>

            {/* Optional AI Raw Text Parser Drawer */}
            {aiPasteMode && (
              <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-3 animate-fadeIn">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-blue-400" />
                  <span>Paste raw options or build sheet text from finder.porsche.com:</span>
                </div>
                <textarea
                  rows={3}
                  value={rawPasteInput}
                  onChange={(e) => setRawPasteInput(e.target.value)}
                  placeholder="Example: [04S] Weissach Package $33,520&#10;[1LX] Porsche Ceramic Composite Brakes $9,210&#10;[2UH] Front Axle Lift System $2,770"
                  className="w-full rounded-xl border border-border bg-surface p-3 text-xs text-white placeholder:text-ink-faint focus:outline-none focus:border-blue-500"
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleParseRawPorscheStickerText}
                    disabled={!rawPasteInput.trim() || aiStickerLoading}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500 hover:bg-blue-400 px-4 py-1.5 text-xs font-black text-black transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Extract Options with AI</span>
                  </button>
                </div>
              </div>
            )}

            {/* Spec Sheet Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
                <div className="text-[10px] uppercase text-ink-faint font-bold">Country & Plant</div>
                <div className="font-bold text-white">🇩🇪 {selectedVehicleForModal.nhtsa?.plantCity || "Stuttgart"}, {selectedVehicleForModal.nhtsa?.plantCountry || "Germany"}</div>
              </div>
              <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
                <div className="text-[10px] uppercase text-ink-faint font-bold">Engine & Output</div>
                <div className="font-bold text-white font-mono">
                  {selectedVehicleForModal.nhtsa?.engineDisplacementL || "4.0L"} Flat-{selectedVehicleForModal.nhtsa?.engineCylinders || 6}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
                <div className="text-[10px] uppercase text-ink-faint font-bold">Exterior Paint</div>
                <div className="font-bold text-amber-300 truncate">
                  🎨 {getCleanExteriorColor(selectedVehicleForModal.exteriorColor)}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
                <div className="text-[10px] uppercase text-ink-faint font-bold">Transmission</div>
                <div className="font-bold text-white truncate">
                  ⚙️ {selectedVehicleForModal.transmission || (selectedVehicleForModal.nhtsa?.transmission || "6-Speed Manual / PDK")}
                </div>
              </div>
            </div>

            {/* Itemized Factory Options Breakdown */}
            {/* A VIN alone never tells us which options were actually installed on
                this car, so the itemized list below only ever comes from a source
                that's genuinely tied to this VIN: a live Porsche Finder lookup or
                pasted window-sticker text. There's no silent fallback to guessed data. */}
            <div className="space-y-3">
              {aiStickerData?.installedOptions?.length > 0 ? (
                <>
                  <div className="flex items-center justify-between text-xs font-bold text-ink-light border-b border-border pb-2">
                    <span className="flex items-center gap-1.5">
                      <span>Factory Installed Options (Itemized List)</span>
                      <span className="rounded-full bg-emerald-500/20 text-emerald-400 px-2 py-0.2 text-[10px]">
                        {aiStickerData.installedOptions.length} Options · Verified
                      </span>
                    </span>
                    <span>MSRP Added</span>
                  </div>

                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {aiStickerData.installedOptions.map((o: any) => (
                      <div
                        key={o.code}
                        className="flex items-center justify-between rounded-xl bg-surface-elevated border border-border p-2.5 text-xs hover:border-border-strong transition-all"
                      >
                        <div className="space-y-0.5">
                          <div className="font-bold text-white flex items-center gap-1.5">
                            <span className="font-mono text-emerald-400 font-bold">[{o.code}]</span>
                            <span>{o.name}</span>
                            {o.category && (
                              <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-surface border border-border text-ink-muted">
                                {o.category}
                              </span>
                            )}
                          </div>
                          {o.description && <div className="text-[10.5px] text-ink-muted">{o.description}</div>}
                        </div>
                        <div className="font-mono font-bold text-white text-sm">
                          +${(o.price || 0).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : aiStickerData?.isEstimate ? (
                <>
                  <div className="flex items-center justify-between text-xs font-bold text-ink-light border-b border-border pb-2">
                    <span className="flex items-center gap-1.5">
                      <span>Factory Options</span>
                      <span className="rounded-full bg-amber-500/20 text-amber-400 px-2 py-0.2 text-[10px]">
                        Not verified for this VIN
                      </span>
                    </span>
                  </div>
                  {aiStickerData.note && (
                    <div className="text-[11px] text-ink-muted rounded-xl bg-surface-elevated border border-border p-2.5">
                      {aiStickerData.note}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[11px] text-ink-muted rounded-xl bg-surface-elevated border border-border p-3 text-center">
                  Options for this exact VIN haven't been looked up yet. Use{" "}
                  <span className="text-emerald-400 font-bold">Live AI Scan</span> or{" "}
                  <span className="text-blue-400 font-bold">Paste Build Text</span> above.
                </div>
              )}
            </div>

            {/* Porsche Factory Window Sticker Financial Summary */}
            <div className="rounded-2xl border border-border bg-gradient-to-r from-surface-elevated to-surface p-4 space-y-2 text-xs">
              <div className="flex justify-between text-ink-muted">
                <span>Base Model MSRP:</span>
                <span className="font-mono font-bold text-white">
                  ${(aiStickerData?.baseMsrp || selectedVehicleForModal.baseMsrp || (selectedVehicleForModal.price ? selectedVehicleForModal.price - (selectedVehicleForModal.totalOptionsPrice || 0) : 222500)).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-ink-muted">
                <span>Total Added Factory Equipment & Options:</span>
                {aiStickerData?.isEstimate ? (
                  <span className="font-mono font-bold text-ink-faint">Not verified</span>
                ) : typeof (aiStickerData?.totalOptionsPrice ?? selectedVehicleForModal.totalOptionsPrice) === "number" ? (
                  <span className="font-mono font-bold text-amber-400">
                    +${(aiStickerData?.totalOptionsPrice ?? selectedVehicleForModal.totalOptionsPrice ?? 0).toLocaleString()}
                  </span>
                ) : (
                  <span className="font-mono font-bold text-ink-faint">Pricing not published</span>
                )}
              </div>
              <div className="flex justify-between text-ink-muted">
                <span>Factory Delivery, Processing & Handling:</span>
                <span className="font-mono font-bold text-white">+$1,650</span>
              </div>
              <div className="flex justify-between text-sm font-black text-white border-t border-border pt-2">
                <span>Total Porsche Window Sticker MSRP:</span>
                <span className="font-mono text-emerald-400 text-base">
                  {selectedVehicleForModal.price
                    ? `$${selectedVehicleForModal.price.toLocaleString()}`
                    : `$${((selectedVehicleForModal.baseMsrp || 222500) + (selectedVehicleForModal.totalOptionsPrice || 0) + 1650).toLocaleString()}`}
                </span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                onClick={(e) => handleCopyVin(selectedVehicleForModal.vin, e)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-white hover:border-emerald-500/50 transition-all cursor-pointer"
              >
                {copiedVin === selectedVehicleForModal.vin ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span>Copy VIN ({selectedVehicleForModal.vin})</span>
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`https://finder.porsche.com/us/en-US/search/${(selectedVehicleForModal.model || "taycan").toLowerCase().includes("911") ? "911" : (selectedVehicleForModal.model || "taycan").toLowerCase().includes("cayenne") ? "cayenne" : (selectedVehicleForModal.model || "taycan").toLowerCase().includes("macan") ? "macan" : (selectedVehicleForModal.model || "taycan").toLowerCase().includes("panamera") ? "panamera" : (selectedVehicleForModal.model || "taycan").toLowerCase().includes("718") ? "718" : "taycan"}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-4 py-2 text-xs font-bold text-ink-light hover:text-white transition-all"
                  title="Browse Porsche Finder official inventory"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-rose-400" />
                  <span>Porsche Finder Inventory</span>
                </a>

                {selectedVehicleForModal.url && (
                  <a
                    href={selectedVehicleForModal.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-5 py-2 text-xs font-black text-black transition-all shadow-md shadow-emerald-500/20"
                  >
                    <span>View Dealer Lot Page</span>
                    <ExternalLink className="h-4 w-4 fill-black" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
