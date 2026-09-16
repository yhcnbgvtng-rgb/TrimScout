"use client";

// One VIN, day by day: every store that has listed it, and for the selected listing a calendar of the days the
// crawl saw it with that day's price and any change. Opens from the Vehicles tab (a VIN typed into the search
// box, or a row's VIN cell).

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { vinTimeline, type VehicleRow, type VinDay } from "@/lib/crawlSheetColumns";

const money = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString()}`);

export default function VinHistory({ vin, onClose }: { vin: string; onClose: () => void }) {
  const [data, setData] = useState<{ listings: VehicleRow[]; days: VinDay[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [which, setWhich] = useState(0);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null); setWhich(0);
    fetch(`/api/admin/inventory?vin=${encodeURIComponent(vin)}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not load this VIN."); return j; })
      .then((j) => { if (alive) setData({ listings: j.listings, days: j.days }); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Could not load this VIN."); });
    return () => { alive = false; };
  }, [vin]);

  const listing = data?.listings[which] ?? null;
  const timeline = useMemo(() => (data ? vinTimeline(listing, data.days) : []), [data, listing]);
  const seenDays = timeline.filter((t) => t.status === "seen").length;
  const changes = timeline.filter((t) => t.delta != null && t.delta !== 0);
  const first = timeline[0]?.price ?? null, last = [...timeline].reverse().find((t) => t.price != null)?.price ?? null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-ink-faint">VIN history</div>
            <h2 className="font-mono text-lg font-black text-white">{vin}</h2>
            {listing && <div className="text-sm text-ink-light">{[listing.year, listing.make, listing.model, listing.trim].filter(Boolean).join(" ")}{listing.exteriorColor ? ` · ${listing.exteriorColor}` : ""}</div>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-border p-1.5 text-ink-muted hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        {error && <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">{error}</div>}
        {!data && !error && <div className="mt-6 text-xs text-ink-muted">Loading…</div>}
        {data && data.listings.length === 0 && <div className="mt-6 text-xs text-ink-muted">This VIN hasn&apos;t appeared in any crawled store.</div>}

        {data && data.listings.length > 0 && (
          <>
            <div className="mt-4 space-y-1.5">
              <div className="text-[10px] font-black uppercase tracking-wider text-ink-faint">Listed at</div>
              {data.listings.map((l, i) => (
                <button key={`${l.dealerId}|${i}`} type="button" onClick={() => setWhich(i)} className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-xs ${i === which ? "border-emerald-500/60 bg-emerald-500/10" : "border-border bg-surface-elevated hover:border-emerald-500/40"}`}>
                  <span><span className="font-semibold text-white">{l.dealerName}</span>{l.dealerCity ? <span className="text-ink-muted"> · {l.dealerCity}, {l.dealerState}</span> : null}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${l.removedAt ? "bg-border text-ink-muted" : "bg-emerald-500/15 text-emerald-300"}`}>{l.removedAt ? `removed ${l.removedAt.slice(0, 10)}` : "in stock"}</span>
                </button>
              ))}
            </div>

            {listing && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[["Days seen", String(seenDays)], ["Price changes", String(changes.length)], ["First price", money(first)], ["Current price", money(last)]].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-border bg-surface-elevated px-3 py-2"><div className="text-[10px] font-black uppercase tracking-wider text-ink-faint">{k}</div><div className="text-base font-black tabular-nums text-white">{v}</div></div>
                ))}
              </div>
            )}

            {listing && (
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-ink-light sm:grid-cols-3">
                {listing.condition && <div><span className="text-ink-faint">Condition</span> {listing.condition}</div>}
                {listing.stockNumber && <div><span className="text-ink-faint">Stock #</span> <span className="font-mono">{listing.stockNumber}</span></div>}
                {listing.mileage != null && <div><span className="text-ink-faint">Miles</span> {listing.mileage.toLocaleString()}</div>}
                {listing.msrp != null && <div><span className="text-ink-faint">MSRP</span> {money(listing.msrp)}</div>}
                {listing.daysOnLot != null && <div><span className="text-ink-faint">Days on lot (crawl)</span> {listing.daysOnLot}</div>}
                {listing.crawlFirstSeen && <div><span className="text-ink-faint">On site since</span> {listing.crawlFirstSeen.slice(0, 10)}</div>}
                {listing.vdpUrl && <div className="col-span-2 sm:col-span-3"><a href={listing.vdpUrl} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">Listing ↗</a>{listing.windowStickerUrl ? <> · <a href={listing.windowStickerUrl} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">Window sticker ↗</a></> : null}</div>}
              </div>
            )}

            <div className="mt-4 overflow-hidden rounded-xl border border-border">
              <div className="grid grid-cols-[110px_90px_1fr_100px_90px] border-b border-border bg-surface-elevated px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-ink-faint"><span>Date</span><span>Status</span><span>Price</span><span className="text-right">Change</span><span className="text-right">Miles</span></div>
              {timeline.length === 0 && <div className="p-4 text-xs text-ink-muted">No observations yet for this listing.</div>}
              {timeline.map((t) => (
                <div key={t.date} className={`grid grid-cols-[110px_90px_1fr_100px_90px] items-center px-3 py-1 text-[11.5px] ${t.status === "gap" ? "text-ink-faint" : "text-ink-light"} ${t.delta ? "bg-emerald-500/5" : ""} border-b border-border/40`}>
                  <span className="tabular-nums">{t.date}</span>
                  <span className={t.status === "seen" ? "text-emerald-300" : t.status === "removed" ? "text-rose-300" : ""}>{t.status === "seen" ? "on site" : t.status === "removed" ? "removed" : "no crawl"}</span>
                  <span className="tabular-nums">{money(t.price)}</span>
                  <span className={`text-right tabular-nums font-bold ${t.delta && t.delta < 0 ? "text-emerald-300" : t.delta && t.delta > 0 ? "text-amber-300" : "text-ink-faint"}`}>{t.delta ? `${t.delta < 0 ? "▼" : "▲"} $${Math.abs(t.delta).toLocaleString()}` : ""}</span>
                  <span className="text-right tabular-nums">{t.mileage != null ? t.mileage.toLocaleString() : ""}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">&quot;On site&quot; days are ones the nightly crawl recorded; &quot;no crawl&quot; days fall between observations (the crawl logs every day from now on; older history comes from the crawl&apos;s price-change dates).</p>
          </>
        )}
      </div>
    </div>
  );
}
