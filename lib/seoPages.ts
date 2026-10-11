// Single source for what search engines may index: feeds app/sitemap.ts, the per-route metadata layouts and the
// robots.txt disallow list. Buyer-private, dealer and admin pages are NOT here and are disallowed in robots.ts.
export const SITE_URL = "https://www.trimscout.com";

export interface PublicPage {
  path: string;
  title: string;
  description: string;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
}

export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: "/",
    title: "TrimScout | Whole Market Vehicle Search & Dealership Bidding",
    description:
      "Search cars by exact option packages, analyze real market prices, and let dealerships compete for your business with transparent out-the-door bids.",
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    path: "/search",
    title: "Search New & Used Cars by Trim and Options | TrimScout",
    description:
      "Search live dealer inventory nationwide by make, model, trim, color and factory option packages, and see what each car really costs.",
    changeFrequency: "daily",
    priority: 0.9,
  },
  {
    path: "/compare",
    title: "Compare Cars Side by Side: Price, Options & Market Value | TrimScout",
    description:
      "Compare similar cars from different dealers side by side, with trim, options, mileage and price against the market.",
    changeFrequency: "weekly",
    priority: 0.7,
  },
  {
    path: "/negotiator",
    title: "AI Car Price Negotiator: Out-the-Door Quotes | TrimScout",
    description:
      "Let TrimScout ask dealers for competing out-the-door quotes on the car you want, so you can compare real prices without the back-and-forth.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/contact",
    title: "Contact TrimScout | Questions, Feedback & Support",
    description: "Questions, feedback or a problem with a search or a quote? Get in touch with the TrimScout team.",
    changeFrequency: "yearly",
    priority: 0.4,
  },
  {
    path: "/terms",
    title: "Terms of Use | TrimScout",
    description: "The terms that apply when you use TrimScout to search for vehicles and request dealer quotes.",
    changeFrequency: "yearly",
    priority: 0.2,
  },
  {
    path: "/privacy",
    title: "Privacy Policy | TrimScout",
    description: "What personal information TrimScout collects when you search and request quotes, how it is used and shared, and your choices.",
    changeFrequency: "yearly",
    priority: 0.2,
  },
  {
    path: "/disclaimer",
    title: "Disclaimer | TrimScout",
    description: "Important limits on TrimScout's listings, prices and estimates: what to verify with the dealer before you buy.",
    changeFrequency: "yearly",
    priority: 0.2,
  },
];

export function pageMetadata(path: string) {
  const page = PUBLIC_PAGES.find((p) => p.path === path);
  if (!page) throw new Error(`pageMetadata: ${path} is not in PUBLIC_PAGES`);
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: { title: page.title, description: page.description, url: page.path },
    twitter: { title: page.title, description: page.description },
  };
}

// Paths that must never be crawled: API, admin, dealer and buyer-private pages (tokens, quotes, trade-in drafts).
export const DISALLOWED_PATHS = ["/admin", "/api", "/rfq", "/d", "/trade", "/quote-request", "/signup"];
