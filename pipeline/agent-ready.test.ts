import { describe, expect, it } from "vitest";
import { agentReadiness } from "./agent-ready";
import type { Resource, TestResult } from "./types";

const resource = (over: Partial<Resource> = {}): Resource => ({
  id: "openrouter/a:free", slug: "a-free", category: "ai-model", status: "active",
  first_seen: "", last_seen: "", missing_since: null, removed_at: null, fingerprint: "",
  provider: "openrouter", model_id: "a:free", kind: "chat", listed_by: "api", name: "A", url: "",
  price_type: "free", context_length: 131_072, input_modalities: ["text"], tool_calling: true,
  rate_limits: { rpm: 20, rpd: 50 }, limit_scope: "shared", usage_terms: "production-ok",
  licence: null, card_required: "no", account_required: "yes", data_logging: "unknown",
  ...over,
});

const days = (n: number, status: TestResult["status"] = "responded"): TestResult[] =>
  Array.from({ length: n }, (_, i) => ({ at: `2026-09-${String(i + 1).padStart(2, "0")}T06:00:00Z`, status, latency_ms: 500 }));

describe("agentReadiness", () => {
  it("is yes with tools, long context and a good week, with the OpenRouter caveat", () => {
    const a = agentReadiness(resource(), days(7));
    expect(a.level).toBe("yes");
    expect(a.caveat).toMatch(/10-credit/);
  });

  it("is partial when the test history is too thin", () => {
    expect(agentReadiness(resource(), days(3)).level).toBe("partial");
  });

  it("is partial for evaluation-only models", () => {
    const a = agentReadiness(resource({ provider: "nvidia", usage_terms: "evaluation-only", rate_limits: null }), days(7));
    expect(a.level).toBe("partial");
    expect(a.reasons).toContain("evaluation-only terms");
  });

  it("is no without tool calling or with short context", () => {
    expect(agentReadiness(resource({ tool_calling: null }), days(7)).level).toBe("no");
    expect(agentReadiness(resource({ context_length: 32_768 }), days(7)).level).toBe("no");
  });

  it("has no caveat for per-model limits", () => {
    expect(agentReadiness(resource({ provider: "groq", limit_scope: "per-model", rate_limits: null }), days(7)).caveat).toBeNull();
  });
});

describe("agentReadiness with the tool-call test", () => {
  const tool = (status: "pass" | "fail" | "error", d: number) => ({ at: `2026-09-${String(d).padStart(2, "0")}T06:01:00Z`, status, latency_ms: 500 });

  it("accepts tool calling shown by the test when the provider publishes none", () => {
    expect(agentReadiness(resource({ tool_calling: null }), days(7), [tool("pass", 7)]).level).toBe("yes");
  });

  it("marks a model partial when it keeps failing the tool-call test", () => {
    const a = agentReadiness(resource(), days(7), [tool("fail", 5), tool("fail", 6), tool("pass", 7)]);
    expect(a.level).toBe("partial");
    expect(a.reasons).toContain("passed the tool-call test on 1 of 3 days");
  });

  it("ignores timeouts and server errors in the tool-call share", () => {
    expect(agentReadiness(resource(), days(7), [tool("error", 6), tool("pass", 7)]).level).toBe("yes");
  });

  it("warns about a low hourly limit", () => {
    const a = agentReadiness(resource({ provider: "llm7", limit_scope: "shared", rate_limits: { rpm: 10, rph: 60 } }), days(7), [tool("pass", 7)]);
    expect(a.caveat).toMatch(/60 requests\/hour/);
  });
});
