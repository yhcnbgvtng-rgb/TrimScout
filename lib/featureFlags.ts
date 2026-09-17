/**
 * Kill switches for the conversion paths. Browse can scale on the CDN;
 * these gate the things that cost money, burn dealers, or write rows.
 * Read from env at call time (Vercel env change → redeploy ≈ 1 min);
 * `env` from node:process so the bundler can't inline a stale value.
 *
 * Defaults are the soft-launch posture: sends on, email on, sticker fetch
 * on (cache-first, never blocking), paid decode and live inventory off.
 */
import { env } from "node:process";

export type FeatureFlag = "rfqSend" | "outboundDealerEmail" | "paidVinDecode" | "liveInventory" | "stickerFetch";

const ENV_NAME: Record<FeatureFlag, string> = {
  rfqSend: "FEATURE_RFQ_SEND",
  outboundDealerEmail: "FEATURE_OUTBOUND_DEALER_EMAIL",
  paidVinDecode: "FEATURE_PAID_VIN_DECODE",
  liveInventory: "FEATURE_LIVE_INVENTORY",
  stickerFetch: "FEATURE_STICKER_FETCH",
};
const DEFAULTS: Record<FeatureFlag, boolean> = {
  rfqSend: true,
  outboundDealerEmail: true,
  paidVinDecode: false,
  liveInventory: false,
  stickerFetch: true,
};

function parseFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export function featureEnabled(flag: FeatureFlag, source: Record<string, string | undefined> = env as Record<string, string | undefined>): boolean {
  return parseFlag(source[ENV_NAME[flag]], DEFAULTS[flag]);
}

export function featureFlags(source?: Record<string, string | undefined>): Record<FeatureFlag, boolean> {
  return {
    rfqSend: featureEnabled("rfqSend", source),
    outboundDealerEmail: featureEnabled("outboundDealerEmail", source),
    paidVinDecode: featureEnabled("paidVinDecode", source),
    liveInventory: featureEnabled("liveInventory", source),
    stickerFetch: featureEnabled("stickerFetch", source),
  };
}

/** What the buyer is told when a switch is off — honest, no 500s, no silent drops. */
export const DEGRADE_COPY = {
  rfqSendOff: "Quote requests are paused for a moment while we catch up. Your draft is saved — try again shortly.",
  emailOff: "Quotes are delayed — dealers will be notified as soon as sending resumes. Your request is saved and in line.",
  queued: "We're lining up your quote — the dealer will be notified in a moment.",
  queuedUnassigned: "We're lining up your quote — this dealership has no sales inbox on file yet, so our team routes it to the store by hand. Replies still come back through TrimScout.",
  /** Every request is reviewed by TrimScout before any dealer sees it. */
  underReview: "Under review — we check every request before it goes out and release it to your dealers within 1 business day. Replies come back here.",
} as const;

/** The public status the app polls for its degrade banner: flags only, never counters. */
export function publicFeatureStatus(source?: Record<string, string | undefined>): { rfqSend: boolean; outboundDealerEmail: boolean; banner: string | null } {
  const f = featureFlags(source);
  return { rfqSend: f.rfqSend, outboundDealerEmail: f.outboundDealerEmail, banner: !f.rfqSend ? DEGRADE_COPY.rfqSendOff : !f.outboundDealerEmail ? DEGRADE_COPY.emailOff : null };
}
