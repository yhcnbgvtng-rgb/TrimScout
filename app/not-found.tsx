import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page Not Found | TrimScout",
  description: "We couldn't find that page. Search new and used cars or head back to the TrimScout home page.",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-3 text-sm opacity-80">That page doesn&apos;t exist or has moved.</p>
      <div className="mt-6 flex justify-center gap-4 text-sm font-semibold">
        <Link href="/search" className="underline">Search cars</Link>
        <Link href="/" className="underline">Home</Link>
      </div>
    </main>
  );
}
