"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Info } from "lucide-react";
import { DOM_BAND_LABELS, bandShares, isInScopeMake, mixVsBrandNorm, pct, type DealerAnalytics, type DomBands } from "../../../lib/dealerAnalytics";

/**
 * Dealership analytics on the Site Analytics page. DOM = days on market
 * (days on the lot), not a document tree. Everything here is public listing
 * data from the nightly crawl, aggregated on the deals box; the page only
 * filters, sorts and draws. Default views are single-franchise rollups —
 * megadealer groups show up only when you filter to them.
 */
type Filters = { state: string; make: string; dealerId: string; model: string; from: string; to: string };
const EMPTY: Filters = { state: "", make: "", dealerId: "", model: "", from: "", to: "" };
const STATES = ["NJ", "NY", "FL", "TX", "GA", "SC", "VA", "NC", "PA", "OH", "IL", "CA"];

const fmtDays = (v: number | null | undefined) => (v == null ? "—" : `${v}d`);
const fmtPct = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${v.toFixed(digits)}%`);
const fmtMoney = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v).toLocaleString()}`);

function BandBar({ bands, className = "" }: { bands: DomBands; className?: string }) {
  const s = bandShares(bands);
  const tone: Record<keyof DomBands, string> = { d0_14: "bg-emerald-500", d15_45: "bg-sky-500", d46_90: "bg-amber-500", d90p: "bg-rose-500" };
  return (
    <div className={`flex h-2 w-full overflow-hidden rounded-full bg-border ${className}`} title={DOM_BAND_LABELS.map((b) => `${b.label}: ${s[b.key]}%`).join(" · ")} data-testid="band-bar">
      {DOM_BAND_LABELS.map((b) => (s[b.key] > 0 ? <span key={b.key} className={tone[b.key]} style={{ width: `${s[b.key]}%` }} /> : null))}
    </div>
  );
}

function BandLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-[10px] text-ink-muted">
      {DOM_BAND_LABELS.map((b, i) => (
        <span key={b.key} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${["bg-emerald-500", "bg-sky-500", "bg-amber-500", "bg-rose-500"][i]}`} />{b.label} days</span>
      ))}
    </div>
  );
}

function Stat({ label, value, sub, testId }: { label: string; value: React.ReactNode; sub?: React.ReactNode; testId?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated px-4 py-3" data-testid={testId}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="text-lg font-extrabold text-white tabular-nums">{value}</p>
      {sub ? <p className="text-[10px] text-ink-muted">{sub}</p> : null}
    </div>
  );
}

export default function DealerAnalyticsSection() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [data, setData] = useState<DealerAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeAllMakes, setIncludeAllMakes] = useState(false);
  const [tab, setTab] = useState<"dealers" | "models" | "trims" | "years" | "drive">("dealers");

  const load = useCallback(async (f: Filters) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ analytics: "1" });
      for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
      const res = await fetch(`/api/admin/inventory?${qs.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load dealership analytics.");
      setData(json as DealerAnalytics);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load dealership analytics.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load(applied);
  }, [applied, load]);

  const apply = (next: Partial<Filters>) => {
    const f = { ...applied, ...next };
    setFilters(f);
    setApplied(f);
  };

  // Default views: in-scope franchise brands only (the ones that don't publish stickers), no group flooding.
  const scopeMake = (make: string) => includeAllMakes || isInScopeMake(make);
  const byModel = useMemo(() => (data?.dom.byModel || []).filter((r) => scopeMake(r.make)), [data, includeAllMakes]);
  const byDealer = useMemo(() => data?.dom.byDealer || [], [data]);
  const byTrim = useMemo(() => (data?.dom.byTrim || []).filter((r) => scopeMake(r.make)), [data, includeAllMakes]);
  const byYear = useMemo(() => (data?.dom.byYear || []).filter((r) => scopeMake(r.make)), [data, includeAllMakes]);
  const velocityByModel = useMemo(() => (data?.velocity.byModel || []).filter((r) => scopeMake(r.make)), [data, includeAllMakes]);
  const mix = useMemo(() => (data ? mixVsBrandNorm(byModel.map((r) => ({ make: r.make, model: r.model, n: r.n })), data.assortment.brandNorm).slice(0, 12) : []), [data, byModel]);
  const makes = useMemo(() => Array.from(new Set((data?.coverage.byMake || []).map((r) => r.make))).sort(), [data]);
  const dealersForFilter = useMemo(() => [...byDealer].sort((a, b) => a.dealerName.localeCompare(b.dealerName)), [byDealer]);
  const modelsForFilter = useMemo(() => Array.from(new Set(byModel.map((r) => r.model))).sort(), [byModel]);

  const empty = !loading && !error && data && data.totals.n === 0;
  const field = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] text-ink-light focus:border-emerald-500 focus:outline-none";

  return (
    <section className="rounded-3xl border border-border-strong bg-surface p-6 shadow-2xl space-y-5" data-testid="dealer-analytics">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white tracking-tight">Dealership analytics</h2>
          <p className="text-xs text-ink-muted">
            From the nightly inventory crawl of franchise rooftops (public listing pages). <span className="font-semibold text-ink-light">DOM = days on market</span>, i.e. days on the lot.
            <span className="ml-1 inline-flex items-center gap-1 text-ink-faint" title={data?.domFormula || "days_on_lot from the crawl when present, else first seen → today / removed"}><Info className="h-3 w-3" /> how it&apos;s computed</span>
          </p>
        </div>
        <button type="button" onClick={() => load(applied)} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2" data-testid="analytics-filters">
        <label className="space-y-1"><span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">State</span>
          <select value={filters.state} onChange={(e) => apply({ state: e.target.value })} className={field} data-testid="filter-state"><option value="">All</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="space-y-1"><span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">Brand</span>
          <select value={filters.make} onChange={(e) => apply({ make: e.target.value, model: "" })} className={field} data-testid="filter-make"><option value="">All in scope</option>{makes.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
        <label className="space-y-1"><span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">Dealer</span>
          <select value={filters.dealerId} onChange={(e) => apply({ dealerId: e.target.value })} className={`${field} max-w-[220px]`} data-testid="filter-dealer"><option value="">All</option>{dealersForFilter.map((d) => <option key={d.dealerId} value={String(d.dealerId)}>{d.dealerName}{d.state ? ` (${d.state})` : ""}</option>)}</select></label>
        <label className="space-y-1"><span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">Model</span>
          <select value={filters.model} onChange={(e) => apply({ model: e.target.value })} className={field} data-testid="filter-model"><option value="">All</option>{modelsForFilter.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
        <label className="space-y-1"><span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">Seen from</span>
          <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} onBlur={() => apply({ from: filters.from })} className={field} data-testid="filter-from" /></label>
        <label className="space-y-1"><span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">to</span>
          <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} onBlur={() => apply({ to: filters.to })} className={field} data-testid="filter-to" /></label>
        <label className="ml-1 inline-flex items-center gap-1.5 pb-2 text-[11px] text-ink-muted"><input type="checkbox" checked={includeAllMakes} onChange={(e) => setIncludeAllMakes(e.target.checked)} className="h-3.5 w-3.5 rounded border-border" /> include out-of-scope brands</label>
        {Object.values(applied).some(Boolean) ? <button type="button" onClick={() => apply(EMPTY)} className="pb-2 text-[11px] font-bold text-sky-300 hover:text-white">Clear filters</button> : null}
      </div>

      {error ? <p className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300" data-testid="analytics-error">{error}</p> : null}
      {loading && !data ? <p className="text-xs text-ink-muted" data-testid="analytics-loading">Crunching the crawl…</p> : null}
      {empty ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center" data-testid="analytics-empty">
          <p className="text-sm font-bold text-ink-light">No crawl data for these filters yet</p>
          <p className="mt-1 text-[11px] text-ink-muted">Analytics fill in as the nightly crawl runs. Widen the filters, or check the Web Crawl Sheet for what&apos;s loaded.</p>
        </div>
      ) : null}

      {data && data.totals.n > 0 ? (
        <>
          {/* Headline */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" data-testid="analytics-headline">
            <Stat label="On the lot" value={data.totals.n.toLocaleString()} sub={`${data.totals.dealers.toLocaleString()} rooftops · ${data.totals.models.toLocaleString()} models`} />
            <Stat label="Avg DOM" value={fmtDays(data.totals.avgDom)} sub={<span className="inline-flex flex-col gap-1"><BandBar bands={data.totals.bands} /><BandLegend /></span>} testId="stat-dom" />
            <Stat label="Weekly turn" value={fmtPct(data.velocity.turnRate)} sub={`${data.velocity.removed7.toLocaleString()} gone in 7 days · ${data.velocity.arrived7.toLocaleString()} arrived`} testId="stat-turn" />
            <Stat label="List vs MSRP" value={data.pricing.avgDiscount == null ? "—" : `${data.pricing.avgDiscount > 0 ? "−" : "+"}${Math.abs(data.pricing.avgDiscount).toFixed(1)}%`} sub={`${data.pricing.priced.toLocaleString()} priced against a sticker MSRP · ${data.pricing.dropsNow.toLocaleString()} dropped since last crawl${data.pricing.avgDropNow ? ` (avg ${fmtMoney(data.pricing.avgDropNow)})` : ""}`} testId="stat-discount" />
            <Stat label="Sticker URL coverage" value={fmtPct(pct(data.dom.byDealer.reduce((t, d) => t + d.withSticker, 0), data.totals.n))} sub={`Sales email on file for ${data.coverage.dealersWithEmail} of ${data.coverage.dealers} rooftops`} testId="stat-sticker" />
          </div>

          {/* Leaderboards */}
          <div className="flex flex-wrap items-center gap-2">
            {(["dealers", "models", "trims", "years", "drive"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold ${tab === t ? "border-emerald-500 bg-emerald-500/10 text-white" : "border-border text-ink-muted hover:text-white"}`} data-tab={t}>
                {t === "dealers" ? "DOM by dealership" : t === "models" ? "DOM by model" : t === "trims" ? "By model + trim" : t === "years" ? "By model year" : "Drivetrain / powertrain"}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-ink-faint">Click a dealer to see its models; click a model to see who stocks it.</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-background">
            {tab === "dealers" ? (
              <table className="w-full min-w-[960px] text-left text-[11px]" data-testid="dealer-leaderboard">
                <thead><tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-ink-faint"><th className="px-3 py-2">Dealership</th><th className="px-3 py-2 text-right">On lot</th><th className="px-3 py-2 text-right">Avg DOM</th><th className="px-3 py-2 text-right">Median</th><th className="px-3 py-2">Bands</th><th className="px-3 py-2 text-right">Turn / wk</th><th className="px-3 py-2 text-right">vs MSRP</th><th className="px-3 py-2 text-right">Sticker</th><th className="px-3 py-2 text-right">Options</th><th className="px-3 py-2 text-right">No price</th><th className="px-3 py-2 text-right">No photo</th><th className="px-3 py-2 text-right">Stale</th><th className="px-3 py-2">Email</th></tr></thead>
                <tbody className="divide-y divide-border/60 tabular-nums">
                  {[...byDealer].sort((a, b) => (b.avgDom ?? -1) - (a.avgDom ?? -1)).map((d) => {
                    const turn = data.velocity.byDealer.find((v) => v.dealerId === d.dealerId);
                    return (
                      <tr key={d.dealerId} className="hover:bg-surface-elevated" data-testid="dealer-row">
                        <td className="px-3 py-2"><button type="button" onClick={() => { apply({ dealerId: String(d.dealerId) }); setTab("models"); }} className="text-left font-semibold text-white hover:text-emerald-300">{d.dealerName}</button><span className="block text-[10px] text-ink-muted">{[d.city, d.state].filter(Boolean).join(", ")}</span></td>
                        <td className="px-3 py-2 text-right">{d.n.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-bold text-white">{fmtDays(d.avgDom)}</td>
                        <td className="px-3 py-2 text-right">{fmtDays(d.medianDom)}</td>
                        <td className="px-3 py-2 w-40"><BandBar bands={d.bands} /></td>
                        <td className="px-3 py-2 text-right">{fmtPct(turn?.turnRate ?? null)}</td>
                        <td className="px-3 py-2 text-right">{d.avgDiscount == null ? "—" : `${d.avgDiscount > 0 ? "−" : "+"}${Math.abs(d.avgDiscount).toFixed(1)}%`}</td>
                        <td className="px-3 py-2 text-right">{fmtPct(pct(d.withSticker, d.n), 0)}</td>
                        <td className="px-3 py-2 text-right">{fmtPct(pct(d.withOptions, d.n), 0)}</td>
                        <td className="px-3 py-2 text-right">{fmtPct(pct(d.missingPrice, d.n), 0)}</td>
                        <td className="px-3 py-2 text-right">{fmtPct(pct(d.missingPhoto, d.n), 0)}</td>
                        <td className={`px-3 py-2 text-right ${d.stale ? "text-amber-300" : ""}`}>{fmtPct(pct(d.stale, d.n), 0)}</td>
                        <td className="px-3 py-2">{d.hasEmail ? <span className="text-emerald-300">on file</span> : <span className="text-ink-faint">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : tab === "models" ? (
              <table className="w-full min-w-[820px] text-left text-[11px]" data-testid="model-leaderboard">
                <thead><tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-ink-faint"><th className="px-3 py-2">Model</th><th className="px-3 py-2 text-right">On lot</th><th className="px-3 py-2 text-right">Avg DOM</th><th className="px-3 py-2 text-right">Median</th><th className="px-3 py-2">Bands</th><th className="px-3 py-2 text-right">Turn / wk</th><th className="px-3 py-2 text-right">Days supply</th><th className="px-3 py-2 text-right">vs MSRP</th><th className="px-3 py-2 text-right">Sticker</th></tr></thead>
                <tbody className="divide-y divide-border/60 tabular-nums">
                  {[...byModel].sort((a, b) => (b.avgDom ?? -1) - (a.avgDom ?? -1)).map((m) => {
                    const v = velocityByModel.find((x) => x.make === m.make && x.model === m.model);
                    const disc = m.avgDiscount == null ? null : Number(m.avgDiscount) * 100;
                    return (
                      <tr key={`${m.make}|${m.model}`} className="hover:bg-surface-elevated" data-testid="model-row">
                        <td className="px-3 py-2"><button type="button" onClick={() => { apply({ make: m.make, model: m.model, dealerId: "" }); setTab("dealers"); }} className="text-left font-semibold text-white hover:text-emerald-300">{m.make} {m.model}</button></td>
                        <td className="px-3 py-2 text-right">{m.n.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-bold text-white">{fmtDays(m.avgDom)}</td>
                        <td className="px-3 py-2 text-right">{fmtDays(m.medianDom)}</td>
                        <td className="px-3 py-2 w-40"><BandBar bands={m.bands} /></td>
                        <td className="px-3 py-2 text-right">{fmtPct(v?.turnRate ?? null)}</td>
                        <td className="px-3 py-2 text-right">{v?.daysSupply != null ? `${v.daysSupply}d` : "—"}</td>
                        <td className="px-3 py-2 text-right">{disc == null ? "—" : `${disc > 0 ? "−" : "+"}${Math.abs(disc).toFixed(1)}%`}</td>
                        <td className="px-3 py-2 text-right">{fmtPct(pct(m.withSticker || 0, m.n), 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : tab === "trims" ? (
              <table className="w-full min-w-[720px] text-left text-[11px]" data-testid="trim-leaderboard">
                <thead><tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-ink-faint"><th className="px-3 py-2">Model · trim (packages as the dealer lists them)</th><th className="px-3 py-2 text-right">On lot</th><th className="px-3 py-2 text-right">Avg DOM</th><th className="px-3 py-2 text-right">Median</th><th className="px-3 py-2">Bands</th><th className="px-3 py-2 text-right">vs MSRP</th></tr></thead>
                <tbody className="divide-y divide-border/60 tabular-nums">
                  {[...byTrim].sort((a, b) => (b.avgDom ?? -1) - (a.avgDom ?? -1)).map((t) => {
                    const disc = t.avgDiscount == null ? null : Number(t.avgDiscount) * 100;
                    return (
                      <tr key={`${t.make}|${t.model}|${t.trim}`} className="hover:bg-surface-elevated"><td className="px-3 py-2 font-semibold text-white">{t.make} {t.model} <span className="font-normal text-ink-muted">{t.trim}</span></td><td className="px-3 py-2 text-right">{t.n}</td><td className="px-3 py-2 text-right font-bold text-white">{fmtDays(t.avgDom)}</td><td className="px-3 py-2 text-right">{fmtDays(t.medianDom)}</td><td className="px-3 py-2 w-40"><BandBar bands={t.bands} /></td><td className="px-3 py-2 text-right">{disc == null ? "—" : `${disc > 0 ? "−" : "+"}${Math.abs(disc).toFixed(1)}%`}</td></tr>
                    );
                  })}
                </tbody>
              </table>
            ) : tab === "years" ? (
              <table className="w-full min-w-[640px] text-left text-[11px]" data-testid="year-leaderboard">
                <thead><tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-ink-faint"><th className="px-3 py-2">Model · year</th><th className="px-3 py-2 text-right">On lot</th><th className="px-3 py-2 text-right">Avg DOM</th><th className="px-3 py-2">Bands</th></tr></thead>
                <tbody className="divide-y divide-border/60 tabular-nums">
                  {[...byYear].sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || b.year - a.year).map((y) => (
                    <tr key={`${y.make}|${y.model}|${y.year}`} className="hover:bg-surface-elevated"><td className="px-3 py-2 font-semibold text-white">{y.make} {y.model} <span className="font-normal text-ink-muted">{y.year}</span></td><td className="px-3 py-2 text-right">{y.n}</td><td className="px-3 py-2 text-right font-bold text-white">{fmtDays(y.avgDom)}</td><td className="px-3 py-2 w-40"><BandBar bands={y.bands} /></td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="grid gap-4 p-4 sm:grid-cols-2" data-testid="drive-tables">
                {[{ title: "Drivetrain", rows: data.dom.byDrivetrain, key: "drivetrain" as const }, { title: "Powertrain", rows: data.dom.byPowertrain, key: "powertrain" as const }].map((g) => (
                  <table key={g.title} className="w-full text-left text-[11px]">
                    <thead><tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-ink-faint"><th className="px-3 py-2">{g.title}</th><th className="px-3 py-2 text-right">On lot</th><th className="px-3 py-2 text-right">Avg DOM</th><th className="px-3 py-2 text-right">Median</th><th className="px-3 py-2">Bands</th></tr></thead>
                    <tbody className="divide-y divide-border/60 tabular-nums">{g.rows.map((r) => <tr key={String(r[g.key])}><td className="px-3 py-2 font-semibold text-white">{r[g.key]}</td><td className="px-3 py-2 text-right">{r.n.toLocaleString()}</td><td className="px-3 py-2 text-right font-bold text-white">{fmtDays(r.avgDom)}</td><td className="px-3 py-2 text-right">{fmtDays(r.medianDom)}</td><td className="px-3 py-2 w-40"><BandBar bands={r.bands} /></td></tr>)}</tbody>
                  </table>
                ))}
                <p className="text-[10px] text-ink-faint sm:col-span-2">Drivetrain and powertrain are read from the listing&apos;s trim / engine text (AWD, xDrive, Hybrid, EV…); &quot;Not stated&quot; means the page didn&apos;t say.</p>
              </div>
            )}
          </div>

          {/* Distribution + pricing + assortment + coverage */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-background p-4 space-y-2" data-testid="band-chart">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">DOM distribution — {applied.dealerId ? "this dealership" : applied.model ? "this model" : "everything in scope"}</p>
              {DOM_BAND_LABELS.map((b) => {
                const share = bandShares(data.totals.bands)[b.key];
                return (
                  <div key={b.key} className="flex items-center gap-3 text-[11px]">
                    <span className="w-14 text-ink-muted">{b.label}d</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-border"><div className={`h-full ${{ d0_14: "bg-emerald-500", d15_45: "bg-sky-500", d46_90: "bg-amber-500", d90p: "bg-rose-500" }[b.key]}`} style={{ width: `${share}%` }} /></div>
                    <span className="w-24 text-right tabular-nums text-white">{data.totals.bands[b.key].toLocaleString()} · {share}%</span>
                  </div>
                );
              })}
              <p className="text-[10px] text-ink-faint">Averages hide the tail — the 90+ band is the aged stock a dealer is most likely to move on.</p>
            </div>

            <div className="rounded-2xl border border-border bg-background p-4 space-y-2" data-testid="price-cuts">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Price cuts by lot age at the cut (day-by-day price history)</p>
              {data.pricing.cuts ? (
                <table className="w-full text-[11px] tabular-nums">
                  <thead><tr className="text-[10px] uppercase tracking-wide text-ink-faint"><th className="text-left py-1">Cut made at</th><th className="text-right py-1">Cuts</th><th className="text-right py-1">Avg cut</th><th className="text-right py-1">Avg %</th></tr></thead>
                  <tbody>
                    {([["lt30", "Before day 30"], ["d30", "Day 30–59"], ["d60", "Day 60–89"], ["d90", "Day 90+"]] as const).map(([k, label]) => {
                      const b = data.pricing.cuts!.bands[k];
                      return <tr key={k} className="border-t border-border/60"><td className="py-1 text-ink-light">{label}</td><td className="py-1 text-right text-white">{b ? b.cuts.toLocaleString() : 0}</td><td className="py-1 text-right">{b ? fmtMoney(b.avgCut) : "—"}</td><td className="py-1 text-right">{b ? fmtPct(b.avgCutPct) : "—"}</td></tr>;
                    })}
                  </tbody>
                </table>
              ) : <p className="text-[11px] text-ink-muted">Price history isn&apos;t available on this database version yet.</p>}
              <p className="text-[10px] text-ink-faint">{data.pricing.cuts ? `${data.pricing.cuts.vehiclesObserved.toLocaleString()} vehicles with day-by-day prices. ` : ""}Frequency grows as daily crawls accumulate.</p>
            </div>

            <div className="rounded-2xl border border-border bg-background p-4 space-y-2" data-testid="assortment">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Model mix vs the brand&apos;s mix across every store we crawl</p>
              {mix.length ? (
                <table className="w-full text-[11px] tabular-nums">
                  <thead><tr className="text-[10px] uppercase tracking-wide text-ink-faint"><th className="text-left py-1">Model</th><th className="text-right py-1">Here</th><th className="text-right py-1">Brand norm</th><th className="text-right py-1">Δ pts</th></tr></thead>
                  <tbody>{mix.map((r) => <tr key={`${r.make}|${r.model}`} className="border-t border-border/60"><td className="py-1 text-ink-light">{r.make} {r.model}</td><td className="py-1 text-right text-white">{r.scopeShare}%</td><td className="py-1 text-right">{r.normShare}%</td><td className={`py-1 text-right ${r.delta > 0 ? "text-emerald-300" : r.delta < 0 ? "text-amber-300" : ""}`}>{r.delta > 0 ? "+" : ""}{r.delta}</td></tr>)}</tbody>
                </table>
              ) : <p className="text-[11px] text-ink-muted">Pick a state or dealer to compare its mix to the brand norm.</p>}
              <p className="text-[10px] text-ink-faint">On-lot vs in-transit isn&apos;t captured by the crawl yet — every row here is a listed unit.</p>
            </div>

            <div className="rounded-2xl border border-border bg-background p-4 space-y-2" data-testid="coverage">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">TrimScout coverage &amp; data quality by brand</p>
              <table className="w-full text-[11px] tabular-nums">
                <thead><tr className="text-[10px] uppercase tracking-wide text-ink-faint"><th className="text-left py-1">Brand</th><th className="text-right py-1">On lot</th><th className="text-right py-1">Sticker URL</th><th className="text-right py-1">Options resolved</th><th className="text-right py-1">No price</th><th className="text-right py-1">No photo</th></tr></thead>
                <tbody>{data.coverage.byMake.filter((r) => scopeMake(r.make)).map((r) => <tr key={r.make} className="border-t border-border/60"><td className="py-1 text-ink-light">{r.make}</td><td className="py-1 text-right text-white">{r.n.toLocaleString()}</td><td className="py-1 text-right">{fmtPct(pct(r.withSticker, r.n), 0)}</td><td className="py-1 text-right">{fmtPct(pct(r.withOptions, r.n), 0)}</td><td className="py-1 text-right">{fmtPct(pct(r.missingPrice, r.n), 0)}</td><td className="py-1 text-right">{fmtPct(pct(r.missingPhoto, r.n), 0)}</td></tr>)}</tbody>
              </table>
              <p className="text-[10px] text-ink-faint">&quot;Options resolved&quot; = listings whose option lines the crawl could read (must-have matching works on these). Stale rooftops (no crawl hit in 2 days) show per dealer above.</p>
            </div>
          </div>

          <p className="text-[10px] text-ink-faint">Computed {new Date(data.computedAt).toLocaleString()} · last crawl observation {data.totals.lastSeenAt ? new Date(data.totals.lastSeenAt).toLocaleString() : "—"} · refreshed every 10 minutes and after each nightly sync.</p>
        </>
      ) : null}
    </section>
  );
}
