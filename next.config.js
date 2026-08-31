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
  },
};

module.exports = nextConfig;
