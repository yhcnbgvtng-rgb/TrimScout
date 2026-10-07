// Recovers a BLANK model (and a blank trim) from the listing page itself, for any make, after every extraction
// strategy has run. Confirmed 2026-10: ~1.2% of in-stock rows (Audi, Hyundai, Nissan, Toyota, Ford, Honda ...) arrive with
// year + make but no model, e.g. Honda 2026/2027 rows whose VINs decode cleanly on vPIC (19XFL4H93TE029208 = Civic Sport
// Touring, 5J6RS4H76VL005102 = CR-V EX-L) while the listing's own title / URL / JSON-LD say so.
//
// Rules (same philosophy as vdpUrlTrim.js and vinModelFill.js — never guess):
//   - NEVER overwrites a non-empty model or trim; callers only invoke this for a blank one.
//   - A model is only ever one of the names the database already uses for that make (knownModels.js), written in that
//     spelling, found right after "<year> <make>" in the page's own text. The one exception is a schema.org Vehicle/Car
//     `model` field (structured data the dealer sent), accepted when it is short and not generic.
//   - Sources, strongest first: JSON-LD model -> JSON-LD name -> <title>/og:title/<h1> -> JSON-LD BreadcrumbList ->
//     VDP URL slug -> an HTML spec row ("Model: Civic"). The first that yields a model wins.
//   - Trim is the words after the model in the same text (<= 4 words), only when trim is blank; trailing body-style words,
//     "in <city>", "for sale", prices and the VIN are dropped.
//
// To regenerate knownModels.js:
//   SELECT make, model FROM dealer_inventory WHERE removed_at IS NULL AND model <> '' GROUP BY make, model HAVING COUNT(*) >= 25;
import { KNOWN_MODELS } from './knownModels.js';

const MAX_TRIM_WORDS = 4;
const GENERIC = new Set(['new', 'used', 'certified', 'pre-owned', 'preowned', 'cpo', 'vehicle', 'car', 'truck', 'suv', 'sedan', 'coupe', 'inventory', 'n/a', 'na', 'null', 'undefined', 'unknown', 'other']);
const BODY_WORDS = new Set(['sedan', 'coupe', 'suv', 'hatchback', 'wagon', 'convertible', 'truck', 'van', 'minivan', 'crew', 'cab', 'pickup', 'sportback', 'fastback']);
const STOP_WORDS = new Set(['in', 'for', 'at', 'near', 'by', 'from', 'with', 'vin', 'stock', 'sale', 'price', 'priced', 'msrp', 'only', 'new', 'used', 'certified']);

const tokens = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);

// make -> [{ name, toks }] longest model first, so "Grand Cherokee L" is tried before "Grand Cherokee" before "Cherokee".
const VOCAB = new Map();
for (const [make, models] of Object.entries(KNOWN_MODELS)) {
  VOCAB.set(make.toLowerCase(), models.map((name) => ({ name, toks: tokens(name) })).filter((m) => m.toks.length).sort((a, b) => b.toks.length - a.toks.length));
}

/** The known model that starts `words` (an array of original-case words), plus the words left over after it. */
export function matchKnownModel(make, words) {
  const vocab = VOCAB.get(String(make || '').toLowerCase());
  if (!vocab || !words.length) return null;
  // A model name's own tokens are matched against the words' tokens, so "CR-V" (cr, v) matches the single word "CR-V".
  const flat = []; const owner = [];
  words.forEach((w, i) => { for (const t of tokens(w)) { flat.push(t); owner.push(i); } });
  for (const m of vocab) {
    if (flat.length < m.toks.length) continue;
    if (m.toks.every((t, i) => flat[i] === t)) {
      const lastWord = owner[m.toks.length - 1];
      // The match must end on a word boundary ("CR-V" must not match the word "CR-VX").
      if (owner[m.toks.length] === lastWord) continue;
      return { model: m.name, rest: words.slice(lastWord + 1) };
    }
  }
  return null;
}

// "<year> <make> <rest...>" -> the words after the make, or null when this text does not contain the make.
function wordsAfterMake(text, make) {
  const words = String(text || '').replace(/[|,;()\[\]]/g, ' ').split(/\s+/).filter(Boolean);
  const makeToks = tokens(make).map((t) => t.replace(/[^a-z0-9]/g, ''));
  if (!makeToks.length) return null;
  for (let i = 0; i + makeToks.length <= words.length; i++) {
    const slice = words.slice(i, i + makeToks.length).map((w) => tokens(w).join(''));
    if (makeToks.every((mt, k) => slice[k] === mt)) return words.slice(i + makeToks.length);
  }
  return null;
}

function cleanTrimWords(words) {
  const out = [];
  for (const w of words) {
    const lw = w.toLowerCase().replace(/[^a-z0-9+/-]/g, '');
    if (!lw) continue;
    if (STOP_WORDS.has(lw) || /^\$?\d[\d,]*$/.test(lw) && lw.length > 3) break;
    if (/^[A-HJ-NPR-Z0-9]{17}(\.[a-z]+)?$/i.test(w)) break;
    if (/^(19|20)\d\d$/.test(lw)) break;
    out.push(w);
    if (out.length >= MAX_TRIM_WORDS) break;
  }
  // Drop trailing body-style words ("Sport Touring Sedan" -> "Sport Touring"); a trim that is only a body word is nothing.
  while (out.length && BODY_WORDS.has(out[out.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) out.pop();
  const trim = out.join(' ').replace(/[+]/g, ' ').replace(/\s+/g, ' ').trim();
  return trim && trim.length <= 40 ? trim : null;
}

function fromText(text, vehicle, source) {
  const after = wordsAfterMake(text, vehicle.make);
  if (!after) return null;
  const hit = matchKnownModel(vehicle.make, after);
  if (!hit) return null;
  return { model: hit.model, trim: cleanTrimWords(hit.rest), source };
}

const textOf = (node) => (typeof node === 'string' ? node : node && typeof node === 'object' ? node.name || node['@id'] || '' : '');

function jsonLdBlocks(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (stack.length) {
        const n = stack.pop();
        if (!n || typeof n !== 'object') continue;
        out.push(n);
        if (Array.isArray(n['@graph'])) stack.push(...n['@graph']);
      }
    } catch { /* malformed block: ignore */ }
  }
  return out;
}
const hasType = (n, re) => [].concat(n['@type'] || []).some((t) => re.test(String(t)));

function sanityModel(raw, vehicle) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // strip a leading "<year> <make> " the dealer baked in
  const words = s.split(' ');
  if (/^(19|20)\d\d$/.test(words[0])) words.shift();
  const mk = tokens(vehicle.make);
  if (mk.length && words.slice(0, mk.length).map((w) => tokens(w).join('')).join(' ') === mk.join(' ')) words.splice(0, mk.length);
  s = words.join(' ').trim();
  if (!s || s.length > 30 || s.split(' ').length > 3) return null;
  if (GENERIC.has(s.toLowerCase()) || /^\d+$/.test(s) || tokens(s).join('') === tokens(vehicle.make).join('')) return null;
  return s;
}

/**
 * @param {{vehicle: {make?: string, year?: number, model?: string|null, trim?: string|null}, html?: string, url?: string}} p
 * @returns {{model: string|null, trim: string|null, source: string} | null}  null when nothing trustworthy was found.
 */
export function recoverModelTrim({ vehicle, html = '', url = '' } = {}) {
  if (!vehicle || !vehicle.make) return null;
  const blocks = jsonLdBlocks(html);
  const vehicles = blocks.filter((n) => hasType(n, /^(Vehicle|Car|Product)$/i));

  // 1. structured model field
  for (const n of vehicles) {
    const raw = typeof n.model === 'string' ? n.model : textOf(n.model);
    const known = raw ? matchKnownModel(vehicle.make, String(raw).split(/\s+/).filter(Boolean)) : null;
    if (known) return { model: known.model, trim: cleanTrimWords(known.rest), source: 'jsonld-model' };
    const s = sanityModel(raw, vehicle);
    if (s) return { model: s, trim: null, source: 'jsonld-model' };
  }
  // 2. structured name ("2026 Honda Civic Sport Touring")
  for (const n of vehicles) { const r = fromText(textOf(n), vehicle, 'jsonld-name'); if (r) return r; }
  // 3. page title, og:title, first h1
  const heads = [];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (title) heads.push(title[1]);
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i); if (og) heads.push(og[1]);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); if (h1) heads.push(h1[1].replace(/<[^>]+>/g, ' '));
  for (const h of heads) { const r = fromText(h.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'"), vehicle, 'title'); if (r) return r; }
  // 4. breadcrumb list: an element that is exactly (or starts with) a known model
  for (const n of blocks.filter((b) => hasType(b, /^BreadcrumbList$/i))) {
    for (const el of [].concat(n.itemListElement || [])) {
      const name = textOf(el.item) || textOf(el) || el.name || '';
      const hit = matchKnownModel(vehicle.make, String(name).split(/\s+/).filter(Boolean));
      if (hit) return { model: hit.model, trim: cleanTrimWords(hit.rest), source: 'breadcrumb' };
    }
  }
  // 5. VDP URL slug, "...2026-honda-civic-sport-touring-<vin>..." (separators may be - + _ /)
  if (url) {
    let decoded = url; try { decoded = decodeURIComponent(url); } catch { /* keep raw */ }
    const path = decoded.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '');
    const r = fromText(path.replace(/[\/+_-]+/g, ' '), vehicle, 'url');
    // Slugs lose hyphens and case ("ex-l" -> "ex l"), so only the model is taken from a URL; vdpUrlTrim.js reads the trim.
    if (r) return { model: r.model, trim: null, source: 'url' };
  }
  // 6. an HTML spec row: <dt>Model</dt><dd>Civic</dd>, <th>Model</th><td>Civic</td>, <span>Model:</span> Civic
  const spec = html.match(/>\s*Model\s*:?\s*<\/[a-z0-9]+>\s*<[a-z0-9][^>]*>\s*([^<]{1,40}?)\s*</i) || html.match(/\bModel\s*:\s*([A-Za-z0-9][A-Za-z0-9 \-]{0,30})/);
  if (spec) {
    const hit = matchKnownModel(vehicle.make, spec[1].split(/\s+/).filter(Boolean));
    if (hit) return { model: hit.model, trim: cleanTrimWords(hit.rest), source: 'spec-row' };
  }
  return null;
}

/**
 * Trim only, for a vehicle that HAS a model but a blank trim, from the same page text (the URL-slug route in
 * vdpUrlTrim.js is tried separately). Returns { trim, source } or null.
 */
export function recoverTrim({ vehicle, html = '' } = {}) {
  if (!vehicle || !vehicle.make || !vehicle.model) return null;
  const modelWords = String(vehicle.model).split(/\s+/).filter(Boolean);
  const candidates = [];
  for (const n of jsonLdBlocks(html).filter((b) => hasType(b, /^(Vehicle|Car|Product)$/i))) candidates.push(['jsonld-name', textOf(n)]);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (title) candidates.push(['title', title[1]]);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); if (h1) candidates.push(['title', h1[1].replace(/<[^>]+>/g, ' ')]);
  const want = tokens(modelWords.join(' ')).join(' ');
  for (const [source, text] of candidates) {
    const after = wordsAfterMake(text, vehicle.make);
    if (!after) continue;
    // the page's model words must equal the stored model, then the trim is what follows
    let acc = []; let i = 0;
    while (i < after.length && tokens(acc.join(' ')).join(' ').length < want.length) { acc.push(after[i]); i++; }
    if (tokens(acc.join(' ')).join(' ') !== want) continue;
    const trim = cleanTrimWords(after.slice(i));
    if (trim) return { trim, source };
  }
  return null;
}
