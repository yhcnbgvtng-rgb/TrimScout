# Model option policies in the nightly sync and the options list

Code-only change. Nothing is deployed, restarted or rebuilt by merging it. The policy stays **off** until `OPTION_MODEL_POLICY_PATH` is set in deals-api's environment at a restart.

## What it does

With the policy loaded (bundled files: `toyota-rav4-2026`, `toyota-2026-2027`, `ford-2026`, `chevrolet-2026-2027`, `gmc-2026-2027`, `buick-2026-2027`, `cadillac-2026-2027`, `honda-2026-2027`, `kia-2026-2027`, `hyundai-2025-2027`, `audi-2026-2027`, `bmw-2026-2027`, `mercedes-2026-2027`, `subaru-2026-2027`, `nissan-2026-2027`, `mazda-2026-2027`):

1. **Nightly sync write path** (`handleInventoryBulk`): for a vehicle covered by a policy (make + model + year), only the policy's options are written to `dealer_inventory_options`. Re-synced cars can no longer bring the generic rows back. Every other vehicle takes the generic path, unchanged.
   - A payload with a **blank trim** is treated as "no information" (the upsert COALESCEs `trim`), so the stored rows are left alone rather than wiped by "no trusted trim -> no options".
   - A non-blank trim the policy does not trust is skipped the same way (2026-10-13 ruling), so the stored rows stay.
2. **`/api/inventory` per-vehicle `options`** (`inventoryRowFromDb`, which also serves by-listing-url, VIN history and the export): for a covered vehicle the list is the policy result for that car's `options_json`, as `{ code, name, price, kind }` (price and kind from the policy). It is the same engine and the same input as the facet rows, so list, filters and facets agree. A car with no policy gets the very same array back.
3. `options_json` itself is **not** rewritten. The list is filtered on the way out.

Example (tests): 2026 RAV4 XSE `JTM6CRAV3TD314853` has 11 dealer lines; only the Weather Package remains, in the facet table and in the API list.

## Why a patch script, not a file copy

The box's `deals_api_server.js` is a different version from the repo's (about 350 lines differ), and its `factoryOptionAllowlist.js` is the old file with no model policies at all. `inventoryOptionRows.js` is identical. So `scripts/box/2026-10-11-option-policy-write-path.sh` installs the new allowlist module and the three policy JSONs and applies three anchored edits to the box's `deals_api_server.js`. Each anchor must match exactly once or nothing is installed; the new module is load-tested against the box's own `inventoryOptionRows.js` first; the script never restarts anything. Tested against a copy of the box's files on 2026-10-10.

## Deploy steps (idle window; Paul's GO first)

Idle means: no crawl, no sync, sync lock free, and nothing long-running on the table (the restart re-runs `ensureInventoryTable`'s ALTERs, which queue behind long SELECTs). Do not do this between 22:00 and the end of the nightly syncs (boxes sync 22:05 to 22:10).

1. **Check idle** (box2):
   ```bash
   sudo mysql -e "SELECT id,time,state,LEFT(info,90) FROM information_schema.processlist WHERE command<>'Sleep'"
   grep '\[sync-lock\]' ~/.pm2/logs/deals-api-out.log | tail -2        # last event must be a release
   ```
   Check all four boxes have no crawl/sync running (`ps`, load) twice, two minutes apart.
2. **Record "before" for a non-policy make** (to prove it is unchanged): pick a Honda VIN, save `curl -s -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY" "localhost:3004/api/inventory?q=<VIN>&dealerId=<id>&limit=1"` to a file.
3. **Safety copies**: `cp -p /opt/trimscout-deals/facet-cache.json ~/facet-cache.json.pre-optpolicy` (never delete the live one).
4. **Install** (no restart):
   ```bash
   cd ~ && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main && curl -fsSL -o 2026-10-11-option-policy-write-path.sh "$B/scripts/box/2026-10-11-option-policy-write-path.sh?cb=$(date +%s)" && bash 2026-10-11-option-policy-write-path.sh
   ```
   It prints its rollback line. Behaviour is unchanged until step 5.
5. **One restart with the policy on** (pm2 process `deals-api`; it currently runs with `DISABLE_FACET_REBUILD=1`, keep it):
   ```bash
   P=/opt/trimscout-deals/src/optionPolicies
   DISABLE_FACET_REBUILD=1 OPTION_MODEL_POLICY_PATH=$P/toyota-rav4-2026.json,$P/toyota-2026-2027.json,$P/ford-2026.json,$P/chevrolet-2026-2027.json,$P/gmc-2026-2027.json,$P/buick-2026-2027.json,$P/cadillac-2026-2027.json,$P/honda-2026-2027.json,$P/kia-2026-2027.json,$P/hyundai-2025-2027.json,$P/audi-2026-2027.json,$P/bmw-2026-2027.json,$P/mercedes-2026-2027.json,$P/subaru-2026-2027.json,$P/nissan-2026-2027.json,$P/mazda-2026-2027.json pm2 restart deals-api --update-env && pm2 save
   pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name==="deals-api").pm2_env;console.log(p.DISABLE_FACET_REBUILD,p.OPTION_MODEL_POLICY_PATH)})'
   ```
   Wait for boot; `pm2 logs deals-api --lines 30 --nostream` must NOT contain `[options] allowlist not loaded`.
6. **Verify**:
   - `JTM6CRAV3TD314853` (dealer 1614): `curl ... "localhost:3004/api/inventory?q=JTM6CRAV3TD314853&dealerId=1614&limit=1"` -> `options` is only the Weather Package.
   - `optionKeys=weather%20package` returns it; `optionKeys=illuminated%20door%20sills` returns total 0.
   - The Honda response from step 2 is byte-identical (except fields that change nightly, e.g. `lastSeenAt`).
7. **Re-converge Toyota and Ford rows.** The 2026-10-10 Toyota apply wrote policy rows once; any Toyota that re-synced at 22:05 or later before this deploy had its generic rows written back. Ford rows have never been applied. Cars converge by themselves the next time they are re-synced (the diff-write only touches changed sets). To converge everything now, run `scripts/box/2026-10-10-toyota-option-policy-apply.mjs` (`--phase=plan`, check the summary, `--phase=apply`; 83 s for Toyota on 2026-10-10; it takes the sync lock) and the per-make scripts `scripts/box/2026-10-11-{ford,chevrolet,gmc,buick,cadillac,honda,kia}-option-policy-apply.mjs` (same phases; each is limited to its own make). Ford is a decision for Paul: its dry run (docs/ford-2026) was 150,584 cars.
8. **One facet rebuild**, after step 7, when the lock is free: `POST /api/inventory/catalog-facets/rebuild`, then watch `GET /api/inventory/catalog-facets/status` (last full build took about 16 minutes). Warm the catalog cache per make afterwards as on 2026-10-09 (`~/oct9/warm.sh`).

## Rollback

- **Policy off, code stays**: restart without the variable: `DISABLE_FACET_REBUILD=1 pm2 restart deals-api --update-env` after `unset OPTION_MODEL_POLICY_PATH` (confirm with the `pm2 jlist` line above), `pm2 save`. The list and the write path go back to generic behaviour; the table keeps whatever rows it has until cars re-sync.
- **Files back**: copy the two `.bak.<timestamp>` files over `factoryOptionAllowlist.js` and `deals_api_server.js`, then restart.
- **Rows back**: `--phase=restore` of the apply script puts the backed-up rows back for exactly the cars it applied (dry unless `--go`). The 2026-10-10 Toyota backup is `/home/ubuntu/toyota-option-apply-EsvcAP/state/backup.jsonl` (md5 2bb0af068fcc446966f686a7fcf9f8a8).

## Exact aliases and the apply scripts (Hyundai, BMW, Mercedes-Benz)

- `scripts/lib/optionPolicyAliases.mjs` holds the approved exact spellings (model spellings, trim aliases, `modelTrim` pairs, noise words) the builder bakes into the policy JSON. Same ruling as the Ford aliases: exact only, no fuzzy matching, no year-to-year mapping. A model-year with no policy (for example a 2026 Santa Fe against a 2027-only policy) stays uncovered.
- A `modelTrim` pair ("GLE 350|4MATIC" -> "GLE 350 4MATIC SUV") is for feeds that put trim words in the model. It is tried only after every other trim rule failed.
- The apply scripts' plan phase now SKIPS a covered car whose trim is blank or not trusted (counted as `skippedNoTrustedTrim`); it no longer plans to remove that car's stored rows. The nightly sync write path skips them too (2026-10-13 ruling): a policy-covered car whose trim is blank OR not trusted keeps its stored rows (`policyFacetRows` returns `{ skip: true }`, counted in `optionSetsKept`). Only a trusted trim is rewritten. Rule 6 ("no trusted trim -> no options") still decides what `/api/inventory` lists for such a car.

## Known limits

- Policy matching uses the stored make / model / year / trim. A model spelling the policy does not list (for example a trim-suffixed model name) is simply not covered and stays on the generic rules.
- Dealer add-ons (`dealerAddons` in the policy result) are not stored anywhere yet; there is no `dealer_addons` column.

## Global junk list at write time (every car, policy or not)

Code only. Nothing changes until the box patch is applied **and** deals-api is restarted; `OPTION_JUNK_RULES=off` at that restart keeps the list off.

### Why some rows skip the policy (findings, from the code)

`handleInventoryBulk` (`deals_api_server.js`, option section) calls `policyFacetRows(...)` and falls back to `optionRowsFromOptions(...)`. A car's options therefore miss the policy when:

1. **No policy covers its make + model + year** (`modelPoliciesFor` is empty): generic path, which before this change had only the 2026-09/10 legacy rules (fees, warranty, finance words, sentences, deny list). Roadside assistance, inspections, maintenance plans, subscriptions/trials and `$0` lines passed. The repo ships 16 policy files = 254 model-year policies, 965 trims, 15 makes (Audi 32, BMW 26, Mercedes 26, Toyota 24, Hyundai 19, Kia 19, Chevrolet 18, Nissan 18, Honda 14, Subaru 14, GMC 13, Mazda 12, Cadillac 10, Ford 5, Buick 4). Everything else (Jeep, Ram, VW, Lexus, ... and every other model-year) is uncovered.
2. **Blank trim in the payload** (policy-covered): `{ skip: true }`, stored rows are left as they are. A **new** car with a blank trim therefore gets no option rows at all (not wrong ones, none); a re-seen one keeps whatever it had, junk included.
3. **Trim the policy does not trust** (the 2026-10-13 ruling): same `{ skip: true }`. These are the "ambiguous trims": they stay unmapped. The dry-run/apply reports already list them (`topUntrustedTrims`, `skippedNoTrustedTrim`); this change does not touch the policy, the aliases or that list.
4. **Payload with no options** (`payloadHasOptions` false): the crawl extracted nothing that night; stored rows are kept (by design, matches `options_json`'s COALESCE). Re-seen cars in that state keep their old rows.
5. **Unchanged set**: `diffOptionSets` rewrites only changed sets, so a car whose generic rows already match is not rewritten until its rule output changes (which is what makes a rule change converge on the next sync).
6. **Policy not loaded**: with `OPTION_MODEL_POLICY_PATH` unset, no car is policy-covered (case 1 for everyone).

Box2 numbers: none taken for this change (no box access was used). The measured figures already on file are in the earlier sections (for example the Ford dry run of 150,584 cars, the Toyota apply of 2026-10-10, the Audi apply of 2026-10-15: 121 cars).

### What the list is

`src/optionJunkRules.json` (pure data; a pattern list plus one zero-price switch). `optionRowsFromOptions` applies it to every option line after the legacy rules, and `policyOptionRows` runs through the same function, so a policy car and a no-policy car get the same list. Categories: roadside, inspection, warranty, maintenance/service plan, subscription/trial, fee/charge, standard/no-charge, and an explicit `price: 0`.

- **Paid sticker lines stay.** A line is never dropped by this list when it is vouched for: for a policy car, an exact entry of that trim's policy (name, or order code); for any car, a make-allowlist hit. A feed line that says `$0` for a policy package does not remove the package.
- **`$0`** (ships **OFF**, `zeroPrice.enabled: false`, until measured on live data): an explicit zero only. A missing price is "unknown" and is kept. Lines coded `FEATURE` (description-derived, `price: 0` means "unknown, not free", `descriptionFeatures.js`) are exempt (`zeroPrice.exemptCodes`).
- Dropped lines are named `junk:<category>` in the `dropped` lists and counted in `optionJunkDropped`.
- The policy is unchanged. `/api/inventory` for a policy car uses the same function, so list and facets still agree; a no-policy car's list is still its stored array (`options_json` is never rewritten).
- Change what is dropped by editing the JSON and restarting deals-api; `OPTION_JUNK_RULES_PATH=<file>` points at another file; `OPTION_JUNK_RULES=off` turns it off. A file that is missing or invalid logs `[options] junk rules not loaded` and boots with the list off; a pattern that does not compile is skipped and logged.

### Deploy (Paul's GO, idle window; nothing here was run)

1. Same idle checks as the section above (no crawl, no sync, lock free; not 22:00 to the end of the syncs).
2. Dry run, then apply (no restart):
   ```bash
   cd ~ && B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main && curl -fsSL -o 2026-10-16-option-junk-write-path.mjs "$B/scripts/box/2026-10-16-option-junk-write-path.mjs?cb=$(date +%s)" && node 2026-10-16-option-junk-write-path.mjs
   node 2026-10-16-option-junk-write-path.mjs --apply
   ```
   Every anchor must match exactly once or nothing is written. It prints each backup and the rollback line.
3. One restart (keep `DISABLE_FACET_REBUILD=1` and the current `OPTION_MODEL_POLICY_PATH`); boot log must show `[options] junk rules 2026-10-16: 7 rules, zero-price off` and no `junk rules not loaded`.
4. Cars converge the next time they are re-synced; the existing per-make apply scripts re-run the same engine for a faster sweep.

### Rollback

- No file change: restart with `OPTION_JUNK_RULES=off` (check with the `pm2 jlist` line above). Behaviour is exactly the pre-patch behaviour.
- Files back: `cp -p` the three `.bak.<timestamp>` files over `inventoryOptionRows.js`, `factoryOptionAllowlist.js`, `deals_api_server.js`, remove `optionJunkRules.json` (or restore its `.bak`), restart.
- Rows already written stay as written; nothing in the patch deletes data.

### Exemptions, rewrites and the Hyundai policy (follow-up to #544, code only)

- `optionJunkRules.json` gained `exemptions` (labels the list never drops: `Roadside Assistance Kit`, `scheduled maintenance indicators`) and `rewrites` (a SiriusXM trial / introductory / subscription line becomes the plain option **SiriusXM**, before any drop rule looks at it; paid extras such as "Extended Service Subscription" and "Traffic and Travel Link Subscription" are not rewritten). Both are data: edit the file and restart. With the list off, nothing is rewritten and nothing is exempt (the old legacy rules apply as before; note the legacy deny rule `trial subscription` already drops most SiriusXM trial lines today).
- The box patch (`scripts/box/2026-10-16-option-junk-write-path.mjs`) now also checks, in its dry run, whether `optionPolicies/hyundai-2025-2027.json` is installed and whether it is in the live `OPTION_MODEL_POLICY_PATH` (read-only `pm2 jlist`, or `--policy-env=<value>`). `--apply` installs it (backing up a different one), writes the new full path to `optionPolicies/OPTION_MODEL_POLICY_PATH.next`, and prints the restart line; the path takes effect only at the restart, which the script never runs.

### Midday idle-window deploy: the three new rules and the Hyundai policy, one restart (box2; Paul's typed GO first; nothing here was run)

State read-only on box2 at 21:52 EDT on 2026-10-15: the box patch was applied at 21:01 and deals-api restarted once at 21:01:54, so the **7-rule list is already live** (boot log `junk rules 2026-10-16: 7 rules, zero-price off`). Live `OPTION_MODEL_POLICY_PATH` has 15 entries and no Hyundai. `optionPolicies/hyundai-2025-2027.json` is installed (md5 `af196f491415944fa4d67df863a0590b`, same as the repo) and `optionPolicies/OPTION_MODEL_POLICY_PATH.next` holds the 16-entry path (the 15 plus Hyundai last). The box's `optionJunkRules.json` is md5 `6eb573fc079a4b8d7cea57201e99ff2c`. #548 is merged (ac81a35); the new file in `main` is md5 `200fdf0a7ec7d603a6c08eb42a03fff9`, version `2026-10-16.2`, 10 rules. The box patch is NOT re-run: the engine and anchors are already on the box; only the data file and the env change.

This deploy changes two things at one restart: the rules file (7 -> 10 rules) and the policy path (+ Hyundai). Nothing is applied to stored rows; cars pick both up the next time they are written or re-synced.

1. **Idle check** (same as the first section of this doc, twice, two minutes apart; not from 22:00 to the end of the syncs):
   ```bash
   sudo mysql -e "SELECT id,time,state,LEFT(info,90) FROM information_schema.processlist WHERE command<>'Sleep'"
   grep '\[sync-lock\]' ~/.pm2/logs/deals-api-out*.log | tail -2        # last event must be a release
   ```
2. **Backup first** (records the live rules file, the pm2 dump and the live policy path as they are now):
   ```bash
   BK=~/backups/junk-rules-$(date +%Y%m%d-%H%M) && mkdir -p $BK && echo "BK=$BK"
   cp -p /opt/trimscout-deals/src/optionJunkRules.json $BK/optionJunkRules.json
   cp -p ~/.pm2/dump.pm2 $BK/dump.pm2.pre
   pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).find(x=>x.name==="deals-api").pm2_env.OPTION_MODEL_POLICY_PATH||""))' > $BK/policy-path.pre
   (cd $BK && md5sum optionJunkRules.json dump.pm2.pre policy-path.pre | tee md5s.txt)
   tr ',' '\n' < $BK/policy-path.pre | wc -l        # must print 15
   ```
   `optionJunkRules.json` must show `6eb573fc079a4b8d7cea57201e99ff2c`. Keep the printed `BK=` line: the restore command needs it.
3. **Fetch the new file and check it before anything is live** (no restart, live file untouched):
   ```bash
   B=https://raw.githubusercontent.com/yhcnbgvtng-rgb/TrimScout/main
   curl -fsSL -o $BK/optionJunkRules.new.json "$B/scrapers/lightsail-crawler/src/optionJunkRules.json?cb=$(date +%s)"
   md5sum $BK/optionJunkRules.new.json              # must be 200fdf0a7ec7d603a6c08eb42a03fff9
   md5sum /opt/trimscout-deals/src/optionPolicies/hyundai-2025-2027.json    # must be af196f491415944fa4d67df863a0590b
   N=/opt/trimscout-deals/src/optionPolicies/OPTION_MODEL_POLICY_PATH.next
   tr ',' '\n' < $N | wc -l                         # must print 16
   for f in $(tr ',' ' ' < $N); do test -s "$f" || echo "MISSING $f"; done      # must print nothing
   node --input-type=module -e '
   import fs from "node:fs";
   const m = await import("/opt/trimscout-deals/src/inventoryOptionRows.js");
   const c = m.compileJunkRules(JSON.parse(fs.readFileSync(process.argv[1], "utf8")));
   const t = (l) => m.globalJunkRuleFor(l, {}, c);
   const ok = c.errors.length === 0 && c.rules.length === 10 && c.version === "2026-10-16.2"
     && t("Roadside Assistance") === "roadside" && t("Priced below KBB Fair Purchase Price!") === "dealer-ad-prose"
     && t("4D Sport Utility") === "vehicle-spec-not-option" && t("Paint Protection Film") === "dealer-protection-appearance"
     && t("Lariat Black Appearance Package") === null && t("Z71 Off-Road & Protection Package") === null && t("Anti-Theft Package") === null;
   console.log(ok ? "RULES OK" : "RULES BAD", c.errors, c.rules.length);
   process.exit(ok ? 0 : 1)' $BK/optionJunkRules.new.json
   ```
   Stop here unless it prints `RULES OK`.
4. **Install the file** (takes effect only at the restart):
   ```bash
   S=/opt/trimscout-deals/src
   cp $BK/optionJunkRules.new.json $S/optionJunkRules.json.tmp && chmod 664 $S/optionJunkRules.json.tmp && mv -f $S/optionJunkRules.json.tmp $S/optionJunkRules.json
   md5sum $S/optionJunkRules.json                   # 200fdf0a7ec7d603a6c08eb42a03fff9
   ```
5. **One restart**, with the `.next` path and `--update-env` (keep `DISABLE_FACET_REBUILD=1`):
   ```bash
   DISABLE_FACET_REBUILD=1 OPTION_MODEL_POLICY_PATH="$(cat $N)" pm2 restart deals-api --update-env && pm2 save
   pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name==="deals-api").pm2_env;const v=p.OPTION_MODEL_POLICY_PATH.split(",");console.log("DISABLE_FACET_REBUILD",p.DISABLE_FACET_REBUILD,"policy entries",v.length,"last",v[v.length-1].split("/").pop(),"JUNK_OFF",p.OPTION_JUNK_RULES)})'
   ```
   Expected: `DISABLE_FACET_REBUILD 1 policy entries 16 last hyundai-2025-2027.json JUNK_OFF undefined`.
6. **Verify** (after the process is up, about 30 seconds):
   ```bash
   pm2 logs deals-api --lines 80 --nostream | grep -E '\[options\]'
   ```
   Must show `[options] junk rules 2026-10-16.2: 10 rules, zero-price off`, and must NOT show `junk rules not loaded` or `allowlist not loaded`. Then the same API check as above: `curl -s -H "X-Trimscout-Api-Key: $TRIMSCOUT_API_KEY" "localhost:3004/api/inventory?limit=1"` returns 200 with a car, and the Honda response saved in step 2 of the first section is unchanged (except nightly fields). The restart clears the in-memory sync lock: nothing holds it now; any later apply script takes it fresh.
7. **Not part of this deploy**: no apply scripts, no facet rebuild, no re-sync. The FEATURE-row drop is not in the code.

**Restore** (the rules file and the policy path back to exactly what the backup holds; use the `BK=` directory printed in step 2):
```bash
BK=~/backups/junk-rules-YYYYMMDD-HHMM      # the directory step 2 printed
cp -p $BK/optionJunkRules.json /opt/trimscout-deals/src/optionJunkRules.json && md5sum /opt/trimscout-deals/src/optionJunkRules.json   # 6eb573fc079a4b8d7cea57201e99ff2c
DISABLE_FACET_REBUILD=1 OPTION_MODEL_POLICY_PATH="$(cat $BK/policy-path.pre)" pm2 restart deals-api --update-env && pm2 save
```
Then re-run the step 5 `pm2 jlist` line (expect 15 entries) and the step 6 log check (expect `junk rules 2026-10-16: 7 rules`). Rules-only rollback keeps Hyundai by restoring just the file and restarting with `OPTION_MODEL_POLICY_PATH="$(cat $N)"`. Rows already written stay as written.

## Re-clean of stored rows for all policy makes (code only; nothing here was run against live data except the read-only dry run)

`scripts/box/2026-10-16-option-reclean.mjs` (+ `scripts/lib/optionReclean.mjs`, tests in `scrapers/lightsail-crawler/test/option_reclean.test.js`) applies the current junk list (10 rules + rewrites) and the model policies to the rows `dealer_inventory_options` holds today, for the 15 policy makes (`--makes=` narrows it). Same flow and rails as the Audi apply: dealer-first 20-dealer batches per make, 20 s statement cap (one split retry, a second timeout stops), sync lock with heartbeat, backup before apply, per-batch checkpoint, **hard stop 21:40 ET**, restore phase.

- **Phases**: `dryrun` (reader account, writes nothing, no lock, counts and label text only) -> `plan` (writes backup.jsonl / plan.jsonl / batches.json / plan-summary.json into `--out`) -> `apply` (takes the lock; refuses an incomplete or `--stride` plan) -> `verify` (read-only: no applied car still dirty, no paid line lost) -> `restore` (dry unless `--go`; `--through-batch=N`, `--only=file.json`).
- **Skipped**: a car with a blank trim, and a policy-covered car whose trim the policy does not trust. A paid sticker line of the car's own trim (price, package price or per-drivetrain price > 0) is never removed; apply also skips any car whose plan would lose one.
- **Cars a policy covers** get the policy engine's rows for their `options_json` (what the nightly sync writes). **Cars no policy covers** only lose rows a `junk:*` rule drops, or get a rewrite (SiriusXM trial -> SiriusXM); nothing is added; legacy-rule-only drops are counted, not applied.
- **Running it** (the box has no checkout; the bundle carries the engine, the junk list and all 16 policies, nothing is written on the box by the dry run):
  ```bash
  node scripts/box/2026-10-16-option-reclean.mjs --emit > reclean.bundle.mjs
  ssh box2 'cd /opt/trimscout-deals && node --input-type=module - --phase=dryrun [--stride=4] [--makes=Audi,Kia]' < reclean.bundle.mjs
  ```
  `plan`/`apply`/`verify`/`restore` take `--out=DIR` (a directory on the box that survives: it holds the backup). Apply only in an idle window, on Paul's typed GO.
