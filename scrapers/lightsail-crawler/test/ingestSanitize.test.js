import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  readOdometer,
  resolveMileage,
  looksLikePaymentText,
  numberIsPaymentCopy,
  priceFromSource,
  priceFromSchemaOrgOffers,
  isRealWindowStickerUrl,
} from '../src/ingestSanitize.js';

// Same shape as standalone.js's cleanPrice: no minimum, only "implausible" guards.
function cleanPrice(val) {
  if (val === null || val === undefined) return null;
  const num = typeof val === 'number' ? val : parseFloat(val.toString().replace(/[^\d.]/g, ''));
  if (isNaN(num) || num <= 0 || num >= 5000000 || num === 2147483647) return null;
  return Math.round(num);
}

describe('rule 1 — miles: used/CPO with no odometer is null, not 0', () => {
  it('SAMPLE: a used row whose page has no odometer stores null', () => {
    assert.equal(resolveMileage(readOdometer(undefined), 'USED'), null);
    assert.equal(resolveMileage(readOdometer(''), 'USED'), null);
    assert.equal(resolveMileage(readOdometer(null), 'CERTIFIED_PRE_OWNED'), null);
  });

  it('keeps a real used/CPO reading', () => {
    assert.equal(resolveMileage(readOdometer('39,061'), 'USED'), 39061);
    assert.equal(resolveMileage(readOdometer(12000), 'CERTIFIED_PRE_OWNED'), 12000);
  });

  it('a platform-default 0 on a used/CPO listing is null too', () => {
    assert.equal(resolveMileage(readOdometer('0'), 'USED'), null);
    assert.equal(resolveMileage(readOdometer(0), 'CPO'), null);
  });

  it('keeps an explicit 0 on a new car, and a new car with no odometer stays 0 as before', () => {
    assert.equal(resolveMileage(readOdometer('0'), 'NEW'), 0);
    assert.equal(resolveMileage(readOdometer(null), 'NEW'), 0);
  });

  it('does not reclassify or touch a high-mile NEW listing', () => {
    assert.equal(resolveMileage(readOdometer(8500), 'NEW'), 8500);
  });

  it('an unrecognised condition with no odometer is null, with one is kept', () => {
    assert.equal(resolveMileage(null, undefined), null);
    assert.equal(resolveMileage(500, undefined), 500);
  });

  it('readOdometer rejects garbage and negatives', () => {
    assert.equal(readOdometer('n/a'), null);
    assert.equal(readOdometer(-5), null);
    assert.equal(readOdometer(NaN), null);
  });
});

describe('rule 2 — price: never store lease/payment copy, no blanket minimum', () => {
  it('SAMPLE: "$299/mo" must not become the price', () => {
    assert.equal(priceFromSource('$299/mo', cleanPrice), null);
    assert.equal(priceFromSource('299 per month', cleanPrice), null);
    assert.equal(priceFromSource('$2,999 down', cleanPrice), null);
    assert.equal(priceFromSource('$349 a month', cleanPrice), null);
  });

  it('a real price still parses', () => {
    assert.equal(priceFromSource('$38,995', cleanPrice), 38995);
    assert.equal(priceFromSource(41250, cleanPrice), 41250);
  });

  it('cheap used cars stay — no "under $3,000" rejection', () => {
    assert.equal(priceFromSource(2500, cleanPrice), 2500);
    assert.equal(priceFromSource('$1,995', cleanPrice), 1995);
  });

  it('looksLikePaymentText recognises payment copy and leaves ordinary text alone', () => {
    assert.equal(looksLikePaymentText('Lease for $299/mo'), true);
    assert.equal(looksLikePaymentText('Down payment: $3,000'), true);
    assert.equal(looksLikePaymentText('$2,500'), false);
    assert.equal(looksLikePaymentText('Model 2024'), false);
  });

  it('schema.org: a monthly-priced Offer is skipped, a real Offer alongside it wins', () => {
    const lease = { price: '299', priceSpecification: { unitCode: 'MON' } };
    const real = { price: '41250' };
    assert.equal(priceFromSchemaOrgOffers(lease, cleanPrice), null);
    assert.equal(priceFromSchemaOrgOffers([lease, real], cleanPrice), 41250);
    assert.equal(priceFromSchemaOrgOffers({ price: '$299/mo' }, cleanPrice), null);
    assert.equal(priceFromSchemaOrgOffers({ price: 2500 }, cleanPrice), 2500);
    assert.equal(priceFromSchemaOrgOffers(undefined, cleanPrice), null);
  });

  it('numberIsPaymentCopy looks only at the characters next to the number', () => {
    const html = `<div class="lease"><span>$299</span>/mo</div>`;
    const idx = html.indexOf('299');
    assert.equal(numberIsPaymentCopy(html, idx, 3), true);

    const far = `<meta itemprop="price" content="41250"> ${'x'.repeat(60)} $299/mo`;
    assert.equal(numberIsPaymentCopy(far, far.indexOf('41250'), 5), false);
  });

  it('"only number on the page is a payment" leaves price blank (null)', () => {
    const html = `<span class="price">$299/mo</span>`;
    const m = html.match(/\$([\d,]+)/);
    assert.equal(numberIsPaymentCopy(html, m.index + 1, m[1].length), true);
  });
});

describe('rule 3 — window sticker: only real PDF/Monroney links', () => {
  it('SAMPLE: an .svg button asset is dropped', () => {
    assert.equal(isRealWindowStickerUrl('https://cdn.example.com/assets/window-sticker.svg'), false);
  });

  it('drops .png and other image assets, and icon/button asset paths', () => {
    assert.equal(isRealWindowStickerUrl('https://x.test/img/window-sticker.png?v=3'), false);
    assert.equal(isRealWindowStickerUrl('https://x.test/img/sticker.jpg'), false);
    assert.equal(isRealWindowStickerUrl('https://x.test/icons/window-sticker'), false);
    assert.equal(isRealWindowStickerUrl('https://x.test/buttons/window-sticker'), false);
    assert.equal(isRealWindowStickerUrl('https://x.test/btn-window-sticker/abc'), false);
  });

  it('keeps PDF and extensionless Monroney endpoints, including a query string that mentions an image', () => {
    assert.equal(isRealWindowStickerUrl('https://windowsticker.forddirect.com/windowsticker.pdf?vin=1FTFW5L85TFB55586'), true);
    assert.equal(isRealWindowStickerUrl('https://x.test/stickers/1FTFW5L85TFB55586.pdf'), true);
    assert.equal(isRealWindowStickerUrl('https://api.x.test/monroney?vin=1&img=icon.png'), true);
  });

  it('rejects empty / non-string input', () => {
    assert.equal(isRealWindowStickerUrl(''), false);
    assert.equal(isRealWindowStickerUrl(null), false);
  });
});
