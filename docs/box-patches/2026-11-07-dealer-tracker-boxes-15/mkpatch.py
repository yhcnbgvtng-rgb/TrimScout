#!/usr/bin/env python3
"""Add the dealer-tracker hooks to a standalone.js. Usage: mkpatch.py <in> <out>   (variant: box1 / box5 / repo main is detected from the text).
Every hook is an INSERTED line, except one: the swallow-all `} catch {}` closing extractOne becomes `} catch { dealerTrack.urlError(); }` (same behaviour).
Each anchor must occur exactly once or this script fails: a box file that drifted is refused, never guessed at."""
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()

def after(anchor, add, label):
    global s
    assert s.count(anchor) == 1, (label, s.count(anchor))
    s = s.replace(anchor, anchor + add)

def before(anchor, add, label):
    global s
    assert s.count(anchor) == 1, (label, s.count(anchor))
    s = s.replace(anchor, add + anchor)

def replace(old, new, label):
    global s
    assert s.count(old) == 1, (label, s.count(old))
    s = s.replace(old, new)

# H1 import
after("import { makeHeapGuard, detachStrings, formatHeapStopLine, heapReserveBytes } from './heapGuard.js';\n",
      "import { createDealerTracker } from './dealerTracker.js';\n", 'import')
# H2 tracker for this process (never throws: returns a no-op object on any failure)
before("for (let i = 0; i < work.length; i++) {\n",
       "// Per-dealer performance log (dealerTracker.js): observes only, never throws, never prints, off with CRAWLER_DEALER_TRACKER=off.\n"
       "const dealerTrack = createDealerTracker({ state, brand: brand.name, dealerTotal: work.length, runDate: todayDate });\n", 'create')
# H3 attempt begins
assert s.count("    heapStopped = false;\n") == 1, ('begin', s.count("    heapStopped = false;\n"))
s = s.replace("    heapStopped = false;\n", "    heapStopped = false;\n    dealerTrack.begin(dealer, { retry, index: i });\n")
# H4 probe skip (this path `continue`s before the try/finally)
after("        const kind = isBotProtected(botProbe.classification) ? 'bot protection' : 'uncrawlable';\n",
      "        dealerTrack.endProbeSkip(() => botProbe);\n", 'probe')
# H5 no URLs
after("            console.log(`${progress} ⚠️ No inventory URLs detected for ${dealer.name}. [${discovery.note}]`);\n",
      "            dealerTrack.noUrls(() => discovery);\n", 'nourls')
# H6 discovered
if "vehicle URLs. Extracting data...`);\n" in s and s.count("Found ${vehicleUrls.length} vehicle URLs. Extracting data...`);\n") == 1:
    after("        console.log(`${progress} Found ${vehicleUrls.length} vehicle URLs. Extracting data...`);\n", "        dealerTrack.discovered(vehicleUrls.length);\n", 'discovered')
else:
    after("        console.log(`${progress} Found ${urlPlan.kept} vehicle URLs. Extracting data...`);\n", "        dealerTrack.discovered(urlPlan.kept);\n", 'discovered-main')
# H7 per-URL start (inserted between the arrow line and its `try {`)
import re
m = re.findall(r"(        const extractOne = async \([^\n]*\) => \{\n)(            try \{\n)", s)
assert len(m) == 1, ('extractOne', len(m))
s = s.replace(m[0][0] + m[0][1], m[0][0] + "            dealerTrack.urlStart();\n" + m[0][1])
# H8 / H9 page outcomes
after("                if (isBotProtected(pageClass.classification)) {\n", "                    dealerTrack.pageBlocked(pageClass.classification);\n", 'blocked')
after("                if (skipReason) {\n", "                    dealerTrack.pageSkipped(skipReason);\n", 'skipped')
# H10 vehicle stored
after("                        dealerCount++;\n", "                        dealerTrack.vehicle();\n", 'vehicle')
# H11 the one replaced line: extractOne's swallow-all catch
replace("            } catch {}\n        };\n", "            } catch { dealerTrack.urlError(); }\n        };\n", 'urlerror')
# H12 dealer-level exception
after("        erroredDealersCount++;\n", "        dealerTrack.error(err);\n", 'error')
# H13 attempt ends (finally: every route out of the try, including the `continue`s inside it). The wall and browser-fallback lines are emitted only
# where the file has those variables (box5 has no politeness gate; box1 and the repo have no browser fallback), so no file mentions what it lacks.
extra = ""
if "let politeWall = null" in s:
    extra += "            wall: politeWall,\n"
if "let patchrightFallback = null" in s:
    extra += "            browserFallback: !!patchrightFallback,\n"
after("        clearTimeout(dealerTimeoutHandle);\n",
      "        dealerTrack.end(() => ({\n"
      "            timedOut: dealerTimedOut, heapStopped,\n"
      + extra +
      "            countedAsFailedStore: failedDealerNames.has(dealer.name),\n"
      "            heapSnapshot: () => heapGuard.snapshot(),\n"
      "        }));\n", 'end')
# H14 loop finished
after("console.log(`\\n\U0001F389 Nationwide Crawl Complete!`);\n", "dealerTrack.runEnd();\n", 'runend')
open(dst, 'w').write(s)
