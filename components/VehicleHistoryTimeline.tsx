"use client";

import React, { useEffect, useState } from "react";
import { Clock, Loader2 } from "lucide-react";

interface HistoryEntry {
  date: string;
  type: "NEW_ARRIVAL" | "PRICE_DROP" | "PRICE_INCREASE" | "SOLD" | "UNCHANGED";
  oldPrice: number | null;
  newPrice: number | null;
  priceDiff: number;
}

interface VehicleHistoryResponse {
  vin: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  dealerName?: string | null;
  price?: number | null;
  status?: string | null;
  firstSeenDate: string | null;
  lastSeenDate: string | null;
  priceHistory: { date: string; price: number; priceDelta: number }[];
  changeLog: HistoryEntry[];
  brandRunDates: string[];
}

interface DayRow {
  date: string;
  events: {
    type: string;
    newPrice: number | null;
    oldPrice?: number | null;
    priceDiff?: number;
    carried?: boolean;
  }[];
}

const TYPE_META: Record<string, { dot: string; text: string; textColor: string }> = {
  NEW_ARRIVAL: { dot: "bg-emerald-400", text: "New arrival logged", textColor: "text-emerald-400" },
  PRICE_DROP: { dot: "bg-rose-400", text: "Price drop", textColor: "text-rose-400" },
  PRICE_INCREASE: { dot: "bg-amber-400", text: "Price increase", textColor: "text-amber-400" },
  SOLD: { dot: "bg-ink-faint", text: "Marked sold / removed", textColor: "text-ink-muted" },
  UNCHANGED: { dot: "bg-border-strong", text: "Seen — no change", textColor: "text-ink-faint" },
  FIRST_SEEN: { dot: "bg-emerald-400", text: "First seen by crawler", textColor: "text-emerald-400" },
};

function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function formatDate(dateStr: string): { day: string; yr: string } {
  const [y, m, d] = dateStr.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return { day: `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`, yr: y };
}

// Real changeLog/priceHistory entries only exist on days something
// actually changed. To show a genuine per-day picture, walk every real
// completed crawl day for this vehicle's brand (brandRunDates, straight
// from scrape_runs) that falls inside [firstSeenDate, lastSeenDate], and
// carry the price forward on days with no logged event — same logic
// verified in the VIN Crawl Timeline artifact.
function buildDayRows(history: VehicleHistoryResponse): DayRow[] {
  const eventsByDate: Record<string, DayRow["events"]> = {};
  const touch = (date: string) => (eventsByDate[date] ||= []);

  history.changeLog.forEach((c) => {
    const list = touch(c.date);
    const key = `${c.type}-${c.oldPrice}-${c.newPrice}`;
    if (list.some((e: any) => e._key === key)) return; // real duplicate rows exist in the source data
    list.push({ type: c.type, oldPrice: c.oldPrice, newPrice: c.newPrice, priceDiff: c.priceDiff, ...( { _key: key } as any) });
  });

  const runDates = history.brandRunDates.filter(
    (d) => (!history.firstSeenDate || d >= history.firstSeenDate) && (!history.lastSeenDate || d <= history.lastSeenDate)
  );
  const dateList = runDates.length > 0 ? runDates : Object.keys(eventsByDate).sort();

  let carriedPrice: number | null = null;
  return dateList.map((date) => {
    let events = eventsByDate[date] || [];
    if (events.length === 0) {
      const isFirstDay = date === dateList[0];
      events = [{ type: isFirstDay ? "FIRST_SEEN" : "UNCHANGED", newPrice: carriedPrice, carried: true }];
    }
    const lastRealPrice = [...events].reverse().find((e) => e.newPrice != null)?.newPrice;
    if (lastRealPrice != null) carriedPrice = lastRealPrice;
    return { date, events };
  });
}

export const VehicleHistoryTimeline: React.FC<{ vin: string; showSummary?: boolean }> = ({ vin, showSummary }) => {
  const [history, setHistory] = useState<VehicleHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setHistory(null);
    fetch(`/api/vehicle-history?vin=${encodeURIComponent(vin)}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "No TrimScout history recorded yet for this VIN." : "Could not load history.");
        return res.json();
      })
      .then((json: VehicleHistoryResponse) => setHistory(json))
      .catch((e) => setError(e.message || "Could not load history."))
      .finally(() => setIsLoading(false));
  }, [vin]);

  return (
    <div className="rounded-2xl border border-border bg-surface-elevated p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wide">
        <Clock className="h-3.5 w-3.5 text-emerald-400" />
        TrimScout History — By Day
      </div>

      {showSummary && !isLoading && !error && history && (history.year || history.make || history.model) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-bold text-white truncate">
              {[history.year, history.make, history.model, history.trim].filter(Boolean).join(" ")}
            </div>
            <div className="text-[11px] text-ink-muted truncate">
              {history.dealerName || "Unknown dealer"} · <span className="font-mono">{history.vin}</span>
              {history.status && <span className="ml-1.5 text-ink-faint uppercase">{history.status}</span>}
            </div>
          </div>
          <div className="font-mono text-sm font-extrabold text-emerald-400 shrink-0">
            {formatMoney(history.price)}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-ink-muted text-xs py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading real TrimScout history…
        </div>
      )}

      {!isLoading && error && (
        <p className="text-[11px] text-ink-faint">{error}</p>
      )}

      {!isLoading && !error && history && (
        <div className="divide-y divide-border">
          {buildDayRows(history).map((row) => {
            const { day, yr } = formatDate(row.date);
            return (
              <div key={row.date} className="grid grid-cols-[64px_1fr] gap-3 py-2.5 text-xs">
                <div className="font-mono text-ink-muted pt-0.5">
                  {day} <span className="text-ink-faint">{yr}</span>
                </div>
                <div className="space-y-1.5">
                  {row.events.map((e, i) => {
                    const meta = TYPE_META[e.type] || TYPE_META.UNCHANGED;
                    let detail: React.ReactNode = null;
                    if (e.type === "PRICE_DROP" || e.type === "PRICE_INCREASE") {
                      const deltaCls = (e.priceDiff ?? 0) < 0 ? "text-rose-400" : "text-amber-400";
                      detail = (
                        <span className="font-mono text-ink-muted">
                          {formatMoney(e.oldPrice)} → {formatMoney(e.newPrice)}{" "}
                          <span className={deltaCls}>
                            ({(e.priceDiff ?? 0) > 0 ? "+" : ""}
                            {formatMoney(e.priceDiff)})
                          </span>
                        </span>
                      );
                    } else if (e.newPrice != null) {
                      detail = <span className="font-mono text-ink-muted">{formatMoney(e.newPrice)}</span>;
                    }
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${meta.dot}`} />
                        <span className={`font-semibold ${meta.textColor}`}>{meta.text}</span>
                        {detail}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {buildDayRows(history).length === 0 && (
            <p className="text-[11px] text-ink-faint py-2">No crawl history recorded yet for this VIN.</p>
          )}
        </div>
      )}
    </div>
  );
};
