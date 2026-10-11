import type { MetadataRoute } from "next";
import { DISALLOWED_PATHS, SITE_URL } from "../lib/seoPages";

// Polite-only: a robots.txt disallow doesn't stop anything that ignores
// it (a scraper, a script, a curious human with curl) — the real control
// on /admin is server-side auth (see lib/adminAuth.ts's
// requireAdminSession, already enforced on every /api/admin/* route and
// the /admin page itself), and on the paid-vendor /api/* routes it's
// lib/apiSpendGuard.ts. This just keeps well-behaved crawlers from
// wasting their (and our) budget indexing pages that were never meant to
// be indexed: API, admin, dealer and buyer-private pages (lib/seoPages.ts).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: DISALLOWED_PATHS.flatMap((p) => [p, `${p}/`]),
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
