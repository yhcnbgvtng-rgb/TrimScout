import type { Metadata } from "next";
import { pageMetadata } from "../../lib/seoPages";

// The page itself is a client component, so its title/description live in this server layout.
export const metadata: Metadata = pageMetadata("/compare");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
