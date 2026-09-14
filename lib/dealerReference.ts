/**
 * The number a dealer sees on a quote request — never the buyer's own deal
 * number (TS-XXXXXX), and different on every request they receive, so two
 * requests can't be tied to one buyer and a dealer can't quote the buyer's
 * number back to another store. Keyed per invite (request + desk), so the
 * same desk sees the same number across the invite's own follow-ups
 * (buyer counter, reminder) and a different one on any other request.
 *
 * Server-only: an HMAC of the invite over the box API secret, so it can't
 * be derived from anything the dealer or buyer holds.
 */
import { createHmac } from "node:crypto";
import { serverSecret } from "./serverSecret";

export const DEALER_REFERENCE_PREFIX = "TQ-";
// No 0/O/1/I — same alphabet as the buyer's deal number, different prefix.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const DEALER_REFERENCE_PATTERN = /^TQ-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function dealerReference(rfqId: string, inviteId: string, secret: string = serverSecret("LIGHTSAIL_API_KEY") || "trimscout"): string {
  const mac = createHmac("sha256", secret).update(`dealer-ref:${rfqId}:${inviteId}`).digest();
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[mac[i] % ALPHABET.length];
  return `${DEALER_REFERENCE_PREFIX}${out}`;
}
