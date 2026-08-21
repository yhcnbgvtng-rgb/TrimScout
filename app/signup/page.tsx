"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Compass, ChevronRight } from "lucide-react";
import { SignupView } from "@/components/SignupView";

export default function SignupPage() {
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
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-muted hidden sm:inline">Already have an account?</span>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface hover:border-border-strong px-4 py-2 text-xs font-bold text-white transition-all shadow-sm"
            >
              <span>Sign In / Return Home</span>
              <ChevronRight className="h-3.5 w-3.5 text-emerald-400" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Signup Form Content */}
      <main className="flex-1 flex items-center justify-center">
        <SignupView onSuccess={() => router.push("/")} onNavigateHome={() => router.push("/")} />
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 py-6 text-center text-xs text-ink-faint">
        <p>© 2026 TrimScout Inc. Built for transparent, reverse-bid automotive transactions.</p>
      </footer>
    </div>
  );
}
