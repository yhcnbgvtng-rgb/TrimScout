// The DISABLE_FACET_REBUILD kill switch for the catalog-facet rebuild, as a pure function so it can be
// unit-tested (deals_api_server.js starts a real server at import time).
//
// Policy (2026-10-08): with DISABLE_FACET_REBUILD set, every AUTOMATIC rebuild stays off — the debounced
// post-sync timer, the re-queue when a rebuild finishes, and the startup "never built" check. Only an
// EXPLICIT manual rebuild (POST /api/inventory/catalog-facets/rebuild, which passes { manual: true })
// may run, so an operator can refresh the buyer facets once without clearing the flag — clearing it
// needs a pm2 restart and re-enables the post-sync auto-rebuilds that were switched off on purpose
// (their per-make full-table aggregates contributed to sync lock-wait timeouts, 2026-09-29).
export function facetRebuildAllowed(env, opts = {}) {
  if (!env || !env.DISABLE_FACET_REBUILD) return true;
  return Boolean(opts && opts.manual === true);
}
