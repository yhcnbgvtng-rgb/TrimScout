#!/usr/bin/env bash
# Adds GET /api/inventory/catalog/global (handleGlobalCatalogOptions) — PR #336, the real
# dominant fix for today's AI search failures.
#
# Confirmed live 2026-09-27 via box2's own pm2 logs: /api/inventory/catalog was hitting
# MariaDB's max_statement_time (error 1969) continuously all day, every 15-90 minutes from
# 03:29 to 19:57, for both a Ford and a completely unrelated Porsche query — the same failure,
# the same endpoint, regardless of what anyone searched for. Root cause: app/api/search/parse/
# route.ts called catalogOptions() with NO make/model/trim to build Gemini's option/color
# context, forcing handleInventoryCatalogOptions's STRAIGHT_JOIN across the ENTIRE
# dealer_inventory (every brand, 1.5M+ vehicles) and dealer_inventory_options (9.5M+ rows) on
# every single AI search request. Since it never completed, it never cached either — every
# request paid this cost fresh, forever.
#
# This adds a new, join-free endpoint purpose-built for that Gemini-context use: Gemini only
# ever reads {key, label} off each option, never vehicleCount (the only reason the filter
# panel's existing /api/inventory/catalog needs the join to dealer_inventory at all), so this
# is a plain GROUP BY canonical_key against dealer_inventory_options directly — servable via
# idx_opt_canonical with no scan of dealer_inventory needed. Colors still read dealer_inventory
# (no per-option join exists for them), but a plain DISTINCT scan of one table is far cheaper
# than joining it against another 9.5M-row table.
#
# The existing /api/inventory/catalog (handleInventoryCatalogOptions, used by the buyer filter
# panel) is UNTOUCHED by this script — it still legitimately needs per-make scoping and real
# vehicle counts for its own different UI purpose. The app/api and lib/ side of this fix
# (pointing /api/search/parse at the new endpoint) deploys automatically via Vercel — only this
# box file needs the manual deploy.
#
# Run on the deals box (ubuntu@3.237.204.55 — box2):
#   cd ~ && curl -fsSL -o 2026-09-27-global-catalog-endpoint.sh "https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main/scripts/box/2026-09-27-global-catalog-endpoint.sh?cb=$(date +%s)" && sudo cp 2026-09-27-global-catalog-endpoint.sh /opt/trimscout-deals/src/ && cd /opt/trimscout-deals/src && sudo bash 2026-09-27-global-catalog-endpoint.sh
set -euo pipefail
FILE=/opt/trimscout-deals/src/deals_api_server.js
STAMP=$(date +%Y%m%d-%H%M%S)
sudo cp "$FILE" "$FILE.bak.$STAMP"
echo "backup: $FILE.bak.$STAMP"

sudo python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read(); changed = []
def rep(old, new, label):
    global s
    if new in s:
        return
    n = s.count(old)
    assert n == 1, f"{label}: expected exactly 1 match, found {n}:\n{old[:200]}"
    s = s.replace(old, new); changed.append(label)

rep('''      exteriorColors,
      interiorColors,
    };
  }));
}

const server = http.createServer((req, res) => {''', '''      exteriorColors,
      interiorColors,
    };
  }));
}

// GET /api/inventory/catalog/global — the buyer /search AI box's Gemini-context source (see
// /api/search/parse), NOT the filter panel (that stays on handleInventoryCatalogOptions above,
// scoped by make/model/trim with real per-make vehicle counts). Confirmed live 2026-09-27 via
// box logs (pm2 logs trimscout-deals-api): /api/inventory/catalog was hitting error 1969 (max
// statement_time exceeded) continuously all day, every ~15-90 minutes from 03:29 to 19:57 —
// because /api/search/parse calls catalogOptions() with NO make/model/trim to build Gemini's
// full context, which forced handleInventoryCatalogOptions's STRAIGHT_JOIN across the ENTIRE
// dealer_inventory (1.5M+ in-stock vehicles nationwide, every brand) and dealer_inventory_options
// (9.5M+ rows) on every single AI search request. Since it never completed successfully, it also
// never populated invCached's cache — every request paid this cost fresh, with zero relief. This
// broke AI search broadly (confirmed live for both a Ford and a completely unrelated Porsche
// query, same failure, same endpoint), not a make-specific edge case.
//
// Gemini only ever reads {key, label} off each option (see app/api/search/parse/route.ts) — it
// has no use for vehicleCount, which is the only reason the filter panel's version needs the
// join to dealer_inventory at all. Dropping the join and querying dealer_inventory_options
// directly turns this into a plain GROUP BY canonical_key, which idx_opt_canonical (canonical_key)
// serves as an index scan with no full-table read of dealer_inventory needed. Colors still read
// dealer_inventory (no per-option join exists there), but a plain DISTINCT scan of one table is
// far cheaper than joining it against another 9.5M-row table.
async function handleGlobalCatalogOptions(req, res) {
  const pool = getPool();
  await ensureInventoryTable(pool);
  sendJson(res, 200, await invCached("catalog-options:global", async () => {
    const [optionRows] = await withPoolTimeout(
      pool.query(
        `SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT canonical_key, MIN(label) AS label FROM dealer_inventory_options GROUP BY canonical_key ORDER BY canonical_key`
      ),
      POOL_WAIT_TIMEOUT_MS,
      "Timed out waiting for an available database connection or a slow query"
    );
    const [colorRows] = await withPoolTimeout(
      pool.query(
        `SET STATEMENT max_statement_time=${INV_LIST_STATEMENT_TIMEOUT_SECONDS} FOR SELECT DISTINCT exterior_color, interior_color FROM dealer_inventory WHERE removed_at IS NULL AND (exterior_color IS NOT NULL OR interior_color IS NOT NULL)`
      ),
      POOL_WAIT_TIMEOUT_MS,
      "Timed out waiting for an available database connection or a slow query"
    );
    const exteriorColors = [...new Set(colorRows.map((r) => r.exterior_color).filter(Boolean))].sort();
    const interiorColors = [...new Set(colorRows.map((r) => r.interior_color).filter(Boolean))].sort();
    return {
      options: optionRows.map((r) => ({ key: r.canonical_key, label: r.label })),
      exteriorColors,
      interiorColors,
    };
  }));
}

const server = http.createServer((req, res) => {''', "new handleGlobalCatalogOptions handler")

rep('''  if (req.method === "GET" && pathname === "/api/inventory/catalog") return run(handleInventoryCatalogOptions, url.searchParams);
if (req.method === "GET" && pathname === "/api/inventory/by-listing-url") return run(handleInventoryByListingUrl, url.searchParams);''', '''  if (req.method === "GET" && pathname === "/api/inventory/catalog") return run(handleInventoryCatalogOptions, url.searchParams);
  if (req.method === "GET" && pathname === "/api/inventory/catalog/global") return run(handleGlobalCatalogOptions);
if (req.method === "GET" && pathname === "/api/inventory/by-listing-url") return run(handleInventoryByListingUrl, url.searchParams);''', "new /api/inventory/catalog/global route registration")

open(p, "w").write(s)
print("patched:", ", ".join(changed) or "nothing (already applied)")
PY

node --check "$FILE" && echo "syntax ok: deals_api_server.js"

sudo pm2 restart trimscout-deals-api --update-env >/dev/null && sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3004/api/inventory)
echo "GET /api/inventory without key -> $code (401 = server up and guarding)"
echo "Verify live, e.g. (should return in well under a second, not 20s+):"
echo '  time curl -s -H "X-Trimscout-Api-Key: $LIGHTSAIL_API_KEY" "http://127.0.0.1:3004/api/inventory/catalog/global" -o /dev/null -w "%{http_code}\n"'
