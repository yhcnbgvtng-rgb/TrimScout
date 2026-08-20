/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['images.unsplash.com', 'pictures.dealer.com', 'vehicle-images.carscommerce.inc', 'visor.vin'],
  },
};

module.exports = nextConfig;
