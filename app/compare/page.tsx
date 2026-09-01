"use client";

export const dynamic = "force-dynamic";

import React from "react";
import Link from "next/link";
import { Compass } from "lucide-react";
import { OfferCompareView } from "@/components/OfferCompareView";

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border/70 bg-surface/50 backdrop-blur-xl sticky top-0 z-30">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5 group select-none">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-black shadow-sm group-hover:scale-105 transition-transform">
              <Compass className="h-4.5 w-4.5 stroke-[2.5]" />
            </div>
            <span className="font-extrabold text-lg tracking-tight text-white">
              Trim<span className="text-emerald-400">Scout</span>
            </span>
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-ink-light hover:text-white hover:border-border-strong transition-colors"
          >
            Home
          </Link>
        </div>
      </header>
      <main className="flex-1">
        <OfferCompareView />
      </main>
      <footer className="border-t border-border/60 py-6 text-center text-xs text-ink-faint">
        <p>© 2026 TrimScout Inc. Built for transparent, reverse-bid automotive transactions.</p>
      </footer>
    </div>
  );
}
