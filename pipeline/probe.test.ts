import { describe, expect, it } from "vitest";
import { classifyFailure, HttpError, limitsFromHeaders, recordResults, type TestOutcome } from "./probe";
import type { TestHistory } from "./types";

describe("classifyFailure", () => {
  it.each([
    [new HttpError(429, "429 Too Many Requests"), "rate_limited"],
    [new HttpError(429, 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0'), "no_free_quota"],
    [new HttpError(404, "404 No endpoints found for x:free"), "gone"],
    [new HttpError(410, "410 model has reached its end of life"), "gone"],
    [new HttpError(400, "This model is unavailable for free. Use this slug instead: x/y"), "gone"],
    [new HttpError(500, "500 internal"), "error"],
    [Object.assign(new Error("timed out"), { name: "TimeoutError" }), "slow"],
  ])("%s → %s", (err, expected) => {
    expect(classifyFailure(err)).toBe(expected);
  });
});

describe("limitsFromHeaders", () => {
  it("reads Groq's per-model limits", () => {
    const h = new Headers({ "x-ratelimit-limit-requests": "1000", "x-ratelimit-limit-tokens": "8000" });
    expect(limitsFromHeaders(h)).toEqual({ rpd: 1000, tpm: 8000, source: "observed (response headers)" });
  });
  it("returns null without headers", () => {
    expect(limitsFromHeaders(new Headers())).toBeNull();
  });
});

describe("recordResults", () => {
  const empty: TestHistory = { updated_at: null, results: {}, observed_limits: {} };
  const outcome = (at: string, status: TestOutcome["result"]["status"] = "responded"): TestOutcome =>
    ({ result: { at, status, latency_ms: 100 }, limits: null });

  it("keeps one result per UTC day, replacing an earlier one", () => {
    const ids = new Set(["p/m"]);
    const h1 = recordResults(empty, new Map([["p/m", outcome("2026-09-28T01:00:00Z", "error")]]), ids, "2026-09-28T01:00:00Z");
    const h2 = recordResults(h1, new Map([["p/m", outcome("2026-09-28T09:00:00Z")]]), ids, "2026-09-28T09:00:00Z");
    expect(h2.results["p/m"]).toEqual([{ at: "2026-09-28T09:00:00Z", status: "responded", latency_ms: 100 }]);
  });

  it("trims to 30 days and drops unknown resources", () => {
    const old: TestHistory = {
      updated_at: null,
      results: {
        "p/m": [{ at: "2026-08-01T00:00:00Z", status: "responded", latency_ms: 1 }, { at: "2026-09-20T00:00:00Z", status: "responded", latency_ms: 1 }],
        "p/gone": [{ at: "2026-09-20T00:00:00Z", status: "responded", latency_ms: 1 }],
      },
      observed_limits: { "p/gone": { rpd: 1 } },
    };
    const h = recordResults(old, new Map(), new Set(["p/m"]), "2026-09-28T00:00:00Z");
    expect(h.results).toEqual({ "p/m": [{ at: "2026-09-20T00:00:00Z", status: "responded", latency_ms: 1 }] });
    expect(h.observed_limits).toEqual({});
  });
});
