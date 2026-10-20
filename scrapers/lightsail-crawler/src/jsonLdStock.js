// Stock number from the JSON-LD sku / stock fields of the vehicle the page is about.
//
// Audit 2026-10-19 (new Toyota, MY2025-27, 124,216 active cars): stock number is blank on 56,110 of 56,256 DealerOn-style cars,
// 20,722 of 20,745 Team Velocity (/viewdetails/) cars and 26,109 of 46,641 Dealer.com cars - the most-missing field. The pages state it:
//   - DealerOn: the `Product` JSON-LD block (sibling of the stockless `Vehicle` block) carries "sku": "<stock number>".
//   - Team Velocity: the `Vehicle` node inside the "@graph" carries "sku": "<stock number>" (its "productID" is the VIN, so productID is NOT read).
//   - Dealer.com and others: a flat Vehicle / Car node may carry "sku" or "stockNumber".
// The same node matching as jsonLdColors.js decides which nodes are about this car (same VIN, or a VIN-less Product with the Vehicle's name),
// so a sku on a different car on the page is never used. Candidates that disagree give null. A value equal to the VIN, shaped like a VIN, a URL
// or a placeholder is ignored. Fills a blank only; a stock number another strategy found is never replaced.
// CRAWLER_JSONLD_STOCK=false turns the fill off.
import { matchingJsonLdNodes } from './jsonLdColors.js';

const STOCK_KEYS = ['sku', 'stockNumber', 'vehicleStockNumber'];

function stockText(raw, vin) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim();
  if (s.length < 2 || s.length > 20) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_/.]*$/.test(s)) return null;
  if (/^(n\/?a|none|null|undefined|unknown|tbd|new|used)$/i.test(s)) return null;
  if (s.toUpperCase() === String(vin || '').trim().toUpperCase()) return null;
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(s)) return null;
  return s;
}

/** The stock number the page's JSON-LD states for this vehicle, or null (none stated, or matching nodes disagree). */
export function readJsonLdStock(html, { vin } = {}) {
  const matched = matchingJsonLdNodes(html, { vin });
  const found = new Map(); // upper-cased -> value as written (a re-cased duplicate is the same stock number)
  for (const n of matched) {
    for (const k of STOCK_KEYS) {
      const c = stockText(n[k], vin);
      if (c && !found.has(c.toUpperCase())) found.set(c.toUpperCase(), c);
    }
  }
  return found.size === 1 ? [...found.values()][0] : null;
}

/** Fills only a blank stockNumber on `vehicle` from the page's JSON-LD. Returns the same object (or null/undefined as given). */
export function fillStockFromJsonLd(vehicle, html) {
  if (!vehicle || !vehicle.vin) return vehicle;
  if (String(process.env.CRAWLER_JSONLD_STOCK).toLowerCase() === 'false') return vehicle;
  if (vehicle.stockNumber && String(vehicle.stockNumber).trim()) return vehicle;
  const stock = readJsonLdStock(html, { vin: vehicle.vin });
  if (stock) vehicle.stockNumber = stock;
  return vehicle;
}
