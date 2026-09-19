/**
 * The "I'm open to different vehicles" lane (2026-09-17). The buyer isn't
 * quoting one VIN; they tell dealers what they need and dealers may
 * propose other cars. No VIN, dealer link or factory sticker is required.
 * Quotes on this lane are alternates by definition; on the same-spec lane a
 * dealer's quote for a different VIN is an alternate too — both are kept
 * out of the same-spec ranking. Pure; client-safe.
 */
export type RfqLane = "same_spec" | "alternate";

export const LANE_COPY: Record<RfqLane, { title: string; help: string }> = {
  same_spec: { title: "This exact vehicle", help: "Paste the VIN or dealer link so quotes match this car." },
  alternate: { title: "Open to anything", help: "No VIN needed — dealers can propose different cars." },
};

export const BODY_STYLES = ["Sedan", "SUV", "Truck", "Minivan", "Coupe", "Hatchback", "Wagon", "Convertible", "EV / hybrid"] as const;

export interface AlternateAsk {
  bodyStyle?: string | null;
  /** Makes the buyer is interested in, free text split on commas ("Toyota, Honda"). */
  makes?: string[];
  /** Must-have features, short free-text lines. */
  mustHaves?: string[];
  /** Budget signal — monthly max (lease/finance) and/or cash due at signing / cash price max. */
  monthlyMax?: number | null;
  dueAtSigningMax?: number | null;
  /** An example listing the buyer likes — context only, never a same-spec lock. */
  exampleUrl?: string | null;
}

export interface AlternateAskDraft {
  bodyStyle: string;
  makes: string;
  mustHaves: string;
  monthlyMax: string;
  dueAtSigningMax: string;
  exampleUrl: string;
}

export const EMPTY_ALTERNATE_DRAFT: AlternateAskDraft = { bodyStyle: "", makes: "", mustHaves: "", monthlyMax: "", dueAtSigningMax: "", exampleUrl: "" };

const money = (raw: string): number | null | undefined => {
  const t = (raw || "").replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
};
const list = (raw: string): string[] =>
  (raw || "")
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);

/** Build the ask or list what's wrong. Every field is optional except that the buyer says at least one thing. */
export function buildAlternateAsk(d: AlternateAskDraft): { ask: AlternateAsk | null; errors: string[] } {
  const errors: string[] = [];
  const monthlyMax = money(d.monthlyMax);
  const dasMax = money(d.dueAtSigningMax);
  if (monthlyMax === undefined) errors.push("Monthly max must be a number.");
  if (dasMax === undefined) errors.push("Due at signing / cash max must be a number.");
  const exampleUrl = (d.exampleUrl || "").trim();
  if (exampleUrl && !/^https?:\/\/\S+$/i.test(exampleUrl)) errors.push("The example link isn't a web address.");
  const ask: AlternateAsk = {
    bodyStyle: d.bodyStyle.trim() || null,
    makes: list(d.makes),
    mustHaves: list(d.mustHaves),
    monthlyMax: monthlyMax ?? null,
    dueAtSigningMax: dasMax ?? null,
    exampleUrl: exampleUrl || null,
  };
  if (!ask.bodyStyle && !ask.makes!.length && !ask.mustHaves!.length && ask.monthlyMax == null && ask.dueAtSigningMax == null && !ask.exampleUrl) {
    errors.push("Tell dealers at least one thing — a body style, a make, a must-have, or a budget.");
  }
  return errors.length ? { ask: null, errors } : { ask, errors: [] };
}

/** Sanitize a stored / posted ask. */
export function parseAlternateAsk(raw: unknown): AlternateAsk | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 80)).filter(Boolean).slice(0, 12) : []);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const ask: AlternateAsk = {
    bodyStyle: typeof o.bodyStyle === "string" && o.bodyStyle.trim() ? o.bodyStyle.trim().slice(0, 40) : null,
    makes: strs(o.makes),
    mustHaves: strs(o.mustHaves),
    monthlyMax: num(o.monthlyMax),
    dueAtSigningMax: num(o.dueAtSigningMax),
    exampleUrl: typeof o.exampleUrl === "string" && /^https?:\/\/\S+$/i.test(o.exampleUrl.trim()) ? o.exampleUrl.trim().slice(0, 500) : null,
  };
  return ask;
}

/** "SUV · Toyota, Honda · AWD, heated seats · ≤ $500/mo · ≤ $3,000 at signing" */
export function alternateAskSummary(ask: AlternateAsk | null | undefined): string {
  if (!ask) return "Open to different vehicles";
  const parts: string[] = [];
  if (ask.bodyStyle) parts.push(ask.bodyStyle);
  if (ask.makes?.length) parts.push(ask.makes.join(", "));
  if (ask.mustHaves?.length) parts.push(ask.mustHaves.join(", "));
  if (ask.monthlyMax != null) parts.push(`≤ $${ask.monthlyMax.toLocaleString()}/mo`);
  if (ask.dueAtSigningMax != null) parts.push(`≤ $${ask.dueAtSigningMax.toLocaleString()} at signing`);
  return parts.length ? parts.join(" · ") : "Open to different vehicles";
}

/** A quote is an alternate when the request is the alternate lane, or when the dealer quoted a different VIN than asked. */
export function isAlternateQuote(rfq: { lane?: RfqLane | null; vin: string }, quoteVin: string | null | undefined): boolean {
  if ((rfq.lane ?? "same_spec") === "alternate") return true;
  const asked = (rfq.vin || "").trim().toUpperCase();
  const quoted = (quoteVin || "").trim().toUpperCase();
  return Boolean(asked && quoted && asked !== quoted);
}
