"use client";

import React from "react";

/**
 * Keeps one broken section from blanking the whole page. Wrap a self-contained block (a trade summary, a gallery) and
 * give it a short `fallback`; the rest of the page keeps working. Logs to the console so the cause is findable.
 * Resets when `resetKey` changes (e.g. a different record is shown).
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode; label?: string; resetKey?: unknown },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error(`[ErrorBoundary${this.props.label ? ": " + this.props.label : ""}]`, error); }
  componentDidUpdate(prev: { resetKey?: unknown }) { if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ?? (
      <p className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200" role="alert" data-testid="section-error">
        This section couldn&apos;t be shown. The rest of the page is unaffected; try refreshing.
      </p>
    );
  }
}
