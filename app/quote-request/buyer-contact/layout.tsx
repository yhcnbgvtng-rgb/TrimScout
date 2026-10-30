import type { Metadata } from "next";

// The dealer's private reveal page: never indexed, never cached.
export const metadata: Metadata = { title: "Buyer contact info | TrimScout", robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
