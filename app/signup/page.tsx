"use client";

export const dynamic = "force-dynamic";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronRight
} from "lucide-react";
import { SignupView } from "@/components/SignupView";
import { AuthModal } from "@/components/AuthModal";

export default function SignupPage() {
  const router = useRouter();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between selection:bg-emerald-500 selection:text-black">
      {/* Top Navigation Bar */}
      <header className="border-b border-border/70 bg-surface/50 backdrop-blur-xl sticky top-0 z-30">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5 group select-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/scoutmark.png"
              alt="TrimScout"
              className="h-9 w-9 rounded-xl shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform"
            />
            <span className="font-black text-xl tracking-tight text-white flex items-center">
              Trim<span className="text-emerald-400">Scout</span>
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-muted hidden sm:inline">Already have an account?</span>
            <button
              type="button"
              onClick={() => setIsAuthModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-surface hover:border-border-strong px-4 py-2 text-xs font-bold text-white transition-all shadow-sm"
            >
              <span>Sign In</span>
              <ChevronRight className="h-3.5 w-3.5 text-emerald-400" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Signup Form Content */}
      <main className="flex-1 flex items-center justify-center">
        <Suspense fallback={null}>
          <SignupView onSuccess={() => router.push("/")} onNavigateHome={() => router.push("/")} />
        </Suspense>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 py-6 text-center text-xs text-ink-faint">
        <p>© 2026 LyDar Enterprises LLC. Built for honest option matches and real dealer quotes.</p>
      </footer>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSignedIn={() => router.push("/")}
      />
    </div>
  );
}
