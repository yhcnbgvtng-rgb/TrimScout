/**
 * The signed link in the "Your offer was accepted" email: {rfqId, inviteId, expiry} + HMAC-SHA256, bound to ONE dealer's invite
 * and to the purpose "reveal buyer contact". No stored token column and no login. It is deliberately not the invite's view token
 * (which never expires, sits in every earlier email and opens the whole quote page): this one opens exactly one page and one
 * button, for 30 days from the accepted-offer email. Same secret as the unsubscribe link (HMAC output never reveals the key),
 * with a domain-separation prefix so one kind of token can never verify as the other.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { serverSecret } from "./serverSecret";

export const REVEAL_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PURPOSE = "reveal-buyer-contact:v1";

export interface RevealTokenClaims { rfqId: string; inviteId: string; expiresAt: number }
export type RevealTokenResult = { ok: true; claims: RevealTokenClaims } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(`${PURPOSE}.${body}`).digest("base64url");
const secretFor = (secret?: string) => secret ?? serverSecret("LIGHTSAIL_API_KEY");

export function signRevealToken(rfqId: string, inviteId: string, now = Date.now(), secret?: string): string {
  const key = secretFor(secret);
  if (!key) throw new Error("no signing secret configured");
  const body = b64(JSON.stringify({ r: String(rfqId), i: String(inviteId), e: now + REVEAL_TOKEN_TTL_MS }));
  return `${body}.${sign(body, key)}`;
}

export function verifyRevealToken(token: unknown, now = Date.now(), secret?: string): RevealTokenResult {
  if (typeof token !== "string" || token.length > 400 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return { ok: false, reason: "malformed" };
  const key = secretFor(secret);
  if (!key) return { ok: false, reason: "bad_signature" };
  const [body, sig] = token.split(".");
  const expected = Buffer.from(sign(body, key));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad_signature" };
  let claims: { r?: unknown; i?: unknown; e?: unknown };
  try { claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  if (typeof claims.r !== "string" || typeof claims.i !== "string" || typeof claims.e !== "number") return { ok: false, reason: "malformed" };
  if (claims.e <= now) return { ok: false, reason: "expired" };
  return { ok: true, claims: { rfqId: claims.r, inviteId: claims.i, expiresAt: claims.e } };
}

export function revealUrl(token: string, base: string): string {
  return `${base}/quote-request/buyer-contact?t=${encodeURIComponent(token)}`;
}
