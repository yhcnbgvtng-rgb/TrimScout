import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { guestTrackerEmailSubject, guestTrackerEmailHtml } from "./guestTrackerEmail";
import { dealerHandoffText } from "./rfqLogic";
import { formatDealerResponsivenessLabel } from "./dealerResponsiveness";

const read = (f: string) => fs.readFileSync(f, "utf8");

describe("every title in an email or notice goes through vehicleTitle", () => {
  const sites = [
    "app/api/rfqs/[id]/invites/[inviteId]/stage/route.ts",
    "app/api/quote-invite/stage/route.ts",
    "app/api/quote-invite/accept-counter/route.ts",
    "app/api/quote-invite/used-quote/route.ts",
    "app/api/rfqs/[id]/trade-in/route.ts",
    "lib/inviteOutbox.ts",
    "lib/contactReveal.ts",
    "lib/trade/confirmFlow.ts",
    "lib/guestTrackerEmail.ts",
    "lib/rfqLogic.ts",
  ];
  for (const f of sites) {
    it(`${f} imports and uses vehicleTitle, with no hand-joined year/make/model/trim`, () => {
      const src = read(f);
      assert.match(src, /import \{ vehicleTitle \} from/);
      assert.match(src, /vehicleTitle\(/);
      assert.doesNotMatch(src, /\[[\w.]*[vV]ehicleYear, [\w.]*vehicleMake, [\w.]*vehicleModel, [\w.]*vehicleTrim\]\.filter/);
    });
  }

  const rfq = { vin: "5UX53GP01T9190742", vehicleYear: 2026, vehicleMake: "Ford", vehicleModel: "F-150 Raptor", vehicleTrim: "Raptor" };
  it("a model that already ends with the trim is not doubled in the guest tracker email", () => {
    assert.match(guestTrackerEmailSubject(rfq), /2026 Ford F-150 Raptor$/);
    assert.doesNotMatch(guestTrackerEmailHtml(rfq, "a@b.co", "https://x.test/t"), /Raptor Raptor/);
  });
  it("the dealer hand-off still says quote request, never bid", () => {
    const text = dealerHandoffText({ ...rfq, stockNumber: null, mustHaves: [] } as never);
    assert.match(text, /Request for a quote — 2026 Ford F-150 Raptor/);
    assert.match(text, /request for a quote/i);
  });
});

describe("the home page makes no inventory call", () => {
  it("app/page.tsx neither imports the inventory connector nor mentions /api/inventory", () => {
    const src = read("app/page.tsx");
    assert.doesNotMatch(src, /inventoryConnector|fetchLiveInventory|api\/inventory|MOCK_VEHICLES/);
  });
  it("/api/inventory no longer invents vehicles", () => {
    const src = read("app/api/inventory/route.ts");
    assert.doesNotMatch(src, /Factory Paint"\s*,\s*\n\s*interiorColor: "Premium Interior"|nhtsa_live_vin|VEHICLE_TEMPLATES|Math\.random/);
  });
});

describe("deleted files stay deleted and nothing imports them", () => {
  const files = ["components/LeaseQuoteFormat.tsx", "lib/enrichmentEngine.ts", "lib/scrapers/index.ts"];
  for (const f of files) it(`${f} is gone`, () => assert.equal(fs.existsSync(f), false));
  it("no source file imports them", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) return [];
      const p = `${d}/${e.name}`;
      return e.isDirectory() ? walk(p) : /\.(tsx?|mjs|js)$/.test(e.name) && !p.endsWith("p2Cleanup.test.ts") ? [p] : [];
    });
    const hits = [...walk("app"), ...walk("components"), ...walk("lib")].filter((f) => /LeaseQuoteFormat|enrichmentEngine|from "@\/lib\/scrapers"|from "\.\/index"/.test(read(f)) && !/lib\/scrapers\//.test(f.replace(/^lib\/scrapers\/[^/]+$/, "")));
    assert.deepEqual(hits, []);
  });
});

describe("responsiveness line", () => {
  it("is hidden when there is no history, never 'No response history yet'", () => {
    assert.equal(formatDealerResponsivenessLabel({ dealerName: "X", bidCount: 0, avgResponseHours: null }), null);
  });
});

describe("home copy and accessibility", () => {
  it("the stale 'curated, hand-verified' claim is gone and out-the-door is defined", () => {
    const intro = read("components/BidProgramIntro.tsx");
    assert.doesNotMatch(intro, /hand-verified|curated/i);
    assert.match(intro, /about 2 million/);
    assert.match(intro, /out-the-door quotes \(the total you pay, including tax and fees\)/);
    assert.match(read("lib/seedOptionsProvider.ts"), /SEED_SOURCE_LABEL = "Sample inventory/);
  });
  it("How It Works scrolls to a real section", () => {
    assert.match(read("components/BidProgramIntro.tsx"), /id="how-it-works"/);
    assert.match(read("components/Navbar.tsx"), /getElementById\("how-it-works"\)/);
  });
  it("header controls get a focus-visible outline and hint text a lighter gray", () => {
    const css = read("app/globals.css");
    assert.match(css, /header button:focus-visible[\s\S]*?outline: 2px solid/);
    assert.match(css, /\.text-ink-faint \{\s*color: #8b93a1/);
  });
});
