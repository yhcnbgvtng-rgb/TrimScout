#!/bin/bash
# READ-ONLY drift check + dry run for the box2 crawler catch-up (box4's exact src files copied onto box2). Run ON box2. It never writes inside the crawler checkout:
# it compares md5s with manifest.txt, builds a COPY of src/ + scripts/ in a temp dir with the staged files laid over it, syntax-checks every laid file,
# and checks statically (no module is executed) that every relative import in src/ and scripts/ still resolves to a file that exports the imported names.
#   usage: bash drift-check.sh [CRAWLER_DIR] [STAGE_DIR]    defaults: ~/nj-scraper/scrapers/lightsail-crawler   /tmp/b2sync
#   STAGE_DIR holds src/<the 14 files> and manifest.txt (copied from the Mac; see STEPS.md step 1)
C=${1:-$HOME/nj-scraper/scrapers/lightsail-crawler}; ST=${2:-/tmp/b2sync}; M=$ST/manifest.txt; FAIL=0
cd "$C" || exit 2; [ -f "$M" ] || { echo "no $M"; exit 2; }
echo "== host $(hostname) $(TZ=America/New_York date '+%F %H:%M %Z')  git $(git rev-parse --short HEAD 2>/dev/null)  node $(node -v)"
echo "== running crawl/sync processes (must be none):"; pgrep -fa "run-daily-crawl|run_nightly_chain|run_sync|standalone|inventory-sync" | grep -v -E "pgrep|drift-check" ; true
echo "== 1. box2's files still equal what the plan read (column 1; '-' = file must be absent)"
while read -r b2 b4 path kind; do
  case "$b2" in \#*|"") continue;; esac
  if [ "$b2" = "-" ]; then [ ! -e "$path" ] && echo "   ok   absent  $path" || { echo "   FAIL exists  $path"; FAIL=1; }
  else cur=$(md5sum "$path" 2>/dev/null | cut -d' ' -f1); [ "$cur" = "$b2" ] && echo "   ok   $cur  $path" || { echo "   FAIL $path is ${cur:-missing}, plan read $b2"; FAIL=1; }; fi
done < "$M"
echo "== 2. staged files equal box4's md5s (column 2)"
while read -r b2 b4 path kind; do
  case "$b2" in \#*|"") continue;; esac
  cur=$(md5sum "$ST/$path" 2>/dev/null | cut -d' ' -f1); [ "$cur" = "$b4" ] && echo "   ok   $cur  $path" || { echo "   FAIL staged $path is ${cur:-missing}, box4 md5 $b4"; FAIL=1; }
done < "$M"
[ "$FAIL" = 0 ] || { echo "DRIFT CHECK FAIL - stop; send this output back."; exit 1; }
echo "== 3. overlay copy + syntax"
T=$(mktemp -d); mkdir -p $T/src $T/scripts; cp -R src/. $T/src/ 2>/dev/null; cp -R scripts/. $T/scripts/ 2>/dev/null; cp package.json $T/; [ -d node_modules ] && ln -s "$C/node_modules" $T/node_modules
while read -r b2 b4 path kind; do case "$b2" in \#*|"") continue;; esac; cp "$ST/$path" "$T/$path"; done < "$M"
while read -r b2 b4 path kind; do case "$b2" in \#*|"") continue;; esac; cp "$T/$path" /tmp/b2-check.mjs; node --check /tmp/b2-check.mjs 2>&1 | head -3 || true; node --check /tmp/b2-check.mjs >/dev/null 2>&1 && echo "   ok   node --check $path" || { echo "   FAIL node --check $path"; FAIL=1; }; done < "$M"; rm -f /tmp/b2-check.mjs
cat > $T/imports.mjs <<'JSEOF'
import fs from "node:fs"; import path from "node:path";
const root = process.argv[2], bad = [], warn = []; const changed = new Set(process.argv.slice(3)); // files this catch-up changes: a missing package there is a FAIL, elsewhere only a WARN (it was already so)
const files = [...fs.readdirSync(root + "/src").filter((f) => /\.m?js$/.test(f)).map((f) => "src/" + f), ...fs.readdirSync(root + "/scripts").filter((f) => /\.m?js$/.test(f)).map((f) => "scripts/" + f)];
const exportsOf = (rel) => { const s = fs.readFileSync(path.join(root, rel), "utf8"), out = new Set();
  for (const m of s.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) out.add(m[1]);
  for (const m of s.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const p of m[1].split(",")) { const n = p.trim().split(/\s+as\s+/).pop().trim(); if (n) out.add(n); }
  if (/^export\s+default\b/m.test(s)) out.add("default"); if (/^export\s*\*/m.test(s)) out.add("*"); return out; };
const cache = new Map(); const ex = (rel) => cache.get(rel) || (cache.set(rel, exportsOf(rel)), cache.get(rel));
let n = 0;
for (const rel of files) {
  const s = fs.readFileSync(path.join(root, rel), "utf8");
  for (const m of s.matchAll(/^import\s+(?:([A-Za-z0-9_$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?(?:\*\s+as\s+([A-Za-z0-9_$]+)\s*)?from\s+['"]([^'"]+)['"]/gm)) {
    const [, def, names, , spec] = m; n++;
    if (spec.startsWith("node:")) continue;
    if (!spec.startsWith(".")) { const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]; if (!fs.existsSync(path.join(root, "node_modules", pkg)) && !/^(fs|path|os|vm|v8|zlib|http|https|crypto|url|util|child_process|readline|stream|events|net|dns|tls|assert|buffer|worker_threads|perf_hooks)$/.test(pkg)) (changed.has(rel) ? bad : warn).push(`${rel}: package "${pkg}" is not in node_modules`); continue; }
    const target = path.normalize(path.join(path.dirname(rel), spec));
    if (!fs.existsSync(path.join(root, target))) { bad.push(`${rel}: imports ${spec} -> ${target} which does not exist`); continue; }
    if (!/\.m?js$/.test(target)) continue;
    const have = ex(target); if (have.has("*")) continue;
    if (def && !have.has("default")) bad.push(`${rel}: default import from ${spec}, but ${target} has no default export`);
    for (const nm of (names || "").split(",").map((x) => x.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)) if (!have.has(nm)) bad.push(`${rel}: imports { ${nm} } from ${spec}, which ${target} does not export`);
  }
}
console.log(`   checked ${n} import statements in ${files.length} files`); for (const w of warn) console.log("   warn (file not changed by this catch-up) " + w); for (const b of bad) console.log("   FAIL " + b);
process.exit(bad.length ? 1 : 0);
JSEOF
echo "== 4. static import/export check on the overlay copy"; node $T/imports.mjs $T $(awk '!/^#/ && NF {print $3}' "$M") || FAIL=1
[ "$FAIL" = 0 ] || { echo "DRIFT CHECK FAIL"; exit 1; }
echo "== md5 of the files after (= box4's)"; (cd $T && md5sum $(awk '!/^#/ && NF {print $3}' "$M"))
echo "DRIFT CHECK PASS (nothing in $C was changed)"
