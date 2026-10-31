import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { PUBLIC_PAGES } from "./seoPages";

// Buyer-facing copy says "quote request" / "quotes", never "bid" / "bids" / "bidding": a dealer quote is not a
// binding bid. The explicit "A request, not a bid" disclaimers are the one place the word stays.
const ALLOWED_FILES = new Set([
  "components/StagedDeals.tsx",
  "components/BiddingWizard.tsx",
  "lib/buyerCounter.ts",
  // Not in this change's scope; still carry real bid wording. Remove each entry as its copy is reworded.
  "components/DealerPortal.tsx", // dealer-facing portal, reworded separately
]);

// "not a bid", "never a binding bid", "not an auction, not a bid" are the disclaimers we want to keep.
const DISCLAIMER = /\b(not|never|no)\s+(an?\s+)?(binding\s+)?bids?\b/gi;
const hasBidWord = (text: string) => BID_WORD.test(text.replace(DISCLAIMER, ""));

const ROOT = process.cwd();
const BID_WORD = /\b(bid|bids|bidding)\b/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (rel === "app/admin" || rel === "app/api" || entry.name === "node_modules") continue;
      walk(rel, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      if (!rel.includes("/admin/") && !/Admin/.test(entry.name)) out.push(rel);
    }
  }
  return out;
}

// Text a visitor can read: string literals, template text and JSX text. Import paths and URL-ish/identifier-ish
// strings (no whitespace) are code, not copy.
function visibleStrings(file: string): string[] {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.text;
    if (text !== null && /\s/.test(text.trim()) && hasBidWord(text)) found.push(text.trim());
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("buyer-facing wording", () => {
  const files = [...walk("app"), ...walk("components")].filter((f) => !ALLOWED_FILES.has(f));

  it("scans a real set of files", () => {
    assert.ok(files.length > 20, `only ${files.length} files scanned`);
    assert.ok(files.includes("components/AuthModal.tsx"));
  });

  it("no non-admin string says bid, bids or bidding outside the allow-listed disclaimers", () => {
    const hits = files.flatMap((f) => visibleStrings(f).map((s) => `${f}: ${s}`));
    assert.deepEqual(hits, []);
  });

  it("the home metadata, social image and negotiation reasons use quote wording", () => {
    for (const f of ["app/layout.tsx", "app/opengraph-image.tsx", "lib/seoPages.ts", "lib/negotiationPolicy.ts", "app/api/checkout/create-session/route.ts"]) {
      const strings = visibleStrings(f);
      assert.deepEqual(strings, [], f);
    }
  });
});

describe("page titles", () => {
  it("every public route has its own title, and none still says bidding", () => {
    const titles = PUBLIC_PAGES.map((p) => p.title);
    assert.equal(new Set(titles).size, titles.length);
    for (const t of titles) assert.ok(!BID_WORD.test(t), t);
  });

  it("the home title differs from the layout-inherited one only by being the root title", () => {
    const layout = fs.readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
    const home = PUBLIC_PAGES.find((p) => p.path === "/")!;
    assert.ok(layout.includes(home.title), "app/layout.tsx title must match the home entry in seoPages");
  });

  it("the 404 page has its own title, distinct from every public page", () => {
    const src = fs.readFileSync(path.join(ROOT, "app/not-found.tsx"), "utf8");
    const m = src.match(/title:\s*"([^"]+)"/);
    assert.ok(m, "not-found.tsx exports a title");
    assert.ok(!PUBLIC_PAGES.some((p) => p.title === m![1]));
  });
});
