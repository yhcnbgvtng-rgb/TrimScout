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
| Added with a named contact (`contact_ready`) | | 0 |
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
