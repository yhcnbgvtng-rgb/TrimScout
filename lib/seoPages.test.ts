import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { PUBLIC_PAGES, DISALLOWED_PATHS, pageMetadata } from "./seoPages";

describe("SEO basics", () => {
  it("every public page has its own title and description, within search-result lengths", () => {
    const titles = PUBLIC_PAGES.map((p) => p.title);
    const descs = PUBLIC_PAGES.map((p) => p.description);
    assert.equal(new Set(titles).size, titles.length, "duplicate title");
    assert.equal(new Set(descs).size, descs.length, "duplicate description");
    for (const p of PUBLIC_PAGES) {
      assert.ok(p.title.length >= 10 && p.title.length <= 70, `${p.path} title length ${p.title.length}`);
      assert.ok(p.description.length >= 50 && p.description.length <= 170, `${p.path} description length ${p.description.length}`);
    }
  });

  it("every public page except the home page has a layout exporting its own metadata", () => {
    for (const p of PUBLIC_PAGES.filter((x) => x.path !== "/")) {
      const src = fs.readFileSync(path.join(process.cwd(), "app", p.path, "layout.tsx"), "utf8");
      assert.match(src, new RegExp(`pageMetadata\\("${p.path}"\\)`));
      assert.equal(pageMetadata(p.path).title, p.title);
    }
  });

  it("sitemap lists exactly the public pages as absolute URLs, and nothing private", () => {
    const urls = sitemap().map((s) => s.url);
    assert.equal(urls.length, PUBLIC_PAGES.length);
    assert.ok(urls.includes("https://www.trimscout.com"));
    assert.ok(urls.includes("https://www.trimscout.com/search"));
    for (const u of urls) for (const bad of DISALLOWED_PATHS) assert.ok(!new URL(u).pathname.startsWith(`${bad}/`) && new URL(u).pathname !== bad, `${u} is private`);
  });

  it("robots.txt points at the sitemap and disallows admin, api, dealer and buyer-private paths", () => {
    const r = robots();
    assert.equal(r.sitemap, "https://www.trimscout.com/sitemap.xml");
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    const dis = ([] as string[]).concat(rule.disallow ?? []);
    for (const p of ["/admin", "/api", "/rfq", "/d", "/trade", "/quote-request"]) assert.ok(dis.includes(p) && dis.includes(`${p}/`), p);
    assert.ok(!dis.includes("/search") && !dis.includes("/"));
  });

  it("every disallowed path really is an app route that is not in the public list", () => {
    for (const p of DISALLOWED_PATHS) assert.ok(fs.existsSync(path.join(process.cwd(), "app", p)), `${p} has no app dir`);
  });
});
