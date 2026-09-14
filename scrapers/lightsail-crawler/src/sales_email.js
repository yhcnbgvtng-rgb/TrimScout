// Public-page sales inbox collector.
// Homepage / contact / staff / about / visible mailto: and schema.org only.
// No login, no WAF bypass, no third-party directories.

import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyFetchResult, isBotProtected } from './bot_protection.js';
import { dealerHomeUrl } from './nj_policy.js';

export const DEALER_CONTACTS_FILENAME = 'dealer_contacts.json';

export function dealerContactsPath(cwd = process.cwd()) {
  return path.resolve(cwd, 'data', DEALER_CONTACTS_FILENAME);
}

export async function loadDealerContacts(cwd = process.cwd()) {
  try {
    return JSON.parse(await fs.readFile(dealerContactsPath(cwd), 'utf-8'));
  } catch {
    return {};
  }
}

export async function saveDealerContacts(map, cwd = process.cwd()) {
  const dest = dealerContactsPath(cwd);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(map, null, 2));
  await fs.rename(tmp, dest);
}

export function applyContactToDealer(dealer, contact) {
  if (!dealer || !contact) return dealer;
  dealer.salesEmail = contact.salesEmail || null;
  dealer.secondaryEmail = contact.secondaryEmail || null;
  dealer.emailSourceUrl = contact.emailSourceUrl || null;
  dealer.collectedAt = contact.collectedAt || null;
  return dealer;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const GENERIC_RANK = [
  'sales',
  'info',
  'internet',
  'internet.sales',
  'internetsales',
  'internetmanager',
  'bdc',
  'webleads',
  'leads',
  'contact',
  'customerservice',
  'service',
];

const WEBMAIL = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'me.com',
]);

const THIRD_PARTY_HOSTS = [
  'cars.com', 'cargurus.com', 'autotrader.com', 'carfax.com', 'facebook.com',
  'instagram.com', 'twitter.com', 'x.com', 'yelp.com', 'yellowpages.com',
  'google.com', 'googletagmanager.com', 'wix.com', 'squarespace.com',
];

const PUBLIC_PATHS = [
  '/',
  '/contact',
  '/contact-us',
  '/contactus',
  '/about',
  '/about-us',
  '/aboutus',
  '/staff',
  '/meet-the-staff',
  '/meet-the-staff.htm',
  '/dealership/staff.htm',
  '/dealership/staff',
  '/our-staff',
];

const LABEL_RE = /internet sales|bdc|sales manager|internet manager|e-?commerce/i;

export function normalizeEmail(raw) {
  if (!raw) return null;
  const e = String(raw).trim().replace(/^mailto:/i, '').split('?')[0].toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return null;
  if (e.endsWith('.png') || e.endsWith('.jpg') || e.endsWith('.svg')) return null;
  if (e.startsWith('sentry@') || e.startsWith('noreply@') || e.startsWith('no-reply@')) return null;
  return e;
}

export function isGenericSalesLocal(local) {
  const l = String(local || '').toLowerCase();
  return GENERIC_RANK.includes(l);
}

function registrable(host) {
  return String(host || '')
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
    .slice(-2)
    .join('.');
}

export function emailBelongsToDealer(email, dealerHost) {
  const norm = normalizeEmail(email);
  if (!norm || !dealerHost) return false;
  const ed = norm.split('@')[1];
  if (WEBMAIL.has(ed) || THIRD_PARTY_HOSTS.some((h) => ed === h || ed.endsWith(`.${h}`))) return false;
  const dh = String(dealerHost).toLowerCase().replace(/^www\./, '');
  if (ed === dh) return true;
  if (ed.endsWith(`.${dh}`) || dh.endsWith(`.${ed}`)) return true;
  return registrable(ed) === registrable(dh) && !WEBMAIL.has(registrable(ed));
}

export function extractEmailsFromHtml(html, { dealerHost = null } = {}) {
  const text = String(html || '');
  const found = new Map(); // email -> { email, labeled }

  const consider = (raw, labeled) => {
    const email = normalizeEmail(raw);
    if (!email) return;
    if (dealerHost && !emailBelongsToDealer(email, dealerHost)) return;
    const prev = found.get(email);
    found.set(email, { email, labeled: Boolean(labeled || prev?.labeled) });
  };

  for (const m of text.matchAll(/mailto:([^"'>\s]+)/gi)) consider(decodeURIComponent(m[1]), false);

  for (const m of text.matchAll(/"email"\s*:\s*"([^"]+@[^"]+)"/gi)) consider(m[1], false);

  const labeledBlocks = [...text.matchAll(
    /(?:internet sales|bdc|sales manager|internet manager)[^<]{0,160}([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi
  )];
  for (const m of labeledBlocks) consider(m[1], true);

  for (const m of text.matchAll(EMAIL_RE)) consider(m[0], LABEL_RE.test(text.slice(Math.max(0, m.index - 80), m.index + 80)));

  return [...found.values()];
}

export function pickPreferredSalesEmails(candidates) {
  const list = [...(candidates || [])];
  const score = (c) => {
    const local = c.email.split('@')[0];
    const gi = GENERIC_RANK.indexOf(local);
    let s = 0;
    if (gi !== -1) s += 100 - gi;
    if (c.labeled) s += 20;
    if (/^[a-z]+\.[a-z]+$/.test(local)) s -= 15; // first.last
    return s;
  };
  list.sort((a, b) => score(b) - score(a) || a.email.localeCompare(b.email));
  const primary = list[0]?.email || null;
  const secondary = list.find((c) => c.email !== primary && (c.labeled || isGenericSalesLocal(c.email.split('@')[0])))?.email || null;
  return { salesEmail: primary, secondaryEmail: secondary };
}

export function dealerPublicUrls(dealer) {
  const home = dealerHomeUrl(dealer);
  if (!home) return [];
  const origin = home.replace(/\/+$/, '');
  return [...new Set(PUBLIC_PATHS.map((p) => (p === '/' ? `${origin}/` : `${origin}${p}`)))];
}

export async function collectSalesEmail(dealer, { getHtml, now = new Date() } = {}) {
  if (typeof getHtml !== 'function') {
    throw new Error('collectSalesEmail requires getHtml — pass a normal HTTP getter, never a challenge solver');
  }
  const host = dealer.domain;
  const candidates = [];
  let sourceUrl = null;

  for (const url of dealerPublicUrls(dealer)) {
    let html;
    let classification = 'NONE';
    try {
      const page = await getHtml(url);
      if (!page) continue;
      classification = page.classification || classifyFetchResult(page).classification;
      if (isBotProtected(classification)) continue;
      html = page.body || page.html || '';
    } catch {
      continue;
    }
    if (!html) continue;
    const found = extractEmailsFromHtml(html, { dealerHost: host });
    if (found.length === 0) continue;
    if (!sourceUrl) sourceUrl = url;
    for (const f of found) candidates.push(f);
    const picked = pickPreferredSalesEmails(candidates);
    if (picked.salesEmail && isGenericSalesLocal(picked.salesEmail.split('@')[0])) {
      return {
        salesEmail: picked.salesEmail,
        secondaryEmail: picked.secondaryEmail,
        emailSourceUrl: sourceUrl,
        collectedAt: now.toISOString(),
      };
    }
  }

  const picked = pickPreferredSalesEmails(candidates);
  if (!picked.salesEmail) {
    return { salesEmail: null, secondaryEmail: null, emailSourceUrl: null, collectedAt: now.toISOString() };
  }
  return {
    salesEmail: picked.salesEmail,
    secondaryEmail: picked.secondaryEmail,
    emailSourceUrl: sourceUrl,
    collectedAt: now.toISOString(),
  };
}
