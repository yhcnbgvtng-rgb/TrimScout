#!/usr/bin/env python3
"""Deals API: save the dealer's availability confirmation with a quote (rfq_quotes.availability_json) and hand it back on the quote.
Usage: rfq-quote-availability-patch.py /opt/trimscout-deals/src/deals_api_server.js   (writes in place; idempotent; refuses if an anchor is missing or ambiguous)
CODE ONLY in this PR: not run on any box. Install steps and rollback: docs/QUOTE_AVAILABILITY.md.
The column itself is additive (scripts/box/2026-11-03-rfq-quote-availability.sql); this patch also adds it lazily, like the other rfq_quotes columns.
"""
import sys

p = sys.argv[1]
s = open(p).read()
if "availability_json" in s:
    print("already patched; nothing changed")
    sys.exit(0)
changed = []

def rep(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:160]}"
    s = s.replace(old, new)
    changed.append(label)

rep('    used: typeof row.used_json === "string" ? JSON.parse(row.used_json) : row.used_json || null,\n    supersededAt',
    '    used: typeof row.used_json === "string" ? JSON.parse(row.used_json) : row.used_json || null,\n    // The dealer\'s "is this exact car in stock" answer (null on quotes sent before it existed).\n    availability: parseJsonCol(row.availability_json),\n    supersededAt',
    "publicRfqQuote")
rep('  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS lease_json TEXT NULL");\n',
    '  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS lease_json TEXT NULL");\n  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS availability_json TEXT NULL");\n',
    "column")
rep('  const usedJson = body.used && typeof body.used === "object" ? JSON.stringify(body.used) : null;\n',
    '  const usedJson = body.used && typeof body.used === "object" ? JSON.stringify(body.used) : null;\n  // Validated and time-stamped by the Next.js route (lib/quoteAvailability.ts); stored whole.\n  const availabilityJson = body.availability && typeof body.availability === "object" ? JSON.stringify(body.availability) : null;\n',
    "body")
rep('lease_json, used_json, audit, audit_at)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`',
    'lease_json, used_json, availability_json, audit, audit_at)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`',
    "insert-columns")
rep('notes, leaseJson, usedJson, rfqRows[0].audit ? 1 : 0', 'notes, leaseJson, usedJson, availabilityJson, rfqRows[0].audit ? 1 : 0', "insert-values")
open(p, "w").write(s)
print("patched:", ", ".join(changed))
