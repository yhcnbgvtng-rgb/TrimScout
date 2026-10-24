// Re-clean of STORED trims (dealer_inventory.trim): one distinct trim string in, one verdict out. Pure (no DB, no fs), so the dryrun, plan, apply and
// verify phases of scripts/box/2026-10-21-trim-reclean.mjs decide with the same function the unit tests pin. The rule itself is cleanTrim() from
// ingestSanitize.js (#570) - the very function the crawl now applies - so a stored row ends up exactly as a fresh crawl would write it.
import { cleanTrim, decodeHtmlEntities } from "../../scrapers/lightsail-crawler/src/ingestSanitize.js";

const MARKS_RE = /[®™℠]/;
// The stored trim is the only copy of a car's drivetrain (no column, no shard field), so a re-clean must never drop one: 4WD, AWD, 4x4, RWD, FWD, 2WD.
const DRIVETRAIN_WORDS = /(?<![A-Za-z0-9])(?:4wd|awd|4x4|rwd|fwd|2wd)(?![A-Za-z0-9])/gi;
const drivetrainWords = (t) => (t.match(DRIVETRAIN_WORDS) || []).map((w) => w.toLowerCase());

/**
 * @param {string|null} trim  the stored trim
 * @param {string|null} make  the stored make (cleanTrim ignores it; every make keeps its drivetrain word)
 * @returns {null | { next: string, reasons: string[] }}  null = leave the row alone
 */
export function classifyTrimChange(trim, make) {
  if (typeof trim !== "string" || !trim.trim()) return null; // blank / NULL trims are never touched
  const next = cleanTrim(trim, { make });
  if (next === trim || !next || next.length > trim.length) return null; // never blank a trim, never lengthen one
  const decoded = decodeHtmlEntities(trim);
  if (drivetrainWords(next).join() !== drivetrainWords(decoded).join()) return null; // never lose or change a drivetrain word, whatever cleanTrim does
  const reasons = [];
  if (decoded !== trim) reasons.push("entity");
  if (MARKS_RE.test(decoded)) reasons.push("mark");
  if (!reasons.length) reasons.push("whitespace");
  return { next, reasons };
}

/** The most distinct-trim pairs a summary lists per make (counts and trim text only - never a VIN). */
export const TOP_PAIRS = 30;

/**
 * Folds the distinct (model, trim, n) groups of one make into the counts the dry run reports.
 * @param {Array<{ model: string, trim: string|null, n: number }>} groups
 */
export function summarizeGroups(make, groups) {
  const out = { make, distinctTrims: 0, changedTrims: 0, rowsToChange: 0, byReason: {}, mergesIntoExistingTrim: 0, pairs: [] };
  const existing = new Set(groups.map((g) => `${g.model}\u0001${g.trim}`));
  for (const g of groups) {
    out.distinctTrims++;
    const c = classifyTrimChange(g.trim, make);
    if (!c) continue;
    out.changedTrims++; out.rowsToChange += g.n;
    for (const r of c.reasons) out.byReason[r] = (out.byReason[r] || 0) + g.n;
    if (existing.has(`${g.model}\u0001${c.next}`)) out.mergesIntoExistingTrim++; // the cleaned trim already exists on this model: two facet entries become one
    out.pairs.push({ model: g.model, from: g.trim, to: c.next, rows: g.n, reasons: c.reasons });
  }
  out.pairs.sort((a, b) => b.rows - a.rows);
  out.pairs = out.pairs.slice(0, TOP_PAIRS);
  return out;
}
