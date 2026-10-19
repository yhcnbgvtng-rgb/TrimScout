import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPublicHttpUrl, hostAllowed, isPrivateOrReservedIp, safeFetch, UnsafeUrlError } from "./safeUrl";

const PUBLIC = async () => [{ address: "93.184.216.34" }];
const refuses = (p: Promise<unknown>) => assert.rejects(p, UnsafeUrlError);

describe("isPrivateOrReservedIp", () => {
  it("blocks private, loopback, link-local, CGNAT, multicast and reserved IPv4", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "100.127.255.255", "198.18.0.1", "192.0.0.5", "224.0.0.1", "255.255.255.255"]) {
      assert.equal(isPrivateOrReservedIp(ip), true, ip);
    }
  });
  it("allows ordinary public IPv4, including addresses next to blocked ranges", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1", "11.0.0.1"]) {
      assert.equal(isPrivateOrReservedIp(ip), false, ip);
    }
  });
  it("blocks IPv6 loopback, unspecified, ULA, link-local, multicast, NAT64 and 6to4", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "fec0::1", "ff02::1", "64:ff9b::a00:1", "2002:c0a8:101::1", "[::1]"]) {
      assert.equal(isPrivateOrReservedIp(ip), true, ip);
    }
  });
  it("sees through IPv4-mapped IPv6 in dotted and hex forms", () => {
    for (const ip of ["::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:192.168.1.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "::ffff:a9fe:a9fe"]) {
      assert.equal(isPrivateOrReservedIp(ip), true, ip);
    }
    assert.equal(isPrivateOrReservedIp("::ffff:5db8:d822"), false); // 93.184.216.34
  });
  it("allows ordinary public IPv6", () => {
    assert.equal(isPrivateOrReservedIp("2606:2800:220:1:248:1893:25c8:1946"), false);
  });
  it("treats anything that isn't an IP as unsafe", () => {
    assert.equal(isPrivateOrReservedIp("not-an-ip"), true);
  });
});

describe("assertPublicHttpUrl", () => {
  it("accepts a public http/https URL that resolves publicly", async () => {
    const u = await assertPublicHttpUrl("https://dealer.example.com/inventory", { lookup: PUBLIC });
    assert.equal(u.hostname, "dealer.example.com");
    await assertPublicHttpUrl("http://dealer.example.com/", { lookup: PUBLIC });
  });
  it("refuses every non-http(s) scheme", async () => {
    for (const u of ["file:///etc/passwd", "ftp://example.com/", "gopher://example.com/", "javascript:alert(1)", "data:text/plain,hi", "ws://example.com/"]) {
      await refuses(assertPublicHttpUrl(u, { lookup: PUBLIC }));
    }
  });
  it("refuses localhost, internal names and IP literals (decimal/hex/octal spellings normalise to IPs)", async () => {
    for (const u of [
      "http://localhost/", "http://foo.localhost/", "http://box.local/", "http://db.internal/",
      "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/",
      "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://[::ffff:127.0.0.1]/", "http://10.0.0.5/",
    ]) {
      await refuses(assertPublicHttpUrl(u, { lookup: PUBLIC }));
    }
  });
  it("refuses a public-looking name that resolves to a private address, and one with ANY private answer", async () => {
    await refuses(assertPublicHttpUrl("https://evil.example.com/", { lookup: async () => [{ address: "127.0.0.1" }] }));
    await refuses(assertPublicHttpUrl("https://evil.example.com/", { lookup: async () => [{ address: "93.184.216.34" }, { address: "169.254.169.254" }] }));
    await refuses(assertPublicHttpUrl("https://evil.example.com/", { lookup: async () => [{ address: "::1" }] }));
  });
  it("refuses unresolvable names, empty answers, credentials in the URL and non-default ports", async () => {
    await refuses(assertPublicHttpUrl("https://nx.example.com/", { lookup: async () => { throw new Error("ENOTFOUND"); } }));
    await refuses(assertPublicHttpUrl("https://empty.example.com/", { lookup: async () => [] }));
    await refuses(assertPublicHttpUrl("https://user:pw@dealer.example.com/", { lookup: PUBLIC }));
    await refuses(assertPublicHttpUrl("https://dealer.example.com:6379/", { lookup: PUBLIC }));
    await refuses(assertPublicHttpUrl("http://dealer.example.com:3003/", { lookup: PUBLIC }));
    await assertPublicHttpUrl("https://dealer.example.com:443/", { lookup: PUBLIC });
  });
  it("enforces a host allowlist (exact or subdomain, never a suffix lookalike)", async () => {
    const allowedHosts = ["forddirect.com"];
    await assertPublicHttpUrl("https://www.windowsticker.forddirect.com/x.pdf", { lookup: PUBLIC, allowedHosts });
    await refuses(assertPublicHttpUrl("https://evilforddirect.com/", { lookup: PUBLIC, allowedHosts }));
    await refuses(assertPublicHttpUrl("https://forddirect.com.evil.net/", { lookup: PUBLIC, allowedHosts }));
    assert.equal(hostAllowed("forddirect.com", allowedHosts), true);
  });
  it("rejects garbage input", async () => {
    await refuses(assertPublicHttpUrl("not a url", { lookup: PUBLIC }));
  });
});

describe("safeFetch — redirects are re-checked on every hop", () => {
  const redirecting = (map: Record<string, { status: number; location?: string }>, calls: string[]) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      assert.equal(init?.redirect, "manual", "fetch must never follow redirects itself");
      const hop = map[url] || { status: 200 };
      return new Response("ok", { status: hop.status, headers: hop.location ? { location: hop.location } : {} });
    }) as typeof fetch;

  it("follows a public → public redirect", async () => {
    const calls: string[] = [];
    const res = await safeFetch("https://a.example.com/", {}, { lookup: PUBLIC, fetchImpl: redirecting({ "https://a.example.com/": { status: 302, location: "https://b.example.com/x" } }, calls) });
    assert.equal(res.status, 200);
    assert.deepEqual(calls, ["https://a.example.com/", "https://b.example.com/x"]);
  });
  it("stops a public → cloud-metadata redirect before requesting it", async () => {
    const calls: string[] = [];
    await refuses(safeFetch("https://a.example.com/", {}, { lookup: PUBLIC, fetchImpl: redirecting({ "https://a.example.com/": { status: 302, location: "http://169.254.169.254/latest/meta-data/" } }, calls) }));
    assert.deepEqual(calls, ["https://a.example.com/"]);
  });
  it("stops redirects to localhost, to a file: URL and to a name that resolves privately", async () => {
    for (const location of ["http://localhost/admin", "file:///etc/passwd", "https://rebind.example.com/"]) {
      const calls: string[] = [];
      const lookup = async (h: string) => [{ address: h === "rebind.example.com" ? "10.0.0.9" : "93.184.216.34" }];
      await refuses(safeFetch("https://a.example.com/", {}, { lookup, fetchImpl: redirecting({ "https://a.example.com/": { status: 301, location } }, calls) }));
      assert.equal(calls.length, 1, location);
    }
  });
  it("caps redirect loops", async () => {
    const calls: string[] = [];
    await refuses(safeFetch("https://a.example.com/", {}, { lookup: PUBLIC, maxHops: 3, fetchImpl: redirecting({ "https://a.example.com/": { status: 302, location: "https://a.example.com/" } }, calls) }));
    assert.equal(calls.length, 4);
  });
  it("never sends a request for an unsafe starting URL", async () => {
    const calls: string[] = [];
    await refuses(safeFetch("http://127.0.0.1:8080/", {}, { lookup: PUBLIC, fetchImpl: redirecting({}, calls) }));
    assert.equal(calls.length, 0);
  });
});
