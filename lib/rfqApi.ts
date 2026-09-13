// Client for the RFQ ("invite dealers to quote") endpoints on the box's
// existing deals API (port 3004, same process as deal_requests/deal_bids
// — see scrapers/lightsail-crawler/src/deals_api_server.js). Same
// request/error pattern as lib/dealsApi.ts.
import { LIGHTSAIL_HOST } from "./lightsailClient";
import type { LeaseQuote, LeaseRequestPrefs } from "./leaseQuote";
import { serverSecret } from "./serverSecret";
import type { RfqDeclineReason, RfqInvite, RfqQuoteFee, RfqRequest } from "./rfq";

const DEALS_API_PORT = 3004;
const DEFAULT_TIMEOUT_MS = 8000;

export class RfqApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  const apiKey = serverSecret("LIGHTSAIL_API_KEY");
  if (!apiKey) {
    throw new RfqApiError("RFQ backend is not configured (missing LIGHTSAIL_API_KEY)", 500);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`http://${LIGHTSAIL_HOST}:${DEALS_API_PORT}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Trimscout-Api-Key": apiKey,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    throw new RfqApiError(
      err instanceof Error && err.name === "AbortError" ? "RFQ request timed out" : "Could not reach RFQ service",
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
    throw new RfqApiError(json?.error || `RFQ request failed (${res.status})`, res.status);
  }
  return json;
}

export async function createRfq(input: {
  buyerUserId: string;
  vin: string;
  stockNumber?: string | null;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  vehicleTrim: string;
  mustHaves: { code: string; name: string; status: "hit" }[];
  packageKind?: "match" | "links";
  linkPastes?: Array<Record<string, unknown>>;
  dealReference?: string | null;
  leasePrefs?: LeaseRequestPrefs | null;
}): Promise<RfqRequest> {
  const json = await request("POST", "/api/rfqs", input);
  return json.rfq as RfqRequest;
}

export async function getRfq(id: string): Promise<RfqRequest | null> {
  try {
    const json = await request("GET", `/api/rfqs/${id}`);
    return json.rfq as RfqRequest;
  } catch (err) {
    if (err instanceof RfqApiError && err.status === 404) return null;
    throw err;
  }
}

export async function listRfqsForBuyer(buyerUserId: string): Promise<RfqRequest[]> {
  const json = await request("GET", `/api/rfqs?buyerUserId=${encodeURIComponent(buyerUserId)}`);
  return json.rfqs as RfqRequest[];
}

export async function createRfqInvite(
  rfqId: string,
  input: {
    dealerName: string;
    dealerContactEmail?: string | null;
    desk?: { contactName: string; role: string; emailMasked: string; source: "directory" | "buyer" };
    vehicle?: { vin: string; year: number; make: string; model: string; trim: string; vdpUrl: string | null };
  }
): Promise<RfqInvite> {
  const json = await request("POST", `/api/rfqs/${rfqId}/invites`, input);
  return json.invite as RfqInvite;
}

/** Advances an invite's delivery leg. The box logs the matching audit event. */
export async function markRfqInviteDelivery(
  rfqId: string,
  inviteId: string,
  status: "sent" | "viewed"
): Promise<RfqInvite> {
  const json = await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/delivery`, { status });
  return json.invite as RfqInvite;
}

/** Resolves a tracked-link token to its invite, for the "viewed" event. */
export async function getRfqInviteByViewToken(token: string): Promise<{ rfqId: string; invite: RfqInvite } | null> {
  try {
    const json = await request("GET", `/api/rfq-invites/by-token/${encodeURIComponent(token)}`);
    return { rfqId: String(json.rfqId), invite: json.invite as RfqInvite };
  } catch (err) {
    if (err instanceof RfqApiError && err.status === 404) return null;
    throw err;
  }
}

export async function declineRfqInvite(
  rfqId: string,
  inviteId: string,
  declineReason: RfqDeclineReason
): Promise<RfqInvite> {
  const json = await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/decline`, { declineReason });
  return json.invite as RfqInvite;
}

export async function submitRfqQuote(
  rfqId: string,
  inviteId: string,
  input: {
    price: number;
    fees: RfqQuoteFee[];
    vin: string;
    stockNumber?: string | null;
    expiresAt: string;
    mustHaveAcknowledgement: boolean;
    notes?: string | null;
    /** The validated lease calculator; stored whole on the box. */
    lease?: LeaseQuote | null;
  }
): Promise<void> {
  // The box returns the created quote alone; callers that need the
  // invite's refreshed status ("quoted") re-fetch the whole RFQ via
  // getRfq rather than reason about a partial shape here.
  await request("POST", `/api/rfqs/${rfqId}/invites/${inviteId}/quotes`, input);
}

export async function pickRfqQuote(rfqId: string, quoteId: string): Promise<RfqRequest> {
  const json = await request("POST", `/api/rfqs/${rfqId}/pick`, { quoteId });
  return json.rfq as RfqRequest;
}

export async function walkAwayFromRfq(rfqId: string): Promise<RfqRequest> {
  const json = await request("POST", `/api/rfqs/${rfqId}/walk`);
  return json.rfq as RfqRequest;
}
