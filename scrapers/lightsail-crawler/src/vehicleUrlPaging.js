// Per-rooftop VDP URL limits. Until now the only limit was CRAWLER_MAX_VEHICLES_PER_DEALER (1000 on box3/box4 expansion
// runs, set in cron, not in code) and it TRUNCATED: a rooftop with 1,172 sitemap URLs was crawled for 1,000 and the other
// 172 were never fetched, so those cars were never listed, or were retired once they fell out of the crawl. On 2026-10-10
// 306 rooftop crawls hit it (176 on box3, 130 on box4; largest 6,157 URLs, median 1,570) and about 256,000 VDP URLs were
// dropped that night.
//
// Now the number is a PAGE size and a separate hard ceiling bounds the total:
//   CRAWLER_MAX_VEHICLES_PER_DEALER       URLs crawled per page (0/unset = one page). Same variable, so existing cron lines keep working.
//   CRAWLER_HARD_MAX_VEHICLES_PER_DEALER  most URLs ever crawled for one rooftop; default 8000, above the largest seen (6,157).
// Pages run one after another so the 1-hour per-dealer cutoff can stop between pages and every finished page is kept.

export const DEFAULT_HARD_MAX_VEHICLES_PER_DEALER = 8000;

const positiveInt = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** @returns {{ pageSize: number, hardMax: number }} pageSize 0 = a single page */
export function vehicleUrlLimits(env = process.env) {
  const hardMax = positiveInt(env.CRAWLER_HARD_MAX_VEHICLES_PER_DEALER) || DEFAULT_HARD_MAX_VEHICLES_PER_DEALER;
  const pageSize = Math.min(positiveInt(env.CRAWLER_MAX_VEHICLES_PER_DEALER), hardMax);
  return { pageSize, hardMax };
}

/**
 * @param {string[]} urls in sitemap order (newest first, so a truncated tail is the oldest listings)
 * @returns {{ pages: string[][], total: number, kept: number, dropped: number, hardCapped: boolean }}
 */
export function planVehicleUrlPages(urls, { pageSize = 0, hardMax = DEFAULT_HARD_MAX_VEHICLES_PER_DEALER } = {}) {
  const total = urls.length;
  const kept = Math.min(total, hardMax > 0 ? hardMax : total);
  const size = pageSize > 0 ? pageSize : kept || 1;
  const pages = [];
  for (let i = 0; i < kept; i += size) pages.push(urls.slice(i, Math.min(i + size, kept)));
  return { pages, total, kept, dropped: total - kept, hardCapped: total > kept };
}

/** One log line per rooftop that needed paging or hit the ceiling; null when neither applies. */
export function describeVehicleUrlPlan(dealerName, plan, limits) {
  if (plan.hardCapped) {
    return `✂️ ${dealerName} has ${plan.total} vehicle URLs — over the hard limit of ${limits.hardMax}: crawling the first ${plan.kept} in ${plan.pages.length} page(s), ${plan.dropped} not crawled. Raise CRAWLER_HARD_MAX_VEHICLES_PER_DEALER if this rooftop is real.`;
  }
  if (plan.pages.length > 1) {
    return `📄 ${dealerName} has ${plan.total} vehicle URLs — crawling all of them in ${plan.pages.length} pages of up to ${limits.pageSize}.`;
  }
  return null;
}
