// Exterior / interior colour read from the page's own labelled "Exterior Color" / "Interior Color" fields.
//
// Confirmed live 2026-10-08 on three NJ Ford VDPs (Larson Ford, Mahwah Ford, All American Ford Point Pleasant — the
// "/new-<City>-<year>-<make>-<model>-<VIN>" URL shape): the page shows both colours in a spec list,
//   <span class="info__label">Exterior Color</span> <span class="info__value info__value--color" title="Avalanche Gray"> Avalanche Gray </span>
//   <span class="info__label">Interior Color</span> <span class="info__value info__value--color" title="Black Onyx"> Black Onyx </span>
// but its schema.org JSON-LD carries only `color` (and no vehicleInteriorColor), so the strategies that read JSON-LD left the
// interior blank on every one of these cars and, for older crawls, the exterior too. Only fills a blank: a value any
// stronger strategy already found is never replaced. A value that is not plain colour text is ignored (no guess).
const LABEL = (name) => new RegExp(`<[^>]*class="[^"]*\\binfo__label\\b[^"]*"[^>]*>\\s*${name}\\s*</[^>]+>\\s*<[^>]*class="[^"]*\\binfo__value\\b[^"]*"[^>]*>([\\s\\S]*?)</`, "i");

function textOf(raw) {
  const s = String(raw || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
  if (!s || s.length > 80) return null;
  if (/^(n\/?a|none|null|undefined|unknown|-+|tbd|call)$/i.test(s)) return null;
  return /^[A-Za-z0-9][A-Za-z0-9 \-/&.,'()]*$/.test(s) ? s : null;
}

/** { exteriorColor, interiorColor } read from the labelled spec list; null for a field the page does not state. */
export function readLabeledColors(html) {
  const text = String(html || "");
  const ext = LABEL("Exterior Colou?r").exec(text);
  const int = LABEL("Interior Colou?r").exec(text);
  return { exteriorColor: ext ? textOf(ext[1]) : null, interiorColor: int ? textOf(int[1]) : null };
}

/** Fills only blank colour fields on `vehicle` from the page's labelled colours. Returns the same object (or null/undefined as given). */
export function fillColorsFromLabels(vehicle, html) {
  if (!vehicle || !vehicle.vin) return vehicle;
  const found = readLabeledColors(html);
  if (!vehicle.exteriorColor && found.exteriorColor) vehicle.exteriorColor = found.exteriorColor;
  if (!vehicle.interiorColor && found.interiorColor) vehicle.interiorColor = found.interiorColor;
  return vehicle;
}
