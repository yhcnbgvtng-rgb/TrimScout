// Real capacity measurements and projection helpers for the 24-hour
// per-box SLA (added 2026-09-21, after box 1/box 3/box 4 were all found —
// via real rooftop-count math, not vehicle-volume — to be projected well
// past 24h under their state assignments at the time).
//
// P50/P90_SECONDS_PER_ROOFTOP come from 23 real per-brand crawl durations
// sampled across today's runs (WY/core, HI/core, TX/expansion,
// CA/expansion) — a small sample, real production data rather than
// synthetic, but not yet a large one. Overridable via env vars so a future
// pass with more samples doesn't need a code change to update these.
export const P50_SECONDS_PER_ROOFTOP = Number(process.env.CRAWLER_P50_SEC_PER_ROOFTOP) || 41.2;
export const P90_SECONDS_PER_ROOFTOP = Number(process.env.CRAWLER_P90_SEC_PER_ROOFTOP) || 93.2;

// The hard SLA: a box's assigned shard must be projected (at the p90 rate)
// to finish within this many hours. Default 24 — the non-negotiable
// ceiling; a box's own CRAWLER_DRIVER_BUDGET_HOURS is normally set lower
// than this (e.g. 23h) so the reactive stop-starting-new-states guard has
// a chance to act before this predictive one would even matter.
export const MAX_PROJECTED_HOURS = Number(process.env.CRAWLER_MAX_PROJECTED_HOURS) || 24;

import fs from 'node:fs';
import path from 'node:path';

// Counts real dealers (rooftops) for one state across the given brand
// list, reading the same dealers/<state>/<brand>.json files the crawler
// itself reads — so this is always in sync with what's actually on disk,
// never a separately-maintained number that can drift stale.
export function countRooftopsForState(state, brands, cwd = process.cwd()) {
  let total = 0;
  for (const brand of brands) {
    const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const filePath = path.join(cwd, 'dealers', state.toLowerCase(), `${slug}.json`);
    try {
      const rows = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(rows)) total += rows.length;
    } catch {
      // No file for this (state, brand) combo — 0 rooftops, not an error
      // (e.g. Hawaii genuinely has no Buick dealer file).
    }
  }
  return total;
}

export function countRooftopsForStates(states, brands, cwd = process.cwd()) {
  return states.reduce((sum, state) => sum + countRooftopsForState(state, brands, cwd), 0);
}

// Projected wall-clock hours for `rooftops` total rooftops split across
// `concurrency` states running at once, at `secondsPerRooftop` each.
export function projectedHours(rooftops, concurrency, secondsPerRooftop = P90_SECONDS_PER_ROOFTOP) {
  return (rooftops * secondsPerRooftop) / 3600 / Math.max(1, concurrency);
}
