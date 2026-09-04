"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Car,
  Check,
  Globe,
  LoaderCircle as Loader2,
  MapPin,
  Phone,
  Zap,
} from "lucide-react";
import {
  FORD_COMPETITION_FACTORY_OPTIONS,
  FORD_COMPETITION_FACTORY_OPTIONS_UNAVAILABLE,
  FORD_LISTINGS_LOAD_FAILED,
  LISTING_DETAILS_UNAVAILABLE,
  advertisedOrStickerPrice,
  formatFactoryOptionLine,
  formatPriceAmount,
  listingVdpHref,
  sanitizeShopperListingsCopy,
  shopperPriceSourceLabel,
  type FactoryOptionDisplay,
} from "../lib/fordCompetitionUi";
import {
  DEAL_STRUCTURE_LABELS,
  FINANCE_TERM_MONTHS,
  LEASE_TERM_MONTHS,
  formatDealStructures,
} from "../lib/dealStructure";
import {
  calculateLeaseEstimate,
  estimatedFinanceMonthly,
  replaceVehicleTerms,
  roundEstimateDollars,
  termsForVin,
  LEASE_TAX_METHODS,
} from "../lib/dealTerms";
import {
  COMPARE_COLUMN_ROLES,
  ROLE_LABELS,
  applyVehicleTermsToSnapshot,
  assignCompetitorLot,
  isSharedFactoryOption,
  loadOfferCompareSnapshot,
  saveOfferCompareSnapshot,
  setLandingView,
  sharedFactoryOptionKeys,
  sortCompareColumns,
  upsertShopperRequest,
  vehicleForCompareRole,
  vehicleFromComparableSuggestion,
  type CompareSortMetrics,
  type CompareSortMode,
  type ComparableSuggestion,
  type OfferCompareSnapshot,
  type OfferCompareVehicle,
} from "../lib/offerCompare";
import { importPastedFactoryVehicle } from "../lib/pasteImport";
import type { ShopperListingSheet } from "../lib/listingSheet";
import type { DealStructureMethod, Vehicle, VehicleDealTerms } from "../lib/types";
import { formatCurrency } from "../lib/otdCalculator";

function unavailableSheet(vin: string, note: string): ShopperListingSheet {
  return {
    vin,
    available: false,
    attribution: null,
    advertisedPrice: null,
    msrp: null,
    priceChange: null,
    priceHistory: [],
    daysOnMarket: null,
    daysOnMarketActive: null,
    firstSeen: null,
    lastSeen: null,
    stockNumber: null,
    inventoryType: null,
    exteriorColor: null,
    interiorColor: null,
    mileage: null,
    dealerName: null,
    dealerStreet: null,
    dealerCity: null,
    dealerState: null,
    dealerZip: null,
    dealerPhone: null,
    vdpUrl: null,
    inTransit: null,
    photoUrl: null,
    note,
  };
}

function factoryLines(vehicle: Vehicle): FactoryOptionDisplay[] {
  if (vehicle.options && vehicle.options.length > 0) {
    return vehicle.options.map((o) => ({
      code: o.code || null,
      description: o.name,
      price: o.price,
      isPackageChild: o.category === "standalone",
    }));
  }
  return (vehicle.packages || []).map((name) => ({ code: null, description: name }));
}

function columnAdvertised(vehicle: Vehicle, sheet: ShopperListingSheet | undefined) {
  if (sheet?.available && sheet.advertisedPrice && sheet.advertisedPrice > 0) {
    return { amount: sheet.advertisedPrice, source: "listing" as const };
  }
  return advertisedOrStickerPrice(vehicle.dealerPrice, vehicle.msrp);
}

function milesLabel(miles: number | undefined, zip: string): string | null {
  if (miles == null || miles <= 0 || !/^\d{5}$/.test(zip.trim())) return null;
  return `${miles} mi from ${zip.trim()}`;
}

function formatPriceHistoryLine(entry: { date: string; price: number; change: number | null }): string {
  const price = formatPriceAmount(entry.price);
  if (entry.change == null || entry.change === 0) return `${entry.date}  ${price}`;
  const abs = formatPriceAmount(Math.abs(entry.change));
  if (entry.change > 0) return `${entry.date}  ${price}  (+${abs})`;
  return `${entry.date}  ${price}  (−${abs})`;
}

function moneyInput(value: number, onChange: (n: number) => void, label: string) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
      <input
        type="number"
        min={0}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full rounded-lg border border-border bg-background py-1.5 px-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
      />
    </label>
  );
}

export const OfferCompareView: React.FC = () => {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<OfferCompareSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sheets, setSheets] = useState<Record<string, ShopperListingSheet>>({});
  const [listingStatus, setListingStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [compareSort, setCompareSort] = useState<CompareSortMode>("default");
  const [slotPaste, setSlotPaste] = useState<Record<1 | 2, string>>({ 1: "", 2: "" });
  const [slotError, setSlotError] = useState<Record<1 | 2, string | null>>({ 1: null, 2: null });
  const [importingSlot, setImportingSlot] = useState<1 | 2 | null>(null);
  // The full result set from one live listings search (year/make/model/trim/
  // zip/radius) — never capped, never re-queried per candidate. Trim is the
  // must-have proxy; real option-level verification happens only once a
  // candidate is actually selected.
  const [candidates, setCandidates] = useState<ComparableSuggestion[] | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidatesNote, setCandidatesNote] = useState<string | null>(null);
  const [candidatesFetchedFor, setCandidatesFetchedFor] = useState<string | null>(null);
  const [selectedVins, setSelectedVins] = useState<string[]>([]);
  // Synchronous in-flight guard (a ref, not state) — see findComparableVehicles.
  const inFlightSignatureRef = useRef<string | null>(null);
  const [showCriteria, setShowCriteria] = useState(false);
  const [radiusDraft, setRadiusDraft] = useState<string | null>(null);

  useEffect(() => {
    const next = loadOfferCompareSnapshot();
    setSnapshot(next);
    setLoaded(true);
  }, []);

  const importedVins = useMemo(
    () =>
      (snapshot?.vehicles || [])
        .map((col) => col.vehicle.vin.toUpperCase())
        .filter((vin) => vin.length === 17)
        .slice(0, 3),
    [snapshot]
  );
  const vinKey = importedVins.join(",");

  const favoriteVehicle = snapshot ? vehicleForCompareRole(snapshot, "favorite")?.vehicle : undefined;
  const emptySlots = useMemo<(1 | 2)[]>(() => {
    const filled = new Set(
      (snapshot?.vehicles || []).map((col) => col.role).filter((r) => r !== "favorite")
    );
    const slots: (1 | 2)[] = [];
    if (!filled.has("other_lot_1")) slots.push(1);
    if (!filled.has("other_lot_2")) slots.push(2);
    return slots;
  }, [snapshot]);
  const sortableLots = 2 - emptySlots.length;

  // One search call per distinct favorite + criteria combination — never
  // re-fires just because state re-rendered, and re-fires on its own once
  // the buyer removes a must-have or widens the radius from the criteria
  // panel (see onSearchAgain).
  const searchSignature = favoriteVehicle
    ? [
        favoriteVehicle.vin,
        favoriteVehicle.year,
        favoriteVehicle.make,
        favoriteVehicle.model,
        favoriteVehicle.trim,
        snapshot?.buyerZip,
        snapshot?.searchRadiusMiles,
      ].join("|")
    : null;

  // Only ever fetch VINs we don't already have a sheet for, and merge rather
  // than replace. Each VIN costs 2-3 upstream listings-provider calls (active
  // search + price history + listing detail), so the old "refetch every VIN
  // whenever the VIN set changes" behavior meant adding one competitor
  // re-bought sheets for all three columns — ~9 calls to learn about one car.
  useEffect(() => {
    if (!vinKey) return;
    const vins = vinKey.split(",").filter((vin) => vin.length === 17);
    const missing = vins.filter((vin) => !sheets[vin]);
    if (missing.length === 0) {
      setListingStatus("ready");
      return;
    }
    let cancelled = false;
    setListingStatus("loading");
    fetch("/api/listing-facts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vins: missing }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        const rows = Array.isArray(json.sheets) ? (json.sheets as ShopperListingSheet[]) : [];
        const byVin: Record<string, ShopperListingSheet> = {};
        for (const row of rows) {
          if (row?.vin) byVin[row.vin.toUpperCase()] = row;
        }
        setSheets((prev) => ({ ...prev, ...byVin }));
      })
      .catch(() => {
        if (cancelled) return;
        const byVin: Record<string, ShopperListingSheet> = {};
        for (const vin of missing) {
          byVin[vin] = unavailableSheet(vin, FORD_LISTINGS_LOAD_FAILED);
        }
        setSheets((prev) => ({ ...prev, ...byVin }));
      })
      .finally(() => {
        if (!cancelled) setListingStatus("ready");
      });
    return () => {
      cancelled = true;
    };
    // `sheets` is deliberately not a dependency — it's read to skip VINs we
    // already have, and including it would re-run this effect on every fetch
    // it completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vinKey]);

  const persist = useCallback((next: OfferCompareSnapshot) => {
    setSnapshot(next);
    saveOfferCompareSnapshot(next);
    upsertShopperRequest(next.request);
  }, []);

  const updateTerms = useCallback(
    (nextTerms: VehicleDealTerms) => {
      if (!snapshot) return;
      const merged = replaceVehicleTerms(
        snapshot.request.dealStructurePreferences?.vehicleTerms || [],
        nextTerms
      );
      persist(applyVehicleTermsToSnapshot(snapshot, merged));
    },
    [persist, snapshot]
  );

  const importCompetitor = useCallback(
    async (slot: 1 | 2) => {
      if (!snapshot) return;
      const paste = slotPaste[slot].trim();
      if (!paste) return;
      setImportingSlot(slot);
      setSlotError((prev) => ({ ...prev, [slot]: null }));
      const result = await importPastedFactoryVehicle(paste);
      if (!result.ok) {
        setSlotError((prev) => ({ ...prev, [slot]: result.error }));
        setImportingSlot(null);
        return;
      }
      const assigned = assignCompetitorLot(snapshot, slot, result.vehicle);
      if (!assigned.ok) {
        setSlotError((prev) => ({ ...prev, [slot]: assigned.error }));
        setImportingSlot(null);
        return;
      }
      persist(assigned.snapshot);
      setSlotPaste((prev) => ({ ...prev, [slot]: "" }));
      setImportingSlot(null);
    },
    [persist, slotPaste, snapshot]
  );

  // One listings search call — year/make/model/zip/radius — full result set
  // kept, no per-VIN sticker fetch to verify must-haves and no capping down
  // to a couple of slots. inFlightSignatureRef is checked and set
  // synchronously (a ref, not state) so a StrictMode double-effect-invoke —
  // or any other back-to-back re-render before the loading state commits —
  // can never fire this twice for the same search.
  const findComparableVehicles = useCallback(async () => {
    if (!favoriteVehicle) return;
    if (inFlightSignatureRef.current === searchSignature) return;
    inFlightSignatureRef.current = searchSignature;
    setCandidatesLoading(true);
    setCandidatesError(null);
    try {
      const res = await fetch("/api/manual-comparables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectVin: favoriteVehicle.vin,
          year: favoriteVehicle.year,
          make: favoriteVehicle.make,
          model: favoriteVehicle.model,
          zip: snapshot?.buyerZip,
          radiusMiles: snapshot?.searchRadiusMiles,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) {
        setCandidates([]);
        setCandidatesError(typeof json?.error === "string" ? json.error : FORD_LISTINGS_LOAD_FAILED);
        return;
      }
      setCandidates(Array.isArray(json.matches) ? (json.matches as ComparableSuggestion[]) : []);
      // Carries real diagnostic text even on a clean 200 with zero matches
      // (e.g. "That search radius is wider than this plan allows.") — a
      // buyer staring at an empty list deserves the real reason, not a
      // guess.
      setCandidatesNote(typeof json?.note === "string" ? json.note : null);
    } catch {
      setCandidates([]);
      setCandidatesError(FORD_LISTINGS_LOAD_FAILED);
    } finally {
      setCandidatesLoading(false);
      setCandidatesFetchedFor(searchSignature);
      setSelectedVins([]);
      inFlightSignatureRef.current = null;
    }
  }, [favoriteVehicle, snapshot?.buyerZip, snapshot?.searchRadiusMiles, searchSignature]);

  // Auto-runs once the favorite + criteria are known and there's still a
  // slot to fill — this is the one call, not something the buyer has to
  // think to trigger. Re-runs on its own when the criteria panel changes
  // must-haves or radius (searchSignature changes).
  useEffect(() => {
    if (!favoriteVehicle || emptySlots.length === 0) return;
    if (candidatesLoading || candidatesFetchedFor === searchSignature) return;
    void findComparableVehicles();
  }, [favoriteVehicle, emptySlots.length, candidatesLoading, candidatesFetchedFor, searchSignature, findComparableVehicles]);

  const availableCandidates = useMemo(
    () => (candidates || []).filter((m) => !importedVins.includes(m.vin.toUpperCase())),
    [candidates, importedVins]
  );

  const toggleSelected = useCallback(
    (vin: string) => {
      setSelectedVins((prev) => {
        if (prev.includes(vin)) return prev.filter((v) => v !== vin);
        if (prev.length >= emptySlots.length) return prev;
        return [...prev, vin];
      });
    },
    [emptySlots.length]
  );

  const confirmSelection = useCallback(() => {
    if (!snapshot || selectedVins.length === 0) return;
    let working = snapshot;
    for (let i = 0; i < selectedVins.length && i < emptySlots.length; i++) {
      const match = availableCandidates.find((m) => m.vin === selectedVins[i]);
      if (!match) continue;
      const assigned = assignCompetitorLot(working, emptySlots[i], vehicleFromComparableSuggestion(match));
      if (!assigned.ok) {
        setSlotError((prev) => ({ ...prev, [emptySlots[i]]: assigned.error }));
        continue;
      }
      working = assigned.snapshot;
    }
    persist(working);
    setSelectedVins([]);
    setCandidates(null);
    setCandidatesFetchedFor(null);
  }, [snapshot, selectedVins, emptySlots, availableCandidates, persist]);

  const removeMustHave = useCallback(
    (line: string) => {
      if (!snapshot) return;
      persist({ ...snapshot, mustHaveLines: snapshot.mustHaveLines.filter((l) => l !== line) });
    },
    [persist, snapshot]
  );

  const removeNiceToHave = useCallback(
    (line: string) => {
      if (!snapshot) return;
      persist({ ...snapshot, niceToHaveLines: snapshot.niceToHaveLines.filter((l) => l !== line) });
    },
    [persist, snapshot]
  );

  const commitRadius = useCallback(() => {
    if (!snapshot || radiusDraft == null) return;
    const parsed = Number(radiusDraft);
    if (Number.isFinite(parsed) && parsed > 0) {
      persist({ ...snapshot, searchRadiusMiles: parsed });
    }
    setRadiusDraft(null);
  }, [persist, snapshot, radiusDraft]);

  const goToTracker = () => {
    if (snapshot) {
      saveOfferCompareSnapshot(snapshot);
      upsertShopperRequest(snapshot.request);
    }
    setLandingView("track_deals");
    router.push("/");
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-24 text-ink-muted text-sm">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading offer…
      </div>
    );
  }

  if (!snapshot || snapshot.vehicles.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
          <Car className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-black text-white">No vehicles in this deal</h1>
        <p className="text-xs text-ink-muted">
          Finish Step 5 of Launch Dealership Bidding Hunt to compare the imported favorite. You can paste two competitor VINs on this page.
        </p>
        <Link
          href="/"
          className="inline-flex rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400"
        >
          Start a bidding hunt
        </Link>
      </div>
    );
  }

  const baseColumns = COMPARE_COLUMN_ROLES.filter((role) => role !== "favorite").map((role) => ({
    role,
    column: vehicleForCompareRole(snapshot, role),
  }));

  // Sort logic lives in lib/offerCompare.ts so it's unit-testable — this
  // environment has no listings key, so the reordering can't be exercised
  // against live sheets in the browser.
  const sortMetrics: Record<string, CompareSortMetrics | undefined> = {};
  for (const [vin, sheet] of Object.entries(sheets)) {
    sortMetrics[vin] = {
      daysOnMarket: sheet.daysOnMarket,
      daysOnMarketActive: sheet.daysOnMarketActive,
      priceCuts: sheet.priceHistory.length,
    };
  }
  const columns = sortCompareColumns(
    baseColumns.map((c) => ({ ...c, vin: c.column?.vehicle.vin ?? null })),
    compareSort,
    sortMetrics
  );

  const favoriteColumn = vehicleForCompareRole(snapshot, "favorite");
  const sharedOptions = sharedFactoryOptionKeys(
    [favoriteColumn, ...baseColumns.map((c) => c.column)]
      .filter((column): column is OfferCompareVehicle => column != null)
      .map((column) => factoryLines(column.vehicle))
  );

  const emptySlotsRemain = emptySlots.length > 0;
  // A dead-end search is the moment loosening the radius actually helps —
  // surface the editor right there instead of making the buyer go dig for it.
  const hadEmptyResult = candidates !== null && availableCandidates.length === 0 && !candidatesLoading;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Offer terms</p>
          <h1 className="text-2xl font-black text-white tracking-tight">Compare vehicles in this deal</h1>
          <p className="text-xs text-ink-muted mt-1">
            {formatDealStructures(snapshot.requestedStructures) || "Deal structure"}
            {snapshot.buyerZip ? ` · Buyer ZIP ${snapshot.buyerZip}` : ""}
            {snapshot.request.id ? ` · Deal #${snapshot.request.id}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {sortableLots > 1 ? (
            <label className="flex items-center gap-2 text-[11px] text-ink-muted">
              <span className="font-bold uppercase tracking-wider">Sort lots</span>
              <select
                value={compareSort}
                onChange={(e) => setCompareSort(e.target.value as CompareSortMode)}
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="default">As added</option>
                <option value="days_on_market">Longest on market</option>
                <option value="price_cuts">Most price cuts</option>
              </select>
            </label>
          ) : null}
          <button
            type="button"
            onClick={goToTracker}
            className="rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 shadow-md shadow-emerald-500/20"
          >
            Continue to My Deal Tracker
          </button>
        </div>
      </div>

      {favoriteColumn ? (
        <VehicleOfferColumn
          column={favoriteColumn}
          highlighted
          wide
          buyerZip={snapshot.buyerZip}
          requested={snapshot.requestedStructures}
          terms={termsForVin(snapshot.request.dealStructurePreferences?.vehicleTerms, favoriteColumn.vehicle.vin)}
          sheet={sheets[favoriteColumn.vehicle.vin.toUpperCase()]}
          listingLoading={listingStatus === "loading"}
          onChangeTerms={updateTerms}
          sharedOptions={sharedOptions}
        />
      ) : null}

      {emptySlotsRemain && (snapshot.mustHaveLines.length > 0 || snapshot.niceToHaveLines.length > 0) ? (
        <SearchCriteriaPanel
          open={showCriteria}
          onToggle={() => setShowCriteria((v) => !v)}
          mustHaveLines={snapshot.mustHaveLines}
          niceToHaveLines={snapshot.niceToHaveLines}
          radiusMiles={radiusDraft ?? String(snapshot.searchRadiusMiles)}
          buyerZip={snapshot.buyerZip}
          onRemoveMustHave={removeMustHave}
          onRemoveNiceToHave={removeNiceToHave}
          onRadiusChange={setRadiusDraft}
          onRadiusCommit={commitRadius}
          onSearchAgain={() => {
            setCandidatesFetchedFor(null);
          }}
        />
      ) : null}

      {emptySlotsRemain ? (
        <CandidateListPanel
          loading={candidatesLoading}
          error={candidatesError}
          note={candidatesNote}
          fetched={candidates !== null}
          candidates={availableCandidates}
          selectedVins={selectedVins}
          maxSelectable={emptySlots.length}
          onToggle={toggleSelected}
          onConfirm={confirmSelection}
          hadEmptyResult={hadEmptyResult}
          onEditCriteria={() => setShowCriteria(true)}
        />
      ) : null}

      {baseColumns.some((c) => c.column) || emptySlotsRemain ? (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
          {columns.map(({ role, column }) => {
            if (column) {
              return (
                <VehicleOfferColumn
                  key={column.vehicle.vin}
                  column={column}
                  buyerZip={snapshot.buyerZip}
                  requested={snapshot.requestedStructures}
                  terms={termsForVin(snapshot.request.dealStructurePreferences?.vehicleTerms, column.vehicle.vin)}
                  sheet={sheets[column.vehicle.vin.toUpperCase()]}
                  listingLoading={listingStatus === "loading"}
                  onChangeTerms={updateTerms}
                  sharedOptions={sharedOptions}
                />
              );
            }
            const slot: 1 | 2 = role === "other_lot_1" ? 1 : 2;
            return (
              <CompetitorPasteSlot
                key={role}
                slot={slot}
                label={ROLE_LABELS[role]}
                paste={slotPaste[slot]}
                error={slotError[slot]}
                importing={importingSlot === slot}
                onPasteChange={(value) => {
                  setSlotPaste((prev) => ({ ...prev, [slot]: value }));
                  setSlotError((prev) => ({ ...prev, [slot]: null }));
                }}
                onImport={() => void importCompetitor(slot)}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

function CompetitorPasteSlot({
  slot,
  label,
  paste,
  error,
  importing,
  onPasteChange,
  onImport,
}: {
  slot: 1 | 2;
  label: string;
  paste: string;
  error: string | null;
  importing: boolean;
  onPasteChange: (value: string) => void;
  onImport: () => void;
}) {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-surface shadow-xl overflow-hidden flex flex-col">
      <div className="border-b border-border bg-surface-elevated px-4 py-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{label}</div>
        <h2 className="text-base font-black text-white mt-0.5">Already know one?</h2>
        <p className="text-[11px] text-ink-muted mt-0.5">Paste a VIN or dealer listing URL instead.</p>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-emerald-400" />
            <input
              type="text"
              value={paste}
              onChange={(e) => onPasteChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onImport();
              }}
              placeholder="17-character VIN or dealer listing URL"
              aria-label={`Competitor ${slot} VIN or dealer URL`}
              className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs text-white placeholder-ink-faint focus:border-emerald-500 focus:outline-none font-mono"
            />
          </div>
          <button
            type="button"
            onClick={onImport}
            disabled={importing || !paste.trim()}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 transition-all shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {importing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Importing…
              </>
            ) : (
              <>
                <Zap className="h-3.5 w-3.5 fill-black" />
                Import
              </>
            )}
          </button>
        </div>
        {error ? <p className="text-[11px] text-amber-200">{error}</p> : null}
      </div>
    </section>
  );
}

function CandidateListPanel({
  loading,
  error,
  note,
  fetched,
  candidates,
  selectedVins,
  maxSelectable,
  onToggle,
  onConfirm,
  hadEmptyResult,
  onEditCriteria,
}: {
  loading: boolean;
  error: string | null;
  note: string | null;
  fetched: boolean;
  candidates: ComparableSuggestion[];
  selectedVins: string[];
  maxSelectable: number;
  onToggle: (vin: string) => void;
  onConfirm: () => void;
  hadEmptyResult: boolean;
  onEditCriteria: () => void;
}) {
  return (
    <section className="rounded-3xl border border-border-strong bg-surface shadow-2xl overflow-hidden">
      <div className="border-b border-border bg-surface-elevated px-5 py-3.5 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            One search · every match
          </div>
          <h2 className="text-base font-black text-white mt-0.5">
            Select {maxSelectable === 1 ? "1 competing vehicle" : "up to 2 competing vehicles"}
          </h2>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Sorted by longest on the market, then lowest price.
          </p>
        </div>
        {selectedVins.length > 0 ? (
          <button
            type="button"
            onClick={onConfirm}
            className="shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 shadow-md shadow-emerald-500/20"
          >
            Add {selectedVins.length} selected
          </button>
        ) : null}
      </div>

      <div className="px-5 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-ink-muted py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching nearby listings…
          </div>
        ) : error ? (
          <p className="text-[11px] text-amber-200 py-2">{error}</p>
        ) : fetched && candidates.length === 0 ? (
          <div className="text-center py-6 space-y-2">
            <p className="text-xs text-ink-muted">{note || "No competing vehicles found nearby."}</p>
            {hadEmptyResult ? (
              <button
                type="button"
                onClick={onEditCriteria}
                className="text-[11px] font-bold text-emerald-300 hover:text-emerald-200 underline"
              >
                Loosen your search criteria
              </button>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                  <th className="w-8 py-1.5"></th>
                  <th className="py-1.5 pr-3">Vehicle</th>
                  <th className="py-1.5 pr-3">Dealer</th>
                  <th className="py-1.5 pr-3">Distance</th>
                  <th className="py-1.5 pr-3">Days on market</th>
                  <th className="py-1.5 pr-3 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((match) => {
                  const checked = selectedVins.includes(match.vin);
                  const disabled = !checked && selectedVins.length >= maxSelectable;
                  return (
                    <tr
                      key={match.vin}
                      className={`border-t border-border/60 text-xs ${disabled ? "opacity-40" : ""}`}
                    >
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => onToggle(match.vin)}
                          aria-label={`Select ${match.year || ""} ${match.make || ""} ${match.model || ""}`.trim()}
                          className="h-3.5 w-3.5 rounded border-border text-emerald-500 focus:ring-0"
                        />
                      </td>
                      <td className="py-2 pr-3 font-bold text-white whitespace-nowrap">
                        {[match.year, match.make, match.model, match.trim].filter(Boolean).join(" ")}
                      </td>
                      <td className="py-2 pr-3 text-ink-muted truncate max-w-[180px]">{match.dealerName}</td>
                      <td className="py-2 pr-3 text-ink-muted whitespace-nowrap">
                        {[match.city, match.state].filter(Boolean).join(", ")}
                        {match.distanceMiles != null ? ` · ${match.distanceMiles} mi` : ""}
                      </td>
                      <td className="py-2 pr-3 text-ink-muted whitespace-nowrap">
                        {match.daysOnMarket != null ? `${match.daysOnMarket}d` : "—"}
                        {typeof match.priceChangeHint === "number" && match.priceChangeHint < 0 ? (
                          <span className="ml-1.5 text-emerald-400 font-semibold">price cut</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-white whitespace-nowrap">
                        {match.listingPrice ? formatPriceAmount(match.listingPrice) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function SearchCriteriaPanel({
  open,
  onToggle,
  mustHaveLines,
  niceToHaveLines,
  radiusMiles,
  buyerZip,
  onRemoveMustHave,
  onRemoveNiceToHave,
  onRadiusChange,
  onRadiusCommit,
  onSearchAgain,
}: {
  open: boolean;
  onToggle: () => void;
  mustHaveLines: string[];
  niceToHaveLines: string[];
  radiusMiles: string;
  buyerZip: string;
  onRemoveMustHave: (line: string) => void;
  onRemoveNiceToHave: (line: string) => void;
  onRadiusChange: (value: string) => void;
  onRadiusCommit: () => void;
  onSearchAgain: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface shadow-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Search criteria</div>
          <h2 className="text-sm font-black text-white mt-0.5">Radius, must-haves &amp; nice-to-haves</h2>
        </div>
        <span className="text-[11px] font-bold text-emerald-300 shrink-0">{open ? "Hide" : "Edit"}</span>
      </button>
      {open ? (
        <div className="border-t border-border px-4 py-3 space-y-3">
          <p className="text-[11px] text-ink-muted">
            The search below matches by trim, not by these lines — widen the radius to see more, or verify
            equipment on a vehicle after you select it.
          </p>
          {mustHaveLines.length > 0 ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint mb-1.5">Must-haves</p>
              <div className="flex flex-wrap gap-1.5">
                {mustHaveLines.map((line) => (
                  <span
                    key={line}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300"
                  >
                    {line}
                    <button
                      type="button"
                      onClick={() => onRemoveMustHave(line)}
                      aria-label={`Remove must-have ${line}`}
                      className="text-emerald-300 hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {niceToHaveLines.length > 0 ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint mb-1.5">Nice-to-haves</p>
              <div className="flex flex-wrap gap-1.5">
                {niceToHaveLines.map((line) => (
                  <span
                    key={line}
                    className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-surface-elevated px-2 py-0.5 text-[10px] font-bold text-ink-light"
                  >
                    {line}
                    <button
                      type="button"
                      onClick={() => onRemoveNiceToHave(line)}
                      aria-label={`Remove nice-to-have ${line}`}
                      className="text-ink-muted hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {mustHaveLines.length === 0 && niceToHaveLines.length === 0 ? (
            <p className="text-[11px] text-ink-muted">No must-haves set — try widening your search radius instead.</p>
          ) : null}
          <div className="flex items-end gap-3">
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Radius (mi)</span>
              <input
                type="number"
                min={1}
                value={radiusMiles}
                onChange={(e) => onRadiusChange(e.target.value)}
                onBlur={onRadiusCommit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onRadiusCommit();
                }}
                className="w-24 rounded-lg border border-border bg-background py-1.5 px-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <span className="text-[11px] text-ink-muted pb-1.5">from {buyerZip || "your ZIP"}</span>
            <button
              type="button"
              onClick={onSearchAgain}
              className="ml-auto rounded-xl bg-emerald-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-emerald-400 shadow-md"
            >
              Search again
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function VehicleOfferColumn({
  column,
  highlighted,
  wide,
  buyerZip,
  requested,
  terms,
  sheet,
  listingLoading,
  onChangeTerms,
  sharedOptions,
}: {
  column: OfferCompareVehicle;
  highlighted?: boolean;
  /** Lays the identity header and the terms/options body side by side on wide screens, instead of a tall grid column. */
  wide?: boolean;
  buyerZip: string;
  requested: DealStructureMethod[];
  terms: VehicleDealTerms | undefined;
  sheet: ShopperListingSheet | undefined;
  listingLoading: boolean;
  onChangeTerms: (next: VehicleDealTerms) => void;
  sharedOptions: Set<string>;
}) {
  const vehicle = column.vehicle;
  const reviewPrice = columnAdvertised(vehicle, sheet);
  const vdp = listingVdpHref(sheet?.vdpUrl) || listingVdpHref(vehicle.dealerUrl);
  const loc = vehicle.location;
  const cityStateZip = [ [loc?.city, loc?.state].filter(Boolean).join(", "), loc?.zip ].filter(Boolean).join(" ");
  const distance = milesLabel(loc?.distanceMiles, buyerZip);
  const options = factoryLines(vehicle);
  const listingNote = sheet && !sheet.available
    ? sanitizeShopperListingsCopy(sheet.note || LISTING_DETAILS_UNAVAILABLE)
    : null;

  const patch = (partial: Partial<VehicleDealTerms>) => {
    onChangeTerms({
      vin: vehicle.vin.toUpperCase(),
      cash: terms?.cash,
      finance: terms?.finance,
      lease: terms?.lease,
      ...partial,
    });
  };

  const financeEst = terms?.finance
    ? roundEstimateDollars(
        estimatedFinanceMonthly(
          terms.finance.sellingPrice,
          terms.finance.downPayment,
          terms.finance.termMonths,
          terms.finance.aprPercent
        )
      )
    : null;
  const leaseEstimate = terms?.lease ? calculateLeaseEstimate(terms.lease) : null;
  const leaseEst = roundEstimateDollars(leaseEstimate?.totalMonthly ?? null);
  const leaseDueAtSigningEst = roundEstimateDollars(leaseEstimate?.estimatedDueAtSigning ?? null);

  return (
    <section
      className={`rounded-2xl bg-surface shadow-xl overflow-hidden flex flex-col ${wide ? "lg:flex-row" : ""} ${highlighted ? "border-2 border-emerald-500" : "border border-border"}`}
    >
      <div className={`border-b border-border bg-surface-elevated px-4 py-3 ${wide ? "lg:w-80 lg:shrink-0 lg:border-b-0 lg:border-r" : ""}`}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">{column.label}</div>
        <h2 className="text-base font-black text-white mt-0.5">
          {[vehicle.year > 0 ? vehicle.year : null, vehicle.make, vehicle.model, vehicle.trim]
            .filter(Boolean)
            .join(" ") || "Imported vehicle"}
        </h2>
        {vehicle.vin ? (
          <p className="text-[11px] text-ink-muted mt-0.5">
            VIN:{" "}
            {vdp ? (
              <a href={vdp} target="_blank" rel="noopener noreferrer" className="font-mono text-emerald-400 hover:underline">
                {vehicle.vin}
              </a>
            ) : (
              <span className="font-mono text-ink-light">{vehicle.vin}</span>
            )}
          </p>
        ) : null}
        {loc?.dealerName ? (
          <p className="text-xs text-ink-light mt-1 flex items-start gap-1.5">
            <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-ink-faint" />
            <span>
              {loc.dealerName}
              {cityStateZip ? <span className="text-ink-muted"> · {cityStateZip}</span> : null}
              {distance ? <span className="text-ink-muted"> · {distance}</span> : null}
            </span>
          </p>
        ) : cityStateZip ? (
          <p className="text-xs text-ink-muted mt-1">{cityStateZip}{distance ? ` · ${distance}` : ""}</p>
        ) : null}
        <div className="mt-2">
          <div className="text-lg font-black text-white">
            {formatPriceAmount(reviewPrice.amount)}{" "}
            <span className="uppercase text-[9px] font-bold text-ink-faint">
              {shopperPriceSourceLabel(reviewPrice.source)}
            </span>
          </div>
          {reviewPrice.source === "listing" && vehicle.msrp > 0 ? (
            <div className="text-[11px] text-ink-muted">MSRP {formatPriceAmount(vehicle.msrp)}</div>
          ) : null}
        </div>
      </div>

      <div className={`px-4 py-3 space-y-3 flex-1 ${wide ? "lg:overflow-y-auto lg:max-h-[520px]" : ""}`}>
        <div className="space-y-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Terms for this VIN
          </div>
          <p className="text-[10px] text-ink-faint">
            These prices cover the vehicle and dealer fees only. Registration fees and
            taxes are calculated after the deal is accepted. A trade-in, if you have
            one, is handled as a separate step.
          </p>
          {requested.includes("cash") && terms?.cash ? (
            <div className="rounded-xl border border-border bg-background p-3 space-y-2">
              <div className="text-[11px] font-bold text-white">{DEAL_STRUCTURE_LABELS.cash}</div>
              {moneyInput(terms.cash.offerPrice, (offerPrice) => patch({ cash: { offerPrice } }), "Offer price")}
            </div>
          ) : null}
          {requested.includes("finance") && terms?.finance ? (
            <div className="rounded-xl border border-border bg-background p-3 space-y-2">
              <div className="text-[11px] font-bold text-white">{DEAL_STRUCTURE_LABELS.finance}</div>
              {moneyInput(terms.finance.sellingPrice, (sellingPrice) => patch({ finance: { ...terms.finance!, sellingPrice } }), "Selling price")}
              {moneyInput(terms.finance.downPayment, (downPayment) => patch({ finance: { ...terms.finance!, downPayment } }), "Down payment")}
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Term</span>
                <select
                  value={terms.finance.termMonths}
                  onChange={(e) => patch({ finance: { ...terms.finance!, termMonths: Number(e.target.value) } })}
                  className="w-full rounded-lg border border-border bg-background py-1.5 px-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                >
                  {FINANCE_TERM_MONTHS.map((m) => (
                    <option key={m} value={m}>{m} months</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">APR %</span>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={terms.finance.aprPercent}
                  onChange={(e) => patch({ finance: { ...terms.finance!, aprPercent: Number(e.target.value) || 0 } })}
                  className="w-full rounded-lg border border-border bg-background py-1.5 px-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                />
              </label>
              <p className="text-[11px] text-emerald-400 font-semibold">
                Estimated monthly: {financeEst != null ? formatPriceAmount(financeEst) : "—"}
              </p>
              <p className="text-[10px] text-ink-faint">Estimate only — not a dealer quote.</p>
            </div>
          ) : null}
          {requested.includes("lease") && terms?.lease ? (
            <div className="rounded-xl border border-border bg-background p-3 space-y-2">
              <div className="text-[11px] font-bold text-white">{DEAL_STRUCTURE_LABELS.lease}</div>
              {moneyInput(terms.lease.capCost, (capCost) => patch({ lease: { ...terms.lease!, capCost } }), "Gross cap cost (negotiated price)")}
              {moneyInput(terms.lease.rebates ?? 0, (rebates) => patch({ lease: { ...terms.lease!, rebates } }), "Rebates / incentives")}
              {moneyInput(terms.lease.dueAtSigning, (dueAtSigning) => patch({ lease: { ...terms.lease!, dueAtSigning } }), "Cap cost reduction (down payment)")}
              {moneyInput(terms.lease.acquisitionFee ?? 0, (acquisitionFee) => patch({ lease: { ...terms.lease!, acquisitionFee } }), "Acquisition fee (rolled into cap cost)")}
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Term</span>
                  <select
                    value={terms.lease.termMonths}
                    onChange={(e) => patch({ lease: { ...terms.lease!, termMonths: Number(e.target.value) } })}
                    className="w-full rounded-lg border border-border bg-background py-1.5 px-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  >
                    {LEASE_TERM_MONTHS.map((m) => (
                      <option key={m} value={m}>{m} months</option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Miles / year</span>
                  <input
                    type="number"
                    min={0}
                    value={terms.lease.milesPerYear}
                    onChange={(e) => patch({ lease: { ...terms.lease!, milesPerYear: Number(e.target.value) || 0 } })}
                    className="w-full rounded-lg border border-border bg-background py-1.5 px-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Money factor</span>
                  <input
                    type="number"
                    min={0}
                    step="0.0001"
                    value={terms.lease.moneyFactor}
                    onChange={(e) => patch({ lease: { ...terms.lease!, moneyFactor: Number(e.target.value) || 0 } })}
                    className="w-full rounded-lg border border-border bg-background py-1.5 px-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Residual %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={terms.lease.residualPercent}
                    onChange={(e) => patch({ lease: { ...terms.lease!, residualPercent: Number(e.target.value) || 0 } })}
                    className="w-full rounded-lg border border-border bg-background py-1.5 px-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Sales tax %</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    step="0.1"
                    value={terms.lease.salesTaxPercent ?? 0}
                    onChange={(e) => patch({ lease: { ...terms.lease!, salesTaxPercent: Number(e.target.value) || 0 } })}
                    className="w-full rounded-lg border border-border bg-background py-1.5 px-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Tax method</span>
                  <select
                    value={terms.lease.taxMethod ?? "monthly"}
                    onChange={(e) => patch({ lease: { ...terms.lease!, taxMethod: e.target.value as "monthly" | "upfront" } })}
                    className="w-full rounded-lg border border-border bg-background py-1.5 px-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  >
                    {LEASE_TAX_METHODS.map((m) => (
                      <option key={m} value={m}>{m === "monthly" ? "Monthly payment" : "Upfront on cap cost"}</option>
                    ))}
                  </select>
                </label>
              </div>
              {moneyInput(terms.lease.dispositionFee ?? 0, (dispositionFee) => patch({ lease: { ...terms.lease!, dispositionFee } }), "Disposition fee (due at lease end)")}
              <p className="text-[11px] text-emerald-400 font-semibold">
                Estimated monthly: {leaseEst != null ? formatPriceAmount(leaseEst) : "—"}
              </p>
              <p className="text-[11px] text-emerald-400 font-semibold">
                Est. due at signing: {leaseDueAtSigningEst != null ? formatPriceAmount(leaseDueAtSigningEst) : "—"}
              </p>
              <p className="text-[10px] text-ink-faint">Estimate only — not a dealer quote.</p>
            </div>
          ) : null}
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {FORD_COMPETITION_FACTORY_OPTIONS}
            </div>
            {sharedOptions.size > 0 ? (
              <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                <Check className="h-3 w-3" /> on another car
              </div>
            ) : null}
          </div>
          {options.length === 0 ? (
            <p className="text-[11px] text-ink-muted mt-1">{FORD_COMPETITION_FACTORY_OPTIONS_UNAVAILABLE}</p>
          ) : (
            <ul className="mt-1 max-h-36 overflow-y-auto space-y-0.5">
              {options.map((opt, i) => {
                const shared = isSharedFactoryOption(opt.description, sharedOptions);
                return (
                  <li
                    key={`${opt.code || ""}-${opt.description}-${i}`}
                    className={`text-[11px] leading-snug rounded px-1 -mx-1 flex items-start gap-1 ${
                      opt.isPackageChild ? "pl-3 text-ink-muted" : "text-ink-light"
                    } ${shared ? "bg-emerald-500/10 text-emerald-200" : ""}`}
                  >
                    {shared ? <Check className="h-3 w-3 mt-0.5 shrink-0 text-emerald-400" /> : null}
                    <span>
                      {formatFactoryOptionLine(opt)}
                      {opt.price != null && opt.price > 0 ? (
                        <span className="text-ink-faint"> · {formatCurrency(opt.price)}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-background p-3 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Listing details</div>
          {listingLoading && !sheet ? (
            <p className="text-[11px] text-ink-muted flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading listing details…
            </p>
          ) : listingNote ? (
            <p className="text-[11px] text-ink-muted">{listingNote}</p>
          ) : sheet?.available ? (
            <ListingFacts sheet={sheet} />
          ) : (
            <p className="text-[11px] text-ink-muted">{LISTING_DETAILS_UNAVAILABLE}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function ListingFacts({ sheet }: { sheet: ShopperListingSheet }) {
  const facts: Array<{ label: string; value: React.ReactNode }> = [];
  if (sheet.advertisedPrice) facts.push({ label: "Advertised price", value: formatPriceAmount(sheet.advertisedPrice) });
  if (sheet.msrp) facts.push({ label: "MSRP", value: formatPriceAmount(sheet.msrp) });
  if (sheet.daysOnMarket != null) facts.push({ label: "Days on market", value: String(sheet.daysOnMarket) });
  if (sheet.daysOnMarketActive != null) {
    facts.push({ label: "Days on market (active)", value: String(sheet.daysOnMarketActive) });
  }
  if (sheet.firstSeen) facts.push({ label: "First seen", value: sheet.firstSeen });
  if (sheet.lastSeen) facts.push({ label: "Last seen", value: sheet.lastSeen });
  if (sheet.stockNumber) facts.push({ label: "Stock #", value: sheet.stockNumber });
  if (sheet.inventoryType) facts.push({ label: "Inventory", value: sheet.inventoryType });
  if (sheet.exteriorColor) facts.push({ label: "Exterior", value: sheet.exteriorColor });
  if (sheet.interiorColor) facts.push({ label: "Interior", value: sheet.interiorColor });
  if (sheet.mileage != null) facts.push({ label: "Mileage", value: `${sheet.mileage.toLocaleString()} mi` });
  if (sheet.inTransit) facts.push({ label: "Status", value: "In transit" });
  const dealerLine = [sheet.dealerStreet, [sheet.dealerCity, sheet.dealerState].filter(Boolean).join(", "), sheet.dealerZip]
    .filter(Boolean)
    .join(", ");
  if (sheet.dealerName) facts.push({ label: "Dealer", value: sheet.dealerName });
  if (dealerLine) facts.push({ label: "Address", value: dealerLine });
  if (sheet.dealerPhone) {
    facts.push({
      label: "Phone",
      value: (
        <span className="inline-flex items-center gap-1">
          <Phone className="h-3 w-3" /> {sheet.dealerPhone}
        </span>
      ),
    });
  }

  return (
    <div className="space-y-2">
      {sheet.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={sheet.photoUrl} alt="" className="w-full h-28 object-cover rounded-lg border border-border" />
      ) : null}
      <dl className="grid grid-cols-1 gap-1">
        {facts.map((fact) => (
          <div key={fact.label} className="flex justify-between gap-2 text-[11px]">
            <dt className="text-ink-faint shrink-0">{fact.label}</dt>
            <dd className="text-ink-light text-right">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {sheet.priceHistory && sheet.priceHistory.length > 0 ? (
        <div className="pt-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Price history</div>
          <ul className="mt-1 space-y-0.5">
            {sheet.priceHistory.map((entry) => (
              <li key={`${entry.date}-${entry.price}`} className="text-[11px] font-mono text-ink-light">
                {formatPriceHistoryLine(entry)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {sheet.vdpUrl ? (
        <a
          href={sheet.vdpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-emerald-400 hover:underline"
        >
          Dealer listing
        </a>
      ) : null}
      {sheet.attribution ? (
        <p className="text-[10px] text-ink-faint pt-1">{sheet.attribution}</p>
      ) : null}
    </div>
  );
}
