# Factory build pipeline: adding a brand sticker provider

`lib/factoryBuildPipeline.ts` runs one idempotent job per VIN: acquire the
factory window sticker → normalize/canonicalize it into the common
`FactoryBuild` schema (`lib/factoryBuild.ts`) → enrich with a VIN decode
(`lib/factoryBuildEnrich.ts`) → upsert by VIN (`lib/factoryBuildStore.ts`).
A window sticker is ground truth. A decode can confirm identity, fill a
genuinely missing trim, and flag disagreements — it never overwrites a
sticker's MSRP or options, and it never gets to call itself
`factory_verified`.

Only the five brands with a genuine OEM window sticker are wired as
`StickerProvider`s: Ford, GM, Genesis, Hyundai, Stellantis. The other 14
brand modules under `lib/*Sticker.ts` (Audi, BMW, Honda, Kia, Mazda,
Mercedes, MINI, Mitsubishi, Nissan, Porsche, Subaru, Toyota, Volkswagen,
Volvo) wrap MarketCheck's dealer-equipment feed
(`lib/listingFeedBuild.ts`/`createListingFeedStickerHandlers`) — real,
dealer-reported data, but not a factory Monroney sticker — and must never
be registered here as `factory_verified`.

## The pieces

| Stage | File | What it does |
|---|---|---|
| Acquire + normalize | `lib/factoryBuildProviders.ts`, `lib/factoryBuild.ts` | Routes a VIN (by WMI, via `lib/oemWmi.ts`) to a brand's sticker fetcher, then converts its sticker into the common `FactoryBuild`. |
| Canonicalize | `lib/factoryOptionCatalog.ts`, `lib/factoryOptionCatalogStore.ts` | Folds a raw option name/code into a stable, cross-brand catalog entry (`data/factory-option-catalog.json`) so "M Sport Package" and "M SPORT PACKAGE" resolve to the same searchable thing — additive, `rawName`/`code` are always kept as-is. |
| Enrich | `lib/factoryBuildEnrich.ts` | NHTSA vPIC decode; fills a missing trim, flags mismatches, upgrades a sticker-less build to `decode_provisional`. |
| Persist | `lib/factoryBuildStore.ts` | Local JSON store (`data/factory-builds.json`), upsert by VIN. |
| Orchestrate | `lib/factoryBuildPipeline.ts` | `runFactoryBuildPipeline(vin)` — the whole job, safe to re-run. |
| Serve (QA) | `app/api/admin/factory-build/route.ts`, `app/api/admin/factory-options/route.ts` | `GET/POST /factory-build` looks up or runs the pipeline for one VIN. `GET /factory-options?q=` searches the option catalog by name or code and returns every VIN (from the local store) that actually carries a match. Both admin-only. |

## Adding a new brand

1. **Fetch + parse**, the same way the existing brand modules do
   (`lib/hyundaiSticker.ts`, `lib/genesisSticker.ts`, `lib/fordSticker.ts`,
   ...): find the brand's public OEM sticker endpoint (a Monroney PDF URL,
   or a DealerFire-style `.../new/{VIN}` host every dealer platform for
   that brand pulls from), fetch it, extract PDF text with `unpdf`, and
   parse it into a `status: "released" | "unreleased" | "error"` record —
   `"error"` meaning the label's own text never mentioned the requested
   VIN, so it plainly isn't this car's. Prefer the brand's own known public
   sticker path over scraping a dealer VDP for options — that's a
   Visor/listing scrape, never factory-verified.
   - If the brand shares the same SAP Monroney form family as Genesis
     (Hyundai does), reuse `parseGenesisStickerText` / the `GenesisSticker`
     shape rather than writing a new parser from scratch.
   - Add fixture-driven tests the same way `lib/hyundaiSticker.test.ts`
     does, with real captured stickers under `lib/testdata/{brand}-stickers/`,
     and import `lib/testdata/blockLiveHttp.ts` first so an unmocked
     `fetch` fails loudly instead of burning live quota.

2. **Normalize.** Ford, GM, Genesis, Hyundai and Stellantis all parse to the
   same shape (`vin`, `status`, `year?`/`make?`/`model?`/`trim?`, `msrp`,
   `basePrice`, `optionsPrice`, `destination`, `options[]`, ...) — only how
   an option line's code is spelled differs (`GmOptionLine.rpo`,
   `GenesisOptionLine`/`StellantisOptionLine.code`, `FordOptionLine` has
   none). If the new brand's sticker matches that shape, add a one-line
   wrapper next to `normalizeFordSticker`/`normalizeGmSticker` in
   `lib/factoryBuild.ts` that calls the shared `normalizeOemSticker()` with
   the right code accessor. Otherwise write a small `normalize{Brand}Sticker()`
   that maps the brand's own fields into `FactoryBuild` directly. Keep the
   same rules either way: options/MSRP only populated for `factory_verified`,
   package vs. standalone option derived from the source data (never
   guessed), and a warning (not a silent drop) whenever a total fails to
   reconcile or a released sticker parses to zero options.

3. **Register a `StickerProvider`** in `lib/factoryBuildProviders.ts` —
   `fetch` calls the brand's `getXSticker` and returns the already-normalized
   `FactoryBuild`:

   ```ts
   export const acmeStickerProvider: StickerProvider = {
     id: "acme_oem",
     make: "Acme",
     matchesVin: isAcmeVin, // from lib/oemWmi.ts
     fetch: async (vin, opts) => {
       const sticker = await getAcmeSticker(vin);
       return normalizeAcmeSticker(sticker, { providerId: "acme_oem", url: sticker.pdfUrl }, opts);
     },
   };
   ```

   Add it to `STICKER_PROVIDERS`. If the brand shares a WMI with another
   brand already registered (like Hyundai/Genesis's 5NM), order matters —
   put the provider whose own fetch already knows how to fall back to the
   other brand first, the way `hyundaiStickerProvider` is checked before
   `genesisStickerProvider`.

4. Nothing in `factoryOptionCatalogStore.ts`, `factoryBuildEnrich.ts`,
   `factoryBuildStore.ts`, or `factoryBuildPipeline.ts` needs to change —
   they only ever see the common `FactoryBuild` shape.

## Status and provenance

- `factory_verified` — a released, VIN-matched sticker. Options/MSRP are
  the sticker's own.
- `factory_pending` — no sticker yet (brand not wired, or the OEM hasn't
  published one), and no successful decode either.
- `decode_provisional` — no sticker, but NHTSA resolved the VIN. Carries
  year/make/model/trim only, never options, never `factory_verified`.
- `parse_failed` — a sticker was fetched but its text didn't match the
  requested VIN.

`provenance` is `"sticker"` for a build whose fields came from a sticker
attempt, `"decode_provisional"` for a sticker-less decode-only build, and
`"mixed"` when a verified sticker had a genuinely missing field (trim)
filled in from a decode.
