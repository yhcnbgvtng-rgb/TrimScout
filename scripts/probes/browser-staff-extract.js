// Run in the dealer site's own tab (after the Cloudflare challenge has cleared).
// Finds the staff/team page via nav links (falls back to common paths), fetches it
// same-origin, and returns compact candidate cards {name,title,email} plus the
// page's email pool. Same card heuristic as v2_extract_candidates.py.
(async () => {
  const TITLE = /\b(general manager|general sales manager|sales manager|sales director|dealer principal|managing partner|owner|president|vice president|executive manager|sales consultant|sales rep|salesperson|sales specialist|sales associate|sales professional|client advisor|product specialist|product concierge|brand ambassador|internet sales|new car manager|pre-owned (sales )?manager|used car (sales )?manager|internet (sales )?manager|fleet manager|brand manager|leasing consultant|gsm|gm)\b/i;
  const EXCL = /\b(parts|service|collision|body shop|finance|f&i|bdc|marketing|human resources|accounting|controller|office manager|receptionist|title clerk|warranty|detail|porter|technician|shop foreman|cashier|talk to|ask|contact|email|call|text|to the)\b/i;
  const NOTNAME = /\b(sales|service|parts|manager|director|general|department|team|staff|our|meet|contact|email|phone|call|text|click|view|more|read|bio|about|foundation|customer|care|center|collision|welcome|mercedes|benz|sprinter|certified|pre-owned|new|used|finance|leasing|internet|client|product|specialist|consultant|advisor|hours|location|map|directions|schedule|inventory|specials|video|photo|profile|close|open|menu|home|search|login|share|print|ext|cell|fax|direct|office|main|ltd|llc|inc|group|motors|auto|dealer|dealership|the|and|of|for|with|your|my)\b/i;
  const NAME = /^[A-Z][a-zA-Z'’.\-]+(?:\s+[A-Z][a-zA-Z'’.\-]+){1,3}\.?$/;
  const EMAIL = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  const looksName = s => { s = s.trim().replace(/,$/, ''); return s.length <= 40 && NAME.test(s) && !NOTNAME.test(s); };
  const lines = el => { const out = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const t = n.textContent.replace(/\s+/g, ' ').trim(); if (t && t.length <= 90) out.push(t); } return out; };
  const cfDecode = h => { try { const r = parseInt(h.slice(0, 2), 16); let s = ''; for (let i = 2; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16) ^ r); return s; } catch (e) { return null; } };
  const emailsIn = (node, html) => {
    const set = new Set();
    node.querySelectorAll('a[href^="mailto:"]').forEach(a => { const e = a.getAttribute('href').slice(7).split('?')[0].trim().toLowerCase(); if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) set.add(e); });
    node.querySelectorAll('[data-cfemail]').forEach(el => { const d = cfDecode(el.getAttribute('data-cfemail')); if (d && d.includes('@')) set.add(d.toLowerCase()); });
    node.querySelectorAll('a[href*="email-protection#"]').forEach(a => { const m = a.getAttribute('href').match(/#([a-f0-9]+)/); if (m) { const d = cfDecode(m[1]); if (d && d.includes('@')) set.add(d.toLowerCase()); } });
    (node.textContent.match(EMAIL) || []).forEach(e => set.add(e.toLowerCase()));
    if (html) (html.match(EMAIL) || []).forEach(e => { e = e.toLowerCase(); if (!/\.(png|jpg|gif|svg|webp|js|css)$/.test(e) && !/sentry|example|wixpress|schema/.test(e)) set.add(e); });
    return [...set].filter(e => !/(noreply|no-reply|donotreply|privacy|support@|info@|sales@|service@|parts@|webmaster|admin@|contact@|careers|jobs@|hr@|leads@|internet@|marketing@|accounting)/.test(e));
  };
  const parts = name => { const t = name.toLowerCase().split(/\s+/).map(x => x.replace(/[^a-z]/g, '')).filter(Boolean); return t.length >= 2 ? [t[0], t[t.length - 1]] : null; };
  const matches = (email, name) => { const p = parts(name); if (!p) return false; const [f, l] = p; const loc = email.split('@')[0].toLowerCase().replace(/[^a-z]/g, ''); return (l.length >= 3 && loc.includes(l)) || (f.length >= 3 && loc.includes(f) && loc.includes(l[0])) || loc.startsWith(f[0] + l) || loc.startsWith(f + l[0]) || loc === f + l || loc === l + f || (f.length >= 4 && loc.startsWith(f.slice(0, 3)) && loc.includes(l.slice(0, 3))) || (loc === f && f.length >= 4); };
  const extract = (doc, html) => {
    const pool = emailsIn(doc.body || doc, html);
    const cands = []; const seen = new Set();
    const w = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) {
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (!t || t.length > 80 || !TITLE.test(t) || EXCL.test(t)) continue;
      if (/\b(parts|service|fixed ops|collision|finance)\b/i.test(t) && !/\bsales\b/i.test(t)) continue;
      let node = n.parentElement, card = null;
      for (let i = 0; i < 6 && node && !['BODY', 'HTML', 'MAIN'].includes(node.tagName); i++) { const ls = lines(node); if (ls.length >= 2 && ls.length <= 10 && ls.some(looksName)) { card = node; break; } node = node.parentElement; }
      if (!card) continue;
      const ls = lines(card); let ti = ls.indexOf(t); if (ti < 0) ti = 0; let name = null;
      for (let i = ti - 1; i >= 0; i--) if (looksName(ls[i])) { name = ls[i]; break; }
      if (!name) for (let i = ti + 1; i < ls.length; i++) if (looksName(ls[i])) { name = ls[i]; break; }
      if (!name) continue; name = name.replace(/[,.]$/, '');
      const key = (name + '|' + t).toLowerCase(); if (seen.has(key)) continue; seen.add(key);
      const ce = emailsIn(card); let em = ce.filter(e => matches(e, name)); if (!em.length) em = pool.filter(e => matches(e, name));
      cands.push({ name, title: t, email: em[0] || '' });
    }
    const rk = t => /general manager|\bgm\b/i.test(t) ? 1 : /general sales manager|\bgsm\b|sales director|director of sales/i.test(t) ? 2 : /manager/i.test(t) ? 3 : /owner|president|principal|partner|executive manager/i.test(t) ? 4 : 5;
    cands.sort((a, b) => rk(a.title) - rk(b.title) || (a.email ? -1 : 1) - (b.email ? -1 : 1));
    return { cands: cands.slice(0, 8), npool: pool.length, pool: pool.slice(0, 8) };
  };
  // 1. link discovery
  const origin = location.origin;
  const links = []; const seenL = new Set();
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.href, txt = a.textContent.trim(); const blob = href + ' ' + txt;
    if (!/(staff|our[-_ ]team|meet[-_ ](the|our)|our[-_ ]people|team[-_ ]members|employee|directory|leadership|management[-_ ]team)/i.test(blob)) return;
    if (/(service|parts|collision|body|career|jobs|employment|apply|review|testimonial|blog|news|community|facebook|instagram|twitter|linkedin|youtube|tiktok|mailto:|tel:)/i.test(blob)) return;
    try { const u = new URL(href); if (u.origin !== origin) return; const k = u.pathname.replace(/\/$/, '').toLowerCase(); if (!k || seenL.has(k)) return; seenL.add(k); links.push({ s: /staff|team/i.test(txt) ? 2 : 1, u: u.origin + u.pathname }); } catch (e) {}
  });
  links.sort((a, b) => b.s - a.s);
  const paths = ['/staff/', '/meet-our-staff/', '/about-us/staff/', '/about-us/meet-our-staff/', '/our-team/', '/meet-our-team/', '/about-us/meet-our-team/', '/dealership/staff.htm', '/staff.htm', '/staff.aspx', '/meet-the-team/', '/our-staff/', '/team/', '/about-us/our-team/', '/staff-directory/', '/dealership-staff.htm', '/meet-the-staff/'];
  const urls = [...links.map(l => l.u), ...paths.map(p => origin + p)];
  const tried = []; const seenP = new Set();
  for (const u of urls) {
    const k = new URL(u).pathname.replace(/\/$/, '').toLowerCase(); if (seenP.has(k)) continue; seenP.add(k);
    tried.push(k);
    try {
      const r = await fetch(u, { credentials: 'include' }); if (r.status !== 200) continue;
      const html = await r.text(); if (html.length < 500) continue;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script,style,noscript').forEach(x => x.remove());
      const text = doc.body ? doc.body.textContent.replace(/\s+/g, ' ') : '';
      if (!TITLE.test(text)) continue;
      const res = extract(doc, html);
      if (res.cands.length || res.pool.length) return JSON.stringify({ ok: true, url: r.url, tried: tried.length, ...res, title: (doc.title || '').slice(0, 80) });
    } catch (e) { }
  }
  return JSON.stringify({ ok: false, tried, title: document.title.slice(0, 80), href: location.href });
})()
