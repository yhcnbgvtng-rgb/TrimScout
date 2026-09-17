# Factory build pipeline: adding a brand sticker provider

`lib/factoryBuildPipeline.ts` runs one idempotent job per VIN: acquire the
factory window sticker → normalize/canonicalize it into the common
`FactoryBuild` schema (`lib/factoryBuild.ts`) → enrich with a VIN decode
(`lib/factoryBuildEnrich.ts`) → upsert by VIN (`lib/factoryBuildStore.ts`).
A window sticker is ground truth. A decode can confirm identity, fill a
genuinely missing trim, and flag disagreements — it never overwrites a
sticker's MSRP or options, and it never gets to call itself
`factory_verified`.

## The pieces

| Stage | File | What it does |
|---|---|---|
| Acquire | `lib/factoryBuildProviders.ts` | Routes a VIN (by WMI, via `lib/oemWmi.ts`) to a brand's sticker fetcher. |
| Normalize + canonicalize | `lib/factoryBuild.ts` | Converts a brand sticker into `FactoryBuild`; maps raw option names/codes to a catalog id when a resolver is given (additive — `rawName`/`code` are always kept). |
| Enrich | `lib/factoryBuildEnrich.ts` | NHTSA vPIC decode; fills a missing trim, flags mismatches, upgrades a sticker-less build to `decode_provisional`. |
| Persist | `lib/factoryBuildStore.ts` | Local JSON store (`data/factory-builds.json`), upsert by VIN. |
| Orchestrate | `lib/factoryBuildPipeline.ts` | `runFactoryBuildPipeline(vin)` — the whole job, safe to re-run. |
| Serve (QA) | `app/api/admin/factory-build/route.ts` | `GET ?vin=` looks up a stored build; `POST { vin }` runs the pipeline. Admin-only. |

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

2. **Register a `StickerProvider`** in `lib/factoryBuildProviders.ts`:

   ```ts
   export const acmeStickerProvider: StickerProvider = {
     id: "acme_oem",
     make: "Acme",
     matchesVin: isAcmeVin, // from lib/oemWmi.ts
     fetch: async (vin) => {
       const sticker = await getAcmeSticker(vin);
       return { providerId: "acme_oem", url: sticker.pdfUrl, sticker };
     },
   };
   ```

   Add it to `STICKER_PROVIDERS`. If the brand shares a WMI with another
   brand already registered (like Hyundai/Genesis's 5NM), order matters —
   put the provider whose own fetch already knows how to fall back to the
   other brand first, the way `hyundaiStickerProvider` is checked before
   `genesisStickerProvider`.

3. **Normalize.** If the new brand's sticker doesn't parse to the
   `GenesisSticker` shape, write a small `normalize{Brand}Sticker()`
   alongside `normalizeGenesisFamilySticker()` in `lib/factoryBuild.ts`
   that maps the brand's own fields into `FactoryBuild`. Keep the same
   rules: options/MSRP only populated for `factory_verified`, package vs.
   standalone option derived from the source data (never guessed), and a
   warning (not a silent drop) whenever a total fails to reconcile or a
   released sticker parses to zero options.

4. Nothing in `factoryBuildEnrich.ts`, `factoryBuildStore.ts`, or
   `factoryBuildPipeline.ts` needs to change — they only ever see the
   common `FactoryBuild` shape.

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
