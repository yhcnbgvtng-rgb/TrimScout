"use client";

import React, { useState } from "react";
import {
  Cpu,
  X,
  Play,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Building2,
  Zap,
  Clock,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Layers,
} from "lucide-react";
import { runUnifiedScrapers, UnifiedScraperResponse } from "../lib/scrapers";
import { Vehicle } from "../lib/types";

interface ScraperDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportVehicles?: (vehicles: Vehicle[]) => void;
}

export const ScraperDashboardModal: React.FC<ScraperDashboardModalProps> = ({
  isOpen,
  onClose,
  onImportVehicles,
}) => {
  const [targetZip, setTargetZip] = useState("94107");
  const [targetMake, setTargetMake] = useState("BMW");
  const [customDealerUrl, setCustomDealerUrl] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [scraperResults, setScraperResults] = useState<UnifiedScraperResponse | null>(null);

  if (!isOpen) return null;

  const handleRunScrapers = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRunning(true);
    try {
      const res = await runUnifiedScrapers({
        zip: targetZip,
        make: targetMake !== "All" ? targetMake : undefined,
        dealerDomain: customDealerUrl || undefined,
        radiusMiles: 150,
      });
      setScraperResults(res);
      if (onImportVehicles && res.vehicles.length > 0) {
        onImportVehicles(res.vehicles);
      }
    } catch (err) {
      console.error("Scraper execution error:", err);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-3xl border border-border-strong bg-surface p-6 sm:p-8 shadow-2xl space-y-6 animate-fadeIn my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Cpu className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-white">5-Engine Live CMS, OEM & Porsche Finder Scraper</h2>
                <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[9px] font-black text-emerald-400 uppercase">
                  Zero Data Cost
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                Direct public JSON scraper covering Dealer.com, DealerInspire, DealerOn, OEM Allocations & Porsche Finder
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-white p-1 rounded-lg hover:bg-surface-elevated transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 5 Engine Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          <div className="rounded-2xl border border-border bg-surface-elevated p-3 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white">1. Dealer.com</span>
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="text-[10.5px] text-ink-muted">~14,000 Dealers</div>
            <div className="text-[9.5px] text-emerald-400 font-mono">/apis/widget/k/</div>
          </div>

          <div className="rounded-2xl border border-border bg-surface-elevated p-3 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white">2. DealerInspire</span>
              <span className="flex h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
            </div>
            <div className="text-[10.5px] text-ink-muted">~6,000 Dealers</div>
            <div className="text-[9.5px] text-blue-400 font-mono">/inventory/json/</div>
          </div>

          <div className="rounded-2xl border border-border bg-surface-elevated p-3 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white">3. DealerOn</span>
              <span className="flex h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
            </div>
            <div className="text-[10.5px] text-ink-muted">~4,500 Dealers</div>
            <div className="text-[9.5px] text-purple-400 font-mono">/api/v1/inventory</div>
          </div>

          <div className="rounded-2xl border border-border bg-surface-elevated p-3 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white">4. OEM Feeds</span>
              <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            </div>
            <div className="text-[10.5px] text-ink-muted">In-Transit Streams</div>
            <div className="text-[9.5px] text-amber-400 font-mono">Factory Pipeline</div>
          </div>

          <div className="rounded-2xl border border-border bg-surface-elevated p-3 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white">5. Porsche Finder</span>
              <span className="flex h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
            </div>
            <div className="text-[10.5px] text-ink-muted">Porsche Centers</div>
            <div className="text-[9.5px] text-rose-400 font-mono">Porsche Codes</div>
          </div>
        </div>

        {/* Scraper Test Controls */}
        <form onSubmit={handleRunScrapers} className="rounded-2xl border border-border/80 bg-surface-elevated p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-ink-faint">Target Zip Code</label>
              <input
                type="text"
                maxLength={5}
                value={targetZip}
                onChange={(e) => setTargetZip(e.target.value)}
                placeholder="94107"
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-ink-faint">Make Filter</label>
              <select
                value={targetMake}
                onChange={(e) => setTargetMake(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="BMW">BMW</option>
                <option value="Toyota">Toyota</option>
                <option value="Ford">Ford</option>
                <option value="Hyundai">Hyundai</option>
                <option value="Kia">Kia</option>
                <option value="Porsche">Porsche</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-ink-faint">Custom Dealer Domain (Optional)</label>
              <input
                type="text"
                value={customDealerUrl}
                onChange={(e) => setCustomDealerUrl(e.target.value)}
                placeholder="e.g. hilltopford.com"
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-ink-muted">
              Executes all 4 scrapers in parallel with sub-second execution & automatic deduplication.
            </span>

            <button
              type="submit"
              disabled={isRunning}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-5 py-2.5 text-xs font-black text-black shadow-md shadow-emerald-500/20 transition-all cursor-pointer disabled:opacity-50"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Scraping Live Inventory...</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-black" />
                  <span>Run 5 Scrapers Now</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Results View */}
        {scraperResults && (
          <div className="space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">Scraper Execution Output:</span>
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-400">
                  {scraperResults.totalFound} Vehicles Found in {scraperResults.totalExecutionTimeMs}ms
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              <div className="p-2.5 rounded-xl border border-border bg-surface-elevated space-y-0.5">
                <div className="text-[10px] text-ink-faint uppercase font-bold">Dealer.com</div>
                <div className="text-emerald-400 font-bold">
                  {scraperResults.engineBreakdown.dealerDotCom.count} listings ({scraperResults.engineBreakdown.dealerDotCom.timeMs}ms)
                </div>
              </div>

              <div className="p-2.5 rounded-xl border border-border bg-surface-elevated space-y-0.5">
                <div className="text-[10px] text-ink-faint uppercase font-bold">DealerInspire</div>
                <div className="text-blue-400 font-bold">
                  {scraperResults.engineBreakdown.dealerInspire.count} listings ({scraperResults.engineBreakdown.dealerInspire.timeMs}ms)
                </div>
              </div>

              <div className="p-2.5 rounded-xl border border-border bg-surface-elevated space-y-0.5">
                <div className="text-[10px] text-ink-faint uppercase font-bold">DealerOn</div>
                <div className="text-purple-400 font-bold">
                  {scraperResults.engineBreakdown.dealerOn.count} listings ({scraperResults.engineBreakdown.dealerOn.timeMs}ms)
                </div>
              </div>

              <div className="p-2.5 rounded-xl border border-border bg-surface-elevated space-y-0.5">
                <div className="text-[10px] text-ink-faint uppercase font-bold">OEM Allocations</div>
                <div className="text-amber-400 font-bold">
                  {scraperResults.engineBreakdown.oemAllocations.count} listings ({scraperResults.engineBreakdown.oemAllocations.timeMs}ms)
                </div>
              </div>

              <div className="p-2.5 rounded-xl border border-border bg-surface-elevated space-y-0.5">
                <div className="text-[10px] text-ink-faint uppercase font-bold">Porsche Finder</div>
                <div className="text-rose-400 font-bold">
                  {scraperResults.engineBreakdown.porscheFinder?.count || 0} listings ({scraperResults.engineBreakdown.porscheFinder?.timeMs || 0}ms)
                </div>
              </div>
            </div>

            {/* List of scraped vehicles */}
            <div className="max-h-60 overflow-y-auto rounded-2xl border border-border divide-y divide-border/60 text-xs">
              {scraperResults.vehicles.map((v) => (
                <div key={v.id} className="p-3 hover:bg-surface-elevated flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={v.imageUrl}
                      alt={v.trim}
                      className="h-10 w-14 rounded-lg object-cover border border-border shrink-0"
                    />
                    <div>
                      <div className="font-bold text-white">
                        {v.year} {v.make} {v.model} <span className="text-ink-muted font-normal">({v.trim})</span>
                      </div>
                      <div className="text-[11px] text-ink-muted font-mono">
                        VIN: {v.vin} • {v.location.dealerName} • {v.status === "in_transit" ? "🚢 In Transit Allocation" : "📍 On Lot"}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="font-mono font-bold text-emerald-400">${v.dealerPrice.toLocaleString()}</div>
                    {v.dealerUrl && (
                      <a
                        href={v.dealerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-ink-muted hover:text-white underline"
                      >
                        <span>Direct Link</span>
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
