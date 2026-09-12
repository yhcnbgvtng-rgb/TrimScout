#!/usr/bin/env bash
# Adds first-class website + domains to dealership_contacts on the box.
#
# Run on the box as ubuntu:
#   bash 2026-09-12-dealer-domains.sh
#
# In order:
#   1. timestamped backup of auth_api_server.js
#   2. exact-string patches (each asserts exactly one match; aborts otherwise):
#        - publicDealership returns website + domains
#        - create / update / bulk-upsert accept website + domains
#        - ensureDealerDomainColumns(): ALTER TABLE ... ADD COLUMN IF NOT EXISTS
#          website VARCHAR(500), domains_json TEXT; backfills website from the
#          crawl's "Website: https://..." note and domains_json with the
#          website's registrable host — run once at startup, idempotent
#   3. node --check
#   4. sudo pm2 restart trimscout-auth-api
#   5. curl the list endpoint and show one row's new fields
set -euo pipefail

FILE=/opt/trimscout-auth/src/auth_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f"expected exactly {count} match, found {n}:\n{old[:120]}"
    s = s.replace(old, new)

# 1. public shape
rep('''    contactEmail: row.contact_email,
    notes: row.notes,
    emailOptOut: Boolean(row.email_opt_out),''',
'''    contactEmail: row.contact_email,
    notes: row.notes,
    website: row.website || null,
    domains: parseDomains(row.domains_json),
    emailOptOut: Boolean(row.email_opt_out),''')

# helpers + column ensure, placed right before publicDealership
rep('''function publicDealership(row) {''',
'''// --- website + domains (2026-09-12) -------------------------------------
// domains: registrable hosts that identify the store — lowercase, no
// "www." — the website's own host plus aliases (vanity domains, the host a
// redirect lands on). What a pasted vehicle-page link is matched against.
function normalizeHost(value) {
  let raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  try {
    if (!/^[a-z][a-z0-9+.-]*:\\/\\//.test(raw)) raw = "https://" + raw;
    const host = new URL(raw).hostname.replace(/\\.$/, "").replace(/^www\\./, "");
    if (!host.includes(".")) return null;
    const labels = host.split(".");
    if (labels.length <= 2) return host;
    const two = labels.slice(-2).join(".");
    const twoLabel = new Set(["co.uk", "com.au", "co.nz", "com.mx", "co.za", "com.br", "co.jp"]);
    return twoLabel.has(two) ? labels.slice(-3).join(".") : two;
  } catch {
    return null;
  }
}
function parseDomains(json) {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? Array.from(new Set(arr.map(normalizeHost).filter(Boolean))) : [];
  } catch {
    return [];
  }
}
function domainsJsonFromBody(body) {
  const list = Array.isArray(body.domains) ? body.domains : typeof body.domains === "string" ? body.domains.split(/[;,\\s]+/) : [];
  const norm = Array.from(new Set(list.map(normalizeHost).filter(Boolean)));
  const site = normalizeHost(body.website);
  if (site && !norm.includes(site)) norm.unshift(site);
  return norm.length ? JSON.stringify(norm) : null;
}
function websiteFromNotes(notes) {
  const m = String(notes || "").match(/\\bWebsite:\\s*(https?:\\/\\/[^\\s|]+)/i);
  return m ? m[1] : null;
}
let dealerDomainColumnsEnsured = false;
async function ensureDealerDomainColumns(pool) {
  if (dealerDomainColumnsEnsured) return;
  await pool.query("ALTER TABLE dealership_contacts ADD COLUMN IF NOT EXISTS website VARCHAR(500) NULL");
  await pool.query("ALTER TABLE dealership_contacts ADD COLUMN IF NOT EXISTS domains_json TEXT NULL");
  // Backfill once: website from the crawl's note, domains from the website.
  const [rows] = await pool.query(
    "SELECT id, notes, website, domains_json FROM dealership_contacts WHERE (website IS NULL OR website = '') OR domains_json IS NULL"
  );
  let filled = 0;
  for (const r of rows) {
    const website = (r.website && String(r.website).trim()) || websiteFromNotes(r.notes);
    const existing = parseDomains(r.domains_json);
    const site = normalizeHost(website);
    const domains = Array.from(new Set([...(site ? [site] : []), ...existing]));
    if (!website && domains.length === 0) continue;
    await pool.query("UPDATE dealership_contacts SET website = ?, domains_json = ? WHERE id = ?", [
      website || null,
      domains.length ? JSON.stringify(domains) : null,
      r.id,
    ]);
    filled++;
  }
  dealerDomainColumnsEnsured = true;
  console.log(`dealer domains: columns ensured, backfilled ${filled} of ${rows.length} rows`);
}

function publicDealership(row) {''')

# 2. bulk upsert
rep('''      row.contactEmail || null,
      row.notes || null,
    ];
    const [existing] = await pool.query(
      "SELECT id FROM dealership_contacts WHERE LOWER(dealer_name) = LOWER(?) LIMIT 1",
      [dealerName]
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE dealership_contacts SET
           dealer_name = ?, address = ?, city = ?, state = ?, zip_code = ?,
           phone = ?, contact_name = ?, contact_email = ?, notes = ?
         WHERE id = ?`,
        [dealerName, ...fields, existing[0].id]
      );
      updated++;
    } else {
      await pool.query(
        `INSERT INTO dealership_contacts (dealer_name, address, city, state, zip_code, phone, contact_name, contact_email, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [dealerName, ...fields]
      );
      created++;
    }''',
'''      row.contactEmail || null,
      row.notes || null,
      (row.website || "").trim() || websiteFromNotes(row.notes) || null,
      domainsJsonFromBody({ ...row, website: (row.website || "").trim() || websiteFromNotes(row.notes) }),
    ];
    const [existing] = await pool.query(
      "SELECT id FROM dealership_contacts WHERE LOWER(dealer_name) = LOWER(?) LIMIT 1",
      [dealerName]
    );
    if (existing.length > 0) {
      // A re-import never shrinks domains: aliases learned since are kept.
      const [cur] = await pool.query("SELECT domains_json FROM dealership_contacts WHERE id = ?", [existing[0].id]);
      const merged = Array.from(new Set([...parseDomains(fields[9]), ...parseDomains(cur[0] && cur[0].domains_json)]));
      fields[9] = merged.length ? JSON.stringify(merged) : null;
      await pool.query(
        `UPDATE dealership_contacts SET
           dealer_name = ?, address = ?, city = ?, state = ?, zip_code = ?,
           phone = ?, contact_name = ?, contact_email = ?, notes = ?, website = ?, domains_json = ?
         WHERE id = ?`,
        [dealerName, ...fields, existing[0].id]
      );
      updated++;
    } else {
      await pool.query(
        `INSERT INTO dealership_contacts (dealer_name, address, city, state, zip_code, phone, contact_name, contact_email, notes, website, domains_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [dealerName, ...fields]
      );
      created++;
    }''')

# 3. create
rep('''  const [result] = await pool.query(
    `INSERT INTO dealership_contacts (dealer_name, address, city, state, zip_code, phone, contact_name, contact_email, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dealerName,
      body.address || null,
      body.city || null,
      body.state || null,
      body.zipCode || null,
      body.phone || null,
      body.contactName || null,
      body.contactEmail || null,
      body.notes || null,
    ]
  );''',
'''  const [result] = await pool.query(
    `INSERT INTO dealership_contacts (dealer_name, address, city, state, zip_code, phone, contact_name, contact_email, notes, website, domains_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dealerName,
      body.address || null,
      body.city || null,
      body.state || null,
      body.zipCode || null,
      body.phone || null,
      body.contactName || null,
      body.contactEmail || null,
      body.notes || null,
      (body.website || "").trim() || null,
      domainsJsonFromBody(body),
    ]
  );''')

# 4. update
rep('''  await pool.query(
    `UPDATE dealership_contacts SET
       dealer_name = ?, address = ?, city = ?, state = ?, zip_code = ?,
       phone = ?, contact_name = ?, contact_email = ?, notes = ?
     WHERE id = ?`,
    [
      (body.dealerName || "").trim(),
      body.address || null,
      body.city || null,
      body.state || null,
      body.zipCode || null,
      body.phone || null,
      body.contactName || null,
      body.contactEmail || null,
      body.notes || null,
      id,
    ]
  );''',
'''  await pool.query(
    `UPDATE dealership_contacts SET
       dealer_name = ?, address = ?, city = ?, state = ?, zip_code = ?,
       phone = ?, contact_name = ?, contact_email = ?, notes = ?, website = ?, domains_json = ?
     WHERE id = ?`,
    [
      (body.dealerName || "").trim(),
      body.address || null,
      body.city || null,
      body.state || null,
      body.zipCode || null,
      body.phone || null,
      body.contactName || null,
      body.contactEmail || null,
      body.notes || null,
      (body.website || "").trim() || null,
      domainsJsonFromBody(body),
      id,
    ]
  );''')

# 5. ensure columns before the list query
rep('''  const [rows] = await pool.query("SELECT * FROM dealership_contacts ORDER BY dealer_name ASC");''',
'''  await ensureDealerDomainColumns(pool);
  const [rows] = await pool.query("SELECT * FROM dealership_contacts ORDER BY dealer_name ASC");''')

open(p, "w").write(s)
print("patched:", p)
PY

node --check "$FILE" && echo "syntax ok"
sudo pm2 restart trimscout-auth-api
sleep 2
echo "--- one row's new fields ---"
K=$(sudo grep -h '^TRIMSCOUT_API_KEY=' /opt/trimscout-auth/.env.trimscout-db /opt/trimscout-auth/src/.env.trimscout-db 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
curl -s -H "X-Trimscout-Api-Key: $K" http://127.0.0.1:3003/api/dealerships | python3 -c "
import json,sys; rows=json.load(sys.stdin)['dealerships']
withsite=sum(1 for r in rows if r.get('website')); withdom=sum(1 for r in rows if r.get('domains'))
print(f'rows {len(rows)} | website {withsite} | domains {withdom}')
fr=[r for r in rows if 'Freedom Ford' in r['dealerName'] and r.get('state')=='NJ']
print(fr[0] if fr else 'no Freedom Ford NJ row')"
sudo pm2 logs trimscout-auth-api --lines 6 --nostream | tail -6
