import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recoverModelTrim, recoverTrim, matchKnownModel } from '../src/listingModel.js';
import { KNOWN_MODELS } from '../src/knownModels.js';

const jsonLd = (obj) => `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;
const honda = (extra = {}) => ({ make: 'Honda', year: 2026, model: null, trim: null, ...extra });

describe('matchKnownModel', () => {
  it('matches the longest known model and returns the words after it', () => {
    assert.deepEqual(matchKnownModel('Jeep', ['Grand', 'Cherokee', 'L', 'Limited']), { model: 'Grand Cherokee L', rest: ['Limited'] });
    assert.deepEqual(matchKnownModel('Honda', ['CR-V', 'EX-L', 'AWD']), { model: 'CR-V', rest: ['EX-L', 'AWD'] });
    assert.deepEqual(matchKnownModel('Honda', ['Civic', 'Sport', 'Touring']), { model: 'Civic', rest: ['Sport', 'Touring'] });
  });
  it('writes the database spelling, whatever case the page used', () => {
    assert.equal(matchKnownModel('Honda', ['cr-v']).model, 'CR-V');
    assert.equal(matchKnownModel('Toyota', ['rav4', 'xle']).model, 'RAV4');
    assert.equal(matchKnownModel('honda', ['civic']).model, 'Civic', 'make lookup is case-insensitive');
  });
  it('only matches on a word boundary and only for names the database uses', () => {
    assert.equal(matchKnownModel('Honda', ['CR-VX']), null);
    assert.equal(matchKnownModel('Honda', ['Spaceship']), null);
    assert.equal(matchKnownModel('Honda', []), null);
    assert.equal(matchKnownModel('NoSuchMake', ['Civic']), null);
  });
  it('the vocabulary only holds real, non-blank names for the makes the crawl handles', () => {
    for (const [make, models] of Object.entries(KNOWN_MODELS)) {
      assert.ok(models.length > 0, make);
      for (const m of models) assert.ok(m.trim() === m && m.length > 0 && m.length <= 40, `${make}/${m}`);
    }
    assert.ok(KNOWN_MODELS.Honda.includes('Civic') && KNOWN_MODELS.Honda.includes('CR-V'));
  });
});

describe('recoverModelTrim — each source', () => {
  it('title: the Honda Civic Sport Touring case (19XFL4H93TE029208)', () => {
    const html = '<html><head><title>New 2026 Honda Civic Sport Touring Sedan in Chesapeake, VA | Firstteam Honda</title></head></html>';
    assert.deepEqual(recoverModelTrim({ vehicle: honda(), html }), { model: 'Civic', trim: 'Sport Touring', source: 'title' });
  });
  it('og:title and h1 work when <title> is useless', () => {
    assert.equal(recoverModelTrim({ vehicle: honda(), html: '<meta property="og:title" content="2026 Honda CR-V EX-L AWD for sale"/>' }).model, 'CR-V');
    assert.equal(recoverModelTrim({ vehicle: honda(), html: '<title>Inventory</title><h1 class="x">2026 Honda <span>Accord</span> Hybrid Sport</h1>' }).model, 'Accord Hybrid', 'the longest known model wins');
  });
  it('JSON-LD model field (string, object, and inside @graph)', () => {
    assert.deepEqual(recoverModelTrim({ vehicle: honda(), html: jsonLd({ '@type': 'Car', model: 'Civic' }) }), { model: 'Civic', trim: null, source: 'jsonld-model' });
    assert.equal(recoverModelTrim({ vehicle: honda(), html: jsonLd({ '@type': 'Vehicle', model: { '@type': 'ProductModel', name: 'Pilot' } }) }).model, 'Pilot');
    assert.equal(recoverModelTrim({ vehicle: honda(), html: jsonLd({ '@graph': [{ '@type': 'WebSite' }, { '@type': 'Car', model: 'Odyssey' }] }) }).model, 'Odyssey');
  });
  it('a short structured JSON-LD model the vocabulary has not seen is accepted as the dealer sent it; junk is not', () => {
    assert.equal(recoverModelTrim({ vehicle: honda(), html: jsonLd({ '@type': 'Car', model: 'ZR-X' }) }).model, 'ZR-X');
    for (const junk of ['New', 'Used', 'SUV', '2026', 'Honda', 'n/a', '', 'A very long invented marketing sentence here']) {
      assert.equal(recoverModelTrim({ vehicle: honda(), html: jsonLd({ '@type': 'Car', model: junk }) }), null, JSON.stringify(junk));
    }
  });
  it('JSON-LD name ("2026 Honda Civic Sport Touring")', () => {
    assert.deepEqual(recoverModelTrim({ vehicle: honda(), html: jsonLd({ '@type': 'Car', name: '2026 Honda Civic Sport Touring' }) }), { model: 'Civic', trim: 'Sport Touring', source: 'jsonld-name' });
  });
  it('breadcrumb list', () => {
    const html = jsonLd({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home' }, { '@type': 'ListItem', position: 2, name: 'New Honda' }, { '@type': 'ListItem', position: 3, name: 'Civic' }] });
    assert.deepEqual(recoverModelTrim({ vehicle: honda(), html }), { model: 'Civic', trim: null, source: 'breadcrumb' });
  });
  it('URL slug gives the model only (the trim there is read by vdpUrlTrim.js, which keeps hyphens and case)', () => {
    const url = 'https://www.firstteamhonda.com/new-2026-honda-cr-v-ex-l-5J6RS4H76VL005102.htm';
    assert.deepEqual(recoverModelTrim({ vehicle: honda(), html: '', url }), { model: 'CR-V', trim: null, source: 'url' });
    const t = recoverModelTrim({ vehicle: { make: 'Toyota', year: 2026 }, html: '', url: '/viewdetails/new/2t36crav0tw102088/2026-toyota-rav4-sport-utility' });
    assert.equal(t.model, 'RAV4');
    const plus = recoverModelTrim({ vehicle: { make: 'Toyota', year: 2026 }, html: '', url: 'new-Gresham-2026-Toyota-RAV4-XLE+Premium-2T3W1RFV8TW000000' });
    assert.equal(plus.model, 'RAV4');
  });
  it('HTML spec row', () => {
    assert.equal(recoverModelTrim({ vehicle: honda(), html: '<table><tr><th>Model</th><td>Passport</td></tr></table>' }).model, 'Passport');
    assert.equal(recoverModelTrim({ vehicle: honda(), html: '<dl><dt>Model:</dt><dd>HR-V</dd></dl>' }).model, 'HR-V');
    assert.equal(recoverModelTrim({ vehicle: honda(), html: '<p>Model: Ridgeline AWD</p>' }).model, 'Ridgeline');
  });
});

describe('recoverModelTrim — what it must NOT do', () => {
  it('returns null (never a guess) when no source names a known model', () => {
    assert.equal(recoverModelTrim({ vehicle: honda(), html: '<title>Welcome to our dealership</title>', url: 'https://x.com/inventory/123' }), null);
    assert.equal(recoverModelTrim({ vehicle: honda(), html: '' }), null);
    assert.equal(recoverModelTrim({ vehicle: null }), null);
    assert.equal(recoverModelTrim({ vehicle: { year: 2026 }, html: '<title>2026 Civic</title>' }), null, 'no make: nothing to anchor on');
  });
  it('does not take a model from another make\'s text', () => {
    // a Honda row whose page title is about a Toyota trade-in must not become "Camry" (Camry is not a Honda)
    assert.equal(recoverModelTrim({ vehicle: honda(), html: '<title>2026 Toyota Camry SE</title>' }), null);
  });
  it('the model must follow the make: a model name elsewhere in the text is not enough', () => {
    assert.equal(recoverModelTrim({ vehicle: honda(), html: '<title>Honda dealership - the Civic Si deals page</title>' })?.model ?? null, null);
  });
  it('trim stops at city/price/VIN and drops body words', () => {
    const r = recoverModelTrim({ vehicle: honda(), html: '<title>2026 Honda Civic Sport Touring Hatchback in Reston VA $31,495</title>' });
    assert.equal(r.trim, 'Sport Touring');
    const v = recoverModelTrim({ vehicle: honda(), html: '<title>2026 Honda Civic LX 2HGFE2F59TH000001</title>' });
    assert.equal(v.trim, 'LX');
    const noTrim = recoverModelTrim({ vehicle: honda(), html: '<title>2026 Honda Civic Sedan in Reston</title>' });
    assert.equal(noTrim.trim, null);
  });
  it('trim is capped at four words', () => {
    const r = recoverModelTrim({ vehicle: honda(), html: '<title>2026 Honda Civic one two three four five six</title>' });
    assert.equal(r.trim.split(' ').length, 4);
  });
});

describe('recoverTrim (model present, trim blank)', () => {
  it('reads the trim after the stored model in the page title / h1 / JSON-LD name', () => {
    assert.deepEqual(recoverTrim({ vehicle: honda({ model: 'CR-V' }), html: '<h1>2026 Honda CR-V EX-L AWD</h1>' }), { trim: 'EX-L AWD', source: 'title' });
    assert.equal(recoverTrim({ vehicle: honda({ model: 'Civic' }), html: '<title>New 2026 Honda Civic Sport Touring Sedan in Reston</title>' }).trim, 'Sport Touring');
    assert.equal(recoverTrim({ vehicle: honda({ model: 'Civic' }), html: jsonLd({ '@type': 'Car', name: '2026 Honda Civic Sport' }) }).trim, 'Sport');
  });
  it('declines when the page names a different model than the stored one, or there is no trim', () => {
    assert.equal(recoverTrim({ vehicle: honda({ model: 'Accord' }), html: '<title>2026 Honda Civic Sport Touring</title>' }), null);
    assert.equal(recoverTrim({ vehicle: honda({ model: 'Civic' }), html: '<title>2026 Honda Civic Sedan</title>' }), null);
    assert.equal(recoverTrim({ vehicle: honda({ model: null }), html: '<title>2026 Honda Civic Sport</title>' }), null, 'needs a model');
  });
});

describe('standalone.js wiring', () => {
  const src = fs.readFileSync(new URL('../src/standalone.js', import.meta.url), 'utf8');
  it('recovers a blank model only when blank, after the kept make is set and before the brand normalizer', () => {
    const iMake = src.indexOf('vehicle.make = keptMake;');
    const iRecover = src.indexOf('recoverModelTrim({ vehicle, html, url })');
    const iNormalize = src.indexOf('vehicle = normalizeVehicleFields(keptMake, vehicle);');
    assert.ok(iMake > 0 && iRecover > iMake && iNormalize > iRecover, 'order: make -> recover model -> normalize');
    assert.match(src.slice(iRecover - 700, iRecover), /if \(!vehicle\.model \|\| !String\(vehicle\.model\)\.trim\(\)\)/, 'guarded by "model is blank"');
    assert.match(src.slice(iRecover, iRecover + 900), /!\(vehicle\.trim && String\(vehicle\.trim\)\.trim\(\)\)/, 'trim only when blank');
  });
  it('a throw inside either recovery can never drop the vehicle (extractOne\'s outer catch would)', () => {
    assert.match(src, /try \{ recovered = recoverModelTrim\(\{ vehicle, html, url \}\); \} catch \(err\)/);
    assert.match(src, /try \{ pageTrim = recoverTrim\(\{ vehicle, html \}\); \} catch \(err\)/);
  });
  it('recovers a page-text trim only when the trim is still blank', () => {
    const i = src.indexOf('try { pageTrim = recoverTrim({ vehicle, html });');
    assert.ok(i > 0);
    assert.match(src.slice(i - 260, i), /if \(!vehicle\.trim && vehicle\.model\)/);
  });
});
