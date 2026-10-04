import { describe, expect, it } from "vitest";
import { HttpError } from "./probe";
import { buildSearchRequest, resultUrls } from "./search";
import { classifySearchFailure, recordSearchResults } from "./search-test";
import type { SearchApi, SearchStyle } from "./types";

const target = (style: SearchStyle, endpoint = "https://api.example.com/search"): Pick<SearchApi, "api" | "key_env"> => ({
  api: { style, endpoint, method: style === "brave" ? "GET" : "POST", auth: "" },
  key_env: "K",
});
const env = { K: "secret" };
const body = (style: SearchStyle) => JSON.parse(String(buildSearchRequest(target(style), env).init.body));
const headers = (style: SearchStyle) => buildSearchRequest(target(style), env).init.headers as Record<string, string>;

describe("buildSearchRequest", () => {
  it("asks Brave for one result, with the key in its own header", () => {
    const { url, init } = buildSearchRequest(target("brave"), env);
    expect(url).toBe("https://api.example.com/search?q=wikipedia&count=1");
    expect(init.method).toBe("GET");
    expect(headers("brave")["X-Subscription-Token"]).toBe("secret");
  });

  it("sends each API's cheapest plain search", () => {
    expect(body("tavily")).toEqual({ query: "wikipedia", search_depth: "basic", max_results: 1 });
    expect(body("exa")).toEqual({ query: "wikipedia", type: "instant", numResults: 1, contents: { text: false } });
    expect(body("firecrawl")).toEqual({ query: "wikipedia", limit: 1 });
    expect(body("parallel")).toEqual({ search_queries: ["wikipedia"], max_results: 1, mode: "turbo" });
    expect(body("linkup")).toEqual({ q: "wikipedia", depth: "fast", outputType: "searchResults", maxResults: 1 });
  });

  it("puts the key where each API expects it", () => {
    expect(headers("tavily").Authorization).toBe("Bearer secret");
    expect(headers("exa")["x-api-key"]).toBe("secret");
    expect(headers("parallel")["x-api-key"]).toBe("secret");
    expect(headers("firecrawl").Authorization).toBe("Bearer secret");
  });
});

describe("resultUrls", () => {
  it("reads each response shape", () => {
    expect(resultUrls("brave", { web: { results: [{ url: "https://en.wikipedia.org/" }] } })).toEqual(["https://en.wikipedia.org/"]);
    expect(resultUrls("tavily", { results: [{ url: "https://www.wikipedia.org/" }] })).toEqual(["https://www.wikipedia.org/"]);
    expect(resultUrls("firecrawl", { success: true, data: { web: [{ url: "https://wikipedia.org" }] } })).toEqual(["https://wikipedia.org"]);
  });

  it("treats an empty or odd response as no answer", () => {
    expect(resultUrls("exa", { results: [] })).toEqual([]);
    expect(resultUrls("brave", {})).toEqual([]);
    expect(resultUrls("linkup", { results: [{ url: "not a url" }] })).toEqual([]);
  });
});

describe("classifySearchFailure", () => {
  it.each([
    [new HttpError(402, "402 Payment Required"), "no_free_quota"],
    [new HttpError(432, "432 This request exceeds your plan's set usage limit"), "no_free_quota"],
    [new HttpError(433, "433 This request exceeds the pay-as-you-go limit"), "no_free_quota"],
    [new HttpError(429, "429 Your request has been blocked due to excessive requests"), "rate_limited"],
    [new HttpError(401, "401 Unauthorized: missing or invalid API key."), "error"],
    [new Error("no results in the response"), "error"],
    [Object.assign(new Error("timed out"), { name: "TimeoutError" }), "slow"],
  ])("%s → %s", (err, expected) => {
    expect(classifySearchFailure(err)).toBe(expected);
  });
});

describe("recordSearchResults", () => {
  const old = { updated_at: null, results: { a: [{ at: "2026-08-01T06:10:00.000Z", status: "responded" as const, latency_ms: 1 }, { at: "2026-10-04T06:10:00.000Z", status: "error" as const, latency_ms: 1 }], gone: [{ at: "2026-10-03T06:10:00.000Z", status: "responded" as const, latency_ms: 1 }] } };
  const rerun = { at: "2026-10-04T07:00:00.000Z", status: "responded" as const, latency_ms: 300 };
  const next = recordSearchResults(old, new Map([["a", rerun]]), new Set(["a"]), "2026-10-04T07:00:00.000Z");

  it("keeps one result per day, the 30-day window, and only listed APIs", () => {
    expect(next.results).toEqual({ a: [rerun] });
    expect(next.updated_at).toBe("2026-10-04T07:00:00.000Z");
  });
});
