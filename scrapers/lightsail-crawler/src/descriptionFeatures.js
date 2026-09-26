// Extracted from standalone.js (2026-09-26) — pure move, no logic change —
// so this can be unit-tested directly. It was previously an internal
// function inside standalone.js (a self-running script, not an importable
// module), which is exactly why it sat fully built and correctly guarded
// but was never actually wired into extractSchemaOrgVehicle: there was no
// way to write a fixture-backed regression test against it without this
// extraction, matching the pattern already established for
// porscheUrlFields.js/porscheSchemaOrgFields.js/vdpUrlTrim.js.

// Boilerplate that shows up at the end of DealerOn (and similar) VDP
// descriptions, unrelated to the actual vehicle — fees, disclaimers, taxes.
// Everything from the first match onward is dropped before feature parsing.
const DESCRIPTION_BOILERPLATE_MARKERS = [
    /plus government fees/i,
    /dealer document (processing )?charge/i,
    /price does not include/i,
    /see dealer for details/i,
    /\*.*disclaimer/i,
];

// Universal baseline equipment that a standard third-party data provider
// (the same vocabulary appears verbatim across many dealer platforms,
// including the Dealer.com "packageName: null" bucket found earlier) lists
// for every vehicle regardless of trim or options — Air Conditioning, Power
// windows, ABS brakes, etc. Some dealer VDP descriptions dump this entire
// list rather than a curated highlights reel; presenting it as this car's
// distinguishing "installed options" would be exactly the fabrication this
// scraper exists to avoid. Filtered out case-insensitively; whatever
// survives is presumed to be genuinely distinguishing.
const GENERIC_BASELINE_EQUIPMENT = new Set([
    '10 speakers', '4-wheel disc brakes', 'abs brakes', 'adaptive suspension',
    'air conditioning', 'alloy wheels', 'apple carplay & android auto',
    'apple carplay', 'android auto', 'artificial leather seat trim',
    'auto high-beam headlights', 'auto-dimming door mirrors',
    'auto-dimming rear-view mirror', 'auto-leveling suspension',
    'automatic temperature control', 'brake assist', 'bumpers: body-color',
    'compass', 'delay-off headlights', 'driver door bin',
    'driver vanity mirror', 'dual front impact airbags',
    'dual front side impact airbags', 'electronic stability control',
    'exterior parking camera rear', 'four wheel independent suspension',
    'front anti-roll bar', 'front bucket seats', 'front center armrest',
    'front dual zone a/c', 'front reading lights', 'fully automatic headlights',
    'garage door transmitter: homelink', 'heated door mirrors',
    'heated front seats', 'heated steering wheel', 'illuminated entry',
    'knee airbag', 'leather seat trim', 'leather steering wheel',
    'low tire pressure warning', 'memory seat', 'occupant sensing airbag',
    'outside temperature display', 'overhead airbag', 'overhead console',
    'panic alarm', 'passenger door bin', 'passenger vanity mirror',
    'power door mirrors', 'power driver seat', 'power passenger seat',
    'power steering', 'power windows', 'radio data system',
    'rain sensing wipers', 'rear anti-roll bar', 'rear fog lights',
    'rear reading lights', 'rear seat center armrest',
    'rear side impact airbag', 'rear window defroster',
    'remote keyless entry', 'security system', 'speed control',
    'speed-sensing steering', 'split folding rear seat', 'spoiler',
    'steering wheel mounted audio controls', 'telescoping steering wheel',
    'tilt steering wheel', 'traction control', 'trip computer',
    'variably intermittent wipers', 'bluetooth®', 'bluetooth',
    'mp3 player', 'ipod/mp3 input', 'keyless entry',
    'remote trunk release', 'back-up camera', 'satellite radio',
    'navigation', 'nav system', 'porsche communication management',
    'navigation system', 'am/fm radio: siriusxm', 'am/fm radio',
    'rear air conditioning', 'rear window wiper', 'sport steering wheel',
    'tachometer', 'turn signal indicator mirrors',
    'emergency communication system', 'leather shift knob',
    'standard seat trim', 'voltmeter', 'audio memory', 'hvac memory',
]);

// Some descriptions end with a duplicated/truncated title fragment
// ("2026 Porsche Macan S 2026 Porsche Macan") rather than a real feature —
// an artifact of how the field was assembled, not vehicle content.
const SPEAKER_COUNT_PATTERN = /^\d+ speakers$/i;
const DUPLICATED_TITLE_PATTERN = /^\d{4} porsche .+ \d{4} porsche/i;

// Some dealers write flowing marketing prose instead of a feature list
// ("Porsche North Houston is delighted to showcase this Panamera... We
// invite you to Activate Your Ownership with us today!"). Splitting that
// on commas/periods produces sentence fragments, not features — worse than
// no data. These are strong, specific markers that a description is
// marketing narrative rather than a structured list; when present, skip
// extraction entirely rather than emit fragments.
const MARKETING_PROSE_MARKERS = [
    /we invite you/i,
    /activate your ownership/i,
    /is delighted to/i,
    /trade-in proposals/i,
    /finance department/i,
    /detailing department/i,
    /accessories boutique/i,
    /simply call/i,
    /if you like this vehicle/i,
];

// Extracts a real, dealer-published feature list from a VDP's free-text
// description field (used on DealerOn and similar platforms). This is
// genuinely written by the dealer for this specific vehicle, but unlike
// Dealer.com's structured packages it has no per-item price or code — just
// names. Represented with price: 0 (unknown, not "free") and a distinct
// category so it's never confused with itemized, priced packages.
//
// Also the safety net for the exact garbage case that used to justify
// never calling this at all: an undelimited third-party spec-sheet dump
// ("Standard EquipmentMECHANICALFull-Time All-Wheel3.36 Axle Ratio...")
// has no commas/periods/newlines to split on, so it becomes ONE token far
// longer than the 60-char cap below and is discarded, not shipped as a
// mashed-together "feature."
export function parseFeaturesFromDescription(description) {
    if (!description) return [];
    if (MARKETING_PROSE_MARKERS.some((marker) => marker.test(description))) return [];

    let text = description;
    for (const marker of DESCRIPTION_BOILERPLATE_MARKERS) {
        const idx = text.search(marker);
        if (idx !== -1) text = text.slice(0, idx);
    }

    text = text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/KEY FEATURES INCLUDE/gi, '\n')
        .replace(/<[^>]+>/g, ' ');

    let rawItems = text.split(/[\n,.]/).map((s) => s.trim());

    // Some descriptions mix a genuine bulleted feature list with trailing
    // prose in the same field ("- Sport Chrono Package ... The vehicle has
    // been freshly detailed ... All prices plus sales tax..."). When most
    // items are clearly bulleted, trust only the bulleted ones.
    const bulletedCount = rawItems.filter((s) => /^[-•]\s/.test(s)).length;
    if (bulletedCount >= 3) {
        rawItems = rawItems.filter((s) => /^[-•]\s/.test(s)).map((s) => s.replace(/^[-•]\s+/, ''));
    }

    const seen = new Set();
    const features = [];
    for (const item of rawItems) {
        const clean = item.replace(/\s+/g, ' ').trim();
        if (clean.length < 3 || clean.length > 60) continue;
        const key = clean.toLowerCase();
        if (GENERIC_BASELINE_EQUIPMENT.has(key)) continue;
        if (SPEAKER_COUNT_PATTERN.test(key) || DUPLICATED_TITLE_PATTERN.test(key)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        features.push({ code: 'FEATURE', name: clean, price: 0, category: 'feature' });
    }
    return features;
}
