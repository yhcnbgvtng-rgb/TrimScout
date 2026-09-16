"use client";

// The Vehicles side of the crawl sheet: crawled dealer inventory, server-paged (the table is far bigger than
// the dealer list), with the filters the box indexes — state, make, model, condition, in-stock, free text —
// server-side sort, and a CSV of the whole current filter (capped at 50k rows).

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, RefreshCw, Search, X } from "lucide-react";
import { VEHICLE_SHEET_COLUMNS, vehicleRowCell, vehicleRowsToCsv, vehicleSheetFilename, type VehicleRow } from "@/lib/crawlSheetColumns";

type Stats = { total: number; inStock: number; dealers: number; lastSeenAt: string | null; byMake: Array<{ make: string; n: number }>; byState: Array<{ state: string; n: number }>; byCond: Array<{ cond: string | null; n: number }> };
type SortKey = "dealer" | "year" | "make" | "model" | "price" | "mileage" | "seen";
const SORT_FOR: Partial<Record<keyof VehicleRow, SortKey>> = { dealerName: "dealer", year: "year", make: "make", model: "model", price: "price", mileage: "mileage", lastSeenAt: "seen" };
const COL_W: Partial<Record<keyof VehicleRow, number>> = { dealerName: 240, dealerState: 60, dealerCity: 130, condition: 90, year: 64, make: 110, model: 130, trim: 190, vin: 170, stockNumber: 100, price: 90, msrp: 90, mileage: 80, exteriorColor: 170, interiorColor: 150, bodyStyle: 100, vdpUrl: 260, firstSeenAt: 100, lastSeenAt: 100, removedAt: 100, source: 90 };
const PAGE = 500;
const ROW_H = 32;

const money = (n: number | null) => (n == null ? "" : `$${n.toLocaleString()}`);
const condLabel = (c: string | null) => ({ new: "New", used: "Used", cpo: "Certified" } as Record<string, string>)[c || ""] || (c || "—");

export default function VehiclesSheet() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [state, setState] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [cond, setCond] = useState("");
  const [inStock, setInStock] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "dealer", dir: "asc" });
  const [exporting, setExporting] = useState(false);

  useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 350); return () => clearTimeout(t); }, [q]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (state) p.set("state", state);
    if (make) p.set("make", make);
    if (model.trim()) p.set("model", model.trim());
    if (cond) p.set("cond", cond);
    if (inStock) p.set("inStock", "1");
    if (qDebounced) p.set("q", qDebounced);
    p.set("sort", `${sort.key}:${sort.dir}`);
    return p;
  }, [state, make, model, cond, inStock, qDebounced, sort]);

  const loadStats = useCallback(async () => {
    const res = await fetch("/api/admin/inventory?stats=1", { cache: "no-store" });
    const json = await res.json();
    if (res.ok) setStats(json);
  }, []);

  const load = useCallback(async (offset: number, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams(query);
      p.set("limit", String(PAGE));
      p.set("offset", String(offset));
      const res = await fetch(`/api/admin/inventory?${p}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load inventory.");
      setTotal(json.total);
      setRows((prev) => (append ? [...prev, ...json.vehicles] : json.vehicles));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load inventory.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void loadStats(); }, [loadStats]);
  useEffect(() => { void load(0, false); }, [load]);

  const download = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams(query);
      p.set("export", "1");
      const res = await fetch(`/api/admin/inventory?${p}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Export failed.");
      const csv = vehicleRowsToCsv(json.vehicles as VehicleRow[]);
      const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = vehicleSheetFilename();
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (json.capped) setError("Export stopped at 50,000 rows — narrow the filter for the rest.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const activeFilters = [state, make, model.trim(), cond, qDebounced].filter(Boolean).length + (inStock ? 0 : 1);
  const clearAll = () => { setQ(""); setState(""); setMake(""); setModel(""); setCond(""); setInStock(true); };
  const onHeader = (key: keyof VehicleRow) => { const sk = SORT_FOR[key]; if (!sk) return; setSort((s) => (s.key === sk ? { key: sk, dir: s.dir === "asc" ? "desc" : "asc" } : { key: sk, dir: sk === "price" || sk === "year" || sk === "seen" ? "desc" : "asc" })); };
  const totalW = VEHICLE_SHEET_COLUMNS.reduce((s, c) => s + (COL_W[c.key] || 120), 0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-surface p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
          <input id="veh-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VIN, dealer, model, trim, stock #…" className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3 py-2 text-xs text-white placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
        </div>
        <select id="veh-state" value={state} onChange={(e) => setState(e.target.value)} className="rounded-xl border border-border bg-surface-elevated px-2.5 py-2 text-[11px] font-bold text-ink-light">
          <option value="">All states</option>
          {(stats?.byState || []).map((s) => <option key={s.state} value={s.state}>{s.state} · {s.n.toLocaleString()}</option>)}
        </select>
        <select id="veh-make" value={make} onChange={(e) => setMake(e.target.value)} className="rounded-xl border border-border bg-surface-elevated px-2.5 py-2 text-[11px] font-bold text-ink-light">
          <option value="">All makes</option>
          {(stats?.byMake || []).map((m) => <option key={m.make} value={m.make}>{m.make} · {m.n.toLocaleString()}</option>)}
        </select>
        <input id="veh-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model" className="w-32 rounded-xl border border-border bg-surface-elevated px-2.5 py-2 text-[11px] font-bold text-white placeholder:text-ink-faint" />
        <select id="veh-cond" value={cond} onChange={(e) => setCond(e.target.value)} className="rounded-xl border border-border bg-surface-elevated px-2.5 py-2 text-[11px] font-bold text-ink-light">
          <option value="">New + used</option><option value="new">New</option><option value="used">Used</option><option value="cpo">Certified</option>
        </select>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted"><input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} className="accent-emerald-500" /> In stock only</label>
        {activeFilters > 0 && (
          <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] font-bold text-rose-300 hover:text-white"><X className="h-3 w-3" /> Clear</button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-xl border border-border bg-surface-elevated px-3 py-2 text-[11px] font-bold text-ink-light tabular-nums">
            <span className="text-white">{total.toLocaleString()}</span> vehicles{stats ? <span className="text-ink-faint"> · {stats.inStock.toLocaleString()} in stock across {stats.dealers.toLocaleString()} stores{stats.lastSeenAt ? ` · crawled ${new Date(stats.lastSeenAt).toLocaleDateString()}` : ""}</span> : null}
          </span>
          <button type="button" onClick={() => { void loadStats(); void load(0, false); }} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3 py-2 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Reload</button>
          <button type="button" onClick={() => void download()} disabled={exporting || total === 0} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20 disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {exporting ? "Preparing…" : `Download CSV (${Math.min(total, 50000).toLocaleString()})`}</button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">{error}</div>}

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
              <div className="p-8 text-center text-xs text-ink-muted">{loading ? "Loading…" : total === 0 && !stats?.total ? "No vehicles crawled yet — run scrapers/inventory/crawl_inventory.py and push with scripts/probes/push-inventory.mts." : "No vehicles match these filters."}</div>
            ) : (
              rows.map((r, idx) => (
                <div key={r.vin} className={`flex border-b border-border/40 text-[11.5px] ${idx % 2 ? "bg-surface" : "bg-surface-elevated/40"} hover:bg-emerald-500/5 ${r.removedAt ? "opacity-60" : ""}`} style={{ height: ROW_H }}>
                  {VEHICLE_SHEET_COLUMNS.map((c) => {
                    const raw = vehicleRowCell(r, c.key);
                    const v = c.key === "price" || c.key === "msrp" ? money(r[c.key]) : c.key === "mileage" && r.mileage != null ? r.mileage.toLocaleString() : c.key === "condition" ? condLabel(r.condition) : raw;
                    const tone = c.key === "dealerName" ? "font-semibold text-white" : c.key === "vin" || c.key === "stockNumber" ? "font-mono text-ink-light" : c.key === "price" || c.key === "msrp" || c.key === "mileage" ? "tabular-nums text-ink-light justify-end" : c.key === "condition" ? (r.condition === "new" ? "text-emerald-300" : "text-amber-200") : "text-ink-light";
                    return (
                      <div key={c.key} className={`flex items-center border-r border-border/40 px-2.5 shrink-0 overflow-hidden whitespace-nowrap ${tone}`} style={{ width: COL_W[c.key] || 120 }} title={raw}>
                        {c.key === "vdpUrl" && raw ? <a href={raw} target="_blank" rel="noopener noreferrer" className="truncate text-sky-300 hover:underline">{raw.replace(/^https?:\/\/(www\.)?/, "")}</a> : <span className="truncate">{v}</span>}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
            {rows.length > 0 && rows.length < total && (
              <div className="p-3 text-center">
                <button type="button" onClick={() => void load(rows.length, true)} disabled={loading} className="rounded-xl border border-border bg-surface-elevated hover:bg-surface px-4 py-2 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50">
                  {loading ? "Loading…" : `Show ${Math.min(PAGE, total - rows.length).toLocaleString()} more (${rows.length.toLocaleString()} of ${total.toLocaleString()})`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-ink-faint max-w-3xl">
        Vehicles come from each store&apos;s own website (sitemap → vehicle pages → the schema.org data the page embeds). One row per VIN; a VIN that vanishes from the site on the next crawl is marked <em>Removed</em> and drops out of &quot;in stock&quot;. The CSV contains every vehicle matching the current filter (up to 50,000).
      </p>
    </div>
  );
}
