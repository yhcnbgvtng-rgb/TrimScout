// Client for the dealership contact directory — a manually-maintained
// table (separate from the Ford/Chevrolet locator crawl data) so admins can
// keep a phone/email/contact-name record per dealership. Same box, same
// shared X-Trimscout-Api-Key pattern as authApi.ts/lightsailClient.ts, and
// deliberately served from auth_api_server.js rather than a new process —
// one more route on an already-open port beats a new pm2 process, port,
// and firewall rule for this little surface area.

import { LIGHTSAIL_HOST } from "./lightsailClient";

const AUTH_API_PORT = 3003;
const API_KEY = process.env.LIGHTSAIL_API_KEY;
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
  if (!API_KEY) {
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
        "X-Trimscout-Api-Key": API_KEY,
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

export async function listDealerships(): Promise<Dealership[]> {
  const json = await request("/api/dealerships");
  return json.dealerships;
}

export type DealershipInput = Omit<Dealership, "id" | "createdAt" | "updatedAt">;

export async function createDealership(input: DealershipInput): Promise<Dealership> {
  const json = await request("/api/dealerships", { method: "POST", body: JSON.stringify(input) });
  return json.dealership;
}

export async function updateDealership(id: string, input: DealershipInput): Promise<Dealership> {
  const json = await request(`/api/dealerships/${id}`, { method: "PUT", body: JSON.stringify(input) });
  return json.dealership;
}

export async function deleteDealership(id: string): Promise<void> {
  await request(`/api/dealerships/${id}`, { method: "DELETE" });
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
