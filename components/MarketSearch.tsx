"use client";

import React, { useState, useMemo } from "react";
import { Vehicle } from "../lib/types";
import { formatCurrency, calculateDistanceMiles, getZipCoordinates } from "../lib/otdCalculator";
import { MOCK_POPULAR_PACKAGES } from "../lib/mockData";
import {
  Search,
  MapPin,
  Zap,
  CheckCircle2,
  ChevronDown,
  ArrowRight,
  X,
  Car,
  ExternalLink,
  SlidersHorizontal,
  RotateCcw,
  Check,
  Sparkles,
  ArrowUpDown,
  ArrowLeft,
  Filter
} from "lucide-react";

interface MarketSearchProps {
  vehicles: Vehicle[];
  onSelectForBid: (vehicle: Vehicle) => void;
  onOpenFlexibleWizard: () => void;
}

export const MarketSearch: React.FC<MarketSearchProps> = ({
  vehicles,
  onSelectForBid,
  onOpenFlexibleWizard,
}) => {
  // Navigation State: "landing" (search input hero) vs "results" (visor.vin filter page)
  const [viewState, setViewState] = useState<"landing" | "results">("landing");

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMake, setSelectedMake] = useState<string>("All");
  const [selectedTrims, setSelectedTrims] = useState<string[]>([]);
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [selectedDrivetrains, setSelectedDrivetrains] = useState<string[]>([]);
  const [selectedTransmissions, setSelectedTransmissions] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedBodyTypes, setSelectedBodyTypes] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>("All");
  const [maxPrice, setMaxPrice] = useState<number>(200000);
  const [minPrice, setMinPrice] = useState<number>(0);
  
  // Sorting: distance | price_asc | price_desc | discount_desc | days_on_lot
  const [sortBy, setSortBy] = useState<string>("distance");

  // Mobile Filter Drawer
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [expandedBuildSheet, setExpandedBuildSheet] = useState<string | null>(null);

  // Zip Code & Radius State
  const [zipCode, setZipCode] = useState<string>("94107");
  const [searchRadius, setSearchRadius] = useState<number>(100); // 3000 = Nationwide
  const [isLocationOpen, setIsLocationOpen] = useState<boolean>(false);

  // Auto-detect 5-digit zip in search bar
  const handleSearchInputChange = (val: string) => {
    setSearchQuery(val);
    const trimmed = val.trim();
    if (/^\d{5}$/.test(trimmed)) {
      setZipCode(trimmed);
    }
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setViewState("results");
  };

  const handleQuickSearch = (query: string, make?: string) => {
    setSearchQuery(query);
    if (make) setSelectedMake(make);
    setViewState("results");
  };

  const quickPillSuggestions = [
    { label: "BMW 3 Series", query: "BMW 3 Series", make: "BMW" },
    { label: "Porsche 911", query: "Porsche 911", make: "Porsche" },
    { label: "Toyota Prius Hybrid", query: "Prius", make: "Toyota" },
    { label: "Cadillac Lyriq EV", query: "Lyriq", make: "Cadillac" },
    { label: "Ford Mustang V8", query: "Mustang", make: "Ford" },
    { label: "Tesla Model 3", query: "Tesla", make: "Tesla" },
  ];

  const popularMakes = [
    { name: "BMW", count: "3 Series • 4 Series • M3" },
    { name: "Porsche", count: "911 • Cayman • Taycan" },
    { name: "Toyota", count: "Prius • Supra • RAV4" },
    { name: "Cadillac", count: "Lyriq • CT5-V • Escalade" },
    { name: "Ford", count: "Mustang • Mach-E • F-150" },
    { name: "Tesla", count: "Model 3 • Model Y • Plaid" },
  ];

  const radiusOptions = [
    { label: "25 Miles", value: 25 },
    { label: "50 Miles", value: 50 },
    { label: "100 Miles", value: 100 },
    { label: "250 Miles", value: 250 },
    { label: "500 Miles", value: 500 },
    { label: "Nationwide", value: 3000 },
  ];

  const allMakes = ["All", "BMW", "Porsche", "Toyota", "Cadillac", "Ford", "Tesla"];
  const colorOptions = [
    { label: "Grey", bg: "bg-neutral-500", match: "grey" },
    { label: "Black", bg: "bg-neutral-900 border-neutral-700", match: "black" },
    { label: "Blue", bg: "bg-blue-600", match: "blue" },
    { label: "White", bg: "bg-neutral-100", match: "white" },
    { label: "Red", bg: "bg-red-600", match: "red" },
  ];

  const drivetrainOptions = ["AWD", "RWD", "FWD"];
  const transmissionOptions = ["Automatic", "Manual", "Dual-Clutch"];

  // Dynamic Distance Map for each vehicle relative to active zipCode
  const vehiclesWithDistance = useMemo(() => {
    return vehicles.map((v) => {
      const dist = calculateDistanceMiles(zipCode, v.location);
      return { ...v, dynamicDistance: dist };
    });
  }, [vehicles, zipCode]);

  // Derived available trims based on selected make
  const availableTrims = useMemo(() => {
    const subset = selectedMake === "All" 
      ? vehicles 
      : vehicles.filter(v => v.make === selectedMake);
    const set = new Set<string>();
    subset.forEach(v => set.add(v.trim));
    return Array.from(set);
  }, [vehicles, selectedMake]);

  // Multi-Token Search Matching + Visor.vin Granular Filtering
  const filteredVehicles = useMemo(() => {
    return vehiclesWithDistance.filter((v) => {
      const queryTokens = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const isPureZipQuery = /^\d{5}$/.test(searchQuery.trim());

      const haystack = [
        v.year.toString(),
        v.make.toLowerCase(),
        v.model.toLowerCase(),
        v.trim.toLowerCase(),
        v.bodyType.toLowerCase(),
        v.engine.toLowerCase(),
        v.drivetrain.toLowerCase(),
        v.transmission.toLowerCase(),
        v.exteriorColor.toLowerCase(),
        v.interiorColor.toLowerCase(),
        v.vin.toLowerCase(),
        v.location.dealerName.toLowerCase(),
        v.location.city.toLowerCase(),
        v.location.state.toLowerCase(),
        ...v.packages.map((p) => p.toLowerCase()),
        ...v.options.map((o) => `${o.code.toLowerCase()} ${o.name.toLowerCase()}`),
      ].join(" ");

      const textMatch = isPureZipQuery || queryTokens.length === 0 || queryTokens.every((token) => haystack.includes(token));
      const makeMatch = selectedMake === "All" || v.make === selectedMake;
      const trimMatch = selectedTrims.length === 0 || selectedTrims.includes(v.trim);
      
      const statusMatch =
        selectedStatus === "All" ||
        (selectedStatus === "on_lot" && v.status === "on_lot") ||
        (selectedStatus === "in_transit" && v.status === "in_transit");

      const packageMatch =
        selectedPackages.length === 0 ||
        selectedPackages.every((sp) =>
          v.packages.some((p) => p.toLowerCase().includes(sp.toLowerCase()))
        );

      const drivetrainMatch =
        selectedDrivetrains.length === 0 ||
        selectedDrivetrains.some((dt) => v.drivetrain.toLowerCase().includes(dt.toLowerCase()));

      const transmissionMatch =
        selectedTransmissions.length === 0 ||
        selectedTransmissions.some((tr) => v.transmission.toLowerCase().includes(tr.toLowerCase()));

      const colorMatch =
        selectedColors.length === 0 ||
        selectedColors.some((c) => v.exteriorColor.toLowerCase().includes(c.toLowerCase()));

      const bodyTypeMatch =
        selectedBodyTypes.length === 0 ||
        selectedBodyTypes.includes(v.bodyType);

      const priceMatch = v.dealerPrice >= minPrice && v.dealerPrice <= maxPrice;
      const distanceMatch = searchRadius >= 3000 || v.dynamicDistance <= searchRadius;

      return (
        textMatch &&
        makeMatch &&
        trimMatch &&
        statusMatch &&
        packageMatch &&
        drivetrainMatch &&
        transmissionMatch &&
        colorMatch &&
        bodyTypeMatch &&
        priceMatch &&
        distanceMatch
      );
    });
  }, [
    vehiclesWithDistance,
    searchQuery,
    selectedMake,
    selectedTrims,
    selectedStatus,
    selectedPackages,
    selectedDrivetrains,
    selectedTransmissions,
    selectedColors,
    selectedBodyTypes,
    minPrice,
    maxPrice,
    searchRadius
  ]);

  // Sorting
  const sortedVehicles = useMemo(() => {
    return [...filteredVehicles].sort((a, b) => {
      if (sortBy === "distance") return a.dynamicDistance - b.dynamicDistance;
      if (sortBy === "price_asc") return a.dealerPrice - b.dealerPrice;
      if (sortBy === "price_desc") return b.dealerPrice - a.dealerPrice;
      if (sortBy === "discount_desc") {
        const discA = (a.msrp - a.dealerPrice) / a.msrp;
        const discB = (b.msrp - b.dealerPrice) / b.msrp;
        return discB - discA;
      }
      if (sortBy === "days_on_lot") return a.daysOnLot - b.daysOnLot;
      return 0;
    });
  }, [filteredVehicles, sortBy]);

  // Count active filters for badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedMake !== "All") count++;
    if (selectedTrims.length > 0) count += selectedTrims.length;
    if (selectedPackages.length > 0) count += selectedPackages.length;
    if (selectedDrivetrains.length > 0) count += selectedDrivetrains.length;
    if (selectedTransmissions.length > 0) count += selectedTransmissions.length;
    if (selectedColors.length > 0) count += selectedColors.length;
    if (selectedBodyTypes.length > 0) count += selectedBodyTypes.length;
    if (selectedStatus !== "All") count++;
    if (maxPrice < 200000 || minPrice > 0) count++;
    if (searchRadius < 3000) count++;
    return count;
  }, [
    selectedMake,
    selectedTrims,
    selectedPackages,
    selectedDrivetrains,
    selectedTransmissions,
    selectedColors,
    selectedBodyTypes,
    selectedStatus,
    maxPrice,
    minPrice,
    searchRadius
  ]);

  const clearAllFilters = () => {
    setSelectedMake("All");
    setSelectedTrims([]);
    setSelectedPackages([]);
    setSelectedDrivetrains([]);
    setSelectedTransmissions([]);
    setSelectedColors([]);
    setSelectedBodyTypes([]);
    setSelectedStatus("All");
    setMaxPrice(200000);
    setMinPrice(0);
    setSearchRadius(3000);
    setSearchQuery("");
  };

  const toggleTrim = (trim: string) => {
    setSelectedTrims(prev =>
      prev.includes(trim) ? prev.filter(t => t !== trim) : [...prev, trim]
    );
  };

  const togglePackage = (pkg: string) => {
    setSelectedPackages(prev =>
      prev.includes(pkg) ? prev.filter(p => p !== pkg) : [...prev, pkg]
    );
  };

  const toggleDrivetrain = (dt: string) => {
    setSelectedDrivetrains(prev =>
      prev.includes(dt) ? prev.filter(d => d !== dt) : [...prev, dt]
    );
  };

  const toggleTransmission = (tr: string) => {
    setSelectedTransmissions(prev =>
      prev.includes(tr) ? prev.filter(t => t !== tr) : [...prev, tr]
    );
  };

  const toggleColor = (c: string) => {
    setSelectedColors(prev =>
      prev.includes(c) ? prev.filter(col => col !== c) : [...prev, c]
    );
  };

  const zipInfo = getZipCoordinates(zipCode);

  // Reusable Filter Sidebar Content Component
  const FilterSidebarContent = () => (
    <div className="space-y-6 text-xs">
      {/* Sidebar Header */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-emerald-400" />
          <span className="font-bold text-white uppercase text-xs tracking-wider">
            Trim Results {activeFilterCount > 0 && `(${activeFilterCount})`}
          </span>
        </div>
        {activeFilterCount > 0 && (
          <button
            onClick={clearAllFilters}
            className="flex items-center gap-1 text-[11px] font-semibold text-ink-muted hover:text-emerald-400 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* 1. Make / Brand */}
      <div className="space-y-2">
        <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider">Make / Brand</label>
        <div className="flex flex-wrap gap-1.5">
          {allMakes.map((make) => (
            <button
              key={make}
              onClick={() => {
                setSelectedMake(make);
                setSelectedTrims([]);
              }}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                selectedMake === make
                  ? "bg-emerald-500 text-black shadow-sm"
                  : "border border-border bg-surface text-ink-muted hover:text-white"
              }`}
            >
              {make}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Trims / Submodels */}
      {availableTrims.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-border/50">
          <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider">Trim / Submodel</label>
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {availableTrims.map((trim) => {
              const isChecked = selectedTrims.includes(trim);
              return (
                <button
                  key={trim}
                  onClick={() => toggleTrim(trim)}
                  className={`w-full flex items-center justify-between p-1.5 rounded-lg border text-left transition-all ${
                    isChecked
                      ? "border-emerald-500/50 bg-emerald-950/20 text-white font-medium"
                      : "border-border bg-surface text-ink-muted hover:text-white"
                  }`}
                >
                  <span className="truncate">{trim}</span>
                  {isChecked && <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Must-Have Factory Packages & Options (Visor.vin Signature) */}
      <div className="space-y-2 pt-3 border-t border-border/50">
        <div className="flex items-center justify-between">
          <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-emerald-400" />
            <span>Must-Have Packages</span>
          </label>
          <span className="text-[10px] text-emerald-400 font-mono">Exact Match</span>
        </div>
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {MOCK_POPULAR_PACKAGES.map((pkg) => {
            const isChecked = selectedPackages.includes(pkg.name);
            return (
              <button
                key={pkg.name}
                onClick={() => togglePackage(pkg.name)}
                className={`w-full flex items-center justify-between p-1.5 rounded-lg border text-left transition-all ${
                  isChecked
                    ? "border-emerald-500 bg-emerald-950/30 text-white font-semibold"
                    : "border-border bg-surface text-ink-muted hover:text-white"
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className={`h-1.5 w-1.5 rounded-full ${isChecked ? "bg-emerald-400" : "bg-ink-faint"}`} />
                  <span className="truncate">{pkg.name}</span>
                </div>
                <span className="text-[10px] text-ink-faint font-mono shrink-0 ml-1">({pkg.count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Drivetrain & Transmission */}
      <div className="space-y-2 pt-3 border-t border-border/50">
        <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider">Drivetrain</label>
        <div className="grid grid-cols-3 gap-1">
          {drivetrainOptions.map((dt) => {
            const isChecked = selectedDrivetrains.includes(dt);
            return (
              <button
                key={dt}
                onClick={() => toggleDrivetrain(dt)}
                className={`py-1 px-2 rounded-lg text-[11px] font-semibold transition-all text-center ${
                  isChecked
                    ? "bg-emerald-500 text-black shadow-sm"
                    : "border border-border bg-surface text-ink-muted hover:text-white"
                }`}
              >
                {dt}
              </button>
            );
          })}
        </div>

        <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider pt-2 block">Transmission</label>
        <div className="grid grid-cols-3 gap-1">
          {transmissionOptions.map((tr) => {
            const isChecked = selectedTransmissions.includes(tr);
            return (
              <button
                key={tr}
                onClick={() => toggleTransmission(tr)}
                className={`py-1 px-1.5 rounded-lg text-[10px] font-semibold transition-all text-center truncate ${
                  isChecked
                    ? "bg-emerald-500 text-black shadow-sm"
                    : "border border-border bg-surface text-ink-muted hover:text-white"
                }`}
              >
                {tr}
              </button>
            );
          })}
        </div>
      </div>

      {/* 5. Exterior Color Family */}
      <div className="space-y-2 pt-3 border-t border-border/50">
        <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider">Exterior Color</label>
        <div className="flex flex-wrap gap-1.5">
          {colorOptions.map((c) => {
            const isChecked = selectedColors.includes(c.match);
            return (
              <button
                key={c.match}
                onClick={() => toggleColor(c.match)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-medium transition-all ${
                  isChecked
                    ? "border-emerald-500 bg-emerald-950/40 text-white"
                    : "border-border bg-surface text-ink-muted hover:text-white"
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full border ${c.bg}`} />
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 6. Price Range */}
      <div className="space-y-2 pt-3 border-t border-border/50">
        <div className="flex items-center justify-between">
          <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider">Max Price</label>
          <span className="font-mono font-bold text-emerald-400 text-xs">{formatCurrency(maxPrice)}</span>
        </div>
        <input
          type="range"
          min={30000}
          max={200000}
          step={5000}
          value={maxPrice}
          onChange={(e) => setMaxPrice(Number(e.target.value))}
          className="w-full accent-emerald-400 cursor-pointer"
        />
        <div className="flex justify-between text-[10px] text-ink-faint font-mono">
          <span>$30k</span>
          <span>$100k</span>
          <span>$200k+</span>
        </div>
      </div>

      {/* 7. Inventory Status */}
      <div className="space-y-2 pt-3 border-t border-border/50">
        <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider">Availability</label>
        <div className="grid grid-cols-3 gap-1">
          <button
            onClick={() => setSelectedStatus("All")}
            className={`py-1 text-[11px] rounded-lg font-semibold transition-all ${
              selectedStatus === "All"
                ? "bg-white text-black font-bold"
                : "border border-border bg-surface text-ink-muted hover:text-white"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setSelectedStatus("on_lot")}
            className={`py-1 text-[11px] rounded-lg font-semibold transition-all ${
              selectedStatus === "on_lot"
                ? "bg-emerald-500 text-black font-bold"
                : "border border-border bg-surface text-ink-muted hover:text-white"
            }`}
          >
            🟢 On Lot
          </button>
          <button
            onClick={() => setSelectedStatus("in_transit")}
            className={`py-1 text-[11px] rounded-lg font-semibold transition-all ${
              selectedStatus === "in_transit"
                ? "bg-blue-500 text-black font-bold"
                : "border border-border bg-surface text-ink-muted hover:text-white"
            }`}
          >
            🚚 In Transit
          </button>
        </div>
      </div>

      {/* 8. Distance / ZIP */}
      <div className="space-y-2 pt-3 border-t border-border/50">
        <div className="flex items-center justify-between">
          <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider">Distance Radius</label>
          <span className="font-mono text-emerald-400 font-bold">
            {searchRadius >= 3000 ? "Nationwide" : `${searchRadius} mi`}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {radiusOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSearchRadius(opt.value)}
              className={`py-1 px-1 text-[10px] rounded-lg font-semibold transition-all text-center truncate ${
                searchRadius === opt.value
                  ? "bg-emerald-500 text-black font-bold"
                  : "border border-border bg-surface text-ink-muted hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-ink-muted pt-1 flex items-center justify-between">
          <span>ZIP: <strong className="text-white font-mono">{zipCode}</strong> ({zipInfo.city}, {zipInfo.state})</span>
          <button
            onClick={() => setIsLocationOpen(true)}
            className="text-emerald-400 hover:underline"
          >
            Change
          </button>
        </div>
      </div>
    </div>
  );

  // ===========================================================================
  // RENDER: STEP 1 - SEARCH LANDING PAGE (Visor.vin Entry State)
  // ===========================================================================
  if (viewState === "landing") {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8 space-y-12 animate-fadeIn">
        {/* Hero Title */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-semibold text-ink-light shadow-sm">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Whole-Market Option Search • Reverse Dealer Bidding</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tight leading-tight">
            What car are you <br />
            <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
              looking for today?
            </span>
          </h1>
          <p className="text-base text-ink-muted max-w-lg mx-auto">
            Type any vehicle name, trim, or factory option to launch deep dealer bidding and filter by exact specs.
          </p>
        </div>

        {/* Large Focused Search Input Bar */}
        <form onSubmit={handleSearchSubmit} className="space-y-4">
          <div className="relative flex flex-col sm:flex-row items-center rounded-2xl border-2 border-border-strong bg-surface p-2 shadow-2xl transition-all focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-500/20 gap-2">
            <div className="flex items-center w-full flex-1">
              <Search className="h-6 w-6 text-emerald-400 ml-3 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                placeholder="Search Make, Model, Trim, or Option (e.g. BMW 330i, 911, Prius, Lyriq)..."
                className="w-full bg-transparent px-4 py-3.5 text-base sm:text-lg text-white placeholder-ink-faint focus:outline-none"
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-xs text-ink-muted hover:text-white px-2"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            <button
              type="submit"
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-7 py-3.5 font-extrabold text-sm text-black transition-all hover:bg-emerald-400 active:scale-95 shadow-lg shadow-emerald-500/20 shrink-0 w-full sm:w-auto"
            >
              <span>Search Cars</span>
              <ArrowRight className="h-4 w-4 stroke-[2.5]" />
            </button>
          </div>

          {/* Quick Suggestions */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-xs">
            <span className="text-ink-faint font-semibold mr-1">Trending Searches:</span>
            {quickPillSuggestions.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleQuickSearch(item.query, item.make)}
                className="rounded-lg border border-border bg-surface px-3 py-1 text-ink-muted hover:border-emerald-500/50 hover:text-white transition-all flex items-center gap-1.5"
              >
                <span>{item.label}</span>
                <ArrowRight className="h-3 w-3 opacity-60" />
              </button>
            ))}
          </div>
        </form>

        {/* Popular Brands Grid */}
        <div className="space-y-4 pt-6 border-t border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">Or Browse by Brand</h2>
            <button
              type="button"
              onClick={() => {
                setSelectedMake("All");
                setViewState("results");
              }}
              className="text-xs font-semibold text-emerald-400 hover:underline"
            >
              View All {vehicles.length} Available Vehicles →
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {popularMakes.map((m) => (
              <button
                key={m.name}
                type="button"
                onClick={() => handleQuickSearch(m.name, m.name)}
                className="group rounded-xl border border-border bg-surface p-4 text-left hover:border-emerald-500/50 hover:bg-surface-elevated transition-all"
              >
                <div className="font-extrabold text-white text-base group-hover:text-emerald-400 transition-colors flex items-center justify-between">
                  <span>{m.name}</span>
                  <ArrowRight className="h-4 w-4 text-ink-muted group-hover:text-emerald-400 transition-colors" />
                </div>
                <div className="text-[11px] text-ink-muted mt-1 truncate">{m.count}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // RENDER: STEP 2 - VISOR.VIN DEDICATED RESULTS & MULTI-FACETED FILTER PAGE
  // ===========================================================================
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6 animate-fadeIn">
      {/* Top Search & Breadcrumb Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setViewState("landing")}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white hover:border-border-strong transition-all"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>New Search</span>
          </button>

          <div className="text-xs text-ink-muted hidden sm:block">
            Searching for: <strong className="text-white">{searchQuery || selectedMake || "All Vehicles"}</strong>
          </div>
        </div>

        {/* Compact Quick Search Input in Results View */}
        <div className="flex items-center gap-2 max-w-md w-full">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchInputChange(e.target.value)}
              placeholder="Refine search (e.g. M Sport, Sport Chrono)..."
              className="w-full rounded-xl border border-border bg-surface pl-9 pr-3 py-1.5 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <button
            onClick={() => setIsLocationOpen(!isLocationOpen)}
            className="flex items-center gap-1 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink-light shrink-0"
          >
            <MapPin className="h-3.5 w-3.5 text-emerald-400" />
            <span className="font-mono">{zipCode}</span>
          </button>
        </div>
      </div>

      {/* 2-COLUMN VISOR.VIN STYLE RESULTS + FILTER SYSTEM */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* DESKTOP FILTER SIDEBAR (Left Column) */}
        <aside className="hidden lg:block lg:col-span-1 space-y-6 bg-surface/40 p-4 rounded-2xl border border-border/80 h-fit sticky top-20">
          <FilterSidebarContent />
        </aside>

        {/* RESULTS CONTENT (Right Column) */}
        <main className="lg:col-span-3 space-y-4">
          
          {/* Top Results Control Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface p-3 rounded-xl border border-border">
            <div className="flex items-center gap-2">
              {/* Mobile Filter Trigger Button */}
              <button
                onClick={() => setIsMobileFilterOpen(true)}
                className="lg:hidden flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-emerald-400"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Filters {activeFilterCount > 0 && `(${activeFilterCount})`}</span>
              </button>

              <div className="text-xs text-ink-muted">
                Showing <strong className="text-white font-bold">{sortedVehicles.length}</strong> matching vehicles
              </div>
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-ink-muted font-medium shrink-0 flex items-center gap-1">
                <ArrowUpDown className="h-3.5 w-3.5 text-emerald-400" />
                <span>Sort:</span>
              </span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-white font-semibold focus:border-emerald-500 focus:outline-none cursor-pointer"
              >
                <option value="distance">Nearest Distance</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="discount_desc">Highest Discount %</option>
                <option value="days_on_lot">Days On Lot</option>
              </select>
            </div>
          </div>

          {/* Active Filter Badges Bar */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 bg-background p-2.5 rounded-xl border border-border/60">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint mr-1">Active:</span>
              
              {selectedMake !== "All" && (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-950/60 border border-emerald-500/40 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  Make: {selectedMake}
                  <button onClick={() => setSelectedMake("All")}><X className="h-3 w-3 hover:text-white" /></button>
                </span>
              )}

              {selectedTrims.map(trim => (
                <span key={trim} className="inline-flex items-center gap-1 rounded bg-surface-elevated border border-border px-2 py-0.5 text-[11px] font-medium text-white">
                  {trim}
                  <button onClick={() => toggleTrim(trim)}><X className="h-3 w-3 hover:text-red-400" /></button>
                </span>
              ))}

              {selectedPackages.map(pkg => (
                <span key={pkg} className="inline-flex items-center gap-1 rounded bg-emerald-950/60 border border-emerald-500/40 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  📦 {pkg}
                  <button onClick={() => togglePackage(pkg)}><X className="h-3 w-3 hover:text-white" /></button>
                </span>
              ))}

              {selectedDrivetrains.map(dt => (
                <span key={dt} className="inline-flex items-center gap-1 rounded bg-surface-elevated border border-border px-2 py-0.5 text-[11px] font-medium text-white">
                  {dt}
                  <button onClick={() => toggleDrivetrain(dt)}><X className="h-3 w-3 hover:text-red-400" /></button>
                </span>
              ))}

              {selectedStatus !== "All" && (
                <span className="inline-flex items-center gap-1 rounded bg-surface-elevated border border-border px-2 py-0.5 text-[11px] font-medium text-white">
                  Status: {selectedStatus === "on_lot" ? "On Lot" : "In Transit"}
                  <button onClick={() => setSelectedStatus("All")}><X className="h-3 w-3 hover:text-red-400" /></button>
                </span>
              )}

              {searchRadius < 3000 && (
                <span className="inline-flex items-center gap-1 rounded bg-surface-elevated border border-border px-2 py-0.5 text-[11px] font-medium text-white">
                  Within {searchRadius} mi
                  <button onClick={() => setSearchRadius(3000)}><X className="h-3 w-3 hover:text-red-400" /></button>
                </span>
              )}

              <button
                onClick={clearAllFilters}
                className="text-[11px] font-semibold text-ink-muted hover:text-emerald-400 underline ml-auto"
              >
                Clear All
              </button>
            </div>
          )}

          {/* Vehicle List */}
          {sortedVehicles.length > 0 ? (
            <div className="space-y-3">
              {sortedVehicles.map((vehicle) => {
                const discountDollars = Math.max(0, vehicle.msrp - vehicle.dealerPrice);
                const discountPercent = ((discountDollars / vehicle.msrp) * 100).toFixed(1);
                const isExpanded = expandedBuildSheet === vehicle.id;

                return (
                  <div
                    key={vehicle.id}
                    className="group rounded-xl border border-border/80 bg-surface hover:border-emerald-500/40 hover:bg-surface-elevated transition-all overflow-hidden shadow-sm hover:shadow-md"
                  >
                    <div className="flex flex-col sm:flex-row">
                      {/* Left: Compact Vehicle Photo */}
                      <div className="relative w-full sm:w-48 md:w-52 sm:min-h-[145px] shrink-0 bg-background overflow-hidden">
                        <img
                          src={vehicle.imageUrl}
                          alt={`${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}`}
                          className="h-36 sm:h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                          loading="lazy"
                        />
                        
                        {/* Status Badge */}
                        <div className="absolute top-2 left-2">
                          {vehicle.status === "on_lot" ? (
                            <span className="inline-flex items-center gap-1 rounded bg-black/85 backdrop-blur-md px-1.5 py-0.5 text-[9px] font-extrabold text-emerald-400 border border-emerald-500/30">
                              <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
                              On Lot • {vehicle.daysOnLot}d
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-black/85 backdrop-blur-md px-1.5 py-0.5 text-[9px] font-extrabold text-blue-400 border border-blue-500/30">
                              <span className="h-1 w-1 rounded-full bg-blue-400" />
                              In Transit
                            </span>
                          )}
                        </div>

                        {/* Distance Badge */}
                        <div className="absolute bottom-2 left-2">
                          <span className="inline-flex items-center gap-1 rounded bg-black/85 backdrop-blur-md px-1.5 py-0.5 text-[9px] font-bold text-white border border-border">
                            <MapPin className="h-2.5 w-2.5 text-emerald-400" />
                            <span className="font-mono">{vehicle.dynamicDistance} mi</span>
                          </span>
                        </div>
                      </div>

                      {/* Middle: Vehicle Specs */}
                      <div className="flex-1 p-3 sm:p-3.5 flex flex-col justify-between space-y-2">
                        <div>
                          {/* Title & VIN */}
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400">
                                {vehicle.year} {vehicle.make}
                              </span>
                              <span className="text-border">•</span>
                              <h3 className="font-bold text-white text-sm sm:text-base leading-tight">
                                {vehicle.model} <span className="text-ink-light font-medium text-xs sm:text-sm">{vehicle.trim}</span>
                              </h3>
                            </div>

                            <span className="text-[9px] font-mono text-ink-muted bg-background px-1.5 py-0.2 rounded border border-border">
                              {vehicle.vin}
                            </span>
                          </div>

                          {/* Specs Subtext */}
                          <p className="text-[11px] text-ink-muted mt-0.5 flex flex-wrap items-center gap-1.5 leading-snug">
                            <span>{vehicle.engine}</span>
                            <span className="text-border">•</span>
                            <span>{vehicle.drivetrain}</span>
                            <span className="text-border">•</span>
                            <span className="text-ink-light">{vehicle.exteriorColor}</span>
                          </p>

                          {/* Dealer Location & Direct Listing Link */}
                          <div className="text-[11px] text-ink-muted mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="text-ink-light font-medium">{vehicle.location.dealerName}</span>
                            <span>({vehicle.location.city}, {vehicle.location.state})</span>
                            <span className="text-border">•</span>
                            {vehicle.dealerUrl ? (
                              <a
                                href={vehicle.dealerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-semibold hover:underline"
                              >
                                <span>Dealer Page</span>
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            ) : null}
                          </div>

                          {/* Package Pills */}
                          <div className="flex flex-wrap gap-1 pt-1.5">
                            {vehicle.packages.slice(0, 3).map((pkg, idx) => (
                              <span
                                key={idx}
                                className="rounded bg-background px-1.5 py-0.2 text-[9px] font-medium text-ink-light border border-border flex items-center gap-1"
                              >
                                <CheckCircle2 className="h-2 w-2 text-emerald-400 shrink-0" />
                                {pkg}
                              </span>
                            ))}
                            {vehicle.packages.length > 3 && (
                              <span className="rounded bg-background px-1.5 py-0.2 text-[9px] text-ink-faint border border-border">
                                +{vehicle.packages.length - 3} more
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Expanded Build Sheet */}
                        {isExpanded && (
                          <div className="rounded-lg border border-border-strong bg-background p-2.5 text-xs space-y-1.5 mt-1.5 animate-fadeIn">
                            <div className="flex items-center justify-between border-b border-border pb-1">
                              <span className="font-bold text-ink-light uppercase text-[9px] tracking-wider text-emerald-400">
                                Factory Option Build Sheet ({vehicle.options.length} line items)
                              </span>
                              {vehicle.dealerUrl && (
                                <a
                                  href={vehicle.dealerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[10px] text-emerald-400 hover:underline font-bold"
                                >
                                  <span>View Original Dealer Window Sticker</span>
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {vehicle.options.map((opt) => (
                                <div key={opt.code} className="flex justify-between text-[10px] border-b border-border/30 pb-0.5">
                                  <span className="text-ink-muted">
                                    <strong className="text-white font-mono mr-1">[{opt.code}]</strong>
                                    {opt.name}
                                  </span>
                                  <span className="text-emerald-400 font-medium">+{formatCurrency(opt.price)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right: Compact Price & Action Column */}
                      <div className="sm:w-44 p-3 sm:p-3.5 bg-surface-elevated/30 border-t sm:border-t-0 sm:border-l border-border flex flex-col justify-between shrink-0 space-y-2">
                        <div className="space-y-0.5 sm:text-right">
                          <div className="text-[10px] text-ink-muted line-through font-medium">
                            MSRP {formatCurrency(vehicle.msrp)}
                          </div>
                          <div className="text-lg font-black text-white tracking-tight">
                            {formatCurrency(vehicle.dealerPrice)}
                          </div>
                          {discountDollars > 0 && (
                            <div className="inline-flex sm:flex sm:justify-end">
                              <span className="rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1 py-0.2 text-[9px] font-extrabold">
                                Save {formatCurrency(discountDollars)} ({discountPercent}%)
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-1.5">
                          {vehicle.dealerUrl && (
                            <a
                              href={vehicle.dealerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full text-center text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 flex items-center justify-center gap-1 transition-colors pb-0.5 hover:underline"
                            >
                              <span>Dealer Website</span>
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}

                          <button
                            onClick={() => onSelectForBid(vehicle)}
                            className="w-full rounded-lg bg-emerald-500 py-1.5 px-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-sm flex items-center justify-center gap-1 active:scale-95"
                          >
                            <Zap className="h-3 w-3 fill-black" />
                            <span>Bid On Spec</span>
                          </button>

                          <button
                            onClick={() => setExpandedBuildSheet(isExpanded ? null : vehicle.id)}
                            className="w-full rounded-md border border-border hover:border-ink-muted bg-background py-1 text-[10px] font-semibold text-ink-light hover:text-white transition-all text-center"
                          >
                            {isExpanded ? "Hide Specs" : "Window Sticker"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center space-y-3">
              <Car className="h-8 w-8 text-ink-muted mx-auto" />
              <h4 className="font-bold text-white text-base">No vehicles match all selected filters</h4>
              <p className="text-xs text-ink-muted max-w-sm mx-auto">
                Try clearing some filters or expanding your search radius to find available vehicles in network.
              </p>
              <button
                onClick={clearAllFilters}
                className="mt-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-black hover:bg-emerald-400 transition-all"
              >
                Reset All Filters
              </button>
            </div>
          )}
        </main>
      </div>

      {/* MOBILE FILTER MODAL / DRAWER */}
      {isMobileFilterOpen && (
        <div className="fixed inset-0 z-50 flex bg-black/80 backdrop-blur-sm lg:hidden animate-fadeIn">
          <div className="ml-auto w-full max-w-md bg-surface border-l border-border h-full flex flex-col p-5 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <span className="font-bold text-white text-sm uppercase tracking-wider">
                Trim Results {activeFilterCount > 0 && `(${activeFilterCount})`}
              </span>
              <button
                onClick={() => setIsMobileFilterOpen(false)}
                className="p-1 rounded-lg bg-surface-elevated text-ink-muted hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <FilterSidebarContent />

            <div className="pt-4 border-t border-border">
              <button
                onClick={() => setIsMobileFilterOpen(false)}
                className="w-full rounded-xl bg-emerald-500 py-3 text-xs font-extrabold text-black hover:bg-emerald-400 shadow-lg"
              >
                View {sortedVehicles.length} Results
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
