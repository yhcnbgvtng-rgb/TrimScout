/**
 * One-click dealer email unsubscribe — shared by the email builder (which
 * signs a link) and the public unsubscribe route (which verifies it).
 *
 * No login, no separate token column: the link itself is
 * {dealershipId, HMAC-SHA256(dealershipId, LIGHTSAIL_API_KEY)}. Reusing
 * LIGHTSAIL_API_KEY as the signing secret is safe — HMAC output never
 * reveals the key — and avoids asking for yet another env var just for
 * this. A forged id/token pair can't verify without that secret.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { serverSecret } from "./serverSecret";

export const DEALER_EMAIL_BASE_URL = process.env.APP_BASE_URL || "https://www.trimscout.com";

export function unsubscribeTokenFor(dealershipId: string): string {
  const secret = serverSecret("LIGHTSAIL_API_KEY");
  return createHmac("sha256", secret).update(dealershipId).digest("hex");
}

export function unsubscribeUrlFor(dealershipId: string): string {
  const token = unsubscribeTokenFor(dealershipId);
  const params = new URLSearchParams({ id: dealershipId, token });
  return `${DEALER_EMAIL_BASE_URL}/api/dealer-unsubscribe?${params.toString()}`;
}

export function verifyUnsubscribeToken(dealershipId: string, token: string): boolean {
  if (!dealershipId || !token) return false;
  const expected = unsubscribeTokenFor(dealershipId);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(token, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
