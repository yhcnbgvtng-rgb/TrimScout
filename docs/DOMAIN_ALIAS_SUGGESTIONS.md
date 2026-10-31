# Dealer domain alias suggestions (box patch package, NOT installed)

## Why
`/api/desk-resolve` used to PUT a full dealership row (built from a directory
cache up to 60 s old) whenever a pasted listing link matched a desk through a
redirect or white-label slug. That is unauthenticated, could overwrite an
admin's fresh `contactEmail` edit with the stale cached one, and let anyone
add alias domains. The website no longer writes from that route.

## Wanted
A box endpoint that records a *suggestion* and touches nothing else:

`POST /api/dealerships/:id/domain-suggestions` with `{ "domains": ["joycehonda.roadster.com"] }`

- Body is only the domains. Never `contactEmail`, never a full row.
- Server lowercases, validates each as a bare hostname, caps 5 per request,
  ignores domains already on the row's `domains[]`.
- Inserts into a new table `dealership_domain_suggestions(id, dealership_id,
  domain, first_seen_at, hits, status ENUM('pending','approved','rejected'),
  UNIQUE(dealership_id, domain))`; repeats bump `hits`.
- Admin review (existing dealer admin page) approves a row, which appends it to
  `dealerships.domains` via the existing admin-authenticated PUT.
- Rate-limited per IP on the box, in addition to the Vercel limit in `middleware.ts`.

## After install
Add a `suggestDealershipDomains(id, domains)` helper in `lib/dealershipsApi.ts`
and call it from `app/api/desk-resolve/route.ts` with `resolution.aliasHosts`
(only when `via` is `redirect` or `platform_slug`). Needs Paul's GO before any
box change.
