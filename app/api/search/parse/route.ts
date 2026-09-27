import { NextResponse } from "next/server";
import { inventoryMakes, allCatalogOptions, InventoryApiError } from "@/lib/inventoryApi";
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
    const [{ makes: byMake }, catalog] = await Promise.all([inventoryMakes(), allCatalogOptions()]);
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
