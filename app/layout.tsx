import type { Metadata } from 'next';
import { SessionProvider } from 'next-auth/react';
import './globals.css';

const title = 'TrimScout | Whole Market Vehicle Search & Dealership Bidding';
const description =
  'Search cars by exact option packages, analyze real market prices, and let dealerships compete for your business with transparent out-the-door bids.';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.trimscout.com'),
  title,
  description,
  openGraph: {
    title,
    description,
    url: 'https://www.trimscout.com',
    siteName: 'TrimScout',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased selection:bg-emerald-500/20 selection:text-emerald-300">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
