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
// The transmission words come off the same interior line (no extra request); normalizeTransmissionStrict turns them into e.g.
// "10-Speed Automatic", or null when they are not fully understood.
// A line that does not fit the shape returns null for that field — a miss, not a best guess.

import { normalizeTransmissionStrict } from "./transmission.js";

// Words that end the "seats / body / wheelbase" lead-in on the paint line. The paint is what comes after the LAST one.
// (4-PASSENGER SPORTS CAR <PAINT>, 119" WHEELBASE <PAINT>, XL 164" WB STYLESIDE <PAINT>, BIG BEND - 5 PASSENGER <PAINT>.)
const PAINT_LEAD_END = /^(?:.*\b(?:PASSENGER|WHEELBASE|WB|STYLESIDE|FLARESIDE|SPORTS CAR|CAB)\b)\s+(.+)$/;
// Where the transmission description ends on the interior line. Earliest match wins; longer phrases listed first.
// Group 1 is the transmission as printed (through its ending word), group 2 the interior that follows.
const TRANS_END = /^(.*?\b(?:TRANS W\/SLCTSHFT|TRANSMISSION|TRANS|TRAN|TORQSHIFT-G|TORQSHIFT|CVT))\s+(.+)$/;

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

// Interior trim words Ford prints after (or before) the colour: material, seat/trim wording, and abbreviations of them.
// Stripped repeatedly from the end, then once from the start, until only the colour name is left.
const INTERIOR_TAIL = /\s+(?:ACTIVE-?X(?:\s+SEAT(?:\s+MTRL|\s+MATERIAL)?|\s+TRIM(?:MED)?|\s+TRM|\s+TRI)?|PERFORATED\s+ACTIVEX|PERFORATED|ACTIV|LTH\s+SEAT\s+SURF|LEATHER\s+SEATING\s+SURFACE|LEA-TRIM|LEATHER-TRIM(?:\s+SEATS)?|LEATHER\s+TRM\s+40\/CON\/40|CLOTH\s+40\/20\/40|PREMIUM\s+TRIM|TR|UNIQUE\s+CLOTH(?:\s+SEATS|\s+STS)?|STX\s+CLOTH\s+40\/CON\/40|CLOTH\s+40\/CON\/40|CLOTH\/VINYL\s+TRIM|CLOTH(?:\s+SEATS|\s+STS)?|CLTH\s+TRIM\s+S|LEATHER(?:-TRIMMED|\s+TRI)?|LTH-TRM(?:\s+RECRO)?|VINYL|TRIMMED|TRIM\s+SEATS|TRIM|TRM|SEATS|STS|MIKO\s+INSERTS|INSERTS)$/;
const INTERIOR_HEAD = /^(?:PLAID\s+)?(?:LTH-TRM\/VINYL|LTHR-TRIM\/VINYL|CLOTH|LEATHER|VINYL)\s+/;
// Abbreviations Ford prints in colour names that are attested in full on other stickers ("ULT DK SPC GRY" = Ultra Dark Space Gray).
const ABBREV = { BLK: "BLACK", EBNY: "EBONY", ULT: "ULTRA", DK: "DARK", DRK: "DARK", SPC: "SPACE", GRY: "GRAY", MED: "MEDIUM", LT: "LIGHT" };
// Colour words that must remain for a result to count as a colour name (a line that ends up with none is a miss, not a guess).
const COLOR_WORD = /\b(?:BLACK|GRAY|GREY|WHITE|ONYX|EBONY|SLATE|EMBERGLO|NAVY|PIER|RED|BLUE|TAN|BROWN|SAND|CAMEL|SADDLE|BEIGE|IVORY|PALAZZO|CHARCOAL|SILVER|GREEN|ORANGE|PRFM|SPACE|TRUFFLE|SMOKED|ROAST|BRONZE|BAJA|DUNE|JAVA|MESA|LIME|TEAL)\b/;

/**
 * "Black Onyx Cloth/Vinyl Trim" -> "Black Onyx", "Emberglo Activex Trm" -> "Emberglo". Works on the printed text (any case).
 * Returns null when nothing colour-like is left or an abbreviation we do not know remains ("EBNY PART VNL/CLTH&RED STCH"):
 * the raw sticker text is kept next to it by the caller, and the row's interior stays blank rather than get a half-cleaned value.
 */
export function normalizeInterior(raw) {
  let s = clean(String(raw || "")).toUpperCase();
  if (!s) return null;
  for (let i = 0; i < 4 && INTERIOR_TAIL.test(s); i++) s = s.replace(INTERIOR_TAIL, "");
  s = s.replace(INTERIOR_HEAD, "");
  s = clean(s.replace(/[A-Z]+/g, (w) => ABBREV[w] || w));
  if (!s || !SANE.test(s) || !COLOR_WORD.test(s)) return null;
  // Leftover wording that is not a colour (an unrecognised trim or abbreviation) means the line was not fully understood.
  if (/\b(?:CLOTH|CLTH|VNL|VINYL|LTH|LEATHER|TRIM|TRM|SEATS?|STS|STCH|PART)\b|&/.test(s)) return null;
  return titleCase(s);
}

/**
 * { exteriorColor, interiorColor, exteriorRaw, interiorRaw } from the extracted sticker text. exteriorColor / interiorColor are the
 * cleaned colour names (interior via normalizeInterior); the *Raw fields are the printed text, Title Cased, for audit. Each is null
 * when its line is absent or unrecognised.
 */
export function parseStickerColors(text) {
  const all = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const start = all.findIndex((l) => l === "VEHICLE DESCRIPTION");
  if (start < 0) return { exteriorColor: null, interiorColor: null, exteriorRaw: null, interiorRaw: null, transmission: null, transmissionRaw: null };
  const lines = all.slice(start + 1, start + 9);
  let exterior = null;
  const paintLine = lineAfter(lines, "EXTERIOR");
  const p = paintLine && PAINT_LEAD_END.exec(paintLine);
  if (p && SANE.test(p[1])) exterior = normalizeExterior(titleCase(p[1]));
  let interior = null;
  let transmissionRaw = null;
  const interiorLine = lineAfter(lines, "INTERIOR");
  const t = interiorLine && TRANS_END.exec(interiorLine);
  if (t && SANE.test(t[2])) interior = titleCase(t[2]);
  // The transmission words lead the same line (the printed text can carry a ® etc., so it is not held to SANE; the normalizer decides).
  if (t) transmissionRaw = clean(t[1]) || null;
  return { exteriorColor: exterior, interiorColor: interior ? normalizeInterior(interior) : null, exteriorRaw: exterior, interiorRaw: interior, transmission: normalizeTransmissionStrict(transmissionRaw), transmissionRaw };
}

/** Paint with any body/cab wording that rode along on the line removed ("Chassis Cab Oxford White" -> "Oxford White"). */
export function normalizeExterior(raw) {
  const s = clean(String(raw || "")).replace(/^(?:CHASSIS\s+)?CAB\s+/i, "");
  return s || null;
}

export const STICKER_URL = "https://www.windowsticker.forddirect.com/windowsticker.pdf";
export const stickerUrlForVin = (vin) => `${STICKER_URL}?vin=${encodeURIComponent(String(vin).trim().toUpperCase())}`;
