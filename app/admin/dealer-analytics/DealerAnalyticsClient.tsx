"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, RefreshCw, Search } from "lucide-react";
import type { DealerAnalyticsRow, DealerAnalyticsTable } from "@/lib/dealerAnalyticsTypes";
import { AnalyticsFetchError, facetValues, filterDealers, fmtInt, getAnalytics, sortDealers, type LoadFailure, type SortKey } from "@/lib/dealerAnalyticsPage";
import { AnalyticsMessage, Skeleton } from "@/components/admin/AnalyticsStates";

const COLUMNS: Array<{ key: SortKey; label: string; num?: boolean; cell: (r: DealerAnalyticsRow) => string }> = [
  { key: "dealerName", label: "Dealer", cell: (r) => r.dealerName },
  { key: "state", label: "State", cell: (r) => r.state ?? "—" },
  { key: "activeUnits", label: "In stock", num: true, cell: (r) => fmtInt(r.activeUnits) },
  { key: "makeCount", label: "Makes", num: true, cell: (r) => fmtInt(r.makeCount) },
  { key: "dropUnits7d", label: "Drops 7d", num: true, cell: (r) => fmtInt(r.dropUnits7d) },
  { key: "dropUnits30d", label: "Drops 30d", num: true, cell: (r) => fmtInt(r.dropUnits30d) },
  { key: "avgDom", label: "Avg days in stock", num: true, cell: (r) => fmtInt(r.avgDom) },
];

const selectCls = "rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink-light";

export default function DealerAnalyticsClient() {
  const [data, setData] = useState<DealerAnalyticsTable | null>(null);
  const [failure, setFailure] = useState<{ kind: LoadFailure; detail: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [includeBuckets, setIncludeBuckets] = useState(false);
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [make, setMake] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "activeUnits", dir: -1 });

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      setData(await getAnalytics<DealerAnalyticsTable>(`/api/admin/dealer-analytics${includeBuckets ? "?includeBuckets=1" : ""}`));
    } catch (e) {
      setData(null);
      setFailure(e instanceof AnalyticsFetchError ? { kind: e.kind, detail: e.message } : { kind: "error", detail: "Could not load dealer analytics." });
    } finally {
      setLoading(false);
    }
  }, [includeBuckets]);
  useEffect(() => { load(); }, [load]);

  const rows = data?.dealers ?? [];
  const states = useMemo(() => facetValues(rows, (r) => r.state), [rows]);
  const makes = useMemo(() => facetValues(rows, (r) => r.brands), [rows]);
  const shown = useMemo(() => sortDealers(filterDealers(rows, { q, state, make }), sort.key, sort.dir), [rows, q, state, make, sort]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-surface/50 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="inline-flex items-center gap-1 text-xs font-bold text-ink-muted hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Admin</Link>
            <h1 className="text-sm font-black text-white">Dealer analytics</h1>
          </div>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-ink-muted" />
            <input aria-label="Search dealers" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dealer or city" className="w-56 rounded-lg border border-border bg-surface py-1.5 pl-7 pr-2 text-xs text-white placeholder:text-ink-muted" />
          </label>
          <select aria-label="State" value={state} onChange={(e) => setState(e.target.value)} className={selectCls}>
            <option value="">All states</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select aria-label="Make" value={make} onChange={(e) => setMake(e.target.value)} className={selectCls}>
            <option value="">All makes</option>
            {makes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <label className="ml-auto inline-flex items-center gap-2 text-xs text-ink-light">
            <input type="checkbox" checked={includeBuckets} onChange={(e) => setIncludeBuckets(e.target.checked)} /> Show group dealers
          </label>
        </div>

        {loading && !data ? <Skeleton testId="table-skeleton" /> : failure ? <AnalyticsMessage kind={failure.kind} detail={failure.detail} /> : data ? (
          <>
            <p className="text-[11px] text-ink-muted" data-testid="table-summary">
              {shown.length.toLocaleString("en-US")} of {rows.length.toLocaleString("en-US")} dealers · data as of {data.day}
              {!includeBuckets && data.hiddenBuckets > 0 ? ` · ${data.hiddenBuckets} group dealers hidden` : ""}
            </p>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs" data-testid="dealer-table">
                <thead className="bg-surface-elevated text-ink-muted">
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={`px-3 py-2 font-bold ${c.num ? "text-right" : ""}`}>
                        <button type="button" onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.num ? -1 : 1 }))} className="inline-flex items-center gap-1 hover:text-white">
                          {c.label}
                          {sort.key === c.key ? (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {shown.map((r) => (
                    <tr key={r.dealerId} className="hover:bg-surface/60">
                      {COLUMNS.map((c) => (
                        <td key={c.key} className={`px-3 py-1.5 ${c.num ? "text-right tabular-nums" : ""}`}>
                          {c.key === "dealerName" ? <Link href={`/admin/dealer-analytics/${r.dealerId}`} className="font-bold text-white hover:underline">{r.dealerName}</Link> : c.cell(r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {shown.length === 0 ? <tr><td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-ink-muted">No dealers match.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
