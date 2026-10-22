// Pure ingest rules shared by every extraction strategy, applied before a row is written.
// Three defects came out of the 2026-10 inventory audit; each rule below is the "only real data
// gets stored" side of one of them.
//
//   1. Miles: a used/CPO listing with no odometer was stored as 0 (every strategy defaulted to 0),
//      which reads as "brand-new odometer" in search and sorts. Absent is now null.
//   2. Price: a lease/payment figure ("$299/mo") was stored as the vehicle's price/MSRP.
//   3. Window sticker: icon/button assets ("window-sticker.svg") were stored as the sticker link.
//
// Deliberately NOT here (explicitly out of scope): dropping "Removed"/"Parsed from", clamping
// "On site since", collapsing duplicate VINs across dealers, reclassifying high-mile new as used,
// and any blanket "reject price under $3,000" rule — cheap used cars are real.

const USED_LIKE_RE = /used|pre-?owned|cpo|certified/i;
const NEW_RE = /^\s*new\s*$/i;

/** True for USED / CERTIFIED_PRE_OWNED / CPO / "Pre-Owned" style condition labels. */
export function isUsedLikeCondition(inventoryType) {
  return typeof inventoryType === 'string' && USED_LIKE_RE.test(inventoryType);
}

/**
 * The odometer reading as the page stated it: a finite number >= 0, or null when the page gave
 * nothing usable. Callers must pass the RAW value (undefined/null/"" mean "page had no odometer")
 * and never a `|| 0` default — that default is the bug this module exists to remove.
 */
export function readOdometer(raw) {
  if (raw === null || raw === undefined) return null;
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^\d.]/g, ''));
  if (typeof raw === 'string' && raw.trim() === '') return null;
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
}

/**
 * The mileage to store. `odometer` is readOdometer()'s output (null = page had none).
 *   - used / CPO: null when there is no odometer. An exact 0 is also null: a used listing that
 *     "shows" 0 is a platform default (DDC emits odometer "0" for used cars it has no reading for),
 *     and a real used car never sits at exactly 0 miles.
 *   - new (or an unrecognised condition): a stated 0 is kept; an absent odometer stays 0 for new
 *     cars, as before, and null for an unrecognised condition.
 */
export function resolveMileage(odometer, inventoryType) {
  const value = readOdometer(odometer);
  if (isUsedLikeCondition(inventoryType)) return value === null || value === 0 ? null : value;
  if (value === null) return typeof inventoryType === 'string' && NEW_RE.test(inventoryType) ? 0 : null;
  return value;
}

// Payment/lease copy markers. A number followed (or, for "down", preceded) by one of these is a
// monthly payment or drive-off amount, never the price of the car.
const PAYMENT_AFTER_RE = /^[\s*+†‡]{0,3}(?:\/\s*(?:mo|month)\b|per\s+month\b|a\s+month\b|monthly\b|mo\b\.?|down\b|due\s+at\s+(?:signing|delivery)\b)/i;
const PAYMENT_BEFORE_RE = /(?:down\s+payment|payment|lease|monthly|per\s+month)[^\d]{0,16}$/i;

/** True when `text` reads as lease/payment copy ("$299/mo", "299 per month", "$2,999 down"). */
export function looksLikePaymentText(text) {
  if (typeof text !== 'string') return false;
  const re = /(\d[\d,]*(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(text))) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 24);
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    if (PAYMENT_AFTER_RE.test(after) || PAYMENT_BEFORE_RE.test(before)) return true;
  }
  return false;
}

/**
 * Is the number at html[index, index+length) payment copy? Looks only a few characters either side
 * so an unrelated "/mo" elsewhere on the page can't veto a real price.
 */
export function numberIsPaymentCopy(html, index, length) {
  const after = html.slice(index + length, index + length + 24);
  const before = html.slice(Math.max(0, index - 24), index);
  return PAYMENT_AFTER_RE.test(after) || PAYMENT_BEFORE_RE.test(before);
}

/**
 * A price source value -> integer price, or null. Strings carrying payment copy ("$299/mo") are
 * dropped; plain numbers/strings go through `cleanPrice` unchanged — there is no minimum-price
 * rule, a $2,500 used car is a real price.
 */
export function priceFromSource(val, cleanPrice) {
  if (typeof val === 'string' && looksLikePaymentText(val)) return null;
  return cleanPrice(val);
}

const MONTHLY_UNIT_RE = /^(?:mon|mo|month|monthly|mmk)$/i;
const LEASE_TYPE_RE = /lease|monthly|payment|finance/i;

/** A schema.org Offer's `priceSpecification` (object or array) marking it as a monthly/lease price. */
function offerIsPayment(offer) {
  if (!offer || typeof offer !== 'object') return false;
  const specs = [].concat(offer.priceSpecification || []);
  if (offer.unitCode || offer.unitText || offer.priceType) specs.push(offer);
  return specs.some((s) => s && (
    MONTHLY_UNIT_RE.test(String(s.unitCode || s.unitText || '').trim()) ||
    LEASE_TYPE_RE.test(String(s.priceType || s.name || ''))
  ));
}

/**
 * The price from a schema.org Vehicle's `offers` (object or array): the first Offer that is not a
 * monthly/lease price, cleaned; null when the only offer is a payment.
 */
export function priceFromSchemaOrgOffers(offers, cleanPrice) {
  for (const offer of [].concat(offers || [])) {
    if (!offer || offerIsPayment(offer)) continue;
    const price = priceFromSource(offer.price, cleanPrice);
    if (price) return price;
  }
  return null;
}

const IMAGE_EXT_RE = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|bmp)$/i;
// CDN "button"/icon asset folders and file names: /icons/..., /buttons/..., "btn-window-sticker", etc.
const ICON_ASSET_RE = /(?:^|[\/_.-])(?:icons?|buttons?|btns?|badges?|logos?|sprites?)(?:[\/_.-]|$)/i;

/**
 * Is `url` a real sticker document link (PDF / Monroney endpoint) rather than an image or icon asset
 * the dealer site uses to draw its "Window Sticker" button? Extensionless endpoints
 * (".../monroney?vin=...") stay valid; the check is on the path only, never the query string.
 */
export function isRealWindowStickerUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return false;
  let path;
  try {
    path = new URL(url, 'https://example.invalid/').pathname;
  } catch {
    return false;
  }
  if (IMAGE_EXT_RE.test(path)) return false;
  if (ICON_ASSET_RE.test(path)) return false;
  return true;
}

// ---- Trim text cleanup -------------------------------------------------------------------------------------------------------------
// Dealer pages hand the trim over HTML-escaped ("Platinum&reg;", "F-250&#174; XLT") and often with the drivetrain tacked onto the end
// ("XLT 4WD", "Base 2 Door 4x4"). Both stored as-is: the trim facet showed "Platinum®" and "Platinum" as two trims, and the option-policy
// trim match had to guess around the noise. Applies to every make.

const NAMED_ENTITIES = { reg: '®', trade: '™', amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>', copy: '©', ndash: '–', mdash: '—' };

/** `&reg;` / `&#174;` / `&#xAE;` -> the character; unknown entities are left exactly as written. Two passes, for a double-escaped "&amp;reg;". */
export function decodeHtmlEntities(text) {
  if (typeof text !== 'string' || !text.includes('&')) return text;
  const once = (s) => s.replace(/&(?:#(\d{1,6})|#[xX]([0-9a-fA-F]{1,5})|([a-zA-Z]{2,8}));/g, (m, dec, hex, name) => {
    if (name) return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name.toLowerCase()) ? NAMED_ENTITIES[name.toLowerCase()] : m;
    const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : m;
  });
  return once(once(text));
}

const DRIVETRAIN_WORD_RE = /^(?:4wd|awd|4x4|rwd|fwd|2wd)$/i;
// Makes whose option policy prices a package per drivetrain READ the drivetrain out of the trim (factoryOptionAllowlist.js dtGroup), and the
// dealer_inventory table has no drivetrain column; for these the drivetrain word is kept so that price keeps resolving.
const DRIVETRAIN_IN_TRIM_MAKES = new Set(['kia']);

/**
 * A trim string cleaned for storage: HTML entities decoded, the trademark marks (® ™) dropped, whitespace collapsed, and drivetrain words
 * (4WD, AWD, 4x4, RWD, FWD, 2WD) removed from the END only. A trim that would be left empty (a bare "AWD") keeps its text; null/blank in -> as given.
 */
export function cleanTrim(trim, { make = null } = {}) {
  if (typeof trim !== 'string') return trim;
  let text = decodeHtmlEntities(trim).replace(/[®™℠]/g, '').replace(/\s+/g, ' ').trim();
  if (!DRIVETRAIN_IN_TRIM_MAKES.has(String(make || '').trim().toLowerCase())) {
    const words = text.split(' ');
    while (words.length > 1 && DRIVETRAIN_WORD_RE.test(words[words.length - 1])) words.pop();
    text = words.join(' ');
  }
  return text || trim.trim();
}
