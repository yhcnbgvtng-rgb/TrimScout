/**
 * The dealer's availability confirmation on a quote: before a quote request is answered, the desk says whether the exact car (VIN shown) is in
 * stock. Yes -> the quote is for that car and the confirmation time is saved with it. No -> the desk declines, or offers a comparable
 * car under its own VIN, which is saved as a different vehicle. Pure: the dealer sheet, the quote routes and the buyer's tracker all read this.
 */

export type QuoteAvailability =
  | { status: "available"; vin: string; confirmedAt: string }
  | { status: "unavailable_alternative"; requestedVin: string; alternativeVin: string; recordedAt: string };

/** What the dealer's sheet sends: the choice only. Times are stamped on the server, never taken from the browser. */
export type AvailabilityAnswer = { answer: "yes" } | { answer: "alternative"; alternativeVin: string };

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const cleanVin = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : "");

export const AVAILABILITY_REQUIRED_ERROR = "Confirm whether this exact vehicle is in stock and available before submitting the quote.";

export const AVAILABILITY_COPY = {
  yes: "Yes, this exact vehicle (VIN shown) is in stock and available",
  no: "No, it's sold or unavailable",
  decline: "Decline this quote request",
  alternative: "Offer a comparable vehicle",
  differentCar: "This is a different vehicle from the one the buyer asked about. The buyer will see that it is an alternative.",
} as const;

export type AvailabilityResult = { ok: true; availability: QuoteAvailability } | { ok: false; error: string };

/**
 * Validates the dealer's answer against the car the buyer asked about and the VIN the quote is being submitted for.
 * `requestedVin` may be empty (an open-to-alternatives request has no VIN yet): then the quote's own VIN is the car being confirmed.
 */
export function resolveAvailability(input: unknown, o: { requestedVin: string; quoteVin: string; now?: Date }): AvailabilityResult {
  const requested = cleanVin(o.requestedVin);
  const quoteVin = cleanVin(o.quoteVin);
  const now = (o.now ?? new Date()).toISOString();
  const a = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!a || (a.answer !== "yes" && a.answer !== "alternative")) return { ok: false, error: AVAILABILITY_REQUIRED_ERROR };
  if (a.answer === "yes") {
    if (!quoteVin) return { ok: false, error: "Enter the VIN of the vehicle you are confirming." };
    if (requested && quoteVin !== requested) {
      return { ok: false, error: "The VIN on this quote is not the vehicle the buyer asked about. Choose “No, it's sold or unavailable” and offer it as a comparable vehicle, or enter the requested VIN." };
    }
    return { ok: true, availability: { status: "available", vin: quoteVin, confirmedAt: now } };
  }
  const alt = cleanVin(a.alternativeVin);
  if (!VIN_RE.test(alt)) return { ok: false, error: "Enter the full 17-character VIN of the comparable vehicle you are offering." };
  if (requested && alt === requested) return { ok: false, error: "That is the VIN the buyer asked about. If it is in stock, choose “Yes”; a comparable vehicle needs a different VIN." };
  if (quoteVin !== alt) return { ok: false, error: "The quote's VIN must be the comparable vehicle's VIN." };
  return { ok: true, availability: { status: "unavailable_alternative", requestedVin: requested, alternativeVin: alt, recordedAt: now } };
}

/** Reads a stored value defensively (older quotes have none; the box hands back parsed JSON). */
export function coerceAvailability(raw: unknown): QuoteAvailability | null {
  const v = typeof raw === "string" ? safeParse(raw) : raw;
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (r.status === "available" && typeof r.confirmedAt === "string" && typeof r.vin === "string") return { status: "available", vin: r.vin, confirmedAt: r.confirmedAt };
  if (r.status === "unavailable_alternative" && typeof r.alternativeVin === "string") {
    return { status: "unavailable_alternative", requestedVin: typeof r.requestedVin === "string" ? r.requestedVin : "", alternativeVin: r.alternativeVin, recordedAt: typeof r.recordedAt === "string" ? r.recordedAt : "" };
  }
  return null;
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/** "Nov 3, 2:05pm". `timeZone` is for tests and server rendering; the browser's own zone is used when omitted. */
export function formatConfirmedAt(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, ...(timeZone ? { timeZone } : {}) }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")}${get("dayPeriod").toLowerCase()}`;
}

/** The one line the buyer reads in the Deal Tracker; null for quotes that predate the confirmation. */
export function buyerAvailabilityLine(raw: unknown, timeZone?: string): string | null {
  const a = coerceAvailability(raw);
  if (!a) return null;
  if (a.status === "available") {
    const when = formatConfirmedAt(a.confirmedAt, timeZone);
    return when ? `Dealer confirmed available · ${when}` : "Dealer confirmed available";
  }
  return "Dealer says sold, offered an alternative";
}

/** One line per desk that has quoted with a confirmation, for the Deal Tracker card. Only the desk's name and the line: no contact details. */
export function trackerAvailabilityLines(
  rfq: { invites: Array<{ id: string; dealerName: string; quote?: { availability?: unknown } | null }> },
  timeZone?: string
): Array<{ inviteId: string; dealerName: string; line: string; alternative: boolean }> {
  const out: Array<{ inviteId: string; dealerName: string; line: string; alternative: boolean }> = [];
  for (const i of rfq.invites) {
    const line = buyerAvailabilityLine(i.quote?.availability, timeZone);
    if (!line) continue;
    out.push({ inviteId: i.id, dealerName: i.dealerName, line, alternative: coerceAvailability(i.quote?.availability)?.status === "unavailable_alternative" });
  }
  return out;
}
