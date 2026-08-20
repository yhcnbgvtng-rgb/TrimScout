"use client";

import React, { useState } from "react";
import { Vehicle } from "../lib/types";
import { formatCurrency, calculateDistanceMiles, getZipCoordinates } from "../lib/otdCalculator";
import {
  Search,
  MapPin,
  Zap,
  CheckCircle2,
  ChevronDown,
  ArrowRight,
  X,
  Car
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
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMake, setSelectedMake] = useState<string>("All");
  const [selectedStatus, setSelectedStatus] = useState<string>("All");
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [expandedBuildSheet, setExpandedBuildSheet] = useState<string | null>(null);

  // Zip Code & Radius State
  const [zipCode, setZipCode] = useState<string>("94107");
  const [searchRadius, setSearchRadius] = useState<number>(100); // 3000 = Nationwide
  const [isLocationOpen, setIsLocationOpen] = useState<boolean>(false);

  // Handle Search Input: If user types a 5-digit zip code into the main search bar, auto-detect it
  const handleSearchInputChange = (val: string) => {
    setSearchQuery(val);
    const trimmed = val.trim();
    if (/^\d{5}$/.test(trimmed)) {
      setZipCode(trimmed);
    }
  };

  const quickPillSuggestions = [
    { label: "BMW M Sport", query: "BMW M Sport" },
    { label: "Porsche Sport Chrono", query: "Sport Chrono" },
    { label: "Toyota Prius Hybrid", query: "Prius" },
    { label: "Cadillac Lyriq EV", query: "Lyriq" },
    { label: "Ford Mustang V8", query: "Mustang" },
    { label: "Tesla Model 3", query: "Tesla" },
  ];

  const radiusOptions = [
    { label: "25 Miles", value: 25 },
    { label: "50 Miles", value: 50 },
    { label: "100 Miles", value: 100 },
    { label: "250 Miles", value: 250 },
    { label: "500 Miles", value: 500 },
    { label: "Nationwide", value: 3000 },
  ];


  // Dynamic Distance Map for each vehicle relative to active zipCode
  const vehiclesWithDistance = vehicles.map((v) => {
    const dist = calculateDistanceMiles(zipCode, v.location);
    return { ...v, dynamicDistance: dist };
  });

  // Multi-Token Search Matching + Dynamic Distance Filtering
  const filteredVehicles = vehiclesWithDistance.filter((v) => {
    const queryTokens = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);

    // If query is an exact 5 digit zip, don't treat it as vehicle text filter
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
    const statusMatch =
      selectedStatus === "All" ||
      (selectedStatus === "on_lot" && v.status === "on_lot") ||
      (selectedStatus === "in_transit" && v.status === "in_transit");

    const packageMatch =
      selectedPackages.length === 0 ||
      selectedPackages.every((sp) =>
        v.packages.some((p) => p.toLowerCase().includes(sp.toLowerCase()))
      );

    const distanceMatch = searchRadius >= 3000 || v.dynamicDistance <= searchRadius;

    return textMatch && makeMatch && statusMatch && packageMatch && distanceMatch;
  });

  // Sort by closest distance first by default
  const sortedVehicles = [...filteredVehicles].sort((a, b) => a.dynamicDistance - b.dynamicDistance);

  const makes = ["All", "BMW", "Porsche", "Toyota", "Cadillac", "Ford", "Tesla"];
  const zipInfo = getZipCoordinates(zipCode);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8 space-y-10">
      {/* ========================================================================= */}
      {/* CARVANA-STYLE HERO & SEARCH BAR                                           */}
      {/* ========================================================================= */}
      <div className="flex flex-col items-center text-center space-y-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-semibold text-ink-light shadow-sm">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Whole-Market Search + Reverse Dealer Bidding</span>
        </div>

        <div className="max-w-2xl space-y-2">
          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
            Search Every Car by Exact Spec. <br />
            <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
              Make Dealers Compete for Your Offer.
            </span>
          </h1>
          <p className="text-sm sm:text-base text-ink-muted max-w-lg mx-auto font-normal pt-1">
            Find vehicles with the exact factory options you want, compare real market discounts, and bid out offers with $0 hidden fees.
          </p>
        </div>

        {/* Search Bar + Zip & Radius */}
        <div className="w-full max-w-3xl space-y-3 pt-2 relative z-30">
          <div className="flex flex-col sm:flex-row items-center rounded-2xl border-2 border-border-strong bg-surface p-2 shadow-2xl transition-all focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 gap-2">
            {/* Main Search Input */}
            <div className="flex items-center w-full flex-1">
              <Search className="h-5 w-5 text-ink-muted ml-3 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                placeholder="Search Make, Model, Option (e.g. BMW 330i, Sport Chrono), or ZIP Code..."
                className="w-full bg-transparent px-3 py-3 text-sm sm:text-base text-white placeholder-ink-faint focus:outline-none"
                autoFocus
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="text-xs text-ink-muted hover:text-white px-2"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Zip Code & Radius Selector Dropdown */}
            <div className="relative w-full sm:w-auto border-t sm:border-t-0 sm:border-l border-border pt-2 sm:pt-0 sm:pl-2">
              <button
                type="button"
                onClick={() => setIsLocationOpen(!isLocationOpen)}
                className="flex items-center justify-between sm:justify-start gap-2 rounded-xl bg-surface-elevated hover:bg-border px-3.5 py-2.5 text-xs font-semibold text-ink-light transition-all border border-border w-full sm:w-auto"
              >
                <MapPin className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <div className="text-left">
                  <div className="truncate font-mono font-bold text-white leading-none">
                    {zipCode} ({zipInfo.state}) • {searchRadius >= 3000 ? "Nationwide" : `${searchRadius} mi`}
                  </div>
                  <div className="text-[9px] text-ink-muted font-normal mt-0.5 leading-none">
                    {zipInfo.city}
                  </div>
                </div>
                <ChevronDown className={`h-3.5 w-3.5 text-ink-muted transition-transform ml-1 ${isLocationOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Location Popover */}
              {isLocationOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 rounded-2xl border border-border-strong bg-surface-elevated p-4 shadow-2xl space-y-4 text-left text-xs z-50 animate-fadeIn">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <span className="font-bold text-white uppercase text-[10px] tracking-wider text-emerald-400">
                      Set Any US ZIP Code & Radius
                    </span>
                    <button
                      onClick={() => setIsLocationOpen(false)}
                      className="text-ink-muted hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Zip Input (Auto-calculates on every keystroke) */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-ink-light">Enter 5-Digit ZIP Code:</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        maxLength={5}
                        value={zipCode}
                        onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="e.g. 10001, 90210, 30301, 75201"
                        className="flex-1 rounded-lg border border-border bg-background py-2 px-3 text-sm text-white focus:border-emerald-500 focus:outline-none font-mono font-bold"
                      />
                      <button
                        type="button"
                        onClick={() => setIsLocationOpen(false)}
                        className="rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-bold text-black hover:bg-emerald-400 transition-all"
                      >
                        Done
                      </button>
                    </div>

                    <div className="rounded-lg bg-background p-2 text-[10px] text-ink-muted flex items-center justify-between border border-border/50">
                      <span>Location: <strong className="text-white">{zipInfo.city}, {zipInfo.state}</strong></span>
                      <span className="text-emerald-400 font-medium font-mono">ZIP {zipCode}</span>
                    </div>
                  </div>



                  {/* Radius Options */}
                  <div className="space-y-1.5 pt-1 border-t border-border/50">
                    <label className="text-[11px] font-semibold text-ink-light">Search Radius:</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {radiusOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setSearchRadius(opt.value);
                            setIsLocationOpen(false);
                          }}
                          className={`rounded-lg py-1.5 px-2 text-[11px] font-semibold transition-all ${
                            searchRadius === opt.value
                              ? "bg-emerald-500 text-black shadow-sm"
                              : "border border-border bg-background text-ink-muted hover:text-white"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Search Action Button */}
            <button
              onClick={() => {}}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-5 py-2.5 font-extrabold text-xs text-black transition-all hover:bg-emerald-400 active:scale-95 shadow-md shrink-0 w-full sm:w-auto"
            >
              <span>Search</span>
              <ArrowRight className="h-3.5 w-3.5 stroke-[2.5]" />
            </button>
          </div>

          {/* Popular Recommendations Pills */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs">
            <span className="text-ink-faint font-semibold mr-1">Popular:</span>
            {quickPillSuggestions.map((item, idx) => (
              <button
                key={idx}
                onClick={() => setSearchQuery(item.query)}
                className={`rounded-lg border px-3 py-1 transition-all ${
                  searchQuery === item.query
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500 font-semibold"
                    : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* AVAILABLE CARS SECTION (DYNAMIC DISTANCE UPDATED LIVE BY ZIP)             */}
      {/* ========================================================================= */}
      <div className="space-y-6 pt-4 border-t border-border animate-fadeIn">
        {/* Filter & Make Row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink-muted mr-1">Brand:</span>
            {makes.map((make) => (
              <button
                key={make}
                onClick={() => setSelectedMake(make)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  selectedMake === make
                    ? "bg-emerald-500 text-black shadow-sm"
                    : "border border-border bg-surface text-ink-muted hover:text-white"
                }`}
              >
                {make}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setSelectedStatus("All")}
              className={`rounded-lg px-2.5 py-1 font-medium transition-all ${
                selectedStatus === "All"
                  ? "bg-ink-light text-black font-bold"
                  : "border border-border bg-surface text-ink-muted hover:text-white"
              }`}
            >
              All Status
            </button>
            <button
              onClick={() => setSelectedStatus("on_lot")}
              className={`rounded-lg px-2.5 py-1 font-medium transition-all ${
                selectedStatus === "on_lot"
                  ? "bg-emerald-500 text-black font-bold"
                  : "border border-border bg-surface text-ink-muted hover:text-white"
              }`}
            >
              🟢 On Lot
            </button>
            <button
              onClick={() => setSelectedStatus("in_transit")}
              className={`rounded-lg px-2.5 py-1 font-medium transition-all ${
                selectedStatus === "in_transit"
                  ? "bg-blue-500 text-black font-bold"
                  : "border border-border bg-surface text-ink-muted hover:text-white"
              }`}
            >
              🚚 In Transit
            </button>
          </div>
        </div>

        {/* Results Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted border-b border-border pb-2">
          <div className="flex items-center gap-2">
            <Car className="h-4 w-4 text-emerald-400" />
            <span>
              Available Inventory: <strong className="text-white font-bold">{sortedVehicles.length}</strong> vehicles within <strong className="text-emerald-400 font-mono font-bold">{searchRadius >= 3000 ? "Nationwide" : `${searchRadius} miles`}</strong> of <strong className="text-white font-mono font-bold">{zipCode}</strong> ({zipInfo.city}, {zipInfo.state})
            </span>
          </div>

          {(searchQuery || selectedMake !== "All" || selectedStatus !== "All" || selectedPackages.length > 0 || searchRadius < 3000) && (
            <button
              onClick={() => {
                setSearchQuery("");
                setSelectedMake("All");
                setSelectedStatus("All");
                setSelectedPackages([]);
                setSearchRadius(3000);
              }}
              className="text-emerald-400 hover:underline font-medium"
            >
              Show All Nationwide ({vehicles.length})
            </button>
          )}
        </div>

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
                  className="rounded-2xl border border-border bg-surface p-4 transition-all hover:border-border-strong hover:bg-surface-elevated space-y-3 shadow-sm"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    {/* Left Info */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {vehicle.status === "on_lot" ? (
                          <span className="rounded-md bg-emerald-950/80 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                            🟢 On Lot • {vehicle.daysOnLot}d
                          </span>
                        ) : (
                          <span className="rounded-md bg-blue-950/80 px-2 py-0.5 text-[10px] font-bold text-blue-400 border border-blue-500/30">
                            🚚 In Transit
                          </span>
                        )}
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                          {vehicle.year} {vehicle.make}
                        </span>
                        <span className="text-ink-faint text-xs font-mono">VIN: {vehicle.vin}</span>
                      </div>

                      <h3 className="font-extrabold text-white text-lg">
                        {vehicle.model} <span className="text-ink-light font-semibold text-base">{vehicle.trim}</span>
                      </h3>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted pt-0.5">
                        <span>{vehicle.engine}</span>
                        <span>•</span>
                        <span>{vehicle.drivetrain}</span>
                        <span>•</span>
                        <span className="text-ink-light">{vehicle.exteriorColor}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1 text-emerald-400 font-bold">
                          <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                          {vehicle.location.dealerName} ({vehicle.location.city}, {vehicle.location.state}) • <span className="underline font-mono">{vehicle.dynamicDistance} mi away</span>
                        </span>
                      </div>
                    </div>

                    {/* Right Price & Bid Action */}
                    <div className="flex flex-wrap items-center gap-4 lg:text-right">
                      <div className="space-y-0.5">
                        <div className="text-xs text-ink-muted line-through">
                          MSRP {formatCurrency(vehicle.msrp)}
                        </div>
                        <div className="text-xl font-extrabold text-white">
                          {formatCurrency(vehicle.dealerPrice)}
                        </div>
                        {discountDollars > 0 && (
                          <div className="text-[11px] font-bold text-emerald-400">
                            -{formatCurrency(discountDollars)} ({discountPercent}% off MSRP)
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpandedBuildSheet(isExpanded ? null : vehicle.id)}
                          className="rounded-xl border border-border bg-surface-elevated px-3 py-2 text-xs font-semibold text-ink-light hover:bg-border transition-all"
                        >
                          {isExpanded ? "Hide Specs" : "Build Sheet"}
                        </button>

                        <button
                          onClick={() => onSelectForBid(vehicle)}
                          className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-md shadow-emerald-500/20 flex items-center gap-1.5 active:scale-95"
                        >
                          <Zap className="h-3.5 w-3.5 fill-black" />
                          <span>Bid On Spec</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Installed Packages Pills */}
                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border/40">
                    {vehicle.packages.map((pkg, idx) => (
                      <span
                        key={idx}
                        className="rounded-md bg-background px-2 py-0.5 text-[11px] font-medium text-ink-light border border-border flex items-center gap-1"
                      >
                        <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                        {pkg}
                      </span>
                    ))}
                  </div>

                  {/* Expanded Build Sheet Drawer */}
                  {isExpanded && (
                    <div className="rounded-xl border border-border-strong bg-background p-3.5 text-xs space-y-2 mt-2">
                      <div className="font-bold text-ink-light uppercase text-[10px] tracking-wider text-emerald-400 border-b border-border pb-1">
                        Factory Option Build Sheet Line Items
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {vehicle.options.map((opt) => (
                          <div key={opt.code} className="flex justify-between text-[11px] border-b border-border/30 pb-1">
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
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center space-y-3">
            <Car className="h-8 w-8 text-ink-muted mx-auto" />
            <h4 className="font-bold text-white text-base">No vehicles found within {searchRadius} miles of {zipCode} ({zipInfo.city}, {zipInfo.state})</h4>
            <p className="text-xs text-ink-muted max-w-sm mx-auto">
              There are no dealerships with matching inventory in this radius. Expand your radius or search nationwide.
            </p>
            <button
              onClick={() => setSearchRadius(3000)}
              className="mt-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-black hover:bg-emerald-400 transition-all"
            >
              Expand to Nationwide Search ({vehicles.length} Vehicles)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
