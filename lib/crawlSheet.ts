/**
 * The web-crawl sheet: every directory row flattened into the columns the crawls actually produced. The
 * crawls left their provenance in `notes` as "key: value" segments joined by " | " (Title, Website, Source,
 * Lead inbox, Staff page, Brand, Site harvest, dated recovery/promotion stamps); this reads them back out
 * into real columns so the admin sheet can filter and sort on them. Pure — no I/O — so it's unit-tested.
 */
import type { Dealership } from "./dealershipsApi";
import { deskFromDealership, isGenericMailbox } from "./quotePackage";

import type { CrawlRow, EmailKind, StaffPageStatus } from "./crawlSheetColumns";
export type { CrawlRow, EmailKind, StaffPageStatus } from "./crawlSheetColumns";
export { CRAWL_SHEET_COLUMNS, crawlRowCell, crawlRowsToCsv, crawlSheetFilename } from "./crawlSheetColumns";

const seg = (notes: string, key: string) => {
  const m = notes.match(new RegExp(`(?:^|\\|)\\s*${key}:\\s*([^|]+)`, "i"));
  return m ? m[1].trim() : "";
};

export function brandsFromNotes(notes: string): string[] {
  return Array.from(new Set(Array.from(notes.matchAll(/Brand:\s*([A-Za-z][A-Za-z -]*?)\s*(?:\||$)/g)).map((m) => m[1].trim()))).filter(Boolean);
}

/** A brand the crawl didn't tag but the name gives away — so old Ford/Toyota-era rows still filter by make. */
const NAME_BRANDS = ["Chevrolet", "Ford", "Toyota", "Honda", "Hyundai", "Kia", "Nissan", "Subaru", "Mazda", "Volkswagen", "Audi", "BMW", "Mercedes-Benz", "Lexus", "Acura", "INFINITI", "Volvo", "Cadillac", "Buick", "GMC", "Lincoln", "Jeep", "Ram", "Dodge", "Chrysler", "Porsche", "Genesis", "MINI", "McLaren", "Land Rover", "Jaguar", "Mitsubishi", "Fiat", "Alfa Romeo", "Maserati", "Bentley", "Ferrari", "Lamborghini", "Aston Martin", "Rolls-Royce", "Tesla", "Rivian", "Polestar", "Lucid"];
export function brandsFromName(dealerName: string): string[] {
  const n = dealerName.replace(/Mercedes\s+Benz/i, "Mercedes-Benz").replace(/\bVW\b/, "Volkswagen").replace(/\bChevy\b/i, "Chevrolet");
  return NAME_BRANDS.filter((b) => new RegExp(`\\b${b.replace(/[-\s]/g, "[-\\s]")}\\b`, "i").test(n));
}

export function staffPageStatus(notes: string, website: string): StaffPageStatus {
  const s = seg(notes, "Staff page").toLowerCase();
  if (s.startsWith("blocked")) return "blocked";
  if (s.startsWith("no_staff_page") || s.startsWith("no staff page")) return "no_staff_page";
  if (/Source:\s*https?:\/\//i.test(notes)) return "captured";
  if (!website) return "no_website";
  return "unknown";
}

export function crawlRowFromDealership(d: Dealership): CrawlRow {
  const notes = d.notes || "";
  const email = (d.contactEmail || "").trim();
  const emailKind: EmailKind = !email ? "none" : isGenericMailbox(email) ? "generic" : "named";
  const sourceUrl = (notes.match(/Source:\s*(https?:\/\/[^\s|)]+)/i) || [])[1] || "";
  const source = sourceUrl || seg(notes, "Source");
  const website = (d.website || "").trim() || (notes.match(/Website:\s*(https?:\/\/[^\s|]+)/i) || [])[1] || "";
  const emailSource: CrawlRow["emailSource"] = !email
    ? ""
    : /email recovered from staff-page HTML source/i.test(notes)
      ? "html_recovery"
      : /lead inbox promoted to contact email/i.test(notes)
        ? "lead_inbox"
        : /Site harvest:|enrich/i.test(notes)
          ? "enrichment"
          : sourceUrl
            ? "staff_page"
            : "manual";
  const brands = brandsFromNotes(notes);
  return {
    id: d.id,
    dealerName: d.dealerName.trim(),
    brands: brands.length ? brands : brandsFromName(d.dealerName),
    address: (d.address || "").trim(),
    city: (d.city || "").trim(),
    state: (d.state || "").trim().toUpperCase(),
    zip: (d.zipCode || "").trim(),
    phone: (d.phone || "").trim(),
    website,
    domains: d.domains || [],
    contactName: (d.contactName || "").trim(),
    contactTitle: seg(notes, "Title"),
    contactEmail: email,
    emailKind,
    contactReady: Boolean(deskFromDealership(d)?.knownNamed) && !d.emailOptOut,
    emailOptOut: Boolean(d.emailOptOut),
    source,
    staffPage: staffPageStatus(notes, website),
    leadInbox: (seg(notes, "Lead inbox").match(/[^\s]+@[^\s]+/) || [])[0] || "",
    emailSource,
    updatedAt: d.updatedAt || "",
    notes,
  };
}

