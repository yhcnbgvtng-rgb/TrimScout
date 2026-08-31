/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ["unpdf", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/ford-comparables": ["./lib/testdata/ford-stickers/**/*"],
    "/app/api/ford-comparables/**/*": ["./lib/testdata/ford-stickers/**/*"],
    "/api/gm-comparables": ["./lib/testdata/gm-stickers/**/*"],
    "/app/api/gm-comparables/**/*": ["./lib/testdata/gm-stickers/**/*"],
    "/api/gm-sticker": ["./lib/testdata/gm-stickers/**/*"],
    "/app/api/gm-sticker/**/*": ["./lib/testdata/gm-stickers/**/*"],
  },
};

module.exports = nextConfig;
