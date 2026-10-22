import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillFromFacebookPixelViewContent } from '../src/facebookPixelFields.js';
import { findVehicleLd } from '../src/porscheSchemaOrgFields.js';
import { priceFromSchemaOrgOffers } from '../src/ingestSanitize.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const tvNoOfferPrice = fx('team_velocity_graph_no_offer_price_pixel_vdp_sample.html');
const tvWithOfferPrice = fx('team_velocity_graph_vdp_sample.html');
const pixel = (fields) => `<script>fbq('track', 'ViewContent', {content_type: 'vehicle',content_ids: ['X'],make: 'Toyota',${fields}});</script>`;
const blank = () => ({ vin: 'X', model: null, make: null, exteriorColor: null, transmission: null, bodyStyle: null, price: null, msrp: null });

afterEach(() => { delete process.env.CRAWLER_PIXEL_PRICE; });

describe('pixel price fill (Team Velocity /viewdetails/)', () => {
  it('why price was blank: the @graph Vehicle parses but its Offer has no price, so the schema.org strategy yields null', () => {
    const block = JSON.parse(tvNoOfferPrice.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const veh = findVehicleLd(block, { graph: true });
    assert.equal(veh.vehicleIdentificationNumber, '2T3G1RFV1SW519088');
    assert.equal(priceFromSchemaOrgOffers(veh.offers, (v) => v), null);
  });

  it('fills blank price and MSRP from the page\'s own ViewContent call', () => {
    const v = fillFromFacebookPixelViewContent({ ...blank(), vin: '2T3G1RFV1SW519088' }, tvNoOfferPrice);
    assert.equal(v.price, 31995);
    assert.equal(v.msrp, 31995);
  });

  it('a page whose Offer does have a price is unchanged (the pixel never overwrites)', () => {
    assert.ok(/"price": "35599"/.test(tvWithOfferPrice));
    const v = fillFromFacebookPixelViewContent({ ...blank(), price: 35599, msrp: 35599 }, tvNoOfferPrice);
    assert.equal(v.price, 35599);
    assert.equal(v.msrp, 35599);
  });

  it('fills only the blank one of price / MSRP', () => {
    const a = fillFromFacebookPixelViewContent({ ...blank(), price: 30000 }, tvNoOfferPrice);
    assert.equal(a.price, 30000);
    assert.equal(a.msrp, 31995);
    const b = fillFromFacebookPixelViewContent({ ...blank(), msrp: 33000 }, tvNoOfferPrice);
    assert.equal(b.price, 31995);
    assert.equal(b.msrp, 33000);
  });

  it('treats a price of 0 as blank and fills it', () => {
    const v = fillFromFacebookPixelViewContent({ ...blank(), price: 0, msrp: 0 }, tvNoOfferPrice);
    assert.equal(v.price, 31995);
    assert.equal(v.msrp, 31995);
  });

  it('ignores a call with no price, a zero price, a sentinel, an absurd price, a payment string, or junk', () => {
    for (const fields of ["model: 'RAV4'", 'price: 0', 'price: 2147483647', 'price: 9000000', "price: '$299/mo'", "price: '$3,000 down'", "price: 'Call us'", 'price: true', 'price: null']) {
      const v = fillFromFacebookPixelViewContent(blank(), pixel(fields));
      assert.equal(v.price, null, fields);
      assert.equal(v.msrp, null, fields);
    }
  });

  it('accepts a numeric string with a dollar sign and rounds to whole dollars', () => {
    const v = fillFromFacebookPixelViewContent(blank(), pixel("price: '$31,995.40'"));
    assert.equal(v.price, 31995);
  });

  it('CRAWLER_PIXEL_PRICE=false leaves price and MSRP blank (other fields still fill)', () => {
    process.env.CRAWLER_PIXEL_PRICE = 'false';
    const v = fillFromFacebookPixelViewContent(blank(), tvNoOfferPrice);
    assert.equal(v.price, null);
    assert.equal(v.msrp, null);
    assert.equal(v.model, 'RAV4');
  });

  it('is a no-op on a page with no ViewContent call, and on a null vehicle', () => {
    const v = fillFromFacebookPixelViewContent(blank(), tvWithOfferPrice);
    assert.equal(v.price, null);
    assert.equal(fillFromFacebookPixelViewContent(null, tvNoOfferPrice), null);
  });
});
