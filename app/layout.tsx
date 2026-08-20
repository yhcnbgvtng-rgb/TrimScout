import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TrimScout | Whole Market Vehicle Search & Dealership Bidding',
  description: 'Search cars by exact option packages, analyze real market prices, and let dealerships compete for your business with transparent out-the-door bids.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased selection:bg-emerald-500/20 selection:text-emerald-300">
        {children}
      </body>
    </html>
  );
}
