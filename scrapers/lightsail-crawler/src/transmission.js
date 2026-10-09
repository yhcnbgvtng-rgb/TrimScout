// One spelling per transmission, so search facets and the Ford sticker backfill agree.
//
//   "10-Speed Automatic Transmission", "10-Speed A/T", "10-Speed Automatic w/OD", "10-Speed Shiftable Automatic" -> "10-Speed Automatic"
//   "7 speed manual" -> "7-Speed Manual"      any CVT / eCVT / power-split -> "CVT"      bare "Automatic" / "Manual" stay as they are
//
// Two entry points:
//   normalizeTransmission(raw)        lenient, for ingest: a value we do not recognise is kept (trimmed), never dropped or guessed at.
//   normalizeTransmissionStrict(raw)  for filling a blank from a sticker: null unless the text is fully understood.
// Both are idempotent (a canonical value maps to itself).

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

const CVT_RE = /\b(?:e-?cvt|cvt|continuously variable|power-?split)\b/;
const DUAL_RE = /\bdual[- ]clutch\b|\bdct\b|\bpdk\b/;
const AUTOMATED_MANUAL_RE = /\bautomated[- ]manual\b/;
const SINGLE_RE = /\bsingle[- ]speed\b/;
// "10-speed", "10 spd", "10spd", "ten-speed", and the "7S" Ford prints for dual-clutch units.
const SPEED_RE = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*-?\s*(?:speed|spd|s)\b/;
const AUTO_RE = /\bauto(?:matic)?\b|\ba\/t\b|\bat\b|torqshift|select-?shift|slctshft|shiftable|steptronic|tiptronic/;
const MANUAL_RE = /\bmanual\b|\bm\/t\b|\bmt\b/;

function kind(s) {
  if (CVT_RE.test(s)) return "CVT";
  if (AUTOMATED_MANUAL_RE.test(s)) return "Automated Manual";
  const dual = DUAL_RE.test(s);
  const hasAuto = AUTO_RE.test(s);
  const hasManual = MANUAL_RE.test(s);
  if (dual) return "Dual Clutch";
  if (hasManual && !hasAuto) return "Manual";
  if (hasAuto) return "Automatic"; // "Automatic with manual shift mode" is still an automatic
  return null;
}

/** { value, known }: value is the canonical spelling when known, else the trimmed input (null when empty). */
function normalize(raw) {
  const original = String(raw ?? "").replace(/[®™]/g, "").replace(/\s+/g, " ").trim();
  if (!original) return { value: null, known: false };
  const s = original.toLowerCase();
  const k = kind(s);
  if (k === "CVT") return { value: "CVT", known: true };
  if (SINGLE_RE.test(s) || /\b1[- ]?(?:speed|spd)\b/.test(s)) return { value: "Single-Speed", known: true };
  const m = SPEED_RE.exec(s);
  let speeds = m ? (WORD_NUM[m[1]] ?? Number(m[1])) : null;
  if (speeds !== null && (speeds < 1 || speeds > 12)) speeds = null;
  // "7S" alone is only a speed count on a dual-clutch line; anywhere else it is too ambiguous to read.
  if (speeds !== null && /^\d{1,2}\s*s$/.test(m[0].trim()) && k !== "Dual Clutch") speeds = null;
  if (k && speeds !== null) return { value: `${speeds}-Speed ${k}`, known: true };
  if (k === "Dual Clutch") return { value: "Dual Clutch", known: true };
  // No speed count: only the bare words are canonical ("Automatic", "Manual"); anything longer is kept as printed.
  if ((k === "Automatic" || k === "Manual") && speeds === null && /^(?:auto(?:matic)?|manual|automatic transmission|manual transmission|a\/t|m\/t)$/.test(s)) return { value: k, known: true };
  if (k === "Automatic" && speeds === null && !/\d/.test(s) && !/\b(?:cvt)\b/.test(s)) return { value: k, known: true };
  if (k === "Manual" && speeds === null && !/\d/.test(s)) return { value: k, known: true };
  return { value: original, known: false };
}

export function normalizeTransmission(raw) {
  return normalize(raw).value;
}

export function normalizeTransmissionStrict(raw) {
  const r = normalize(raw);
  return r.known ? r.value : null;
}
