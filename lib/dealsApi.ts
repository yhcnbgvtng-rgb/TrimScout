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
  dealRequestId?: string;
  bidId?: string;
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

// ---------------------------------------------------------------------
// Reverse-auction deal requests / bids
// ---------------------------------------------------------------------

export interface DealRequestRecord {
  id: string;
  buyerUserId: string;
  strategy: "exact_auction" | "firm_offer" | "flexible_discount";
  referenceBrandCode: string;
  referenceVin: string;
  referenceYear: number | null;
  referenceMake: string;
  referenceModel: string;
  referenceTrim: string | null;
  referencePrice: number | null;
  referenceMsrp: number | null;
  referenceImageUrl: string | null;
  targetOtdPrice: number | null;
  targetDiscountPercent: number | null;
  paymentMethod: "all_three" | "cash" | "finance" | "lease";
  dealStructure: Record<string, unknown> | null;
  tradeIn: Record<string, unknown> | null;
  buyerZip: string;
  buyerState: string;
  searchRadiusMiles: number;
  sameStateOnly: boolean;
  buyerComment: string | null;
  status: "active" | "locked" | "expired" | "cancelled";
  createdAt: string;
  expiresAt: string;
}

export interface DealBidRecord {
  id: string;
  dealRequestId: string;
  dealerUserId: string;
  dealerName: string;
  dealerCity: string | null;
  dealerState: string | null;
  distanceMiles: number | null;
  matchedVin: string;
  matchedVehicleTitle: string;
  matchedVehicleSpec: string | null;
  matchedVehicleImageUrl: string | null;
  vehicleStatus: string | null;
  msrp: number;
  dealerDiscountDollars: number;
  dealerDiscountPercent: number;
  manufacturerRebates: number;
  sellingPrice: number;
  salesTax: number;
  dmvFees: number;
  docFee: number;
  dealerAccessories: number;
  tradeInAllowance: number | null;
  totalOtdPrice: number;
  quotedOtdPrice: number;
  netOtdWithTradeIn: number | null;
  financeMonthlyEstimate: number | null;
  leaseMonthlyEstimate: number | null;
  notes: string;
  rank: number | null;
  createdAt: string;
  isTopDeal: boolean;
  status: "active" | "accepted" | "expired" | "withdrawn";
  salesRep: { name: string; title: string; phone: string } | null;
}

export interface DealerWonDeal {
  bid: DealBidRecord;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string | null;
}

export async function createDealRequest(input: {
  buyerUserId: string;
  strategy: string;
  referenceBrandCode: string;
  referenceVin: string;
  referenceYear?: number | null;
  referenceMake: string;
  referenceModel: string;
  referenceTrim?: string | null;
  referencePrice?: number | null;
  referenceMsrp?: number | null;
  referenceImageUrl?: string | null;
  targetOtdPrice?: number | null;
  targetDiscountPercent?: number | null;
  paymentMethod: string;
  dealStructure?: Record<string, unknown> | null;
  tradeIn?: Record<string, unknown> | null;
  buyerZip: string;
  buyerState: string;
  searchRadiusMiles?: number;
  sameStateOnly?: boolean;
  buyerComment?: string;
}): Promise<DealRequestRecord> {
  const json = await request("POST", "/api/deal-requests", input);
  return json.dealRequest as DealRequestRecord;
}

export async function getDealRequest(id: string): Promise<DealRequestRecord | null> {
  try {
    const json = await request("GET", `/api/deal-requests/${id}`);
    return json.dealRequest as DealRequestRecord;
  } catch (err) {
    if (err instanceof DealsApiError && err.status === 404) return null;
    throw err;
  }
}

// Server-to-server only — never call this from a route a browser can hit
// directly (it returns every active request, with no per-request
// ownership check).
export async function listActiveDealRequests(): Promise<DealRequestRecord[]> {
  const json = await request("GET", "/api/deal-requests?status=active");
  return json.dealRequests as DealRequestRecord[];
}

export async function listDealRequestsForBuyer(buyerUserId: string): Promise<DealRequestRecord[]> {
  const json = await request(
    "GET",
    `/api/deal-requests?buyerUserId=${encodeURIComponent(buyerUserId)}`
  );
  return json.dealRequests as DealRequestRecord[];
}

export async function expireDealRequest(id: string): Promise<void> {
  await request("POST", `/api/deal-requests/${id}/expire`);
}

export async function submitDealerBid(
  dealRequestId: string,
  input: Record<string, unknown>
): Promise<DealBidRecord> {
  const json = await request("POST", `/api/deal-requests/${dealRequestId}/bids`, input);
  return json.bid as DealBidRecord;
}

export async function listBidsForRequest(dealRequestId: string): Promise<DealBidRecord[]> {
  const json = await request("GET", `/api/deal-requests/${dealRequestId}/bids`);
  return json.bids as DealBidRecord[];
}

// Server-to-server only — full/unmasked single bid, used by
// checkout/create-session to fetch authoritative data rather than trust
// whatever the browser sent.
export async function getSingleBid(dealRequestId: string, bidId: string): Promise<DealBidRecord | null> {
  try {
    const json = await request("GET", `/api/deal-requests/${dealRequestId}/bids/${bidId}`);
    return json.bid as DealBidRecord;
  } catch (err) {
    if (err instanceof DealsApiError && err.status === 404) return null;
    throw err;
  }
}

export async function listBidsForDealer(dealerUserId: string): Promise<DealBidRecord[]> {
  const json = await request("GET", `/api/dealer-bids?dealerUserId=${dealerUserId}`);
  return json.bids as DealBidRecord[];
}

export async function listWonDealsForDealer(dealerUserId: string): Promise<DealerWonDeal[]> {
  const json = await request("GET", `/api/dealer-won-deals?dealerUserId=${dealerUserId}`);
  return json.wonDeals as DealerWonDeal[];
}
