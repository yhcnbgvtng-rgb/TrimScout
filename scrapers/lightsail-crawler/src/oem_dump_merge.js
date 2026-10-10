// Merge rules for dealers/oem-dumps/<brand>.json when the locator fetcher is run for only some
// brands and/or states.
//
// fetch-oem-dealer-locators.mjs used to rewrite every dump from scratch on every run. That made a
// partial refresh impossible (re-fetching Hyundai meant re-fetching, and possibly clobbering,
// everything) and let a blocked or failed locator replace a good dump with an empty one. Every
// state's write-<state>-dealer-files step regenerates its dealer files from these dumps, so an empty
// dump silently turns into "no dealers, brand skipped" for that brand in every state.

function rowState(r) {
  return String(r?.state || '').toUpperCase();
}

// existing: rows already in the dump on disk. fresh: rows this run fetched (already filtered to the
// states being refreshed). states: the states this run covers, or null for "all of them".
// Returns { rows, kept, note }.
//  - A fetch that came back empty never replaces a non-empty dump (blocked / 403 / locator down).
//  - With a state subset, only those states' rows are replaced; every other state's rows are kept.
export function mergeDumpRows({ existing = [], fresh = [], states = null }) {
  const wanted = states && states.length ? new Set(states.map((s) => String(s).toUpperCase())) : null;
  if (fresh.length === 0 && existing.length > 0) {
    return { rows: existing, kept: existing.length, note: 'fetch returned no rows — kept the existing dump' };
  }
  if (!wanted) return { rows: fresh, kept: 0, note: null };
  const outside = existing.filter((r) => !wanted.has(rowState(r)));
  return { rows: [...outside, ...fresh], kept: outside.length, note: null };
}

// "--brands=hyundai,toyota" -> Set of lower-case slugs, or null for all brands.
export function parseListArg(argv, name) {
  const prefix = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  const items = hit.slice(prefix.length).split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : null;
}
