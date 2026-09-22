// Recovers year/trim for Porsche VDPs whose own schema.org Vehicle JSON-LD
// is missing them, using only the VDP URL's own literal slug — never
// freeform page text. Confirmed live 2026-09-22: Champion Porsche's site
// (a generic Dealer.com/DealerOn template, not Porsche's official retailer
// platform) omits vehicleModelDate entirely and reports a bare nameplate in
// `model` ("911", "Macan"), while every VDP URL carries both, e.g.
// ".../vehicle-details-used-2020-porsche-911-carrera-cabriolet-...".
//
// Deliberately conservative — this crawler was burned before by guessing a
// field from unrelated page/URL text (a wrong "2029 Porsche 718" whose own
// URL actually said "cayenne-coupe"). Two independent gates keep that from
// happening here:
//   - model is only extended when the slug's own words start with the SAME
//     base model schema.org already reported (confirms the slug is
//     describing this vehicle, not something else on the page).
//   - beyond that agreement point, only words already in the recognized
//     Porsche trim/nameplate vocabulary (isKnownPorscheNameplateWord) are
//     folded in — a trailing stock-number fragment or other slug noise
//     stops the extension rather than getting treated as real data.
import { isKnownPorscheNameplateWord } from './modelNormalizer.js';

function cleanString(val) {
  if (!val || val === 'null' || val === 'undefined' || val === 'NULL' || val === 'None') return null;
  const str = val.toString().trim();
  return str === '' || str === 'null' ? null : str;
}

// { vehicleLd, url, dealer } -> { year: number|null, model: string|null }
// `model` is vehicleLd.model, possibly extended with slug words; never null
// if vehicleLd.model wasn't. `year` is vehicleLd.vehicleModelDate if present
// and valid, else a slug-derived fallback, else null.
export function enrichYearAndModelFromUrl({ vehicleLd, url, dealer }) {
  let year = vehicleLd.vehicleModelDate ? parseInt(vehicleLd.vehicleModelDate, 10) : null;
  if (!Number.isFinite(year)) {
    const slugYear = url.match(/vehicle-details-(?:used|new)-(\d{4})-/i);
    const y = slugYear ? parseInt(slugYear[1], 10) : null;
    if (y && y >= 1980 && y <= new Date().getFullYear() + 2) year = y;
  }

  let model = cleanString(vehicleLd.model);
  if (model) {
    const slugTail = url.match(/vehicle-details-(?:used|new)-\d{4}-([a-z0-9-]+)/i);
    if (slugTail) {
      let slugWords = slugTail[1].split('-').filter(Boolean);
      const makeLower = (vehicleLd.manufacturer?.name || dealer.make || '').toLowerCase();
      if (slugWords[0] && slugWords[0].toLowerCase() === makeLower) slugWords = slugWords.slice(1);
      const modelWords = model.toLowerCase().split(/\s+/);
      const slugWordsLower = slugWords.map((w) => w.toLowerCase());
      const startsWithModel = modelWords.length > 0 && modelWords.every((w, i) => slugWordsLower[i] === w);
      if (startsWithModel) {
        let extra = slugWords.slice(modelWords.length);
        let safeCount = 0;
        while (safeCount < extra.length && isKnownPorscheNameplateWord(extra[safeCount])) safeCount++;
        extra = extra.slice(0, safeCount);
        if (extra.length) {
          model = [...slugWords.slice(0, modelWords.length), ...extra]
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
        }
      }
    }
  }

  return { year: Number.isFinite(year) ? year : null, model };
}
