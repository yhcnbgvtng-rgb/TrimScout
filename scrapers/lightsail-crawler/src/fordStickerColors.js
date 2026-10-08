// Exterior paint and interior trim/colour as printed on a Ford window sticker (Ford Direct's public PDF:
// https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=<VIN>, no key, no login).
//
// The sticker's "VEHICLE DESCRIPTION" block is fixed-width, one fact per line, in this shape (text extracted from the PDF):
//   VEHICLE DESCRIPTION
//   MUSTANG T5 136280
//   2026 ECOBOOST COUPE PREMIUM EXTERIOR            <- trim line, ends in the word EXTERIOR
//   4-PASSENGER SPORTS CAR SHADOW BLACK             <- <seats/body/wheelbase words> <PAINT>
//   2.3L ECOBOOST INTERIOR                          <- engine line, ends in the word INTERIOR
//   10-SPD AUTO TRANSMISSION EMBERGLO ACTIVEX TRM   <- <transmission words> <INTERIOR TRIM>
// So the paint is whatever follows the seats/body/wheelbase words on the line after "... EXTERIOR", and the interior is whatever
// follows the transmission words on the line after "... INTERIOR". Both lines are truncated by Ford to the column width
// ("STAR WHITE MET TRI-COAT", "DARK SPACE GRAY CLTH TRIM S"); we keep them as printed and never complete or guess a word.
// A line that does not fit the shape returns null for that field — a miss, not a best guess.

// Words that end the "seats / body / wheelbase" lead-in on the paint line. The paint is what comes after the LAST one.
// (4-PASSENGER SPORTS CAR <PAINT>, 119" WHEELBASE <PAINT>, XL 164" WB STYLESIDE <PAINT>, BIG BEND - 5 PASSENGER <PAINT>.)
const PAINT_LEAD_END = /^(?:.*\b(?:PASSENGER|WHEELBASE|WB|STYLESIDE|FLARESIDE|SPORTS CAR)\b)\s+(.+)$/;
// Where the transmission description ends on the interior line. Earliest match wins; longer phrases listed first.
const TRANS_END = /^(?:.*?\b(?:TRANS W\/SLCTSHFT|TRANSMISSION|TRANS|TRAN|TORQSHIFT-G|TORQSHIFT|CVT)\b)\s+(.+)$/;

const clean = (s) => s.replace(/\s+/g, " ").trim();
// Printed upper case -> the Title Case the rest of our colour data uses ("Shadow Black"), splitting on spaces, "-" and "/".
function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s\-/])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}
// Only plain label text: letters, digits and the few separators these lines use. Anything else (barcode noise) is a miss.
const SANE = /^[A-Z0-9][A-Z0-9 \-/&.,'()]*$/;

function lineAfter(lines, endsWith) {
  const i = lines.findIndex((l) => new RegExp(`\\b${endsWith}$`).test(l.trim()));
  return i >= 0 ? clean(lines[i + 1] || "") : "";
}

/** { exteriorColor, interiorColor } from the extracted sticker text. Each is null when its line is absent or unrecognised. */
export function parseStickerColors(text) {
  const all = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const start = all.findIndex((l) => l === "VEHICLE DESCRIPTION");
  if (start < 0) return { exteriorColor: null, interiorColor: null };
  const lines = all.slice(start + 1, start + 9);
  let exterior = null;
  const paintLine = lineAfter(lines, "EXTERIOR");
  const p = paintLine && PAINT_LEAD_END.exec(paintLine);
  if (p && SANE.test(p[1])) exterior = titleCase(p[1]);
  let interior = null;
  const interiorLine = lineAfter(lines, "INTERIOR");
  const t = interiorLine && TRANS_END.exec(interiorLine);
  if (t && SANE.test(t[1])) interior = titleCase(t[1]);
  return { exteriorColor: exterior, interiorColor: interior };
}

export const STICKER_URL = "https://www.windowsticker.forddirect.com/windowsticker.pdf";
export const stickerUrlForVin = (vin) => `${STICKER_URL}?vin=${encodeURIComponent(String(vin).trim().toUpperCase())}`;
