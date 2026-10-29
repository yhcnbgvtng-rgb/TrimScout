/**
 * The notices that keep both sides of a quote request moving: a dealer quoted / declined, a request wasn't released, the buyer
 * closed a request, and "you have a new message". Pure builders (copy only). Every one goes out through the SAFE MODE sender
 * (lib/dealerEmail.ts), so it lands at the safe recipient only; the subject and a banner say who it was meant for.
 *
 * Copy rules: "quote request", never "bid" or "auction". No notice carries anyone's contact details, and a message notice carries
 * no message text at all (only that one is waiting, with a link), so nothing a chat filter caught can leak through email.
 */
import { safeModeSubject } from "./safeMode";
import { emailHeader } from "./quoteInviteEmail";
import { vehicleTitle, type VehicleTitleParts } from "./vehicleTitle";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type NoticeAudience = "buyer" | "dealer";
export type ThreadNoticeKind = "dealer_quoted" | "dealer_declined" | "request_rejected" | "buyer_closed" | "new_message";

export interface ThreadNotice { subject: string; html: string; audience: NoticeAudience; kind: ThreadNoticeKind }

interface Parts {
  audience: NoticeAudience;
  kind: ThreadNoticeKind;
  /** Who the SAFE MODE tag names: the dealer for dealer-bound mail, "buyer" for buyer-bound mail. */
  forLabel: string;
  subject: string;
  headline: string;
  text: string;
  cta: string;
  url: string;
  reference?: string | null;
  unsubscribeUrl?: string | null;
}

function shell(p: Parts): ThreadNotice {
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;line-height:1.5">
    ${emailHeader()}
    <p style="font-size:12px;color:#78350f;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;margin:0 0 16px"><strong>SAFE MODE:</strong> redirected here instead of ${esc(p.forLabel)}.</p>
    <h1 style="font-size:18px;margin:0 0 8px">${esc(p.headline)}</h1>
    <p style="font-size:14px;color:#374151;margin:0 0 16px">${esc(p.text)}</p>
    <a href="${esc(p.url)}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#22c55e;color:#000;font-weight:800;text-decoration:none">${esc(p.cta)}</a>
    <p style="font-size:12px;color:#64748b;margin:20px 0 0">This is a quote request. There is no deadline on anyone.${p.reference ? ` Ref ${esc(p.reference)}.` : ""}</p>
    ${p.unsubscribeUrl ? `<p style="font-size:11px;color:#94a3b8;margin:8px 0 0"><a href="${esc(p.unsubscribeUrl)}" style="color:#94a3b8">Stop these emails</a></p>` : ""}
  </div>`.trim();
  return { subject: safeModeSubject(p.forLabel, p.subject), html, audience: p.audience, kind: p.kind };
}

const car = (v: VehicleTitleParts) => vehicleTitle(v) || "your vehicle";

/** To the buyer: a dealer's quote (or revised quote) is in. No numbers: they are on the compare screen. */
export function buildDealerQuotedNotice(i: { dealerName: string; vehicle: VehicleTitleParts; revised: boolean; url: string }): ThreadNotice {
  return shell({
    audience: "buyer", kind: "dealer_quoted", forLabel: "buyer",
    subject: `${i.revised ? "Revised quote" : "New quote"} from ${i.dealerName}: ${car(i.vehicle)}`,
    headline: i.revised ? "A dealer sent a revised quote" : "A dealer sent a quote",
    text: `${i.dealerName} ${i.revised ? "revised their quote after your counter" : "replied to your quote request"} for the ${car(i.vehicle)}. Compare it with the others and pick one, counter it, or walk away.`,
    cta: "Compare quotes", url: i.url,
  });
}

/** To the buyer: a dealer can't quote or can't do better on a counter. */
export function buildDealerDeclinedNotice(i: { dealerName: string; vehicle: VehicleTitleParts; url: string }): ThreadNotice {
  return shell({
    audience: "buyer", kind: "dealer_declined", forLabel: "buyer",
    subject: `${i.dealerName} can't help with this quote request: ${car(i.vehicle)}`,
    headline: "A dealer can't do better",
    text: `${i.dealerName} replied to your quote request for the ${car(i.vehicle)} without a new quote. Their earlier quote, if they sent one, still stands. The other dealers are unaffected.`,
    cta: "See your request", url: i.url,
  });
}

/** To the buyer: the request wasn't released. The reason is on their tracker, not in the email. */
export function buildRequestRejectedNotice(i: { vehicle: VehicleTitleParts; url: string }): ThreadNotice {
  return shell({
    audience: "buyer", kind: "request_rejected", forLabel: "buyer",
    subject: `Your quote request wasn't released: ${car(i.vehicle)}`,
    headline: "Your quote request wasn't released",
    text: `We couldn't send your quote request for the ${car(i.vehicle)} to dealers as submitted. The reason is on your tracker; you can fix it and send it again.`,
    cta: "See why", url: i.url,
  });
}

/** To a dealer: the buyer closed the request. Nothing is owed. */
export function buildBuyerClosedNotice(i: { dealerName: string; vehicle: VehicleTitleParts; reference: string | null; url: string; unsubscribeUrl?: string | null }): ThreadNotice {
  return shell({
    audience: "dealer", kind: "buyer_closed", forLabel: i.dealerName,
    subject: `Quote request closed: ${car(i.vehicle)}`,
    headline: "The buyer closed this quote request",
    text: `The buyer closed their quote request for the ${car(i.vehicle)}. Nothing more is needed from you. Thanks for looking.`,
    cta: "Open the request", url: i.url, reference: i.reference, unsubscribeUrl: i.unsubscribeUrl,
  });
}

/** To either side: one new message is waiting. Never the text. */
export function buildNewMessageNotice(i: { to: NoticeAudience; dealerName: string; vehicle: VehicleTitleParts; reference?: string | null; url: string; unsubscribeUrl?: string | null }): ThreadNotice {
  const toDealer = i.to === "dealer";
  return shell({
    audience: i.to, kind: "new_message", forLabel: toDealer ? i.dealerName : "buyer",
    subject: `New message on your quote request: ${car(i.vehicle)}`,
    headline: "You have a new message",
    text: toDealer
      ? `The buyer sent a message about the ${car(i.vehicle)}. Messages stay inside TrimScout: open your quote request to read and reply.`
      : `${i.dealerName} sent a message about the ${car(i.vehicle)}. Messages stay inside TrimScout: open your request to read and reply.`,
    cta: "Read the message", url: i.url, reference: i.reference, unsubscribeUrl: toDealer ? i.unsubscribeUrl : null,
  });
}
