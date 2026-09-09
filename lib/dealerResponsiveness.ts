/**
 * Pure, isomorphic helpers for dealer responsiveness — safe to import from
 * both server code (lib/dealsApi.ts) and client components
 * (components/BiddingWizard.tsx), unlike lib/dealsApi.ts itself which
 * touches server-only env/secrets.
 */

export interface DealerResponsivenessStats {
  dealerName: string;
  bidCount: number;
  /** null when bidCount is 0 — no fabricated default; there's genuinely nothing to report yet. */
  avgResponseHours: number | null;
}

// Real, computed from actual deal_bids/deal_requests timing — never a
// fabricated "usually responds within..." default. null/zero-bid stats say
// so plainly rather than guessing at a plausible-sounding number.
export function formatDealerResponsivenessLabel(stats: DealerResponsivenessStats | null): string | null {
  if (!stats) return null;
  if (stats.bidCount === 0 || stats.avgResponseHours === null) return "No response history yet";
  const hours = stats.avgResponseHours;
  if (hours < 1) return "Usually responds within the hour";
  if (hours < 24) return `Usually responds within ${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `Usually responds within ${days} day${days === 1 ? "" : "s"}`;
}
