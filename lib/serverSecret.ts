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
export function serverSecret(name: string): string {
  if (name === "MARKETCHECK_API_KEY") {
    return String(env.MARKETCHECK_API_KEY || process.env.MARKETCHECK_API_KEY || "").trim();
  }
  if (name === "LISTINGS_PROVIDER") {
    return String(env.LISTINGS_PROVIDER || process.env.LISTINGS_PROVIDER || "").trim();
  }
  return String(env[name] ?? "").trim();
}
