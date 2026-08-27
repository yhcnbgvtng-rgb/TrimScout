"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
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
  Loader2,
} from "lucide-react";
import {
  PorscheOption,
  NhtsaSpec,
} from "@/lib/enrichmentEngine";
import { calculateDistanceMiles, getZipCoordinates } from "@/lib/otdCalculator";
import { DailyChangesPanel } from "./DailyChangesPanel";
// Type-only import: safe to reference in this client component because
// TypeScript types are erased at build time. The *runtime* functions in
// lib/lightsailClient.ts (which read process.env.LIGHTSAIL_API_KEY and talk
// directly to the Lightsail box) are never imported here — this component
// only ever calls our own /api/lightsail proxy, exactly like before.
import type { BoxVehicle } from "@/lib/lightsailClient";

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

// ===========================================================================
// Step 6 of the architecture migration: data layer rewrite.
//
// The component used to fetch the ENTIRE dataset once (`/api/lightsail`,
// default action) and do all filtering/sorting/faceting/pagination in
// memory via useMemo chains. It now talks to the new, paginated/filtered
// `action=vehicles` and `action=facets` query paths added to
// app/api/lightsail/route.ts in Step 5, which are themselves backed by the
// MariaDB-backed box API (with the existing CSV/JSON/fixtures chain as an
// automatic fallback — see LEGACY_FALLBACK handling below).
//
// One real architectural wrinkle surfaced doing this: the box API requires
// a single `brand` ("porsche" | "ford") on every /api/vehicles and
// /api/vehicles/facets call — there is no "all brands combined" query.
// The old client-side dataset silently merged both brands into one array,
// and the "Make" dropdown (ALL / Porsche / Ford) was just a filter over
// that merged array. To keep that exact user-facing behavior (view all
// makes at once, or narrow to one), when "ALL" is selected this component
// now fires one request per brand and merges the results client-side
// (see BRANDS / brandsForQuery below) — see the report for the precise
// tradeoffs (pagination across a merged "All Makes" view is a best-effort
// re-sort of each merged page rather than a single global sort).
// ===========================================================================

type Brand = "porsche" | "ford" | "chevrolet";
const BRANDS: Brand[] = ["porsche", "ford", "chevrolet"];

interface ApiPagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

interface ApiStats {
  totalActive: number;
  priceDrops: number;
  newArrivals: number;
  staleCount: number;
  avgDaysOnLot: number;
  dealershipsCount: number;
}

interface VehiclesApiResponse {
  success: boolean;
  source: "box_api" | "legacy_fallback";
  vehicles: any[];
  pagination: ApiPagination;
  stats: ApiStats;
}

interface FacetValue {
  value: string;
  count: number;
}

interface FacetsApiResponse {
  success: boolean;
  source: "box_api" | "legacy_fallback";
  facets: Record<string, FacetValue[]>;
}

const EMPTY_PAGINATION: ApiPagination = { page: 1, pageSize: 50, totalCount: 0, totalPages: 1 };
const EMPTY_STATS: ApiStats = { totalActive: 0, priceDrops: 0, newArrivals: 0, staleCount: 0, avgDaysOnLot: 0, dealershipsCount: 0 };

// ---------------------------------------------------------------------------
// Mapping: raw API vehicle shape -> the unchanged VehicleRecord shape the
// rest of this file (and DailyChangesPanel, and the modal) already renders.
//
// Two raw shapes are possible depending on which tier answered the request
// (see app/api/lightsail/route.ts): the box API's snake_case DB row
// (BoxVehicle, when source === "box_api"), or the legacy CSV/JSON
// camelCase shape (already close to VehicleRecord, when source ===
// "legacy_fallback"). Both are mapped here so nothing downstream needs to
// know which tier answered.
// ---------------------------------------------------------------------------
function mapApiVehicleToRecord(raw: any, source: "box_api" | "legacy_fallback"): VehicleRecord {
  if (source === "legacy_fallback") {
    return {
      vin: raw.vin,
      dealerName: raw.dealerName || "",
      state: raw.state || "",
      inventoryType: raw.inventoryType || "",
      year: raw.year || 0,
      make: raw.make || "",
      model: raw.model || "",
      trim: raw.trim || undefined,
      price: raw.price ?? null,
      oldPrice: raw.oldPrice ?? undefined,
      priceDiff: typeof raw.priceDiff === "number" ? raw.priceDiff : undefined,
      mileage: raw.mileage || 0,
      status: raw.status || undefined,
      changeType: raw.changeType || undefined,
      daysOnLot: typeof raw.daysOnLot === "number" ? raw.daysOnLot : undefined,
      firstSeen: raw.firstSeen || undefined,
      lastSeen: raw.lastSeen || undefined,
      url: raw.url || undefined,
    };
  }

  const bv = raw as BoxVehicle;
  const options = bv.options || [];
  const factoryOptions: PorscheOption[] = options.map((o) => ({
    code: o.code,
    name: o.name,
    price: typeof o.price === "number" ? o.price : undefined,
    category: o.category || "option",
  }));
  const optionCodes = options.map((o) => o.code);
  // The box stores a `source` per option rather than one optionsSource per
  // vehicle like the legacy JSON snapshot did; best-effort stand-in using
  // the first option's source, same approach used in
  // app/api/porsche-sticker/route.ts's mapBoxVehicleToStickerRecord.
  const firstSource = options[0]?.source;
  const optionsSource: VehicleRecord["optionsSource"] =
    firstSource === "PORSCHE_FINDER" ? "PORSCHE_FINDER" : firstSource === "DEALER_VDP" ? "DEALER_VDP" : undefined;

  const standardEquipment = bv.standard_equipment
    ? bv.standard_equipment.split(/[,|;]\s*/).map((s) => s.trim()).filter(Boolean)
    : undefined;

  const e = bv.enrichment;
  const nhtsa: NhtsaSpec | undefined = e
    ? {
        plantCountry: e.nhtsa_plant_country || "",
        plantCity: e.nhtsa_plant_city || undefined,
        engineCylinders: e.nhtsa_engine_cylinders || 0,
        engineDisplacementL: e.nhtsa_engine_displ_l || "",
        bodyClass: e.nhtsa_body_class || "",
        brakeSystem: (e as any).nhtsa_brake_system || undefined,
        fuelType: e.nhtsa_fuel_type || undefined,
      }
    : undefined;

  return {
    vin: bv.vin,
    dealerName: bv.dealer_name || "",
    state: bv.state || "",
    inventoryType: bv.inventory_type || "",
    year: bv.year || 0,
    make: bv.make || "",
    model: bv.model || "",
    trim: bv.trim || undefined,
    bodyStyle: bv.body_style || undefined,
    price: bv.price,
    oldPrice: bv.old_price,
    priceDiff: typeof bv.price_diff === "number" ? bv.price_diff : undefined,
    msrp: bv.msrp,
    mileage: bv.mileage || 0,
    status: bv.status || undefined,
    changeType: bv.change_type || undefined,
    daysOnLot: typeof bv.days_on_lot === "number" ? bv.days_on_lot : undefined,
    // dealer_city is only present on the box API (a LEFT JOIN to dealers
    // added specifically to fix per-vehicle distance calculation — the
    // vehicles table itself only stores state, not city; every card was
    // silently falling back to the same default location and showing an
    // identical "X mi" badge on every single result before this).
    city: bv.dealer_city || undefined,
    firstSeen: bv.first_seen_date || undefined,
    lastSeen: bv.last_seen_date || undefined,
    url: bv.url || undefined,
    engine: bv.engine,
    transmission: bv.transmission,
    exteriorColor: bv.exterior_color,
    nhtsa,
    factoryOptions,
    optionCodes,
    totalOptionsPrice: typeof bv.total_options_price === "number" ? bv.total_options_price : undefined,
    baseMsrp: bv.base_msrp,
    enrichedAt: e?.enriched_at || undefined,
    optionsSource,
    standardEquipment,
    // The box doesn't persist a per-vehicle Porsche Finder URL.
    finderUrl: undefined,
    imageUrl: bv.image_url || undefined,
  };
}

// ---------------------------------------------------------------------------
// Query-param mapping. The box API (scrapers/lightsail-crawler/src/
// inventory_api_server.js) defines its own vocabulary for sort and
// days-on-lot/opportunity buckets that doesn't exactly match this
// component's existing <select> option values, so these maps translate
// between the two without changing what the user sees in the dropdowns.
// ---------------------------------------------------------------------------

// Sort values the box actually implements server-side (inventory_api_server.js
// sortMap). "closest_to_zip" is handled separately (needs lat/lng).
const SUPPORTED_SORT_MAP: Record<string, string> = {
  price_desc: "price_desc",
  price_asc: "price_asc",
  days_desc: "days_on_lot", // box's days_on_lot sort is always "longest first" — matches this option exactly
  year_desc: "year",
};
// Sort values this UI offers that the box API has no server-side support
// for yet (confirmed against inventory_api_server.js's sortMap, which is
// out of scope to modify here). For a single selected brand, these fall
// back to the server's default order (newest first) rather than silently
// mis-sorting; when "All Makes" is active the merge step below re-sorts
// each combined page client-side using the same comparator as before, so
// these sorts DO work correctly in that mode.
const UNSUPPORTED_SINGLE_BRAND_SORTS = new Set(["price_drop_first", "days_asc", "mileage_asc"]);

const DAYS_ON_LOT_RANGES: Record<string, { min?: number; max?: number }> = {
  under_7: { max: 7 },
  "7_to_30": { min: 7, max: 30 },
  "31_to_60": { min: 31, max: 60 },
  over_45: { min: 45 },
  over_60: { min: 60 },
};

// UI values ("PRICE_DROPS"/"NEW_ARRIVALS") -> box `opportunity` enum values.
const OPPORTUNITY_MAP: Record<string, string> = {
  PRICE_DROPS: "drops",
  NEW_ARRIVALS: "fresh",
};

// Facet dimensions the box API supports natively (inventory_api_server.js
// FACET_DIMENSIONS). Note there is no "option" dimension — see the Factory
// Option catalog handling further down for how that gap is covered.
const FACET_DIMS = ["make", "model", "trim", "dealer", "state", "bodyStyle", "condition"] as const;
type FacetDim = (typeof FACET_DIMS)[number];

function buildQueryString(params: Record<string, string>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, v);
  }
  return sp.toString();
}

async function fetchVehiclesPage(brand: Brand, params: Record<string, string>): Promise<VehiclesApiResponse | null> {
  try {
    const qs = buildQueryString({ action: "vehicles", brand, ...params });
    const res = await fetch(`/api/lightsail?${qs}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.success === false) return null;
    return json as VehiclesApiResponse;
  } catch {
    return null;
  }
}

async function fetchFacetsPage(brand: Brand, params: Record<string, string>): Promise<FacetsApiResponse | null> {
  try {
    const qs = buildQueryString({ action: "facets", brand, ...params });
    const res = await fetch(`/api/lightsail?${qs}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.success === false) return null;
    return json as FacetsApiResponse;
  } catch {
    return null;
  }
}

function mergeFacetValueArrays(arrays: FacetValue[][]): FacetValue[] {
  const counts = new Map<string, number>();
  for (const arr of arrays) {
    for (const { value, count } of arr) {
      counts.set(value, (counts.get(value) || 0) + count);
    }
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

function mergeStats(all: ApiStats[]): ApiStats {
  if (all.length === 0) return EMPTY_STATS;
  const totalActive = all.reduce((s, x) => s + x.totalActive, 0);
  const weightedDays = all.reduce((s, x) => s + x.avgDaysOnLot * x.totalActive, 0);
  return {
    totalActive,
    priceDrops: all.reduce((s, x) => s + x.priceDrops, 0),
    newArrivals: all.reduce((s, x) => s + x.newArrivals, 0),
    staleCount: all.reduce((s, x) => s + x.staleCount, 0),
    avgDaysOnLot: totalActive > 0 ? weightedDays / totalActive : 0,
    // Porsche and Ford dealer networks are disjoint in this dataset, so a
    // plain sum (rather than a deduped count, which would need another
    // query) is accurate, not just an approximation.
    dealershipsCount: all.reduce((s, x) => s + x.dealershipsCount, 0),
  };
}

// Client-side comparator used ONLY to re-sort a merged "All Makes" page
// (porsche results + ford results concatenated) into one consistent order.
// For a single selected brand the server already returns a correctly
// sorted, correctly paginated page, so this is never applied there.
function sortMergedVehicles(vehicles: VehicleRecord[], sortBy: string, userZip: string, getVehicleDistance: (v: VehicleRecord) => number): VehicleRecord[] {
  const arr = [...vehicles];
  arr.sort((a, b) => {
    if (sortBy === "closest_to_zip") {
      const distA = getVehicleDistance(a);
      const distB = getVehicleDistance(b);
      if (distA !== distB) return distA - distB;
      const pA = a.price && a.price > 0 && a.price < 5000000 ? a.price : 0;
      const pB = b.price && b.price > 0 && b.price < 5000000 ? b.price : 0;
      return pA - pB;
    }
    if (sortBy === "price_desc") {
      const pA = a.price && a.price > 0 && a.price < 5000000 ? a.price : 0;
      const pB = b.price && b.price > 0 && b.price < 5000000 ? b.price : 0;
      return pB - pA;
    }
    if (sortBy === "price_asc") {
      const pA = a.price && a.price > 0 && a.price < 5000000 ? a.price : Infinity;
      const pB = b.price && b.price > 0 && b.price < 5000000 ? b.price : Infinity;
      return pA - pB;
    }
    if (sortBy === "price_drop_first") {
      const dropA = Math.abs(a.priceDiff && a.priceDiff < 0 && Math.abs(a.priceDiff) < 5000000 ? a.priceDiff : 0);
      const dropB = Math.abs(b.priceDiff && b.priceDiff < 0 && Math.abs(b.priceDiff) < 5000000 ? b.priceDiff : 0);
      if (dropA !== dropB) return dropB - dropA;
      return (b.daysOnLot || 0) - (a.daysOnLot || 0);
    }
    if (sortBy === "days_desc") return (b.daysOnLot || 0) - (a.daysOnLot || 0);
    if (sortBy === "days_asc") return (a.daysOnLot || 0) - (b.daysOnLot || 0);
    if (sortBy === "mileage_asc") return (a.mileage || 0) - (b.mileage || 0);
    if (sortBy === "year_desc") return (b.year || 0) - (a.year || 0);

    const hasDropA = a.changeType === "PRICE_DROP" || (a.priceDiff && a.priceDiff < 0);
    const hasDropB = b.changeType === "PRICE_DROP" || (b.priceDiff && b.priceDiff < 0);
    if (hasDropA && !hasDropB) return -1;
    if (!hasDropA && hasDropB) return 1;
    return (a.daysOnLot || 0) - (b.daysOnLot || 0);
  });
  return arr;
}

export const LightsailIntelligence: React.FC = () => {
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

  // ------------------------------------------------------------------
  // Filter / sort / page state — unchanged from before. These now drive
  // server-side query params instead of an in-memory useMemo filter chain.
  // ------------------------------------------------------------------
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
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

  // Debounce only the free-text search field (~300ms), per the migration
  // plan — every other filter re-fetches immediately on change.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // Reset page whenever any active filter is updated
  useEffect(() => {
    setCurrentPage(1);
  }, [
    debouncedSearchTerm,
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

  // ------------------------------------------------------------------
  // Live server state
  // ------------------------------------------------------------------
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [pagination, setPagination] = useState<ApiPagination>(EMPTY_PAGINATION);
  const [stats, setStats] = useState<ApiStats>(EMPTY_STATS);
  const [dataSource, setDataSource] = useState<"box_api" | "legacy_fallback" | null>(null);
  const [isLoading, setIsLoading] = useState(true); // first paint only
  const [isFetching, setIsFetching] = useState(false); // every subsequent re-fetch

  const [rawFacets, setRawFacets] = useState<Record<string, FacetValue[]>>({});
  const [isFacetsLoading, setIsFacetsLoading] = useState(false);

  // Which brand a given `make` value belongs to, learned from the facets
  // response so a specific Make selection (e.g. "Ford") can be resolved to
  // the one `brand` the box API requires per request. See the header
  // comment above for why this exists.
  const [makeBrandMap, setMakeBrandMap] = useState<Record<string, Brand>>({});

  // One-time (per mount) grand total across both brands, used only for the
  // "All Makes (N)" / "All Models (N)" style labels and the empty-state
  // message — matching the old behavior of always showing the full,
  // filter-independent dataset size there.
  const [grandTotal, setGrandTotal] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(BRANDS.map((b) => fetchVehiclesPage(b, { page: "1", pageSize: "1" })));
      if (cancelled) return;
      const total = results.reduce((s, r) => s + (r?.pagination.totalCount || 0), 0);
      setGrandTotal(total);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Factory-option catalog: the box API has no facet dimension for options
  // (they live in a separate join table — see FACET_DIMS above), so there
  // is no single query that returns "every option code with its count."
  // Known gap, flagged in the migration report. Interim behavior: build the
  // catalog incrementally from whatever vehicles this session has actually
  // fetched, deduping by VIN per code so re-fetching the same page never
  // inflates a count.
  const [optionCatalog, setOptionCatalog] = useState<Map<string, { name: string; vins: Set<string> }>>(new Map());

  function brandsForQuery(): Brand[] {
    if (selectedMake === "ALL") return BRANDS;
    const b = makeBrandMap[selectedMake];
    return b ? [b] : BRANDS; // safe fallback: query both, `make` filter narrows correctly either way
  }

  function activeFacetFilterDims(): FacetDim[] {
    const dims: FacetDim[] = [];
    if (selectedMake !== "ALL") dims.push("make");
    if (selectedModel !== "ALL") dims.push("model");
    if (selectedTrim !== "ALL") dims.push("trim");
    if (selectedDealer !== "ALL") dims.push("dealer");
    if (selectedState !== "ALL") dims.push("state");
    if (selectedBodyStyle !== "ALL") dims.push("bodyStyle");
    if (selectedCondition !== "ALL") dims.push("condition");
    return dims;
  }

  // Shared filter params (search/model/trim/condition/dealer/state/
  // bodyStyle/year/price/mileage/daysOnLot/opportunity/optionCode) — NOT
  // including brand/make/page/pageSize/sortBy/excludeFacet, which callers
  // attach themselves since they vary per-brand or per-purpose.
  function buildFilterParams(): Record<string, string> {
    const p: Record<string, string> = {};
    if (debouncedSearchTerm.trim()) p.search = debouncedSearchTerm.trim();
    if (selectedModel !== "ALL") p.model = selectedModel;
    if (selectedTrim !== "ALL") p.trim = selectedTrim;
    if (selectedCondition !== "ALL") p.condition = selectedCondition;
    if (selectedDealer !== "ALL") p.dealer = selectedDealer;
    if (selectedState !== "ALL") p.state = selectedState;
    if (selectedBodyStyle !== "ALL") p.bodyStyle = selectedBodyStyle;
    if (selectedYear !== "ALL") p.year = selectedYear;
    if (minPriceInput.trim()) p.minPrice = minPriceInput.trim();
    if (maxPriceInput.trim()) p.maxPrice = maxPriceInput.trim();
    if (maxMileageInput.trim()) p.maxMileage = maxMileageInput.trim();
    if (selectedOptionCode !== "ALL") p.optionCode = selectedOptionCode;
    const dayRange = DAYS_ON_LOT_RANGES[selectedDaysOnLot];
    if (dayRange) {
      if (dayRange.min !== undefined) p.minDaysOnLot = String(dayRange.min);
      if (dayRange.max !== undefined) p.maxDaysOnLot = String(dayRange.max);
    }
    const opp = OPPORTUNITY_MAP[selectedOpportunity];
    if (opp) p.opportunity = opp;
    return p;
  }

  function buildSortParams(): Record<string, string> {
    if (sortBy === "closest_to_zip") {
      const coords = getZipCoordinates(userZip.trim() || "07054");
      return { sortBy: "closest_to_zip", lat: String(coords.lat), lng: String(coords.lng) };
    }
    if (SUPPORTED_SORT_MAP[sortBy]) return { sortBy: SUPPORTED_SORT_MAP[sortBy] };
    return {};
  }

  // Helper to compute vehicle distance in miles from active user ZIP
  // (unchanged client heuristic — kept exactly as before so the per-card
  // "X mi" badge and CSV column don't change behavior; see the report for
  // how this relates to the server-side closest_to_zip sort).
  const getVehicleDistance = (v: VehicleRecord): number => {
    const zip = userZip.trim() || "07054";
    return calculateDistanceMiles(zip, {
      city: v.city || v.dealerName || "Parsippany",
      state: v.state || "NJ",
    });
  };

  // Canonical Condition Normalizer — unchanged; resilient to both the box's
  // "CERTIFIED_PRE_OWNED" and any legacy "CERTIFIED"-style value.
  const getNormalizedCondition = (v: VehicleRecord): "NEW" | "USED" | "CERTIFIED" => {
    const t = (v.inventoryType || "").toUpperCase();
    if (t.includes("CERT")) return "CERTIFIED";
    if (t.includes("NEW")) return "NEW";
    return "USED";
  };

  // ------------------------------------------------------------------
  // Main paginated vehicles fetch — re-runs whenever any filter/sort/page
  // state changes. Ignores out-of-order responses via a sequence guard so
  // a slow earlier request can't clobber a faster later one.
  // ------------------------------------------------------------------
  const fetchSeqRef = useRef(0);
  useEffect(() => {
    const seq = ++fetchSeqRef.current;
    setIsFetching(true);
    (async () => {
      const brands = brandsForQuery();
      const baseParams = buildFilterParams();
      const sortParams = buildSortParams();

      if (brands.length === 1) {
        const brand = brands[0];
        const params: Record<string, string> = {
          ...baseParams,
          ...sortParams,
          page: String(currentPage),
          pageSize: String(pageSize),
        };
        if (selectedMake !== "ALL") params.make = selectedMake;
        const result = await fetchVehiclesPage(brand, params);
        if (seq !== fetchSeqRef.current) return;
        if (result) {
          const mapped = result.vehicles.map((v) => mapApiVehicleToRecord(v, result.source));
          setVehicles(mapped);
          setPagination(result.pagination);
          setStats(result.stats);
          setDataSource(result.source);
          absorbOptionCatalog(mapped);
        } else {
          setVehicles([]);
          setPagination({ ...EMPTY_PAGINATION, pageSize });
          setStats(EMPTY_STATS);
          setDataSource(null);
        }
      } else {
        const params: Record<string, string> = {
          ...baseParams,
          ...sortParams,
          page: String(currentPage),
          pageSize: String(pageSize),
        };
        const results = await Promise.all(brands.map((b) => fetchVehiclesPage(b, params)));
        if (seq !== fetchSeqRef.current) return;
        const valid = results.filter((r): r is VehiclesApiResponse => !!r);
        const merged = valid.flatMap((r) => r.vehicles.map((v) => mapApiVehicleToRecord(v, r.source)));
        const sorted = sortMergedVehicles(merged, sortBy, userZip, getVehicleDistance);
        const totalCount = valid.reduce((s, r) => s + r.pagination.totalCount, 0);
        const page = sorted.slice(0, pageSize);
        setVehicles(page);
        setPagination({ page: currentPage, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) });
        setStats(mergeStats(valid.map((r) => r.stats)));
        setDataSource(valid.some((r) => r.source === "box_api") ? "box_api" : valid.length > 0 ? "legacy_fallback" : null);
        absorbOptionCatalog(page);
      }
      setIsLoading(false);
      setIsFetching(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedSearchTerm,
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
    currentPage,
    pageSize,
    userZip,
  ]);

  function absorbOptionCatalog(newVehicles: VehicleRecord[]) {
    setOptionCatalog((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const v of newVehicles) {
        for (const o of v.factoryOptions || []) {
          if (!o.code) continue;
          const entry = next.get(o.code) || { name: o.name || o.code, vins: new Set<string>() };
          if (!entry.vins.has(v.vin)) {
            entry.vins = new Set(entry.vins);
            entry.vins.add(v.vin);
            changed = true;
          }
          next.set(o.code, entry);
        }
      }
      return changed ? next : prev;
    });
  }

  // ------------------------------------------------------------------
  // Facets fetch — cross-filtered dropdown counts. Runs in parallel with
  // the vehicles fetch above (separate effect/loading state per the plan).
  // For each dimension that currently has an active filter, an extra
  // `excludeFacet=<dim>` request is made so that dropdown still shows every
  // value (not just the one selected) with counts computed as if that one
  // filter weren't applied — matching the old client-side cross-count
  // behavior exactly. Dimensions with no active filter need no extra call.
  // ------------------------------------------------------------------
  const facetsSeqRef = useRef(0);
  useEffect(() => {
    const seq = ++facetsSeqRef.current;
    setIsFacetsLoading(true);
    (async () => {
      const brands = brandsForQuery();
      const baseParams = buildFilterParams();
      const activeDims = activeFacetFilterDims();

      async function fetchForBrand(brand: Brand): Promise<Record<string, FacetValue[]>> {
        const params = selectedMake !== "ALL" ? { ...baseParams, make: selectedMake } : baseParams;
        const basePromise = fetchFacetsPage(brand, params);
        const extraPromises = activeDims.map(async (dim) => {
          const r = await fetchFacetsPage(brand, { ...params, excludeFacet: dim });
          return [dim, r?.facets?.[dim] || []] as [FacetDim, FacetValue[]];
        });
        const [base, ...extras] = await Promise.all([basePromise, ...extraPromises]);
        const merged: Record<string, FacetValue[]> = { ...(base?.facets || {}) };
        for (const [dim, values] of extras) merged[dim] = values;
        return merged;
      }

      const perBrand = await Promise.all(brands.map((b) => fetchForBrand(b)));
      if (seq !== facetsSeqRef.current) return;

      // Track which brand each make value belongs to (only meaningful in
      // "ALL" mode where there's more than one brand's facets to compare).
      if (brands.length > 1) {
        const newMap: Record<string, Brand> = {};
        brands.forEach((b, i) => {
          (perBrand[i].make || []).forEach(({ value }) => {
            newMap[value] = b;
          });
        });
        setMakeBrandMap((prev) => ({ ...prev, ...newMap }));
      }

      const mergedFacets: Record<string, FacetValue[]> = {};
      for (const dim of FACET_DIMS) {
        mergedFacets[dim] = mergeFacetValueArrays(perBrand.map((f) => f[dim] || []));
      }
      setRawFacets(mergedFacets);
      setIsFacetsLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedSearchTerm,
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

  // Shape-compatible with the old client-computed `facetOptions` so the
  // JSX below barely had to change.
  const facetOptions = useMemo(() => {
    const toTuples = (dim: FacetDim) => (rawFacets[dim] || []).map((f) => [f.value, f.count] as [string, number]);
    const conditions = { NEW: 0, USED: 0, CERTIFIED_PRE_OWNED: 0 } as Record<string, number>;
    (rawFacets.condition || []).forEach(({ value, count }) => {
      conditions[value] = (conditions[value] || 0) + count;
    });

    const options = new Map<string, number>();
    const optionNames = new Map<string, string>();
    optionCatalog.forEach((entry, code) => {
      options.set(code, entry.vins.size);
      optionNames.set(code, entry.name);
    });

    return {
      makes: toTuples("make"),
      models: toTuples("model"),
      trims: toTuples("trim"),
      conditions,
      dealers: toTuples("dealer"),
      states: toTuples("state"),
      bodyStyles: toTuples("bodyStyle"),
      options,
      optionNames,
    };
  }, [rawFacets, optionCatalog]);
  const totalModelsCount = useMemo(() => facetOptions.models.reduce((s, [, c]) => s + c, 0), [facetOptions.models]);

  // ------------------------------------------------------------------
  // "Daily Activity" tab — needs the (near-)full inventory for the current
  // brand/dealer scope, including recently sold/removed vehicles, to bucket
  // into new/sold/price-drop/price-up exactly like DailyChangesPanel always
  // did. Lazily fetched only when that tab is opened, via several parallel
  // paginated requests (status=ALL so sold/removed vehicles are included —
  // the default vehicles query only returns status=ACTIVE).
  // ------------------------------------------------------------------
  const [changesVehicles, setChangesVehicles] = useState<VehicleRecord[]>([]);
  const [isChangesLoading, setIsChangesLoading] = useState(false);
  const changesSeqRef = useRef(0);

  useEffect(() => {
    if (viewMode !== "changes") return;
    const seq = ++changesSeqRef.current;
    setIsChangesLoading(true);
    (async () => {
      const brands = brandsForQuery();
      const dealerParam: Record<string, string> = selectedDealer !== "ALL" ? { dealer: selectedDealer } : {};
      const PAGE_SIZE = 200;
      const MAX_PAGES_PER_BRAND = 30; // covers ~6,000 vehicles/brand — comfortably above current ~5,300 (active+sold) per brand

      async function fetchAllForBrand(brand: Brand): Promise<VehicleRecord[]> {
        const baseParams: Record<string, string> = { status: "ALL", pageSize: String(PAGE_SIZE), ...dealerParam };
        if (selectedMake !== "ALL") baseParams.make = selectedMake;
        const first = await fetchVehiclesPage(brand, { ...baseParams, page: "1" });
        if (!first) return [];
        const totalPages = Math.min(first.pagination.totalPages, MAX_PAGES_PER_BRAND);
        const rest = await Promise.all(
          Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2).map((p) =>
            fetchVehiclesPage(brand, { ...baseParams, page: String(p) })
          )
        );
        const all = [first, ...rest].filter((r): r is VehiclesApiResponse => !!r);
        return all.flatMap((r) => r.vehicles.map((v) => mapApiVehicleToRecord(v, r.source)));
      }

      const perBrand = await Promise.all(brands.map((b) => fetchAllForBrand(b)));
      if (seq !== changesSeqRef.current) return;
      setChangesVehicles(perBrand.flat());
      setIsChangesLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedMake, selectedDealer]);

  const handleCopyVin = (vin: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(vin);
      setCopiedVin(vin);
      setTimeout(() => setCopiedVin(null), 2000);
    }
  };

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

  const totalPages = pagination.totalPages;

  // Instant CSV Export of the current filtered selection. There is no
  // dedicated unpaginated export endpoint wired into app/api/lightsail/
  // route.ts yet (the box API does have one — /api/vehicles/export.csv —
  // but it's a direct box endpoint requiring the server-only API key, not
  // something this client component should call). Per the migration plan,
  // this is the documented interim: page through the same action=vehicles
  // endpoint at the max pageSize (200) until the filtered set is fully
  // collected, then build the CSV exactly as before. Known limitation:
  // slower than a real streaming export for very large filtered result
  // sets, and capped at MAX_EXPORT_PAGES per brand as a safety bound.
  const [isExporting, setIsExporting] = useState(false);
  const handleExportFilteredCSV = async () => {
    if (pagination.totalCount === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const brands = brandsForQuery();
      const baseParams = buildFilterParams();
      const sortParams = buildSortParams();
      const PAGE_SIZE = 200;
      const MAX_EXPORT_PAGES = 60; // 12,000 rows/brand — comfortably above current dataset size

      async function fetchAllForBrand(brand: Brand): Promise<VehicleRecord[]> {
        const params: Record<string, string> = { ...baseParams, ...sortParams, pageSize: String(PAGE_SIZE) };
        if (selectedMake !== "ALL") params.make = selectedMake;
        const first = await fetchVehiclesPage(brand, { ...params, page: "1" });
        if (!first) return [];
        const totalPages = Math.min(first.pagination.totalPages, MAX_EXPORT_PAGES);
        const rest = await Promise.all(
          Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2).map((p) =>
            fetchVehiclesPage(brand, { ...params, page: String(p) })
          )
        );
        const all = [first, ...rest].filter((r): r is VehiclesApiResponse => !!r);
        return all.flatMap((r) => r.vehicles.map((v) => mapApiVehicleToRecord(v, r.source)));
      }

      const perBrand = await Promise.all(brands.map((b) => fetchAllForBrand(b)));
      const exportVehicles = perBrand.flat();
      if (exportVehicles.length === 0) return;

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

      const rows = exportVehicles.map((v) => [
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
    } finally {
      setIsExporting(false);
    }
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
            {isFetching && (
              <Loader2 className="h-3.5 w-3.5 text-emerald-400 animate-spin" aria-label="Refreshing results" />
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
            allLabel="All Makes"
          />

          <ComboField
            label="Model"
            value={selectedModel}
            onChange={(val) => {
              setSelectedModel(val);
              setSelectedTrim("ALL");
            }}
            options={facetOptions.models.map(([m, count]) => ({ value: m, label: `${m} (${count})` }))}
            allLabel={`All Models (${totalModelsCount || ""})`}
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
              <option value="NEW">New ({facetOptions.conditions.NEW || 0})</option>
              <option value="USED">Pre-Owned ({facetOptions.conditions.USED || 0})</option>
              <option value="CERTIFIED_PRE_OWNED">CPO ({facetOptions.conditions.CERTIFIED_PRE_OWNED || 0})</option>
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
            {UNSUPPORTED_SINGLE_BRAND_SORTS.has(sortBy) && selectedMake !== "ALL" && (
              <p className="text-[9.5px] text-amber-400/80 leading-snug">
                This sort isn't wired up server-side for a single make yet — showing default order. Select "All Makes" to sort correctly.
              </p>
            )}
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
        isChangesLoading && changesVehicles.length === 0 ? (
          <div className="rounded-3xl border border-border bg-surface p-12 text-center space-y-3 shadow-xl">
            <Loader2 className="h-6 w-6 text-emerald-400 animate-spin mx-auto" />
            <p className="text-xs text-ink-muted">Loading daily activity across the full inventory…</p>
          </div>
        ) : (
          <DailyChangesPanel vehicles={changesVehicles} selectedDealer={selectedDealer} />
        )
      ) : isLoading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-surface overflow-hidden animate-pulse">
              <div className="aspect-[2/1] bg-surface-elevated" />
              <div className="p-4 space-y-2.5">
                <div className="h-4 bg-surface-elevated rounded w-3/4" />
                <div className="h-3 bg-surface-elevated rounded w-1/2" />
                <div className="h-5 bg-surface-elevated rounded w-1/3 mt-3" />
              </div>
            </div>
          ))}
        </div>
      ) : vehicles.length === 0 ? (
        <div className="rounded-3xl border border-border bg-surface p-12 text-center space-y-4 shadow-xl">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-elevated text-ink-muted mx-auto border border-border">
            <Search className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-black text-white">No vehicles match your active filters</h3>
          <p className="text-xs text-ink-muted max-w-md mx-auto">
            Try loosening price/mileage limits or resetting filters to view the full inventory{grandTotal ? ` of ${grandTotal.toLocaleString()} vehicles` : ""}.
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
        <div className={`space-y-6 transition-opacity ${isFetching ? "opacity-60" : "opacity-100"}`}>
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-muted">
              Displaying <strong className="text-white">{(currentPage - 1) * pageSize + 1}</strong>–<strong className="text-white">{Math.min(currentPage * pageSize, pagination.totalCount)}</strong>
              {selectedMake !== "ALL" && (
                <> of <strong className="text-white">{pagination.totalCount.toLocaleString()}</strong> live vehicles</>
              )}
            </span>
            <button
              onClick={handleExportFilteredCSV}
              disabled={isExporting}
              className="inline-flex items-center gap-1 text-emerald-400 hover:underline font-bold disabled:opacity-50 disabled:cursor-wait"
            >
              {isExporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              <span>{isExporting ? "Preparing CSV…" : "Download CSV"}</span>
            </button>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-2">
            {vehicles.map((v) => {
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
                  <div className="relative aspect-[2/1] bg-surface-elevated">
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
                        <span className="font-mono">{v.daysOnLot ?? "—"}d on lot</span>
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
              Showing <strong className="text-white">{(currentPage - 1) * pageSize + 1}</strong>–<strong className="text-white">{Math.min(currentPage * pageSize, pagination.totalCount)}</strong> of <strong className="text-white">{pagination.totalCount.toLocaleString()}</strong> matching vehicles
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
