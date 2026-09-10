"use client";

export const dynamic = "force-dynamic";

import React from "react";
import Link from "next/link";
import { Mail } from "lucide-react";

const CONTACT_EMAIL = "general@trimscout.com";

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border/70 bg-surface/50 backdrop-blur-xl sticky top-0 z-30">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5 group select-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/scoutmark.png"
              alt="TrimScout"
              className="h-8 w-8 rounded-lg shadow-sm group-hover:scale-105 transition-transform"
            />
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
        <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8 space-y-8 text-center">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Contact Us</h1>
            <p className="text-sm text-ink-muted leading-relaxed max-w-md mx-auto">
              Questions about a deal, a dealer, or anything else — reach out and we&apos;ll get back to you.
            </p>
          </div>

          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="inline-flex items-center gap-2.5 rounded-xl border border-border bg-surface-elevated px-6 py-3.5 text-sm font-bold text-white hover:border-emerald-500/50 hover:bg-surface transition-all"
          >
            <Mail className="h-4 w-4 text-emerald-400" />
            {CONTACT_EMAIL}
          </a>
        </div>
      </main>

      <footer className="border-t border-border/60 py-6 text-center text-xs text-ink-faint">
        <p>© 2026 LyDar Enterprises LLC. Built for honest option matches and real dealer quotes.</p>
        <p className="mt-2 flex items-center justify-center gap-4">
          <Link href="/terms" className="hover:text-white transition-colors">Terms of Use</Link>
          <span className="text-border-strong">•</span>
          <Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
          <span className="text-border-strong">•</span>
          <Link href="/disclaimer" className="hover:text-white transition-colors">Disclaimer</Link>
          <span className="text-border-strong">•</span>
          <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
        </p>
      </footer>
    </div>
  );
}
