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
  source: "json_ld" | "og_site_name" | "dealer_name_element" | "logo" | "meta_description" | "title" | null;
}

export const EMPTY_DEALER_IDENTITY: DealerPageIdentity = {
  name: null,
  city: null,
  state: null,
  zip: null,
  source: null,
};

/**
 * Signatures of the pages a bot-shield serves instead of the listing. A
 * server-side fetch of a dealer VDP regularly lands on one of these, and a
 * challenge page has a perfectly good <title> — "Attention Required! |
 * Cloudflare" was shown to a buyer as the name of their dealership before this
 * existed. Nothing on such a page is about the car or the seller.
 */
const BLOCK_PAGE_SIGNATURES = [
  /attention required!?\s*\|\s*cloudflare/i,
  /cf-browser-verification|cf-challenge|challenge-platform|cf_chl_/i,
  /just a moment\.{0,3}<\/title>/i,
  /<title>[^<]*\b(access denied|forbidden|request blocked|error \d{3})\b[^<]*<\/title>/i,
  /errors\.edgesuite\.net|akamai/i,
  /reference\s+#\s*[0-9a-f.]+/i,
  /perimeterx|_pxhd|px-captcha/i,
  /datadome|dd\.js|captcha-delivery/i,
  /incapsula|_incap_/i,
  /distil_r_captcha|distilnetworks/i,
];

/** True when the HTML is a bot-shield or error page rather than the listing. */
export function isBlockPage(html: string, httpStatus?: number): boolean {
  if (typeof httpStatus === "number" && (httpStatus === 403 || httpStatus === 429 || httpStatus === 503)) {
    return true;
  }
  if (!html) return false;
  const head = html.slice(0, 20_000);
  return BLOCK_PAGE_SIGNATURES.some((re) => re.test(head));
}

/**
 * Names that a block or error page would produce — refused even if the block
 * detection above somehow missed the page. Defence in depth for the one field
 * a buyer will read as "this is my dealer".
 */
const NON_DEALER_NAMES =
  /\b(cloudflare|akamai|attention required|access denied|forbidden|just a moment|error|not found|captcha|verification|security check|blocked|unavailable)\b/i;

/** Types that name a dealership wherever they appear in the JSON-LD. */
const DEALER_TYPES = new Set(["autodealer", "automotivebusiness", "autobodyshop"]);
/**
 * Types that name a dealership only when reached through a selling relation
 * (seller / offeredBy / provider). A Vehicle's `manufacturer` is an Organization
 * too, and accepting it at the top level would report "BMW" as the dealer.
 */
const DEALER_TYPES_VIA_SELLER = new Set(["localbusiness", "organization", "store"]);

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
  if (NON_DEALER_NAMES.test(name)) return null;
  return name;
}

function cleanPart(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const part = raw.replace(/\s+/g, " ").trim();
  return part.length > 0 && part.length <= 60 ? part : null;
}

/** Walks arbitrary JSON-LD (objects, arrays, @graph) for the first dealer-ish named node. */
function findDealerNode(node: unknown, depth = 0, viaSeller = false): Record<string, unknown> | null {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findDealerNode(entry, depth + 1, viaSeller);
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
  const isDealer =
    types.some((t) => DEALER_TYPES.has(t)) ||
    (viaSeller && types.some((t) => DEALER_TYPES_VIA_SELLER.has(t)));
  if (isDealer && cleanName(obj.name)) {
    return obj;
  }

  // Not a dealer node itself — a Vehicle's seller/offeredBy usually is.
  for (const key of ["seller", "offeredBy", "provider"]) {
    const found = findDealerNode(obj[key], depth + 1, true);
    if (found) return found;
  }
  for (const key of ["@graph", "subOrganization", "offers"]) {
    const found = findDealerNode(obj[key], depth + 1, viaSeller);
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

const NO_LOCATION = { city: null, state: null } as const;

/**
 * "in Rockford, IL at …" → { city, state }. Anchored on the word "in" (or
 * "near"/"serving") so it can't swallow the dealer's own name — a bare
 * "<Words>, ST" match on "Bachrodt BMW Rockford, IL" reads the city as
 * "Bachrodt BMW Rockford".
 */
function cityStateFromProse(text: string | null | undefined): { city: string | null; state: string | null } {
  const m = (text || "").match(/\b(?:in|near|serving)\s+([A-Z][A-Za-z.'\-]*(?:\s[A-Z][A-Za-z.'\-]*){0,3}),\s*([A-Z]{2})\b/);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : NO_LOCATION;
}

/** A string that is *only* "City, ST" (what's left of a logo alt once the name is removed). */
function cityStateExact(text: string | null | undefined): { city: string | null; state: string | null } {
  const m = (text || "").trim().match(/^([A-Z][A-Za-z.'\-]*(?:\s[A-Z][A-Za-z.'\-]*){0,3}),\s*([A-Z]{2})$/);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : NO_LOCATION;
}

function stripTags(fragment: string): string {
  return fragment.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Dealer.com / DealerOn templates print the rooftop's name in an element
 * literally classed "dealerName", usually as "Welcome to <name>".
 */
function identityFromDealerNameElement(html: string): DealerPageIdentity | null {
  // Capture through to the block-level close, not the first close of any
  // kind — the name usually sits after an inline <span>Welcome to</span>.
  const m = html.match(/class=["'][^"']*\bdealerName\b[^"']*["'][^>]*>([\s\S]{0,400}?)<\/(li|div|h\d|header|section)>/i);
  if (!m) return null;
  const text = stripTags(m[1]).replace(/^welcome to\s+/i, "");
  const name = cleanName(text);
  return name ? { name, city: null, state: null, zip: null, source: "dealer_name_element" } : null;
}

/**
 * The site logo's alt/title is the dealer's own name, and on many templates the
 * alt carries the city and state too: alt="Bachrodt BMW Rockford, IL".
 */
function identityFromLogo(html: string): DealerPageIdentity | null {
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/logo/i.test(tag)) continue;
    const title = (tag.match(/\btitle=["']([^"']+)["']/i)?.[1] || "").trim();
    const alt = (tag.match(/\balt=["']([^"']+)["']/i)?.[1] || "").trim();

    // With a title, the alt's remainder after it is the location: title
    // "Bachrodt BMW", alt "Bachrodt BMW Rockford, IL" → "Rockford, IL".
    if (cleanName(title)) {
      const rest = alt.toLowerCase().startsWith(title.toLowerCase()) ? alt.slice(title.length).trim() : "";
      const { city, state } = cityStateExact(rest);
      return { name: cleanName(title)!, city, state, zip: null, source: "logo" };
    }

    // Alt only: "<name> <city>, ST" can't be split reliably — a dealer really
    // can be named "Prestige Volvo Cars East Hanover" — so keep the whole
    // thing as the name, drop only the ", ST", and take the state.
    const stateMatch = alt.match(/,\s*([A-Z]{2})$/);
    const name = cleanName(stateMatch ? alt.slice(0, stateMatch.index) : alt);
    if (!name) continue;
    return { name, city: null, state: stateMatch ? stateMatch[1] : null, zip: null, source: "logo" };
  }
  return null;
}

/** "Research the 2026 BMW X3 in Rockford, IL at Bachrodt BMW. View pictures…" */
function identityFromMetaDescription(html: string): DealerPageIdentity | null {
  const description =
    metaContent(html, "og:description") ||
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    null;
  if (!description) return null;
  const m = description.match(/\bat\s+([A-Z][^.,!?]{2,60}?)(?:[.,!?]|\s+(?:in|near)\b|$)/);
  const name = cleanName(m?.[1]);
  if (!name) return null;
  const { city, state } = cityStateFromProse(description);
  return { name, city, state, zip: null, source: "meta_description" };
}

export function extractDealerIdentity(html: string, httpStatus?: number): DealerPageIdentity {
  if (!html) return EMPTY_DEALER_IDENTITY;
  // A challenge page names Cloudflare, not the dealership.
  if (isBlockPage(html, httpStatus)) return EMPTY_DEALER_IDENTITY;

  const fromJsonLd = identityFromJsonLd(html);
  if (fromJsonLd) return fromJsonLd;

  const siteName = cleanName(metaContent(html, "og:site_name"));
  if (siteName) {
    return { name: siteName, city: null, state: null, zip: null, source: "og_site_name" };
  }

  // Template conventions, in order of how directly they name the rooftop. A
  // name from one of these can still borrow a city/state that only the meta
  // description mentions.
  const fromElement = identityFromDealerNameElement(html);
  const fromLogo = identityFromLogo(html);
  const fromDescription = identityFromMetaDescription(html);
  const primary = fromElement || fromLogo || fromDescription;
  if (primary) {
    const location = [fromLogo, fromDescription].find((c) => c?.city && c?.state);
    return {
      ...primary,
      city: primary.city || location?.city || null,
      state: primary.state || location?.state || null,
    };
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const fromTitle = cleanName(title);
  if (fromTitle) {
    return { name: fromTitle, city: null, state: null, zip: null, source: "title" };
  }

  return EMPTY_DEALER_IDENTITY;
}
