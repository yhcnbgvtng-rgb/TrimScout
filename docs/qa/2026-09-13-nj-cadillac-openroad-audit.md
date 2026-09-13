# NJ Cadillac + Open Road rooftop audit — 2026-09-13

Why: a buyer pasted `morristowncadillac.com` (Open Road Cadillac of Morristown, Florham Park NJ 07932). VIN and factory build resolved; the desk did not exist at all — unlike Schumacher Denville, this was a missing rooftop, not a missing domain.

## Sources
- **Cadillac dealer locator** (`cadillac.com/bypass/pcf/quantum-dealer-locator`, replayed in-page from Chester NJ 07836, 100 mi): **43** dealers — NJ 16, NY 13, PA 10, CT 3, DE 1.
- **Open Road Automotive Group** (`openroad.com/locations.html`, cards expanded): **18** stores (16 NJ, 2 NY).

## Coverage before → after
| | Before | After |
|---|---|---|
| Cadillac rooftops (100 mi) on file | 43 of 43 | **43 of 43** |
| Open Road stores on file | 18 of 18 | **18 of 18** |
| Rows added | | **43** (44 created; Malouf Cadillac merged into the existing Malouf Chevrolet Cadillac row — same address) |
| Added with a named contact (`contact_ready`) | | 0 at creation → **23** after the staff crawl below |
| Added desk-only | | 43 |
| Existing rows given the locator's Cadillac domain | | 0 |
| Generic (`info@`/`sales@`) contacts written | | 0 |

Every added row carries NAP from the locator / group page, `website`, and `domains[]` (redirect aliases resolved — none of the new sites redirect off-domain). Match-merge rules: a locator Cadillac may only merge into an existing row that is itself a GM store (so Delaware Cadillac was **not** absorbed into Porsche Delaware); an Open Road store may only merge into an Open Road row of the same brand (so the Volkswagen and Mazda stores were not absorbed into the Mercedes / Acura rows).

## Named contacts
The staff-page pass (rendered, 8 common paths, titled entries + personal mailbox only) found **no roster** on any of the 44 sites — these DealerOn/Dealer.com rooftops redirect `/staff` to a generic About Us or publish names without addresses. All additions are desk-only; the quote send still requires a named contact. Follow-up: the v2 browser staff crawl from the Mercedes rebuild, pointed at these 44 sites.

## Must-add row
- **Open Road Cadillac of Morristown** — 334 Columbia Turnpike, Florham Park, NJ 07932 — (973) 532-2402 — `https://www.morristowncadillac.com/` — domains `[morristowncadillac.com]` (site JSON-LD). Production: LYRIQ VDP → `unique · alias_host`.

## Non-regression (production, after)
- Freedom Ford (Iselin, NJ) → `alias_host` · Schumacher Chevrolet of Denville → `alias_host · knownNamed` · all 16 NJ Cadillac locator hosts → `alias_host`.


## Named contacts — browser staff crawl v2 (same day)

Re-ran the Mercedes-rebuild in-page extractor (`scripts/probes/browser-staff-extract.js`, driven by `scripts/staff-crawl-v2.mts`) through a real browser against the 45 desk-only rooftops sited today: nav-link discovery + 17 common staff paths, card heuristic, Cloudflare email decode, name↔email matching. One named contact at a personal mailbox per store; generic mailboxes never written.

| | |
|---|---|
| Crawled | 45 |
| **Now contact_ready** | **23** |
| Named person found, no personal mailbox on page (noted, not written) | 9 |
| No roster / no titled person | 13 |

Contact-ready now includes Crown, Gold Coast, Brogan, Cadillac of Mahwah, Bridgeton, Ciocca (AC), and four Open Road stores (Subaru, VW Bridgewater, Mazda Morristown, Volvo Edison). Open Road Cadillac of Morristown itself publishes no roster — still desk-only.

### Written
- Atlantic Cadillac (NY) — Jarrett Rivera, Sales & Leasing Consultant — j…@aagny.net — https://www.atlanticcadillac.com/dealership/staff.htm
- Bergey'S Cadillac (PA) — Dan Smith, General Manager — d…@bergeys.com — https://www.bergeyscadillac.com/dealership/staff.htm
- Bomnin Cadillac Nanuet (NY) — Richard Ceballos, Sales Manager — r…@grandprizeauto.net — https://www.bomnincadillacnanuet.com/staff.aspx
- Bridgeton Cadillac (NJ) — John Gomes, General Manager — j…@drivebam.com — https://www.bridgetoncadillac.com/staff/
- Brogan Cadillac Co. (NJ) — RAKESH MEHROTRA, GENERAL SALES MANAGER — r…@brogancad.com — https://www.brogancadillac.com/staff.aspx
- Cadillac Of Mahwah, LLC (NJ) — Paul Ciriello, Executive Manager — p…@cadillacofmahwah.com — https://www.cadillacofmahwah.com/staff.aspx
- Ciocca Cadillac (NJ) — Chrys Mulligan, General Manager — c…@cioccaauto.com — https://www.cioccacadillacofatlanticcity.com/dealership/staff.htm
- Crown Cadillac (NJ) — Christopher Mizerny, General Sales Manager — c…@crowncadillac.com — https://www.crowncadillac.com/staff.aspx
- Faulkner Cadillac (PA) — Ed Damm, Pre-Owned Sales Manager — e…@faulknermotors.com — https://www.cadillacoflehighvalley.com/staff.aspx
- Faulkner Cadillac Of Trevose (PA) — Tim Galen, General Manager — t…@faulknercadillac.com — https://www.faulknercadillactrevose.com/staff.aspx
- Gold Coast Cadillac (NJ) — DAVE PELAK, General Sales Manager — d…@goldcoastcadillac.com — https://www.goldcoastcadillac.com/dealership/staff.htm
- Hill Cadillac (PA) — Mark Pace, General Manager — m…@hillcadillac.com — https://www.hillcadillac.com/dealership/staff.htm
- Ingersoll Auto Of Danbury (CT) — Jerry Patry, Sales Manager — j…@ingersollauto.com — https://www.ingersollcadillacofdanbury.com/staff.aspx
- Open Road Mazda of Morristown (NJ) — Vladimir Nastelon, General Manager — v…@openroad.com — https://www.openroadmazdaofmorristown.com/staff/
- Open Road Subaru (NJ) — John Lopes, General Sales Manager — j…@openroad.com — https://www.openroadsubaru.com/staff.aspx
- Open Road Volkswagen Manhattan (NY) — Scott McCollum, Sales Manager — s…@openroad.com — https://www.vwmanhattan.com/staff/
- Open Road Volkswagen of Bridgewater (NJ) — Jonnathan Munoz, General Sales Manager — j…@openroad.com — https://www.openroadvwbridgewater.com/staff/
- Open Road Volvo Cars Edison (NJ) — Tina Heunemann, General Manager — t…@openroad.com — https://www.openroadvolvocarsedison.com/meet-the-staff.htm
- Paul Conte Cadillac (NY) — Timothy Hardway, General Sales Manager — t…@contecadillac.com — https://www.contecadillac.com/staff.aspx
- R.J. Burne Cadillac (PA) — RJ Burne, President/Owner — b…@gmail.com — https://www.rjburnecadillac.com/staff.aspx
- Sarant Cadillac Corp. (NY) — Antonio Centeno, Executive Manager — a…@sarantcadillac.com — https://www.sarantcadillac.com/staff.aspx
- Scott Cadillac (PA) — Marcus Yard, Sales Manager — m…@scottcars.com — https://www.scottcadillac.net/staff.aspx
- Star Cadillac (PA) — Ralph Puia, General Sales Manager — r…@starcar.com — https://www.starcadillac.com/staff.aspx

### Named, no mailbox
- Bical Auto Mall (NY) — Jamil Quaiser (Sales Manager); Andrei Mckenzie (Product Specialist) — no personal mailbox on page
- Cadillac Mount Kisco (NY) — Model Research (GM Rewards); Chad Harris (General Manager) — no personal mailbox on page
- Cadillac Of Englewood Cliffs (NJ) — Hadi Aridi (General Sales Manager); Travis Horne (Executive Manager) — no personal mailbox on page
- Cadillac Of Greenwich (CT) — Delivery Services (GM Rewards); Courtesy Transportation Vehicles (GM Discounts) — no personal mailbox on page
- Cadillac Of Turnersville (NJ) — Marc Ciampi (General Manager); Marsh Chambers (General Sales Manager) — no personal mailbox on page
- Holman Cadillac (NJ) — Monica Stellwag (General Manager); Gregory Tomczak (Sales Manager) — no personal mailbox on page
- Mcguire Cadillac, Inc. (NJ) — Buy Online (GM Rewards) — no personal mailbox on page
- Open Road Mazda of East Brunswick (NJ) — Courtesy Loaner Vehicles (CarFax 1 Owner) — no personal mailbox on page
- Pine Belt Cadillac Of Toms River, Inc. (NJ) — Marc Stango (General Sales Manager); Patrick Mooney (Cadillac Product Specialist) — no personal mailbox on page

### No roster
- Audi Manhattan (NY) — no staff page / no titled staff
- BMW of Roxbury (NJ) — no staff page / no titled staff
- Cadillac Of Manhattan (NY) — no staff page / no titled staff
- Ciocca Cadillac Of Flemington (NJ) — no staff page / no titled staff
- Delaware Cadillac (DE) — no staff page / no titled staff
- Fred Beans Cadillac (PA) — no staff page / no titled staff
- Healey Brothers Cadillac (NY) — no staff page / no titled staff
- MINI of Edison (NJ) — no staff page / no titled staff
- Miller Ford Sales (NJ) — no staff page / no titled staff
- MINI of Morristown (NJ) — no staff page / no titled staff
- Open Road Cadillac of Morristown (NJ) — no staff page / no titled staff
- Motorworld Cadillac (PA) — no staff page / no titled staff
- Pepe Cadillac (NY) — no staff page / no titled staff

## Existing rows given the locator's domain


## Rows added


## Locator hits already on file
- Johnson Cadillac → Johnson Cadillac (domain)
- Open Road Cadillac → Open Road Cadillac of Morristown (domain)
- Crown Cadillac → Crown Cadillac (domain)
- Ciocca Cadillac Of Flemington → Ciocca Cadillac Of Flemington (domain)
- Malouf Cadillac → Malouf Cadillac (domain)
- Brogan Cadillac Co. → Brogan Cadillac Co. (domain)
- Mcguire Cadillac, Inc. → Mcguire Cadillac, Inc. (domain)
- Coleman Cadillac → Coleman Buick GMC (domain)
- Cadillac Of Mahwah, LLC → Cadillac Of Mahwah, LLC (domain)
- Cadillac Of Manhattan → Cadillac Of Manhattan (domain)
- Faulkner Cadillac → Faulkner Cadillac (domain)
- Fred Beans Cadillac → Fred Beans Cadillac (domain)
- Cadillac Of Englewood Cliffs → Cadillac Of Englewood Cliffs (domain)
- Empire Cadillac Of Long Island City → Empire Buick GMC of Long Island City (domain)
- Star Cadillac → Star Cadillac (domain)
- Bomnin Cadillac Nanuet → Bomnin Cadillac Nanuet (domain)
- Bical Auto Mall → Bical Auto Mall (domain)
- Scott Cadillac → Scott Cadillac (domain)
- Faulkner Cadillac Of Trevose → Faulkner Cadillac Of Trevose (domain)
- Gold Coast Cadillac → Gold Coast Cadillac (domain)
- Pepe Cadillac → Pepe Cadillac (domain)
- North Bay Cadillac → North Bay Cadillac (domain)
- Bergey'S Cadillac → Bergey'S Cadillac (domain)
- Cadillac Of Greenwich → Cadillac Of Greenwich (domain)
- Paul Conte Cadillac → Paul Conte Cadillac (domain)
- Cadillac Mount Kisco → Cadillac Mount Kisco (domain)
- Healey Brothers Cadillac → Healey Brothers Cadillac (domain)
- Holman Cadillac → Holman Cadillac (domain)
- Pine Belt Cadillac Of Toms River, Inc. → Pine Belt Cadillac Of Toms River, Inc. (domain)
- Miracle Cadillac Of Kutztown → Miracle Buick GMC of Kutztown (domain)
- Sarant Cadillac Corp. → Sarant Cadillac Corp. (domain)
- R.J. Burne Cadillac → R.J. Burne Cadillac (domain)
- Hill Cadillac → Hill Cadillac (domain)
- Motorworld Cadillac → Motorworld Cadillac (domain)
- Hudson Cadillac Buick Gmc → Hudson Cadillac Buick GMC (domain)
- Cadillac Of Turnersville → Cadillac Of Turnersville (domain)
- Atlantic Cadillac → Atlantic Cadillac (domain)
- Ingersoll Auto Of Danbury → Ingersoll Auto Of Danbury (domain)
- King-O'Rourke Cadillac, Inc. → King O'Rourke Buick GMC, LLC (domain)
- Delaware Cadillac → Delaware Cadillac (domain)
- D'Addario Cadillac → D'Addario Buick GMC (domain)
- Bridgeton Cadillac → Bridgeton Cadillac (domain)
- Ciocca Cadillac → Ciocca Cadillac (domain)
- Open Road BMW of Edison → Open Road BMW (domain)
- BMW of Newton → BMW of Newton (domain)
- BMW of Morristown → BMW of Morristown (domain)
- BMW of Roxbury → BMW of Roxbury (domain)
- MINI of Edison → MINI of Edison (domain)
- MINI of Morristown → MINI of Morristown (domain)
- Open Road Volkswagen Manhattan → Open Road Volkswagen Manhattan (domain)
- Open Road Volkswagen of Bridgewater → Open Road Volkswagen of Bridgewater (domain)
- Open Road Honda → Open Road Honda (domain)
- Open Road Acura of Wayne → Open Road Acura of Wayne (domain)
- Open Road Acura of East Brunswick → Open Road Acura of East Brunswick (domain)
- Open Road Mazda of East Brunswick → Open Road Mazda of East Brunswick (domain)
- Open Road Mazda of Morristown → Open Road Mazda of Morristown (domain)
- Audi Manhattan → Audi Manhattan (domain)
- Open Road Cadillac of Morristown → Open Road Cadillac of Morristown (domain)
- Open Road Chevrolet → Open Road Chevrolet (domain)
- Open Road Subaru → Open Road Subaru (domain)
- Open Road Volvo Cars Edison → Open Road Volvo Cars Edison (domain)
