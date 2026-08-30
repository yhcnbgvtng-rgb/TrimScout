"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Radar,
  Loader2,
  Clock,
  Building2,
  Car,
  TrendingDown,
  TrendingUp,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface CrawlHistoryRun {
  id: string;
  brandCode: string;
  brandName: string;
  status: "RUNNING" | "COMPLETE" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  durationMinutes: number | null;
  dealersConfigured: number;
  dealersActive: number;
  dealersErrored: number;
  totalVehicles: number;
  newArrivals: number;
  priceDrops: number;
  priceIncreases: number;
  soldOrRemoved: number;
  errorSummary: string | null;
  failedDealerNames: string[] | null;
}

interface CrawlHistoryResponse {
  availableDates: string[];
  date: string | null;
  runs: CrawlHistoryRun[];
}

const STATUS_META: Record<CrawlHistoryRun["status"], { label: string; dot: string; text: string; bg: string }> = {
  COMPLETE: { label: "Completed", dot: "bg-emerald-400", text: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
  RUNNING: { label: "Running", dot: "bg-blue-400 animate-pulse", text: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/30" },
  FAILED: { label: "Failed", dot: "bg-rose-400", text: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/30" },
};

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const isToday = new Date().toISOString().slice(0, 10) === dateStr;
  const label = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return isToday ? `${label} (Today)` : label;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

const RunCard: React.FC<{ run: CrawlHistoryRun }> = ({ run }) => {
  const [showFailedDealers, setShowFailedDealers] = useState(false);
  const meta = STATUS_META[run.status];

  return (
    <div className={`rounded-2xl border ${meta.bg} p-4 space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-elevated text-white font-black text-xs border border-border">
            {run.brandName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-bold text-white">{run.brandName}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              <span className={`font-semibold ${meta.text}`}>{meta.label}</span>
              <span>· {formatTime(run.startedAt)}</span>
              {run.durationMinutes != null && <span>· {run.durationMinutes} min</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div className="rounded-lg bg-background/60 p-2">
          <div className="flex items-center gap-1 text-ink-faint uppercase font-bold text-[9px]">
            <Building2 className="h-2.5 w-2.5" /> Dealers
          </div>
          <div className="text-white font-mono font-bold text-sm">
            {run.dealersActive}/{run.dealersConfigured}
            {run.dealersErrored > 0 && <span className="text-rose-400 text-[10px] ml-1">({run.dealersErrored} err)</span>}
          </div>
        </div>
        <div className="rounded-lg bg-background/60 p-2">
          <div className="flex items-center gap-1 text-ink-faint uppercase font-bold text-[9px]">
            <Car className="h-2.5 w-2.5" /> Vehicles
          </div>
          <div className="text-white font-mono font-bold text-sm">{run.totalVehicles.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-background/60 p-2">
          <div className="flex items-center gap-1 text-ink-faint uppercase font-bold text-[9px]">
            <TrendingUp className="h-2.5 w-2.5 text-emerald-400" /> New
          </div>
          <div className="text-emerald-400 font-mono font-bold text-sm">{run.newArrivals.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-background/60 p-2">
          <div className="flex items-center gap-1 text-ink-faint uppercase font-bold text-[9px]">
            <TrendingDown className="h-2.5 w-2.5 text-rose-400" /> Price Drops
          </div>
          <div className="text-rose-400 font-mono font-bold text-sm">{run.priceDrops.toLocaleString()}</div>
        </div>
      </div>

      {run.errorSummary && (
        <p className="text-[11px] text-rose-300 bg-rose-950/30 rounded-lg p-2 border border-rose-500/20">
          {run.errorSummary}
        </p>
      )}

      {run.failedDealerNames && run.failedDealerNames.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowFailedDealers((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:text-amber-300"
          >
            {showFailedDealers ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span>{run.failedDealerNames.length} dealer{run.failedDealerNames.length === 1 ? "" : "s"} with no inventory found</span>
          </button>
          {showFailedDealers && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {run.failedDealerNames.map((name) => (
                <span key={name} className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-ink-light border border-border">
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const CrawlHistoryDashboard: React.FC = () => {
  const [data, setData] = useState<CrawlHistoryResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((date?: string) => {
    setIsLoading(true);
    setError(null);
    fetch(`/api/crawl-history${date ? `?date=${encodeURIComponent(date)}` : ""}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((json: CrawlHistoryResponse) => {
        setData(json);
        setSelectedDate(json.date);
      })
      .catch((e) => setError(e.message || "Could not load crawl history."))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-3xl border border-border-strong bg-surface p-6 shadow-2xl space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
            <Radar className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Crawl History</h2>
            <p className="text-xs text-ink-muted">Real scrape_runs data — did each brand's crawler actually run today?</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => load(selectedDate || undefined)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3 py-2 text-xs font-bold text-ink-light hover:text-white transition-all"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {isLoading && !data && (
        <div className="flex items-center justify-center gap-2 py-12 text-ink-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading real crawl history…</span>
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-4 text-sm text-rose-300">{error}</div>
      )}

      {data && data.availableDates.length === 0 && (
        <p className="text-xs text-ink-faint py-6 text-center">No crawl runs recorded yet.</p>
      )}

      {data && data.availableDates.length > 0 && (
        <>
          {/* Date lookback strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {data.availableDates.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setSelectedDate(d);
                  load(d);
                }}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold whitespace-nowrap transition-all ${
                  selectedDate === d
                    ? "bg-emerald-500 text-black"
                    : "bg-surface-elevated text-ink-muted hover:text-white border border-border"
                }`}
              >
                {formatDateLabel(d)}
              </button>
            ))}
          </div>

          {/* Runs for selected date */}
          {data.runs.length === 0 ? (
            <p className="text-xs text-ink-faint py-6 text-center">No crawl runs recorded for this day.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.runs.map((run) => (
                <RunCard key={run.id} run={run} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
