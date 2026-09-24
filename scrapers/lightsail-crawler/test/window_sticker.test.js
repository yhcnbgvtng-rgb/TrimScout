import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractWindowSticker, captureWindowStickerFromPage, applyWindowSticker } from '../src/window_sticker.js';
import { BOT_CLASSES } from '../src/bot_protection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_URL = 'https://www.example-ford-dealer.com/new/2026-Ford-F-150/1FTFW5L85TFB55586';

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'testdata', name), 'utf8');
}

describe('extractWindowSticker — JSON fields (data-layer / JSON-LD)', () => {
  it('reads a windowStickerUrl JSON field and resolves a relative path against the page URL', () => {
    const html = `<script>var page = {"vin":"1FTFW5L85TFB55586","windowStickerUrl":"/stickers/1FTFW5L85TFB55586.pdf"};</script>`;
    const hit = extractWindowSticker(html, PAGE_URL);
    assert.equal(hit.windowStickerUrl, 'https://www.example-ford-dealer.com/stickers/1FTFW5L85TFB55586.pdf');
    assert.equal(hit.windowStickerSource, 'vdp_datalayer');
  });

  it('labels a hit inside an application/ld+json block as vdp_jsonld', () => {
    const html = `<script type="application/ld+json">{"@type":"Vehicle","monroneyUrl":"https://cdn.example.com/monroney/abc.pdf"}</script>`;
    const hit = extractWindowSticker(html, PAGE_URL);
    assert.equal(hit.windowStickerUrl, 'https://cdn.example.com/monroney/abc.pdf');
    assert.equal(hit.windowStickerSource, 'vdp_jsonld');
  });

  it('unescapes a JS-escaped \\u0026 in the captured URL', () => {
    const html = `<script>var d = {"stickerUrl":"https://windowsticker.forddirect.com/windowsticker.pdf?vin=1FTFW5L85TFB55586\\u0026dealerId=123"};</script>`;
    const hit = extractWindowSticker(html, PAGE_URL);
    assert.equal(hit.windowStickerUrl, 'https://windowsticker.forddirect.com/windowsticker.pdf?vin=1FTFW5L85TFB55586&dealerId=123');
  });
});

describe('extractWindowSticker — iframe/embed', () => {
  it('reads an iframe src that hints at a sticker/monroney URL', () => {
    const html = `<iframe src="https://cdn.example.com/window-sticker/1FTFW5L85TFB55586.pdf"></iframe>`;
    const hit = extractWindowSticker(html, PAGE_URL);
    assert.equal(hit.windowStickerUrl, 'https://cdn.example.com/window-sticker/1FTFW5L85TFB55586.pdf');
    assert.equal(hit.windowStickerSource, 'vdp_embed');
  });

  it('accepts a .pdf embed only when the surrounding tag is actually labeled a sticker', () => {
    const labeled = `<embed src="https://cdn.example.com/docs/abc123.pdf" title="View Window Sticker"></embed>`;
    assert.equal(extractWindowSticker(labeled, PAGE_URL).windowStickerUrl, 'https://cdn.example.com/docs/abc123.pdf');

    const unlabeled = `<embed src="https://cdn.example.com/docs/brochure.pdf"></embed>`;
    assert.equal(extractWindowSticker(unlabeled, PAGE_URL).windowStickerUrl, null);
  });
});

describe('extractWindowSticker — <a> links', () => {
  it('matches on the link label even when the href itself has no sticker hint', () => {
    const html = `<a href="https://cdn.example.com/docs/xyz789.pdf">View Window Sticker</a>`;
    const hit = extractWindowSticker(html, PAGE_URL);
    assert.equal(hit.windowStickerUrl, 'https://cdn.example.com/docs/xyz789.pdf');
    assert.equal(hit.windowStickerSource, 'vdp_link');
  });

  it('matches on an href hint even when the visible label says nothing', () => {
    const html = `<a href="https://cdn.example.com/monroney-sticker.pdf">Download</a>`;
    assert.equal(extractWindowSticker(html, PAGE_URL).windowStickerUrl, 'https://cdn.example.com/monroney-sticker.pdf');
  });

  it('ignores an unrelated link with neither a labeled nor hinted href', () => {
    const html = `<a href="https://cdn.example.com/brochure.pdf">Download Brochure</a>`;
    assert.equal(extractWindowSticker(html, PAGE_URL).windowStickerUrl, null);
  });

  it('never follows a javascript: pseudo-href or a bare #fragment', () => {
    assert.equal(extractWindowSticker(`<a href="javascript:void(0)">Window Sticker</a>`, PAGE_URL).windowStickerUrl, null);
    assert.equal(extractWindowSticker(`<a href="#">Window Sticker</a>`, PAGE_URL).windowStickerUrl, null);
  });
});

// Real markup from a live DealerOn VDP (allamericanfordinoldbridge.com,
// 2026-09-23) — a real, valid vehicle whose page had a captured sticker
// link this extractor completely missed before this fix, because DealerOn
// puts the URL only inside an onclick call, in an <a> with no href at all.
describe("extractWindowSticker — DealerOn's onclick-only sticker button (real fixture)", () => {
  const FIXTURE = loadFixture('dealeron-vdp-sticker-button.html');
  const REAL_PAGE_URL = 'https://www.allamericanfordinoldbridge.com/new-Old+Bridge-2026-Ford-F+150-LARIAT-1FTFW5L85TFB55586';

  it('extracts the real relative URL out of the onclick call and resolves it against the dealer origin', () => {
    const hit = extractWindowSticker(FIXTURE, REAL_PAGE_URL);
    assert.equal(
      hit.windowStickerUrl,
      'https://www.allamericanfordinoldbridge.com/api/vhcliaa/inventory/14997/window-sticker?sv=MQBGAFQARgBXADUATAA4ADUAVABGAEIANQA1ADUAOAA2AA%3d%3d&make=Ford&vehicleType=N'
    );
    assert.equal(hit.windowStickerSource, 'vdp_onclick');
    assert.ok(hit.collectedAt);
  });

  it('is brand-agnostic — the same DealerOn convention for a different make still matches', () => {
    const html = `<a class="icon-button" onclick="DoUtility.OpenChevroletWindowSticker(&quot;/api/vhcliaa/inventory/555/window-sticker?sv=xyz&amp;make=Chevrolet&quot;);" data-vin="1G1ZD5ST0RF123456">Window Sticker</a>`;
    const hit = extractWindowSticker(html, PAGE_URL);
    assert.equal(hit.windowStickerUrl, 'https://www.example-ford-dealer.com/api/vhcliaa/inventory/555/window-sticker?sv=xyz&make=Chevrolet');
    assert.equal(hit.windowStickerSource, 'vdp_onclick');
  });

  it('also works when the onclick is on a <button>/<div>/<span>, not just an <a>', () => {
    const html = `<button onclick="OpenFordWindowSticker('/window-sticker?sv=abc');" data-vin="1FTFW5L85TFB55586">Sticker</button>`;
    assert.equal(extractWindowSticker(html, PAGE_URL).windowStickerUrl, 'https://www.example-ford-dealer.com/window-sticker?sv=abc');
  });

  it('does not fire on an unrelated onclick handler', () => {
    const html = `<a class="icon-button" onclick="DoUtility.OpenSomethingElse('/x');" data-vin="1FTFW5L85TFB55586">Not a sticker</a>`;
    assert.equal(extractWindowSticker(html, PAGE_URL).windowStickerUrl, null);
  });

  it("a real href still wins over an onclick sticker call on the same <a>, when the href itself is the real link", () => {
    const html = `<a href="https://cdn.example.com/window-sticker/real.pdf" onclick="DoUtility.OpenFordWindowSticker(&quot;/decoy&quot;);" aria-label="window sticker">View</a>`;
    assert.equal(extractWindowSticker(html, PAGE_URL).windowStickerUrl, 'https://cdn.example.com/window-sticker/real.pdf');
  });
});

describe('extractWindowSticker — button/div/span with an href-like data attribute', () => {
  it('matches a data-href on a labeled div', () => {
    const html = `<div data-href="https://cdn.example.com/docs/sticker123.pdf" aria-label="Manufacturer Sticker">Open</div>`;
    const hit = extractWindowSticker(html, PAGE_URL);
    assert.equal(hit.windowStickerUrl, 'https://cdn.example.com/docs/sticker123.pdf');
    assert.equal(hit.windowStickerSource, 'vdp_link');
  });

  it('matches a data-sticker attribute on a button', () => {
    const html = `<button data-sticker="https://cdn.example.com/window-sticker.pdf" aria-label="View Window Sticker">Sticker</button>`;
    assert.equal(extractWindowSticker(html, PAGE_URL).windowStickerUrl, 'https://cdn.example.com/window-sticker.pdf');
  });

  it('requires the label — an unlabeled div with a data-href is not a sticker', () => {
    const html = `<div data-href="https://cdn.example.com/docs/sticker123.pdf">Open</div>`;
    assert.equal(extractWindowSticker(html, PAGE_URL).windowStickerUrl, null);
  });
});

describe('extractWindowSticker — <img> fallback', () => {
  it('matches an image whose src hints at a sticker', () => {
    const html = `<img src="/icons/window-sticker-icon.png" alt="icon">`;
    assert.equal(extractWindowSticker(html, PAGE_URL).windowStickerSource, 'vdp_image');
  });

  it('matches an image labeled by alt/title even with a generic src', () => {
    const html = `<img src="/icons/generic.png" alt="Monroney Sticker">`;
    assert.equal(extractWindowSticker(html, PAGE_URL).windowStickerUrl, 'https://www.example-ford-dealer.com/icons/generic.png');
  });
});

describe('extractWindowSticker — strategy order and no-match', () => {
  it('prefers a JSON field over a later <a> link on the same page', () => {
    const html = `
      <script>var d = {"windowStickerUrl":"https://cdn.example.com/from-json.pdf"};</script>
      <a href="https://cdn.example.com/from-link.pdf">Window Sticker</a>
    `;
    assert.equal(extractWindowSticker(html, PAGE_URL).windowStickerUrl, 'https://cdn.example.com/from-json.pdf');
  });

  it('returns the empty shape (all nulls) when nothing on the page matches', () => {
    const hit = extractWindowSticker('<html><body>no sticker here</body></html>', PAGE_URL);
    assert.deepEqual(hit, {
      windowStickerUrl: null,
      windowStickerSource: null,
      collectedAt: null,
      windowStickerCollectedAt: null,
    });
  });

  it('handles empty/non-string input without throwing', () => {
    assert.deepEqual(extractWindowSticker('', PAGE_URL).windowStickerUrl, null);
    assert.deepEqual(extractWindowSticker(null, PAGE_URL).windowStickerUrl, null);
    assert.deepEqual(extractWindowSticker(undefined, PAGE_URL).windowStickerUrl, null);
  });
});

describe('captureWindowStickerFromPage — detect only, never on a bot-shield page', () => {
  it('returns empty when the page classification is bot-protected, even with a real sticker link present', () => {
    const html = `<a href="https://cdn.example.com/window-sticker.pdf">Window Sticker</a>`;
    const hit = captureWindowStickerFromPage({ html, pageUrl: PAGE_URL, classification: BOT_CLASSES.CLOUDFLARE });
    assert.equal(hit.windowStickerUrl, null);
  });

  it('extracts normally when the classification is clean (NONE)', () => {
    const html = `<a href="https://cdn.example.com/window-sticker.pdf">Window Sticker</a>`;
    const hit = captureWindowStickerFromPage({ html, pageUrl: PAGE_URL, classification: BOT_CLASSES.NONE });
    assert.equal(hit.windowStickerUrl, 'https://cdn.example.com/window-sticker.pdf');
  });
});

describe('applyWindowSticker', () => {
  it('stamps all four fields onto the vehicle object and returns it', () => {
    const html = `<a href="https://cdn.example.com/window-sticker.pdf">Window Sticker</a>`;
    const vehicle = { vin: '1FTFW5L85TFB55586' };
    const now = new Date('2026-09-23T12:00:00.000Z');
    const result = applyWindowSticker(vehicle, html, PAGE_URL, { classification: BOT_CLASSES.NONE, now });
    assert.equal(result, vehicle, 'mutates and returns the same object');
    assert.equal(vehicle.windowStickerUrl, 'https://cdn.example.com/window-sticker.pdf');
    assert.equal(vehicle.windowStickerSource, 'vdp_link');
    assert.equal(vehicle.collectedAt, '2026-09-23T12:00:00.000Z');
    assert.equal(vehicle.windowStickerCollectedAt, '2026-09-23T12:00:00.000Z');
  });

  it('returns a falsy vehicle unchanged instead of throwing', () => {
    assert.equal(applyWindowSticker(null, '<html></html>', PAGE_URL), null);
  });

  it('stamps nulls when the page is bot-protected, on a real, otherwise-vehicle', () => {
    const html = `<a href="https://cdn.example.com/window-sticker.pdf">Window Sticker</a>`;
    const vehicle = { vin: '1FTFW5L85TFB55586' };
    applyWindowSticker(vehicle, html, PAGE_URL, { classification: BOT_CLASSES.HTTP_403 });
    assert.equal(vehicle.windowStickerUrl, null);
    assert.equal(vehicle.windowStickerSource, null);
  });
});
