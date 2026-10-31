"use client";

import React, { useState } from "react";
import { X } from "lucide-react";
import { normalizeVinQuery, VIN_NO_MATCH } from "@/lib/inventoryVinQuery";

export type VinLookupResult<V> = { vin: string; vehicles: V[]; truncated: boolean };

/**
 * The VIN box above the filters: full VIN (exact) or the last 6-8 characters. Typing is forgiving (case, spaces); the I/O/Q rule shows
 * inline before any request. `onResult` gets the matches (the page shows them in its results table) and `onClear` puts the filters back.
 */
export default function VinLookup<V>({ onResult, onClear, active }: { onResult: (r: VinLookupResult<V>) => void; onClear: () => void; active: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = normalizeVinQuery(text);
    if (!q.ok) { setError(q.error); onClear(); return; }
    setText(q.vin);
    setError(null);
    onClear(); // the previous lookup's rows go the moment a new one starts; the button reads "Looking…" until the answer lands
    setBusy(true);
    try {
      const res = await fetch(`/api/vehicles/vin?vin=${encodeURIComponent(q.vin)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError((json && json.error) || "Could not look up that VIN right now."); onClear(); return; }
      if (!json.vehicles?.length) { setError(VIN_NO_MATCH); onClear(); return; }
      onResult({ vin: q.vin, vehicles: json.vehicles, truncated: Boolean(json.truncated) });
    } catch {
      setError("Could not look up that VIN right now.");
      onClear();
    } finally {
      setBusy(false);
    }
  };

  const clear = () => { setText(""); setError(null); onClear(); };

  return (
    <form onSubmit={submit} className="mb-4" aria-label="Find by VIN">
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-xs">
          <input
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null); }}
            placeholder="VIN or last 6–8 characters"
            aria-label="VIN or last 6 to 8 characters"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "vin-lookup-error" : undefined}
            autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={24}
            className="w-full rounded-lg border border-border-strong bg-surface-elevated px-3 py-2 font-mono text-xs uppercase text-white placeholder:font-sans placeholder:normal-case placeholder:text-ink-faint focus:outline-none"
          />
          {(text || active) && (
            <button type="button" onClick={clear} aria-label="Clear VIN" className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-white"><X className="h-3.5 w-3.5" /></button>
          )}
        </div>
        <button type="submit" disabled={busy || !text.trim()} className="rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold text-ink-light hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "Looking…" : "Find VIN"}
        </button>
      </div>
      {error && <p id="vin-lookup-error" role="alert" data-testid="vin-error" className="mt-1.5 text-xs font-semibold text-amber-300">{error}</p>}
    </form>
  );
}
