/**
 * Translates a buyer's free-text search ("black 4Runner under 40k with a moonroof near 07601")
 * into the same structured filters GET /api/vehicles/search already accepts — Gemini never sees
 * inventory rows or VINs, only the buyer's own text plus a compact slice of the catalog (makes/
 * options/colors that actually exist), so it can only pick from real values, not hallucinate a
 * make that isn't in TrimScout's inventory. The generic filter panel (PR 2) is the source of
 * truth either way: this only fills the same query params a buyer could type by hand, and the
 * /search page works with zero AI when Gemini is unconfigured or down (parseSearchQuery returns
 * null rather than throwing for "not configured").
 */
import { serverSecret, isGeminiEnabled } from "./serverSecret";

export class SearchParseError extends Error {}

const MAX_QUERY_CHARS = 500;

export interface ParsedSearchFilters {
  make: string | null;
  model: string | null;
  trim: string | null;
  priceMin: number | null;
  priceMax: number | null;
  yearMin: number | null;
  yearMax: number | null;
  odometerMax: number | null;
  minDays: number | null;
  maxDays: number | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  optionCodes: string[] | null;
  possibleDemo: boolean | null;
  zip: string | null;
  radiusMiles: number | null;
}

export interface ParsedSearch {
  filters: ParsedSearchFilters;
  /** 0-1 — how confident the model is that `filters` captures what the buyer meant. */
  confidence: number;
  /** Follow-up questions worth surfacing to the buyer when confidence is low or the text was ambiguous. */
  clarifications: string[];
  /** Editable chips for the UI — one per filter the model actually set, in the order to display them. */
  displayChips: Array<{ field: string; label: string }>;
}

/** The compact, real-values-only catalog slice Gemini is shown — never full inventory rows. */
export interface SearchCatalogSlice {
  makes: string[];
  models?: string[];
  optionCodes?: Array<{ code: string; label?: string | null }>;
  exteriorColors?: string[];
  interiorColors?: string[];
}

function safeJsonFromModelText(text: string): unknown {
  // Gemini, like Claude, sometimes wraps JSON in a code fence despite instructions not to.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  return JSON.parse(candidate);
}

function coerceParsedSearch(raw: unknown): ParsedSearch {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const f = (raw && typeof raw === "object" ? (obj.filters as Record<string, unknown>) : null) || {};
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  const codes = Array.isArray(f.optionCodes)
    ? f.optionCodes.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : null;

  const filters: ParsedSearchFilters = {
    make: str(f.make),
    model: str(f.model),
    trim: str(f.trim),
    priceMin: num(f.priceMin),
    priceMax: num(f.priceMax),
    yearMin: num(f.yearMin),
    yearMax: num(f.yearMax),
    odometerMax: num(f.odometerMax),
    minDays: num(f.minDays),
    maxDays: num(f.maxDays),
    exteriorColor: str(f.exteriorColor),
    interiorColor: str(f.interiorColor),
    optionCodes: codes && codes.length ? codes : null,
    possibleDemo: bool(f.possibleDemo),
    zip: str(f.zip),
    radiusMiles: num(f.radiusMiles),
  };

  const confidence = typeof obj.confidence === "number" && Number.isFinite(obj.confidence) ? Math.min(1, Math.max(0, obj.confidence)) : 0;
  const rawClarifications = Array.isArray(obj.clarifications) ? obj.clarifications.filter((c): c is string => typeof c === "string" && c.trim().length > 0) : [];
  // Backstop against the prompt alone: a clarification is only worth surfacing when the model
  // itself says it isn't confident. A model/make the shopper stated outright should never trigger
  // a "did you mean" or a filler question (color, ZIP) they never brought up — confirmed live,
  // "2024 bmw ix with bowers and wilkins" came back with exactly that kind of bogus clarification
  // despite make/model both being explicit in the text. At most one clarification ever reaches
  // the shopper, and only when the model itself signals genuine uncertainty.
  const clarifications = confidence < 0.6 ? rawClarifications.slice(0, 1) : [];
  const displayChips = Array.isArray(obj.displayChips)
    ? obj.displayChips
        .filter((c): c is { field: unknown; label: unknown } => !!c && typeof c === "object")
        .map((c) => ({ field: typeof c.field === "string" ? c.field : "", label: typeof c.label === "string" ? c.label : "" }))
        .filter((c) => c.field && c.label)
    : [];

  return { filters, confidence, clarifications, displayChips };
}

// Gemini's docs describe 503 UNAVAILABLE / 429 RESOURCE_EXHAUSTED as transient overload —
// "usually temporary," their own wording — confirmed live: the same query succeeded on one
// attempt and failed with an identical 503 on the next, seconds apart. A short retry with
// backoff turns a real, common intermittent failure into a slower-but-successful search for the
// shopper, instead of a search that fails outright roughly as often as it works on a busy model.
const GEMINI_RETRY_STATUSES = new Set([429, 503]);
const GEMINI_MAX_ATTEMPTS = 3;
const GEMINI_RETRY_DELAYS_MS = [300, 900];

async function fetchGeminiWithRetry(url: string, body: unknown): Promise<Response> {
  let lastRes: Response | undefined;
  for (let attempt = 0; attempt < GEMINI_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok || !GEMINI_RETRY_STATUSES.has(res.status)) return res;
    lastRes = res;
    const delay = GEMINI_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await new Promise((r) => setTimeout(r, delay));
  }
  return lastRes!;
}

/**
 * Returns null (not an error) when Gemini isn't configured (missing GEMINI_API_KEY or
 * GEMINI_MODEL) — callers should treat that as "AI search unavailable," not a failure of the
 * search itself; the generic filter panel keeps working either way.
 */
export async function parseSearchQuery(userText: string, catalog: SearchCatalogSlice): Promise<ParsedSearch | null> {
  if (!isGeminiEnabled()) return null;
  const apiKey = serverSecret("GEMINI_API_KEY");
  const model = serverSecret("GEMINI_MODEL");

  const text = userText.trim().slice(0, MAX_QUERY_CHARS);
  if (!text) throw new SearchParseError("Enter a search — the text box was empty.");

  const catalogSummary = JSON.stringify({
    makes: catalog.makes,
    models: catalog.models ?? [],
    optionCodes: (catalog.optionCodes ?? []).map((o) => (o.label ? `${o.code} (${o.label})` : o.code)),
    exteriorColors: catalog.exteriorColors ?? [],
    interiorColors: catalog.interiorColors ?? [],
  });

  const prompt =
    "You translate a car shopper's natural-language search into structured filters for TrimScout's " +
    "inventory search. Be assertive: when the shopper states a make, model, year, or option clearly, " +
    "set it and search — do not stop to ask a clarifying question just because a value isn't in the " +
    "catalog slice below or because some optional field (color, ZIP, etc.) wasn't mentioned.\n\n" +
    "CATALOG RULES — these differ by field, read carefully:\n" +
    "- make, optionCodes, exteriorColor, interiorColor: closed vocabularies. Only set these to a value " +
    "that appears in the catalog below — never invent one that isn't listed.\n" +
    "- model, trim: the catalog's model/option lists are NOT exhaustive — they only reflect what's " +
    "currently in stock, not every real model a manufacturer makes. If the shopper names a real model " +
    "(e.g. \"iX\", \"i4\", \"M3\", \"Model Y\") — even one that isn't in the catalog slice — set it " +
    "exactly as they said it, preserving exact spelling and capitalization (never \"correct\" iX to X, " +
    "i4 to 4, etc., and never drop a leading lowercase letter). A model missing from today's in-stock " +
    "catalog just means the search may return zero results — that is a perfectly fine, honest outcome. " +
    "It is never a reason to substitute a different model or to question the shopper's stated model.\n\n" +
    "CLARIFICATIONS — the default is none. Only include one (never more than one) when BOTH: " +
    "(a) your confidence is genuinely low, and (b) a field needed to run any reasonable search is " +
    "missing or ambiguous (e.g. \"a nice SUV\" with no make/model/price at all, or two very different " +
    "models could plausibly be meant). Never include a clarification that:\n" +
    "  - Questions or second-guesses a make/model/year the shopper already stated outright.\n" +
    "  - Says a model \"isn't in our catalog\" — irrelevant to the shopper, and often wrong (see above).\n" +
    "  - Asks about color, ZIP, radius, or any other field the shopper never brought up.\n\n" +
    "Return ONLY a JSON object (no prose, no code fence) with exactly these keys:\n" +
    '  "filters": {\n' +
    '    "make": string|null, "model": string|null, "trim": string|null,\n' +
    '    "priceMin": number|null, "priceMax": number|null,\n' +
    '    "yearMin": number|null, "yearMax": number|null,\n' +
    '    "odometerMax": number|null, "minDays": number|null, "maxDays": number|null,\n' +
    '    "exteriorColor": string|null, "interiorColor": string|null,\n' +
    '    "optionCodes": string[]|null,\n' +
    '    "possibleDemo": boolean|null,\n' +
    '    "zip": string|null, "radiusMiles": number|null\n' +
    "  },\n" +
    '  "confidence": number — 0 to 1, how confident you are this captures what the shopper meant. High ' +
    "(0.8+) whenever make/model/year/options are stated plainly, even if some are absent from the catalog slice.\n" +
    '  "clarifications": string[] — at most one entry, and only per the rules above (empty array otherwise).\n' +
    '  "displayChips": array of {"field": string, "label": string} — one per filter you actually set, a short human-readable label (e.g. {"field": "priceMax", "label": "Under $40,000"}, {"field": "model", "label": "iX"}).\n' +
    "A specific year mentioned once (e.g. \"2024\") means yearMin = yearMax = that year, unless the " +
    "shopper said \"or newer\"/\"or later\" (yearMin only) or \"or older\" (yearMax only). " +
    "For an option phrase, first try to match it to a real catalog option code (e.g. a brand name like " +
    "\"Bowers & Wilkins\" or \"B&W\" often corresponds to a premium-audio option code) — if nothing in " +
    "the catalog plausibly matches, just leave optionCodes null for that phrase rather than asking " +
    "about it or substituting an unrelated filter. Never guess a numeric value that wasn't stated or " +
    "clearly implied.\n\n" +
    "EXAMPLES:\n" +
    'Shopper: "2024 bmw ix with bowers and wilkins"\n' +
    'Correct: {"filters": {"make": "BMW", "model": "iX", "trim": null, "priceMin": null, "priceMax": null, ' +
    '"yearMin": 2024, "yearMax": 2024, "odometerMax": null, "minDays": null, "maxDays": null, ' +
    '"exteriorColor": null, "interiorColor": null, "optionCodes": null, "possibleDemo": null, "zip": null, ' +
    '"radiusMiles": null}, "confidence": 0.9, "clarifications": [], "displayChips": [{"field": "make", ' +
    '"label": "BMW"}, {"field": "model", "label": "iX"}, {"field": "yearMin", "label": "2024"}]} ' +
    "(model stays \"iX\" exactly as stated even if the catalog slice below has no BMW iX in stock right now — " +
    "never \"BMW X\", never a clarification about it.)\n" +
    'Shopper: "nice bmw suv under 60k"\n' +
    'Correct: {"filters": {"make": "BMW", "model": null, ..., "priceMax": 60000, ...}, "confidence": 0.5, ' +
    '"clarifications": ["Which BMW SUV — X1, X3, X5, X7, or another?"], "displayChips": [...]} ' +
    "(here a clarification is appropriate: no specific model was named and BMW makes several SUVs.)\n\n" +
    `Catalog (real values currently in stock — only make/optionCodes/colors are limited to this list; ` +
    `model/trim are NOT, see rules above):\n${catalogSummary}\n\n` +
    `Shopper's search:\n"""\n${text}\n"""`;

  const res = await fetchGeminiWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    { contents: [{ parts: [{ text: prompt }] }] }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 429/quota errors carry a `violations` array naming the specific quota metric and its limit
    // (e.g. which tier/model dimension was exceeded) further into the body than 300 chars — worth
    // keeping enough to actually diagnose a quota error, not just confirm one happened.
    throw new SearchParseError(`AI search request failed (${res.status}): ${body.slice(0, 1200)}`);
  }

  const json = await res.json();
  const modelText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof modelText !== "string" || !modelText.trim()) {
    throw new SearchParseError("AI search returned an empty response.");
  }

  let parsed: unknown;
  try {
    parsed = safeJsonFromModelText(modelText);
  } catch {
    throw new SearchParseError("Could not parse the AI's search response.");
  }

  return coerceParsedSearch(parsed);
}
