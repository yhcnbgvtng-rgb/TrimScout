import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractDealerIdentity, EMPTY_DEALER_IDENTITY } from "./dealerPageIdentity";

function ldBlock(json: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(json)}</script>`;
}

describe("extractDealerIdentity — JSON-LD", () => {
  it("reads an AutoDealer node with its full address", () => {
    const html = ldBlock({
      "@context": "https://schema.org",
      "@type": "AutoDealer",
      name: "BMW of Manhattan",
      address: {
        "@type": "PostalAddress",
        addressLocality: "New York",
        addressRegion: "ny",
        postalCode: "10019",
      },
    });
    assert.deepEqual(extractDealerIdentity(html), {
      name: "BMW of Manhattan",
      city: "New York",
      state: "NY",
      zip: "10019",
      source: "json_ld",
    });
  });

  it("finds the seller hanging off a Vehicle's offers", () => {
    const html = ldBlock({
      "@type": "Vehicle",
      name: "2026 BMW 330i xDrive",
      offers: {
        "@type": "Offer",
        price: 52000,
        seller: { "@type": "AutoDealer", name: "Prestige BMW" },
      },
    });
    const identity = extractDealerIdentity(html);
    assert.equal(identity.name, "Prestige BMW");
    assert.equal(identity.source, "json_ld");
  });

  it("walks an @graph and handles an array-valued @type", () => {
    const html = ldBlock({
      "@graph": [
        { "@type": "WebSite", name: "Some Site" },
        { "@type": ["LocalBusiness", "AutoDealer"], name: "Ray Catena Volvo" },
      ],
    });
    assert.equal(extractDealerIdentity(html).name, "Ray Catena Volvo");
  });

  it("skips malformed JSON-LD instead of failing the whole paste", () => {
    const html =
      `<script type="application/ld+json">{ not valid json,,, }</script>` +
      ldBlock({ "@type": "AutoDealer", name: "Second Block Motors" });
    assert.equal(extractDealerIdentity(html).name, "Second Block Motors");
  });

  it("ignores a dealer-typed node with no usable name", () => {
    const html = ldBlock({ "@type": "AutoDealer", address: { addressRegion: "NJ" } });
    assert.equal(extractDealerIdentity(html).name, null);
  });
});

describe("extractDealerIdentity — meta and title fallbacks", () => {
  it("falls back to og:site_name, in either attribute order", () => {
    const a = `<meta property="og:site_name" content="Flemington Audi">`;
    const b = `<meta content="Flemington Audi" property="og:site_name">`;
    assert.equal(extractDealerIdentity(a).name, "Flemington Audi");
    assert.equal(extractDealerIdentity(a).source, "og_site_name");
    assert.equal(extractDealerIdentity(b).name, "Flemington Audi");
  });

  it("falls back to the title, trimming the marketing tail", () => {
    const html = `<title>Paul Miller Porsche | New and Used Porsche Dealer in Parsippany NJ</title>`;
    assert.equal(extractDealerIdentity(html).name, "Paul Miller Porsche");
    assert.equal(extractDealerIdentity(html).source, "title");
  });

  it("decodes the entities dealer names actually contain", () => {
    const html = `<meta property="og:site_name" content="Smith &amp; Sons Mazda">`;
    assert.equal(extractDealerIdentity(html).name, "Smith & Sons Mazda");
  });

  it("rejects a title that is really the car, not the seller", () => {
    const html = `<title>2026 BMW X5 xDrive40i for sale</title>`;
    assert.equal(extractDealerIdentity(html).name, null);
  });

  it("prefers JSON-LD over og:site_name when both are present", () => {
    const html =
      `<meta property="og:site_name" content="Cars For Sale Network">` +
      ldBlock({ "@type": "AutoDealer", name: "Open Road BMW" });
    const identity = extractDealerIdentity(html);
    assert.equal(identity.name, "Open Road BMW");
    assert.equal(identity.source, "json_ld");
  });
});

describe("extractDealerIdentity — nothing to find", () => {
  it("returns the empty identity rather than guessing", () => {
    assert.deepEqual(extractDealerIdentity(""), EMPTY_DEALER_IDENTITY);
    assert.deepEqual(extractDealerIdentity("<html><body>no dealer here</body></html>"), EMPTY_DEALER_IDENTITY);
  });

  it("rejects names too short or absurdly long to be real", () => {
    assert.equal(extractDealerIdentity(`<title>BM</title>`).name, null);
    assert.equal(extractDealerIdentity(`<title>${"x".repeat(200)}</title>`).name, null);
  });
});
