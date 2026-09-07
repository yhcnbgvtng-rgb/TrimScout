import type { MetadataRoute } from "next";

// Polite-only: a robots.txt disallow doesn't stop anything that ignores
// it (a scraper, a script, a curious human with curl) — the real control
// on /admin is server-side auth (see lib/adminAuth.ts's
// requireAdminSession, already enforced on every /api/admin/* route and
// the /admin page itself), and on the paid-vendor /api/* routes it's
// lib/apiSpendGuard.ts. This just keeps well-behaved crawlers from
// wasting their (and our) budget indexing pages that were never meant to
// be indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/admin/", "/api", "/api/"],
    },
    // No sitemap entry yet — out of scope for this change (tracked
    // separately in the SEO audit). Add one here once it exists rather
    // than pointing at a 404.
  };
}
