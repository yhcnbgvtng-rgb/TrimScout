import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { publicRfqForBuyer } from "./rfq";
import type { RfqRequest } from "./rfq";

const rfq: RfqRequest = {
  id: "1", buyerUserId: "b", status: "collecting", pickedQuoteId: null, createdAt: "2026-09-13T00:00:00Z",
  vin: "1GTEST00000000009", stockNumber: null, vehicleYear: 2026, vehicleMake: "Chevrolet", vehicleModel: "Tahoe", vehicleTrim: "LS", mustHaves: [],
  invites: [{ id: "i1", dealerName: "Desk", dealerContactEmail: "jim@dealer.com", status: "invited", declineReason: null, invitedAt: "2026-09-13T00:00:00Z", respondedAt: null, quote: null, viewToken: "tok_abcdefghij", desk: { contactName: "Jim", role: "gsm", emailMasked: "j•••@dealer.com", source: "directory" } }],
};

describe("buyer-facing RFQ responses never carry a dealer's cleartext address or the tracked-link token", () => {
  it("publicRfqForBuyer strips dealerContactEmail and viewToken, keeps the masked desk", () => {
    const out = publicRfqForBuyer(rfq);
    assert.equal(out.invites[0].dealerContactEmail, null);
    assert.equal("viewToken" in out.invites[0], false);
    assert.equal(out.invites[0].desk?.emailMasked, "j•••@dealer.com");
    assert.equal(rfq.invites[0].viewToken, "tok_abcdefghij", "input untouched");
  });

  it("every buyer route that returns an rfq goes through it; only the admin route builds calculator links", () => {
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
    for (const f of ["app/api/rfqs/route.ts", "app/api/rfqs/[id]/route.ts", "app/api/rfqs/[id]/lease-prefs/route.ts", "app/api/rfqs/[id]/pick/route.ts", "app/api/rfqs/[id]/walk/route.ts", "app/api/rfqs/[id]/invites/[inviteId]/quotes/route.ts"]) {
      const src = read(f);
      assert.doesNotMatch(src, /NextResponse\.json\(\{ rfq \}\)/, `${f} returns a raw rfq`);
      assert.doesNotMatch(src, /NextResponse\.json\(\{ rfqs \}\)/, `${f} returns raw rfqs`);
      assert.match(src, /publicRfqForBuyer/, f);
    }
    const admin = read("app/api/admin/rfqs/route.ts");
    assert.match(admin, /requireAdminSession\(\)/);
    assert.match(admin, /calculatorUrl: viewToken \? `\/quote-request\/received\?t=\$\{encodeURIComponent\(viewToken\)\}` : null/);
    assert.match(admin, /invites\.map\(\(\{ viewToken, \.\.\.rest \}\)/, "the raw token itself is not returned");
  });

  it("the master desk lists every buyer's requests (box all=1), and an admin can open any deal read-only", () => {
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
    assert.match(read("lib/rfqApi.ts"), /\/api\/rfqs\?all=1&limit=/);
    assert.match(read("scrapers/lightsail-crawler/src/deals_api_server.js"), /const all = query\.get\("all"\) === "1";[\s\S]*?ORDER BY created_at DESC LIMIT \?/);
    assert.match(read("scripts/box/2026-09-13-admin-rfq-list.sh"), /"list all"/);
    assert.match(read("app/api/rfqs/[id]/route.ts"), /const isAdmin = \(session\.user as \{ role\?: string \}\)\.role === "admin";[\s\S]*?!== session\.user\.id && !isAdmin/);
    const page = read("app/admin/quote-requests/QuoteRequestsClient.tsx");
    assert.match(page, /Quote as dealer/);
    assert.match(page, /marks the invite viewed and locks the buyer/);
    assert.match(read("app/admin/quote-requests/page.tsx"), /role !== "admin"\) redirect\("\/"\)/);
    assert.match(read("app/admin/AdminClient.tsx"), /href="\/admin\/quote-requests"/);
  });
});
