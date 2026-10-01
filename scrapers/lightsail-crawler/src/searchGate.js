// A small concurrency gate for the buyer-facing inventory list queries.
//
// Measured live 2026-09-30: four concurrent searches stacked on the one MariaDB box produced three
// 20s statement timeouts — slow queries don't just fail alone, they hold a pool connection and a
// share of the box's I/O while the rest queue behind them, so a burst turns into a cascade. A hard
// cap on how many run at once, with a short bounded wait for a free slot, turns a cascade into
// "a few searches run, the rest are told to retry in a moment" — fast, visible, and recoverable.
// Deliberately NOT a raised timeout: waiting longer is exactly what made the cascade.
//
// Pure (no DB, no server) so it can be unit-tested; deals_api_server.js owns the one instance.

export class SearchBusyError extends Error {}

/**
 * @param {{ max: number, waitMs: number }} opts max = queries allowed to run at once; waitMs = how
 * long a caller may wait for a slot before being refused with SearchBusyError.
 */
export function createGate({ max, waitMs }) {
  let active = 0;
  const waiters = [];

  const release = () => {
    const next = waiters.shift();
    if (next) { clearTimeout(next.timer); next.resolve(); } // hand the slot straight to the next waiter
    else active--;
  };

  const acquire = () => {
    if (active < max) { active++; return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const i = waiters.indexOf(waiter);
        if (i !== -1) waiters.splice(i, 1);
        reject(new SearchBusyError("Search is busy right now — please try again in a moment."));
      }, waitMs);
      waiters.push(waiter);
    });
  };

  return {
    /** Runs fn while holding a slot; always releases, even if fn throws. */
    async run(fn) {
      await acquire();
      try { return await fn(); } finally { release(); }
    },
    stats: () => ({ active, waiting: waiters.length, max }),
  };
}
