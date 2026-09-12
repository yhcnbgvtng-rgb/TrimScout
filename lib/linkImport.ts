/**
 * The buyer's paste-a-link flow, client side. A pasted vehicle-page link is
 * never fetched by us — the dealer is resolved from the hostname against
 * the contacts on file (/api/desk-resolve), the VIN is read from the URL
 * text or typed by the buyer, and the car is then built from the VIN alone
 * through the same OEM sticker / NHTSA routes a bare VIN uses.
 *
 * Client-safe: no Node imports. Callers pass fetch so tests can fake it.
 */

import type { DeskMatch, DeskResolution } from "./deskResolve";
import { pastedVinCandidate } from "./oemWmi";
import type { DealerSource, Vehicle } from "./types";

export type { DeskMatch } from "./deskResolve";

export type LinkResolution =
  | {
      ok: true;
      url: string;
      host: string;
      /** 17 characters found in the URL itself, or null — the buyer confirms either way. */
      vinFromUrl: string | null;
      /** Exactly one confident desk, else null: the buyer picks. */
      desk: DeskMatch | null;
      /** Several rooftops share the site — offered as the picker's first choices. */
      candidates: DeskMatch[];
      /** A search-box seed from the site name when nothing matched. Never binds. */
      suggestedQuery: string | null;
      degraded: boolean;
    }
  | { ok: false; error: string };

export function isPlausibleVin(value: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test((value || "").trim().toUpperCase());
}

export async function resolveVdpLink(url: string, fetchImpl: typeof fetch = fetch): Promise<LinkResolution> {
  const clean = (url || "").trim();
  try {
    const res = await fetchImpl("/api/desk-resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: clean }),
    });
    const json = (await res.json().catch(() => ({}))) as Partial<DeskResolution> & { error?: string; degraded?: boolean };
    if (!res.ok || json.status === "invalid" || !json.status) {
      return { ok: false, error: json.error || "That doesn't look like a link to a vehicle page." };
    }
    const r = json as DeskResolution & { degraded?: boolean };
    const base = {
      ok: true as const,
      url: clean,
      vinFromUrl: pastedVinCandidate(clean),
      degraded: Boolean(json.degraded),
    };
    if (r.status === "unique") {
      return { ...base, host: r.host, desk: r.desk, candidates: [], suggestedQuery: null };
    }
    if (r.status === "ambiguous") {
      return { ...base, host: r.host, desk: null, candidates: r.candidates, suggestedQuery: null };
    }
    if (r.status === "none") {
      return { ...base, host: r.host, desk: null, candidates: [], suggestedQuery: r.suggestedQuery };
    }
    return { ok: false, error: "That doesn't look like a link to a vehicle page." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not check that link." };
  }
}

export async function searchDealers(
  q: string,
  zip: string,
  fetchImpl: typeof fetch = fetch
): Promise<DeskMatch[]> {
  try {
    const res = await fetchImpl("/api/dealer-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: q.trim(), zip: zip.trim() }),
    });
    const json = (await res.json().catch(() => ({}))) as { matches?: DeskMatch[] };
    return Array.isArray(json.matches) ? json.matches : [];
  } catch {
    return [];
  }
}

export function deskLocationLine(d: Pick<DeskMatch, "city" | "state"> | null | undefined): string {
  return [d?.city, d?.state].filter(Boolean).join(", ");
}

/**
 * Stamp a VIN-built vehicle with what the link and the buyer settled: the
 * page it lives on, the advertised price the buyer read off it (if any),
 * and the desk. The build itself is untouched — a person's confirmation
 * never upgrades buildConfidence.
 */
export function attachLinkToVehicle(
  vehicle: Vehicle,
  link: { url: string; price?: number | null; desk: DeskMatch | null; deskSource: Extract<DealerSource, "listing_domain" | "buyer_picked"> }
): Vehicle {
  const price = link.price && link.price > 0 ? Math.round(link.price) : 0;
  const location = link.desk
    ? {
        ...vehicle.location,
        dealerName: link.desk.dealerName,
        city: link.desk.city || "",
        state: link.desk.state || "",
        zip: link.desk.zip || undefined,
        dealerConfirmed: true,
        dealerSource: link.deskSource,
        deskId: link.desk.deskId,
      }
    : vehicle.location;
  return {
    ...vehicle,
    dealerUrl: link.url,
    dealerPrice: price || vehicle.dealerPrice,
    location,
    buyerConfirmed: true,
  };
}
