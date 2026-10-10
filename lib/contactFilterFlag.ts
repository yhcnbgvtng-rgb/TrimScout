/** Off until the deals-api box has the contact-search endpoints (docs/deploy/contact-on-file-filter.md); the checkbox stays hidden and the URL param is ignored. Client-safe: no server imports. */
export function contactFilterEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CONTACT_FILTER === "1";
}
