"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
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
  Copy,
  Sparkles,
  ArrowUpDown,
  ArrowLeft,
  Filter,
  Clock,
  Radio,
  RefreshCw,
  Sliders,
  Loader2,
  Eye,
  Cpu,
} from "lucide-react";

interface MarketSearchProps {
  vehicles: Vehicle[];
  onSelectForBid: (vehicle: Vehicle) => void;
  onOpenFlexibleWizard: () => void;
  onOpenConnectorModal?: () => void;
  onOpenScraperModal?: () => void;
  onSyncLiveInventory?: (zip: string, radius: number, query?: string, make?: string, limit?: number) => Promise<void>;
  isSyncingInventory?: boolean;
  onLoadMoreLiveInventory?: () => Promise<void>;
  hasMoreVehicles?: boolean;
  totalFoundVehicles?: number;
  isLoadingMore?: boolean;
}

export const MarketSearch: React.FC<MarketSearchProps> = ({
  vehicles,
  onSelectForBid,
  onOpenFlexibleWizard,
  onOpenConnectorModal,
  onOpenScraperModal,
  onSyncLiveInventory,
  isSyncingInventory = false,
  onLoadMoreLiveInventory,
  hasMoreVehicles = false,
  totalFoundVehicles = 0,
  isLoadingMore = false,
}) => {
  // Navigation State: "results" (shows live car listings immediately on load) vs "landing" (search hero)
  const [viewState, setViewState] = useState<"landing" | "results">("results");

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
  const [maxPrice, setMaxPrice] = useState<number>(350000);
  const [minPrice, setMinPrice] = useState<number>(0);
  const [resultsLimit, setResultsLimit] = useState<number>(500);
  
  // Make / Brand Autofilling Datafield States
  const [makeSearchInput, setMakeSearchInput] = useState("");
  const [isMakeDropdownOpen, setIsMakeDropdownOpen] = useState(false);
  const makeDropdownRef = useRef<HTMLDivElement>(null);

  // Trim / Submodel Autofilling Datafield States
  const [trimSearchInput, setTrimSearchInput] = useState("");
  const [isTrimDropdownOpen, setIsTrimDropdownOpen] = useState(false);
  const trimDropdownRef = useRef<HTMLDivElement>(null);

  // Factory Packages & Options Autofilling Datafield States
  const [packageSearchInput, setPackageSearchInput] = useState("");
  const [isPackageDropdownOpen, setIsPackageDropdownOpen] = useState(false);
  const packageDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (makeDropdownRef.current && !makeDropdownRef.current.contains(target)) {
        setIsMakeDropdownOpen(false);
      }
      if (trimDropdownRef.current && !trimDropdownRef.current.contains(target)) {
        setIsTrimDropdownOpen(false);
      }
      if (packageDropdownRef.current && !packageDropdownRef.current.contains(target)) {
        setIsPackageDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Sorting: distance | price_asc | price_desc | discount_desc | days_on_lot
  const [sortBy, setSortBy] = useState<string>("distance");

  // Mobile Filter Drawer
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [expandedBuildSheet, setExpandedBuildSheet] = useState<string | null>(null);

  // Viewed Vehicles State (Tracked & Persisted in localStorage)
  const [viewedVehicleIds, setViewedVehicleIds] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("trimscout_viewed_vehicles");
        return saved ? JSON.parse(saved) : [];
      } catch {
        return [];
      }
    }
    return [];
  });

  const markVehicleAsViewed = (id: string, vin?: string) => {
    setViewedVehicleIds((prev) => {
      const set = new Set(prev);
      if (id) set.add(id);
      if (vin) set.add(vin);
      const updated = Array.from(set);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("trimscout_viewed_vehicles", JSON.stringify(updated));
        } catch {}
      }
      return updated;
    });
  };

  // Zip Code & Radius State
  const [zipCode, setZipCode] = useState<string>("94107");
  const [zipInput, setZipInput] = useState<string>("94107");
  const [searchRadius, setSearchRadius] = useState<number>(25); // 25 = Standard, 3000 = Nationwide
  const [radiusInput, setRadiusInput] = useState<string>("25");
  const [isLocationOpen, setIsLocationOpen] = useState<boolean>(false);
  const [copiedVin, setCopiedVin] = useState<string | null>(null);

  const handleCopyVin = (vin: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(vin);
      setCopiedVin(vin);
      setTimeout(() => setCopiedVin(null), 2000);
    }
  };

  const handleApplyZip = (overrideZip?: string) => {
    const target = overrideZip || zipInput;
    const clean = target.trim().replace(/\D/g, "");
    if (clean.length === 5) {
      setZipCode(clean);
      setZipInput(clean);
      setIsLocationOpen(false);
      if (onSyncLiveInventory) {
        onSyncLiveInventory(clean, searchRadius, searchQuery, selectedMake !== "All" ? selectedMake : undefined, resultsLimit);
      }
    }
  };

  // Auto-detect 5-digit zip in search bar
  const handleSearchInputChange = (val: string) => {
    setSearchQuery(val);
    const trimmed = val.trim();
    if (/^\d{5}$/.test(trimmed)) {
      setZipCode(trimmed);
      setZipInput(trimmed);
      if (onSyncLiveInventory) {
        onSyncLiveInventory(trimmed, searchRadius, undefined, selectedMake !== "All" ? selectedMake : undefined);
      }
    }
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setViewState("results");
    if (onSyncLiveInventory) {
      onSyncLiveInventory(zipCode, searchRadius, searchQuery, selectedMake !== "All" ? selectedMake : undefined);
    }
  };

  const handleQuickSearch = (query: string, make?: string) => {
    setSearchQuery(query);
    if (make) setSelectedMake(make);
    setViewState("results");
    if (onSyncLiveInventory) {
      onSyncLiveInventory(zipCode, searchRadius, query, make);
    }
  };

  const quickPillSuggestions = [
    { label: "BMW 3 Series", query: "BMW 3 Series", make: "BMW" },
    { label: "Porsche 911", query: "Porsche 911", make: "Porsche" },
    { label: "Toyota Prius Hybrid", query: "Prius", make: "Toyota" },
    { label: "Audi A4 Quattro", query: "Audi A4", make: "Audi" },
    { label: "Mercedes C-Class", query: "Mercedes C 300", make: "Mercedes-Benz" },
    { label: "Honda Civic Hybrid", query: "Civic", make: "Honda" },
    { label: "Corvette Stingray", query: "Corvette", make: "Chevrolet" },
    { label: "Ford Mustang V8", query: "Mustang", make: "Ford" },
    { label: "Tesla Model 3", query: "Tesla", make: "Tesla" },
  ];

  const popularMakes = [
    { name: "BMW", count: "3 Series • 4 Series • M3" },
    { name: "Porsche", count: "911 • Cayman • Taycan" },
    { name: "Toyota", count: "Prius • Supra • RAV4" },
    { name: "Audi", count: "A4 • S4 • Q5 • e-tron" },
    { name: "Mercedes-Benz", count: "C 300 • E-Class • AMG" },
    { name: "Honda", count: "Civic • Accord • CR-V" },
    { name: "Chevrolet", count: "Corvette • Tahoe • Camaro" },
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

  // Dynamically compute all distinct makes and their real-time vehicle counts from the available results
  const availableMakes = useMemo(() => {
    const counts: Record<string, number> = {};
    vehicles.forEach((v) => {
      if (v.make && v.make.trim()) {
        const cleaned = v.make.trim();
        counts[cleaned] = (counts[cleaned] || 0) + 1;
      }
    });

    const entries = Object.entries(counts).map(([name, count]) => ({ name, count }));
    // Sort descending by vehicle count, then alphabetically
    entries.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return entries;
  }, [vehicles]);

  // Autocomplete matching makes based on user typing in the datafield
  const filteredMakesForAutocomplete = useMemo(() => {
    if (!makeSearchInput.trim()) return availableMakes;
    const lower = makeSearchInput.toLowerCase().trim();
    return availableMakes.filter((m) => m.name.toLowerCase().includes(lower));
  }, [availableMakes, makeSearchInput]);

  // Dynamic Available Trims extracted in real-time from active vehicle dataset (respects selectedMake)
  const availableTrimsData = useMemo(() => {
    const subset = selectedMake === "All" 
      ? vehicles 
      : vehicles.filter(v => v.make.toLowerCase() === selectedMake.toLowerCase());
    
    const counts: Record<string, number> = {};
    subset.forEach(v => {
      if (v.trim && v.trim.trim()) {
        const t = v.trim.trim();
        counts[t] = (counts[t] || 0) + 1;
      }
    });

    const entries = Object.entries(counts).map(([name, count]) => ({ name, count }));
    entries.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return entries;
  }, [vehicles, selectedMake]);

  // Autocomplete matching trims based on user typing
  const filteredTrimsForAutocomplete = useMemo(() => {
    if (!trimSearchInput.trim()) return availableTrimsData;
    const lower = trimSearchInput.toLowerCase().trim();
    return availableTrimsData.filter(t => t.name.toLowerCase().includes(lower));
  }, [availableTrimsData, trimSearchInput]);

  // Dynamic Available Factory Packages & Options extracted from active vehicle dataset
  const availablePackagesData = useMemo(() => {
    const subset = selectedMake === "All" 
      ? vehicles 
      : vehicles.filter(v => v.make.toLowerCase() === selectedMake.toLowerCase());

    const counts: Record<string, number> = {};
    subset.forEach(v => {
      const allPkgs = [
        ...(v.packages || []),
        ...(v.options?.map(o => o.name) || [])
      ];
      const seenForThisCar = new Set<string>();
      allPkgs.forEach(pkg => {
        if (pkg && pkg.trim() && !seenForThisCar.has(pkg.trim())) {
          const p = pkg.trim();
          seenForThisCar.add(p);
          counts[p] = (counts[p] || 0) + 1;
        }
      });
    });

    const entries = Object.entries(counts).map(([name, count]) => ({ name, count }));
    entries.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return entries;
  }, [vehicles, selectedMake]);

  // Autocomplete matching packages based on user typing
  const filteredPackagesForAutocomplete = useMemo(() => {
    if (!packageSearchInput.trim()) return availablePackagesData;
    const lower = packageSearchInput.toLowerCase().trim();
    return availablePackagesData.filter(p => p.name.toLowerCase().includes(lower));
  }, [availablePackagesData, packageSearchInput]);

  // Dynamic Drivetrains with live counts from active results
  const availableDrivetrainsData = useMemo(() => {
    const counts: Record<string, number> = {};
    vehicles.forEach(v => {
      if (v.drivetrain) {
        const dt = v.drivetrain.toUpperCase().trim();
        counts[dt] = (counts[dt] || 0) + 1;
      }
    });
    const standardDts = ["AWD", "4WD", "FWD", "RWD"];
    return standardDts.map(dt => ({
      name: dt,
      count: counts[dt] || 0
    }));
  }, [vehicles]);

  // Dynamic Transmissions with live counts from active results
  const availableTransmissionsData = useMemo(() => {
    const counts: Record<string, number> = {
      Automatic: 0,
      Manual: 0,
      "Dual-Clutch": 0,
    };
    vehicles.forEach(v => {
      const tr = (v.transmission || "").toLowerCase();
      if (tr.includes("manual")) counts.Manual++;
      else if (tr.includes("dual") || tr.includes("dct") || tr.includes("pdk")) counts["Dual-Clutch"]++;
      else counts.Automatic++;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [vehicles]);

  // Dynamic Body Types with live counts
  const availableBodyTypesData = useMemo(() => {
    const counts: Record<string, number> = {};
    vehicles.forEach(v => {
      if (v.bodyType) {
        const bt = v.bodyType.trim();
        counts[bt] = (counts[bt] || 0) + 1;
      }
    });
    const entries = Object.entries(counts).map(([name, count]) => ({ name, count }));
    entries.sort((a, b) => b.count - a.count);
    return entries;
  }, [vehicles]);

  // Dynamic Colors with live counts
  const availableColorsData = useMemo(() => {
    const baseColors = [
      { label: "Black", bg: "bg-neutral-900 border-neutral-700", match: "black" },
      { label: "White", bg: "bg-neutral-100", match: "white" },
      { label: "Grey / Silver", bg: "bg-neutral-500", match: "grey" },
      { label: "Blue", bg: "bg-blue-600", match: "blue" },
      { label: "Red", bg: "bg-red-600", match: "red" },
      { label: "Green", bg: "bg-emerald-600", match: "green" },
    ];
    return baseColors.map(c => {
      const count = vehicles.filter(v => {
        const ext = (v.exteriorColor || "").toLowerCase();
        return ext.includes(c.match) || (c.match === "grey" && ext.includes("silver"));
      }).length;
      return { ...c, count };
    });
  }, [vehicles]);

  // Dynamic Distance Map for each vehicle relative to active zipCode
  const vehiclesWithDistance = useMemo(() => {
    return vehicles.map((v) => {
      const dist = calculateDistanceMiles(zipCode, v.location);
      return { ...v, dynamicDistance: dist };
    });
  }, [vehicles, zipCode]);

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

  // Reusable Filter Sidebar Content Render Function
  const renderFilterSidebarContent = () => (
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

      {/* 0. Zip Code & Mile Radius Filter (Inputtable Data Fields - Standard 25 Miles) */}
      <div className="space-y-3 p-3 rounded-xl bg-surface-elevated/70 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-white font-bold">
            <MapPin className="h-3.5 w-3.5 text-emerald-400" />
            <span className="uppercase text-[10px] tracking-wider text-ink-light">Location & Search Radius</span>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 font-bold">
            {searchRadius >= 3000 ? "Nationwide" : `${searchRadius} mi`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/* Zip Code Input Datafield */}
          <div className="space-y-1">
            <label className="text-[9.5px] font-bold uppercase text-ink-muted flex items-center justify-between">
              <span>Zip Code</span>
              <span className="text-ink-faint font-normal truncate max-w-[65px]">{zipInfo.city}</span>
            </label>
            <div className="relative">
              <input
                type="text"
                maxLength={5}
                value={zipInput}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setZipInput(val);
                  if (val.length === 5) {
                    setZipCode(val);
                    if (onSyncLiveInventory) {
                      onSyncLiveInventory(val, searchRadius, searchQuery, selectedMake !== "All" ? selectedMake : undefined, resultsLimit);
                    }
                  }
                }}
                onBlur={() => {
                  if (zipInput.length === 5 && zipInput !== zipCode) {
                    setZipCode(zipInput);
                    if (onSyncLiveInventory) {
                      onSyncLiveInventory(zipInput, searchRadius, searchQuery, selectedMake !== "All" ? selectedMake : undefined, resultsLimit);
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && zipInput.length === 5) {
                    setZipCode(zipInput);
                    if (onSyncLiveInventory) {
                      onSyncLiveInventory(zipInput, searchRadius, searchQuery, selectedMake !== "All" ? selectedMake : undefined, resultsLimit);
                    }
                  }
                }}
                placeholder="94107"
                className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-white font-mono placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Mile Radius Input Datafield */}
          <div className="space-y-1">
            <label className="text-[9.5px] font-bold uppercase text-ink-muted flex items-center justify-between">
              <span>Radius</span>
              <span className="text-emerald-400/80 font-normal">miles</span>
            </label>
            <div className="relative flex items-center">
              <input
                type="number"
                min={1}
                max={3000}
                value={radiusInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setRadiusInput(val);
                  const num = parseInt(val, 10);
                  if (!isNaN(num) && num > 0) {
                    setSearchRadius(num);
                  }
                }}
                onBlur={() => {
                  const num = parseInt(radiusInput, 10);
                  if (!isNaN(num) && num > 0) {
                    setSearchRadius(num);
                    if (onSyncLiveInventory) {
                      onSyncLiveInventory(zipCode, num, searchQuery, selectedMake !== "All" ? selectedMake : undefined, resultsLimit);
                    }
                  } else {
                    setSearchRadius(25);
                    setRadiusInput("25");
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const num = parseInt(radiusInput, 10);
                    if (!isNaN(num) && num > 0) {
                      setSearchRadius(num);
                      if (onSyncLiveInventory) {
                        onSyncLiveInventory(zipCode, num, searchQuery, selectedMake !== "All" ? selectedMake : undefined, resultsLimit);
                      }
                    }
                  }
                }}
                placeholder="25"
                className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-white font-mono placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Radius Quick Presets with Standard 25 Miles */}
        <div className="flex flex-wrap gap-1 pt-1 border-t border-border/40">
          {[
            { label: "15 mi", val: 15 },
            { label: "25 mi (Std)", val: 25 },
            { label: "50 mi", val: 50 },
            { label: "100 mi", val: 100 },
            { label: "250 mi", val: 250 },
            { label: "Nationwide", val: 3000 },
          ].map((opt) => (
            <button
              key={opt.val}
              type="button"
              onClick={() => {
                setSearchRadius(opt.val);
                setRadiusInput(opt.val.toString());
                if (onSyncLiveInventory) {
                  onSyncLiveInventory(zipCode, opt.val, searchQuery, selectedMake !== "All" ? selectedMake : undefined, resultsLimit);
                }
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                searchRadius === opt.val
                  ? "bg-emerald-500 text-black font-bold shadow-sm"
                  : "border border-border bg-surface text-ink-muted hover:text-white hover:border-emerald-500/40"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Make / Brand Autofilling Datafield */}
      <div className="space-y-2 relative" ref={makeDropdownRef}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider">Make / Brand</label>
            <span className="text-[9.5px] text-ink-faint font-mono">({availableMakes.length} available)</span>
          </div>
          {selectedMake !== "All" && (
            <button
              type="button"
              onClick={() => {
                setSelectedMake("All");
                setMakeSearchInput("");
                setSelectedTrims([]);
                if (onSyncLiveInventory) {
                  onSyncLiveInventory(zipCode, searchRadius, searchQuery, undefined, resultsLimit);
                }
              }}
              className="text-[10px] text-emerald-400 hover:underline font-bold cursor-pointer"
            >
              Reset All
            </button>
          )}
        </div>

        {/* Selected Make Active Chip (if selected) */}
        {selectedMake !== "All" ? (
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/50 text-white text-xs animate-fadeIn">
            <div className="flex items-center gap-2">
              <span className="font-bold text-emerald-300 text-sm">{selectedMake}</span>
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-400 font-mono font-bold">
                {availableMakes.find(m => m.name.toLowerCase() === selectedMake.toLowerCase())?.count || 0} cars
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedMake("All");
                setMakeSearchInput("");
                setSelectedTrims([]);
                if (onSyncLiveInventory) {
                  onSyncLiveInventory(zipCode, searchRadius, searchQuery, undefined, resultsLimit);
                }
              }}
              className="p-1 text-ink-muted hover:text-white rounded-lg hover:bg-emerald-900/60 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          /* Searchable Autofilling Input Datafield */
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink-muted" />
            <input
              type="text"
              value={makeSearchInput}
              onChange={(e) => {
                setMakeSearchInput(e.target.value);
                setIsMakeDropdownOpen(true);
              }}
              onFocus={() => setIsMakeDropdownOpen(true)}
              placeholder="Search or pick brand (e.g. Ford, BMW)..."
              className="w-full rounded-xl border border-border bg-surface pl-8 pr-7 py-2 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
            />
            {makeSearchInput && (
              <button
                type="button"
                onClick={() => {
                  setMakeSearchInput("");
                  setIsMakeDropdownOpen(false);
                }}
                className="absolute right-2.5 top-2.5 text-ink-muted hover:text-white cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Autocomplete Dropdown Popover */}
        {isMakeDropdownOpen && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-surface-elevated shadow-2xl p-1 divide-y divide-border/40 animate-fadeIn">
            {/* Show All Option */}
            <button
              type="button"
              onClick={() => {
                setSelectedMake("All");
                setMakeSearchInput("");
                setSelectedTrims([]);
                setIsMakeDropdownOpen(false);
                if (onSyncLiveInventory) {
                  onSyncLiveInventory(zipCode, searchRadius, searchQuery, undefined, resultsLimit);
                }
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg text-left transition-all cursor-pointer ${
                selectedMake === "All"
                  ? "bg-emerald-500/20 text-emerald-300 font-bold"
                  : "text-ink-muted hover:bg-surface hover:text-white"
              }`}
            >
              <span>All Makes & Brands</span>
              <span className="text-[10px] text-ink-faint font-mono">({vehicles.length} total)</span>
            </button>

            {/* Matching Makes Populated from Available Results */}
            {filteredMakesForAutocomplete.length > 0 ? (
              filteredMakesForAutocomplete.map((m) => (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => {
                    setSelectedMake(m.name);
                    setMakeSearchInput("");
                    setSelectedTrims([]);
                    setIsMakeDropdownOpen(false);
                    if (onSyncLiveInventory) {
                      onSyncLiveInventory(zipCode, searchRadius, searchQuery, m.name, resultsLimit);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg text-left transition-all cursor-pointer ${
                    selectedMake.toLowerCase() === m.name.toLowerCase()
                      ? "bg-emerald-500/20 text-emerald-300 font-bold"
                      : "text-ink-muted hover:bg-surface hover:text-white"
                  }`}
                >
                  <span className="font-medium text-white">{m.name}</span>
                  <span className="rounded-full bg-surface border border-border px-1.5 py-0.5 text-[10px] text-emerald-400 font-mono">
                    {m.count} available
                  </span>
                </button>
              ))
            ) : (
              <div className="p-3 text-center text-xs text-ink-muted">
                No matching makes found for "{makeSearchInput}"
              </div>
            )}
          </div>
        )}

        {/* Quick-Select Popular Brand Pills below Datafield */}
        {selectedMake === "All" && availableMakes.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {availableMakes.slice(0, 6).map((m) => (
              <button
                key={m.name}
                type="button"
                onClick={() => {
                  setSelectedMake(m.name);
                  setSelectedTrims([]);
                  if (onSyncLiveInventory) {
                    onSyncLiveInventory(zipCode, searchRadius, searchQuery, m.name, resultsLimit);
                  }
                }}
                className="rounded-lg border border-border bg-surface px-2 py-0.5 text-[10.5px] font-semibold text-ink-muted hover:text-white hover:border-emerald-500/40 transition-all flex items-center gap-1 cursor-pointer"
              >
                <span>{m.name}</span>
                <span className="text-[9px] text-ink-faint font-mono">({m.count})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2. Trim / Submodel Autofilling Datafield */}
      {availableTrimsData.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-border/50 relative" ref={trimDropdownRef}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider">Trim / Submodel</label>
              <span className="text-[9.5px] text-ink-faint font-mono">({availableTrimsData.length} available)</span>
            </div>
            {selectedTrims.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTrims([])}
                className="text-[10px] text-emerald-400 hover:underline font-bold cursor-pointer"
              >
                Clear ({selectedTrims.length})
              </button>
            )}
          </div>

          {/* Active Selected Trim Chips */}
          {selectedTrims.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedTrims.map((trim) => (
                <span
                  key={trim}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-950/70 border border-emerald-500/50 px-2 py-0.5 text-[11px] font-medium text-emerald-300 animate-fadeIn"
                >
                  <span>{trim}</span>
                  <button
                    type="button"
                    onClick={() => toggleTrim(trim)}
                    className="hover:text-white p-0.5 rounded cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Searchable Autofilling Input for Trim */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink-muted" />
            <input
              type="text"
              value={trimSearchInput}
              onChange={(e) => {
                setTrimSearchInput(e.target.value);
                setIsTrimDropdownOpen(true);
              }}
              onFocus={() => setIsTrimDropdownOpen(true)}
              placeholder="Search or pick trim (e.g. Rubicon, M Sport)..."
              className="w-full rounded-xl border border-border bg-surface pl-8 pr-7 py-2 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
            />
            {trimSearchInput && (
              <button
                type="button"
                onClick={() => {
                  setTrimSearchInput("");
                  setIsTrimDropdownOpen(false);
                }}
                className="absolute right-2.5 top-2.5 text-ink-muted hover:text-white cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Trim Autocomplete Dropdown Popover */}
          {isTrimDropdownOpen && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-52 overflow-y-auto rounded-xl border border-border bg-surface-elevated shadow-2xl p-1 divide-y divide-border/40 animate-fadeIn">
              {filteredTrimsForAutocomplete.length > 0 ? (
                filteredTrimsForAutocomplete.map((t) => {
                  const isChecked = selectedTrims.includes(t.name);
                  return (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => {
                        toggleTrim(t.name);
                        setTrimSearchInput("");
                        setIsTrimDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg text-left transition-all cursor-pointer ${
                        isChecked
                          ? "bg-emerald-500/20 text-emerald-300 font-bold"
                          : "text-ink-muted hover:bg-surface hover:text-white"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        {isChecked && <Check className="h-3 w-3 text-emerald-400 shrink-0" />}
                        <span className="truncate">{t.name}</span>
                      </div>
                      <span className="rounded-full bg-surface border border-border px-1.5 py-0.5 text-[10px] text-emerald-400 font-mono shrink-0 ml-1">
                        {t.count} cars
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="p-3 text-center text-xs text-ink-muted">
                  No matching trims found for "{trimSearchInput}"
                </div>
              )}
            </div>
          )}

          {/* Quick-Select Top Trim Pills */}
          {availableTrimsData.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {availableTrimsData.slice(0, 5).map((t) => {
                const isChecked = selectedTrims.includes(t.name);
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => toggleTrim(t.name)}
                    className={`rounded-lg border px-2 py-0.5 text-[10.5px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                      isChecked
                        ? "border-emerald-500 bg-emerald-950/60 text-emerald-300"
                        : "border-border bg-surface text-ink-muted hover:text-white hover:border-emerald-500/40"
                    }`}
                  >
                    <span>{t.name}</span>
                    <span className="text-[9px] text-ink-faint font-mono">({t.count})</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. Must-Have Factory Packages & Options (Visor.vin Signature) */}
      {availablePackagesData.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-border/50 relative" ref={packageDropdownRef}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-emerald-400" />
                <span>Must-Have Packages</span>
              </label>
              <span className="text-[9.5px] text-ink-faint font-mono">({availablePackagesData.length} available)</span>
            </div>
            {selectedPackages.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedPackages([])}
                className="text-[10px] text-emerald-400 hover:underline font-bold cursor-pointer"
              >
                Clear ({selectedPackages.length})
              </button>
            )}
          </div>

          {/* Active Selected Package Chips */}
          {selectedPackages.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedPackages.map((pkg) => (
                <span
                  key={pkg}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-950/70 border border-emerald-500/50 px-2 py-0.5 text-[11px] font-medium text-emerald-300 animate-fadeIn"
                >
                  <span className="truncate max-w-[150px]">📦 {pkg}</span>
                  <button
                    type="button"
                    onClick={() => togglePackage(pkg)}
                    className="hover:text-white p-0.5 rounded cursor-pointer shrink-0"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Searchable Autofilling Input for Packages */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink-muted" />
            <input
              type="text"
              value={packageSearchInput}
              onChange={(e) => {
                setPackageSearchInput(e.target.value);
                setIsPackageDropdownOpen(true);
              }}
              onFocus={() => setIsPackageDropdownOpen(true)}
              placeholder="Search packages & options (e.g. Cold Weather, Tow)..."
              className="w-full rounded-xl border border-border bg-surface pl-8 pr-7 py-2 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
            />
            {packageSearchInput && (
              <button
                type="button"
                onClick={() => {
                  setPackageSearchInput("");
                  setIsPackageDropdownOpen(false);
                }}
                className="absolute right-2.5 top-2.5 text-ink-muted hover:text-white cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Package Autocomplete Dropdown Popover */}
          {isPackageDropdownOpen && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-surface-elevated shadow-2xl p-1 divide-y divide-border/40 animate-fadeIn">
              {filteredPackagesForAutocomplete.length > 0 ? (
                filteredPackagesForAutocomplete.map((p) => {
                  const isChecked = selectedPackages.includes(p.name);
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => {
                        togglePackage(p.name);
                        setPackageSearchInput("");
                        setIsPackageDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg text-left transition-all cursor-pointer ${
                        isChecked
                          ? "bg-emerald-500/20 text-emerald-300 font-bold"
                          : "text-ink-muted hover:bg-surface hover:text-white"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isChecked ? "bg-emerald-400" : "bg-ink-faint"}`} />
                        <span className="truncate">{p.name}</span>
                      </div>
                      <span className="rounded-full bg-surface border border-border px-1.5 py-0.5 text-[10px] text-emerald-400 font-mono shrink-0 ml-1">
                        {p.count} cars
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="p-3 text-center text-xs text-ink-muted">
                  No matching options found for "{packageSearchInput}"
                </div>
              )}
            </div>
          )}

          {/* Quick-Select Top Package Pills */}
          {availablePackagesData.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {availablePackagesData.slice(0, 4).map((p) => {
                const isChecked = selectedPackages.includes(p.name);
                return (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => togglePackage(p.name)}
                    className={`rounded-lg border px-2 py-0.5 text-[10.5px] font-semibold transition-all flex items-center gap-1 cursor-pointer truncate max-w-full ${
                      isChecked
                        ? "border-emerald-500 bg-emerald-950/60 text-emerald-300"
                        : "border-border bg-surface text-ink-muted hover:text-white hover:border-emerald-500/40"
                    }`}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="text-[9px] text-ink-faint font-mono shrink-0">({p.count})</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 4. Drivetrain & Transmission with Live Result Counts */}
      <div className="space-y-2 pt-3 border-t border-border/50">
        <div className="flex items-center justify-between">
          <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider">Drivetrain</label>
          {selectedDrivetrains.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedDrivetrains([])}
              className="text-[10px] text-emerald-400 hover:underline font-bold cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {availableDrivetrainsData.map((dt) => {
            const isChecked = selectedDrivetrains.includes(dt.name);
            return (
              <button
                key={dt.name}
                type="button"
                onClick={() => toggleDrivetrain(dt.name)}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-between cursor-pointer ${
                  isChecked
                    ? "bg-emerald-500 text-black shadow-sm"
                    : "border border-border bg-surface text-ink-muted hover:text-white"
                }`}
              >
                <span>{dt.name}</span>
                <span className={`text-[10px] font-mono ${isChecked ? "text-black/80 font-bold" : "text-ink-faint"}`}>
                  ({dt.count})
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-2">
          <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider">Transmission</label>
          {selectedTransmissions.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTransmissions([])}
              className="text-[10px] text-emerald-400 hover:underline font-bold cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-1">
          {availableTransmissionsData.map((tr) => {
            const isChecked = selectedTransmissions.includes(tr.name);
            return (
              <button
                key={tr.name}
                type="button"
                onClick={() => toggleTransmission(tr.name)}
                className={`py-1.5 px-2 rounded-lg text-[10.5px] font-semibold transition-all flex items-center justify-between cursor-pointer ${
                  isChecked
                    ? "bg-emerald-500 text-black shadow-sm"
                    : "border border-border bg-surface text-ink-muted hover:text-white"
                }`}
              >
                <span>{tr.name}</span>
                <span className={`text-[10px] font-mono ${isChecked ? "text-black/80 font-bold" : "text-ink-faint"}`}>
                  ({tr.count})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 5. Body Type Filter with Live Counts */}
      {availableBodyTypesData.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-border/50">
          <div className="flex items-center justify-between">
            <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider">Body Type</label>
            {selectedBodyTypes.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedBodyTypes([])}
                className="text-[10px] text-emerald-400 hover:underline font-bold cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {availableBodyTypesData.slice(0, 6).map((bt) => {
              const isChecked = selectedBodyTypes.includes(bt.name);
              return (
                <button
                  key={bt.name}
                  type="button"
                  onClick={() => {
                    setSelectedBodyTypes(prev => 
                      prev.includes(bt.name) ? prev.filter(b => b !== bt.name) : [...prev, bt.name]
                    );
                  }}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-between cursor-pointer ${
                    isChecked
                      ? "bg-emerald-500 text-black shadow-sm"
                      : "border border-border bg-surface text-ink-muted hover:text-white"
                  }`}
                >
                  <span className="truncate">{bt.name}</span>
                  <span className={`text-[10px] font-mono ${isChecked ? "text-black/80 font-bold" : "text-ink-faint"}`}>
                    ({bt.count})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 6. Exterior Color Family with Live Counts */}
      <div className="space-y-2 pt-3 border-t border-border/50">
        <div className="flex items-center justify-between">
          <label className="font-bold text-ink-light uppercase text-[10px] tracking-wider">Exterior Color</label>
          {selectedColors.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedColors([])}
              className="text-[10px] text-emerald-400 hover:underline font-bold cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {availableColorsData.map((c) => {
            const isChecked = selectedColors.includes(c.match);
            return (
              <button
                key={c.match}
                type="button"
                onClick={() => toggleColor(c.match)}
                className={`flex items-center justify-between px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-all cursor-pointer ${
                  isChecked
                    ? "border-emerald-500 bg-emerald-950/40 text-white"
                    : "border-border bg-surface text-ink-muted hover:text-white"
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className={`h-2.5 w-2.5 rounded-full border shrink-0 ${c.bg}`} />
                  <span className="truncate">{c.label}</span>
                </div>
                <span className="text-[10px] text-ink-faint font-mono shrink-0 ml-1">
                  ({c.count})
                </span>
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
          min={20000}
          max={350000}
          step={5000}
          value={maxPrice}
          onChange={(e) => setMaxPrice(Number(e.target.value))}
          className="w-full accent-emerald-400 cursor-pointer"
        />
        <div className="flex justify-between text-[10px] text-ink-faint font-mono">
          <span>$20k</span>
          <span>$150k</span>
          <span>$350k+</span>
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
              onClick={() => {
                setSearchRadius(opt.value);
                if (onSyncLiveInventory) {
                  onSyncLiveInventory(zipCode, opt.value, searchQuery, selectedMake !== "All" ? selectedMake : undefined);
                }
              }}
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
            className="text-emerald-400 hover:underline font-bold"
          >
            Change
          </button>
        </div>
      </div>
    </div>
  );

  // Reusable Location / ZIP Change Modal
  const renderLocationModal = () => {
    if (!isLocationOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
        <div className="relative w-full max-w-md rounded-2xl border border-border-strong bg-surface p-6 shadow-2xl space-y-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-emerald-400" />
              <h3 className="font-bold text-white text-base">Change Search Location</h3>
            </div>
            <button
              onClick={() => setIsLocationOpen(false)}
              className="rounded-lg p-1 text-ink-muted hover:bg-border hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-bold text-ink-light uppercase">Enter 5-Digit US ZIP Code</label>
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={5}
                placeholder="e.g. 90210, 10001, 75201..."
                value={zipInput}
                onChange={(e) => setZipInput(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleApplyZip();
                }}
                className="flex-1 rounded-xl border border-border bg-background py-2.5 px-4 text-base font-mono text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={() => handleApplyZip()}
                className="rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-black text-black hover:bg-emerald-400 transition-all shadow-md active:scale-95 shrink-0"
              >
                Update
              </button>
            </div>
            <p className="text-[11px] text-ink-muted">
              Active: <strong className="text-white font-mono">{zipCode}</strong> ({zipInfo.city}, {zipInfo.state})
            </p>
          </div>

          {/* Popular Metro Quick Picks */}
          <div className="space-y-2 pt-2 border-t border-border">
            <span className="text-[10px] uppercase font-bold text-ink-faint">Popular Metro Regions:</span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { city: "San Francisco, CA", zip: "94107" },
                { city: "Los Angeles, CA", zip: "90210" },
                { city: "New York, NY", zip: "10001" },
                { city: "Dallas, TX", zip: "75201" },
                { city: "Miami, FL", zip: "33101" },
                { city: "Chicago, IL", zip: "60601" },
              ].map((m) => (
                <button
                  key={m.zip}
                  type="button"
                  onClick={() => handleApplyZip(m.zip)}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-surface-elevated hover:border-emerald-500/50 hover:bg-background text-left transition-all"
                >
                  <span className="font-medium text-white truncate text-[11px]">{m.city}</span>
                  <span className="text-[10px] font-mono text-emerald-400 font-bold ml-1">{m.zip}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

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

            {/* Change Location Button in Search Bar */}
            <button
              type="button"
              onClick={() => setIsLocationOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated/70 hover:bg-border px-3.5 py-3 text-xs font-bold text-ink-light hover:text-white shrink-0 transition-all"
            >
              <MapPin className="h-4 w-4 text-emerald-400" />
              <span className="font-mono">{zipCode}</span>
              <span className="text-[10px] text-ink-muted hidden sm:inline font-normal">({zipInfo.city})</span>
            </button>

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

          {/* Live Dealership Inventory Connector Banner */}
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4 flex flex-wrap items-center justify-between gap-3 text-xs mt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                <Radio className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-sm">Live Dealership Network Connected</span>
                  <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                </div>
                <p className="text-[11px] text-ink-muted">
                  Auto-syncing certified dealer allocations within {searchRadius >= 3000 ? "Nationwide" : `${searchRadius} miles`} of {zipCode}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {onSyncLiveInventory && (
                <button
                  type="button"
                  disabled={isSyncingInventory}
                  onClick={() => onSyncLiveInventory(zipCode, searchRadius)}
                  className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-xs font-bold text-ink-light hover:text-white hover:border-emerald-500/40 transition-all shadow-sm"
                >
                  <RefreshCw className={`h-3.5 w-3.5 text-emerald-400 ${isSyncingInventory ? "animate-spin" : ""}`} />
                  <span>{isSyncingInventory ? "Syncing..." : "Sync Live Lots"}</span>
                </button>
              )}

              {onOpenConnectorModal && (
                <button
                  type="button"
                  onClick={onOpenConnectorModal}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 px-3.5 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/30 transition-all shadow-sm"
                >
                  <Sliders className="h-3.5 w-3.5" />
                  <span>Feed Settings</span>
                </button>
              )}

              {onOpenScraperModal && (
                <button
                  type="button"
                  onClick={onOpenScraperModal}
                  className="flex items-center gap-1.5 rounded-xl bg-purple-500/20 border border-purple-500/30 px-3.5 py-2 text-xs font-bold text-purple-300 hover:bg-purple-500/30 transition-all shadow-sm"
                >
                  <Cpu className="h-3.5 w-3.5 text-purple-400" />
                  <span>4 CMS Scrapers</span>
                </button>
              )}
            </div>
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

        {/* Location Change Modal */}
        {renderLocationModal()}
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

      {/* Live Dealership Inventory Connector Bar */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
            <Radio className="h-3.5 w-3.5 animate-pulse" />
          </div>
          <div>
            <span className="font-bold text-white">Live Dealership Network Active: </span>
            <span className="text-ink-muted">
              {sortedVehicles.length} vehicles found within {searchRadius >= 3000 ? "Nationwide" : `${searchRadius} miles`} of {zipCode}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onSyncLiveInventory && (
            <button
              type="button"
              disabled={isSyncingInventory}
              onClick={() => onSyncLiveInventory(zipCode, searchRadius)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-ink-light hover:text-white hover:border-emerald-500/40 transition-all"
            >
              <RefreshCw className={`h-3 w-3 text-emerald-400 ${isSyncingInventory ? "animate-spin" : ""}`} />
              <span>{isSyncingInventory ? "Syncing..." : "Sync Lots"}</span>
            </button>
          )}

          {onOpenConnectorModal && (
            <button
              type="button"
              onClick={onOpenConnectorModal}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-1 text-xs font-bold text-emerald-400 hover:bg-emerald-500/30 transition-all"
            >
              <Sliders className="h-3 w-3" />
              <span>Feed Settings</span>
            </button>
          )}
        </div>
      </div>

      {/* 2-COLUMN VISOR.VIN STYLE RESULTS + FILTER SYSTEM */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* DESKTOP FILTER SIDEBAR (Left Column) */}
        <aside className="hidden lg:block lg:col-span-1 space-y-6 bg-surface/40 p-4 rounded-2xl border border-border/80 h-fit sticky top-20">
          {renderFilterSidebarContent()}
        </aside>

        {/* RESULTS CONTENT (Right Column) */}
        <main className="lg:col-span-3 space-y-4">
          
          {/* Live Syncing Feedback */}
          {isSyncingInventory && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-3.5 flex items-center justify-center gap-2.5 text-xs text-emerald-300 animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
              <span className="font-bold">Syncing live dealership network allocations across {searchRadius >= 3000 ? "Nationwide" : `${searchRadius} miles`} of {zipCode}...</span>
            </div>
          )}

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

              <div className="text-xs text-ink-muted flex items-center gap-1.5 flex-wrap">
                <span>Showing <strong className="text-white font-bold">{sortedVehicles.length}</strong> {totalFoundVehicles > 0 ? `of ${totalFoundVehicles.toLocaleString()}+` : ""} cars</span>
              </div>
            </div>

            {/* Results Limit & Sort Controls */}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {/* Batch Size Selector */}
              <div className="flex items-center gap-1 bg-surface-elevated p-1 rounded-lg border border-border">
                <span className="text-[10px] text-ink-faint font-bold px-1 uppercase">Batch:</span>
                {[100, 250, 500, 1000].map((lim) => (
                  <button
                    key={lim}
                    type="button"
                    onClick={() => {
                      setResultsLimit(lim);
                      if (onSyncLiveInventory) {
                        onSyncLiveInventory(zipCode, searchRadius, searchQuery, selectedMake !== "All" ? selectedMake : undefined, lim);
                      }
                    }}
                    className={`px-2 py-0.5 rounded text-[10.5px] font-bold font-mono transition-all ${
                      resultsLimit === lim
                        ? "bg-emerald-500 text-black shadow-sm"
                        : "text-ink-muted hover:text-white"
                    }`}
                  >
                    {lim === 1000 ? "1K (Max)" : lim}
                  </button>
                ))}
              </div>

              {/* Sort Dropdown */}
              <div className="flex items-center gap-1.5">
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
            <div className="space-y-2.5">
              {sortedVehicles.map((vehicle) => {
                const discountDollars = Math.max(0, vehicle.msrp - vehicle.dealerPrice);
                const discountPercent = ((discountDollars / vehicle.msrp) * 100).toFixed(1);
                const isExpanded = expandedBuildSheet === vehicle.id;
                const isViewed = viewedVehicleIds.includes(vehicle.id) || Boolean(vehicle.vin && viewedVehicleIds.includes(vehicle.vin));

                return (
                  <div
                    key={vehicle.id}
                    onClick={() => markVehicleAsViewed(vehicle.id, vehicle.vin)}
                    className={`group rounded-xl border bg-surface hover:border-emerald-500/40 hover:bg-surface-elevated transition-all overflow-hidden shadow-sm ${
                      isViewed ? "border-border/60 opacity-85 hover:opacity-100" : "border-border/90"
                    }`}
                  >
                    {/* Fixed Height Uniform Card Row */}
                    <div className="flex flex-col sm:flex-row sm:h-[130px]">
                      {/* Left: Fixed Dimension Vehicle Photo with Overlaid Price & Days Listed */}
                      <div className="relative w-full sm:w-44 h-32 sm:h-full shrink-0 bg-background overflow-hidden">
                        <img
                          src={vehicle.imageUrl}
                          alt={`${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}`}
                          className={`h-full w-full object-cover transition-all duration-500 ${
                            isViewed
                              ? "grayscale contrast-90 brightness-90 opacity-60 group-hover:grayscale-0 group-hover:opacity-100"
                              : "group-hover:scale-105"
                          }`}
                          loading="lazy"
                        />
                        
                        {/* Status & Days Listed Badge (Top-Left of picture) */}
                        <div className="absolute top-1.5 left-1.5">
                          {vehicle.status === "on_lot" ? (
                            <span className="inline-flex items-center gap-1 rounded bg-black/90 backdrop-blur-md px-1.5 py-0.5 text-[8.5px] font-extrabold text-emerald-400 border border-emerald-500/40 shadow-sm leading-none">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              {vehicle.daysOnLot} Days Listed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-black/90 backdrop-blur-md px-1.5 py-0.5 text-[8.5px] font-extrabold text-blue-400 border border-blue-500/40 shadow-sm leading-none">
                              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                              In Transit • {vehicle.daysOnLot}d
                            </span>
                          )}
                        </div>

                        {/* Viewed Status Badge (Top-Right of picture) */}
                        {isViewed && (
                          <div className="absolute top-1.5 right-1.5 z-10">
                            <span className="inline-flex items-center gap-1 rounded bg-black/95 backdrop-blur-md px-1.5 py-0.5 text-[8px] font-black text-ink-muted border border-border shadow-md leading-none">
                              <Eye className="h-2.5 w-2.5 text-ink-faint" />
                              VIEWED
                            </span>
                          </div>
                        )}

                        {/* Price Tag Floating Inside Picture (Bottom-Right of picture) */}
                        <div className="absolute bottom-1.5 right-1.5">
                          <span className="inline-flex items-center rounded-md bg-black/90 backdrop-blur-md px-1.5 py-0.5 text-[11px] font-black text-white border border-emerald-500/50 shadow-md leading-none">
                            {formatCurrency(vehicle.dealerPrice)}
                          </span>
                        </div>

                        {/* Distance Badge (Bottom-Left of picture) */}
                        <div className="absolute bottom-1.5 left-1.5">
                          <span className="inline-flex items-center gap-0.5 rounded bg-black/85 backdrop-blur-md px-1 py-0.5 text-[8px] font-bold text-white border border-border leading-none">
                            <MapPin className="h-2 w-2 text-emerald-400" />
                            <span className="font-mono">{vehicle.dynamicDistance} mi</span>
                          </span>
                        </div>
                      </div>

                      {/* Middle: Uniform 4-Row Clamped Specs Column */}
                      <div className="flex-1 p-2.5 sm:p-3 flex flex-col justify-between min-w-0 overflow-hidden h-full">
                        {/* Row 1: Title & VIN & Porsche Code */}
                        <div className="flex items-center justify-between gap-1.5 min-w-0">
                          <div className="flex items-center gap-1 min-w-0 truncate">
                            <span className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-400 shrink-0">
                              {vehicle.year} {vehicle.make}
                            </span>
                            <span className="text-border shrink-0">•</span>
                            <h3 className="font-bold text-white text-xs sm:text-sm truncate leading-none">
                              {vehicle.model} <span className="text-ink-light font-medium text-[11px]">{vehicle.trim}</span>
                            </h3>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {vehicle.porscheCode && (
                              <a
                                href={`https://porsche-code.com/${vehicle.porscheCode}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="hidden sm:inline-flex items-center gap-0.5 text-[8.5px] font-mono font-bold text-rose-400 bg-rose-950/60 hover:bg-rose-900/60 border border-rose-500/30 px-1.5 py-0.5 rounded leading-none transition-colors"
                                title="Open Official 3D Porsche Configurator Build Sheet"
                              >
                                <span>Code: {vehicle.porscheCode}</span>
                                <ExternalLink className="h-2 w-2 text-rose-400/80" />
                              </a>
                            )}
                            <span className="text-[8.5px] font-mono text-ink-muted bg-background px-1.5 py-0.5 rounded border border-border leading-none">
                              {vehicle.vin}
                            </span>
                          </div>
                        </div>

                        {/* Row 2: Transmission • Engine • Drivetrain • Exterior */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-ink-muted leading-tight">
                          <span className="text-ink-light">{vehicle.transmission}</span>
                          <span>•</span>
                          <span>{vehicle.engine}</span>
                          <span>•</span>
                          <span className="font-semibold text-white">{vehicle.drivetrain}</span>
                          <span>•</span>
                          <span className="text-ink-light">{vehicle.exteriorColor}</span>
                        </div>

                        {/* Row 3: Dealership Name & Distance */}
                        <div className="flex items-center justify-between gap-2 text-[10.5px]">
                          <div className="flex items-center gap-1 text-ink-muted truncate min-w-0">
                            <MapPin className="h-3 w-3 text-emerald-400 shrink-0" />
                            {vehicle.dealerUrl ? (
                              <a
                                href={vehicle.dealerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markVehicleAsViewed(vehicle.id, vehicle.vin);
                                }}
                                className="text-white font-medium hover:text-emerald-400 hover:underline truncate transition-colors flex items-center gap-1"
                                title={`Open ${vehicle.location.dealerName} Listing`}
                              >
                                <span>{vehicle.location.dealerName}</span>
                                <ExternalLink className="h-2 w-2 text-emerald-400/70 inline shrink-0" />
                              </a>
                            ) : (
                              <span className="text-white font-medium truncate">{vehicle.location.dealerName}</span>
                            )}
                            <span className="text-ink-faint">({vehicle.location.city}, {vehicle.location.state})</span>
                          </div>

                          {discountDollars > 0 ? (
                            <span className="text-[10px] font-extrabold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30 shrink-0">
                              {discountPercent}% Off MSRP
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold text-ink-faint shrink-0">
                              MSRP {formatCurrency(vehicle.msrp)}
                            </span>
                          )}
                        </div>

                        {/* Row 4: Action Buttons (Build Sheet, Dealer Link, Reverse Bid) */}
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              markVehicleAsViewed(vehicle.id, vehicle.vin);
                              setExpandedBuildSheet(isExpanded ? null : vehicle.id);
                            }}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-ink-light hover:text-emerald-400 transition-colors"
                          >
                            <span>Build Sheet ({vehicle.options.length})</span>
                            <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                          </button>

                          <div className="flex items-center gap-1.5">
                            {/* Copy VIN Quick Action */}
                            <button
                              type="button"
                              onClick={(e) => handleCopyVin(vehicle.vin, e)}
                              className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-surface px-2 py-1 text-[10px] font-mono text-ink-muted hover:text-white hover:border-emerald-500/40 transition-all"
                              title="Copy 17-digit VIN"
                            >
                              {copiedVin === vehicle.vin ? (
                                <>
                                  <Check className="h-2.5 w-2.5 text-emerald-400" />
                                  <span className="text-emerald-400 font-bold">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-2.5 w-2.5" />
                                  <span>VIN</span>
                                </>
                              )}
                            </button>

                            {/* Official Dealer Website / Direct Listing */}
                            {vehicle.dealerUrl && (
                              <a
                                href={vehicle.dealerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markVehicleAsViewed(vehicle.id, vehicle.vin);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-border/90 bg-surface-elevated hover:bg-surface-elevated/80 px-2.5 py-1 text-[10px] font-bold text-emerald-400 hover:text-emerald-300 hover:border-emerald-500/40 transition-all shadow-sm"
                                title={`Open Direct Dealer Listing for ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.vin})`}
                              >
                                <span>Dealer Site</span>
                                <ExternalLink className="h-2.5 w-2.5 text-emerald-400" />
                              </a>
                            )}

                            {/* Request Reverse Bids */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                markVehicleAsViewed(vehicle.id, vehicle.vin);
                                onSelectForBid(vehicle);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-2.5 py-1 text-[10px] font-extrabold text-black transition-all shadow-sm shadow-emerald-500/20"
                            >
                              <Zap className="h-2.5 w-2.5 fill-black" />
                              <span>Request Bids</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Expandable Build Sheet Drawer (Renders below card when opened) */}
                    {isExpanded && (
                      <div className="border-t border-border-strong bg-background/95 p-3 text-xs space-y-2 animate-fadeIn">
                        <div className="flex items-center justify-between border-b border-border pb-1.5 flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-ink-light uppercase text-[8.5px] tracking-wider text-emerald-400">
                              Factory Option Build Sheet ({vehicle.options.length} line items)
                            </span>
                            {vehicle.porscheCode && (
                              <a
                                href={`https://porsche-code.com/${vehicle.porscheCode}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[9px] font-mono font-bold text-rose-400 bg-rose-950/60 border border-rose-500/30 px-1.5 py-0.5 rounded hover:bg-rose-900/60 transition-colors"
                              >
                                <span>3D Configurator ({vehicle.porscheCode})</span>
                                <ExternalLink className="h-2 w-2 text-rose-400" />
                              </a>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <a
                              href={`https://vpic.nhtsa.dot.gov/decoder/Decoder?vin=${vehicle.vin}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[9.5px] text-ink-muted hover:text-white font-medium transition-colors"
                            >
                              <span>NHTSA Specs</span>
                              <ExternalLink className="h-2.5 w-2.5 text-ink-faint" />
                            </a>

                            <span className="text-border">•</span>

                            <a
                              href={`https://www.carfax.com/VehicleHistory/p/Report.cfx?vin=${vehicle.vin}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[9.5px] text-ink-muted hover:text-white font-medium transition-colors"
                            >
                              <span>Carfax</span>
                              <ExternalLink className="h-2.5 w-2.5 text-ink-faint" />
                            </a>

                            {vehicle.dealerUrl && (
                              <>
                                <span className="text-border">•</span>
                                <a
                                  href={vehicle.dealerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={() => markVehicleAsViewed(vehicle.id, vehicle.vin)}
                                  className="inline-flex items-center gap-1 text-[9.5px] text-emerald-400 hover:underline font-bold"
                                  title="Open Direct VDP Link on Dealership Website"
                                >
                                  <span>Open Dealership Listing</span>
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              </>
                            )}

                            <span className="text-border">•</span>
                            <a
                              href={`https://www.google.com/search?q=${encodeURIComponent(`${vehicle.location.dealerName} "${vehicle.vin}"`)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[9.5px] text-ink-muted hover:text-emerald-400 font-medium transition-colors"
                              title="Search exact VIN across dealer domain index"
                            >
                              <span>Verify on Lot</span>
                              <ExternalLink className="h-2.5 w-2.5 text-ink-faint" />
                            </a>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
                          {vehicle.options.map((opt) => (
                            <div key={opt.code} className="flex justify-between text-[9.5px] border-b border-border/30 pb-0.5">
                              <span className="text-ink-muted truncate mr-2">
                                <strong className="text-white font-mono mr-1">[{opt.code}]</strong>
                                {opt.name}
                              </span>
                              <span className="text-emerald-400 font-medium shrink-0">+{formatCurrency(opt.price)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Load More Vehicles Button */}
              {onLoadMoreLiveInventory && hasMoreVehicles && (
                <div className="pt-6 pb-4 flex flex-col items-center gap-2.5">
                  <button
                    type="button"
                    disabled={isLoadingMore}
                    onClick={() => onLoadMoreLiveInventory()}
                    className="w-full sm:w-auto min-w-[320px] flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400 hover:from-emerald-400 hover:to-teal-300 px-8 py-3.5 text-xs font-black text-black shadow-xl shadow-emerald-500/25 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isLoadingMore ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-black" />
                        <span>Streaming Live Dealer Allocations...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 text-black" />
                        <span>Stream Next 150 Vehicles (+150 Live Cars)</span>
                      </>
                    )}
                  </button>
                  <span className="text-xs text-ink-muted">
                    Showing <strong className="text-white font-bold">{sortedVehicles.length}</strong> {totalFoundVehicles > 0 ? `of ${totalFoundVehicles.toLocaleString()}+` : ""} live lot postings across US Dealerships
                  </span>
                </div>
              )}
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

            {renderFilterSidebarContent()}

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

      {/* Location Change Modal */}
      {renderLocationModal()}
    </div>
  );
};
