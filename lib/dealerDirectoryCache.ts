/**
 * The contact directory, fetched from the box at most once a minute per
 * server instance. Shared by every route that needs to look a rooftop up
 * mid-request (quote desks, listing-link dealer identity) so a burst of
 * pastes doesn't pull 11k rows each time. Failure degrades to an empty
 * directory: callers already treat "not found" as a normal answer.
 */

import { listDealerships, type Dealership } from "./dealershipsApi";

const TTL_MS = 60_000;
let cache: { rows: Dealership[]; at: number } | null = null;
let inflight: Promise<Dealership[]> | null = null;

export async function cachedDealerDirectory(): Promise<Dealership[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  if (inflight) return inflight;
  inflight = listDealerships()
    .then((rows) => {
      cache = { rows, at: Date.now() };
      return rows;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Same as above but never throws — for lookups that are a nice-to-have on the request. */
export async function dealerDirectoryOrEmpty(): Promise<Dealership[]> {
  try {
    return await cachedDealerDirectory();
  } catch {
    return cache?.rows ?? [];
  }
}
