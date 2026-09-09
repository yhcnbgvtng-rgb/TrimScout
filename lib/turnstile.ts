/**
 * Cloudflare Turnstile server-side verification — bot protection on
 * account creation. The widget itself (components/SignupView.tsx) is only
 * a UX nicety; a bot can skip the browser entirely and POST straight to
 * /api/auth/signup, so the token is meaningless until this check runs.
 */

import { serverSecret } from "./serverSecret";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Returns true when the token is verified. Also returns true (with a
 * console.warn) when TURNSTILE_SECRET_KEY isn't configured — matches this
 * codebase's convention elsewhere (RESEND_API_KEY, MARKETCHECK_API_KEY) of
 * degrading gracefully rather than breaking the core flow when an optional
 * third-party service isn't set up. The warning is deliberately loud
 * because unlike a missing email, a silently-unconfigured bot check leaves
 * signup wide open with nothing visibly broken to notice.
 */
export async function verifyTurnstileToken(token: string | undefined | null, remoteIp?: string): Promise<boolean> {
  const secret = serverSecret("TURNSTILE_SECRET_KEY");
  if (!secret) {
    console.warn("turnstile: TURNSTILE_SECRET_KEY not set — skipping bot-protection check on signup.");
    return true;
  }
  if (!token) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch (err) {
    console.error("turnstile: verification request failed —", err instanceof Error ? err.message : err);
    return false;
  }
}
