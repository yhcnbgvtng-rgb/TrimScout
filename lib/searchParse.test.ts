import "./testdata/blockLiveHttp";
import assert from "node:assert/strict";
import { env } from "node:process";
import { describe, it } from "node:test";
import { parseSearchQuery, SearchParseError } from "./searchParse";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = env[k];
    if (vars[k] === undefined) delete env[k];
    else env[k] = vars[k];
  }
  return fn().finally(() => {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete env[k];
      else env[k] = prev[k];
    }
  });
}

const catalog = {
  makes: ["Toyota", "Honda"],
  optionCodes: [{ code: "PANO", label: "Panoramic Roof" }, { code: "AWD" }],
  exteriorColors: ["Black", "White"],
  interiorColors: ["Tan", "Black"],
};

function geminiResponse(text: string): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseSearchQuery — not configured", () => {
  it("returns null (not a throw) when GEMINI_API_KEY is missing", async () => {
    await withEnv({ GEMINI_API_KEY: undefined, GEMINI_MODEL: "gemini-test" }, async () => {
      assert.equal(await parseSearchQuery("black Toyota under 30k", catalog), null);
    });
  });

  it("returns null when GEMINI_MODEL is missing — no hardcoded default", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: undefined }, async () => {
      assert.equal(await parseSearchQuery("black Toyota under 30k", catalog), null);
    });
  });
});

describe("parseSearchQuery — configured, mocked Gemini response", () => {
  it("parses a well-formed JSON response into typed filters", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        geminiResponse(
          JSON.stringify({
            filters: { make: "Toyota", priceMax: 30000, exteriorColor: "Black" },
            confidence: 0.9,
            clarifications: [],
            displayChips: [{ field: "make", label: "Toyota" }, { field: "priceMax", label: "Under $30,000" }],
          })
        )) as typeof fetch;
      try {
        const result = await parseSearchQuery("black Toyota under 30k", catalog);
        assert.ok(result);
        assert.equal(result!.filters.make, "Toyota");
        assert.equal(result!.filters.priceMax, 30000);
        assert.equal(result!.filters.exteriorColor, "Black");
        assert.equal(result!.filters.model, null);
        assert.equal(result!.confidence, 0.9);
        assert.deepEqual(result!.displayChips, [{ field: "make", label: "Toyota" }, { field: "priceMax", label: "Under $30,000" }]);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("strips a markdown code fence around the JSON", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        geminiResponse('```json\n{"filters": {"make": "Honda"}, "confidence": 0.5, "clarifications": [], "displayChips": []}\n```')) as typeof fetch;
      try {
        const result = await parseSearchQuery("a Honda", catalog);
        assert.equal(result!.filters.make, "Honda");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("throws SearchParseError on malformed JSON rather than returning garbage filters", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () => geminiResponse("not json at all")) as typeof fetch;
      try {
        await assert.rejects(() => parseSearchQuery("anything", catalog), SearchParseError);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("throws SearchParseError when Gemini returns a non-2xx status", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () => new Response("quota exceeded", { status: 429 })) as typeof fetch;
      try {
        await assert.rejects(() => parseSearchQuery("anything", catalog), SearchParseError);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("defaults missing/invalid fields to null/empty rather than throwing", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () => geminiResponse(JSON.stringify({ filters: {} }))) as typeof fetch;
      try {
        const result = await parseSearchQuery("something vague", catalog);
        assert.equal(result!.filters.make, null);
        assert.equal(result!.confidence, 0);
        assert.deepEqual(result!.clarifications, []);
        assert.deepEqual(result!.displayChips, []);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("drops a non-array/empty optionCodes to null rather than an empty array", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () => geminiResponse(JSON.stringify({ filters: { optionCodes: [] } }))) as typeof fetch;
      try {
        const result = await parseSearchQuery("something", catalog);
        assert.equal(result!.filters.optionCodes, null);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("throws SearchParseError for an empty query string", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      await assert.rejects(() => parseSearchQuery("   ", catalog), SearchParseError);
    });
  });
});
