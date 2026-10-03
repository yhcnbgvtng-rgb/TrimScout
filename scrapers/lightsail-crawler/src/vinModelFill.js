// Fill a blank dealer_inventory.model from the VIN, using NHTSA's vPIC decoder — the pure decision logic,
// separate from the script that talks to the database and to vPIC so it can be unit-tested.
//
// The rules (from the brief):
//   - only rows with a 17-character VIN and a blank model;
//   - never overwrite a model the dealer sent;
//   - write the decoded model only when the decoded make matches the row's make (case/punctuation-insensitive);
//   - when vPIC returns nothing, leave it blank — never invent one;
//   - look a VIN PATTERN up once, not every VIN: positions 1-8 (manufacturer + vehicle descriptor) plus the
//     model-year character decide the model, the rest (check digit, plant, serial) does not.
//
// Two safeguards beyond that, because a wrong model is worse than a blank one:
//   - a pattern is decoded from up to three sample VINs; if they disagree the pattern is not trusted as a
//     group and each of its VINs is decoded on its own;
//   - a VIN whose check digit fails (a typo, or a placeholder a dealer lists before the real VIN exists) is
//     only filled when the dealer's own listing URL names the decoded model ("...2026-toyota-rav4-sport-utility").

export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

const TRANSLITERATION = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** ISO 3779 / FMVSS 115 check digit (position 9). Every vehicle sold new in the US carries a valid one. */
export function checkDigitValid(vin) {
  if (!VIN_RE.test(vin)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    sum += (/\d/.test(c) ? Number(c) : TRANSLITERATION[c]) * WEIGHTS[i];
  }
  const r = sum % 11;
  return vin[8] === (r === 10 ? "X" : String(r));
}

/** What decides the model: manufacturer + descriptor (1-8) and the model-year character (10). */
export const vinPatternKey = (vin) => `${vin.slice(0, 8)}${vin[9]}`;

export const normalizeAlnum = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function makesMatch(rowMake, decodedMake) {
  const a = normalizeAlnum(rowMake);
  return a !== "" && a === normalizeAlnum(decodedMake);
}

/** Does the dealer's listing URL name the model? (VIN removed first so the serial can't match by accident.) */
export function urlNamesModel(url, vin, model) {
  const m = normalizeAlnum(model);
  if (m.length < 3 || !url) return false;
  return normalizeAlnum(String(url).toUpperCase().split(String(vin).toUpperCase()).join(" ")).includes(m);
}

/** One entry of vPIC's Results[] -> the fields used here (empty strings become null). */
export function parseVpicResult(r) {
  const s = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    vin: s(r.VIN),
    make: s(r.Make),
    model: s(r.Model),
    modelYear: s(r.ModelYear),
    errorCodes: String(r.ErrorCode ?? "").split(",").map((c) => c.trim()).filter(Boolean),
    errorText: s(r.ErrorText),
  };
}

/**
 * Group blank rows by VIN pattern and choose up to `samples` VINs per pattern to decode: ones whose check digit
 * is valid when there are any (a typo'd VIN decodes worse), spread across the pattern's serial range.
 * @returns {Map<string, { rows: object[], sampleVins: string[] }>}
 */
export function planDecodeTargets(rows, { samples = 3 } = {}) {
  const groups = new Map();
  for (const row of rows) {
    if (!VIN_RE.test(row.vin)) continue;
    const key = vinPatternKey(row.vin);
    if (!groups.has(key)) groups.set(key, { rows: [], sampleVins: [] });
    groups.get(key).rows.push(row);
  }
  for (const g of groups.values()) {
    const vins = [...new Set(g.rows.map((r) => r.vin))].sort((a, b) => (a.slice(10) < b.slice(10) ? -1 : a.slice(10) > b.slice(10) ? 1 : 0));
    const valid = vins.filter(checkDigitValid);
    const pool = valid.length ? valid : vins;
    const picks = new Set([pool[0], pool[Math.floor(pool.length / 2)], pool[pool.length - 1]].slice(0, Math.max(1, samples)));
    g.sampleVins = [...picks];
  }
  return groups;
}

/**
 * What a pattern's sample decodes say.
 * @param {ReturnType<typeof parseVpicResult>[]} decodes
 * @returns {{status: 'ok'|'no-model'|'inconsistent', make?: string, model?: string}}
 */
export function patternConsensus(decodes) {
  const usable = decodes.filter((d) => d.make && d.model);
  if (!usable.length) return { status: "no-model" };
  const sig = (d) => `${normalizeAlnum(d.make)}|${normalizeAlnum(d.model)}`;
  if (usable.some((d) => sig(d) !== sig(usable[0]))) return { status: "inconsistent" };
  return { status: "ok", make: usable[0].make, model: usable[0].model };
}

/**
 * The spelling already used in the database for a model, so a fill reads "RAV4", not a differently-cased
 * variant. Built from in-stock rows that already have a model.
 * @param {{make: string, model: string, n: number}[]} groups  rows of (make, model, count)
 * @returns {Map<string, Map<string, string>>} makeNorm -> modelNorm -> most common spelling
 */
export function buildSpellings(groups) {
  const counts = new Map(); // makeNorm -> modelNorm -> Map(spelling -> n)
  for (const g of groups) {
    const mk = normalizeAlnum(g.make);
    const md = normalizeAlnum(g.model);
    if (!mk || !md) continue;
    if (!counts.has(mk)) counts.set(mk, new Map());
    const byModel = counts.get(mk);
    if (!byModel.has(md)) byModel.set(md, new Map());
    const sp = byModel.get(md);
    sp.set(g.model, (sp.get(g.model) || 0) + Number(g.n || 1));
  }
  const out = new Map();
  for (const [mk, byModel] of counts) {
    const m = new Map();
    for (const [md, sp] of byModel) m.set(md, [...sp.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    out.set(mk, m);
  }
  return out;
}

export function canonicalModel(spellings, rowMake, decodedModel) {
  const existing = spellings.get(normalizeAlnum(rowMake))?.get(normalizeAlnum(decodedModel));
  return existing ? { model: existing, seenInDb: true } : { model: decodedModel, seenInDb: false };
}

/**
 * One row's verdict.
 * @param {{vin: string, dealerId: number, make: string|null, vdpUrl: string|null}} row
 * @param {{status: string, make?: string, model?: string}|undefined} verdict  the row's pattern (or its own VIN) decode result
 * @returns {{action: 'fill', model: string, tier: 'A'|'B', seenInDb: boolean} | {action: 'skip', reason: string}}
 */
export function decideRow(row, verdict, spellings) {
  if (!VIN_RE.test(row.vin || "")) return { action: "skip", reason: "not a 17-character VIN" };
  if (!row.make || !row.make.trim()) return { action: "skip", reason: "row has no make, so the decoded make cannot be checked" };
  if (!verdict) return { action: "skip", reason: "vPIC lookup failed (not decoded)" };
  if (verdict.status === "inconsistent") return { action: "skip", reason: "VINs of this pattern decode to different models" };
  if (verdict.status !== "ok") return { action: "skip", reason: "vPIC returned no model" };
  if (!makesMatch(row.make, verdict.make)) return { action: "skip", reason: `make mismatch (row "${row.make}" vs vPIC "${verdict.make}")` };
  const { model, seenInDb } = canonicalModel(spellings, row.make, verdict.model);
  if (checkDigitValid(row.vin)) return { action: "fill", model, tier: "A", seenInDb };
  if (urlNamesModel(row.vdpUrl, row.vin, model)) return { action: "fill", model, tier: "B", seenInDb };
  return { action: "skip", reason: "VIN check digit fails and the listing URL does not name the model" };
}

/** Counts for the dry-run report: per make, and skip reasons overall. */
export function summarize(rows, decisions) {
  const byMake = new Map();
  const reasons = new Map();
  for (let i = 0; i < rows.length; i++) {
    const make = rows[i].make || "(no make)";
    const d = decisions[i];
    if (!byMake.has(make)) byMake.set(make, { blank: 0, fillA: 0, fillB: 0, skipped: 0 });
    const m = byMake.get(make);
    m.blank++;
    if (d.action === "fill") m[d.tier === "A" ? "fillA" : "fillB"]++;
    else { m.skipped++; reasons.set(d.reason.replace(/\(row ".*"\)/, "(row vs vPIC)"), (reasons.get(d.reason.replace(/\(row ".*"\)/, "(row vs vPIC)")) || 0) + 1); }
  }
  return {
    byMake: [...byMake.entries()].map(([make, v]) => ({ make, ...v })).sort((a, b) => b.blank - a.blank),
    reasons: [...reasons.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
    totals: { blank: rows.length, fills: decisions.filter((d) => d.action === "fill").length, skipped: decisions.filter((d) => d.action === "skip").length },
  };
}
