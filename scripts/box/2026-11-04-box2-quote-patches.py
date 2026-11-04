#!/usr/bin/env python3
"""Deals box (box2): quote audit stamping + audit read filter, dealer availability (#683), optional offer date, staged-deal true OTD on the
shared state trade tax credit. ONE small text patcher written against the LIVE box2 files (not the repo mirror, which has drifted: the box
carries trade-in / contact-reveal / vin-search / one-per-VIN code that main does not, and main carries the whole audit harness the box lacks).

  python3 -I 2026-11-04-box2-quote-patches.py --dir /opt/trimscout-deals/src --src <dir with the three repo files> [--dry-run]

What it changes (every anchor must match EXACTLY ONCE or it refuses and writes nothing):
  deals_api_server.js
    (a) rfq_quotes inserts stamp audit / audit_at from the request (rfq_requests.audit); quote reads skip soft-deleted quotes and never
        show an audit quote under a real request. The audit/deleted_at columns already exist on the live table; ADD COLUMN IF NOT EXISTS
        is added beside the other lazy columns so a rebuilt table gets them too.
    (b) #683: availability_json stored with the quote and handed back as quote.availability (null on older quotes).
    (c) optional offer date: no expiresAt check; a missing date is stored as NULL, never defaulted. A date that IS sent must be a real date.
  stateTradeCredit.js (new), dealStages.js, rfqStages.js
    (d) the staged deal's true OTD uses the same per-state trade tax credit as lib/trade/stateTradeCredit.ts and the same arithmetic as
        lib/trade/trueOtd.ts. The three files are installed from --src, and only over the exact file versions this was written against.
Not touched: trade-in, contact-reveal, vin-search, one-per-VIN, anything else.

SQL (run separately, once): 2026-11-03-rfq-quote-availability.sql (#683, additive) and 2026-11-04-rfq-quote-optional-offer-date.sql.
--dry-run writes nothing on the box: it builds the result in a temp dir, runs `node --check` on it and prints what would change.
Idempotent: a second run says "already patched". Rollback: restore the *.bak-<date> copies, restart.
"""
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

# The live files this was written against (box2, 2026-11-04). dealStages.js / rfqStages.js are byte-identical to the repo's at that date.
BEFORE_MD5 = {
    "deals_api_server.js": "79bc7ca587662d4f5120cd9c4330f209",
    "dealStages.js": "6a3a19443aa0e1d4ecb9a0a8a42169f0",
    "rfqStages.js": "548574bc4cd2fffdfa34bc54ec682ce5",
}
INSTALL = ["stateTradeCredit.js", "dealStages.js", "rfqStages.js"]
MARK = "2026-11-04 box2 quote patches"


def md5(text):
    return hashlib.md5(text.encode()).hexdigest()


def patch_server(s):
    changed = []

    def rep(old, new, label):
        nonlocal s
        n = s.count(old)
        assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:200]}"
        s = s.replace(old, new)
        changed.append(label)

    # (b) availability handed back on the quote
    rep('    used: typeof row.used_json === "string" ? JSON.parse(row.used_json) : row.used_json || null,\n    supersededAt',
        '    used: typeof row.used_json === "string" ? JSON.parse(row.used_json) : row.used_json || null,\n'
        '    // The dealer\'s "is this exact car in stock" answer (null on quotes sent before it existed).\n'
        '    availability: parseJsonCol(row.availability_json),\n    supersededAt',
        "publicRfqQuote")
    # (a)(b) lazy columns
    rep('  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS lease_json TEXT NULL");\n',
        '  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS lease_json TEXT NULL");\n'
        '  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS availability_json TEXT NULL");\n'
        '  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS audit TINYINT(1) NOT NULL DEFAULT 0");\n'
        '  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS audit_at DATETIME NULL");\n'
        '  await pool.query("ALTER TABLE rfq_quotes ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL");\n',
        "columns")
    # (c) optional offer date: normalise at the top (a blank date is NO date)
    rep('  const expiresAt = body.expiresAt;\n',
        '  // The offer date is optional. Absent or blank means NO date (stored as NULL); nothing here ever writes a default one.\n'
        '  const expiresAt = body.expiresAt != null && String(body.expiresAt).trim() !== "" ? body.expiresAt : null;\n',
        "expiresAt")
    rep('quoteExpiresAt: body.expiresAt, now: new Date()', 'quoteExpiresAt: expiresAt, now: new Date()', "tradeAnswerExpiry")
    rep('  if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) missing.push("expiresAt");\n',
        '  if (expiresAt != null && Number.isNaN(new Date(expiresAt).getTime())) missing.push("expiresAt (a real date, or leave it out)");\n',
        "expiresAtCheck")
    # (b) body
    rep('  const usedJson = body.used && typeof body.used === "object" ? JSON.stringify(body.used) : null;\n',
        '  const usedJson = body.used && typeof body.used === "object" ? JSON.stringify(body.used) : null;\n'
        '  // Validated and time-stamped by the Next.js route (lib/quoteAvailability.ts); stored whole.\n'
        '  const availabilityJson = body.availability && typeof body.availability === "object" ? JSON.stringify(body.availability) : null;\n',
        "body")
    # (a)(b)(c) the insert
    rep('stock_number, expires_at, must_have_acknowledgement, notes, lease_json, used_json)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`',
        'stock_number, expires_at, must_have_acknowledgement, notes, lease_json, used_json, availability_json, audit, audit_at)\n'
        '       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`',
        "insert-columns")
    rep('stockNumber, new Date(expiresAt), mustHaveAcknowledgement, notes, leaseJson, usedJson]',
        'stockNumber, expiresAt ? new Date(expiresAt) : null, mustHaveAcknowledgement, notes, leaseJson, usedJson, availabilityJson, rfqRows[0].audit ? 1 : 0, rfqRows[0].audit ? new Date() : null]',
        "insert-values")
    # (a) quote reads: no soft-deleted quote, and an audit quote never shows under a real request
    rep('    `SELECT * FROM rfq_quotes WHERE invite_id IN (${placeholders})`,\n    inviteIds\n',
        '    `SELECT * FROM rfq_quotes WHERE invite_id IN (${placeholders}) AND deleted_at IS NULL AND (audit = 0 OR (SELECT audit FROM rfq_requests WHERE id = ?) = 1)`,\n    [...inviteIds, rfqId]\n',
        "quote-read-filter")
    s = s.replace("async function handleSubmitRfqQuote(", f"// {MARK}: audit stamp, availability, optional offer date.\nasync function handleSubmitRfqQuote(", 1)
    return s, changed


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    opts = {}
    for i, a in enumerate(args):
        if a in ("--dir", "--src") and i + 1 < len(args):
            opts[a] = args[i + 1]
    if "--dir" not in opts or "--src" not in opts:
        sys.exit(__doc__)
    live, src = opts["--dir"], opts["--src"]

    server_p = os.path.join(live, "deals_api_server.js")
    server = open(server_p).read()
    results = {}  # name -> new text
    if MARK in server:
        print("deals_api_server.js: already patched; nothing changed")
    else:
        assert md5(server) == BEFORE_MD5["deals_api_server.js"], f"deals_api_server.js is not the version this was written against ({md5(server)}); refusing"
        new, changed = patch_server(server)
        results["deals_api_server.js"] = new
        print("deals_api_server.js patched:", ", ".join(changed))
    for name in INSTALL:
        want = open(os.path.join(src, name)).read()
        p = os.path.join(live, name)
        have = open(p).read() if os.path.exists(p) else None
        if have == want:
            print(f"{name}: already installed")
            continue
        if have is not None:
            assert md5(have) == BEFORE_MD5.get(name), f"{name} on the box is not the version this was written against ({md5(have)}); refusing"
        results[name] = want
        print(f"{name}: {'would install' if dry else 'install'} ({'new file' if have is None else 'replaces the live version'})")

    # Build everything in a temp dir and syntax-check before touching the box. The temp dir keeps the module layout so imports resolve.
    tmp = tempfile.mkdtemp(prefix="box2patch-")
    try:
        open(os.path.join(tmp, "package.json"), "w").write('{"type":"module"}')
        for name in set(INSTALL) | {"deals_api_server.js"}:
            if name in results:
                open(os.path.join(tmp, name), "w").write(results[name])
        for name in results:
            subprocess.run(["node", "--check", os.path.join(tmp, name)], check=True)
        print("syntax ok:", ", ".join(sorted(results)) or "(nothing to check)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if dry:
        print("DRY RUN: nothing written")
        return
    for name, text in results.items():
        p = os.path.join(live, name)
        t = p + ".new"
        open(t, "w").write(text)
        if os.path.exists(p):
            shutil.copymode(p, t)
        os.replace(t, p)
    print("written:", ", ".join(sorted(results)) or "nothing")


if __name__ == "__main__":
    main()
