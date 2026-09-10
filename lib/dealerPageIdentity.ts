/**
 * Pulling the dealership's own identity out of a pasted VDP's HTML.
 *
 * The page is already fetched to find the VIN (see extractVinFromDealerPage),
 * and dealer sites almost always name themselves in it — schema.org JSON-LD
 * first, then og:site_name, then the <title>. That makes the dealership a free
 * signal: no MarketCheck call, no paid decode, no window sticker.
 *
 * Pure string parsing so it can be unit-tested against real page shapes.
 */

export interface DealerPageIdentity {
  name: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** Which layer produced the name — useful for judging how much to trust it. */
  source: "json_ld" | "og_site_name" | "title" | null;
}

export const EMPTY_DEALER_IDENTITY: DealerPageIdentity = {
  name: null,
  city: null,
  state: null,
  zip: null,
  source: null,
};

const DEALER_TYPES = new Set([
  "autodealer",
  "automotivebusiness",
  "autobodyshop",
  "localbusiness",
  "organization",
  "store",
]);

/** Marketing tails dealer sites append to their own name in <title> and og:site_name. */
const TITLE_NOISE =
  /\s*[|–—-]\s*(new (and|&) used.*|used cars.*|new cars.*|car dealer.*|dealership.*|serving.*|for sale.*|inventory.*|vehicle details.*|home)$/i;

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()
    .replace(TITLE_NOISE, "")
    .trim();
  if (name.length < 3 || name.length > 80) return null;
  // A page title that's really the car, not the seller.
  if (/^\d{4}\s/.test(name)) return null;
  return name;
}

function cleanPart(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const part = raw.replace(/\s+/g, " ").trim();
  return part.length > 0 && part.length <= 60 ? part : null;
}

/** Walks arbitrary JSON-LD (objects, arrays, @graph) for the first dealer-ish named node. */
function findDealerNode(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findDealerNode(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;

  const rawType = obj["@type"];
  const types = (Array.isArray(rawType) ? rawType : [rawType])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.toLowerCase().replace(/[^a-z]/g, ""));
  if (types.some((t) => DEALER_TYPES.has(t)) && cleanName(obj.name)) {
    return obj;
  }

  // Not a dealer node itself — a Vehicle's seller/offeredBy usually is.
  for (const key of ["seller", "offeredBy", "provider", "@graph", "subOrganization"]) {
    const found = findDealerNode(obj[key], depth + 1);
    if (found) return found;
  }
  if (obj.offers) {
    const found = findDealerNode(obj.offers, depth + 1);
    if (found) return found;
  }
  return null;
}

function identityFromJsonLd(html: string): DealerPageIdentity | null {
  const blocks = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  if (!blocks) return null;

  for (const block of blocks) {
    const body = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      continue; // Malformed JSON-LD is common; skip rather than fail the paste.
    }
    const node = findDealerNode(parsed);
    if (!node) continue;
    const name = cleanName(node.name);
    if (!name) continue;
    const address = (node.address || {}) as Record<string, unknown>;
    return {
      name,
      city: cleanPart(address.addressLocality),
      state: cleanPart(address.addressRegion)?.toUpperCase() || null,
      zip: cleanPart(address.postalCode),
      source: "json_ld",
    };
  }
  return null;
}

function metaContent(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function extractDealerIdentity(html: string): DealerPageIdentity {
  if (!html) return EMPTY_DEALER_IDENTITY;

  const fromJsonLd = identityFromJsonLd(html);
  if (fromJsonLd) return fromJsonLd;

  const siteName = cleanName(metaContent(html, "og:site_name"));
  if (siteName) {
    return { name: siteName, city: null, state: null, zip: null, source: "og_site_name" };
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const fromTitle = cleanName(title);
  if (fromTitle) {
    return { name: fromTitle, city: null, state: null, zip: null, source: "title" };
  }

  return EMPTY_DEALER_IDENTITY;
}
