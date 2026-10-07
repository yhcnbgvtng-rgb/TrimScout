// Pure decision logic for the nightly crawler's opt-in "lite" mode (env
// CRAWLER_LITE_NIGHTLY_MODE) — extracted for unit testing without a real network call or a live
// enricher run.
//
// Factory options are meant to be crawled once per VIN. Once the deals-box DB already has real
// stored options for a VIN (dealer_inventory_options rows, or a non-empty options_json), this mode
// stops re-deriving factoryOptions/optionCodes/totalOptionsPrice/baseMsrp — and stops trusting this
// run's own freshly-scraped dealerListedOptions — for that VIN on every subsequent nightly run,
// regardless of what THIS run's own scrape happened to see. That way a dealer site having a bad day
// (its DDC dataLayer temporarily missing the options block) can never overwrite good stored data
// with an empty or partial result — the payload sent downstream simply omits options for that VIN,
// and deals_api_server.js's payloadHasOptions() gate (already shipped) leaves the existing DB rows
// untouched. A VIN with no stored options yet (new, or genuinely still blank) is unaffected: it
// keeps getting full, real extraction exactly as it did before this mode existed.
export function shouldPreserveStoredOptions({ liteModeEnabled, hasStoredOptions }) {
  return Boolean(liteModeEnabled) && Boolean(hasStoredOptions);
}

// Builds the options-related half of a vehicle's enrichment patch, given the raw
// resolveFactoryOptions() result for it (or null, when the caller already knows the VIN is
// preserved and skipped calling it). Pulled out of enricher.js's two enrichment loops — the
// cache-hit/skipped path and the fresh-NHTSA-lookup path — so both share exactly one decision
// instead of two copies that could drift, and so the decision is testable without a real crawl,
// a real deals-box lookup, or a real NHTSA call.
//
// Returns `{ patch, clearDealerListedOptions }`:
//   - preserved (known-good VIN, lite mode on): patch omits factoryOptions/optionCodes/
//     totalOptionsPrice/baseMsrp entirely — even if `optionData` is non-null, it is ignored —
//     and clearDealerListedOptions is true so the vehicle's own raw scraped
//     dealerListedOptions (always populated earlier in the crawl, before this module ever runs)
//     doesn't leak into the outbound payload either. Downstream, inventory-sync.mjs's options()
//     then has nothing to send, and deals_api_server.js's payloadHasOptions() gate leaves the
//     VIN's existing stored options completely untouched.
//   - not preserved (new VIN, blank-options VIN, or lite mode off): patch carries the real,
//     freshly-computed options fields from `optionData`, exactly as before this mode existed.
export function buildOptionsPatch({ liteModeEnabled, hasStoredOptions, optionData }) {
  if (shouldPreserveStoredOptions({ liteModeEnabled, hasStoredOptions })) {
    return { patch: {}, clearDealerListedOptions: true };
  }
  return {
    patch: { factoryOptions: optionData.options, optionCodes: optionData.optionCodes, totalOptionsPrice: optionData.totalOptionsPrice, baseMsrp: optionData.baseMsrp },
    clearDealerListedOptions: false,
  };
}
