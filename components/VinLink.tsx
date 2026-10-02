"use client";

import React, { useEffect, useState } from "react";

// One answer per VIN for the life of the page, so the same VIN shown in several cards (pick, summary,
// compare table) asks once. `null` = confirmed no crawl data; absent = not asked yet / couldn't tell.
const resolved = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null | undefined>>();

async function askForLink(vin: string): Promise<string | null | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`/api/inventory/vin-link?vin=${encodeURIComponent(vin)}`);
      const json = (await res.json().catch(() => ({}))) as { url?: string | null; retry?: boolean };
      if (res.ok && typeof json.url === "string" && json.url.startsWith("/admin/crawl?vin=")) return json.url;
      if (res.ok && !json.retry) return null;
    } catch {
      /* fall through to retry */
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return undefined;
}

/**
 * A VIN, as a link to that VIN's page in the admin crawl sheet (the day-by-day crawl history) when
 * our own inventory crawl holds data for it. The lookup runs after the card renders (the import's
 * own VIN lookup is capped at 4s and often misses on a loaded box) and only answers for admins —
 * the crawl sheet is admin-only, so everyone else, and any VIN with no crawl data, gets plain
 * monospace text. Opens in a new tab.
 */
export function VinLink({ vin, className = "" }: { vin: string; className?: string }) {
  const clean = (vin || "").trim().toUpperCase();
  const [looked, setLooked] = useState<string | null | undefined>(() => resolved.get(clean));

  useEffect(() => {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(clean)) return;
    if (resolved.has(clean)) { setLooked(resolved.get(clean)); return; }
    let live = true;
    const p = inFlight.get(clean) ?? askForLink(clean);
    inFlight.set(clean, p);
    p.then((url) => {
      inFlight.delete(clean);
      if (url !== undefined) resolved.set(clean, url);
      if (live) setLooked(url);
    });
    return () => { live = false; };
  }, [clean]);

  const link = looked || null;
  if (!link) return <span className={`font-mono ${className}`}>{vin}</span>;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      title="Open this VIN in the crawl data"
      data-testid="vin-crawl-link"
      className={`font-mono underline decoration-dotted underline-offset-2 hover:text-emerald-300 ${className}`}
    >
      {vin}
    </a>
  );
}
