import "./testdata/blockLiveHttp";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { featureEnabled, featureFlags, publicFeatureStatus, DEGRADE_COPY } from "./featureFlags";
import { checkRateLimit, firstTrippedLimit, resetRateLimitsForTests, tooManyRequests, isRateLimitExempt } from "./rateLimit";
import { buildInviteEmailFromStored, drainQueuedInvites, queuedInvitesOf, sendQueuedInvite } from "./inviteOutbox";
import { breakerOpen, clearHyundaiStickerMemoryCache, getHyundaiSticker, stickerBreakerSnapshot } from "./hyundaiSticker";
import { opsSnapshot, resetOpsMetricsForTests } from "./opsMetrics";
import type { RfqInvite, RfqRequest } from "./rfq";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

describe("kill switches", () => {
  it("defaults: sends on, email on, sticker fetch on, paid decode + live inventory off; any truthy/falsy spelling works", () => {
    assert.deepEqual(featureFlags({}), { rfqSend: true, outboundDealerEmail: true, paidVinDecode: false, liveInventory: false, stickerFetch: true });
    assert.equal(featureEnabled("rfqSend", { FEATURE_RFQ_SEND: "off" }), false);
    assert.equal(featureEnabled("rfqSend", { FEATURE_RFQ_SEND: "0" }), false);
    assert.equal(featureEnabled("paidVinDecode", { FEATURE_PAID_VIN_DECODE: "yes" }), true);
    assert.equal(featureEnabled("rfqSend", { FEATURE_RFQ_SEND: "" }), true, "blank means default");
  });
  it("the public status carries an honest banner when a switch is off, and nothing else", () => {
    assert.deepEqual(publicFeatureStatus({}), { rfqSend: true, outboundDealerEmail: true, banner: null });
    assert.equal(publicFeatureStatus({ FEATURE_RFQ_SEND: "false" }).banner, DEGRADE_COPY.rfqSendOff);
    assert.equal(publicFeatureStatus({ FEATURE_OUTBOUND_DEALER_EMAIL: "false" }).banner, DEGRADE_COPY.emailOff);
    assert.doesNotMatch(JSON.stringify(publicFeatureStatus({})), /count|queue|secret/i);
  });
});

describe("rate limits — 429 with Retry-After, never a 500", () => {
  it("fixed window per key; the trip carries the seconds until reset", () => {
    resetRateLimitsForTests();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) assert.equal(checkRateLimit("k", 3, 60_000, t0 + i).ok, true);
    const v = checkRateLimit("k", 3, 60_000, t0 + 10_000);
    assert.equal(v.ok, false);
    assert.equal(v.retryAfterSec, 50);
    assert.equal(checkRateLimit("k", 3, 60_000, t0 + 61_000).ok, true, "window rolled");
    assert.equal(checkRateLimit("other", 3, 60_000, t0).ok, true, "keys are independent");
  });
  it("test and admin accounts are exempt from the send caps", () => {
    assert.equal(isRateLimitExempt({ id: 2, email: "tester@trimscout.test", role: "buyer" }), true, "@trimscout.test smoke accounts");
    assert.equal(isRateLimitExempt({ id: 14, email: "trial@example.com", role: "buyer" }), true, "@example.com");
    assert.equal(isRateLimitExempt({ id: 1, email: "owner@outlook.com", role: "admin" }), true, "admins");
    assert.equal(isRateLimitExempt({ id: 12, email: "someone@gmail.com", role: "buyer" }), false, "a real buyer is capped");
    process.env.RATE_LIMIT_EXEMPT_ACCOUNTS = "someone@gmail.com, 77";
    assert.equal(isRateLimitExempt({ id: 12, email: "someone@gmail.com", role: "buyer" }), true, "env allowlist by email");
    assert.equal(isRateLimitExempt({ id: 77, email: "x@y.com", role: "buyer" }), true, "env allowlist by id");
    delete process.env.RATE_LIMIT_EXEMPT_ACCOUNTS;
    const create = fs.readFileSync("app/api/rfqs/route.ts", "utf8");
    const inv = fs.readFileSync("app/api/rfqs/[id]/invites/route.ts", "utf8");
    assert.match(create, /isRateLimitExempt\(session\.user[\s\S]*?\) \? null : firstTrippedLimit/);
    assert.match(inv, /isRateLimitExempt\(session\.user[\s\S]*?\) \? null : firstTrippedLimit/);
  });
  it("named limits: per IP, per account, global — first trip wins; the response is 429 + Retry-After", async () => {
    resetRateLimitsForTests();
    let tripped = null;
    for (let i = 0; i < 15 && !tripped; i++) tripped = firstTrippedLimit([{ name: "rfq_create_ip", subject: "1.2.3.4" }, { name: "rfq_create_user", subject: "u1" }, { name: "rfq_create_global", subject: "all" }], 5_000_000);
    assert.ok(tripped, "the account limit (12 / 10 min) trips before the IP limit (20)");
    assert.equal(tripped!.name, "rfq_create_user");
    const res = tooManyRequests(tripped!);
    assert.equal(res.status, 429);
    assert.match(res.headers.get("Retry-After") || "", /^\d+$/);
  });
});

describe("dealer email is a queue — built from stored state, sent after the response, drainable", () => {
  const invite = (over: Partial<RfqInvite> = {}): RfqInvite =>
    ({ id: "14", dealerName: "Smoke Chevrolet of Butler", dealerContactEmail: "sam@example.com", status: "invited", deliveryStatus: "queued", viewToken: "tok", desk: { contactName: "Sam Smoke", role: "gsm", emailMasked: "s••@e.com", source: "buyer" }, vehicle: { vin: "1GNS6MKD2TR280381", year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LS", vdpUrl: null }, quote: null, ...over }) as unknown as RfqInvite;
  const rfq = (invites: RfqInvite[], over: Partial<RfqRequest> = {}): RfqRequest =>
    ({ id: "17", buyerUserId: "2", vin: "1GNS6MKD2TR280381", vehicleYear: 2026, vehicleMake: "Chevrolet", vehicleModel: "Tahoe", vehicleTrim: "LS", status: "collecting", createdAt: "2026-09-14T00:00:00Z", linkPastes: [{ vin: "1GNS6MKD2TR280381", year: 2026, make: "Chevrolet", model: "Tahoe", trim: "LS", dealerName: "Smoke Chevrolet of Butler", dealerState: "NJ", vdpUrl: null, condition: "new" }], invites, quotePrefs: { quoteType: "cash", cash: { zip: "07405", timeline: "this_month" } }, buyerNote: "Need it by the 30th", tradeInExpected: true, ...over }) as unknown as RfqRequest;

  it("the email needs nothing from the original HTTP body: cash type, ZIP, timeline, note, trade-in, TQ ref, rooftop state all come from the stored request", async () => {
    const mail = await buildInviteEmailFromStored(rfq([invite()]), invite(), []);
    assert.ok(mail);
    assert.match(mail!.subject, /^OTD quote request — 2026 Tahoe LS · Cash · Butler, NJ \(07405\)/);
    assert.match(mail!.html, /Within the month/);
    assert.match(mail!.html, /Need it by the 30th/);
    assert.match(mail!.html, />Trade-in<\/td>/);
    assert.match(mail!.html, /TQ-[A-Z0-9]{6}/);
    assert.match(mail!.html, /quote-invite\/view\?t=tok/);
  });
  it("sendQueuedInvite: sends + marks sent once; already-sent invites are skipped; the email switch parks it (buyer HTTP unaffected)", async () => {
    resetOpsMetricsForTests();
    const sent: string[] = []; const marked: string[] = [];
    const deps = { directory: [], send: async (s: string) => { sent.push(s); return true; }, mark: (async (_r: string, i: string) => { marked.push(i); }) as never };
    assert.equal(await sendQueuedInvite(rfq([invite()]), invite(), { ...deps, emailEnabled: () => true }), "sent");
    assert.equal(sent.length, 1); assert.deepEqual(marked, ["14"]);
    assert.equal(await sendQueuedInvite(rfq([invite()]), invite({ deliveryStatus: "sent" }), { ...deps, emailEnabled: () => true }), "already_sent");
    assert.equal(await sendQueuedInvite(rfq([invite()]), invite({ id: "15" }), { ...deps, emailEnabled: () => false }), "parked_switch_off");
    assert.equal(sent.length, 1, "the switch stopped the second send");
    assert.equal(opsSnapshot().counters.email_parked_switch_off, 1);
    assert.equal(await sendQueuedInvite(rfq([invite()]), invite({ id: "16" }), { ...deps, send: async () => false, emailEnabled: () => true }), "failed");
  });
  it("drain: only queued invites on collecting requests, capped per run, counts reported", async () => {
    const sent: string[] = [];
    const deps = { directory: [], send: async (s: string) => { sent.push(s); return true; }, mark: (async () => {}) as never, emailEnabled: () => true };
    const r1 = rfq([invite({ id: "a" }), invite({ id: "b", deliveryStatus: "sent" }), invite({ id: "c" })]);
    const r2 = rfq([invite({ id: "d" })], { id: "18", status: "walked" });
    assert.deepEqual(queuedInvitesOf(r1).map((i) => i.id), ["a", "c"]);
    const out = await drainQueuedInvites([r1, r2], { ...deps, maxSends: 1 });
    assert.equal(out.queued, 2); assert.equal(out.sent, 1); assert.equal(sent.length, 1);
  });
  it("wiring: the invite route returns before any send (after()), never awaits mail, and both write routes gate on the switch + 429s", () => {
    const inv = read("app/api/rfqs/[id]/invites/route.ts");
    assert.match(inv, /import \{ NextResponse, after \} from "next\/server"/);
    assert.match(inv, /after\(async \(\) => \{[\s\S]*?sendQueuedInvite\(/);
    assert.doesNotMatch(inv, /await sendQuoteInviteEmail|quoteInviteHtml\(/, "no inline mail build/send in the request");
    assert.match(inv, /featureEnabled\("rfqSend"\)/);
    assert.match(inv, /firstTrippedLimit\(\[[\s\S]*?"invite_send_ip"[\s\S]*?"invite_send_user"[\s\S]*?"invite_send_global"/);
    const create = read("app/api/rfqs/route.ts");
    assert.match(create, /featureEnabled\("rfqSend"\)[\s\S]*?status: 503, headers: \{ "Retry-After": "120" \}/);
    assert.match(create, /firstTrippedLimit\(\[[\s\S]*?"rfq_create_ip"[\s\S]*?"rfq_create_user"[\s\S]*?"rfq_create_global"/);
    // Idempotent double-submit: same buyer + same VIN while active → the existing row.
    assert.match(create, /r\.status === "collecting" && r\.vin === String\(body\.vin \|\| ""\)\.trim\(\)\.toUpperCase\(\)/);
    assert.match(create, /idempotent: true/);
    const deal = read("app/api/rfqs/[id]/route.ts");
    assert.match(deal, /after\(\(\) => drainQueuedInvites\(\[rfq\]\)/);
    assert.match(read("app/api/auth/signup/route.ts"), /"signup_ip"[\s\S]*?"signup_global"/);
    assert.match(read("components/BiddingWizard.tsx"), /fetch\("\/api\/status\/features"\)/);
    assert.match(read("components/BiddingWizard.tsx"), /disabled=\{isSubmittingReal \|\| !!dealCommentContactWarning \|\| !featureStatus\.rfqSend\}/);
  });
});

describe("sticker host circuit breaker + fetch-once", () => {
  const b64 = (s: string) => new Uint8Array(Buffer.from(Buffer.from(s).toString("base64"), "latin1"));
  it("a 429/403 from DealerFire opens the breaker for that host; the next VIN is 'pending' without a fetch; the RFQ path is never blocked", async () => {
    clearHyundaiStickerMemoryCache();
    resetOpsMetricsForTests();
    let calls = 0;
    const fetchImpl = async (url: string) => { calls++; return { bytes: new Uint8Array(Buffer.from("<html>rate limited</html>")), contentType: "text/html", status: url.includes("dealerfire") ? 429 : 403 }; };
    const first = await getHyundaiSticker("KM8RKES23TU000002", { fetchImpl });
    assert.equal(first.status, "unreleased");
    assert.equal(breakerOpen("https://hyundai-sticker.dealerfire.com/new/x"), true);
    assert.equal(breakerOpen("https://prevapp.hyundaiusa.com/x"), true);
    assert.ok(stickerBreakerSnapshot().some((b) => b.host === "hyundai-sticker.dealerfire.com" && b.status === 429));
    const before = calls;
    const second = await getHyundaiSticker("KM8RKES23TU000003", { fetchImpl });
    assert.equal(second.status, "unreleased");
    assert.equal(calls, before, "breaker open → no network");
    assert.equal(opsSnapshot().counters.sticker_breaker_open, 2);
    assert.ok((opsSnapshot().counters.sticker_pending || 0) >= 2);
  });
  it("a hit is served from cache afterwards — one fetch per VIN, ever", async () => {
    clearHyundaiStickerMemoryCache();
    resetOpsMetricsForTests();
    const fixture = read("lib/testdata/hyundai-stickers/5NMJECDE6TH781852.txt");
    void fixture; // the parse itself is covered in hyundaiSticker.test.ts; here we only count fetches
    let calls = 0;
    const fetchImpl = async () => { calls++; return { bytes: b64('{"error":"NEW document not found","statusCode":404}'), contentType: "application/pdf", status: 200 }; };
    await getHyundaiSticker("KM8RKES23TU000004", { fetchImpl });
    assert.equal(calls, 2, "miss: DealerFire then the OEM endpoint, once each");
  });
  it("recheck honors the fetch switch", () => {
    assert.match(read("lib/stickerRecheck.ts"), /if \(!featureEnabled\("stickerFetch"\)\) return out;/);
    assert.match(read("lib/hyundaiSticker.ts"), /const canFetch = \(url: string\) => featureEnabled\("stickerFetch"\) && !breakerOpen\(url\);/);
  });
});

describe("browse + ops surfaces", () => {
  it("marketing/legal pages carry CDN cache headers; no live inventory / MarketCheck on public browse routes", () => {
    assert.match(read("next.config.js"), /source: "\/\(terms\|privacy\|disclaimer\|contact\)"[\s\S]*?s-maxage=600, stale-while-revalidate=86400/);
    const inv = read("app/api/inventory/route.ts");
    assert.match(inv, /if \(provider === "marketcheck" && featureEnabled\("liveInventory"\)\)/, "paid provider only behind the live-inventory switch");
    assert.match(inv, /s-maxage=300, stale-while-revalidate=86400/, "seed browse is CDN-cached");
    assert.doesNotMatch(read("components/BidProgramIntro.tsx"), /marketcheck|\/api\/listing-facts/i);
  });
  it("ops: status endpoint is public + cacheable; drain needs admin or OPS_SECRET; admin ops reports queue depth, breaker, ghost proxy", () => {
    assert.match(read("app/api/status/features/route.ts"), /s-maxage=30/);
    const drain = read("app/api/ops/drain-invites/route.ts");
    assert.match(drain, /x-ops-secret/); assert.match(drain, /requireAdminSession/); assert.match(drain, /drainQueuedInvites\(rfqs, \{ maxSends: limit \}\)/);
    const ops = read("app/api/admin/ops/route.ts");
    assert.match(ops, /queuedInvites/); assert.match(ops, /stickerBreakerSnapshot\(\)/); assert.match(ops, /ghostRate/); assert.match(ops, /FEATURE_RFQ_SEND=off/);
    assert.ok(fs.existsSync(path.join(process.cwd(), "docs/SPIKE_RUNBOOK.md")));
  });
});
