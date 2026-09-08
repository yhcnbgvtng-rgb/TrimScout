/**
 * Dealer-signup invite links — lets an admin send a specific dealership a
 * signup link that pre-fills and locks the "Dealership Name" field on
 * /signup, so an invited dealer can't fat-finger (or spoof) a different
 * dealership's name.
 *
 * Same shape as lib/dealerUnsubscribe.ts's one-click links: no login, no
 * separate token column — the link itself is {dealershipId,
 * HMAC-SHA256("dealer-signup:"+dealershipId, LIGHTSAIL_API_KEY)}. The
 * "dealer-signup:" prefix keeps this token namespace distinct from the
 * unsubscribe token's — otherwise the same dealershipId would produce an
 * identical token for two completely different, unrelated actions, and
 * either link could be replayed as the other.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { serverSecret } from "./serverSecret";

export const DEALER_SIGNUP_INVITE_BASE_URL = process.env.APP_BASE_URL || "https://www.trimscout.com";

export function dealerSignupInviteToken(dealershipId: string): string {
  const secret = serverSecret("LIGHTSAIL_API_KEY");
  return createHmac("sha256", secret).update(`dealer-signup:${dealershipId}`).digest("hex");
}

export function dealerSignupInviteUrl(dealershipId: string): string {
  const token = dealerSignupInviteToken(dealershipId);
  const params = new URLSearchParams({ dealerId: dealershipId, dealerToken: token });
  return `${DEALER_SIGNUP_INVITE_BASE_URL}/signup?${params.toString()}`;
}

export function verifyDealerSignupInviteToken(dealershipId: string, token: string): boolean {
  if (!dealershipId || !token) return false;
  const expected = dealerSignupInviteToken(dealershipId);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(token, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
