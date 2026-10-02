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
      if (res.ok && typeof json.url === "string" && /^https?:\/\//i.test(json.url)) return json.url;
      if (res.ok && !json.retry) return null;
    } catch {
      /* fall through to retry */
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return undefined;
}

/**
 * A VIN, as a link to the dealer's listing page when our own inventory crawl captured one for it.
 * `href` is used as-is when the import already carried it (Vehicle.crawlListingUrl); otherwise the
 * link is looked up after the card renders — the import's own lookup is capped at 4s and often
 * misses on a loaded box, so relying on it alone left some VINs unlinked. Plain monospace text
 * when we have no crawl data (or until the lookup answers). Opens in a new tab.
 */
export function VinLink({ vin, href, className = "" }: { vin: string; href?: string | null; className?: string }) {
  const clean = (vin || "").trim().toUpperCase();
  const [looked, setLooked] = useState<string | null | undefined>(() => resolved.get(clean));

  useEffect(() => {
    if (href || !/^[A-HJ-NPR-Z0-9]{17}$/.test(clean)) return;
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
  }, [clean, href]);

  const link = href || looked || null;
  if (!link) return <span className={`font-mono ${className}`}>{vin}</span>;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the dealer's listing for this VIN"
      data-testid="vin-crawl-link"
      className={`font-mono underline decoration-dotted underline-offset-2 hover:text-emerald-300 ${className}`}
    >
      {vin}
    </a>
  );
}
