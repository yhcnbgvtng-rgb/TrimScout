import { Vehicle } from "../types";
import { scrapeDealerDotCom, ScraperResult } from "./dealerDotComScraper";
import { scrapeDealerInspire } from "./dealerInspireScraper";
import { scrapeDealerOn } from "./dealerOnScraper";
import { scrapeOemAllocationFeed } from "./oemInventoryScraper";

export interface UnifiedScraperResponse {
  vehicles: Vehicle[];
  totalFound: number;
  engineBreakdown: {
    dealerDotCom: { count: number; status: "success" | "error"; timeMs: number };
    dealerInspire: { count: number; status: "success" | "error"; timeMs: number };
    dealerOn: { count: number; status: "success" | "error"; timeMs: number };
    oemAllocations: { count: number; status: "success" | "error"; timeMs: number };
  };
  totalExecutionTimeMs: number;
}

/**
 * Unified 4-Engine Scraper Orchestrator for TrimScout
 * Runs Dealer.com, DealerInspire, DealerOn, and OEM Factory feeds concurrently.
 */
export async function runUnifiedScrapers(options: {
  zip: string;
  radiusMiles?: number;
  make?: string;
  model?: string;
  query?: string;
  dealerDomain?: string;
}): Promise<UnifiedScraperResponse> {
  const globalStart = Date.now();
  const radius = options.radiusMiles || 150;
  const targetZip = options.zip || "94107";

  // Target representative dealer domains if not specified
  const dealerDotComTarget = options.dealerDomain || "bmwofsanrafael.com";
  const dealerInspireTarget = options.dealerDomain || "vallejohyundai.com";
  const dealerOnTarget = options.dealerDomain || "hilltopford.com";

  // Execute all 4 scraping engines concurrently
  const [ddcResult, diResult, donResult, oemResult] = await Promise.allSettled([
    scrapeDealerDotCom(dealerDotComTarget, {
      make: options.make,
      model: options.model,
      query: options.query,
      zip: targetZip,
    }),
    scrapeDealerInspire(dealerInspireTarget, {
      make: options.make,
      model: options.model,
      query: options.query,
      zip: targetZip,
    }),
    scrapeDealerOn(dealerOnTarget, {
      make: options.make,
      model: options.model,
      query: options.query,
      zip: targetZip,
    }),
    scrapeOemAllocationFeed({
      make: options.make || "Toyota",
      model: options.model,
      zip: targetZip,
      radiusMiles: radius,
    }),
  ]);

  const vehicles: Vehicle[] = [];
  const seenVins = new Set<string>();

  const addUnique = (items: Vehicle[]) => {
    for (const v of items) {
      if (!seenVins.has(v.vin)) {
        seenVins.add(v.vin);
        vehicles.push(v);
      }
    }
  };

  const engineStats = {
    dealerDotCom: { count: 0, status: "error" as "success" | "error", timeMs: 0 },
    dealerInspire: { count: 0, status: "error" as "success" | "error", timeMs: 0 },
    dealerOn: { count: 0, status: "error" as "success" | "error", timeMs: 0 },
    oemAllocations: { count: 0, status: "success" as "success" | "error", timeMs: 0 },
  };

  if (ddcResult.status === "fulfilled") {
    addUnique(ddcResult.value.vehicles);
    engineStats.dealerDotCom = {
      count: ddcResult.value.vehicles.length,
      status: "success",
      timeMs: ddcResult.value.executionTimeMs,
    };
  }

  if (diResult.status === "fulfilled") {
    addUnique(diResult.value.vehicles);
    engineStats.dealerInspire = {
      count: diResult.value.vehicles.length,
      status: "success",
      timeMs: diResult.value.executionTimeMs,
    };
  }

  if (donResult.status === "fulfilled") {
    addUnique(donResult.value.vehicles);
    engineStats.dealerOn = {
      count: donResult.value.vehicles.length,
      status: "success",
      timeMs: donResult.value.executionTimeMs,
    };
  }

  if (oemResult.status === "fulfilled") {
    addUnique(oemResult.value.vehicles);
    engineStats.oemAllocations = {
      count: oemResult.value.vehicles.length,
      status: "success",
      timeMs: oemResult.value.executionTimeMs,
    };
  }

  return {
    vehicles,
    totalFound: vehicles.length,
    engineBreakdown: engineStats,
    totalExecutionTimeMs: Date.now() - globalStart,
  };
}

export * from "./dealerDotComScraper";
export * from "./dealerInspireScraper";
export * from "./dealerOnScraper";
export * from "./oemInventoryScraper";
