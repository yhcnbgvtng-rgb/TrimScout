/**
 * How an alternate stacks up against the buyer's favorite — measured on the
 * must-haves the buyer actually picked, never on whole-window-sticker
 * similarity (which scores noise the buyer never asked for).
 *
 *   primary: "3 of 4 must-haves" + which are present / missing
 *   secondary: a short factual diff vs the favorite (trim, drivetrain,
 *              color, package deltas) — facts, not a second percentage
 *
 * Pure; the wizard passes the favorite, the selected must-have names (with
 * their factory codes when known) and the alternate vehicle.
 */

import type { Vehicle } from "./types";

export interface MustHaveRef {
  name: string;
  code?: string | null;
}

export interface MustHaveHit {
  name: string;
  present: boolean;
}

export type MustHaveReport =
  | { kind: "none_selected" }
  /** The alternate has no factory record, so nothing can be checked — say so, don't score 0. */
  | { kind: "unverifiable"; total: number }
  | { kind: "scored"; total: number; hits: MustHaveHit[]; present: string[]; missing: string[] };

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[®™]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "53B  Tremor Package" → "53B"; "BlueCruise" → null. */
export function leadingCode(name: string): string | null {
  const m = (name || "").trim().match(/^([A-Z0-9]{2,5})\s{2,}/);
  return m ? m[1] : null;
}

function vehicleOptionKeys(v: Pick<Vehicle, "options" | "packages">): { names: Set<string>; codes: Set<string> } {
  const names = new Set<string>();
  const codes = new Set<string>();
  for (const o of v.options || []) {
    if (o.name) names.add(norm(o.name));
    if (o.code) codes.add(o.code.trim().toUpperCase());
    const lc = leadingCode(o.name || "");
    if (lc) codes.add(lc);
  }
  for (const p of v.packages || []) {
    if (p) names.add(norm(p));
    const lc = leadingCode(p);
    if (lc) codes.add(lc);
  }
  return { names, codes };
}

export function hasFactoryRecord(v: Pick<Vehicle, "buildConfidence" | "options" | "packages">): boolean {
  return v.buildConfidence === "verified_factory" || (v.options?.length || 0) > 0 || (v.packages?.length || 0) > 0;
}

/**
 * Which of the buyer's must-haves the alternate carries. A must-have is
 * present when its factory code matches, or its name matches an option or
 * package name (normalized); a package name that contains the must-have
 * as a whole phrase also counts ("Tremor Off-Road Package" for "Tremor
 * Package" does not — only exact or code matches, so a near-miss reads as
 * missing rather than as a false yes).
 */
export function mustHaveReport(mustHaves: MustHaveRef[], alternate: Vehicle): MustHaveReport {
  const wanted = mustHaves.filter((m) => (m.name || "").trim());
  if (wanted.length === 0) return { kind: "none_selected" };
  if (!hasFactoryRecord(alternate)) return { kind: "unverifiable", total: wanted.length };
  const keys = vehicleOptionKeys(alternate);
  const hits: MustHaveHit[] = wanted.map((m) => {
    const code = (m.code || leadingCode(m.name) || "").trim().toUpperCase();
    const byCode = Boolean(code) && keys.codes.has(code);
    const byName = keys.names.has(norm(m.name.replace(/^[A-Z0-9]{2,5}\s{2,}/, "")));
    return { name: m.name.replace(/^[A-Z0-9]{2,5}\s{2,}/, "").trim(), present: byCode || byName };
  });
  return {
    kind: "scored",
    total: hits.length,
    hits,
    present: hits.filter((h) => h.present).map((h) => h.name),
    missing: hits.filter((h) => !h.present).map((h) => h.name),
  };
}

/** The headline line: "3 of 4 must-haves", or the option by name when only one was picked. */
export function mustHaveHeadline(report: MustHaveReport): string {
  switch (report.kind) {
    case "none_selected":
      return "No must-haves selected";
    case "unverifiable":
      return `Can't check must-haves — no factory record for this VIN`;
    case "scored":
      if (report.total === 1) {
        return report.present.length === 1 ? `Has: ${report.present[0]}` : `Missing: ${report.missing[0]}`;
      }
      return `${report.present.length} of ${report.total} must-haves`;
  }
}

export type DiffChip = { kind: "same" | "different" | "missing" | "extra"; text: string };

const MAX_PACKAGE_CHIPS = 2;

/** "4X4", "4WD", "Four-Wheel Drive" are one thing; so are "AWD" and "AWD/All-Wheel Drive". */
export function normalizeDrivetrain(value: string): string {
  const n = norm(value);
  if (!n) return "";
  if (/\b(4x4|4wd|four wheel|4 wheel|part time 4wd)\b/.test(n)) return "4wd";
  if (/\b(awd|all wheel)\b/.test(n)) return "awd";
  if (/\b(rwd|rear wheel)\b/.test(n)) return "rwd";
  if (/\b(fwd|front wheel|2wd|4x2)\b/.test(n)) return "fwd";
  return n;
}

function labelTrim(v: Vehicle): string {
  return [v.trim].filter(Boolean).join(" ").trim();
}

/**
 * The short diff vs the favorite: trim, drivetrain and color when they
 * differ (trim when it matches, as the anchor), and the package deltas
 * that matter — capped, so it's a line, not a sticker dump. Options the
 * buyer already scored as must-haves are left to the must-have report.
 */
export function diffVsPrimary(primary: Vehicle, alternate: Vehicle, exclude: MustHaveRef[] = []): DiffChip[] {
  const chips: DiffChip[] = [];
  const pTrim = labelTrim(primary);
  const aTrim = labelTrim(alternate);
  const sameModel = norm(primary.make) === norm(alternate.make) && norm(primary.model) === norm(alternate.model);
  if (!sameModel) {
    // A different model: name it, and skip package-by-package deltas — those
    // only mean something between two builds of the same car.
    chips.push({ kind: "different", text: `Different model: ${[alternate.make, alternate.model, aTrim].filter(Boolean).join(" ")} (favorite: ${[primary.make, primary.model, pTrim].filter(Boolean).join(" ")})` });
  } else if (pTrim && aTrim) {
    chips.push(norm(pTrim) === norm(aTrim) ? { kind: "same", text: `Same ${aTrim}` } : { kind: "different", text: `${aTrim} (favorite: ${pTrim})` });
  }
  if (primary.drivetrain && alternate.drivetrain && normalizeDrivetrain(primary.drivetrain) !== normalizeDrivetrain(alternate.drivetrain)) {
    chips.push({ kind: "different", text: `${alternate.drivetrain} (favorite: ${primary.drivetrain})` });
  }
  if (primary.exteriorColor && alternate.exteriorColor && norm(primary.exteriorColor) !== norm(alternate.exteriorColor)) {
    chips.push({ kind: "different", text: `${alternate.exteriorColor} (favorite: ${primary.exteriorColor})` });
  }
  if (sameModel && hasFactoryRecord(primary) && hasFactoryRecord(alternate)) {
    const skip = new Set(exclude.map((m) => norm(m.name.replace(/^[A-Z0-9]{2,5}\s{2,}/, ""))));
    const pPk = new Map((primary.packages || []).map((p) => [norm(p), p]));
    const aPk = new Map((alternate.packages || []).map((p) => [norm(p), p]));
    let missing = 0;
    for (const [k, label] of pPk) {
      if (aPk.has(k) || skip.has(k)) continue;
      if (missing++ < MAX_PACKAGE_CHIPS) chips.push({ kind: "missing", text: `missing: ${label}` });
    }
    if (missing > MAX_PACKAGE_CHIPS) chips.push({ kind: "missing", text: `+${missing - MAX_PACKAGE_CHIPS} more missing` });
    let extra = 0;
    for (const [k, label] of aPk) {
      if (pPk.has(k) || skip.has(k)) continue;
      if (extra++ < MAX_PACKAGE_CHIPS) chips.push({ kind: "extra", text: `adds: ${label}` });
    }
    if (extra > MAX_PACKAGE_CHIPS) chips.push({ kind: "extra", text: `+${extra - MAX_PACKAGE_CHIPS} more added` });
  }
  return chips;
}

/** One compact line for places without room for chips: "Same Badlands · missing: Hardtop · Oxford White (favorite: Cactus Gray)". */
export function diffLine(chips: DiffChip[]): string {
  return chips.map((c) => c.text).join(" · ");
}
