// Pure merge of a locator roster into an OEM dump (see scripts/merge-roster-into-oem-dump.mjs).
import { hostFromUrl, isOemMarketingHost } from "./oem_locator.js";

const SOURCE_URL = (make) => `https://www.${String(make).toLowerCase()}.com/us/en/find-a-dealer`;

/** @returns {{ row: object|null, skip: string|null }} one dump row from one roster entry */
export function rosterEntryToDumpRow(entry, make) {
  const host = hostFromUrl(entry.url || entry.website || "");
  if (!host) return { row: null, skip: "no dealer website" };
  if (isOemMarketingHost(host)) return { row: null, skip: `OEM marketing host (${host})` };
  return {
    row: {
      make, name: entry.name, city: entry.city || null, state: String(entry.state || "").toUpperCase(), domain: host,
      lat: entry.latitude != null ? Number(entry.latitude) : null, lng: entry.longitude != null ? Number(entry.longitude) : null,
      source: "oem-locator", sourceUrl: SOURCE_URL(make),
    },
    skip: null,
  };
}

/**
 * Rows for `states` are replaced by the roster's (de-duplicated by name+state); all other dump rows are kept as they are, in order.
 * @returns {{ rows: object[], report: { perState: Record<string,{rosterEntries:number, dumpBefore:number, dumpAfter:number}>, skipped: {name:string,state:string,why:string}[] } }}
 */
export function mergeRosterIntoDump({ dump, roster, states, make }) {
  const wanted = new Set(states);
  const kept = dump.filter((r) => !wanted.has(String(r.state || "").toUpperCase()));
  const perState = Object.fromEntries(states.map((s) => [s, { rosterEntries: 0, dumpBefore: dump.filter((r) => String(r.state).toUpperCase() === s).length, dumpAfter: 0 }]));
  const skipped = [];
  const seen = new Set();
  const added = [];
  for (const entry of roster) {
    const st = String(entry.state || "").toUpperCase();
    if (!wanted.has(st)) continue;
    perState[st].rosterEntries++;
    const { row, skip } = rosterEntryToDumpRow(entry, make);
    if (!row) { skipped.push({ name: entry.name, state: st, why: skip }); continue; }
    const key = `${st}|${row.name.toLowerCase()}`;
    if (seen.has(key)) { skipped.push({ name: entry.name, state: st, why: "duplicate name in state" }); continue; }
    seen.add(key);
    added.push(row);
    perState[st].dumpAfter++;
  }
  added.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  return { rows: [...kept, ...added], report: { perState, skipped } };
}
