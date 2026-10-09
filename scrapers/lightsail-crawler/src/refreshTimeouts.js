// Two time budgets for the same dropdown queries.
//
// A buyer waiting on /api/inventory/catalog (or facets, makes, ...) gets the interactive budget: 20s on the database
// (SET STATEMENT max_statement_time) and 45s on the connection wait — past that the page would rather show an error.
// The stale-while-revalidate cache (stableCache.js) also recomputes an expired entry in the BACKGROUND while it keeps
// serving the old copy; nobody waits on that, so it may run longer. Found 2026-10-08: the per-make option aggregate for
// Ford and Chevrolet (~1.1M inv_option_facets rows through a temp table) needs more than 20s on a busy box, so its
// background refresh failed every time and buyers kept the Oct 6 copy indefinitely.
//
// The budget is carried in an AsyncLocalStorage so the query sites don't change shape: they call statementSeconds() /
// waitMs() where they used to read the constants, and outside a background refresh those return exactly the old values.
// Concurrent buyer requests are never affected by a background refresh running at the same time.
import { AsyncLocalStorage } from "node:async_hooks";

export const BACKGROUND_STATEMENT_SECONDS = 120;
export const BACKGROUND_WAIT_MS = 150_000; // the connection wait must outlast the statement, or the JS timeout would cut the query first

export function createRefreshTimeouts({ interactiveSeconds, interactiveWaitMs, backgroundSeconds = BACKGROUND_STATEMENT_SECONDS, backgroundWaitMs = BACKGROUND_WAIT_MS }) {
  const als = new AsyncLocalStorage();
  const inBackground = () => als.getStore()?.background === true;
  return {
    statementSeconds: () => (inBackground() ? backgroundSeconds : interactiveSeconds),
    waitMs: () => (inBackground() ? backgroundWaitMs : interactiveWaitMs),
    /** Run fn (and everything it awaits) with the background budget. */
    runBackground: (fn) => als.run({ background: true }, fn),
  };
}
