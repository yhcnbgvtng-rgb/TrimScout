/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Paid-only factory options flag (lib/optionsPaidOnly.ts). Inlined for the client components; unset means off.
  env: { OPTIONS_PAID_ONLY: process.env.OPTIONS_PAID_ONLY || "", NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV || "" },
  typescript: {
    // Was `true` — that let real, broken code ship silently (confirmed
    // during an audit: an undefined import that would have thrown at
    // runtime went uncaught because nothing ever ran a real build against
    // it). Now that the tree is clean, keep it that way.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ["unpdf", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/ford-comparables": ["./lib/testdata/ford-stickers/**/*"],
    "/app/api/ford-comparables/**/*": ["./lib/testdata/ford-stickers/**/*"],
  },
  async redirects() {
    // MarketPulse was removed from the site; send any old URL to the home page.
    return [
      { source: "/market-pulse", destination: "/", permanent: true },
      { source: "/api/market-pulse", destination: "/", permanent: true },
    ];
  },
  async headers() {
    // script-src allows 'unsafe-inline'/'unsafe-eval' because Next.js's own
    // hydration/data scripts need it without per-request nonces — a
    // stricter CSP is possible later but needs a nonce-based setup. Still
    // real value here: frame-ancestors/X-Frame-Options block clickjacking,
    // and this is the app's first CSP at all (previously none).
    return [
      // Marketing / legal pages: CDN-cached, served stale while the origin
      // revalidates — a traffic spike hits the edge, not the app.
      {
        source: "/(terms|privacy|disclaimer|contact)",
        headers: [{ key: "Cache-Control", value: "public, s-maxage=600, stale-while-revalidate=86400" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // challenges.cloudflare.com: Turnstile's widget script (bot
              // protection on signup, components/SignupView.tsx) — it also
              // renders its actual challenge in an iframe from the same
              // origin, hence frame-src below too.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https:",
              "frame-src https://challenges.cloudflare.com",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
