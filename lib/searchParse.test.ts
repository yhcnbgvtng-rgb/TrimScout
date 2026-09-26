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

  it("throws SearchParseError when Gemini returns a persistent non-2xx, non-retryable status", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      const origFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async () => { calls++; return new Response("bad request", { status: 400 }); }) as typeof fetch;
      try {
        await assert.rejects(() => parseSearchQuery("anything", catalog), SearchParseError);
        assert.equal(calls, 1, "a non-retryable status should not be retried");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("retries a 503 (Gemini's own 'usually temporary' overload status) and succeeds on a later attempt", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      const origFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        if (calls < 2) return new Response(JSON.stringify({ error: { code: 503, status: "UNAVAILABLE" } }), { status: 503 });
        return geminiResponse(JSON.stringify({ filters: { make: "Honda" }, confidence: 0.5, clarifications: [], displayChips: [] }));
      }) as typeof fetch;
      try {
        const result = await parseSearchQuery("a Honda", catalog);
        assert.equal(result!.filters.make, "Honda");
        assert.equal(calls, 2, "should have retried exactly once before succeeding");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("retries 429 the same way as 503, and gives up (throwing) after exhausting retries on persistent overload", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      const origFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async () => { calls++; return new Response("rate limited", { status: 429 }); }) as typeof fetch;
      try {
        await assert.rejects(() => parseSearchQuery("anything", catalog), SearchParseError);
        assert.equal(calls, 3, "should attempt exactly 3 times total before giving up");
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

  it("preserves an exact model string like 'iX' verbatim — never altered by coercion", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        geminiResponse(
          JSON.stringify({
            filters: { make: "BMW", model: "iX", yearMin: 2024, yearMax: 2024 },
            confidence: 0.9,
            clarifications: [],
            displayChips: [{ field: "make", label: "BMW" }, { field: "model", label: "iX" }],
          })
        )) as typeof fetch;
      try {
        const result = await parseSearchQuery("2024 bmw ix", catalog);
        assert.equal(result!.filters.model, "iX", "must not become BMW X or lose the leading lowercase i");
        assert.equal(result!.filters.yearMin, 2024);
        assert.equal(result!.filters.yearMax, 2024);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("drops clarifications entirely when confidence is high, even if the model returned some anyway", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        geminiResponse(
          JSON.stringify({
            filters: { make: "BMW", model: "iX" },
            confidence: 0.9,
            clarifications: ["Did you mean the BMW X instead? iX is not currently listed."],
            displayChips: [],
          })
        )) as typeof fetch;
      try {
        const result = await parseSearchQuery("2024 bmw ix", catalog);
        assert.deepEqual(result!.clarifications, [], "a stated make+model should never surface a 'did you mean' clarification");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("caps clarifications to at most one, even when confidence is low and the model returned several", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        geminiResponse(
          JSON.stringify({
            filters: {},
            confidence: 0.3,
            clarifications: ["Which make?", "What's your budget?", "Any color preference?"],
            displayChips: [],
          })
        )) as typeof fetch;
      try {
        const result = await parseSearchQuery("a nice car", catalog);
        assert.equal(result!.clarifications.length, 1);
        assert.equal(result!.clarifications[0], "Which make?");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  it("keeps a single clarification when confidence is genuinely low and a field is missing", async () => {
    await withEnv({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" }, async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        geminiResponse(
          JSON.stringify({
            filters: { make: "BMW" },
            confidence: 0.5,
            clarifications: ["Which BMW SUV — X1, X3, X5, or X7?"],
            displayChips: [{ field: "make", label: "BMW" }],
          })
        )) as typeof fetch;
      try {
        const result = await parseSearchQuery("nice bmw suv under 60k", catalog);
        assert.deepEqual(result!.clarifications, ["Which BMW SUV — X1, X3, X5, or X7?"]);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});
