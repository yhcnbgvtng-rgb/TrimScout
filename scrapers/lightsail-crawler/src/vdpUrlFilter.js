// Extracted from standalone.js's fetchSitemapXmlUrls() so this filter (which decides
// which sitemap <loc> entries are worth fetching as a vehicle detail page) is unit
// testable — standalone.js itself is a self-running script with top-level awaits and no
// import-based test harness, same reason porscheUrlFields.js/vdpUrlTrim.js were split out.

const DDC_HASH_SLUG_RE = /-[a-f0-9]{32}\.htm/i;
const VEHICLE_DETAILS_RE = /\/vehicle-details/i;

// A used/CPO listing on a franchise dealer's lot is very often a trade-in of a DIFFERENT
// make (a Chevy dealer's used lot has Kias, Jeeps, Rams, etc.). On flat-slug platforms
// (DealerOn-style "cond-City-year-Make-Model-Trim-VIN", no /used/ path segment, no DDC
// hash) the only branch below that can match a used listing is the brand-specific VIN
// prefix check, which never fires for another make's VIN. Confirmed live 2026-09-27
// against Feldman Chevrolet of Livonia's real sitemap: cross-brand used trade-ins
// (Kia/Jeep/RAM/Hyundai) were being dropped before extraction ever ran, while same-brand
// used Chevrolets on the identical URL shape passed fine. A brand-agnostic VIN-shaped
// final path segment (valid VIN charset, excludes I/O/Q) catches these without needing
// to know the trade-in's make ahead of time. The VIN can be hyphen-suffixed onto a longer
// slug segment (DealerOn's shape above) OR be its own bare path segment, slash-delimited
// on both sides — confirmed live 2026-09-28 against Volkswagen of Hartford's real sitemap
// (a "Team Velocity/Apollo" platform, a third distinct URL family from the two above):
// /viewdetails/used/{vin}/{descriptive-slug} dropped a real used Porsche Taycan trade-in
// the exact same way, because the VIN there is preceded by "/", never "-".
const GENERIC_VIN_SLUG_RE = /[/-][A-HJ-NPR-Z0-9]{17}(?:[/?#]|$)/i;

/** Is this sitemap <loc> URL worth fetching as a candidate vehicle detail page? */
export function isLikelyVdpUrl(url, brand) {
    const brandWord = brand.name.toLowerCase();
    const vinPattern = brand.vinPrefixes.map((p) => `${p}[A-Z0-9]{13,14}`).join('|');
    return (
        DDC_HASH_SLUG_RE.test(url) ||
        VEHICLE_DETAILS_RE.test(url) ||
        new RegExp(`\\/inventory\\/(?:new|used|certified|${brandWord}|all)`, 'i').test(url) ||
        new RegExp(`\\/(?:new|used|certified|cpo)\\/(?:${brand.name}|inventory)\\/`, 'i').test(url) ||
        new RegExp(vinPattern, 'i').test(url) ||
        GENERIC_VIN_SLUG_RE.test(url)
    );
}
