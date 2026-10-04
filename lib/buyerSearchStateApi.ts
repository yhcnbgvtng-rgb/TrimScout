/**
 * A signed-in buyer's search picks + viewed marks, stored on the deals box (buyer_search_state, one row per user).
 * Server-only (API key). The box endpoint is added by scripts/box/2026-10-04-buyer-search-state.sh; until that runs the
 * box answers 404 and callers (app/api/buyer/search-state) report 503 so the page falls back to browser storage.
 */
import { LIGHTSAIL_HOST } from "./lightsailClient";
import { serverSecret } from "./serverSecret";
import { sanitizeState, type BuyerSearchState } from "./buyerPicks";

const DEALS_API_PORT = 3004;
const TIMEOUT_MS = 10_000;

export class BuyerSearchStateError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function call(method: "GET" | "PUT", path: string, body?: unknown): Promise<unknown> {
  const apiKey = serverSecret("LIGHTSAIL_API_KEY");
  if (!apiKey) throw new BuyerSearchStateError("Search state backend is not configured", 500);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`http://${LIGHTSAIL_HOST}:${DEALS_API_PORT}${path}`, {
      method, headers: { "Content-Type": "application/json", "X-Trimscout-Api-Key": apiKey }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new BuyerSearchStateError((json && json.error) || `Search state service error (${res.status})`, res.status);
    return json;
  } catch (err) {
    if (err instanceof BuyerSearchStateError) throw err;
    throw new BuyerSearchStateError("Could not reach the search state service", 503);
  } finally {
    clearTimeout(t);
  }
}

export async function getBuyerSearchState(userId: string): Promise<BuyerSearchState> {
  return sanitizeState(await call("GET", `/api/buyer-search-state?userId=${encodeURIComponent(userId)}`));
}

/** Sends only the parts given; the box leaves the other part as stored. */
export async function putBuyerSearchState(userId: string, part: Partial<BuyerSearchState>): Promise<void> {
  await call("PUT", "/api/buyer-search-state", { userId, ...(part.picks ? { picks: part.picks } : {}), ...(part.viewed ? { viewed: part.viewed } : {}) });
}
