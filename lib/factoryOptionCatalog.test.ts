import "./testdata/blockLiveHttp";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { catalogIdFor, normalizeOptionKey, searchCatalog, upsertCatalogEntry, type FactoryOptionCatalogData } from "./factoryOptionCatalog";

describe("normalizeOptionKey / catalogIdFor", () => {
  it("is case- and punctuation-insensitive, so re-running the pipeline never creates a duplicate entry", () => {
    assert.equal(normalizeOptionKey("M Sport Package"), normalizeOptionKey("m sport package"));
    assert.equal(normalizeOptionKey("Trailer Tow Group—IV"), normalizeOptionKey("Trailer Tow Group IV"));
    assert.equal(catalogIdFor("M Sport Package"), catalogIdFor("M SPORT PACKAGE"));
  });
});

describe("upsertCatalogEntry", () => {
  it("a brand-new option name creates a new entry with itself as the sole alias", () => {
    const { catalog, id } = upsertCatalogEntry({}, { code: "AHQ", rawName: "Trailer Tow Group", kind: "package", make: "Jeep" });
    assert.deepEqual(catalog[id], { id, canonicalName: "Trailer Tow Group", aliases: ["Trailer Tow Group"], codes: ["AHQ"], makes: ["Jeep"], kind: "package" });
  });

  it("a differently-cased re-occurrence folds into the SAME entry as a new alias, never a duplicate", () => {
    const first = upsertCatalogEntry({}, { code: null, rawName: "M Sport Package", kind: "package", make: "BMW" });
    const second = upsertCatalogEntry(first.catalog, { code: null, rawName: "M SPORT PACKAGE", kind: "package", make: "BMW" });
    assert.equal(second.id, first.id);
    assert.equal(Object.keys(second.catalog).length, 1);
    assert.deepEqual(second.catalog[second.id].aliases, ["M Sport Package", "M SPORT PACKAGE"]);
  });

  it("a new code or make on a known entry is folded in without duplicating existing ones", () => {
    const first = upsertCatalogEntry({}, { code: "ZMP", rawName: "M Sport Package", kind: "package", make: "BMW" });
    const second = upsertCatalogEntry(first.catalog, { code: "ZMP", rawName: "M Sport Package", kind: "package", make: "BMW" });
    assert.deepEqual(second.catalog[second.id].codes, ["ZMP"]);
    const third = upsertCatalogEntry(second.catalog, { code: "2ZMP", rawName: "M Sport Package", kind: "package", make: "Mini" });
    assert.deepEqual(third.catalog[third.id].codes, ["ZMP", "2ZMP"]);
    assert.deepEqual(third.catalog[third.id].makes, ["BMW", "Mini"]);
  });
});

describe("searchCatalog", () => {
  function buildCatalog(): FactoryOptionCatalogData {
    let catalog: FactoryOptionCatalogData = {};
    catalog = upsertCatalogEntry(catalog, { code: "ZMP", rawName: "M Sport Package", kind: "package", make: "BMW" }).catalog;
    catalog = upsertCatalogEntry(catalog, { code: "AHQ", rawName: "Trailer Tow Group", kind: "package", make: "Jeep" }).catalog;
    catalog = upsertCatalogEntry(catalog, { code: null, rawName: "Sunroof", kind: "option", make: "Ford" }).catalog;
    return catalog;
  }

  it("matches by a substring of the canonical name or any alias, case-insensitive", () => {
    const catalog = buildCatalog();
    const results = searchCatalog(catalog, "sport");
    assert.equal(results.length, 1);
    assert.equal(results[0].canonicalName, "M Sport Package");
  });

  it("matches by an exact code, case-insensitive", () => {
    const catalog = buildCatalog();
    const results = searchCatalog(catalog, "ahq");
    assert.equal(results.length, 1);
    assert.equal(results[0].canonicalName, "Trailer Tow Group");
  });

  it("an empty query matches nothing", () => {
    assert.deepEqual(searchCatalog(buildCatalog(), "   "), []);
  });

  it("no match returns an empty array, not undefined or a throw", () => {
    assert.deepEqual(searchCatalog(buildCatalog(), "nonexistent option xyz"), []);
  });
});
