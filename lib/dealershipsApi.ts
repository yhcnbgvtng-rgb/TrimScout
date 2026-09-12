// Client for the dealership contact directory — a manually-maintained
// table (separate from the Ford/Chevrolet locator crawl data) so admins can
// keep a phone/email/contact-name record per dealership. Same box, same
// shared X-Trimscout-Api-Key pattern as authApi.ts/lightsailClient.ts, and
// deliberately served from auth_api_server.js rather than a new process —
// one more route on an already-open port beats a new pm2 process, port,
// and firewall rule for this little surface area.

import { LIGHTSAIL_HOST } from "./lightsailClient";
import { serverSecret } from "./serverSecret";

const AUTH_API_PORT = 3003;
const DEFAULT_TIMEOUT_MS = 8000;

export interface Dealership {
  id: string;
  dealerName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
  /** Primary URL. Backfilled from the crawl's "Website:" note where the column is empty. */
  website: string | null;
  /**
   * Registrable hosts that map to this desk — lowercase, no "www." — the
   * website's own host plus every alias seen (vanity domains, the final
   * host after a redirect). What a pasted vehicle-page link is matched on.
   */
  domains: string[];
  /** Set only via the public unsubscribe link — never reset by a CSV/xlsx re-import or a manual edit. */
  emailOptOut: boolean;
  createdAt: string;
  updatedAt: string;
}

export class DealershipsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const apiKey = serverSecret("LIGHTSAIL_API_KEY");
  if (!apiKey) {
    throw new DealershipsApiError("Dealerships backend is not configured (missing LIGHTSAIL_API_KEY)", 500);
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`http://${LIGHTSAIL_HOST}:${AUTH_API_PORT}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Trimscout-Api-Key": apiKey,
        ...(init?.headers || {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    throw new DealershipsApiError(
      err instanceof Error && err.name === "AbortError" ? "Request timed out" : "Could not reach dealerships service",
      503
    );
  } finally {
    clearTimeout(timeoutId);
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {}
  if (!res.ok) {
    throw new DealershipsApiError(json?.error || `Dealerships request failed (${res.status})`, res.status);
  }
  return json;
}

/** Rows from a box that predates the website/domains columns still parse; the fields just come back empty. */
function normalizeDealership(raw: Record<string, unknown>): Dealership {
  const domains = Array.isArray(raw.domains) ? raw.domains.map((d) => String(d || "").trim().toLowerCase()).filter(Boolean) : [];
  return {
    ...(raw as unknown as Dealership),
    website: typeof raw.website === "string" && raw.website.trim() ? raw.website.trim() : null,
    domains: Array.from(new Set(domains)),
  };
}

export async function listDealerships(): Promise<Dealership[]> {
  const json = await request("/api/dealerships");
  return (json.dealerships as Record<string, unknown>[]).map(normalizeDealership);
}

export type DealershipInput = Omit<Dealership, "id" | "createdAt" | "updatedAt" | "emailOptOut">;

export async function createDealership(input: DealershipInput): Promise<Dealership> {
  const json = await request("/api/dealerships", { method: "POST", body: JSON.stringify(input) });
  return normalizeDealership(json.dealership);
}

export async function updateDealership(id: string, input: DealershipInput): Promise<Dealership> {
  const json = await request(`/api/dealerships/${id}`, { method: "PUT", body: JSON.stringify(input) });
  return normalizeDealership(json.dealership);
}

export async function deleteDealership(id: string): Promise<void> {
  await request(`/api/dealerships/${id}`, { method: "DELETE" });
}

/** One-directional — a dealer opting out via the unsubscribe link. No "opt back in" here on purpose. */
export async function setDealershipEmailOptOut(id: string): Promise<Dealership> {
  const json = await request(`/api/dealerships/${id}/opt-out`, { method: "POST" });
  return normalizeDealership(json.dealership);
}

export interface BulkUpsertResult {
  created: number;
  updated: number;
  skipped: number;
  total: number;
}

/** Upserts many rows at once, matched by dealer name — safe to re-run with an updated spreadsheet. */
export async function bulkUpsertDealerships(rows: Partial<DealershipInput>[]): Promise<BulkUpsertResult> {
  return request("/api/dealerships/bulk", { method: "POST", body: JSON.stringify({ dealerships: rows }) });
}
