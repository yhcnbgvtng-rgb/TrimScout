import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveHostRedirect } from "./hostRedirect";

function redirectingFetch(map: Record<string, { status: number; location?: string }>, calls: string[] = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method || "GET"} ${url}`);
    const hop = map[url] || { status: 200 };
    return new Response(null, { status: hop.status, headers: hop.location ? { location: hop.location } : {} });
  }) as typeof fetch;
}

// Hostnames here must resolve publicly for the SSRF guard; example.com does.
describe("resolveHostRedirect", () => {
  it("follows the origin's redirect chain with HEAD only and reports the final registrable host", async () => {
    const calls: string[] = [];
    const impl = redirectingFetch(
      {
        "https://www.example.com/": { status: 301, location: "http://www.example.org/" },
        "http://www.example.org/": { status: 302, location: "https://www.example.org/home" },
      },
      calls
    );
    const r = await resolveHostRedirect("www.example.com", impl);
    assert.equal(r.finalRegistrable, "example.org");
    assert.deepEqual(r.chain, ["example.com", "example.org"]);
    assert.ok(calls.every((c) => c.startsWith("HEAD ")), "never GETs a page");
    assert.ok(calls.every((c) => /^HEAD https?:\/\/[^/]+\/(home)?$/.test(c)), "only ever asks the origin");
  });

  it("reports null when the site does not redirect off its domain", async () => {
    const r = await resolveHostRedirect("example.com", redirectingFetch({ "https://example.com/": { status: 200 } }));
    assert.equal(r.finalRegistrable, null);
    assert.deepEqual(r.chain, ["example.com"]);
  });

  it("stops on a redirect loop and on the hop cap", async () => {
    const loop = redirectingFetch({
      "https://example.com/": { status: 301, location: "https://example.org/" },
      "https://example.org/": { status: 301, location: "https://example.com/" },
    });
    const r = await resolveHostRedirect("example.com", loop);
    assert.deepEqual(r.chain, ["example.com", "example.org"]);
  });

  it("treats a fetch failure (Cloudflare, timeout) as no redirect rather than an error", async () => {
    const failing = (async () => {
      throw new Error("blocked");
    }) as typeof fetch;
    const r = await resolveHostRedirect("example.com", failing);
    assert.equal(r.finalRegistrable, null);
  });

  it("refuses non-public hosts before any request", async () => {
    const calls: string[] = [];
    const r = await resolveHostRedirect("localhost", redirectingFetch({}, calls));
    assert.equal(calls.length, 0);
    assert.equal(r.finalRegistrable, null);
  });
});

describe("resolveHostRedirect — apex without TLS", () => {
  it("falls back to www. when the apex origin does not answer, and still finds the redirect", async () => {
    const calls: string[] = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method} ${url}`);
      if (url === "https://example.com/") throw new Error("ECONNRESET: no TLS on the apex");
      if (url === "https://www.example.com/") return new Response(null, { status: 301, headers: { location: "http://www.example.org/" } });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const r = await resolveHostRedirect("example.com", impl);
    assert.equal(r.finalRegistrable, "example.org");
    assert.deepEqual(r.chain, ["example.com", "example.org"]);
    assert.deepEqual(calls.slice(0, 2), ["HEAD https://example.com/", "HEAD https://www.example.com/"]);
  });

  it("gives up cleanly when no spelling of the origin answers", async () => {
    const impl = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    const r = await resolveHostRedirect("example.com", impl);
    assert.deepEqual(r, { finalRegistrable: null, chain: ["example.com"] });
  });
});
