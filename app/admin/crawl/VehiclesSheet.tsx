"use client";

// The Vehicles side of the crawl sheet: crawled dealer inventory, server-paged (the table is far bigger than
// the dealer list), with the filters the box indexes — state, make, model, trim, condition, in-stock, free
// text — server-side sort, and a CSV of the whole current filter (capped at 50k rows).
//
// FILTER-FIRST. The tab lands EMPTY: no rows are queried until the admin presses Apply (or Enter in the search
// box) or Load all. Two copies of the filters exist — the DRAFT being edited and the APPLIED set the table shows
// (lib/vehicleFilters.ts); editing the draft never fetches rows. State/Make/Model/Trim are multi-select (OR
// within a field, AND across fields) using the same searchable-combobox the buyer /search page does
// (SearchableDropdown), themed emerald, with removable chips for every pick.
//
// FACET COUNTS follow the DRAFT selections, not the last-applied set — Model/Trim must unlock the moment a
// make is ticked, before Apply. They are fetched lazily (first time any dropdown opens, never on page load) and
// again only when a State/Make/Model selection changes (debounced, previous request aborted) — typing inside a
// dropdown just filters its loaded list client-side. Each list excludes its own field's selection so you can
// keep adding to it; counts are in-stock vehicles scoped by State/Make/Model only (see inventoryAdminFacets.js).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, ListChecks, RefreshCw, Search, X } from "lucide-react";
import { VEHICLE_SHEET_COLUMNS, vehicleRowCell, vehicleSheetFilename, type VehicleRow } from "@/lib/crawlSheetColumns";
import {
  EMPTY_FILTERS, activeFilterCount, buildVehicleQuery, cascadeCleared, facetKey, facetParams, filtersEqual, hasAnyFilter, loadAllFilters, pruneToOptions,
  type Movement, type SortKey, type VehicleFilters, type VehicleSort,
} from "@/lib/vehicleFilters";
import SearchableDropdown, { type DropdownOption } from "@/components/search/SearchableDropdown";
import VinHistory from "./VinHistory";

type Stats = { total: number; inStock: number; dealers: number; vins?: number; lastSeenAt: string | null; movement?: { arrivals: number; priceDrops: number; priceIncreases: number; withSticker: number; removedToday: number } };
const SORT_FOR: Partial<Record<keyof VehicleRow, SortKey>> = { dealerName: "dealer", year: "year", make: "make", model: "model", price: "price", mileage: "mileage", lastSeenAt: "seen", daysOnLot: "days", priceDiff: "pricediff", msrp: "msrp" };
const COL_W: Partial<Record<keyof VehicleRow, number>> = { dealerName: 240, dealerState: 60, dealerCity: 130, condition: 90, year: 64, make: 110, model: 130, trim: 190, vin: 170, stockNumber: 100, price: 90, priceDiff: 90, msrp: 90, mileage: 80, daysOnLot: 90, changeType: 110, windowStickerUrl: 120, exteriorColor: 170, interiorColor: 150, bodyStyle: 100, engine: 200, transmission: 200, options: 260, optionsTotal: 90, vdpUrl: 260, crawlFirstSeen: 110, firstSeenAt: 100, lastSeenAt: 100, removedAt: 100, source: 90, sourceBox: 70 };
const PAGE = 500;
const ROW_H = 32;
// The CSV is capped at this many rows (lib/inventoryApi exportInventory); "Load all" asks first above it.
const CSV_CAP = 50000;
// A State/Make/Model selection change refetches facet counts after this pause, so ticking several boxes in a row
// is one request, not one per click.
const FACET_DEBOUNCE_MS = 250;
const CONDITIONS: Array<[string, string]> = [["new", "New"], ["used", "Used"], ["cpo", "Certified"]];

const money = (n: number | null) => (n == null ? "" : `$${n.toLocaleString()}`);
const condLabel = (c: string | null) => ({ new: "New", used: "Used", cpo: "Certified" } as Record<string, string>)[c || ""] || (c || "—");

function toOptions<T>(rows: T[], valueKey: keyof T, countKey: keyof T): DropdownOption[] {
  return rows.map((r) => ({ value: String(r[valueKey]), label: String(r[valueKey]), count: Number(r[countKey]) || 0 }));
}

type Applied = { filters: VehicleFilters; kind: "filters" | "all"; nonce: number };

export default function VehiclesSheet({ initialVin = null }: { initialVin?: string | null }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalCapped, setTotalCapped] = useState(false);
  const [lastPageFull, setLastPageFull] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<VehicleFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [sort, setSort] = useState<VehicleSort>({ key: "dealer", dir: "asc" });
  const [exporting, setExporting] = useState(false);
  const [vinOpen, setVinOpen] = useState<string | null>(initialVin);
  const typedVin = /^[A-HJ-NPR-Z0-9]{17}$/i.test(draft.q.trim()) ? draft.q.trim().toUpperCase() : null;

  const [stateOptions, setStateOptions] = useState<DropdownOption[]>([]);
  const [makeOptions, setMakeOptions] = useState<DropdownOption[]>([]);
  const [modelOptions, setModelOptions] = useState<DropdownOption[]>([]);
  const [trimOptions, setTrimOptions] = useState<DropdownOption[]>([]);
  const [facetsWanted, setFacetsWanted] = useState(false);
  const [facetsLoading, setFacetsLoading] = useState(false);
  const [facetsError, setFacetsError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Set when a make/model pick was removed: the next facet response (now scoped to what is left) is used to
  // drop child picks that no longer exist, repeating until nothing more is dropped.
  const pruneRef = useRef(false);

  // ---- draft edits (never fetch rows) -----------------------------------------------------------------
  const edit = (fn: (d: VehicleFilters) => VehicleFilters) => setDraft((d) => cascadeCleared(fn(d)));
  const setList = (field: "states" | "makes" | "models" | "trims" | "conds") => (v: string[]) =>
    edit((d) => {
      if ((field === "makes" || field === "models") && v.length < d[field].length) pruneRef.current = true;
      return { ...d, [field]: v };
    });
  const removeChip = (field: "states" | "makes" | "models" | "trims", value: string) => setList(field)(draft[field].filter((x) => x !== value));

  // ---- facet counts: lazy, scoped by the draft's State/Make/Model, debounced ---------------------------
  const fKey = facetKey(draft);
  useEffect(() => {
    if (!facetsWanted) return;
    const controller = new AbortController();
    // Loading shows at once (not after the debounce) so the first open reads "Loading…", never a false "No matches."
    setFacetsLoading(true);
    const t = setTimeout(() => {
      setFacetsError(null);
      fetch(`/api/admin/inventory?${facetParams(draftRef.current)}`, { cache: "no-store", signal: controller.signal })
        .then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => null) }))
        .then(({ ok, json }) => {
          if (!ok || !json) throw new Error(json?.error || "Facet counts unavailable.");
          setStateOptions(toOptions(json.states || [], "state", "n"));
          setMakeOptions(toOptions(json.makes || [], "make", "n"));
          setModelOptions(toOptions(json.models || [], "model", "n"));
          setTrimOptions(toOptions(json.trims || [], "trim", "n"));
          if (pruneRef.current) {
            const cur = draftRef.current;
            const next = pruneToOptions(cur, (json.models || []).map((m: { model: string }) => m.model), (json.trims || []).map((m: { trim: string }) => m.trim));
            if (next !== cur) setDraft(next); else pruneRef.current = false;
          }
        })
        .catch((e) => {
          if (e?.name === "AbortError") return;
          setStateOptions([]); setMakeOptions([]); setModelOptions([]); setTrimOptions([]);
          setFacetsError(e instanceof Error ? e.message : "Facet counts unavailable.");
        })
        .finally(() => { if (!controller.signal.aborted) setFacetsLoading(false); });
    }, FACET_DEBOUNCE_MS);
    return () => { clearTimeout(t); controller.abort(); };
  }, [facetsWanted, fKey]);
  const wantFacets = useCallback(() => setFacetsWanted(true), []);

  // ---- rows: only ever for the APPLIED filters --------------------------------------------------------
  const query = useMemo(() => (applied ? buildVehicleQuery(applied.filters, sort) : null), [applied, sort]);

  const loadStats = useCallback(async () => {
    const res = await fetch("/api/admin/inventory?stats=1", { cache: "no-store" });
    const json = await res.json();
    if (res.ok) setStats(json);
  }, []);

  const loadRequestRef = useRef(0);
  const load = useCallback(async (q: URLSearchParams, offset: number, append: boolean, signal?: AbortSignal) => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams(q);
      p.set("limit", String(PAGE));
      p.set("offset", String(offset));
      const res = await fetch(`/api/admin/inventory?${p}`, { cache: "no-store", signal });
      if (requestId !== loadRequestRef.current) return; // a newer request has since superseded this one
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load inventory.");
      setTotal(json.total);
      setTotalCapped(Boolean(json.totalCapped));
      setLastPageFull((json.vehicles?.length || 0) >= PAGE);
      setRows((prev) => (append ? [...prev, ...json.vehicles] : json.vehicles));
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      if (requestId !== loadRequestRef.current) return;
      setError(e instanceof Error ? e.message : "Could not load inventory.");
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadStats(); }, [loadStats]);
  // Applying (or re-sorting an applied list) loads page 1; no applied filters = the empty state, nothing queried.
  // A newer request aborts whatever was still in flight, so a slow earlier response never overwrites a later one.
  useEffect(() => {
    if (!query) {
      loadRequestRef.current++;
      setRows([]); setTotal(0); setTotalCapped(false); setLastPageFull(false); setLoading(false); setError(null);
      return;
    }
    const controller = new AbortController();
    void load(query, 0, false, controller.signal);
    return () => controller.abort();
  }, [query, load]);

  // ---- actions ----------------------------------------------------------------------------------------
  const applyFilters = (filters: VehicleFilters, kind: Applied["kind"] = "filters") => setApplied({ filters: { ...filters, q: filters.q.trim() }, kind, nonce: Date.now() });
  const canApply = hasAnyFilter(draft);
  const apply = () => { if (canApply) applyFilters(draft); };
  const dirty = applied ? !filtersEqual(draft, applied.filters) : canApply;
  // Load all = the list with NO dropdown/search/toggle filters. The one thing carried over is the "In stock only"
  // checkbox as it currently stands (default on), so Load all matches what that box says it will show.
  const loadAll = () => {
    const est = draft.inStock ? stats?.inStock : stats?.total;
    if (est && est > CSV_CAP && !window.confirm(`Load all ~${est.toLocaleString()} vehicles?\n\nThey load ${PAGE} at a time, and the CSV download is capped at ${CSV_CAP.toLocaleString()} rows. Adding filters first is usually quicker.`)) return;
    const f = loadAllFilters(draft);
    setDraft(f);
    applyFilters(f, "all");
  };
  const clearAll = () => { pruneRef.current = false; setDraft(EMPTY_FILTERS); setApplied(null); };
  const onTile = (mv: Movement) => {
    // A movement tile is an explicit one-click "show me these", so it applies straight away (with whatever else is in the draft).
    const f = { ...draft, movement: draft.movement === mv ? ("" as Movement) : mv };
    setDraft(f);
    if (hasAnyFilter(f)) applyFilters(f); else setApplied(null);
  };

  const download = async () => {
    if (!query) return;
    setExporting(true);
    try {
      const p = new URLSearchParams(query);
      p.set("export", "1");
      // The route streams the CSV itself; a failure before the first row comes back as JSON instead.
      const res = await fetch(`/api/admin/inventory?${p}`, { cache: "no-store" });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error || "Export failed.");
      const blob = await res.blob().catch(() => { throw new Error("Export was cut off partway through — try again."); });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = vehicleSheetFilename();
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (total > CSV_CAP || totalCapped) setError("Export stopped at 50,000 rows — narrow the filter for the rest.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const onHeader = (key: keyof VehicleRow) => { const sk = SORT_FOR[key]; if (!sk) return; setSort((s) => (s.key === sk ? { key: sk, dir: s.dir === "asc" ? "desc" : "asc" } : { key: sk, dir: sk === "price" || sk === "year" || sk === "seen" || sk === "days" || sk === "msrp" ? "desc" : "asc" })); };
  const totalW = VEHICLE_SHEET_COLUMNS.reduce((s, c) => s + (COL_W[c.key] || 120), 0);
  const canLoadMore = rows.length > 0 && (totalCapped ? lastPageFull : rows.length < total);
  const totalLabel = `${total.toLocaleString()}${totalCapped ? "+" : ""}`;
  const chipGroups: Array<{ field: "states" | "makes" | "models" | "trims"; label: string }> = [
    { field: "states", label: "State" }, { field: "makes", label: "Make" }, { field: "models", label: "Model" }, { field: "trims", label: "Trim" },
  ];
  const hasChips = chipGroups.some((g) => draft[g.field].length > 0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-surface p-3 flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
          <input id="veh-search" value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} placeholder="Search VIN, dealer, model, trim, stock #… (Enter to apply)" className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3 py-2 text-xs text-white placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
        </div>
        {typedVin && (
          <button type="button" onClick={() => setVinOpen(typedVin)} className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/20">VIN history →</button>
        )}
        <div className="w-44">
          <SearchableDropdown multi multiMode="any" selectedNoun="state" accent="emerald" label="State" placeholder="All states" options={stateOptions} value={draft.states} loading={facetsLoading} onChange={setList("states")} onOpen={wantFacets} emptyMessage={facetsError ?? undefined} />
        </div>
        <div className="w-44">
          <SearchableDropdown multi multiMode="any" selectedNoun="make" accent="emerald" label="Make" placeholder="All makes" options={makeOptions} value={draft.makes} loading={facetsLoading} onChange={setList("makes")} onOpen={wantFacets} emptyMessage={facetsError ?? undefined} />
        </div>
        <div className="w-44">
          <SearchableDropdown multi multiMode="any" selectedNoun="model" accent="emerald" label="Model" placeholder="All models" options={modelOptions} value={draft.models} loading={facetsLoading} onChange={setList("models")} onOpen={wantFacets} disabledHint={draft.makes.length ? undefined : "Pick a make first"} emptyMessage={facetsError ?? undefined} />
        </div>
        <div className="w-44">
          <SearchableDropdown multi multiMode="any" selectedNoun="trim" accent="emerald" label="Trim" placeholder="Any trim" options={trimOptions} value={draft.trims} loading={facetsLoading} onChange={setList("trims")} onOpen={wantFacets} disabledHint={draft.models.length ? undefined : "Pick a model first"} emptyMessage={facetsError ?? undefined} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-ink-faint">Condition</span>
          <div className="flex gap-1" role="group" aria-label="Condition">
            {CONDITIONS.map(([value, label]) => {
              const on = draft.conds.includes(value);
              return (
                <button key={value} type="button" aria-pressed={on} onClick={() => setList("conds")(on ? draft.conds.filter((c) => c !== value) : [...draft.conds, value])} className={`rounded-xl border px-2.5 py-2.5 text-[11px] font-bold ${on ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-border bg-surface-elevated text-ink-light hover:text-white"}`}>{label}</button>
              );
            })}
          </div>
        </div>
        <select id="veh-movement" value={draft.movement} onChange={(e) => setDraft((d) => ({ ...d, movement: e.target.value as Movement }))} className="rounded-xl border border-border bg-surface-elevated px-2.5 py-2 text-[11px] font-bold text-ink-light">
          <option value="">Any movement</option><option value="arrivals">New arrivals</option><option value="drops">Price drops</option><option value="increases">Price increases</option><option value="removed">Sold (removed, 24h)</option>
        </select>
        <input id="veh-mindays" value={draft.minDays} onChange={(e) => setDraft((d) => ({ ...d, minDays: e.target.value.replace(/\D/g, "") }))} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} placeholder="Days on lot ≥" inputMode="numeric" className="w-28 rounded-xl border border-border bg-surface-elevated px-2.5 py-2 text-[11px] font-bold text-white placeholder:text-ink-faint" />
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted"><input type="checkbox" checked={draft.hasSticker} onChange={(e) => setDraft((d) => ({ ...d, hasSticker: e.target.checked }))} className="accent-emerald-500" /> Has window sticker</label>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted" title="New condition with over 500 miles — usually a demo or loaner, not fresh off the truck"><input type="checkbox" checked={draft.possibleDemo} onChange={(e) => setDraft((d) => ({ ...d, possibleDemo: e.target.checked }))} className="accent-emerald-500" /> Possible demo</label>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted"><input type="checkbox" checked={draft.inStock} onChange={(e) => setDraft((d) => ({ ...d, inStock: e.target.checked }))} className="accent-emerald-500" /> In stock only</label>

        <button type="button" onClick={apply} disabled={!canApply || loading} title={canApply ? undefined : "Add a filter first — or use Load all"} className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black shadow-md disabled:opacity-40 ${dirty && canApply ? "bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/20" : "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"}`}>
          <Search className="h-3.5 w-3.5" /> Apply{applied && dirty ? " changes" : ""}
        </button>
        <button type="button" onClick={loadAll} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3 py-2 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50"><ListChecks className="h-3.5 w-3.5" /> Load all</button>
        {(activeFilterCount(draft) > 0 || applied) && (
          <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] font-bold text-rose-300 hover:text-white"><X className="h-3 w-3" /> Clear</button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-xl border border-border bg-surface-elevated px-3 py-2 text-[11px] font-bold text-ink-light tabular-nums">
            <span className="text-white">{applied ? totalLabel : "—"}</span> vehicles{stats ? <span className="text-ink-faint"> · {stats.inStock.toLocaleString()} in stock across {stats.dealers.toLocaleString()} stores{stats.lastSeenAt ? ` · crawled ${new Date(stats.lastSeenAt).toLocaleDateString()}` : ""}</span> : null}
          </span>
          <button type="button" onClick={() => { void loadStats(); if (query) void load(query, 0, false); }} disabled={loading || !query} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3 py-2 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Reload</button>
          <button type="button" onClick={() => void download()} disabled={exporting || !query || total === 0} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {exporting ? "Preparing…" : `Download CSV (${Math.min(total, CSV_CAP).toLocaleString()})`}</button>
        </div>
      </div>

      {hasChips && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Selected filters">
          {chipGroups.flatMap((g) => draft[g.field].map((v) => (
            <button key={`${g.field}:${v}`} type="button" onClick={() => removeChip(g.field, v)} aria-label={`Remove ${g.label} ${v}`} className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/20">
              <span className="text-emerald-300/60">{g.label}</span> {v} <X className="h-3 w-3" />
            </button>
          )))}
        </div>
      )}
      {applied && dirty && <p className="text-[11px] font-semibold text-amber-300">Filters changed — press Apply to update the table.</p>}

      {stats?.movement && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {([
            ["In stock", stats.inStock, "text-white", ""],
            ["New arrivals", stats.movement.arrivals, "text-emerald-300", "arrivals"],
            ["Price drops", stats.movement.priceDrops, "text-emerald-300", "drops"],
            ["Price increases", stats.movement.priceIncreases, "text-amber-300", "increases"],
            ["Removed (24h)", stats.movement.removedToday, "text-ink-muted", "removed"],
          ] as Array<[string, number, string, Movement]>).map(([label, n, tone, mv]) => (
            <button key={label} type="button" onClick={() => mv && onTile(mv)} disabled={!mv} className={`rounded-xl border px-3 py-2 text-left ${mv && draft.movement === mv ? "border-emerald-500/60 bg-emerald-500/10" : "border-border bg-surface"} ${mv ? "hover:border-emerald-500/40" : ""}`}>
              <div className="text-[10px] font-black uppercase tracking-wider text-ink-faint">{label}</div>
              <div className={`text-lg font-black tabular-nums ${tone}`}>{n.toLocaleString()}</div>
            </button>
          ))}
        </div>
      )}
      {error && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">{error}</div>}

      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        <div className="overflow-auto" style={{ height: "calc(100vh - 330px)", minHeight: 360 }}>
          <div style={{ width: totalW, minWidth: "100%" }}>
            <div className="sticky top-0 z-20 flex border-b border-border bg-surface-elevated" style={{ height: ROW_H }}>
              {VEHICLE_SHEET_COLUMNS.map((c) => {
                const sk = SORT_FOR[c.key];
                const active = sk && sort.key === sk;
                return (
                  <button key={c.key} type="button" onClick={() => onHeader(c.key)} disabled={!sk} title={sk ? `Sort by ${c.label}` : undefined} className="flex items-center gap-1 border-r border-border/60 px-2.5 text-left text-[10.5px] font-black uppercase tracking-wider text-ink-faint enabled:hover:text-white shrink-0" style={{ width: COL_W[c.key] || 120 }}>
                    <span className="truncate">{c.label}</span>
                    {sk ? (active ? (sort.dir === "asc" ? <ArrowUp className="h-3 w-3 text-emerald-400 shrink-0" /> : <ArrowDown className="h-3 w-3 text-emerald-400 shrink-0" />) : <ArrowUpDown className="h-3 w-3 opacity-30 shrink-0" />) : null}
                  </button>
                );
              })}
            </div>
            {rows.length === 0 ? (
              <div className="p-8 text-center text-xs text-ink-muted" style={{ position: "sticky", left: 0 }}>
                {!applied ? (
                  <div className="space-y-3">
                    <div className="text-sm font-bold text-ink-light">Add filters and Apply, or Load all.</div>
                    <p>The table stays empty until you ask for rows, so opening this tab never scans the whole inventory.</p>
                  </div>
                ) : loading ? (applied.kind === "all" ? "Loading all vehicles…" : "Applying filters…")
                  : error ? "Couldn’t load vehicles — see the error above, then press Reload."
                  : "No vehicles match these filters."}
              </div>
            ) : (
              rows.map((r, idx) => (
                <div key={`${r.vin}|${r.dealerId ?? ""}`} className={`flex border-b border-border/40 text-[11.5px] ${idx % 2 ? "bg-surface" : "bg-surface-elevated/40"} hover:bg-emerald-500/5 ${r.removedAt ? "opacity-60" : ""}`} style={{ height: ROW_H }}>
                  {VEHICLE_SHEET_COLUMNS.map((c) => {
                    const raw = vehicleRowCell(r, c.key);
                    const diff = r.priceDiff ?? null;
                    const v = c.key === "price" || c.key === "msrp" || c.key === "optionsTotal" ? money((r[c.key] as number | null | undefined) ?? null)
                      : c.key === "priceDiff" ? (diff == null || diff === 0 ? "" : `${diff < 0 ? "▼" : "▲"} $${Math.abs(diff).toLocaleString()}`)
                      : c.key === "mileage" && r.mileage != null ? r.mileage.toLocaleString()
                      : c.key === "condition" ? condLabel(r.condition)
                      : c.key === "options" && r.options?.length ? `${r.options.length} · ${raw}` : raw;
                    const tone = c.key === "dealerName" ? "font-semibold text-white" : c.key === "vin" || c.key === "stockNumber" ? "font-mono text-ink-light"
                      : c.key === "priceDiff" ? `tabular-nums justify-end font-bold ${diff != null && diff < 0 ? "text-emerald-300" : diff != null && diff > 0 ? "text-amber-300" : "text-ink-faint"}`
                      : c.key === "price" || c.key === "msrp" || c.key === "mileage" || c.key === "daysOnLot" || c.key === "optionsTotal" ? "tabular-nums text-ink-light justify-end"
                      : c.key === "condition" ? (r.condition === "new" ? "text-emerald-300" : "text-amber-200")
                      : c.key === "changeType" ? (r.changeType === "NEW_ARRIVAL" ? "text-emerald-300" : "text-ink-muted") : "text-ink-light";
                    const link = c.key === "vdpUrl" || c.key === "windowStickerUrl" ? raw : "";
                    return (
                      <div key={c.key} className={`flex items-center border-r border-border/40 px-2.5 shrink-0 overflow-hidden whitespace-nowrap ${tone}`} style={{ width: COL_W[c.key] || 120 }} title={raw}>
                        {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="truncate text-sky-300 hover:underline">{c.key === "windowStickerUrl" ? "sticker ↗" : link.replace(/^https?:\/\/(www\.)?/, "")}</a>
                          : c.key === "vin" ? <button type="button" onClick={() => setVinOpen(r.vin)} title="Day-by-day history" className="truncate font-mono text-sky-300 hover:underline">{r.vin}</button>
                          : <span className="truncate">{v}</span>}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
            {canLoadMore && query && (
              <div className="p-3 text-center">
                <button type="button" onClick={() => void load(query, rows.length, true)} disabled={loading} className="rounded-xl border border-border bg-surface-elevated hover:bg-surface px-4 py-2 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50">
                  {loading ? "Loading…" : totalCapped ? `Show ${PAGE.toLocaleString()} more (${rows.length.toLocaleString()} of ${totalLabel})` : `Show ${Math.min(PAGE, total - rows.length).toLocaleString()} more (${rows.length.toLocaleString()} of ${total.toLocaleString()})`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {vinOpen && <VinHistory vin={vinOpen} onClose={() => setVinOpen(null)} />}
      <p className="text-[11px] text-ink-faint max-w-3xl">
        Vehicles come from the nightly crawl of each store&apos;s own website, synced every morning. One row per VIN per store — click a VIN for its day-by-day history; a VIN that vanishes from the site on the next crawl is marked <em>Removed</em> and drops out of &quot;in stock&quot;. Pick filters (several values in one box match any of them) and press Apply, or Load all. Dropdown counts are in-stock vehicles scoped by State, Make and Model. The CSV contains every vehicle matching the applied filters (up to 50,000).
      </p>
    </div>
  );
}
