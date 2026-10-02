import React from "react";

/**
 * A VIN, as a link to the dealer's listing page when our own inventory crawl captured one for it
 * (Vehicle.crawlListingUrl, http/https only); plain monospace text when we have no crawl data.
 * Opens in a new tab so the buyer never loses their place in the wizard.
 */
export function VinLink({ vin, href, className = "" }: { vin: string; href?: string | null; className?: string }) {
  if (!href) return <span className={`font-mono ${className}`}>{vin}</span>;
  return (
    <a
      href={href}
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
