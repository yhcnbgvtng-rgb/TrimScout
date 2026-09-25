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
  const clarifications = Array.isArray(obj.clarifications) ? obj.clarifications.filter((c): c is string => typeof c === "string" && c.trim().length > 0) : [];
  const displayChips = Array.isArray(obj.displayChips)
    ? obj.displayChips
        .filter((c): c is { field: unknown; label: unknown } => !!c && typeof c === "object")
        .map((c) => ({ field: typeof c.field === "string" ? c.field : "", label: typeof c.label === "string" ? c.label : "" }))
        .filter((c) => c.field && c.label)
    : [];

  return { filters, confidence, clarifications, displayChips };
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
    "inventory search. Only use values that appear in the catalog below — never invent a make, model, " +
    "option code, or color that isn't listed there. Return ONLY a JSON object (no prose, no code fence) " +
    "with exactly these keys:\n" +
    '  "filters": {\n' +
    '    "make": string|null, "model": string|null, "trim": string|null,\n' +
    '    "priceMin": number|null, "priceMax": number|null,\n' +
    '    "odometerMax": number|null, "minDays": number|null, "maxDays": number|null,\n' +
    '    "exteriorColor": string|null, "interiorColor": string|null,\n' +
    '    "optionCodes": string[]|null,\n' +
    '    "possibleDemo": boolean|null,\n' +
    '    "zip": string|null, "radiusMiles": number|null\n' +
    "  },\n" +
    '  "confidence": number — 0 to 1, how confident you are this captures what the shopper meant.\n' +
    '  "clarifications": string[] — follow-up questions worth asking if the text was ambiguous (empty array if none).\n' +
    '  "displayChips": array of {"field": string, "label": string} — one per filter you actually set, a short human-readable label (e.g. {"field": "priceMax", "label": "Under $40,000"}).\n' +
    "Use null for any filter you can't confidently determine from the text. Never guess a numeric value that wasn't stated or clearly implied.\n\n" +
    `Catalog (only real values — pick from these, never invent others):\n${catalogSummary}\n\n` +
    `Shopper's search:\n"""\n${text}\n"""`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SearchParseError(`AI search request failed (${res.status}): ${body.slice(0, 300)}`);
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
