import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, SITE_URL } from "../lib/seoPages";

// Public marketing, search and legal pages only (lib/seoPages.ts). Eight URLs: far under the 50,000-URL / 50 MB
// sitemap limit, so no sitemap index yet. If per-trim pages are added, switch to generateSitemaps() and an index.
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((p) => ({
    url: p.path === "/" ? SITE_URL : `${SITE_URL}${p.path}`,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
