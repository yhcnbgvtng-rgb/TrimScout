import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanTrim, decodeHtmlEntities } from '../src/ingestSanitize.js';

// Trim strings are the real ones seen in data/lightsail_inventory.json (Ford and Porsche rows).
const ford = (t) => cleanTrim(t, { make: 'Ford' });

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    assert.equal(decodeHtmlEntities('A&reg;B&#174;C&#xAE;D&trade;'), 'A®B®C®D™');
    assert.equal(decodeHtmlEntities('Sport &amp; Tech &quot;X&quot;'), 'Sport & Tech "X"');
  });
  it('decodes a double-escaped entity but no more than that', () => {
    assert.equal(decodeHtmlEntities('Lariat&amp;reg;'), 'Lariat®');
    assert.equal(decodeHtmlEntities('&amp;amp;amp;'), '&amp;');
  });
  it('leaves unknown or malformed entities and plain text alone', () => {
    assert.equal(decodeHtmlEntities('XLT &bogus; &#0; &#99999999; & more'), 'XLT &bogus; &#0; &#99999999; & more');
    assert.equal(decodeHtmlEntities('Base'), 'Base');
    assert.equal(decodeHtmlEntities(null), null);
  });
});

describe('cleanTrim: entities and trademark marks', () => {
  it('"Platinum®" becomes "Platinum" whichever way the ® arrives', () => {
    for (const raw of ['Platinum&reg;', 'Platinum&#174;', 'Platinum&#xAE;', 'Platinum®', 'Platinum&amp;reg;']) assert.equal(ford(raw), 'Platinum', raw);
  });
  it('real Ford trims', () => {
    assert.equal(ford('Outer Banks&reg;'), 'Outer Banks');
    assert.equal(ford('F-250&reg; Lariat&reg;'), 'F-250 Lariat');
    assert.equal(ford('F-350&reg; Platinum&reg;'), 'F-350 Platinum');
    assert.equal(ford('Ecoboost&reg; Premium Fastback'), 'Ecoboost Premium Fastback');
    assert.equal(ford('Dark Horse&reg; SC'), 'Dark Horse SC');
  });
  it('applies to any make, and keeps a legitimate ampersand', () => {
    assert.equal(cleanTrim('Sport &amp; Tech&trade;', { make: 'Honda' }), 'Sport & Tech');
    assert.equal(cleanTrim('Denali&reg;', { make: 'GMC' }), 'Denali');
  });
});

describe('cleanTrim: drivetrain words are kept', () => {
  // The trim is the only stored place for the drivetrain (no column, no shard field), so it must survive the cleanup.
  it('keeps 4WD / AWD / 4x4 / RWD / FWD / 2WD at the end, any case, for any make', () => {
    for (const make of ['Ford', 'Kia', 'Porsche', 'Tesla']) {
      for (const w of ['4WD', 'AWD', '4x4', 'RWD', 'FWD', '2WD', '4wd', 'Awd', '4X4']) assert.equal(cleanTrim(`XLT ${w}`, { make }), `XLT ${w}`, `${make} ${w}`);
    }
  });
  it('real trims keep their drivetrain', () => {
    assert.equal(ford('XLT 4WD'), 'XLT 4WD');
    assert.equal(ford('Base 2 Door 4x4'), 'Base 2 Door 4x4');
    assert.equal(ford('HR Cargo RWD'), 'HR Cargo RWD');
    assert.equal(cleanTrim('Coupe AWD', { make: 'Porsche' }), 'Coupe AWD');
    assert.equal(cleanTrim('Long Range AWD', { make: 'Tesla' }), 'Long Range AWD');
    assert.equal(cleanTrim('Wind AWD', { make: 'Kia' }), 'Wind AWD');
    assert.equal(cleanTrim('Sport 4x4', { make: 'Ford' }), 'Sport 4x4');
  });
  it('still decodes entities and marks next to a drivetrain word', () => {
    assert.equal(ford('Raptor&reg; 4x4'), 'Raptor 4x4');
    assert.equal(cleanTrim('GT-Line&reg;  AWD', { make: 'kia' }), 'GT-Line AWD');
    assert.equal(ford('F-250&reg; XLT 4WD'), 'F-250 XLT 4WD');
  });
  it('the same trim with and without a drivetrain stays two trims (no silent merge)', () => {
    assert.notEqual(ford('XLT'), ford('XLT 4WD'));
    assert.notEqual(ford('Long Range RWD'), ford('Long Range AWD'));
  });
});

describe('cleanTrim: pass-through', () => {
  it('collapses whitespace and leaves a clean trim, blank or non-string untouched', () => {
    assert.equal(ford('  Big   Bend '), 'Big Bend');
    assert.equal(ford('Lariat'), 'Lariat');
    assert.equal(ford(''), '');
    assert.equal(ford(null), null);
    assert.equal(ford(undefined), undefined);
  });
  it('is idempotent', () => {
    for (const raw of ['F-250&reg; XLT 4WD', 'Platinum&amp;reg;', 'Base 2 Door 4x4']) assert.equal(ford(ford(raw)), ford(raw), raw);
  });
});

describe('wiring', () => {
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  it('the crawler cleans the trim before the sticker/price steps, and the DB writer cleans it too', () => {
    const s = src('standalone.js');
    assert.ok(s.indexOf('cleanTrim(vehicle.trim') > s.indexOf('resolveMileage(vehicle.mileage'));
    assert.ok(s.indexOf('cleanTrim(vehicle.trim') < s.indexOf('applyWindowSticker(vehicle, html'));
    assert.ok(/truncate\(cleanTrim\(r\.trim/.test(src('db.js')));
  });
});
