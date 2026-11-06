import sys
src,dst=sys.argv[1],sys.argv[2]
s=open(src).read()
def rep(old,new):
    global s
    assert s.count(old)==1,(old[:70],s.count(old))
    s=s.replace(old,new)
rep("    saveDomIndex,\n","")
rep("import { makeHeapGuard,","import { createDomDelta, checkpointDomDelta, mergeDomDelta } from './dom_index_delta.js';\nimport { makeHeapGuard,")
rep("let domIndex = await loadDomIndex();\n","""// The loaded index is READ-ONLY here (yesterday lookups). What this run writes goes into domDelta and is merged into the shared file at the end under a lock
// (dom_index_delta.js): concurrent brand processes used to save whole copies over each other and lose each other's entries.
let domIndex = await loadDomIndex();
const domDelta = createDomDelta({ label: `${process.env.CRAWLER_STATE || ''}/${process.env.CRAWLER_BRAND || ''}` });
""")
rep("""                                index: domIndex,
                            });
                        } catch {}""","""                                index: domIndex,
                            });
                            domDelta.note(domIndex, vehicle.vin, todayDate);
                        } catch {}""")
rep("""                index: domIndex,
            });
        } catch {}""","""                index: domIndex,
            });
            domDelta.note(domIndex, soldRecord.vin, todayDate);
        } catch {}""")
rep("""            await saveDomIndex(domIndex);
        } catch (domErr) {
            console.error(`⚠️ DOM index write failed: ${domErr.message}`);""","""            await checkpointDomDelta(domDelta);
        } catch (domErr) {
            console.error(`⚠️ DOM index delta checkpoint failed: ${domErr.message}`);""")
rep("""try {
    await saveDomIndex(domIndex);
    const pruned""","""// Today's rows for the DB come from this run's own writes; take them, then drop the loaded index so the merge does not hold it alongside its own working set.
const domTodayRows = flattenDomIndex(domDelta.entries).filter((r) => r.snapshotDate === todayDate);
domIndex = null;
try {
    await checkpointDomDelta(domDelta);
    await mergeDomDelta(domDelta); // on failure the delta file stays on disk and the next run merges it
    const pruned""")
rep("await upsertDomSnapshots(flattenDomIndex(domIndex).filter((r) => r.snapshotDate === todayDate));","await upsertDomSnapshots(domTodayRows);")
open(dst,'w').write(s)
