#!/usr/bin/env node
// Fetch official OEM dealer-locator pages/APIs for IN brands.
// Detect-only: never retry a 403 with a different client (patchright is used
// only where a locator page is JS-hydrated but returns a clean 200 to the
// honest TrimScout-locator UA — confirmed per-brand in the fetch function's
// comment — never to push past an actual block), never invent
// brandofcity.com hosts.
//
// Writes dealers/oem-dumps/<brand>.json plus _status.json.
// Re-run on Lightsail if Honda/Acura/BMW/Nissan return 403/Access-Denied from
// this IP (Honda/Nissan are confirmed Akamai-blocked even via patchright, as
// of the 2026-09-14 rerun — worth re-testing from a different egress IP).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'patchright';
import { hostFromUrl, isOemMarketingHost } from '../src/oem_locator.js';
import { normalizeDealerHost } from '../src/nj_verified_domains.js';
import { SUPPORTED_STATES } from '../src/states.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dealers', 'oem-dumps');
const UA = 'Mozilla/5.0 (compatible; TrimScout-locator/1.0; +https://github.com/yhcnbgvtng-rgb/TrimScout)';
const TIMEOUT_MS = 15000;

// Every state this capture tool pulls real rows for — src/states.js is the
// single source of truth (adding a state there needs a matching zip/city
// seed added below, nothing else).
const TARGET_STATES = SUPPORTED_STATES;

function inTargetStates(state) {
  return TARGET_STATES.includes(String(state || '').toUpperCase());
}

// NJ/NY zip spread (same set fetchMercedes uses) — dense enough to cover
// both states' dealer networks without needing every zip.
const NJ_NY_ZIPS = [
  '07004', '07024', '07030', '07052', '07701', '07739', '07860',
  '08034', '08096', '08234', '08648', '08807', '08902',
  '10001', '10301', '10451', '10940', '11201', '11501', '11743',
  '12205', '12601', '13212', '13501', '13901', '14221', '14623', '14850',
];

// Florida zip spread, one roughly every 50-70 miles from the panhandle to
// the Keys so a 50-120mi-radius zip locator (Mercedes/Mini/Subaru/Mazda/
// Kia) still covers the whole state without querying every zip in it.
const FL_ZIPS = [
  '32501', // Pensacola
  '32401', // Panama City
  '32301', // Tallahassee
  '32202', // Jacksonville
  '32601', // Gainesville
  '32114', // Daytona Beach
  '34470', // Ocala
  '32801', // Orlando
  '32901', // Melbourne
  '33602', // Tampa
  '33755', // Clearwater
  '33801', // Lakeland
  '34236', // Sarasota
  '33901', // Fort Myers
  '34102', // Naples
  '34952', // Port St. Lucie
  '33401', // West Palm Beach
  '33301', // Fort Lauderdale
  '33101', // Miami
  '33040', // Key West
];

// Georgia zip spread, one per major metro/regional hub from the north
// Georgia mountains to the coast and south Georgia — dense enough that a
// 50-120mi-radius zip locator (Mercedes/Mini/Subaru/Mazda/Kia) still covers
// the whole state without querying every zip in it. Verified live against
// Subaru/Mazda/Mercedes/Mini's actual locator endpoints (2026-09-15): every
// zip below returns real in-state rows, and the more rural south-Georgia
// zips (Albany/Valdosta/Brunswick/Statesboro/Dublin) each surface rooftops
// the metro-Atlanta zips alone missed for short-radius brands like Mazda.
const GA_ZIPS = [
  '30303', // Atlanta
  '30060', // Marietta (north Atlanta metro)
  '30161', // Rome (northwest)
  '30720', // Dalton (far north)
  '30501', // Gainesville (north)
  '30601', // Athens (northeast)
  '30901', // Augusta (east, SC border)
  '31021', // Dublin (east-central)
  '31201', // Macon (central)
  '31088', // Warner Robins (central)
  '31901', // Columbus (west, AL border)
  '31701', // Albany (southwest)
  '31601', // Valdosta (south)
  '30458', // Statesboro (southeast)
  '31520', // Brunswick (southeast coast)
  '31401', // Savannah (east coast)
];

// Texas zip spread. TX is the second-largest US auto market and roughly
// 3x FL's land area, so one zip (or even one per metro) would badly
// under-cover a 50-120mi-radius zip locator (Mercedes/Mini/Subaru/Mazda/
// Kia) — a single DFW zip's radius doesn't reach Houston, let alone El
// Paso. 20 seeds: every major metro (DFW split into Dallas/Fort Worth/
// Plano since the metro alone is ~9,000 sq mi; Houston split into
// downtown/Woodlands/Sugar Land for the same reason; Austin; San
// Antonio) plus regional hubs spanning the panhandle, west Texas, the
// Rio Grande Valley, south Texas, east Texas and the coast, so no
// 120mi-radius locator has an uncovered gap larger than a metro's own
// radius.
const TX_ZIPS = [
  '75201', // Dallas
  '76102', // Fort Worth
  '75074', // Plano (north DFW)
  '77002', // Houston (downtown)
  '77380', // The Woodlands (north Houston)
  '77478', // Sugar Land (southwest Houston)
  '78701', // Austin
  '78205', // San Antonio
  '79901', // El Paso (far west)
  '79401', // Lubbock (northwest)
  '79101', // Amarillo (panhandle)
  '79701', // Midland (Permian Basin)
  '79601', // Abilene (west-central)
  '76301', // Wichita Falls (north)
  '76701', // Waco (central)
  '75701', // Tyler (east)
  '77701', // Beaumont (southeast)
  '78401', // Corpus Christi (south coast)
  '78501', // McAllen (Rio Grande Valley)
  '78040', // Laredo (south, Mexico border)
];

// South Carolina zip spread. SC is a compact state (~32,000 sq mi, smaller
// than GA and far smaller than TX) with its dealer network concentrated in
// a handful of metros, so it needs far fewer seeds than GA/TX — 8 covers
// every real population/dealer cluster with a 50-120mi-radius zip locator
// (Mercedes/Mini/Subaru/Mazda/Kia): the three biggest metros (Charleston,
// Columbia, Greenville/Spartanburg), the coastal tourist/retiree corridor
// (Myrtle Beach, Hilton Head), and the remaining regional hubs (Rock Hill
// in the Charlotte NC exurbs, Florence in the Pee Dee region, Aiken/Augusta
// border). Confirmed against the in-repo nationwide Acura/Porsche dumps
// before picking these — every metro below already has at least one real
// rooftop in acura-dealers.json or dealers.json (Charleston, Greenville,
// Columbia, Hilton Head all appear), so the seed list matches SC's actual
// dealer geography rather than just population.
const SC_ZIPS = [
  '29401', // Charleston
  '29201', // Columbia
  '29601', // Greenville
  '29302', // Spartanburg
  '29577', // Myrtle Beach
  '29926', // Hilton Head Island
  '29730', // Rock Hill (Charlotte NC exurbs)
  '29501', // Florence (Pee Dee region)
];

// Virginia zip spread. VA is larger than SC (~42,000 sq mi vs ~32,000) and
// has a genuinely distinct, dense Northern VA/DC-suburbs market (Fairfax,
// Arlington, Alexandria) that isn't reachable from a Richmond seed alone —
// even a 120mi-radius locator falls well short of the ~100mi gap between
// Richmond and the DC suburbs, so Northern VA gets two seeds of its own
// (Fairfax/Tysons and Arlington/Alexandria) rather than assuming Richmond's
// radius covers it. 10 seeds total: Northern VA split in two (the region's
// dealer density alone rivals the rest of the state), Richmond, Virginia
// Beach/Norfolk/Hampton Roads (split into two since the Hampton
// Roads metro spans a large bay), Roanoke (southwest), Charlottesville
// (central), Lynchburg (south-central), Fredericksburg (I-95 corridor
// between DC and Richmond), and Winchester (Shenandoah Valley/I-81
// corridor) — covering every real population/dealer cluster the same way
// GA's and TX's regional-hub seeds do.
const VA_ZIPS = [
  '22030', // Fairfax / Tysons (Northern VA)
  '22314', // Alexandria / Arlington (Northern VA, DC suburbs)
  '23219', // Richmond
  '23451', // Virginia Beach
  '23510', // Norfolk (Hampton Roads)
  '24011', // Roanoke (southwest)
  '22901', // Charlottesville (central)
  '24501', // Lynchburg (south-central)
  '22401', // Fredericksburg (I-95 corridor)
  '22601', // Winchester (Shenandoah Valley / I-81 corridor)
];

// North Carolina zip spread. NC has two large, genuinely distinct metro
// clusters rather than one dominant city (unlike SC/Charleston or
// GA/Atlanta): Charlotte in the west and the Raleigh-Durham "Research
// Triangle" + Piedmont Triad (Greensboro/Winston-Salem) in the center, plus
// separate coastal (Wilmington), mountain (Asheville) and southern
// (Fayetteville) markets a single-seed radius locator would miss entirely.
// Concord adds Charlotte-exurb density the same way VA's two Northern-VA
// seeds cover DC suburbs a Richmond seed alone can't reach.
const NC_ZIPS = [
  '28202', // Charlotte
  '28025', // Concord (Charlotte exurbs)
  '27601', // Raleigh
  '27701', // Durham (Research Triangle)
  '27401', // Greensboro (Piedmont Triad)
  '27101', // Winston-Salem (Piedmont Triad)
  '28801', // Asheville (mountains/west)
  '28401', // Wilmington (coast)
  '28301', // Fayetteville (south-central)
  '28601', // Hickory (western Piedmont/foothills)
];

// Rhode Island zip spread. RI is the smallest state by area (~1,200 sq mi,
// ~48 miles end to end) — unlike every other state added so far, one
// seed's typical 50-100mi locator radius already spans the entire state,
// so this is margin rather than genuine multi-region coverage: Providence
// (the dominant market) plus Westerly in the far southwest corner, to make
// sure the corner nearest the CT border isn't relying solely on radius
// overlap from the Providence seed.
const RI_ZIPS = [
  '02903', // Providence
  '02891', // Westerly (southwest corner, near CT border)
];

// Vermont zip spread. VT has no single dominant metro (Burlington is the
// largest city at under 50,000 people) — population and dealers instead
// string out along two corridors: US-7 down the western spine
// (Burlington to Rutland to Bennington) and the southeastern corner along
// I-91 (Brattleboro). St. Johnsbury seeds the otherwise-unreached
// Northeast Kingdom.
const VT_ZIPS = [
  '05401', // Burlington (largest metro)
  '05701', // Rutland (central)
  '05201', // Bennington (southwest)
  '05301', // Brattleboro (southeast, I-91 corridor)
  '05819', // St. Johnsbury (Northeast Kingdom)
];

// New Hampshire zip spread. Population and dealers concentrate in the
// south, near the MA border and along the Merrimack Valley — Manchester
// (largest city), Nashua and Salem all sit within that corridor. Concord
// covers the capital/central belt and Portsmouth the seacoast, the two
// regions a southern-NH-only seed set would miss.
const NH_ZIPS = [
  '03101', // Manchester (largest city)
  '03060', // Nashua (southern NH, MA border)
  '03079', // Salem (southern NH, MA border retail corridor)
  '03301', // Concord (capital, central)
  '03801', // Portsmouth (seacoast)
];

// Massachusetts zip spread. Far more populous (~7M) than the New England
// states added so far, with Boston metro dominant but real, distinct
// markets spread the width of the state: Worcester (central), the
// Springfield/Pioneer Valley market (west), New Bedford/Fall River (south
// coast), Lowell (Merrimack Valley, north), Cape Cod (Hyannis), and
// Pittsfield in the Berkshires (far west) — none of which a Boston-radius
// seed alone reaches.
const MA_ZIPS = [
  '02116', // Boston (dominant metro)
  '01608', // Worcester (central)
  '01103', // Springfield (Pioneer Valley, west)
  '01852', // Lowell (Merrimack Valley, north)
  '02740', // New Bedford (south coast)
  '02601', // Hyannis (Cape Cod)
  '01201', // Pittsfield (Berkshires, far west)
];

// California zip spread. The largest, most populous state added so far
// (~39M, edging out TX's ~30M) with more genuinely distinct major metros
// than any prior state: LA and the Bay Area are each bigger markets on
// their own than most entire states already in this crawler, plus San
// Diego, Sacramento, the Central Valley's agricultural cities, the Inland
// Empire, the Central Coast, and the far north are all real, separate
// dealer markets a handful of seeds would miss. 20 seeds, matching TX's
// count as the next-largest state onboarded.
const CA_ZIPS = [
  '90012', // Los Angeles (downtown)
  '90802', // Long Beach
  '92805', // Anaheim (Orange County)
  '92602', // Irvine (Orange County)
  '92101', // San Diego
  '91910', // Chula Vista (south San Diego County)
  '95113', // San Jose
  '94102', // San Francisco
  '94612', // Oakland
  '95814', // Sacramento
  '93721', // Fresno (Central Valley)
  '93301', // Bakersfield (southern Central Valley)
  '92501', // Riverside (Inland Empire)
  '92401', // San Bernardino (Inland Empire)
  '95202', // Stockton (Central Valley)
  '95350', // Modesto (Central Valley)
  '95401', // Santa Rosa (North Bay)
  '93101', // Santa Barbara (Central Coast)
  '92262', // Palm Springs (Coachella Valley/desert)
  '96001', // Redding (far north)
];

// Pennsylvania zip spread. Two genuinely distinct major metros at opposite
// corners (Philadelphia southeast, Pittsburgh southwest) rather than one
// dominant city, plus a string of real mid-size markets across the
// central corridor between them — Allentown/Lehigh Valley, Harrisburg
// (capital), Lancaster, Reading, York — and Scranton (northeast) and Erie
// (far northwest, on the lake) that neither Philadelphia's nor
// Pittsburgh's radius would reach.
const PA_ZIPS = [
  '19102', // Philadelphia
  '15222', // Pittsburgh
  '18101', // Allentown (Lehigh Valley)
  '17101', // Harrisburg (capital)
  '17603', // Lancaster
  '19601', // Reading (Berks County)
  '17401', // York
  '18503', // Scranton (northeast)
  '16501', // Erie (far northwest)
  '16601', // Altoona (central, distinct from Pittsburgh)
];

// Oklahoma zip spread. Two dominant metros (Oklahoma City, Tulsa) carry
// most of the state's population, with real secondary markets at Norman
// (OKC's university-town suburb), Lawton (southwest), Enid (north), and
// Ardmore (south) rounding out coverage a two-seed radius alone would miss.
const OK_ZIPS = [
  '73102', // Oklahoma City
  '74103', // Tulsa
  '73069', // Norman (OKC suburb)
  '73501', // Lawton (southwest)
  '73701', // Enid (north)
  '73401', // Ardmore (south)
];

// Illinois zip spread. Chicago and its suburbs dominate (~9.5M of IL's
// ~12.6M), so two Chicagoland seeds (downtown + the western/northwest
// suburban dealer corridor) anchor coverage there, but real downstate
// markets — Rockford (north), Peoria and Bloomington (central),
// Springfield (capital), Champaign (east-central), Quincy (west, on the
// Mississippi), and Carbondale (far south) — are each their own distinct
// market a Chicago-radius locator would never reach.
const IL_ZIPS = [
  '60602', // Chicago (downtown)
  '60540', // Naperville (west suburbs)
  '61101', // Rockford (north)
  '61602', // Peoria (central)
  '62701', // Springfield (capital)
  '61820', // Champaign (east-central)
  '61701', // Bloomington (central)
  '62301', // Quincy (west, Mississippi River)
  '62901', // Carbondale (far south)
];

// The remaining 34 states, added 2026-09-20 as part of scaling to
// nationwide coverage across multiple crawl boxes. Same real-metro,
// population-scaled zip-seed approach as every prior state: 1-2 seeds for
// the smallest/single-metro states (HI, AK, DE, WY...), up to 7 for the
// biggest remaining ones (OH, MI) with multiple genuinely distinct
// markets.
const OH_ZIPS = [
  '43215', // Columbus (capital, largest)
  '44113', // Cleveland
  '45202', // Cincinnati
  '43604', // Toledo
  '44308', // Akron
  '45402', // Dayton
  '44503', // Youngstown
];

const MI_ZIPS = [
  '48226', // Detroit (dominant)
  '49503', // Grand Rapids
  '48933', // Lansing (capital)
  '48502', // Flint
  '49685', // Traverse City (north)
];

const WA_ZIPS = [
  '98101', // Seattle (dominant)
  '99201', // Spokane (east)
  '98402', // Tacoma
  '98660', // Vancouver WA (south, near Portland)
  '98501', // Olympia (capital)
];

const AZ_ZIPS = [
  '85003', // Phoenix (dominant)
  '85701', // Tucson
  '86001', // Flagstaff (north)
  '85364', // Yuma (southwest)
];

const TN_ZIPS = [
  '37201', // Nashville (capital)
  '38103', // Memphis
  '37902', // Knoxville
  '37402', // Chattanooga
];

const IN_ZIPS = [
  '46204', // Indianapolis (dominant)
  '46802', // Fort Wayne
  '47708', // Evansville
  '46601', // South Bend
];

const MO_ZIPS = [
  '64106', // Kansas City
  '63101', // St. Louis
  '65806', // Springfield MO
  '65101', // Jefferson City (capital)
];

const IA_ZIPS = [
  '50309', // Des Moines (capital, dominant)
  '52401', // Cedar Rapids
  '52801', // Davenport (Quad Cities, east)
];

const MD_ZIPS = [
  '21201', // Baltimore (dominant)
  '20852', // Rockville (DC suburbs)
  '21401', // Annapolis (capital)
  '21801', // Salisbury (Eastern Shore)
];

const WI_ZIPS = [
  '53202', // Milwaukee (dominant)
  '53703', // Madison (capital)
  '54301', // Green Bay
  '54701', // Eau Claire
];

const CO_ZIPS = [
  '80202', // Denver (dominant)
  '80903', // Colorado Springs
  '80521', // Fort Collins
  '81501', // Grand Junction (west)
];

const MN_ZIPS = [
  '55402', // Minneapolis
  '55102', // St. Paul
  '55802', // Duluth (north)
  '55901', // Rochester MN (south)
];

const AL_ZIPS = [
  '35203', // Birmingham (dominant)
  '36104', // Montgomery (capital)
  '36602', // Mobile (south)
  '35801', // Huntsville (north)
];

const LA_ZIPS = [
  '70112', // New Orleans (dominant)
  '70802', // Baton Rouge (capital)
  '71101', // Shreveport
  '70501', // Lafayette
];

const KY_ZIPS = [
  '40202', // Louisville (dominant)
  '40507', // Lexington
  '42101', // Bowling Green
];

const OR_ZIPS = [
  '97204', // Portland (dominant)
  '97401', // Eugene
  '97301', // Salem (capital)
  '97701', // Bend (central)
];

const NV_ZIPS = [
  '89101', // Las Vegas (dominant)
  '89501', // Reno
];

const UT_ZIPS = [
  '84101', // Salt Lake City (dominant)
  '84601', // Provo
  '84770', // St. George (south)
];

const CT_ZIPS = [
  '06103', // Hartford (capital)
  '06510', // New Haven
  '06901', // Stamford (near NYC)
];

const AR_ZIPS = [
  '72201', // Little Rock (capital, dominant)
  '72701', // Fayetteville (northwest)
];

const MS_ZIPS = [
  '39201', // Jackson (capital, dominant)
  '39501', // Gulfport (south)
];

const KS_ZIPS = [
  '67202', // Wichita (dominant)
  '66210', // Overland Park (KC metro)
  '66603', // Topeka (capital)
];

const NM_ZIPS = [
  '87102', // Albuquerque (dominant)
  '87501', // Santa Fe (capital)
  '88001', // Las Cruces (south)
];

const NE_ZIPS = [
  '68102', // Omaha (dominant)
  '68508', // Lincoln (capital)
];

const WV_ZIPS = [
  '25301', // Charleston (capital)
  '26505', // Morgantown
];

const ID_ZIPS = [
  '83702', // Boise (dominant)
  '83401', // Idaho Falls
  '83814', // Coeur d'Alene (north)
];

const HI_ZIPS = [
  '96813', // Honolulu (dominant, Oahu)
];

const ME_ZIPS = [
  '04101', // Portland ME (dominant)
  '04401', // Bangor
];

const MT_ZIPS = [
  '59101', // Billings
  '59802', // Missoula
  '59718', // Bozeman
];

const SD_ZIPS = [
  '57104', // Sioux Falls (dominant)
  '57701', // Rapid City (west)
];

const ND_ZIPS = [
  '58102', // Fargo (dominant)
  '58501', // Bismarck (capital)
];

const AK_ZIPS = [
  '99501', // Anchorage (dominant)
];

const DE_ZIPS = [
  '19801', // Wilmington (dominant)
  '19901', // Dover (capital)
];

const WY_ZIPS = [
  '82001', // Cheyenne (capital)
  '82601', // Casper
];

// Combined zip spread used by every zip+radius OEM locator below.
const TARGET_ZIPS = [...NJ_NY_ZIPS, ...FL_ZIPS, ...GA_ZIPS, ...TX_ZIPS, ...SC_ZIPS, ...VA_ZIPS, ...NC_ZIPS, ...RI_ZIPS, ...VT_ZIPS, ...NH_ZIPS, ...MA_ZIPS, ...CA_ZIPS, ...PA_ZIPS, ...OK_ZIPS, ...IL_ZIPS, ...OH_ZIPS, ...MI_ZIPS, ...WA_ZIPS, ...AZ_ZIPS, ...TN_ZIPS, ...IN_ZIPS, ...MO_ZIPS, ...IA_ZIPS, ...MD_ZIPS, ...WI_ZIPS, ...CO_ZIPS, ...MN_ZIPS, ...AL_ZIPS, ...LA_ZIPS, ...KY_ZIPS, ...OR_ZIPS, ...NV_ZIPS, ...UT_ZIPS, ...CT_ZIPS, ...AR_ZIPS, ...MS_ZIPS, ...KS_ZIPS, ...NM_ZIPS, ...NE_ZIPS, ...WV_ZIPS, ...ID_ZIPS, ...HI_ZIPS, ...ME_ZIPS, ...MT_ZIPS, ...SD_ZIPS, ...ND_ZIPS, ...AK_ZIPS, ...DE_ZIPS, ...WY_ZIPS];

function hostOf(url) {
  return hostFromUrl(url) || normalizeDealerHost(url);
}

function row({ make, name, city, state, domain, lat = null, lng = null, sourceUrl = null }) {
  const host = hostOf(domain);
  if (!host || isOemMarketingHost(host) || !name || !state) return null;
  return {
    make,
    name: String(name).trim(),
    city: city ? String(city).trim() : null,
    state: String(state).trim().toUpperCase(),
    domain: host,
    lat,
    lng,
    source: 'oem-locator',
    sourceUrl,
  };
}

async function fetchText(url, { accept = 'text/html,application/json;q=0.9,*/*;q=0.8', referer } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: accept,
        ...(referer ? { Referer: referer } : {}),
      },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, url };
  } catch (err) {
    return { ok: false, status: 0, text: '', url, error: err.message };
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, opts) {
  const got = await fetchText(url, { accept: 'application/json,text/plain,*/*', ...opts });
  if (!got.ok) return { ...got, json: null };
  try {
    return { ...got, json: JSON.parse(got.text) };
  } catch (err) {
    return { ...got, json: null, error: err.message };
  }
}

function uniqRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r) continue;
    const key = `${r.make}|${r.state}|${r.name}|${r.domain}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.sort((a, b) => {
    const s = a.state.localeCompare(b.state);
    if (s) return s;
    return a.name.localeCompare(b.name);
  });
}

async function writeDump(brand, rows, status) {
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dest = path.join(OUT_DIR, `${slug}.json`);
  await fs.writeFile(dest, `${JSON.stringify(uniqRows(rows), null, 2)}\n`);
  return { brand, dest: path.relative(ROOT, dest), count: uniqRows(rows).length, ...status };
}

function parseToyotaCards(html, sourceUrl) {
  const rows = [];
  for (const card of html.split('class="dealer-card"').slice(1)) {
    const name = card.match(/dealer-card__title-heading">([^<]+)/)?.[1]?.trim();
    const addr = (card.match(/dealer-card__title-subHeading">\s*([^<]+)/)?.[1] || '').replace(/\s+/g, ' ').trim();
    const site = card.match(/data-aa-action="km-dealer-visit_site"[^>]*data-primary-href="(https?:\/\/[^"?]+)/)?.[1]
      || card.match(/data-primary-href="(https?:\/\/[^"?]+)"[^>]*data-aa-action="km-dealer-visit_site"/)?.[1]
      || card.match(/href="(https?:\/\/(?!www\.google)[^"?]+)\?intsrc=tcom:dealerlisting:dealervisit/)?.[1];
    const m = addr.match(/,\s*([^,]+),\s*([A-Z]{2}),\s*(\d{5})/);
    if (!name || !site || !m) continue;
    const rec = row({
      make: 'Toyota',
      name,
      city: m[1],
      state: m[2],
      domain: site,
      sourceUrl,
    });
    if (rec && inTargetStates(rec.state)) rows.push(rec);
  }
  return rows;
}

async function fetchToyota() {
  const cities = [
    'new-jersey/avenel',
    'new-jersey/cherry-hill',
    'new-jersey/vineland',
    'new-jersey/turnersville',
    'new-jersey/mays-landing',
    'new-york/brooklyn',
    'new-york/buffalo',
    'new-york/rochester',
    'new-york/syracuse',
    'new-york/albany',
    'new-york/binghamton',
    'new-york/yonkers',
    'new-york/white-plains',
    'florida/jacksonville',
    'florida/tallahassee',
    'florida/pensacola',
    'florida/orlando',
    'florida/tampa',
    'florida/fort-myers',
    'florida/naples',
    'florida/west-palm-beach',
    'florida/fort-lauderdale',
    'florida/miami',
    'georgia/atlanta',
    'georgia/marietta',
    'georgia/rome',
    'georgia/dalton',
    'georgia/gainesville',
    'georgia/athens',
    'georgia/augusta',
    'georgia/dublin',
    'georgia/macon',
    'georgia/warner-robins',
    'georgia/columbus',
    'georgia/albany',
    'georgia/valdosta',
    'georgia/statesboro',
    'georgia/brunswick',
    'georgia/savannah',
    'texas/dallas',
    'texas/fort-worth',
    'texas/plano',
    'texas/houston',
    'texas/the-woodlands',
    'texas/sugar-land',
    'texas/austin',
    'texas/san-antonio',
    'texas/el-paso',
    'texas/lubbock',
    'texas/amarillo',
    'texas/midland',
    'texas/abilene',
    'texas/wichita-falls',
    'texas/waco',
    'texas/tyler',
    'texas/beaumont',
    'texas/corpus-christi',
    'texas/mcallen',
    'texas/laredo',
    'south-carolina/charleston',
    'south-carolina/columbia',
    'south-carolina/greenville',
    'south-carolina/spartanburg',
    'south-carolina/myrtle-beach',
    'south-carolina/hilton-head-island',
    'south-carolina/rock-hill',
    'south-carolina/florence',
    'virginia/fairfax',
    'virginia/alexandria',
    'virginia/richmond',
    'virginia/virginia-beach',
    'virginia/norfolk',
    'virginia/roanoke',
    'virginia/charlottesville',
    'virginia/lynchburg',
    'virginia/fredericksburg',
    'virginia/winchester',
    // Added 2026-09-17: NC/RI/VT/NH/MA/CA had NO entries here at all since
    // their state additions — this curated list was never updated past VA,
    // so every one of these states has only ever gotten Toyota coverage via
    // incidental spillover on a NEIGHBORING state's city-hub page, not a
    // real per-state search. Confirmed via git history: toyota.json's
    // committed count (307, matching the pre-CA total) barely grew across
    // 5 state additions, consistent with spillover-only coverage rather
    // than genuine new-state search. Slugs below are best-effort standard
    // city-slug conventions matching this file's existing pattern and each
    // state's own zip-seed geography (see NC_ZIPS/RI_ZIPS/etc. above) —
    // NOT yet verified live (Toyota's site was rate-limiting this box's IP
    // as of this addition, likely from repeated same-day nationwide
    // re-fetches); re-run this script once fetchable again and check
    // `pages` in the toyota write-dump's metadata for any 404s to correct.
    'north-carolina/charlotte',
    'north-carolina/concord',
    'north-carolina/raleigh',
    'north-carolina/durham',
    'north-carolina/greensboro',
    'north-carolina/winston-salem',
    'north-carolina/asheville',
    'north-carolina/wilmington',
    'north-carolina/fayetteville',
    'north-carolina/hickory',
    'rhode-island/providence',
    'rhode-island/westerly',
    'vermont/burlington',
    'vermont/rutland',
    'vermont/bennington',
    'vermont/brattleboro',
    'vermont/st-johnsbury',
    'new-hampshire/manchester',
    'new-hampshire/nashua',
    'new-hampshire/salem',
    'new-hampshire/concord',
    'new-hampshire/portsmouth',
    'massachusetts/boston',
    'massachusetts/worcester',
    'massachusetts/springfield',
    'massachusetts/lowell',
    'massachusetts/new-bedford',
    'massachusetts/hyannis',
    'massachusetts/pittsfield',
    'california/los-angeles',
    'california/long-beach',
    'california/anaheim',
    'california/irvine',
    'california/san-diego',
    'california/chula-vista',
    'california/san-jose',
    'california/san-francisco',
    'california/oakland',
    'california/sacramento',
    'california/fresno',
    'california/bakersfield',
    'california/riverside',
    'california/san-bernardino',
    'california/stockton',
    'california/modesto',
    'california/santa-rosa',
    'california/santa-barbara',
    'california/palm-springs',
    'california/redding',
    // Added with PA's own state addition (2026-09-18), same real per-state
    // slugs as every other state here — see this list's own header comment
    // for why NC/RI/VT/NH/MA/CA had to be added after the fact instead of
    // at onboarding time; PA gets its slugs up front to avoid repeating
    // that gap.
    'pennsylvania/philadelphia',
    'pennsylvania/pittsburgh',
    'pennsylvania/allentown',
    'pennsylvania/harrisburg',
    'pennsylvania/lancaster',
    'pennsylvania/reading',
    'pennsylvania/york',
    'pennsylvania/scranton',
    'pennsylvania/erie',
    'pennsylvania/altoona',
    // Added with the 34-state scale-out (2026-09-20), same real
    // per-state slugs as every other state here.
    'ohio/columbus',
    'ohio/cleveland',
    'ohio/cincinnati',
    'ohio/toledo',
    'ohio/akron',
    'ohio/dayton',
    'ohio/youngstown',
    'michigan/detroit',
    'michigan/grand-rapids',
    'michigan/lansing',
    'michigan/flint',
    'michigan/traverse-city',
    'washington/seattle',
    'washington/spokane',
    'washington/tacoma',
    'washington/vancouver',
    'washington/olympia',
    'arizona/phoenix',
    'arizona/tucson',
    'arizona/flagstaff',
    'arizona/yuma',
    'tennessee/nashville',
    'tennessee/memphis',
    'tennessee/knoxville',
    'tennessee/chattanooga',
    'indiana/indianapolis',
    'indiana/fort-wayne',
    'indiana/evansville',
    'indiana/south-bend',
    'missouri/kansas-city',
    'missouri/st-louis',
    'missouri/springfield-mo',
    'missouri/jefferson-city',
    'iowa/des-moines',
    'iowa/cedar-rapids',
    'iowa/davenport',
    'maryland/baltimore',
    'maryland/rockville',
    'maryland/annapolis',
    'maryland/salisbury',
    'wisconsin/milwaukee',
    'wisconsin/madison',
    'wisconsin/green-bay',
    'wisconsin/eau-claire',
    'colorado/denver',
    'colorado/colorado-springs',
    'colorado/fort-collins',
    'colorado/grand-junction',
    'minnesota/minneapolis',
    'minnesota/st-paul',
    'minnesota/duluth',
    'minnesota/rochester-mn',
    'alabama/birmingham',
    'alabama/montgomery',
    'alabama/mobile',
    'alabama/huntsville',
    'louisiana/new-orleans',
    'louisiana/baton-rouge',
    'louisiana/shreveport',
    'louisiana/lafayette',
    'kentucky/louisville',
    'kentucky/lexington',
    'kentucky/bowling-green',
    'oregon/portland',
    'oregon/eugene',
    'oregon/salem',
    'oregon/bend',
    'nevada/las-vegas',
    'nevada/reno',
    'utah/salt-lake-city',
    'utah/provo',
    'utah/st-george',
    'connecticut/hartford',
    'connecticut/new-haven',
    'connecticut/stamford',
    'arkansas/little-rock',
    'arkansas/fayetteville',
    'mississippi/jackson',
    'mississippi/gulfport',
    'kansas/wichita',
    'kansas/overland-park',
    'kansas/topeka',
    'new-mexico/albuquerque',
    'new-mexico/santa-fe',
    'new-mexico/las-cruces',
    'nebraska/omaha',
    'nebraska/lincoln',
    'west-virginia/charleston',
    'west-virginia/morgantown',
    'idaho/boise',
    'idaho/idaho-falls',
    'idaho/coeur-d-alene',
    'hawaii/honolulu',
    'maine/portland-me',
    'maine/bangor',
    'montana/billings',
    'montana/missoula',
    'montana/bozeman',
    'south-dakota/sioux-falls',
    'south-dakota/rapid-city',
    'north-dakota/fargo',
    'north-dakota/bismarck',
    'alaska/anchorage',
    'delaware/wilmington',
    'delaware/dover',
    'wyoming/cheyenne',
    'wyoming/casper',
    // Added with OK/IL's own state addition (2026-09-19), same real
    // per-state slugs as every other state here — see this list's own
    // header comment for why NC/RI/VT/NH/MA/CA had to be added after the
    // fact instead of at onboarding time; OK/IL get their slugs up front
    // to avoid repeating that gap.
    'oklahoma/oklahoma-city',
    'oklahoma/tulsa',
    'oklahoma/norman',
    'oklahoma/lawton',
    'oklahoma/enid',
    'illinois/chicago',
    'illinois/naperville',
    'illinois/rockford',
    'illinois/peoria',
    'illinois/springfield',
    'illinois/champaign',
    'illinois/bloomington',
    'illinois/quincy',
  ];
  const rows = [];
  const pages = [];
  for (const slug of cities) {
    const url = `https://www.toyota.com/dealers/${slug}/dealers/`;
    const got = await fetchText(url);
    pages.push({ url, status: got.status, ok: got.ok });
    if (got.ok) rows.push(...parseToyotaCards(got.text, url));
  }
  const inScope = rows.filter((r) => inTargetStates(r.state));
  return writeDump('toyota', inScope, {
    locator: 'https://www.toyota.com/dealers/directory/',
    note: 'Official Toyota dealer-hub city pages (dealer-card websites).',
    pages,
    blocked: pages.every((p) => p.status === 403),
  });
}

async function fetchLexus() {
  const url = 'https://www.lexus.com/rest/lexus/dealers';
  const got = await fetchJson(url, { referer: 'https://www.lexus.com/dealers' });
  const dealers = got.json?.dealers || [];
  const rows = [];
  for (const d of dealers) {
    const addr = d.dealerAddress || {};
    if (!inTargetStates(addr.state)) continue;
    rows.push(row({
      make: 'Lexus',
      name: d.dealerName,
      city: addr.city,
      state: addr.state,
      domain: d.dealerSiteUrl,
      lat: d.dealerLatitude ?? null,
      lng: d.dealerLongitude ?? null,
      sourceUrl: url,
    }));
  }
  return writeDump('lexus', rows, {
    locator: url,
    note: 'Official Lexus REST dealer directory.',
    httpStatus: got.status,
    blocked: got.status === 403,
    nationwideCount: dealers.length,
  });
}

async function fetchMercedes() {
  const zips = TARGET_ZIPS;
  const rows = [];
  const pages = [];
  for (const zip of zips) {
    const url = `https://nafta-service.mbusa.com/api/dlrsrv/v1/dealers?zip=${zip}&distance=120&filter=mbdealer&country=us&language=en`;
    const got = await fetchJson(url, { referer: 'https://www.mbusa.com/en/dealers' });
    pages.push({ zip, status: got.status, ok: got.ok });
    for (const d of got.json?.dealers || []) {
      const addr = (d.address || [])[0] || {};
      if (!inTargetStates(addr.state)) continue;
      rows.push(row({
        make: 'Mercedes-Benz',
        name: d.name,
        city: addr.city,
        state: addr.state,
        domain: d.url,
        lat: addr.location?.lat ? Number(addr.location.lat) : null,
        lng: addr.location?.lng ? Number(addr.location.lng) : null,
        sourceUrl: url,
      }));
    }
  }
  return writeDump('mercedes-benz', rows, {
    locator: 'https://www.mbusa.com/en/dealers',
    note: 'Official MBUSA dealerLocatorService (zip + distance + mbdealer filter).',
    pages,
    blocked: pages.every((p) => p.status === 403),
  });
}

function parseMitsubishi(html, sourceUrl) {
  const rows = [];
  const dealerRe = /"(Dealer_\d+)":\{[^{}]*?"name":"([^"]+)"[^{}]*?"url":"([^"]+)"/g;
  const dealers = new Map();
  let m;
  while ((m = dealerRe.exec(html))) {
    dealers.set(m[1], { id: m[1], name: m[2], url: m[3] });
  }
  const addrRe = /"\$(Dealer_\d+)\.address":\{[^{}]*?"addressLine2":"([^"]*)"[^{}]*?"addressLine3":"([^"]*)"[^{}]*?"postalArea":"([^"]*)"/g;
  while ((m = addrRe.exec(html))) {
    const d = dealers.get(m[1]);
    if (!d) continue;
    d.city = m[2];
    d.state = m[3];
    d.zip = m[4];
  }
  for (const d of dealers.values()) {
    const state = String(d.state || '').toUpperCase();
    if (!inTargetStates(state)) continue;
    const name = d.name || '';
    if (/parts depot|parts only/i.test(name)) continue;
    if (!/mitsubishi/i.test(name) && /subaru|toyota|honda|nissan/i.test(name)) continue;
    rows.push(row({
      make: 'Mitsubishi',
      name: d.name,
      city: d.city,
      state,
      domain: d.url,
      sourceUrl,
    }));
  }
  return rows;
}

async function fetchMitsubishi() {
  const url = 'https://www.mitsubishicars.com/dealers';
  const got = await fetchText(url);
  const rows = got.ok ? parseMitsubishi(got.text, url) : [];
  return writeDump('mitsubishi', rows, {
    locator: url,
    note: 'Official Mitsubishi dealers page (embedded Apollo dealer cache).',
    httpStatus: got.status,
    blocked: got.status === 403,
  });
}

async function tryBlocked(brand, locator, urls) {
  const pages = [];
  for (const url of urls) {
    const got = await fetchText(url);
    pages.push({ url, status: got.status, ok: got.ok, error: got.error || null });
  }
  return writeDump(brand, [], {
    locator,
    note: 'Official locator blocked or empty from this IP. Do not bypass. Re-run on Lightsail.',
    pages,
    blocked: pages.some((p) => p.status === 403),
  });
}

async function fetchHonda() {
  // Confirmed via both plain fetch and a real patchright browser render:
  // Akamai returns "Access Denied" (errors.edgesuite.net) either way — same
  // signature as Nissan. Genuine bot-protection block, not a wrong URL.
  return tryBlocked('honda', 'https://automobiles.honda.com/tools/dealership-locator', [
    'https://automobiles.honda.com/tools/dealership-locator',
    'https://automobiles.honda.com/platform/api/v1/dealer',
  ]);
}

async function fetchBmw() {
  return tryBlocked('bmw', 'https://www.bmwusa.com/dealer-locator.html', [
    'https://www.bmwusa.com/dealer-locator.html',
  ]);
}

// Found via real network capture (patchright, watching XHR/fetch while
// driving the #zipcode field + submit button on find-a-dealer.html): the
// widget calls a plain, unauthenticated JSON endpoint —
// /bin/services/dealer-locator/getAllDealerByZip.json/<zip>/<count> — that
// needs no browser at all once you know the path. Confirmed via plain curl
// with the honest TrimScout-locator UA (200, real dealer JSON, no cookies
// required). Each dealerDetailsObjects[] entry can carry separate
// newVehicleSales/certifiedPreowned/service/ccrc arrays for the same
// physical rooftop (service-only annex vs. the actual sales franchise) —
// only newVehicleSales is an authorized new-car rooftop, so that's the
// only one read here.
async function fetchMini() {
  const zips = TARGET_ZIPS;
  const rows = [];
  const pages = [];
  for (const zip of zips) {
    const url = `https://www.miniusa.com/bin/services/dealer-locator/getAllDealerByZip.json/${zip}/50?excludeServiceOnlyDealers=false&includeSatelliteDealers=true`;
    const got = await fetchJson(url);
    pages.push({ zip, status: got.status, ok: got.ok });
    const objs = got.json?.dealerLocator?.dealerDetails?.dealerDetailsObjects || [];
    for (const obj of objs) {
      for (const d of obj.newVehicleSales || []) {
        const addr = (d.address || [])[0] || {};
        const state = String(addr.state || '').toUpperCase();
        if (!inTargetStates(state)) continue;
        // MINI's own feed has at least one confirmed typo (dealerURL
        // "www.mininyc" missing its .com — the paired SATELLITE record for
        // the same rooftop has the correct "www.mininyc.com"). A host with
        // no dot cannot be a real domain, so skip rather than write a
        // guaranteed-dead URL.
        if (!String(d.dealerURL || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').includes('.')) continue;
        rows.push(row({
          make: 'Mini',
          name: d.dealerName,
          city: addr.city,
          state,
          domain: d.dealerURL,
          sourceUrl: url,
        }));
      }
    }
  }
  return writeDump('mini', rows, {
    locator: 'https://www.miniusa.com/tools/shopping/find-a-dealer.html',
    note: 'Official MINI dealer-locator JSON API (getAllDealerByZip), found via network capture; plain fetch, no browser needed.',
    pages,
    blocked: pages.length > 0 && pages.every((p) => !p.ok),
  });
}

// Kia's find-a-dealer result page is server-rendered per zip, but only after
// client JS hydrates (a plain fetch gets a 200 with an empty shell — this is
// not bot protection, confirmed by fetching with the same honest
// TrimScout-locator UA above). patchright is already a project dependency
// used elsewhere in this repo (standalone.js, finder_crawler.js) for exactly
// this situation — rendering a JS-hydrated official page, not bypassing a
// block. One page load per zip; dealer name + domain + address are read
// straight out of the rendered DOM.
const KIA_EXCLUDE_HOST = /kia\.com|maps\.google|kbb\.com|tiktok\.com|linkedin\.com|facebook\.com|twitter\.com|instagram\.com|youtube\.com|kiafinance\.com|kiaaccessoryguide\.com|kiausa\.com|here\.com|clinch\.co|pinterest\.com|doubleclick\.net|googleadservices\.com/i;

function parseKiaDealerAnchors(anchors, sourceUrl) {
  const rows = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    if (!/^https?:\/\//i.test(a.href) || KIA_EXCLUDE_HOST.test(a.href) || !a.text) continue;
    let addrText = '';
    for (let j = i + 1; j < Math.min(i + 4, anchors.length); j++) {
      if (/maps\.google\.com/i.test(anchors[j].href)) {
        addrText = anchors[j].text;
        break;
      }
    }
    if (!addrText) continue;
    const tail = addrText.split(/\s{2,}/).filter(Boolean).pop() || addrText;
    const m = tail.match(/^(.*?),\s*([A-Z]{2})\s+(\d{5})?/);
    if (!m) continue;
    const state = m[2];
    if (!inTargetStates(state)) continue;
    rows.push(row({
      make: 'Kia',
      name: a.text,
      city: m[1].trim(),
      state,
      domain: a.href,
      sourceUrl,
    }));
  }
  return rows;
}

async function fetchKia() {
  const zips = TARGET_ZIPS;
  const rows = [];
  const pages = [];
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    for (const zip of zips) {
      const url = `https://www.kia.com/us/en/find-a-dealer/result?zipCode=${zip}`;
      const page = await browser.newPage();
      try {
        const res = await page.goto(url, { waitUntil: 'load', timeout: 20000 });
        await page.waitForTimeout(2500);
        const anchors = await page.evaluate(() => Array.from(document.querySelectorAll('a')).map((a) => ({
          href: a.getAttribute('href') || '',
          text: (a.textContent || '').trim(),
        })));
        pages.push({ zip, status: res ? res.status() : 0, ok: !!res && res.ok() });
        rows.push(...parseKiaDealerAnchors(anchors, url));
      } catch (err) {
        pages.push({ zip, status: 0, ok: false, error: err.message });
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return writeDump('kia', rows, {
    locator: 'https://www.kia.com/us/en/find-a-dealer',
    note: 'Official Kia find-a-dealer results, rendered per zip (patchright; page is JS-hydrated, not bot-blocked).',
    pages,
    blocked: pages.length > 0 && pages.every((p) => !p.ok),
  });
}

async function fetchNissan() {
  // Confirmed via both plain fetch and a real patchright browser render:
  // Akamai returns "Access Denied" (errors.edgesuite.net) either way. Not a
  // wrong-URL issue — a genuine bot-protection block.
  return tryBlocked('nissan', 'https://www.nissanusa.com/dealer-locator.html', [
    'https://www.nissanusa.com/dealer-locator.html',
  ]);
}

async function fetchInfiniti() {
  // Correct locator path (the old dealer-locator.html guess 404s) — this one
  // loads fine (200) but is a Google-Places-autocomplete widget with no
  // discoverable JSON dealer API; a scripted zip submit didn't trigger one
  // either. Re-verified 2026-09-14 with a more thorough pass (full
  // pac-target-input place selection via ArrowDown+Enter, then clicking
  // every button whose class/text matched search/go/submit/find, including
  // walking up from the input to find its icon-only sibling button) —
  // still no dealer JSON surfaced. The page is a Next.js app
  // (/nna-nci-dealer-locator/_next/...) with no relative /api/ path or
  // external API host found in its JS bundles either (grepped all shipped
  // chunks). Genuinely stuck pending real form-automation work, not a
  // wrong-URL issue. Left detect-only.
  return tryBlocked('infiniti', 'https://www.infinitiusa.com/locate-infiniti-retailer.html', [
    'https://www.infinitiusa.com/locate-infiniti-retailer.html',
  ]);
}

// Found via real network capture (patchright, watching XHR/fetch on page
// load — the widget geolocates and fires an initial search on its own, no
// interaction needed to see the request shape): the ZIP autocomplete input
// (id="zipcode-*", a Google Places pac-target-input, not itself an API)
// drives a plain, unauthenticated JSON endpoint —
// /services/dealers/distances/by/zipcode?zipcode=<zip>&count=<n>&type=Active
// — confirmed via plain curl with the honest TrimScout-locator UA (200,
// real dealer JSON, no session/cookie required). (Do not confuse this with
// /services/dealers/services, which only returns the dealer-*type* filter
// list used by the UI's checkboxes, not actual dealers.)
async function fetchSubaru() {
  const zips = TARGET_ZIPS;
  const rows = [];
  const pages = [];
  for (const zip of zips) {
    const url = `https://www.subaru.com/services/dealers/distances/by/zipcode?zipcode=${zip}&count=50&type=Active`;
    const got = await fetchJson(url);
    pages.push({ zip, status: got.status, ok: got.ok });
    for (const entry of Array.isArray(got.json) ? got.json : []) {
      const d = entry.dealer;
      if (!d) continue;
      const addr = d.address || {};
      const state = String(addr.state || '').toUpperCase();
      if (!inTargetStates(state)) continue;
      rows.push(row({
        make: 'Subaru',
        name: d.name,
        city: addr.city,
        state,
        domain: d.siteUrl,
        lat: d.location?.latitude ?? null,
        lng: d.location?.longitude ?? null,
        sourceUrl: url,
      }));
    }
  }
  return writeDump('subaru', rows, {
    locator: 'https://www.subaru.com/find-a-retailer.html',
    note: 'Official Subaru dealer-distance JSON API (services/dealers/distances/by/zipcode), found via network capture; plain fetch, no browser needed.',
    pages,
    blocked: pages.length > 0 && pages.every((p) => !p.ok),
  });
}

async function fetchMazda() {
  // Official ajax handler behind the (correct) /find-a-dealer page, found via
  // network capture: a plain zip+radius GET, no browser needed, 200 with the
  // honest TrimScout-locator UA — not bot-protected, just undiscovered.
  const zips = TARGET_ZIPS;
  const rows = [];
  const pages = [];
  for (const zip of zips) {
    const url = `https://www.mazdausa.com/handlers/dealer.ajax?zip=${zip}&maxDistance=50&p=1&accolades=`;
    const got = await fetchJson(url, { referer: 'https://www.mazdausa.com/find-a-dealer' });
    pages.push({ zip, status: got.status, ok: got.ok });
    for (const d of got.json?.body?.results || []) {
      const state = String(d.state || '').toUpperCase();
      if (!inTargetStates(state)) continue;
      rows.push(row({
        make: 'Mazda',
        name: d.name,
        city: d.city,
        state,
        domain: d.webUrl,
        lat: typeof d.lat === 'number' ? d.lat : null,
        lng: typeof d.long === 'number' ? d.long : null,
        sourceUrl: url,
      }));
    }
  }
  return writeDump('mazda', rows, {
    locator: 'https://www.mazdausa.com/find-a-dealer',
    note: 'Official Mazda dealer.ajax handler (zip + maxDistance=50, plain GET).',
    pages,
    blocked: pages.every((p) => p.status === 403),
  });
}

async function fetchHyundai() {
  // Official dealersByZip.json handler behind the (correct)
  // /us/en/dealer-locator page — a plain zip+radius GET, no browser
  // needed. Recipe carried over from an earlier, separate Hyundai
  // dealer-DIRECTORY crawl in this repo (scrapers/dealer-rosters/hyundai/
  // crawl_locator.py, 858 rooftops) and re-verified live 2026-09-20 before
  // wiring in here. Default radius is only 25mi — must pass radius=150
  // explicitly for real nationwide coverage. dealerUrl comes back as a
  // bare hostname (no protocol), sometimes with a path suffix.
  const zips = TARGET_ZIPS;
  const rows = [];
  const pages = [];
  const seenCode = new Set();
  for (const zip of zips) {
    const url = `https://www.hyundaiusa.com/var/hyundai/services/dealer/dealersByZip.json?brand=hyundai&model=all&lang=en&zip=${zip}&maxdealers=200&radius=150`;
    const got = await fetchJson(url, { referer: 'https://www.hyundaiusa.com/us/en/dealer-locator' });
    pages.push({ zip, status: got.status, ok: got.ok });
    for (const d of got.json?.dealers || []) {
      const code = d.dealerCd;
      if (code) {
        if (seenCode.has(code)) continue;
        seenCode.add(code);
      }
      const state = String(d.state || '').toUpperCase();
      if (!inTargetStates(state)) continue;
      rows.push(row({
        make: 'Hyundai',
        name: d.dealerNm,
        city: d.city,
        state,
        domain: d.dealerUrl,
        lat: typeof d.latitude === 'number' ? d.latitude : null,
        lng: typeof d.longitude === 'number' ? d.longitude : null,
        sourceUrl: url,
      }));
    }
  }
  return writeDump('hyundai', rows, {
    locator: 'https://www.hyundaiusa.com/us/en/dealer-locator',
    note: 'Official Hyundai dealersByZip.json handler (zip + radius=150, plain GET).',
    pages,
    blocked: pages.every((p) => p.status === 403),
  });
}

async function fetchVolkswagen() {
  // Official bff-search/dealers feature-app API behind the (correct)
  // /en/dealer-search.html page, found via network capture. The
  // lufthansaApiKey/signature pair is the same public key the page itself
  // ships to every visitor's browser (visible in its own network tab) — not
  // a credential we're misusing. useMinimalEndpoint:false pulls the full
  // nationwide roster (954 dealers) with address + website in one call, so
  // NJ/NY is a client-side filter rather than per-zip queries.
  const serviceConfigEndpoint = JSON.stringify({
    endpoint: { type: 'publish', country: 'us', language: 'en', content: 'onehub_pkw', envName: 'prod', testScenarioId: null },
    signature: 'VehBWLTr2hxx8TJ85NJrpgRXoPfAyNcz2K8KuyXQTNI=',
  });
  const query = JSON.stringify({
    type: 'DEALER',
    language: 'en-US',
    countryCode: 'US',
    dealerServiceFilter: [],
    contentDealerServiceFilter: ['ACCES_CNFG', 'DCA'],
    usePrimaryTenant: true,
    name: '+',
    useMinimalEndpoint: false,
  });
  const url = `https://v3-92-0.ds-us.dcc.feature-app.io/bff-search/dealers?serviceConfigEndpoint=${encodeURIComponent(serviceConfigEndpoint)}&lufthansaApiKey=h0CQWvPYSBvp5KYXUpRU4FpZrnl0tZx1&query=${encodeURIComponent(query)}`;
  const got = await fetchJson(url, { referer: 'https://www.vw.com/en/dealer-search.html' });
  const rows = [];
  const nationwideCount = Array.isArray(got.json?.dealers) ? got.json.dealers.length : 0;
  for (const d of got.json?.dealers || []) {
    const addr = d.address || {};
    const state = String(addr.province || '').toUpperCase();
    if (!inTargetStates(state)) continue;
    // The feature-app API mixes VW-authorized collision/body shops into the
    // same "dealers" list — rawServices: ["COLLISION_CENTER"] with nothing
    // else is the clean, data-driven signal for those (every real sales
    // rooftop also carries other service/sales codes). Skip them; they are
    // not vehicle dealerships.
    const services = Array.isArray(d.rawServices) ? d.rawServices : [];
    if (services.length === 1 && services[0] === 'COLLISION_CENTER') continue;
    rows.push(row({
      make: 'Volkswagen',
      name: d.name,
      city: addr.city,
      state,
      domain: d.contact?.website,
      lat: Array.isArray(d.coordinates) ? d.coordinates[0] : null,
      lng: Array.isArray(d.coordinates) ? d.coordinates[1] : null,
      sourceUrl: url,
    }));
  }
  return writeDump('volkswagen', rows, {
    locator: 'https://www.vw.com/en/dealer-search.html',
    note: `Official VW bff-search/dealers feature-app API (nationwide, filtered client-side to ${TARGET_STATES.join('/')}).`,
    httpStatus: got.status,
    blocked: got.status === 403,
    nationwideCount,
  });
}

async function fetchAudi() {
  return tryBlocked('audi', 'https://www.audiusa.com/us/web/en/dealer-locator.html', [
    'https://www.audiusa.com/us/web/en/dealer-locator.html',
  ]);
}

async function fetchVolvo() {
  return tryBlocked('volvo', 'https://www.volvocars.com/us/dealers/', [
    'https://www.volvocars.com/us/dealers/',
    'https://www.volvocars.com/us/api/dealers',
  ]);
}

async function copyInRepo(brand, file, make) {
  const src = path.join(ROOT, file);
  let parsed = [];
  try {
    parsed = JSON.parse(await fs.readFile(src, 'utf-8'));
  } catch {
    parsed = [];
  }
  const rows = [];
  for (const raw of Array.isArray(parsed) ? parsed : []) {
    const state = String(raw.state || '').toUpperCase();
    if (!inTargetStates(state)) continue;
    rows.push(row({
      make: make || raw.make,
      name: raw.name,
      city: raw.city,
      state,
      domain: raw.domain,
      lat: raw.lat ?? null,
      lng: raw.lng ?? null,
      sourceUrl: file,
    }));
  }
  return writeDump(brand, rows, {
    locator: file,
    note: 'In-repo official locator dump (not re-fetched).',
    httpStatus: 200,
    blocked: false,
  });
}

const status = [];

await fs.mkdir(OUT_DIR, { recursive: true });

status.push(await copyInRepo('acura', 'acura-dealers.json', 'Acura'));
status.push(await copyInRepo('porsche', 'dealers.json', 'Porsche'));
status.push(await fetchLexus());
status.push(await fetchToyota());
status.push(await fetchMercedes());
status.push(await fetchMitsubishi());
status.push(await fetchHonda());
status.push(await fetchBmw());
status.push(await fetchMini());
status.push(await fetchKia());
status.push(await fetchNissan());
status.push(await fetchInfiniti());
status.push(await fetchSubaru());
status.push(await fetchMazda());
status.push(await fetchHyundai());
status.push(await fetchVolkswagen());
status.push(await fetchAudi());
status.push(await fetchVolvo());

await fs.writeFile(path.join(OUT_DIR, '_status.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  detectOnly: true,
  brands: status,
}, null, 2)}\n`);

for (const s of status) {
  console.log(`${s.brand}: ${s.count} ${TARGET_STATES.join('+')} rows  ${s.blocked ? 'BLOCKED' : 'ok'}  ${s.note}`);
}
