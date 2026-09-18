import { Vehicle } from "../types";
import { ScraperResult } from "./dealerDotComScraper";

/**
 * Direct OEM Consumer Inventory & In-Transit Allocation Scraper
 *
 * No live factory allocation feed is integrated yet — there is no real
 * source behind this engine. It previously returned a hardcoded catalog of
 * invented vehicles (fake VINs, fake dealers) on every call, indistinguishable
 * from genuinely scraped inventory. Until a real feed is wired up, this
 * returns zero vehicles rather than fabricating any.
 */
export async function scrapeOemAllocationFeed(options: {
  make: string;
  model?: string;
  zip: string;
  radiusMiles?: number;
}): Promise<ScraperResult> {
  const startTime = Date.now();
  const vehicles: Vehicle[] = [];

  return {
    source: "OEM Factory Feed",
    vehicles,
    totalFound: vehicles.length,
    dealerRooftop: "Direct Manufacturer Regional Allocation Pipeline",
    executionTimeMs: Date.now() - startTime,
  };
}
