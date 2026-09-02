/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
  async headers() {
    // script-src allows 'unsafe-inline'/'unsafe-eval' because Next.js's own
    // hydration/data scripts need it without per-request nonces — a
    // stricter CSP is possible later but needs a nonce-based setup. Still
    // real value here: frame-ancestors/X-Frame-Options block clickjacking,
    // and this is the app's first CSP at all (previously none).
    return [
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
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https:",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
