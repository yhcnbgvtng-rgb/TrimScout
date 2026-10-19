/**
 * Who may read what from /api/lightsail.
 *
 * The route used to hand the whole crawled inventory (every VIN, dealer,
 * price history) to anyone, unauthenticated and unthrottled. Now:
 *   - "full": an admin session, or a request carrying the server-side secret
 *     header (LIGHTSAIL_DUMP_SECRET). Only this tier gets the bare/summary
 *     dump and page sizes up to FULL_PAGE_SIZE_MAX.
 *   - "public": everyone else. Vehicle pages are capped at
 *     PUBLIC_PAGE_SIZE_MAX rows and can't be walked past PUBLIC_MAX_WINDOW
 *     rows deep, so a scraper can't page out the table.
 */
import { timingSafeEqual } from "node:crypto";

export const PUBLIC_PAGE_SIZE_DEFAULT = 25;
export const PUBLIC_PAGE_SIZE_MAX = 50;
/** Deepest row a public caller can reach: page * pageSize must stay within this. */
export const PUBLIC_MAX_WINDOW = 500;
export const FULL_PAGE_SIZE_MAX = 200;
export const LIGHTSAIL_SECRET_HEADER = "x-trimscout-internal-key";

export type LightsailAccess = "full" | "public";

/** Constant-time compare; an unset/blank expected secret never matches. */
export function secretMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  const exp = (expected || "").trim();
  const got = (provided || "").trim();
  if (!exp || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(exp);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hasDumpSecret(headers: Headers, expected: string | undefined = process.env.LIGHTSAIL_DUMP_SECRET): boolean {
  return secretMatches(headers.get(LIGHTSAIL_SECRET_HEADER), expected);
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw || "", 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

export type PublicWindow = { ok: true; page: number; pageSize: number } | { ok: false; error: string };

/** Clamp a public caller's page/pageSize, or refuse a page beyond the window. */
export function publicVehicleWindow(params: Record<string, string>): PublicWindow {
  const pageSize = Math.min(PUBLIC_PAGE_SIZE_MAX, positiveInt(params.pageSize, PUBLIC_PAGE_SIZE_DEFAULT));
  const page = positiveInt(params.page, 1);
  if (page * pageSize > PUBLIC_MAX_WINDOW) {
    return { ok: false, error: `Results beyond the first ${PUBLIC_MAX_WINDOW} are not available here. Narrow your filters.` };
  }
  return { ok: true, page, pageSize };
}

/** Full-access callers keep the old behaviour: default 50, hard max 200. */
export function fullPageSize(raw: string | undefined): number {
  return Math.min(FULL_PAGE_SIZE_MAX, positiveInt(raw, 50));
}
