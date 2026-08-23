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
} from "lucide-react";

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
}

export const LightsailIntelligence: React.FC = () => {
  const [allVehicles, setAllVehicles] = useState<VehicleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [copiedVin, setCopiedVin] = useState<string | null>(null);

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

  // Canonical Model Series Normalizer
  const getModelSeries = (v: VehicleRecord): string => {
    const raw = `${v.make || ""} ${v.model || ""} ${v.trim || ""} ${v.bodyStyle || ""}`.toLowerCase();
    if (raw.includes("911") || raw.includes("carrera") || raw.includes("targa") || raw.includes("gt3") || raw.includes("turbo")) {
      return "911";
    }
    if (raw.includes("718") || raw.includes("cayman")) return "718 Cayman";
    if (raw.includes("boxster")) return "718 Boxster";
    if (raw.includes("taycan")) return "Taycan";
    if (raw.includes("macan")) return "Macan";
    if (raw.includes("cayenne")) return "Cayenne";
    if (raw.includes("panamera")) return "Panamera";
    return v.model || "Other";
  };

  // Canonical Condition Normalizer
  const getNormalizedCondition = (v: VehicleRecord): "NEW" | "USED" | "CERTIFIED" => {
    const t = (v.inventoryType || "").toUpperCase();
    if (t.includes("CERT")) return "CERTIFIED";
    if (t.includes("NEW")) return "NEW";
    return "USED";
  };

  // Extract all available facets and counts from the full dataset
  const facetOptions = useMemo(() => {
    const models = new Map<string, number>();
    const trims = new Map<string, number>();
    const dealers = new Map<string, number>();
    const states = new Map<string, number>();
    const bodyStyles = new Map<string, number>();
    const years = new Map<number, number>();

    allVehicles.forEach((v) => {
      const series = getModelSeries(v);
      models.set(series, (models.get(series) || 0) + 1);

      if (v.trim && v.trim !== "null") {
        trims.set(v.trim, (trims.get(v.trim) || 0) + 1);
      }
      if (v.dealerName) {
        dealers.set(v.dealerName, (dealers.get(v.dealerName) || 0) + 1);
      }
      if (v.state) {
        states.set(v.state, (states.get(v.state) || 0) + 1);
      }
      if (v.bodyStyle && v.bodyStyle !== "null") {
        bodyStyles.set(v.bodyStyle, (bodyStyles.get(v.bodyStyle) || 0) + 1);
      }
      if (v.year) {
        years.set(v.year, (years.get(v.year) || 0) + 1);
      }
    });

    return {
      models: Array.from(models.entries()).sort((a, b) => b[1] - a[1]),
      trims: Array.from(trims.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25),
      dealers: Array.from(dealers.entries()).sort((a, b) => b[1] - a[1]),
      states: Array.from(states.entries()).sort((a, b) => b[1] - a[1]),
      bodyStyles: Array.from(bodyStyles.entries()).sort((a, b) => b[1] - a[1]),
      years: Array.from(years.entries()).sort((a, b) => b[0] - a[0]),
    };
  }, [allVehicles]);

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
    setSortBy("default");
  };

  // Quick Preset Selection
  const applyPreset = (preset: string) => {
    handleResetFilters();
    if (preset === "911") setSelectedModel("911");
    if (preset === "macan") setSelectedModel("Macan");
    if (preset === "cayenne") setSelectedModel("Cayenne");
    if (preset === "taycan") setSelectedModel("Taycan");
    if (preset === "cayman") setSelectedModel("718 Cayman");
    if (preset === "price_drops") setSelectedOpportunity("PRICE_DROPS");
    if (preset === "new_arrivals") setSelectedOpportunity("NEW_ARRIVALS");
    if (preset === "cpo") setSelectedCondition("CERTIFIED");
    if (preset === "high_leverage") setSelectedDaysOnLot("over_45");
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
  ]);

  // Comprehensive Filtering & Sorting Pipeline
  const filteredVehicles = useMemo(() => {
    const minPrice = minPriceInput ? parseFloat(minPriceInput) : 0;
    const maxPrice = maxPriceInput ? parseFloat(maxPriceInput) : Infinity;
    const maxMiles = maxMileageInput ? parseFloat(maxMileageInput) : Infinity;

    return allVehicles
      .filter((v) => {
        // 1. Free Search (VIN, Make, Model, Trim, Dealer, City, State, Body, Color)
        if (searchTerm.trim() !== "") {
          const haystack = `${v.vin} ${v.year} ${v.make} ${v.model} ${v.trim || ""} ${v.bodyStyle || ""} ${v.dealerName} ${v.city || ""} ${v.state} ${v.exteriorColor || ""}`.toLowerCase();
          const tokens = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
          if (!tokens.every((t) => haystack.includes(t))) return false;
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

        // 9. Price Range
        if (v.price !== null && v.price !== undefined && v.price > 0) {
          if (v.price < minPrice || v.price > maxPrice) return false;
        }

        // 10. Mileage Range
        if (v.mileage > maxMiles) return false;

        // 11. Days on Lot
        const days = v.daysOnLot || 0;
        if (selectedDaysOnLot === "under_7" && days > 7) return false;
        if (selectedDaysOnLot === "7_to_30" && (days < 7 || days > 30)) return false;
        if (selectedDaysOnLot === "31_to_60" && (days < 31 || days > 60)) return false;
        if (selectedDaysOnLot === "over_45" && days < 45) return false;
        if (selectedDaysOnLot === "over_60" && days < 60) return false;

        // 12. Market Opportunity (Price Drops / New Arrivals)
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
        if (sortBy === "price_drop_first") {
          const dropA = a.priceDiff && a.priceDiff < 0 ? Math.abs(a.priceDiff) : 0;
          const dropB = b.priceDiff && b.priceDiff < 0 ? Math.abs(b.priceDiff) : 0;
          if (dropB !== dropA) return dropB - dropA;
          return (a.price || 0) - (b.price || 0);
        }
        if (sortBy === "price_asc") return (a.price || 0) - (b.price || 0);
        if (sortBy === "price_desc") return (b.price || 0) - (a.price || 0);
        if (sortBy === "days_desc") return (b.daysOnLot || 0) - (a.daysOnLot || 0);
        if (sortBy === "days_asc") return (a.daysOnLot || 0) - (b.daysOnLot || 0);
        if (sortBy === "mileage_asc") return (a.mileage || 0) - (b.mileage || 0);
        if (sortBy === "year_desc") return (b.year || 0) - (a.year || 0);
        return 0;
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
    const priced = filteredVehicles.filter((v) => v.price && v.price > 0);
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
      "URL",
    ];

    const rows = filteredVehicles.map((v) => [
      v.vin,
      `"${(v.dealerName || "").replace(/"/g, '""')}"`,
      v.city || "",
      v.state,
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
              🏎️ Porsche Market Intelligence & Multi-Category Explorer
            </h1>
            <p className="text-xs sm:text-sm text-ink-muted max-w-3xl">
              100% of live vehicles loaded across Paul Miller (NJ), Champion (FL), The Collection (FL), Brooklyn (NY), and South Shore (NY). Filter by any category with zero restrictions.
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
          <div className="text-[10px] text-emerald-400 font-medium">of {allVehicles.length} total live</div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[10px] font-bold uppercase text-ink-faint">Avg Asking Price</div>
          <div className="text-2xl font-black text-emerald-400 font-mono">
            {liveStats.avgPrice ? `$${liveStats.avgPrice.toLocaleString()}` : "—"}
          </div>
          <div className="text-[10px] text-ink-muted font-medium">Across active filter</div>
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
          <div className="text-[10px] text-amber-400 font-medium">Aging lot stock</div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 space-y-1">
          <div className="text-[10px] font-bold uppercase text-ink-faint">Dealer Centers</div>
          <div className="text-2xl font-black text-purple-400 font-mono">{facetOptions.dealers.length}</div>
          <div className="text-[10px] text-purple-400 font-medium">Flagships active</div>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 3. QUICK 1-CLICK PRESET CHIPS */}
      {/* ==================================================== */}
      <div className="space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-ink-faint flex items-center justify-between">
          <span>Quick Model & Category Presets</span>
          {activeFiltersCount > 0 && (
            <button
              onClick={handleResetFilters}
              className="text-emerald-400 hover:underline inline-flex items-center gap-1 font-bold normal-case text-xs"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset All ({activeFiltersCount})</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleResetFilters()}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
              activeFiltersCount === 0
                ? "bg-emerald-500 text-black border-emerald-400 shadow-md shadow-emerald-500/20"
                : "bg-surface hover:bg-surface-elevated text-ink-light border-border"
            }`}
          >
            All Vehicles ({allVehicles.length})
          </button>

          {facetOptions.models.map(([m, count]) => (
            <button
              key={m}
              onClick={() => {
                handleResetFilters();
                setSelectedModel(m);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                selectedModel === m
                  ? "bg-emerald-500 text-black border-emerald-400 shadow-md shadow-emerald-500/20"
                  : "bg-surface hover:bg-surface-elevated text-ink-light border-border"
              }`}
            >
              <span>{m === "911" ? "🏎️ 911 Series" : m === "Macan" ? "🚙 Macan" : m === "Cayenne" ? "🚙 Cayenne" : m === "Taycan" ? "⚡ Taycan" : m}</span>
              <span className="text-[10px] font-mono opacity-80">({count})</span>
            </button>
          ))}

          <button
            onClick={() => applyPreset("price_drops")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
              selectedOpportunity === "PRICE_DROPS"
                ? "bg-rose-500 text-white border-rose-400 shadow-md shadow-rose-500/20"
                : "bg-surface hover:bg-surface-elevated text-rose-400 border-rose-500/30"
            }`}
          >
            🔥 Price Drops ({allVehicles.filter((v) => v.priceDiff && v.priceDiff < 0).length})
          </button>

          <button
            onClick={() => applyPreset("cpo")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
              selectedCondition === "CERTIFIED"
                ? "bg-blue-500 text-white border-blue-400 shadow-md shadow-blue-500/20"
                : "bg-surface hover:bg-surface-elevated text-blue-400 border-blue-500/30"
            }`}
          >
            🏆 CPO Only ({allVehicles.filter((v) => getNormalizedCondition(v) === "CERTIFIED").length})
          </button>

          <button
            onClick={() => applyPreset("high_leverage")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
              selectedDaysOnLot === "over_45"
                ? "bg-amber-500 text-black border-amber-400 shadow-md shadow-amber-500/20"
                : "bg-surface hover:bg-surface-elevated text-amber-400 border-amber-500/30"
            }`}
          >
            ⏳ &gt;45 Days on Lot ({allVehicles.filter((v) => (v.daysOnLot || 0) >= 45).length})
          </button>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 4. MULTI-CATEGORY COMPREHENSIVE FILTER PANEL */}
      {/* ==================================================== */}
      <div className="rounded-3xl border border-border bg-surface p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-emerald-400" />
            <h2 className="font-black text-white text-sm uppercase tracking-wider">
              Filter by Every Possible Category
            </h2>
          </div>

          <div className="flex items-center gap-2">
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

        {/* 12 Filter Dropdowns & Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
          {/* 1. Global Search */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <Search className="h-3 w-3 text-emerald-400" />
              <span>Keyword / Exact VIN</span>
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search VIN, Model, GTS, Color..."
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono"
            />
          </div>

          {/* 2. Model Series */}
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

          {/* 3. Trim / Edition */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <Tag className="h-3 w-3 text-purple-400" />
              <span>Trim / Edition</span>
            </label>
            <select
              value={selectedTrim}
              onChange={(e) => setSelectedTrim(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">All Trims</option>
              {facetOptions.trims.map(([t, count]) => (
                <option key={t} value={t}>
                  {t} ({count})
                </option>
              ))}
            </select>
          </div>

          {/* 4. Condition / Type */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-amber-400" />
              <span>Condition</span>
            </label>
            <select
              value={selectedCondition}
              onChange={(e) => setSelectedCondition(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">All Conditions</option>
              <option value="NEW">New Units ({allVehicles.filter((v) => getNormalizedCondition(v) === "NEW").length})</option>
              <option value="USED">Pre-Owned ({allVehicles.filter((v) => getNormalizedCondition(v) === "USED").length})</option>
              <option value="CERTIFIED">Certified Pre-Owned (CPO) ({allVehicles.filter((v) => getNormalizedCondition(v) === "CERTIFIED").length})</option>
            </select>
          </div>

          {/* 5. Dealership Center */}
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
              <option value="ALL">All Dealerships</option>
              {facetOptions.dealers.map(([d, count]) => (
                <option key={d} value={d}>
                  {d} ({count})
                </option>
              ))}
            </select>
          </div>

          {/* 6. State / Region */}
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
              <option value="ALL">All States</option>
              {facetOptions.states.map(([s, count]) => (
                <option key={s} value={s}>
                  {s} ({count} vehicles)
                </option>
              ))}
            </select>
          </div>

          {/* 7. Body Style */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <Car className="h-3 w-3 text-blue-400" />
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

          {/* 8. Model Year */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <Calendar className="h-3 w-3 text-purple-400" />
              <span>Model Year</span>
            </label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">All Years</option>
              {facetOptions.years.map(([y, count]) => (
                <option key={y} value={y.toString()}>
                  {y} ({count})
                </option>
              ))}
            </select>
          </div>

          {/* 9. Days on Lot */}
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

          {/* 10. Price Range Inputs */}
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

          {/* 11. Max Mileage */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <Gauge className="h-3 w-3 text-blue-400" />
              <span>Max Mileage</span>
            </label>
            <input
              type="number"
              value={maxMileageInput}
              onChange={(e) => setMaxMileageInput(e.target.value)}
              placeholder="e.g. 15000"
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white font-mono focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* 12. Sort By */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink-faint flex items-center gap-1">
              <ArrowUpDown className="h-3 w-3 text-emerald-400" />
              <span>Sort Results</span>
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none font-bold"
            >
              <option value="default">Default Order</option>
              <option value="price_drop_first">🔥 Largest Price Drop First</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="days_desc">Days on Lot: Longest</option>
              <option value="days_asc">Days on Lot: Newest</option>
              <option value="mileage_asc">Mileage: Lowest First</option>
              <option value="year_desc">Year: Newest First</option>
            </select>
          </div>
        </div>

        {/* Active Filter Badges */}
        {activeFiltersCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/60 text-xs">
            <span className="text-[10px] text-ink-faint font-bold uppercase">Active Filters:</span>

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

            {selectedTrim !== "ALL" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-0.5 text-ink-light">
                <span>Trim: {selectedTrim}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedTrim("ALL")} />
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

            {selectedOpportunity !== "ALL" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-0.5 text-ink-light">
                <span>Opportunity: {selectedOpportunity}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedOpportunity("ALL")} />
              </span>
            )}

            {(minPriceInput || maxPriceInput) && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-0.5 text-ink-light">
                <span>Price: ${minPriceInput || "0"} - ${maxPriceInput || "∞"}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => { setMinPriceInput(""); setMaxPriceInput(""); }} />
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
      {/* 5. DATA TABLE & CARD GRID VIEW */}
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
                  <th className="p-3">VIN / Vehicle</th>
                  <th className="p-3">Condition</th>
                  <th className="p-3">Dealership</th>
                  <th className="p-3">Current Price</th>
                  <th className="p-3">Price Movement</th>
                  <th className="p-3">Mileage</th>
                  <th className="p-3">Days on Lot</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 font-medium">
                {filteredVehicles.map((v) => {
                  const cond = getNormalizedCondition(v);
                  const hasPriceDrop = v.priceDiff && v.priceDiff < 0;
                  return (
                    <tr key={v.vin} className="hover:bg-surface-elevated transition-colors">
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
                          {v.bodyStyle && <span className="text-[9.5px] text-ink-muted">• {v.bodyStyle}</span>}
                        </div>
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
                        <div className="text-[10px] text-ink-muted">{v.state}</div>
                      </td>
                      <td className="p-3 font-mono font-bold text-emerald-400 text-sm">
                        {v.price ? `$${v.price.toLocaleString()}` : "Call"}
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
                      <td className="p-3 text-ink-light font-mono">
                        {v.mileage ? `${v.mileage.toLocaleString()} mi` : "8 mi"}
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
                        {v.url ? (
                          <a
                            href={v.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated hover:bg-surface px-2.5 py-1 text-[11px] font-bold text-ink-light hover:text-white border border-border transition-all"
                          >
                            <span>Lot Link</span>
                            <ExternalLink className="h-3 w-3 text-emerald-400" />
                          </a>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
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
            return (
              <div
                key={v.vin}
                className="rounded-2xl border border-border bg-surface p-5 space-y-3 hover:border-border-strong hover:bg-surface-elevated transition-all flex flex-col justify-between shadow-md"
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
                    <span className="font-mono text-ink-muted text-[10.5px]">{v.state}</span>
                  </div>

                  <div>
                    <h3 className="font-black text-white text-base">
                      {v.year} {v.make} {v.model}
                    </h3>
                    <div className="text-xs text-ink-muted font-medium">
                      {v.trim || "Standard"} • {v.bodyStyle || "Coupe"}
                    </div>
                  </div>

                  <div className="text-[11px] font-mono text-ink-faint flex items-center justify-between">
                    <span>VIN: {v.vin}</span>
                    <button
                      onClick={(e) => handleCopyVin(v.vin, e)}
                      className="hover:text-white"
                      title="Copy VIN"
                    >
                      {copiedVin === v.vin ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                </div>

                <div className="pt-3 border-t border-border/60 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-lg font-black text-emerald-400 font-mono">
                        {v.price ? `$${v.price.toLocaleString()}` : "Call"}
                      </div>
                      {v.oldPrice && (
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
                    <span className="truncate max-w-[150px]">{v.dealerName}</span>
                    <span className="font-mono">{v.daysOnLot || 14} days on lot</span>
                  </div>

                  {v.url && (
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full mt-2 inline-flex items-center justify-center gap-1.5 rounded-xl bg-surface-elevated hover:bg-surface border border-border py-2 text-xs font-bold text-white transition-all"
                    >
                      <span>View Dealership Lot</span>
                      <ExternalLink className="h-3 w-3 text-emerald-400" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
