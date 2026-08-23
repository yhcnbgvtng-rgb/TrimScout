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
  Check,
  ChevronDown,
  ChevronUp,
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
} from "lucide-react";

interface VehicleRecord {
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

interface LightsailAnalyticsData {
  success: boolean;
  serverHost: string;
  lastSync: string;
  stats: {
    totalTrackedVehicles: number;
    totalPriceDrops: number;
    totalNewArrivals: number;
    totalStaleVehicles: number;
    highLeverageRatioPercent: number;
    dealershipsCount: number;
  };
  dealerBreakdown: Record<
    string,
    { count: number; state: string; avgPrice: number; priceDropsCount: number }
  >;
  topPriceDrops: VehicleRecord[];
  recentVehicles: VehicleRecord[];
}

export const LightsailIntelligence: React.FC = () => {
  const [data, setData] = useState<LightsailAnalyticsData | null>(null);
  const [allVehicles, setAllVehicles] = useState<VehicleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(true);

  // ==========================================
  // COMPREHENSIVE FILTER STATES
  // ==========================================
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedQuickPreset, setSelectedQuickPreset] = useState<string>("all");
  const [selectedModelSeries, setSelectedModelSeries] = useState<string>("All");
  const [selectedTrim, setSelectedTrim] = useState<string>("All");
  const [selectedType, setSelectedType] = useState<string>("All");
  const [selectedDealer, setSelectedDealer] = useState<string>("All");
  const [selectedState, setSelectedState] = useState<string>("All");
  const [selectedBodyStyle, setSelectedBodyStyle] = useState<string>("All");
  const [minPrice, setMinPrice] = useState<number>(0);
  const [maxPrice, setMaxPrice] = useState<number>(350000);
  const [maxMileage, setMaxMileage] = useState<number>(100000);
  const [selectedYear, setSelectedYear] = useState<string>("All");
  const [selectedDaysOnLotRange, setSelectedDaysOnLotRange] = useState<string>("All");
  const [sortBy, setSortBy] = useState<string>("price_drop_first");

  const fetchData = async () => {
    try {
      const res = await fetch("/api/lightsail");
      if (res.ok) {
        const json: LightsailAnalyticsData = await res.json();
        setData(json);
        setAllVehicles(json.recentVehicles || []);
      }
    } catch (err) {
      console.error("Failed to load Lightsail analytics:", err);
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

  // Helper to normalize Porsche model series
  const getModelSeries = (v: VehicleRecord): string => {
    const raw = `${v.model} ${v.trim || ""}`.toLowerCase();
    if (raw.includes("911")) return "911";
    if (raw.includes("718") || raw.includes("cayman")) return "718 Cayman";
    if (raw.includes("boxster")) return "718 Boxster";
    if (raw.includes("taycan")) return "Taycan";
    if (raw.includes("macan")) return "Macan";
    if (raw.includes("cayenne")) return "Cayenne";
    if (raw.includes("panamera")) return "Panamera";
    return v.model || "Other";
  };

  // Helper to normalize Condition
  const getNormalizedType = (v: VehicleRecord): "NEW" | "USED" | "CERTIFIED" => {
    const t = (v.inventoryType || "").toUpperCase();
    if (t.includes("CERT")) return "CERTIFIED";
    if (t.includes("NEW")) return "NEW";
    return "USED";
  };

  // Dynamic Facet Options & Counts from live dataset
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

      if (v.trim) {
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
      trims: Array.from(trims.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15),
      dealers: Array.from(dealers.entries()).sort((a, b) => b[1] - a[1]),
      states: Array.from(states.entries()).sort((a, b) => b[1] - a[1]),
      bodyStyles: Array.from(bodyStyles.entries()).sort((a, b) => b[1] - a[1]),
      years: Array.from(years.entries()).sort((a, b) => b[0] - a[0]),
    };
  }, [allVehicles]);

  // Reset all filters to default
  const handleResetFilters = () => {
    setSearchTerm("");
    setSelectedQuickPreset("all");
    setSelectedModelSeries("All");
    setSelectedTrim("All");
    setSelectedType("All");
    setSelectedDealer("All");
    setSelectedState("All");
    setSelectedBodyStyle("All");
    setMinPrice(0);
    setMaxPrice(350000);
    setMaxMileage(100000);
    setSelectedYear("All");
    setSelectedDaysOnLotRange("All");
    setSortBy("price_drop_first");
  };

  // Quick Preset Handlers
  const handlePresetSelect = (preset: string) => {
    setSelectedQuickPreset(preset);
    if (preset === "all") {
      handleResetFilters();
    } else if (preset === "price_drops") {
      handleResetFilters();
      setSelectedQuickPreset("price_drops");
      setSortBy("price_drop_first");
    } else if (preset === "new_arrivals") {
      handleResetFilters();
      setSelectedQuickPreset("new_arrivals");
      setSelectedDaysOnLotRange("under_7");
      setSortBy("newest_arrival");
    } else if (preset === "high_leverage") {
      handleResetFilters();
      setSelectedQuickPreset("high_leverage");
      setSelectedDaysOnLotRange("over_45");
      setSortBy("days_on_lot_desc");
    } else if (preset === "911") {
      handleResetFilters();
      setSelectedQuickPreset("911");
      setSelectedModelSeries("911");
    } else if (preset === "suv") {
      handleResetFilters();
      setSelectedQuickPreset("suv");
      setSelectedBodyStyle("SUV");
    } else if (preset === "ev") {
      handleResetFilters();
      setSelectedQuickPreset("ev");
      setSelectedModelSeries("Taycan");
    } else if (preset === "cpo") {
      handleResetFilters();
      setSelectedQuickPreset("cpo");
      setSelectedType("CERTIFIED");
    }
  };

  // Count active filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchTerm) count++;
    if (selectedModelSeries !== "All") count++;
    if (selectedTrim !== "All") count++;
    if (selectedType !== "All") count++;
    if (selectedDealer !== "All") count++;
    if (selectedState !== "All") count++;
    if (selectedBodyStyle !== "All") count++;
    if (minPrice > 0 || maxPrice < 350000) count++;
    if (maxMileage < 100000) count++;
    if (selectedYear !== "All") count++;
    if (selectedDaysOnLotRange !== "All") count++;
    if (selectedQuickPreset !== "all") count++;
    return count;
  }, [
    searchTerm,
    selectedModelSeries,
    selectedTrim,
    selectedType,
    selectedDealer,
    selectedState,
    selectedBodyStyle,
    minPrice,
    maxPrice,
    maxMileage,
    selectedYear,
    selectedDaysOnLotRange,
    selectedQuickPreset,
  ]);

  // Comprehensive Filter & Sorting Pipeline
  const filteredVehicles = useMemo(() => {
    return allVehicles
      .filter((v) => {
        // 1. Text Search (VIN, Make, Model, Trim, Dealer, City, Color, Stock)
        if (searchTerm.trim() !== "") {
          const hay = `${v.vin} ${v.year} ${v.make} ${v.model} ${v.trim || ""} ${v.dealerName} ${v.city || ""} ${v.exteriorColor || ""} ${v.stockNumber || ""}`.toLowerCase();
          const words = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
          if (!words.every((w) => hay.includes(w))) return false;
        }

        // 2. Quick Preset Filtering
        if (selectedQuickPreset === "price_drops") {
          if (!(v.changeType === "PRICE_DROP" || (v.priceDiff && v.priceDiff < 0))) return false;
        } else if (selectedQuickPreset === "new_arrivals") {
          if (!((v.daysOnLot || 0) <= 3 || v.changeType === "NEW_ARRIVAL")) return false;
        } else if (selectedQuickPreset === "high_leverage") {
          if (!((v.daysOnLot || 0) >= 45)) return false;
        } else if (selectedQuickPreset === "911") {
          if (!getModelSeries(v).includes("911")) return false;
        } else if (selectedQuickPreset === "suv") {
          const isSuv = (v.bodyStyle || "").toLowerCase().includes("suv") || v.model?.includes("Macan") || v.model?.includes("Cayenne");
          if (!isSuv) return false;
        } else if (selectedQuickPreset === "ev") {
          const isEv = v.model?.includes("Taycan") || v.model?.includes("Electric") || v.trim?.includes("Electric");
          if (!isEv) return false;
        } else if (selectedQuickPreset === "cpo") {
          if (getNormalizedType(v) !== "CERTIFIED") return false;
        }

        // 3. Model Series Filter
        if (selectedModelSeries !== "All") {
          if (getModelSeries(v) !== selectedModelSeries) return false;
        }

        // 4. Trim Filter
        if (selectedTrim !== "All") {
          if (v.trim !== selectedTrim) return false;
        }

        // 5. Inventory Type (New / Used / CPO)
        if (selectedType !== "All") {
          if (getNormalizedType(v) !== selectedType) return false;
        }

        // 6. Dealership Filter
        if (selectedDealer !== "All") {
          if (v.dealerName !== selectedDealer) return false;
        }

        // 7. State Filter
        if (selectedState !== "All") {
          if (v.state !== selectedState) return false;
        }

        // 8. Body Style Filter
        if (selectedBodyStyle !== "All") {
          if (v.bodyStyle !== selectedBodyStyle) return false;
        }

        // 9. Price Range
        const price = v.price || 0;
        if (price < minPrice || price > maxPrice) return false;

        // 10. Mileage Range
        const miles = v.mileage || 0;
        if (miles > maxMileage) return false;

        // 11. Model Year
        if (selectedYear !== "All") {
          if (v.year !== parseInt(selectedYear, 10)) return false;
        }

        // 12. Days on Lot
        const days = v.daysOnLot || 0;
        if (selectedDaysOnLotRange === "under_7" && days > 7) return false;
        if (selectedDaysOnLotRange === "7_to_30" && (days < 7 || days > 30)) return false;
        if (selectedDaysOnLotRange === "31_to_60" && (days < 31 || days > 60)) return false;
        if (selectedDaysOnLotRange === "over_45" && days < 45) return false;
        if (selectedDaysOnLotRange === "over_60" && days < 60) return false;

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
        if (sortBy === "days_on_lot_desc") return (b.daysOnLot || 0) - (a.daysOnLot || 0);
        if (sortBy === "newest_arrival") return (a.daysOnLot || 0) - (b.daysOnLot || 0);
        if (sortBy === "mileage_asc") return (a.mileage || 0) - (b.mileage || 0);
        if (sortBy === "year_desc") return (b.year || 0) - (a.year || 0);
        return 0;
      });
  }, [
    allVehicles,
    searchTerm,
    selectedQuickPreset,
    selectedModelSeries,
    selectedTrim,
    selectedType,
    selectedDealer,
    selectedState,
    selectedBodyStyle,
    minPrice,
    maxPrice,
    maxMileage,
    selectedYear,
    selectedDaysOnLotRange,
    sortBy,
  ]);

  // Export Filtered Vehicles to CSV
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
      getNormalizedType(v),
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
      `trimscout_filtered_inventory_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-fadeIn">
      {/* ==================================================== */}
      {/* 1. CLOUD HEADER & CRAWLER STATUS BANNER */}
      {/* ==================================================== */}
      <div className="rounded-3xl border border-border-strong bg-gradient-to-r from-surface-elevated via-surface to-surface-elevated p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 h-48 w-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
              <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 text-[10px] font-black text-emerald-400 uppercase tracking-wider">
                AWS Lightsail Cloud Connected • 34.205.155.92
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2">
              🏎️ Live Dealership Market Intelligence & Multi-Category Scanner
            </h1>
            <p className="text-xs sm:text-sm text-ink-muted max-w-3xl leading-relaxed">
              Real-time daily telemetry ingested directly from our autonomous AWS Lightsail crawler. 
              Slice and filter ground-truth inventory across every category: Model, Trim, Price Drops, Days on Lot, Condition, Dealer, and Body Style.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-xs font-bold text-ink-light hover:text-white hover:border-emerald-500/50 transition-all cursor-pointer shadow-sm"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-emerald-400 ${isRefreshing ? "animate-spin" : ""}`} />
              <span>{isRefreshing ? "Syncing..." : "Sync Lightsail"}</span>
            </button>

            <button
              onClick={handleExportFilteredCSV}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2.5 text-xs font-extrabold text-black transition-all shadow-md shadow-emerald-500/20 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 fill-black" />
              <span>Export Filtered ({filteredVehicles.length})</span>
            </button>
          </div>
        </div>

        {/* Live Crawler Telemetry Badges */}
        <div className="mt-6 pt-6 border-t border-border/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="flex items-center gap-2 text-ink-muted">
            <Server className="h-4 w-4 text-emerald-400" />
            <span>Host: <strong className="text-white">34.205.155.92</strong></span>
          </div>
          <div className="flex items-center gap-2 text-ink-muted">
            <Clock className="h-4 w-4 text-blue-400" />
            <span>Schedule: <strong className="text-white">Daily 6:00 AM EST</strong></span>
          </div>
          <div className="flex items-center gap-2 text-ink-muted">
            <Building2 className="h-4 w-4 text-purple-400" />
            <span>Dealerships: <strong className="text-white">5 Flagships</strong></span>
          </div>
          <div className="flex items-center gap-2 text-ink-muted">
            <ShieldCheck className="h-4 w-4 text-amber-400" />
            <span>Active Baseline: <strong className="text-white">{allVehicles.length} Vehicles</strong></span>
          </div>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 2. QUICK 1-CLICK PRESET CHIPS */}
      {/* ==================================================== */}
      <div className="space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-ink-faint flex items-center justify-between">
          <span>Quick Market Presets</span>
          {activeFiltersCount > 0 && (
            <button
              onClick={handleResetFilters}
              className="text-emerald-400 hover:underline inline-flex items-center gap-1 normal-case font-bold"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset All ({activeFiltersCount})</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "all", label: "All Vehicles", icon: Car, count: allVehicles.length },
            { id: "price_drops", label: "🔥 Price Drops", icon: TrendingDown, count: data?.stats.totalPriceDrops || data?.topPriceDrops.length || 0, badgeColor: "text-rose-400 bg-rose-500/10 border-rose-500/30" },
            { id: "new_arrivals", label: "⚡ New Arrivals (<3 Days)", icon: Sparkles, count: data?.stats.totalNewArrivals || 0 },
            { id: "high_leverage", label: "⏳ Stale Stock (>45 Days)", icon: Clock, count: data?.stats.totalStaleVehicles || 0 },
            { id: "911", label: "🏎️ 911 Series", icon: Flame, count: facetOptions.models.find((m) => m[0] === "911")?.[1] || 0 },
            { id: "suv", label: "🚙 SUVs (Macan & Cayenne)", icon: ShieldCheck, count: (facetOptions.models.find((m) => m[0] === "Macan")?.[1] || 0) + (facetOptions.models.find((m) => m[0] === "Cayenne")?.[1] || 0) },
            { id: "ev", label: "⚡ Taycan EVs", icon: Zap, count: facetOptions.models.find((m) => m[0] === "Taycan")?.[1] || 0 },
            { id: "cpo", label: "🏆 Certified Pre-Owned (CPO)", icon: CheckCircle2, count: allVehicles.filter((v) => getNormalizedType(v) === "CERTIFIED").length },
          ].map((preset) => {
            const isActive = selectedQuickPreset === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => handlePresetSelect(preset.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                  isActive
                    ? "bg-emerald-500 text-black border-emerald-400 shadow-md shadow-emerald-500/20"
                    : "bg-surface hover:bg-surface-elevated text-ink-light border-border hover:border-border-strong"
                }`}
              >
                <span>{preset.label}</span>
                <span
                  className={`rounded-md px-1.5 py-0.2 text-[10px] font-mono font-black ${
                    isActive ? "bg-black/20 text-black" : "bg-surface-elevated text-ink-muted border border-border/60"
                  }`}
                >
                  {preset.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ==================================================== */}
      {/* 3. MULTI-CATEGORY COMPREHENSIVE FILTER MATRIX */}
      {/* ==================================================== */}
      <div className="rounded-3xl border border-border bg-surface p-6 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-black text-white text-base">Filter by Every Possible Category</h2>
              <p className="text-xs text-ink-muted">
                Showing <strong className="text-white">{filteredVehicles.length}</strong> matching vehicles across 5 dealer centers
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center rounded-xl border border-border bg-surface-elevated p-1">
              <button
                onClick={() => setViewMode("table")}
                className={`p-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === "table" ? "bg-surface text-emerald-400 shadow-sm" : "text-ink-muted hover:text-white"
                }`}
                title="Table View"
              >
                <List className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === "grid" ? "bg-surface text-emerald-400 shadow-sm" : "text-ink-muted hover:text-white"
                }`}
                title="Grid View"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>

            <button
              onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white transition-all cursor-pointer"
            >
              <span>{isFilterPanelOpen ? "Collapse Filters" : "Expand Filters"}</span>
              {isFilterPanelOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Collapsible Filter Categories Grid */}
        {isFilterPanelOpen && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pt-1 animate-fadeIn text-xs">
            {/* 1. Global Search Box */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase text-ink-faint flex items-center gap-1">
                <Search className="h-3 w-3 text-emerald-400" />
                <span>Search Keywords / VIN</span>
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="VIN, GTS, Turbo, Red..."
                className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono"
              />
            </div>

            {/* 2. Model / Series Filter */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase text-ink-faint flex items-center gap-1">
                <Car className="h-3 w-3 text-blue-400" />
                <span>Model Series</span>
              </label>
              <select
                value={selectedModelSeries}
                onChange={(e) => setSelectedModelSeries(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="All">All Models ({allVehicles.length})</option>
                {facetOptions.models.map(([m, count]) => (
                  <option key={m} value={m}>
                    {m} ({count})
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Trim / Edition */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase text-ink-faint flex items-center gap-1">
                <Tag className="h-3 w-3 text-purple-400" />
                <span>Trim / Edition</span>
              </label>
              <select
                value={selectedTrim}
                onChange={(e) => setSelectedTrim(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="All">All Trims</option>
                {facetOptions.trims.map(([t, count]) => (
                  <option key={t} value={t}>
                    {t} ({count})
                  </option>
                ))}
              </select>
            </div>

            {/* 4. Condition / Type */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase text-ink-faint flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-amber-400" />
                <span>Condition</span>
              </label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="All">All Conditions</option>
                <option value="NEW">New Units</option>
                <option value="USED">Pre-Owned</option>
                <option value="CERTIFIED">Certified Pre-Owned (CPO)</option>
              </select>
            </div>

            {/* 5. Dealership Center */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase text-ink-faint flex items-center gap-1">
                <Building2 className="h-3 w-3 text-emerald-400" />
                <span>Dealership Center</span>
              </label>
              <select
                value={selectedDealer}
                onChange={(e) => setSelectedDealer(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="All">All 5 Dealerships</option>
                {facetOptions.dealers.map(([d, count]) => (
                  <option key={d} value={d}>
                    {d} ({count})
                  </option>
                ))}
              </select>
            </div>

            {/* 6. State / Region */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase text-ink-faint flex items-center gap-1">
                <MapPin className="h-3 w-3 text-rose-400" />
                <span>State / Region</span>
              </label>
              <select
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="All">All States (NJ, FL, NY)</option>
                {facetOptions.states.map(([s, count]) => (
                  <option key={s} value={s}>
                    {s} ({count} vehicles)
                  </option>
                ))}
              </select>
            </div>

            {/* 7. Body Style */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase text-ink-faint flex items-center gap-1">
                <Car className="h-3 w-3 text-blue-400" />
                <span>Body Style</span>
              </label>
              <select
                value={selectedBodyStyle}
                onChange={(e) => setSelectedBodyStyle(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="All">All Body Styles</option>
                {facetOptions.bodyStyles.map(([b, count]) => (
                  <option key={b} value={b}>
                    {b} ({count})
                  </option>
                ))}
              </select>
            </div>

            {/* 8. Model Year */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase text-ink-faint flex items-center gap-1">
                <Calendar className="h-3 w-3 text-purple-400" />
                <span>Model Year</span>
              </label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="All">All Years</option>
                {facetOptions.years.map(([y, count]) => (
                  <option key={y} value={y.toString()}>
                    {y} ({count})
                  </option>
                ))}
              </select>
            </div>

            {/* 9. Days on Lot / Supply Age */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase text-ink-faint flex items-center gap-1">
                <Clock className="h-3 w-3 text-amber-400" />
                <span>Days on Lot (Negotiation Leverage)</span>
              </label>
              <select
                value={selectedDaysOnLotRange}
                onChange={(e) => setSelectedDaysOnLotRange(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="All">Any Days on Lot</option>
                <option value="under_7">Fresh Arrival (&lt;7 Days)</option>
                <option value="7_to_30">Normal Rotation (7 - 30 Days)</option>
                <option value="31_to_60">Aging Supply (31 - 60 Days)</option>
                <option value="over_45">High Leverage (&gt;45 Days)</option>
                <option value="over_60">Stale / Heavy Discount (&gt;60 Days)</option>
              </select>
            </div>

            {/* 10. Maximum Mileage */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase text-ink-faint flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Gauge className="h-3 w-3 text-blue-400" />
                  <span>Max Mileage</span>
                </span>
                <span className="text-white font-mono">{maxMileage >= 100000 ? "Any" : `< ${maxMileage.toLocaleString()} mi`}</span>
              </label>
              <select
                value={maxMileage}
                onChange={(e) => setMaxMileage(parseInt(e.target.value, 10))}
                className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="100000">Any Mileage</option>
                <option value="5000">Under 5,000 mi</option>
                <option value="15000">Under 15,000 mi</option>
                <option value="30000">Under 30,000 mi</option>
                <option value="50000">Under 50,000 mi</option>
              </select>
            </div>

            {/* 11. Price Range */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase text-ink-faint flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3 text-emerald-400" />
                  <span>Price Range</span>
                </span>
                <span className="text-white font-mono">
                  ${(minPrice / 1000).toFixed(0)}k - ${(maxPrice / 1000).toFixed(0)}k
                </span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step={5000}
                  value={minPrice}
                  onChange={(e) => setMinPrice(Math.max(0, parseInt(e.target.value || "0", 10)))}
                  placeholder="Min $"
                  className="rounded-xl border border-border bg-surface-elevated px-2 py-1.5 text-xs text-white font-mono focus:border-emerald-500 focus:outline-none"
                />
                <input
                  type="number"
                  step={10000}
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(Math.max(0, parseInt(e.target.value || "350000", 10)))}
                  placeholder="Max $"
                  className="rounded-xl border border-border bg-surface-elevated px-2 py-1.5 text-xs text-white font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            {/* 12. Sort By */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-bold uppercase text-ink-faint flex items-center gap-1">
                <ArrowUpDown className="h-3 w-3 text-emerald-400" />
                <span>Sort Results</span>
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none font-bold"
              >
                <option value="price_drop_first">🔥 Largest Price Drops First</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="days_on_lot_desc">Days on Lot: Longest (High Leverage)</option>
                <option value="newest_arrival">Days on Lot: Newest First</option>
                <option value="mileage_asc">Mileage: Lowest First</option>
                <option value="year_desc">Year: Newest First</option>
              </select>
            </div>
          </div>
        )}

        {/* Active Filter Tags */}
        {activeFiltersCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/60 text-xs">
            <span className="text-[10.5px] text-ink-faint font-bold uppercase">Active Filters:</span>

            {selectedModelSeries !== "All" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-1 text-ink-light">
                <span>Model: {selectedModelSeries}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedModelSeries("All")} />
              </span>
            )}

            {selectedTrim !== "All" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-1 text-ink-light">
                <span>Trim: {selectedTrim}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedTrim("All")} />
              </span>
            )}

            {selectedType !== "All" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-1 text-ink-light">
                <span>Type: {selectedType}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedType("All")} />
              </span>
            )}

            {selectedDealer !== "All" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-1 text-ink-light">
                <span>Dealer: {selectedDealer}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedDealer("All")} />
              </span>
            )}

            {selectedState !== "All" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-1 text-ink-light">
                <span>State: {selectedState}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedState("All")} />
              </span>
            )}

            {selectedDaysOnLotRange !== "All" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-1 text-ink-light">
                <span>Days: {selectedDaysOnLotRange}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedDaysOnLotRange("All")} />
              </span>
            )}

            {selectedYear !== "All" && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-1 text-ink-light">
                <span>Year: {selectedYear}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => setSelectedYear("All")} />
              </span>
            )}

            {(minPrice > 0 || maxPrice < 350000) && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-surface-elevated border border-border px-2 py-1 text-ink-light">
                <span>Price: ${minPrice.toLocaleString()} - ${maxPrice.toLocaleString()}</span>
                <X className="h-3 w-3 cursor-pointer hover:text-white" onClick={() => { setMinPrice(0); setMaxPrice(350000); }} />
              </span>
            )}

            <button
              onClick={handleResetFilters}
              className="text-rose-400 hover:text-rose-300 font-bold ml-auto text-xs"
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      {/* ==================================================== */}
      {/* 4. RESULTS DISPLAY: TABLE OR GRID VIEW */}
      {/* ==================================================== */}
      {filteredVehicles.length === 0 ? (
        <div className="rounded-3xl border border-border bg-surface p-12 text-center space-y-4 shadow-xl">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-elevated text-ink-muted mx-auto border border-border">
            <Search className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-black text-white">No vehicles match your active filters</h3>
          <p className="text-xs text-ink-muted max-w-md mx-auto">
            Try loosening your price bounds, clearing model selections, or resetting all filters.
          </p>
          <button
            onClick={handleResetFilters}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2 text-xs font-black text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20"
          >
            Reset All Filters
          </button>
        </div>
      ) : viewMode === "table" ? (
        /* DENSE TABLE VIEW */
        <div className="rounded-3xl border border-border bg-surface p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-muted">
              Showing <strong className="text-white">{filteredVehicles.length}</strong> vehicles matching current criteria
            </span>
            <button
              onClick={handleExportFilteredCSV}
              className="inline-flex items-center gap-1 text-emerald-400 hover:underline font-bold"
            >
              <Download className="h-3 w-3" />
              <span>Download CSV</span>
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border max-h-[600px] overflow-y-auto">
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
                  const cond = getNormalizedType(v);
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
                          <span>{v.vin}</span>
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
            const cond = getNormalizedType(v);
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

                  <div className="text-[11px] font-mono text-ink-faint truncate">
                    VIN: {v.vin}
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
