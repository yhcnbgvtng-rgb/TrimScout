import { env } from "node:process";

/**
 * Read a server env var from Node's real environment.
 *
 * Next.js webpack/turbopack often replaces `process.env` with an object of
 * only statically referenced keys, so `process.env[name]` is empty in the
 * bundled function. `env` from `node:process` is not rewritten that way.
 * Static `process.env.NAME` fallbacks keep listings key names on Next's
 * env allowlist / DefinePlugin. These keys stay server-only.
 */
/**
 * v1 ships with no MarketCheck integration. The key is withheld from every
 * caller unless MARKETCHECK_ENABLED=true is set explicitly, so a stray
 * budget or provider setting can never turn paid calls on by itself — each
 * fetcher already treats "no key" as unavailable.
 */
export function isMarketCheckEnabled(): boolean {
  const raw = String(env.MARKETCHECK_ENABLED || process.env.MARKETCHECK_ENABLED || "").trim();
  return /^(1|true|yes|on)$/i.test(raw);
}

export function serverSecret(name: string): string {
  if (name === "MARKETCHECK_API_KEY") {
    if (!isMarketCheckEnabled()) return "";
    return String(env.MARKETCHECK_API_KEY || process.env.MARKETCHECK_API_KEY || "").trim();
  }
  if (name === "LISTINGS_PROVIDER") {
    return String(env.LISTINGS_PROVIDER || process.env.LISTINGS_PROVIDER || "").trim();
  }
  if (name === "LIGHTSAIL_API_KEY") {
    return String(env.LIGHTSAIL_API_KEY || process.env.LIGHTSAIL_API_KEY || "").trim();
  }
  if (name === "RESEND_API_KEY") {
    return String(env.RESEND_API_KEY || process.env.RESEND_API_KEY || "").trim();
  }
  return String(env[name] ?? "").trim();
}
