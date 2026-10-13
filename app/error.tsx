"use client";

import React, { useEffect } from "react";

// Route-level fallback: a render error in any page shows this instead of Next's bare "Application error" screen,
// with a retry. (Section-level failures are caught earlier by components/ErrorBoundary.)
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[route error]", error); }, [error]);
  return (
    <main className="mx-auto max-w-md space-y-3 px-4 py-16 text-center" role="alert" data-testid="route-error">
      <h1 className="text-lg font-extrabold text-white">Something went wrong on this page</h1>
      <p className="text-sm text-ink-muted">It&apos;s been logged. You can try again, or go back to the homepage.</p>
      <div className="flex justify-center gap-3">
        <button type="button" onClick={() => reset()} className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-extrabold text-black hover:bg-brand-400">Try again</button>
        <a href="/" className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-ink-light hover:text-white">Home</a>
      </div>
    </main>
  );
}
