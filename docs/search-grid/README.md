# /search results grid

`/search` is now a spreadsheet-style grid: every column header has a sort toggle (where the box can order by it) and a small Excel-style filter dropdown.
Website only; nothing here changes a box. Every filter, count and sort goes through the deals-api; the browser only ever holds the pages it has asked for (24 per page, infinite scroll).

Look at it without a box: `node scripts/dev/mock-deals-box.mjs`, then `LIGHTSAIL_IP=127.0.0.1 LIGHTSAIL_API_KEY=mock OPTIONS_PAID_ONLY=1 npm run dev`.
Screenshots (mock box): `desktop-grid-trim-filter.jpg`, `desktop-paid-options-filter.jpg`, `phone-cards.jpg`, `phone-filter-sheet.jpg`.

## Which columns work today, and which wait on a box install

"Today" = the deals-api as it is live now. "Waits" = the filter (or its numbers) stays hidden until that box patch is installed; the page does not guess.

| Column | Cell | Filter | Waits on |
|---|---|---|---|
| Year | yes | min/max + slider (works today) | histogram + exact slider bounds: #585 install |
| Make, Model, Trim, State | yes | searchable list with live counts (works today) | nothing. Single choice (see below) |
| Condition | yes | list (works today) | counts: #583 install (FACET_COND_PRICE) |
| Exterior / Interior color | yes | list (works today) | counts: #583 install |
| Mileage | yes | maximum (works today) | minimum + histogram: #585 install (shown max-only until then) |
| Price | yes | min/max + slider (works today) | histogram: #583 install |
| Paid options | count + priced list on hover (the rows already carry priced options) | searchable list with name, price, count | #587 install (paid prices in the catalog) and `OPTIONS_PAID_ONLY=1` on the web; needs a model picked |
| Body style | yes | list with counts | #585 install |
| Fuel, Drivetrain, Transmission | yes, worked out from engine / trim / transmission text with the box's own classifier | list with counts | #585 install |
| Dealer | yes | searchable list with counts (top 20 dealers in the set) | #585 install |
| Days on market | yes | min/max + slider (works today, via minDays/maxDays) | nothing |
| VIN (off by default, from the Columns menu) | yes | pattern box | #585 install |

Sort toggles work today on Year, Make, Model, Trim, Exterior, Interior, Mileage, Price, Dealer, State, Days on market and VIN. The box cannot order by Condition, Paid options, Body style, Fuel, Drivetrain or Transmission, so those headers have a filter but no sort toggle. As before, most sorts need a model picked (a whole make is too slow to sort).

A column whose field no loaded row carries is hidden, and the Columns menu lists only columns the box sends.

## Rules kept

- A make is still required to list vehicles (the box refuses a search without one). Without it the grid shows its header, the count is the whole inventory, and the Make filter is the way in.
- Make, Model, Trim, State, Condition and the two colors are single choice: the live box counts for them (`/api/inventory/facets`, `/catalog`) take one value, so a tick replaces the previous one and there is no Select all. The other lists are multi-select with Select all and Clear. Multi-select for those needs the box to count with several values at once.
- Zero-count values are hidden; a value that is picked stays visible so it can be unticked.
- No Last seen / First seen date anywhere in the public grid, cards or filters (`lib/picksBarWiring.test.ts` guards the grid source).
- Filters apply 300 ms after the last change (one request, the previous one aborted). Filters, sort and visible columns (`cols=-year,+vin`) live in the URL. Old `days=8-30` links still load.
- Phone: cards, and a Filters button that opens the same column filters as a bottom sheet with a "Show N vehicles" button.
