import { describe, expect, it } from "vitest";
import { agentReadiness } from "./agent-ready";
import type { Resource, TestResult } from "./types";

const resource = (over: Partial<Resource> = {}): Resource => ({
  id: "openrouter/a:free", slug: "a-free", category: "ai-model", status: "active",
  first_seen: "", last_seen: "", missing_since: null, removed_at: null, fingerprint: "",
  provider: "openrouter", model_id: "a:free", kind: "chat", listed_by: "api", name: "A", url: "",
  price_type: "free", context_length: 131_072, input_modalities: ["text"], tool_calling: true,
  rate_limits: { rpm: 20, rpd: 50 }, limit_scope: "shared", usage_terms: "production-ok",
  licence: null, card_required: "no", account_required: "yes",
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
