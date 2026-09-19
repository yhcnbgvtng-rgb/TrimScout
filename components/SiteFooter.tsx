import React from "react";
import Link from "next/link";

/**
 * Site-wide footer: the legal links, the copyright, and a one-line feedback
 * pointer. Shared across the homepage, the quote-request flow and the legal
 * pages so the same muted row shows everywhere. `showCopyright` lets the
 * homepage hide the copyright line on the deal-tracker view.
 */
export function SiteFooter({ showCopyright = true, className = "" }: { showCopyright?: boolean; className?: string }) {
  return (
    <footer className={`border-t border-border/60 py-6 text-center text-xs text-ink-faint ${className}`.trim()}>
      {showCopyright ? (
        <p>© 2026 LyDar Enterprises LLC. Built for honest option matches and real dealer quotes.</p>
      ) : null}
      <p className="mt-2 flex flex-wrap items-center justify-center gap-4">
        <Link href="/terms" className="hover:text-white transition-colors">Terms of Use</Link>
        <span className="text-border-strong">•</span>
        <Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
        <span className="text-border-strong">•</span>
        <Link href="/disclaimer" className="hover:text-white transition-colors">Disclaimer</Link>
        <span className="text-border-strong">•</span>
        <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
      </p>
      <p className="mt-2">
        Feedback? Bugs? Issues? Email us at{" "}
        <a href="mailto:general@trimscout.com" className="text-ink-light hover:text-white underline underline-offset-2 transition-colors">general@trimscout.com</a>
      </p>
    </footer>
  );
}
