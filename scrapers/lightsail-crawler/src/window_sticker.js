// Public VDP window-sticker (Monroney) link capture.
// Detect only — do not download or parse the PDF, do not bypass WAFs.

import { isBotProtected } from './bot_protection.js';

const LABEL_RE = /window\s*sticker|monroney|manufacturer\s*sticker|view\s+window\s+sticker/i;
const HREF_HINT_RE = /window[-_]?sticker|monroney|sticker\.pdf|windowsticker/i;
const IMG_HINT_RE = /window[-_]?sticker|monroney/i;

function empty() {
  return {
    windowStickerUrl: null,
    windowStickerSource: null,
    collectedAt: null,
    windowStickerCollectedAt: null,
  };
}

function found(url, source, now) {
  const collectedAt = now.toISOString();
  return {
    windowStickerUrl: url,
    windowStickerSource: source,
    collectedAt,
    windowStickerCollectedAt: collectedAt,
  };
}

function resolveUrl(href, pageUrl) {
  if (!href || /^javascript:/i.test(href) || href.startsWith('#')) return null;
  try {
    return new URL(href, pageUrl || 'https://example.invalid/').toString();
  } catch {
    return null;
  }
}

function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag))) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

function fromJsonFields(html) {
  const patterns = [
    /"windowSticker(?:Url|URL)?"\s*:\s*"([^"]+)"/,
    /"monroney(?:Url|URL)?"\s*:\s*"([^"]+)"/,
    /"stickerUrl"\s*:\s*"([^"]+)"/,
    /"window_sticker(?:_url)?"\s*:\s*"([^"]+)"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1] && HREF_HINT_RE.test(m[1])) return m[1];
    if (m && m[1] && /\.pdf(\?|$)/i.test(m[1]) && /sticker|monroney/i.test(m[1])) return m[1];
    if (m && m[1] && /sticker|monroney/i.test(m[0])) return m[1];
  }
  return null;
}

export function extractWindowSticker(html, pageUrl, { now = new Date() } = {}) {
  const collectedAt = now instanceof Date ? now : new Date(now);
  if (!html || typeof html !== 'string') return empty();

  const jsonHit = fromJsonFields(html);
  if (jsonHit) {
    const url = resolveUrl(jsonHit.replace(/\\u0026/g, '&').replace(/\\+/g, ''), pageUrl);
    if (url) {
      return found(
        url,
        /@type|application\/ld\+json/i.test(html.slice(Math.max(0, html.indexOf(jsonHit) - 200), html.indexOf(jsonHit)))
          ? 'vdp_jsonld'
          : 'vdp_datalayer',
        collectedAt
      );
    }
  }

  const iframeRe = /<(iframe|embed)([^>]*)>/gi;
  let im;
  while ((im = iframeRe.exec(html))) {
    const a = attrs(im[2] || '');
    const src = a.src || a['data-src'] || '';
    if (src && (HREF_HINT_RE.test(src) || (/\.pdf/i.test(src) && LABEL_RE.test(im[0])))) {
      const url = resolveUrl(src, pageUrl);
      if (url) {
        return found(url, 'vdp_embed', collectedAt);
      }
    }
  }

  const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let am;
  while ((am = aRe.exec(html))) {
    const a = attrs(am[1] || '');
    const href = a.href || a['data-href'] || a['data-url'] || '';
    const label = `${a['aria-label'] || ''} ${a.download || ''} ${am[2].replace(/<[^>]+>/g, ' ')}`;
    const labeled = LABEL_RE.test(label) || LABEL_RE.test(am[0]);
    const hinted = HREF_HINT_RE.test(href);
    if (href && (labeled || hinted)) {
      const url = resolveUrl(href, pageUrl);
      if (url) {
        return found(url, 'vdp_link', collectedAt);
      }
    }
  }

  const btnRe = /<(?:button|div|span)([^>]*)>([\s\S]*?)<\/(?:button|div|span)>/gi;
  let bm;
  while ((bm = btnRe.exec(html))) {
    const a = attrs(bm[1] || '');
    const label = `${a['aria-label'] || ''} ${bm[2].replace(/<[^>]+>/g, ' ')}`;
    const href = a.href || a['data-href'] || a['data-url'] || a['data-sticker'] || '';
    if (href && LABEL_RE.test(label)) {
      const url = resolveUrl(href, pageUrl);
      if (url) {
        return found(url, 'vdp_link', collectedAt);
      }
    }
  }

  const imgRe = /<img\b([^>]*)>/gi;
  let gm;
  while ((gm = imgRe.exec(html))) {
    const a = attrs(gm[1] || '');
    const src = a.src || a['data-src'] || '';
    const label = `${a.alt || ''} ${a.title || ''}`;
    if (src && (IMG_HINT_RE.test(src) || LABEL_RE.test(label))) {
      const url = resolveUrl(src, pageUrl);
      if (url) {
        return found(url, 'vdp_image', collectedAt);
      }
    }
  }

  return empty();
}

export function captureWindowStickerFromPage({ html, pageUrl, classification, now } = {}) {
  if (isBotProtected(classification)) return empty();
  return extractWindowSticker(html, pageUrl, { now });
}

export function applyWindowSticker(vehicle, html, pageUrl, opts) {
  if (!vehicle) return vehicle;
  const hit = captureWindowStickerFromPage({
    html,
    pageUrl,
    classification: opts?.classification,
    now: opts?.now,
  });
  vehicle.windowStickerUrl = hit.windowStickerUrl;
  vehicle.windowStickerSource = hit.windowStickerSource;
  vehicle.collectedAt = hit.collectedAt;
  vehicle.windowStickerCollectedAt = hit.windowStickerCollectedAt;
  return vehicle;
}
