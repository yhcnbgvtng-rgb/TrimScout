"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Compass, Download, ArrowLeft } from "lucide-react";
import { PitchDeckView } from "@/components/PitchDeckView";

export default function DeckPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between selection:bg-emerald-500 selection:text-black">
      {/* Top Navigation Bar */}
      <header className="border-b border-border/70 bg-surface/50 backdrop-blur-xl sticky top-0 z-30">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5 group select-none">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-black shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
              <Compass className="h-5 w-5 stroke-[2.5]" />
            </div>
            <span className="font-black text-xl tracking-tight text-white flex items-center">
              Trim<span className="text-emerald-400">Scout</span>
              <span className="ml-2 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-black text-emerald-400 uppercase">
                Investor Deck
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <a
              href="/TrimScout_Business_Case_Pitch_Deck.pptx"
              download="TrimScout_Business_Case_Pitch_Deck.pptx"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20 transition-all cursor-pointer"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Download .PPTX</span>
            </a>

            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface px-3.5 py-2 text-xs font-bold text-white transition-all shadow-sm"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Return Home</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Pitch Deck Presentation */}
      <main className="flex-1">
        <PitchDeckView onClose={() => router.push("/")} />
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 py-6 text-center text-xs text-ink-faint">
        <p>© 2026 TrimScout Inc. • Proprietary Reverse-Bidding Automotive Architecture</p>
      </footer>
    </div>
  );
}
