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
  PORSCHE_OPTION_CATALOG,
  ENTHUSIAST_HIGHLIGHT_CODES,
  PorscheOption,
  NhtsaSpec,
} from "@/lib/enrichmentEngine";
import { calculateDistanceMiles } from "@/lib/otdCalculator";

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
}

export const LightsailIntelligence: React.FC = () => {
  const [allVehicles, setAllVehicles] = useState<VehicleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [copiedVin, setCopiedVin] = useState<string | null>(null);
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);
  const [selectedVehicleForModal, setSelectedVehicleForModal] = useState<VehicleRecord | null>(null);

  // ==========================================
  // UNCONSTRAINED COMPREHENSIVE FILTER STATES
  // ==========================================
  const [searchTerm, setSearchTerm] = useState("");
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

  // Canonical Model Series Normalizer
  const getModelSeries = (v: VehicleRecord): string => {
    const make = (v.make || "").toLowerCase();
    const model = (v.model || "").toLowerCase();
    const trim = (v.trim || "").toLowerCase();
    const body = (v.bodyStyle || "").toLowerCase();
    const raw = `${make} ${model} ${trim} ${body}`.toLowerCase();

    // Specific Porsche models checked first to avoid false positives with generic trims (e.g. Turbo, GTS)
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
      const haystack = `${v.vin} ${v.year} ${v.make} ${v.model} ${v.trim || ""} ${v.bodyStyle || ""} ${v.dealerName} ${v.city || ""} ${v.state} ${v.exteriorColor || ""} ${optNames}`.toLowerCase();
      const tokens = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
      if (!tokens.every((t) => haystack.includes(t))) return false;
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

    // 9. Factory Option Code
    if (excludeFacet !== "option" && selectedOptionCode !== "ALL") {
      const codes = v.optionCodes || [];
      const optDefs = v.factoryOptions || [];
      const hasCode = codes.includes(selectedOptionCode) || optDefs.some((o) => o.code === selectedOptionCode);
      if (!hasCode) {
        const hay = `${v.model || ""} ${v.trim || ""} ${v.bodyStyle || ""}`.toLowerCase();
        if (selectedOptionCode === "8LH" && (hay.includes("gts") || hay.includes("gt3") || hay.includes("chrono"))) {
        } else if (selectedOptionCode === "2UH" && (hay.includes("gt3") || hay.includes("lift"))) {
        } else if ((selectedOptionCode === "0P9" || selectedOptionCode === "0P8") && (hay.includes("gts") || hay.includes("exhaust"))) {
        } else if ((selectedOptionCode === "1LX" || selectedOptionCode === "1LQ") && (hay.includes("ceramic") || hay.includes("pccb"))) {
        } else if (selectedOptionCode === "9VJ" && hay.includes("burmester")) {
        } else if (selectedOptionCode === "9VL" && hay.includes("bose")) {
        } else if (selectedOptionCode === "Q1J" && hay.includes("18-way")) {
        } else if (selectedOptionCode === "04S" && hay.includes("weissach")) {
        } else if (selectedOptionCode === "04H" && hay.includes("heritage")) {
        } else {
          return false;
        }
      }
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
    const models = new Map<string, number>();
    const conditions = { NEW: 0, USED: 0, CERTIFIED: 0 };
    const dealers = new Map<string, number>();
    const states = new Map<string, number>();
    const bodyStyles = new Map<string, number>();
    const years = new Map<number, number>();
    const options = new Map<string, number>();

    // Initial base collection of all unique facets
    allVehicles.forEach((v) => {
      const s = getModelSeries(v);
      if (!models.has(s)) models.set(s, 0);
      if (v.dealerName && !dealers.has(v.dealerName)) dealers.set(v.dealerName, 0);
      if (v.state && !states.has(v.state)) states.set(v.state, 0);
      if (v.bodyStyle && v.bodyStyle !== "null" && !bodyStyles.has(v.bodyStyle)) bodyStyles.set(v.bodyStyle, 0);
      if (v.year && !years.has(v.year)) years.set(v.year, 0);
    });

    // Populate dynamic intersection counts
    allVehicles.forEach((v) => {
      // 1. Model series counts (given all filters except model)
      if (checkFilterMatch(v, "model")) {
        const s = getModelSeries(v);
        models.set(s, (models.get(s) || 0) + 1);
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

      // 7. Option codes counts (given all filters except option)
      if (checkFilterMatch(v, "option")) {
        const codes = new Set(v.optionCodes || []);
        (v.factoryOptions || []).forEach((o) => codes.add(o.code));
        const hay = `${v.model || ""} ${v.trim || ""} ${v.bodyStyle || ""}`.toLowerCase();
        if (hay.includes("gts") || hay.includes("gt3") || hay.includes("chrono")) codes.add("8LH");
        if (hay.includes("gt3") || hay.includes("lift")) codes.add("2UH");
        if (hay.includes("gts") || hay.includes("exhaust")) { codes.add("0P9"); codes.add("0P8"); }
        if (hay.includes("ceramic") || hay.includes("pccb")) { codes.add("1LX"); codes.add("1LQ"); }
        if (hay.includes("burmester")) codes.add("9VJ");
        if (hay.includes("bose")) codes.add("9VL");
        if (hay.includes("18-way")) codes.add("Q1J");
        if (hay.includes("14-way")) codes.add("Q2J");
        if (hay.includes("bucket")) codes.add("Q4Q");
        if (hay.includes("weissach")) codes.add("04S");
        if (hay.includes("heritage")) codes.add("04H");
        if (hay.includes("ventilated")) codes.add("4D3");
        if (hay.includes("sunroof") || hay.includes("moonroof")) codes.add("3FE");
        if (hay.includes("sportdesign")) codes.add("2D1");

        codes.forEach((c) => {
          options.set(c, (options.get(c) || 0) + 1);
        });
      }
    });

    return {
      models: Array.from(models.entries()).sort((a, b) => b[1] - a[1]),
      conditions,
      dealers: Array.from(dealers.entries()).sort((a, b) => b[1] - a[1]),
      states: Array.from(states.entries()).sort((a, b) => b[1] - a[1]),
      bodyStyles: Array.from(bodyStyles.entries()).sort((a, b) => b[1] - a[1]),
      years: Array.from(years.entries()).sort((a, b) => b[0] - a[0]),
      options,
    };
  }, [
    allVehicles,
    searchTerm,
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
            if (selectedOptionCode === "8LH" && (hay.includes("gts") || hay.includes("gt3") || hay.includes("chrono"))) {
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
            } else if (selectedOptionCode === "04S" && hay.includes("weissach")) {
              // baseline inclusion
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
    sortBy,
  ]);

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
      v.totalOptionsPrice || 0,
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
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-fadeIn">
      {/* ==================================================== */}
      {/* 1. HEADER & CLOUD TELEMETRY BAR */}
      {/* ==================================================== */}
      <div className="rounded-3xl border border-border bg-gradient-to-r from-surface-elevated via-surface to-surface-elevated p-6 shadow-2xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
              <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 text-[10px] font-black text-emerald-400 uppercase tracking-wider">
                Live Cloud Feed • AWS Lightsail 34.205.155.92
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2">
              🏎️ Porsche Market Intelligence & Factory Spec Explorer
            </h1>
            <p className="text-xs sm:text-sm text-ink-muted max-w-3xl">
              Real-time nationwide inventory cross-referenced with <strong>NHTSA Plant Specs</strong> and <strong>OEM Factory Option Sheets</strong> (Sport Chrono, Front Axle Lift, PCCB, Burmester). Sort by proximity to your ZIP or price tiers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-xs font-bold text-ink-light hover:text-white hover:border-emerald-500/50 transition-all cursor-pointer shadow-sm"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-emerald-400 ${isRefreshing ? "animate-spin" : ""}`} />
              <span>{isRefreshing ? "Syncing..." : "Sync Lightsail"}</span>
            </button>

            <button
              onClick={handleExportFilteredCSV}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-extrabold text-black transition-all shadow-md shadow-emerald-500/20 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 fill-black" />
              <span>Export CSV ({filteredVehicles.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 2. REAL-TIME DYNAMIC AGGREGATE KPI CARDS */}
      {/* ==================================================== */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[10px] font-bold uppercase text-ink-faint">Matching Vehicles</div>
          <div className="text-2xl font-black text-white font-mono">{liveStats.count}</div>
          <div className="text-[10px] text-emerald-400 font-medium">of {allVehicles.length} nationwide</div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[10px] font-bold uppercase text-ink-faint">Avg Asking Price</div>
          <div className="text-2xl font-black text-emerald-400 font-mono">
            {liveStats.avgPrice ? `$${liveStats.avgPrice.toLocaleString()}` : "—"}
          </div>
          <div className="text-[10px] text-ink-muted font-medium">Active filter selection</div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[10px] font-bold uppercase text-ink-faint">Price Drops Active</div>
          <div className="text-2xl font-black text-rose-400 font-mono">{liveStats.totalDrops}</div>
          <div className="text-[10px] text-rose-400 font-medium">
            {liveStats.maxDrop ? `Max -$${liveStats.maxDrop.toLocaleString()}` : "0 drops"}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[10px] font-bold uppercase text-ink-faint">Avg Days on Lot</div>
          <div className="text-2xl font-black text-blue-400 font-mono">{liveStats.avgDays}d</div>
          <div className="text-[10px] text-ink-muted font-medium">Showroom age</div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[10px] font-bold uppercase text-ink-faint">High Leverage (&gt;45d)</div>
          <div className="text-2xl font-black text-amber-400 font-mono">{liveStats.staleCount}</div>
          <div className="text-[10px] text-amber-400 font-medium">Aging dealer stock</div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[10px] font-bold uppercase text-ink-faint">Dealer Centers</div>
          <div className="text-2xl font-black text-purple-400 font-mono">{facetOptions.dealers.length}</div>
          <div className="text-[10px] text-purple-400 font-medium">Authorized Centers</div>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 3. MULTI-CATEGORY COMPREHENSIVE FILTER PANEL */}
      {/* ==================================================== */}
      <div className="rounded-3xl border border-border bg-surface p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-emerald-400" />
            <h2 className="font-black text-white text-sm uppercase tracking-wider">
              Filter & Sort Results by Proximity & Spec
            </h2>
            {activeFiltersCount > 0 && (
              <span className="rounded-full bg-emerald-500/20 text-emerald-400 px-2 py-0.2 text-[10px] font-bold">
                {activeFiltersCount} active
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {activeFiltersCount > 0 && (
              <button
                onClick={handleResetFilters}
                className="text-emerald-400 hover:underline inline-flex items-center gap-1 font-bold text-xs cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset Filters</span>
              </button>
            )}

            <div className="flex items-center rounded-xl border border-border bg-surface-elevated p-1">
              <button
                onClick={() => setViewMode("table")}
                className={`p-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === "table" ? "bg-surface text-emerald-400 shadow-sm" : "text-ink-muted hover:text-white"
                }`}
                title="Dense Table View"
              >
                <List className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === "grid" ? "bg-surface text-emerald-400 shadow-sm" : "text-ink-muted hover:text-white"
                }`}
                title="Visual Card Grid View"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Filter Dropdowns & Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
          {/* 1. Global Search */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <Search className="h-3 w-3 text-emerald-400" />
              <span>Keyword / Exact VIN / Option</span>
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search VIN, Chrono, Lift, GTS..."
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono"
            />
          </div>

          {/* 2. Sort Dropdown (Closest to ZIP, Price High to Low, Price Low to High) */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <ArrowUpDown className="h-3 w-3 text-emerald-400" />
              <span>Sort Results</span>
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full rounded-xl border border-emerald-500/40 bg-surface-elevated px-3 py-2 text-xs text-emerald-300 font-bold focus:border-emerald-500 focus:outline-none"
            >
              <option value="default">Default Order</option>
              <option value="closest_to_zip">📍 Closest to ZIP Code</option>
              <option value="price_desc">💰 Price: High to Low</option>
              <option value="price_asc">💵 Price: Low to High</option>
              <option value="price_drop_first">🔥 Largest Price Drop First</option>
              <option value="days_desc">⏳ Days on Lot: Longest</option>
              <option value="days_asc">⚡ Days on Lot: Newest</option>
              <option value="mileage_asc">🚗 Mileage: Lowest First</option>
              <option value="year_desc">📅 Year: Newest First</option>
            </select>
          </div>

          {/* 3. Your ZIP Code Anchor */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <Navigation className="h-3 w-3 text-blue-400" />
              <span>Your ZIP Code (Distance Anchor)</span>
            </label>
            <input
              type="text"
              value={userZip}
              onChange={(e) => setUserZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="e.g. 07054 or 90210"
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white placeholder-ink-faint font-mono focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* 4. Model Series */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <Car className="h-3 w-3 text-blue-400" />
              <span>Model Series</span>
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">All Models ({allVehicles.length})</option>
              {facetOptions.models.map(([m, count]) => (
                <option key={m} value={m}>
                  {m} ({count})
                </option>
              ))}
            </select>
          </div>

          {/* 5. Factory Option Filter */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-amber-400" />
              <span>Factory Option / Package</span>
            </label>
            <select
              value={selectedOptionCode}
              onChange={(e) => setSelectedOptionCode(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none font-bold text-amber-300"
            >
              <option value="ALL">All Factory Builds</option>
              <optgroup label="💎 Equipment Packages">
                <option value="P3R">💎 Premium Package Plus (P3R) ({facetOptions.options.get("P3R") || 0})</option>
                <option value="P3U">🏆 Sport Package (P3U) ({facetOptions.options.get("P3U") || 0})</option>
                <option value="04S">🏁 Weissach Package (04S) ({facetOptions.options.get("04S") || 0})</option>
                <option value="04H">👑 Heritage Design (04H) ({facetOptions.options.get("04H") || 0})</option>
                <option value="P3P">📱 Technology Package (P3P) ({facetOptions.options.get("P3P") || 0})</option>
              </optgroup>
              <optgroup label="🏎️ Performance & Chassis">
                <option value="8LH">⏱️ Sport Chrono Package (8LH) ({facetOptions.options.get("8LH") || 0})</option>
                <option value="2UH">🏎️ Front Axle Lift System (2UH) ({facetOptions.options.get("2UH") || 0})</option>
                <option value="1LX">🛑 PCCB Ceramic Brakes - Black (1LX) ({facetOptions.options.get("1LX") || 0})</option>
                <option value="1LQ">🛑 PCCB Ceramic Brakes - Yellow (1LQ) ({facetOptions.options.get("1LQ") || 0})</option>
                <option value="0P9">🏁 Sport Exhaust System - Black (0P9) ({facetOptions.options.get("0P9") || 0})</option>
                <option value="0P8">🏁 Sport Exhaust System - Silver (0P8) ({facetOptions.options.get("0P8") || 0})</option>
                <option value="0N5">🔄 Rear-Axle Steering (0N5) ({facetOptions.options.get("0N5") || 0})</option>
                <option value="1P7">⚡ PDCC Dynamic Chassis (1P7) ({facetOptions.options.get("1P7") || 0})</option>
                <option value="1BV">📉 PASM Sport Suspension -10mm (1BV) ({facetOptions.options.get("1BV") || 0})</option>
                <option value="GH3">🔀 Torque Vectoring+ (GH3) ({facetOptions.options.get("GH3") || 0})</option>
              </optgroup>
              <optgroup label="🔊 Audio, Tech & Lighting">
                <option value="9VJ">🔊 Burmester® 3D Sound (9VJ) ({facetOptions.options.get("9VJ") || 0})</option>
                <option value="9VL">🎵 BOSE® Surround Sound (9VL) ({facetOptions.options.get("9VL") || 0})</option>
                <option value="KA6">📷 360° Surround View (KA6) ({facetOptions.options.get("KA6") || 0})</option>
                <option value="8JU">💡 HD-Matrix LED Black (8JU) ({facetOptions.options.get("8JU") || 0})</option>
                <option value="8IS">💡 LED Headlights PDLS+ (8IS) ({facetOptions.options.get("8IS") || 0})</option>
                <option value="8T3">🎯 Adaptive Cruise ACC (8T3) ({facetOptions.options.get("8T3") || 0})</option>
                <option value="KS1">📊 Head-Up Display HUD (KS1) ({facetOptions.options.get("KS1") || 0})</option>
                <option value="9R1">🌙 Night Vision Assist (9R1) ({facetOptions.options.get("9R1") || 0})</option>
                <option value="7Y1">👁️ Blind Spot LCA (7Y1) ({facetOptions.options.get("7Y1") || 0})</option>
              </optgroup>
              <optgroup label="💺 Interior & Seating">
                <option value="Q1J">💺 18-Way Adaptive Seats (Q1J) ({facetOptions.options.get("Q1J") || 0})</option>
                <option value="Q2J">💺 14-Way Power Seats (Q2J) ({facetOptions.options.get("Q2J") || 0})</option>
                <option value="Q4Q">🏎️ Carbon Bucket Seats (Q4Q) ({facetOptions.options.get("Q4Q") || 0})</option>
                <option value="4D3">❄️ Ventilated Seats (4D3) ({facetOptions.options.get("4D3") || 0})</option>
                <option value="2PJ">🔥 Heated GT Wheel (2PJ) ({facetOptions.options.get("2PJ") || 0})</option>
                <option value="5TX">✨ Carbon Fiber Trim (5TX) ({facetOptions.options.get("5TX") || 0})</option>
                <option value="FZ1">🔴 Guards Red Belts (FZ1) ({facetOptions.options.get("FZ1") || 0})</option>
                <option value="FZ4">🟡 Racing Yellow Belts (FZ4) ({facetOptions.options.get("FZ4") || 0})</option>
                <option value="3J7">🛡️ Crest on Headrests (3J7) ({facetOptions.options.get("3J7") || 0})</option>
              </optgroup>
              <optgroup label="🎨 Exterior & Styling">
                <option value="3FE">🪟 Glass Sunroof (3FE) ({facetOptions.options.get("3FE") || 0})</option>
                <option value="3FD">🚪 Metal Sunroof (3FD) ({facetOptions.options.get("3FD") || 0})</option>
                <option value="2D1">🎨 SportDesign Package (2D1) ({facetOptions.options.get("2D1") || 0})</option>
                <option value="2D5">🖤 SportDesign in Black (2D5) ({facetOptions.options.get("2D5") || 0})</option>
                <option value="46K">🛞 Carrera Classic Wheels (46K) ({facetOptions.options.get("46K") || 0})</option>
                <option value="46N">🛞 Turbo S Wheels (46N) ({facetOptions.options.get("46N") || 0})</option>
              </optgroup>
            </select>
          </div>

          {/* 6. Condition / Type */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-emerald-400" />
              <span>Condition</span>
            </label>
            <select
              value={selectedCondition}
              onChange={(e) => setSelectedCondition(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">All Conditions</option>
              <option value="NEW">New Units ({facetOptions.conditions.NEW})</option>
              <option value="USED">Pre-Owned ({facetOptions.conditions.USED})</option>
              <option value="CERTIFIED">Certified Pre-Owned (CPO) ({facetOptions.conditions.CERTIFIED})</option>
            </select>
          </div>

          {/* 7. Dealership Center */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <Building2 className="h-3 w-3 text-emerald-400" />
              <span>Dealership Center</span>
            </label>
            <select
              value={selectedDealer}
              onChange={(e) => setSelectedDealer(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">All Dealerships ({facetOptions.dealers.filter(([, count]) => count > 0).length} active matching)</option>
              {facetOptions.dealers.map(([d, count]) => (
                <option key={d} value={d}>
                  {d} ({count})
                </option>
              ))}
            </select>
          </div>

          {/* 8. State / Region */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <MapPin className="h-3 w-3 text-rose-400" />
              <span>State / Region</span>
            </label>
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">All States ({facetOptions.states.filter(([, count]) => count > 0).length} matching)</option>
              {facetOptions.states.map(([s, count]) => (
                <option key={s} value={s}>
                  {s} ({count} vehicles)
                </option>
              ))}
            </select>
          </div>

          {/* 9. Price Range Inputs */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-emerald-400" />
              <span>Price Range ($)</span>
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="number"
                value={minPriceInput}
                onChange={(e) => setMinPriceInput(e.target.value)}
                placeholder="Min $"
                className="w-full rounded-xl border border-border bg-surface-elevated px-2.5 py-2 text-xs text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
              <input
                type="number"
                value={maxPriceInput}
                onChange={(e) => setMaxPriceInput(e.target.value)}
                placeholder="Max $"
                className="w-full rounded-xl border border-border bg-surface-elevated px-2.5 py-2 text-xs text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* 10. Days on Lot */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <Clock className="h-3 w-3 text-amber-400" />
              <span>Days on Lot</span>
            </label>
            <select
              value={selectedDaysOnLot}
              onChange={(e) => setSelectedDaysOnLot(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">Any Days on Lot</option>
              <option value="under_7">Fresh Arrival (&lt;7 Days)</option>
              <option value="7_to_30">Normal (7 - 30 Days)</option>
              <option value="31_to_60">Aging (31 - 60 Days)</option>
              <option value="over_45">High Leverage (&gt;45 Days)</option>
              <option value="over_60">Stale Stock (&gt;60 Days)</option>
            </select>
          </div>

          {/* 11. Market Opportunity */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <Flame className="h-3 w-3 text-rose-400" />
              <span>Market Opportunity</span>
            </label>
            <select
              value={selectedOpportunity}
              onChange={(e) => setSelectedOpportunity(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none font-bold"
            >
              <option value="ALL">All Inventory</option>
              <option value="PRICE_DROPS">🔥 Price Drops Active</option>
              <option value="NEW_ARRIVALS">⚡ New Arrivals (&lt;3 Days)</option>
            </select>
          </div>

          {/* 12. Body Style */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <Car className="h-3 w-3 text-purple-400" />
              <span>Body Style</span>
            </label>
            <select
              value={selectedBodyStyle}
              onChange={(e) => setSelectedBodyStyle(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">All Body Styles</option>
              {facetOptions.bodyStyles.map(([b, count]) => (
                <option key={b} value={b}>
                  {b} ({count})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Active Filter Badges */}
        {activeFiltersCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/60 text-xs">
            <span className="text-[10px] text-ink-faint font-bold uppercase">Active:</span>

            {sortBy !== "default" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-emerald-300 font-bold">
                <span>
                  Sort: {sortBy === "closest_to_zip" ? `📍 Closest to ${userZip || "07054"}` : sortBy === "price_desc" ? "💰 Price: High to Low" : sortBy === "price_asc" ? "💵 Price: Low to High" : sortBy}
                </span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSortBy("default")} />
              </span>
            )}

            {selectedOptionCode !== "ALL" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-amber-300 font-bold">
                <span>Option: {PORSCHE_OPTION_CATALOG[selectedOptionCode]?.name || selectedOptionCode}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedOptionCode("ALL")} />
              </span>
            )}

            {searchTerm && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-0.5 text-ink-light">
                <span>Keyword: &quot;{searchTerm}&quot;</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSearchTerm("")} />
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
              className="text-rose-400 hover:text-rose-300 font-bold text-xs ml-auto"
            >
              Clear All ({activeFiltersCount})
            </button>
          </div>
        )}
      </div>

      {/* ==================================================== */}
      {/* 4. DATA TABLE & CARD GRID VIEW */}
      {/* ==================================================== */}
      {filteredVehicles.length === 0 ? (
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
      ) : viewMode === "table" ? (
        /* DENSE ANALYTICAL TABLE VIEW */
        <div className="rounded-3xl border border-border bg-surface p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-muted">
              Displaying <strong className="text-white">{filteredVehicles.length}</strong> of <strong className="text-white">{allVehicles.length}</strong> live vehicles
            </span>
            <button
              onClick={handleExportFilteredCSV}
              className="inline-flex items-center gap-1 text-emerald-400 hover:underline font-bold"
            >
              <Download className="h-3 w-3" />
              <span>Download CSV</span>
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border max-h-[700px] overflow-y-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-surface-elevated text-ink-faint uppercase font-bold border-b border-border text-[10px]">
                <tr>
                  <th className="p-3">VIN / Model / Origin</th>
                  <th className="p-3">Factory Options</th>
                  <th className="p-3">Condition</th>
                  <th className="p-3">Dealership & Proximity</th>
                  <th className="p-3">Current Price</th>
                  <th className="p-3">Price Movement</th>
                  <th className="p-3">Days on Lot</th>
                  <th className="p-3 text-right">Spec Sheet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 font-medium">
                {filteredVehicles.map((v) => {
                  const cond = getNormalizedCondition(v);
                  const hasPriceDrop = v.priceDiff && v.priceDiff < 0;
                  const opts = v.factoryOptions || [];
                  const dist = getVehicleDistance(v);
                  return (
                    <tr
                      key={v.vin}
                      onClick={() => setSelectedVehicleForModal(v)}
                      className="hover:bg-surface-elevated transition-colors cursor-pointer"
                    >
                      <td className="p-3 space-y-0.5">
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <span>
                            {v.year} {v.make} {v.model}
                          </span>
                          {v.trim && <span className="text-ink-muted font-normal">({v.trim})</span>}
                        </div>
                        <div className="font-mono text-[10.5px] text-ink-faint flex items-center gap-2">
                          <button
                            onClick={(e) => handleCopyVin(v.vin, e)}
                            className="hover:text-white inline-flex items-center gap-1"
                            title="Copy VIN"
                          >
                            <span>{v.vin}</span>
                            {copiedVin === v.vin ? (
                              <Check className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <Copy className="h-3 w-3 text-ink-faint" />
                            )}
                          </button>
                          <span className="text-[9.5px] text-emerald-400/80">🇩🇪 {v.nhtsa?.plantCountry || "Germany"}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        {opts.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {opts.slice(0, 2).map((o) => (
                              <span
                                key={o.code}
                                className="rounded bg-surface-elevated border border-border px-1.5 py-0.5 text-[9.5px] font-bold text-amber-300"
                              >
                                {o.name.split(" ")[0]} ({o.code})
                              </span>
                            ))}
                            {opts.length > 2 && (
                              <span className="text-[9.5px] text-ink-faint">+{opts.length - 2} more</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-ink-faint text-[10px]">Standard Build</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`rounded px-2 py-0.5 text-[9.5px] font-black uppercase ${
                            cond === "NEW"
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : cond === "CERTIFIED"
                              ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                              : "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                          }`}
                        >
                          {cond}
                        </span>
                      </td>
                      <td className="p-3 text-ink-light">
                        <div className="font-semibold text-white truncate max-w-[140px]">{v.dealerName}</div>
                        <div className="text-[10.5px] text-blue-400 font-mono font-bold flex items-center gap-1">
                          <span>📍 {dist} mi away</span>
                          <span className="text-ink-muted">({v.state})</span>
                        </div>
                      </td>
                      <td className="p-3 font-mono font-bold text-emerald-400 text-sm">
                        {v.price && v.price > 0 && v.price < 5000000 ? `$${v.price.toLocaleString()}` : "Call"}
                      </td>
                      <td className="p-3">
                        {hasPriceDrop ? (
                          <span className="rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30 px-2 py-0.5 font-bold font-mono text-[10.5px]">
                            -${Math.abs(v.priceDiff || 0).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-ink-faint text-[10.5px]">Baseline</span>
                        )}
                      </td>
                      <td className="p-3 font-mono">
                        <span
                          className={`font-bold ${
                            (v.daysOnLot || 0) >= 45 ? "text-amber-400" : "text-ink-muted"
                          }`}
                        >
                          {v.daysOnLot || 14}d
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedVehicleForModal(v);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated hover:bg-surface px-2.5 py-1 text-[11px] font-bold text-ink-light hover:text-white border border-border transition-all"
                        >
                          <FileText className="h-3 w-3 text-emerald-400" />
                          <span>Window Sticker</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* VISUAL CARD GRID VIEW */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredVehicles.map((v) => {
            const cond = getNormalizedCondition(v);
            const hasPriceDrop = v.priceDiff && v.priceDiff < 0;
            const opts = v.factoryOptions || [];
            const dist = getVehicleDistance(v);
            return (
              <div
                key={v.vin}
                onClick={() => setSelectedVehicleForModal(v)}
                className="rounded-2xl border border-border bg-surface p-5 space-y-3 hover:border-border-strong hover:bg-surface-elevated transition-all flex flex-col justify-between shadow-md cursor-pointer"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span
                      className={`rounded px-2 py-0.5 text-[9.5px] font-black uppercase ${
                        cond === "NEW"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : cond === "CERTIFIED"
                          ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                          : "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                      }`}
                    >
                      {cond}
                    </span>
                    <span className="font-mono text-blue-400 text-[10.5px] font-bold">📍 {dist} mi away</span>
                  </div>

                  <div>
                    <h3 className="font-black text-white text-base">
                      {v.year} {v.make} {v.model}
                    </h3>
                    <div className="text-xs text-ink-muted font-medium">
                      {v.trim || "Standard"} • {v.bodyStyle || "Coupe"}
                    </div>
                  </div>

                  {opts.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {opts.slice(0, 3).map((o) => (
                        <span
                          key={o.code}
                          className="rounded bg-surface-elevated border border-border px-1.5 py-0.5 text-[9.5px] font-bold text-amber-300"
                        >
                          {o.name.split(" ")[0]} (${o.price.toLocaleString()})
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-border/60 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-lg font-black text-emerald-400 font-mono">
                        {v.price && v.price > 0 && v.price < 5000000 ? `$${v.price.toLocaleString()}` : "Call"}
                      </div>
                      {v.oldPrice && v.oldPrice < 5000000 && (
                        <div className="text-xs text-ink-faint line-through font-mono">
                          ${v.oldPrice.toLocaleString()}
                        </div>
                      )}
                    </div>

                    {hasPriceDrop && (
                      <span className="rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30 px-2 py-0.5 font-bold font-mono text-xs">
                        -${Math.abs(v.priceDiff || 0).toLocaleString()}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-ink-muted pt-1">
                    <span className="truncate max-w-[150px]">{v.dealerName} ({v.state})</span>
                    <span className="font-mono">{v.daysOnLot || 14} days on lot</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ==================================================== */}
      {/* 5. MONRONEY FACTORY WINDOW STICKER SPEC SHEET MODAL */}
      {/* ==================================================== */}
      {selectedVehicleForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-border bg-surface p-6 shadow-2xl space-y-6">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-black text-emerald-400 uppercase">
                    Porsche OEM Monroney Spec Sheet
                  </span>
                  <span className="text-xs text-ink-muted font-mono">VIN: {selectedVehicleForModal.vin}</span>
                </div>
                <h2 className="text-xl font-black text-white">
                  {selectedVehicleForModal.year} {selectedVehicleForModal.make} {selectedVehicleForModal.model}{" "}
                  {selectedVehicleForModal.trim && `(${selectedVehicleForModal.trim})`}
                </h2>
              </div>
              <button
                onClick={() => setSelectedVehicleForModal(null)}
                className="rounded-xl border border-border bg-surface-elevated p-2 text-ink-muted hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Spec Sheet Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
                <div className="text-[10px] uppercase text-ink-faint font-bold">Country of Origin</div>
                <div className="font-bold text-white">🇩🇪 {selectedVehicleForModal.nhtsa?.plantCountry || "Germany"}</div>
              </div>
              <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
                <div className="text-[10px] uppercase text-ink-faint font-bold">Engine & Cylinders</div>
                <div className="font-bold text-white font-mono">
                  {selectedVehicleForModal.nhtsa?.engineDisplacementL || "3.0L"} Boxer-{selectedVehicleForModal.nhtsa?.engineCylinders || 6}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
                <div className="text-[10px] uppercase text-ink-faint font-bold">Proximity</div>
                <div className="font-bold text-blue-400 font-mono">
                  📍 {getVehicleDistance(selectedVehicleForModal)} mi
                </div>
              </div>
              <div className="rounded-xl border border-border bg-surface-elevated p-3 space-y-1">
                <div className="text-[10px] uppercase text-ink-faint font-bold">Body Class</div>
                <div className="font-bold text-white">{selectedVehicleForModal.bodyStyle || selectedVehicleForModal.nhtsa?.bodyClass || "Coupe"}</div>
              </div>
            </div>

            {/* Itemized Factory Options Breakdown */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-ink-light border-b border-border pb-2">
                <span>Installed Factory Option Codes</span>
                <span>MSRP Added</span>
              </div>

              {(selectedVehicleForModal.factoryOptions || []).length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {(selectedVehicleForModal.factoryOptions || []).map((o) => (
                    <div
                      key={o.code}
                      className="flex items-center justify-between rounded-xl bg-surface-elevated border border-border p-2.5 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <span className="font-mono text-emerald-400">[{o.code}]</span>
                          <span>{o.name}</span>
                        </div>
                        {o.description && <div className="text-[10.5px] text-ink-muted">{o.description}</div>}
                      </div>
                      <div className="font-mono font-bold text-white text-sm">
                        +${o.price.toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-surface-elevated p-4 text-center text-xs text-ink-muted">
                  Standard Factory Configuration (Standard Chrono, Sports Exhaust & Active Dampers)
                </div>
              )}
            </div>

            {/* Financial Monroney Price Summary */}
            <div className="rounded-2xl border border-border bg-gradient-to-r from-surface-elevated to-surface p-4 space-y-2 text-xs">
              <div className="flex justify-between text-ink-muted">
                <span>Base MSRP:</span>
                <span className="font-mono font-bold text-white">
                  ${(selectedVehicleForModal.baseMsrp || (selectedVehicleForModal.price ? selectedVehicleForModal.price - (selectedVehicleForModal.totalOptionsPrice || 0) : 120000)).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-ink-muted">
                <span>Total Added Factory Options:</span>
                <span className="font-mono font-bold text-amber-400">
                  +${(selectedVehicleForModal.totalOptionsPrice || 0).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-ink-muted">
                <span>Factory Delivery & Handling:</span>
                <span className="font-mono font-bold text-white">+$1,650</span>
              </div>
              <div className="flex justify-between text-sm font-black text-white border-t border-border pt-2">
                <span>Total Window Sticker MSRP:</span>
                <span className="font-mono text-emerald-400 text-base">
                  {selectedVehicleForModal.price
                    ? `$${selectedVehicleForModal.price.toLocaleString()}`
                    : `$${((selectedVehicleForModal.baseMsrp || 135000) + (selectedVehicleForModal.totalOptionsPrice || 0) + 1650).toLocaleString()}`}
                </span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={(e) => handleCopyVin(selectedVehicleForModal.vin, e)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-white hover:border-emerald-500/50 transition-all cursor-pointer"
              >
                {copiedVin === selectedVehicleForModal.vin ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span>Copy VIN</span>
              </button>

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
      )}
    </div>
  );
};
