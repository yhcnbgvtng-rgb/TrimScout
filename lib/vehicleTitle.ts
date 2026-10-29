/**
 * One place that turns year / make / model / trim into a title. A model that already ends with the trim
 * ("F-150 Raptor" + "Raptor") must not repeat it, so the trim is dropped in that case.
 */
export interface VehicleTitleParts {
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** True when `model` already ends with `trim` as whole words (or equals it). */
export function modelEndsWithTrim(model: string | null | undefined, trim: string | null | undefined): boolean {
  const m = norm(model || "");
  const t = norm(trim || "");
  if (!m || !t) return false;
  return m === t || m.endsWith(` ${t}`);
}

export function vehicleTitle(v: VehicleTitleParts): string {
  const trim = modelEndsWithTrim(v.model, v.trim) ? null : v.trim;
  return [v.year, v.make, v.model, trim].filter(Boolean).join(" ");
}
