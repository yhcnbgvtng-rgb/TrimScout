// Client for the deals/payments backend on the box (MariaDB-backed, port
// 3004) — see scrapers/lightsail-crawler/src/deals_api_server.js for the
// server this talks to. Same reasoning as lib/authApi.ts: Vercel never
// touches MariaDB directly, so this calls the box's HTTP API instead, using
// the same shared X-Trimscout-Api-Key header as every other route there.
//
// Throws on failure rather than returning null — a payment-adjacent write
// (creating a deal, marking one paid) needs to surface as a real error,
// not silently degrade the way a stale-inventory read can.

import { LIGHTSAIL_HOST } from "./lightsailClient";

const DEALS_API_PORT = 3004;
const API_KEY = process.env.LIGHTSAIL_API_KEY;
const DEFAULT_TIMEOUT_MS = 8000;

export interface DealRecord {
  id: string;
  certificateId: string;
  buyerUserId: string;
  dealerName: string;
  matchedVin: string;
  totalOtdPrice: number;
  platformFeeCents: number;
  winningBid: Record<string, unknown>;
  status: "pending_payment" | "paid" | "expired" | "cancelled";
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  createdAt: string;
  paidAt: string | null;
}

export class DealsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  if (!API_KEY) {
    throw new DealsApiError("Deals backend is not configured (missing LIGHTSAIL_API_KEY)", 500);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`http://${LIGHTSAIL_HOST}:${DEALS_API_PORT}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Trimscout-Api-Key": API_KEY,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    throw new DealsApiError(
      err instanceof Error && err.name === "AbortError" ? "Deals request timed out" : "Could not reach deals service",
      503
    );
  } finally {
    clearTimeout(timeoutId);
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // no-op — handled by the !res.ok branch below
  }

  if (!res.ok) {
    throw new DealsApiError(json?.error || `Deals request failed (${res.status})`, res.status);
  }
  return json;
}

export async function createDeal(input: {
  buyerUserId: string;
  dealerName: string;
  matchedVin: string;
  totalOtdPrice: number;
  platformFeeCents: number;
  winningBid: Record<string, unknown>;
}): Promise<DealRecord> {
  const json = await request("POST", "/api/deals", input);
  return json.deal as DealRecord;
}

export async function getDeal(dealId: string): Promise<DealRecord | null> {
  try {
    const json = await request("GET", `/api/deals/${dealId}`);
    return json.deal as DealRecord;
  } catch (err) {
    if (err instanceof DealsApiError && err.status === 404) return null;
    throw err;
  }
}

export async function markDealPaid(
  dealId: string,
  input: { stripeCheckoutSessionId: string; stripePaymentIntentId: string | null }
): Promise<DealRecord> {
  const json = await request("POST", `/api/deals/${dealId}/mark-paid`, input);
  return json.deal as DealRecord;
}
