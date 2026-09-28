import { describe, expect, it } from "vitest";
import { rank, RANKINGS, reliability } from "./rankings";
import type { Resource, TestResult } from "./types";

const day = (d: number, status: TestResult["status"], latency = 500): TestResult =>
  ({ at: `2026-09-${String(d).padStart(2, "0")}T06:00:00Z`, status, latency_ms: latency });

const res = (id: string, over: Partial<Resource> = {}): Resource => ({
  id, slug: id, category: "ai-model", status: "active", first_seen: "", last_seen: "", missing_since: null,
  removed_at: null, fingerprint: "", provider: "groq", model_id: id, kind: "chat", listed_by: "api", name: id,
  url: "", price_type: "free", context_length: 131_072, input_modalities: ["text"], tool_calling: true,
  rate_limits: null, limit_scope: "per-model", usage_terms: "production-ok", licence: null,
  card_required: "no", account_required: "yes", data_logging: "unknown", ...over,
});

const ranking = (slug: string) => RANKINGS.find((r) => r.slug === slug)!;

describe("reliability", () => {
  it("ignores rate-limited days and takes the median latency of good answers", () => {
    const rel = reliability([day(1, "responded", 300), day(2, "rate_limited"), day(3, "error"), day(4, "responded", 900), day(5, "responded", 600)]);
    expect(rel).toEqual({ tested: 4, responded: 3, share: 0.75, medianLatencyMs: 600 });
  });
});

describe("rank", () => {
  const good = Array.from({ length: 7 }, (_, i) => day(i + 1, "responded", 400));
  const flaky = Array.from({ length: 7 }, (_, i) => day(i + 1, i % 2 ? "responded" : "error", 200));

  it("orders most-reliable by share, then latency, and needs enough tested days", () => {
    const out = rank(ranking("most-reliable"), [
      { r: res("flaky"), history: flaky },
      { r: res("good"), history: good },
      { r: res("new"), history: [day(1, "responded")] },
    ]);
    expect(out.map((x) => x.r.id)).toEqual(["good", "flaky"]);
  });

  it("puts agent-ready models first for coding agents and leaves out non-agent and eval-only models", () => {
    const out = rank(ranking("coding-agents"), [
      { r: res("partial"), history: [day(1, "responded")] },
      { r: res("ready"), history: good },
      { r: res("no-tools", { tool_calling: false }), history: good },
      { r: res("eval", { usage_terms: "evaluation-only" }), history: good },
    ]);
    expect(out.map((x) => x.r.id)).toEqual(["ready", "partial"]);
  });

  it("orders agent-ready models by Arena WebDev rating, rated before unrated", () => {
    const arena = (webdev: number) => ({ name: "n", published: null, boards: { webdev: { rating: webdev, rank: 1, of: 1, votes: 1 } } });
    const out = rank(ranking("coding-agents"), [
      { r: res("unrated"), history: good },
      { r: res("low"), history: good, arena: arena(1300) },
      { r: res("high"), history: good, arena: arena(1600) },
    ]);
    expect(out.map((x) => x.r.id)).toEqual(["high", "low", "unrated"]);
  });

  it("leaves out models whose latest test found no free quota", () => {
    const text = { name: "n", published: null, boards: { text: { rating: 1500, rank: 1, of: 1, votes: 1 } } };
    const out = rank(ranking("top-rated"), [
      { r: res("paid-only"), history: [...good, day(8, "no_free_quota")], arena: text },
      { r: res("free"), history: good, arena: text },
    ]);
    expect(out.map((x) => x.r.id)).toEqual(["free"]);
  });

  it("lists only rated models in the top-rated ranking", () => {
    const out = rank(ranking("top-rated"), [
      { r: res("rated"), history: good, arena: { name: "n", published: null, boards: { text: { rating: 1400, rank: 1, of: 1, votes: 1 } } } },
      { r: res("unrated"), history: good },
    ]);
    expect(out.map((x) => x.r.id)).toEqual(["rated"]);
  });

  it("keeps speech rankings to their own kind", () => {
    const out = rank(ranking("speech-to-text"), [
      { r: res("whisper", { kind: "stt" }), history: good },
      { r: res("chat"), history: good },
    ]);
    expect(out.map((x) => x.r.id)).toEqual(["whisper"]);
  });
});
