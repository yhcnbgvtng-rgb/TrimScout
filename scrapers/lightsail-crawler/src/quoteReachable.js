// The one rule for "can a quote request actually reach this dealer": shared by the web app (lib/quoteReachable.ts →
// admin tile, wizard badge, quote routing, contact writes) and the box (deals_api_server.js tile, auth_api_server.js
// writes), so the three surfaces cannot drift apart again. Pure and import-free on purpose — it is copied to the box
// as a single file and bundled into the browser.
//
// Audit 2026-10-30: the "Sales email on file" tile counted any non-empty contact_email, which let through
// accessibility@hmausa.com on 111 rooftops, lead-vendor domains, scraped ".png" filenames and department inboxes.

/** Mailboxes that are a department, not a sales desk. Compared after stripping everything but letters, so "no-reply" and "customer.service" hit. */
export const DEPARTMENT_MAILBOXES = new Set([
  "accessibility", "info", "contact", "customerservice", "customercare", "bdc", "parts", "service",
  "noreply", "donotreply", "webmaster", "support", "marketing", "hr", "careers", "accounting", "billing",
  "privacy", "postmaster",
]);

/** Domains that are never a dealer's own: the OEM's corporate mail and lead-routing / CRM vendors. Suffix match ("x.leadcrm.com" too). */
export const BLOCKED_EMAIL_DOMAINS = [
  "hmausa.com", // Hyundai Motor America — accessibility@hmausa.com was stored on 111 rooftops
  "leadcrm.com",
  "eleadtrack.net",
  "dealeremail.com",
  "eautodealerhub.com",
  "cmdlr.com",
  "udcnet.com",
];

/** Consumer mail providers: a deliverable address, but it says nothing about which store it belongs to. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com", "me.com", "live.com",
  "msn.com", "comcast.net", "att.net", "verizon.net", "protonmail.com", "sbcglobal.net", "bellsouth.net",
]);

/** A scraped image name ("logo@2x.png") parses as an address; none of these is a real TLD. */
const ASSET_TLDS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "js", "css", "ico", "woff", "woff2", "pdf"]);

const EMAIL_SHAPE = /^[A-Za-z0-9._%+'\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$/;

/** Words that appear in many dealer names and therefore prove nothing about a domain. */
const NAME_STOPWORDS = new Set([
  "auto", "motors", "motor", "group", "cars", "chevrolet", "toyota", "honda", "ford", "nissan", "automotive", "sales",
  "hyundai", "kia", "jeep", "dodge", "chrysler", "buick", "gmc", "cadillac", "lexus", "acura", "infiniti", "subaru",
  "mazda", "volkswagen", "audi", "bmw", "mercedes", "porsche", "genesis", "volvo", "lincoln", "mini", "dealer", "center",
  "of", "the", "and", "inc", "llc",
]);

/** Local part reduced to letters only, so "no-reply", "customer.service" and "Customer_Service" all compare equal. */
export function mailboxKey(email) {
  const clean = String(email || "").trim().toLowerCase();
  const at = clean.indexOf("@");
  if (at <= 0) return "";
  return clean.slice(0, at).replace(/[^a-z]/g, "");
}

export function emailDomainOf(email) {
  const clean = String(email || "").trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  return at > 0 ? clean.slice(at + 1) : "";
}

/** "www.shop.example.co.uk" → "example.co.uk". A heuristic, not the public-suffix list — enough to compare a store's own hosts. */
export function registrableDomain(host) {
  let h = String(host || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(":")[0].replace(/^www\./, "");
  const p = h.split(".").filter(Boolean);
  if (p.length >= 3 && ["co", "com", "org"].includes(p[p.length - 2]) && p[p.length - 1].length === 2) return p.slice(-3).join(".");
  return p.slice(-2).join(".");
}

/** The store's own registrable domains: website column plus domains_json (array, or the JSON string the box stores). */
export function siteDomainsOf(contact) {
  const out = new Set();
  if (contact && contact.website) out.add(registrableDomain(contact.website));
  let list = contact && contact.domains;
  if (typeof list === "string") {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (Array.isArray(list)) for (const d of list) out.add(registrableDomain(d));
  out.delete("");
  return out;
}

export function isBlockedEmailDomain(domain) {
  const d = String(domain || "").toLowerCase();
  return BLOCKED_EMAIL_DOMAINS.some((b) => d === b || d.endsWith("." + b));
}

/** Does this mail domain plausibly belong to this store: same label as its site, a 6-letter shared prefix, or a distinctive word from its name. */
export function domainRelatedToDealer(domain, contact) {
  const mailLabel = registrableDomain(domain).split(".")[0].replace(/-/g, "");
  if (!mailLabel) return false;
  for (const site of siteDomainsOf(contact)) {
    const siteLabel = site.split(".")[0].replace(/-/g, "");
    if (!siteLabel) continue;
    if (mailLabel === siteLabel || mailLabel.includes(siteLabel) || siteLabel.includes(mailLabel)) return true;
    let n = 0;
    while (n < Math.min(mailLabel.length, siteLabel.length) && mailLabel[n] === siteLabel[n]) n++;
    if (n >= 6) return true;
  }
  const words = (String((contact && contact.dealerName) || "").toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !NAME_STOPWORDS.has(w));
  return words.some((w) => mailLabel.includes(w));
}

/**
 * Mail domains that two or more rooftops share — a dealer group's corporate domain (lithia.com, swickard.com). An address
 * there is the group's own, so it counts as the store's even though the domain is not the store's website.
 * `emails` is every contact_email in the directory; public and blocked domains never qualify.
 */
export function groupDomainsFrom(emails, minRooftops = 2) {
  const counts = new Map();
  for (const e of emails || []) {
    const d = emailDomainOf(e);
    if (!d || PUBLIC_EMAIL_DOMAINS.has(d) || isBlockedEmailDomain(d)) continue;
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  const out = new Set();
  for (const [d, n] of counts) if (n >= minRooftops) out.add(d);
  return out;
}

/**
 * Why an address may not be stored at all, as { kind, message }, or null. Only hard failures — an address that is merely
 * unverified (public mail, an unfamiliar domain) is still allowed in; it just is not "reachable".
 * kind: "bad_format" | "junk_file_name" | "department_mailbox" | "vendor_or_oem_domain".
 */
export function contactEmailProblem(email) {
  const raw = String(email == null ? "" : email);
  const e = raw.trim();
  if (!e) return null; // blank is allowed: it means "none"
  if (e.length > 254 || /[\s;,]/.test(e) || !EMAIL_SHAPE.test(e)) return { kind: "bad_format", message: "not a valid email address" };
  const tld = e.slice(e.lastIndexOf(".") + 1).toLowerCase();
  if (ASSET_TLDS.has(tld)) return { kind: "junk_file_name", message: "looks like a file name, not an email address" };
  if (DEPARTMENT_MAILBOXES.has(mailboxKey(e))) return { kind: "department_mailbox", message: `"${e.slice(0, e.indexOf("@"))}@" is a department mailbox, not a sales desk` };
  if (isBlockedEmailDomain(emailDomainOf(e))) return { kind: "vendor_or_oem_domain", message: `${emailDomainOf(e)} is a vendor or manufacturer domain, not the dealership's` };
  return null;
}

/** The message half of contactEmailProblem, or null — what a write is refused with. Used when contacts are written. */
export function contactEmailWriteProblem(email) {
  const p = contactEmailProblem(email);
  return p ? p.message : null;
}

/**
 * Marks each directory row whose mail domain is a group domain (see groupDomainsFrom) with `emailInGroupDomain`, so the rule
 * needs no directory-wide argument: stamp once when the directory loads and every consumer gets the same answer.
 * Returns new row objects; the input is untouched.
 */
export function stampGroupDomains(rows, minRooftops = 2) {
  const groups = groupDomainsFrom((rows || []).map((r) => r && r.contactEmail), minRooftops);
  return (rows || []).map((r) => ({ ...r, emailInGroupDomain: groups.has(emailDomainOf(r && r.contactEmail)) }));
}

/**
 * contact: { contactEmail, dealerName?, website?, domains?, emailOptOut?, emailInGroupDomain? }
 * status: "none" (nothing stored) · "invalid" (stored but unusable) · "unverified" (usable shape, cannot tie it to the store) · "valid".
 */
export function classifyContactEmail(contact) {
  const email = String((contact && contact.contactEmail) || "").trim().toLowerCase();
  if (!email) return { status: "none", reason: null };
  const problem = contactEmailProblem(email);
  if (problem) return { status: "invalid", reason: problem.kind };
  const domain = emailDomainOf(email);
  if (PUBLIC_EMAIL_DOMAINS.has(domain)) return { status: "unverified", reason: "public_domain" };
  if (domainRelatedToDealer(domain, contact)) return { status: "valid", reason: null };
  if (contact && contact.emailInGroupDomain) return { status: "valid", reason: null };
  return { status: "unverified", reason: "unrelated_domain" };
}

/** The single answer to "can a quote request reach this rooftop": a valid address, and the dealer has not unsubscribed. */
export function isQuoteReachable(contact) {
  if (contact && contact.emailOptOut) return false;
  return classifyContactEmail(contact).status === "valid";
}

/** "reachable" · "unverified" (the buyer-facing amber bucket) · "none" (nothing usable). Opt-outs are never reachable. */
export function reachabilityBucket(contact) {
  if (isQuoteReachable(contact)) return "reachable";
  if (contact && contact.emailOptOut) return "none";
  return classifyContactEmail(contact).status === "unverified" ? "unverified" : "none";
}
