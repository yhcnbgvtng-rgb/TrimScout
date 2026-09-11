import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractDealerIdentity, isBlockPage, EMPTY_DEALER_IDENTITY } from "./dealerPageIdentity";

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

describe("bot-shield and error pages", () => {
  // The exact page a buyer was shown as their "dealership" on 2026-09-10.
  const CLOUDFLARE_CHALLENGE = `<!DOCTYPE html><html><head>
    <title>Attention Required! | Cloudflare</title>
    <meta property="og:site_name" content="Cloudflare">
    </head><body><div id="cf-wrapper">Please complete the security check to access www.example-bmw.com</div>
    <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script></body></html>`;

  it("never turns a Cloudflare challenge into a dealership", () => {
    assert.equal(isBlockPage(CLOUDFLARE_CHALLENGE), true);
    assert.deepEqual(extractDealerIdentity(CLOUDFLARE_CHALLENGE), EMPTY_DEALER_IDENTITY);
  });

  it("recognises the other common shields and error pages", () => {
    for (const html of [
      `<title>Just a moment...</title>`,
      `<title>Access Denied</title><p>You don't have permission to access this resource.</p>`,
      `<html><body>Reference #18.4f2a1b3c.1694000000.abc123 errors.edgesuite.net</body></html>`,
      `<title>403 Forbidden</title>`,
      `<script src="https://client.px-cloud.net/PX1234/main.min.js"></script><div id="px-captcha"></div>`,
      `<script src="https://ct.captcha-delivery.com/c.js"></script>`,
      `<title>Request blocked</title>`,
    ]) {
      assert.equal(isBlockPage(html), true, html.slice(0, 60));
    }
  });

  it("treats a 403, 429 or 503 as blocked regardless of body", () => {
    assert.equal(isBlockPage("<title>BMW of Manhattan</title>", 403), true);
    assert.equal(isBlockPage("<title>BMW of Manhattan</title>", 429), true);
    assert.equal(isBlockPage("<title>BMW of Manhattan</title>", 503), true);
    assert.equal(isBlockPage("<title>BMW of Manhattan</title>", 200), false);
  });

  it("does not flag an ordinary listing page", () => {
    const html = `<title>2026 BMW X5 xDrive40i | BMW of Manhattan</title>
      <script type="application/ld+json">{"@type":"AutoDealer","name":"BMW of Manhattan"}</script>
      <p>Stock #B12345. Contact us for a security check on financing.</p>`;
    assert.equal(isBlockPage(html, 200), false);
    assert.equal(extractDealerIdentity(html, 200).name, "BMW of Manhattan");
  });

  it("refuses shield-flavoured names even when block detection is bypassed", () => {
    // Defence in depth: a name that reads as an error page is never a dealer.
    for (const name of [
      "Attention Required! | Cloudflare",
      "Access Denied",
      "Just a moment",
      "Error 1020",
      "Security Check",
    ]) {
      const html = `<meta property="og:site_name" content="${name}">`;
      assert.equal(extractDealerIdentity(html).name, null, name);
    }
  });
});

describe("extractDealerIdentity — template conventions", () => {
  // Real markup from loubachrodtbmw.com (2026-09-10), which has JSON-LD for the
  // vehicle but no seller node, an og:site_name-free head, and a title that
  // leads with the model year.
  const BACHRODT = `<title>2026 BMW X3 30 xDrive Rockford IL | Janesville Beloit Belvidere Illinois 5UX53GP01T9190742</title>
    <meta name="description" content="Research the 2026 BMW X3 30 xDrive in Rockford, IL at Bachrodt BMW. View pictures, specs, and pricing on our huge selection of vehicles. 5UX53GP01T9190742">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Vehicle","name":"2026 BMW X3 30 xDrive","manufacturer":{"name":"BMW","@type":"Organization"},"vehicleIdentificationNumber":"5UX53GP01T9190742"}</script>
    <img class="img-responsive" src="/static/dealer-10851/logo.png" title="Bachrodt BMW" alt="Bachrodt BMW Rockford, IL">
    <li class="dealerName"><h3><span class="hidden-sm">Welcome to</span> Bachrodt BMW</h3></li>`;

  it("reads the rooftop from a dealerName element and borrows city/state from the logo", () => {
    const identity = extractDealerIdentity(BACHRODT, 200);
    assert.equal(identity.name, "Bachrodt BMW");
    assert.equal(identity.source, "dealer_name_element");
    assert.equal(identity.city, "Rockford");
    assert.equal(identity.state, "IL");
  });

  it("does not report the manufacturer Organization as the dealer", () => {
    // The Vehicle's manufacturer is an Organization named "BMW". Without the
    // dealerName element it must fall through, never return "BMW".
    const html = `<script type="application/ld+json">{"@type":"Vehicle","manufacturer":{"@type":"Organization","name":"BMW"}}</script>`;
    assert.equal(extractDealerIdentity(html).name, null);
  });

  it("still accepts an Organization reached through the seller relation", () => {
    const html = `<script type="application/ld+json">{"@type":"Vehicle","offers":{"@type":"Offer","seller":{"@type":"Organization","name":"Open Road BMW"}}}</script>`;
    assert.equal(extractDealerIdentity(html).name, "Open Road BMW");
  });

  it("falls back to the logo alt, keeping the whole name when it can't be split from the city", () => {
    // "Prestige Volvo Cars East Hanover" may genuinely be the dealer's name —
    // there's no safe place to cut it. Only the ", NJ" is certain.
    const html = `<img src="/img/site-logo.png" alt="Prestige Volvo Cars East Hanover, NJ">`;
    const identity = extractDealerIdentity(html);
    assert.equal(identity.name, "Prestige Volvo Cars East Hanover");
    assert.equal(identity.city, null);
    assert.equal(identity.state, "NJ");
    assert.equal(identity.source, "logo");
  });

  it("splits city and state off a logo alt when the title names the dealer", () => {
    const html = `<img src="/static/dealer-1/logo.png" title="Bachrodt BMW" alt="Bachrodt BMW Rockford, IL">`;
    const identity = extractDealerIdentity(html);
    assert.equal(identity.name, "Bachrodt BMW");
    assert.equal(identity.city, "Rockford");
    assert.equal(identity.state, "IL");
  });

  it("falls back to the meta description's 'at <dealer>' phrasing", () => {
    const html = `<meta property="og:description" content="Check out this 2026 Toyota RAV4 XLE in Hartford, CT at Hoffman Toyota. Call today.">`;
    const identity = extractDealerIdentity(html);
    assert.equal(identity.name, "Hoffman Toyota");
    assert.equal(identity.city, "Hartford");
    assert.equal(identity.state, "CT");
    assert.equal(identity.source, "meta_description");
  });

  it("ignores logo images that are not the site logo", () => {
    const html = `<img src="/img/bmw-brand.png" alt="BMW">`;
    assert.equal(extractDealerIdentity(html).name, null);
  });
});
