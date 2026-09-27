import { NextResponse } from "next/server";
import { inventoryMakes, allCatalogOptions, InventoryApiError, type GlobalCatalogOptions } from "@/lib/inventoryApi";
import { parseSearchQuery, SearchParseError } from "@/lib/searchParse";
import { isGeminiEnabled } from "@/lib/serverSecret";
import { parseBuyerSearchParams, parsedSearchFiltersToParams } from "@/lib/buyerSearchQuery";
import { runBuyerSearch } from "@/lib/buyerSearch";

export const dynamic = "force-dynamic";
// Without this, the route falls back to Vercel's own platform-level function duration limit —
// confirmed live 2026-09-26 that it's well under the 60s AbortController lib/inventoryApi.ts
// already uses to time out the box call gracefully: a query slow enough to approach that budget
// (e.g. make+model+trim+zip+radius with no color/options, which still requires a full Gemini
// parse round trip plus the box call) got killed by the PLATFORM at a near-constant ~24-26s
// across three separate reproductions, with zero application-level logs at any level — meaning
// the whole function process was terminated externally, before our own try/catch, the box's own
// 20s max_statement_time cap, or lib/inventoryApi.ts's 60s abort ever got a chance to run. That
// turned a case our own code is built to handle gracefully (a clean 503 "Inventory request timed
// out") into an opaque, unlogged 502 "Internal server error" instead. 90s gives lib/inventoryApi's
// own 60s budget room to always resolve first.
export const maxDuration = 90;

/**
 * POST /api/search/parse { q: string, zip?: string } — the buyer /search page's NL box. Calls
 * Gemini to translate `q` into filters (never sending it inventory data, only the catalog's real
 * make/option/color values), then runs the exact same deterministic search PR 2's generic filter
 * panel uses. Returns { available: false } (200, not an error) when Gemini isn't configured —
 * the page's filter panel keeps working either way.
 */
export async function POST(req: Request) {
  let body: { q?: unknown; zip?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a 'q' field." }, { status: 400 });
  }
  const q = typeof body.q === "string" ? body.q.trim() : "";
  if (!q) return NextResponse.json({ error: "q is required." }, { status: 400 });
  const defaultZip = typeof body.zip === "string" ? body.zip.trim() : undefined;

  // Checked before touching the box at all — when Gemini isn't configured, there's no point
  // paying for a makes/catalog round trip just to immediately report "not configured".
  if (!isGeminiEnabled()) {
    return NextResponse.json({ available: false, message: "AI search is not configured — use the filters below instead." });
  }

  try {
    // allCatalogOptions() (NOT catalogOptions()) — confirmed live 2026-09-27: catalogOptions()
    // with no make/model/trim forced a nationwide STRAIGHT_JOIN across dealer_inventory (every
    // brand) and dealer_inventory_options on every single AI search request, continuously hitting
    // the 20s statement timeout all day. allCatalogOptions() is a join-free nationwide option/color
    // list purpose-built for this Gemini-context use, which only ever reads {key, label} anyway.
    //
    // Even join-free, this is STILL slow right now (confirmed live: ~22s) — the underlying
    // dealer_inventory_options table has 286,596 distinct canonical_key values (nationwide
    // dealer wording inconsistency plus residual sentence-junk from before this table's
    // extraction filter shipped), so grouping the whole table into that many buckets is real
    // work regardless of the join. That's a separate, larger data-normalization problem — fixing
    // it here isn't realistic. What IS fixable here: this fetch was BLOCKING every single AI
    // search, however simple, on that same nationwide computation — confirmed live: even
    // "2025 cayenne" (no options mentioned at all) failed at the same ~20s mark, because
    // /api/search/parse always fetches the full catalog before parsing, regardless of whether
    // the query needs it. Gemini parses make/model/year/color perfectly well without this
    // context; only exact must-have-option matching degrades without it. Racing both calls
    // against a short timeout and falling back to an empty list means a slow/cold catalog no
    // longer blocks the whole search — it only means options might not get canonicalized this
    // one time, which is a far better failure than the entire search timing out. The box-side
    // request isn't cancelled by losing this race (Promise.race can't cancel a fetch already in
    // flight) — it keeps running and, if it succeeds, still warms invCached's 10-minute cache for
    // the next request.
    const CONTEXT_TIMEOUT_MS = 3_000;
    const withFallback = <T>(promise: Promise<T>, fallback: T): Promise<T> =>
      Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), CONTEXT_TIMEOUT_MS))]).catch(() => fallback);
    const emptyCatalog: GlobalCatalogOptions = { options: [], exteriorColors: [], interiorColors: [] };
    const [{ makes: byMake }, catalog] = await Promise.all([
      withFallback(inventoryMakes(), { makes: [] }),
      withFallback(allCatalogOptions(), emptyCatalog),
    ]);
    const parsed = await parseSearchQuery(q, {
      makes: byMake.map((m) => m.make),
      options: catalog.options.map((o) => ({ key: o.key, label: o.label })),
      exteriorColors: catalog.exteriorColors,
      interiorColors: catalog.interiorColors,
    });

    if (!parsed) {
      return NextResponse.json({ available: false, message: "AI search is not configured — use the filters below instead." });
    }

    if (defaultZip && !parsed.filters.zip) parsed.filters.zip = defaultZip;
    const extraClarifications: string[] = [];
    const sp = parsedSearchFiltersToParams(parsed.filters, extraClarifications);
    const buyerQuery = parseBuyerSearchParams(sp);
    const results = await runBuyerSearch(buyerQuery);

    return NextResponse.json({
      available: true,
      filters: parsed.filters,
      confidence: parsed.confidence,
      clarifications: [...parsed.clarifications, ...extraClarifications],
      displayChips: parsed.displayChips,
      results,
    });
  } catch (err) {
    if (err instanceof SearchParseError) return NextResponse.json({ error: err.message }, { status: 502 });
    const message = err instanceof InventoryApiError ? err.message : "Could not run AI search.";
    const status = err instanceof InventoryApiError ? (err.status === 503 ? 503 : err.status === 400 || err.status === 404 ? err.status : 502) : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
