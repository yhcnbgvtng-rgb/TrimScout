"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Car,
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
  loadOfferCompareSnapshot,
  saveOfferCompareSnapshot,
  setLandingView,
  upsertShopperRequest,
  vehicleForCompareRole,
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
  const [slotPaste, setSlotPaste] = useState<Record<1 | 2, string>>({ 1: "", 2: "" });
  const [slotError, setSlotError] = useState<Record<1 | 2, string | null>>({ 1: null, 2: null });
  const [importingSlot, setImportingSlot] = useState<1 | 2 | null>(null);

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

  useEffect(() => {
    if (!vinKey) return;
    const vins = vinKey.split(",").filter((vin) => vin.length === 17);
    let cancelled = false;
    setListingStatus("loading");
    fetch("/api/listing-facts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vins }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        const rows = Array.isArray(json.sheets) ? (json.sheets as ShopperListingSheet[]) : [];
        const byVin: Record<string, ShopperListingSheet> = {};
        for (const row of rows) {
          if (row?.vin) byVin[row.vin.toUpperCase()] = row;
        }
        setSheets(byVin);
      })
      .catch(() => {
        if (cancelled) return;
        const byVin: Record<string, ShopperListingSheet> = {};
        for (const vin of vins) {
          byVin[vin] = unavailableSheet(vin, FORD_LISTINGS_LOAD_FAILED);
        }
        setSheets(byVin);
      })
      .finally(() => {
        if (!cancelled) setListingStatus("ready");
      });
    return () => {
      cancelled = true;
    };
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

  const columns = COMPARE_COLUMN_ROLES.map((role) => ({
    role,
    column: vehicleForCompareRole(snapshot, role),
  }));

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
        <button
          type="button"
          onClick={goToTracker}
          className="rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-400 shadow-md shadow-emerald-500/20"
        >
          Continue to My Deal Tracker
        </button>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {columns.map(({ role, column }) => {
          if (column) {
            return (
              <VehicleOfferColumn
                key={column.vehicle.vin}
                column={column}
                highlighted={role === "favorite"}
                buyerZip={snapshot.buyerZip}
                requested={snapshot.requestedStructures}
                terms={termsForVin(snapshot.request.dealStructurePreferences?.vehicleTerms, column.vehicle.vin)}
                sheet={sheets[column.vehicle.vin.toUpperCase()]}
                listingLoading={listingStatus === "loading"}
                onChangeTerms={updateTerms}
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
    <section className="rounded-2xl border border-dashed border-border bg-surface shadow-xl overflow-hidden flex flex-col min-h-[240px]">
      <div className="border-b border-border bg-surface-elevated px-4 py-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{label}</div>
        <h2 className="text-base font-black text-white mt-0.5">Add a competitor</h2>
        <p className="text-[11px] text-ink-muted mt-0.5">Paste a VIN or dealer listing URL.</p>
      </div>
      <div className="px-4 py-3 space-y-2 flex-1">
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

function VehicleOfferColumn({
  column,
  highlighted,
  buyerZip,
  requested,
  terms,
  sheet,
  listingLoading,
  onChangeTerms,
}: {
  column: OfferCompareVehicle;
  highlighted?: boolean;
  buyerZip: string;
  requested: DealStructureMethod[];
  terms: VehicleDealTerms | undefined;
  sheet: ShopperListingSheet | undefined;
  listingLoading: boolean;
  onChangeTerms: (next: VehicleDealTerms) => void;
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
    <section className={`rounded-2xl bg-surface shadow-xl overflow-hidden flex flex-col ${highlighted ? "border-2 border-emerald-500" : "border border-border"}`}>
      <div className="border-b border-border bg-surface-elevated px-4 py-3">
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

      <div className="px-4 py-3 space-y-3 flex-1">
        <div className="space-y-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Terms for this VIN
          </div>
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
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {FORD_COMPETITION_FACTORY_OPTIONS}
          </div>
          {options.length === 0 ? (
            <p className="text-[11px] text-ink-muted mt-1">{FORD_COMPETITION_FACTORY_OPTIONS_UNAVAILABLE}</p>
          ) : (
            <ul className="mt-1 max-h-36 overflow-y-auto space-y-0.5">
              {options.map((opt, i) => (
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
