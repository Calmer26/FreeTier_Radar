import { describe, expect, it } from "vitest";
import type { TestResult } from "./types";
import { endpointFor, workingFeed, type WorkingInput } from "./working";

const day = (d: number, status: TestResult["status"], latency = 500): TestResult =>
  ({ at: `2026-09-${String(d).padStart(2, "0")}T06:00:00Z`, status, latency_ms: latency });
const pass = (d: number) => ({ at: `2026-09-${String(d).padStart(2, "0")}T06:01:00Z`, status: "pass" as const, latency_ms: 500 });

const model = (id: string, over: Partial<WorkingInput> = {}): WorkingInput => ({
  id, provider: "groq", kind: "chat", model_id: id, name: id, usage_terms: "production-ok", testable: true,
  tests: [day(1, "responded"), day(2, "responded")], toolTests: [], context_length: 131_072, input_modalities: ["text"],
  limits: null, limit_scope: "per-model", data_logging: "unknown", arena: null, href: `/models/groq/${id}/`, ...over,
});

describe("endpointFor", () => {
  it("gives OpenAI-style URLs for chat and each provider's own route otherwise", () => {
    expect(endpointFor({ provider: "groq", kind: "chat", model_id: "m" })).toEqual({ api: "openai", endpoint: "https://api.groq.com/openai/v1/chat/completions" });
    expect(endpointFor({ provider: "groq", kind: "stt", model_id: "whisper" }).endpoint).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(endpointFor({ provider: "cloudflare", kind: "image", model_id: "@cf/x/y" })).toEqual({
      api: "cloudflare-run", endpoint: "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/@cf/x/y",
    });
    expect(endpointFor({ provider: "google-ai-studio", kind: "tts", model_id: "g" }).api).toBe("gemini-native");
  });
});

describe("workingFeed", () => {
  const feed = workingFeed(
    [
      model("steady", { toolTests: [pass(1), pass(2)] }),
      model("flaky", { tests: [day(1, "error"), day(2, "responded")] }),
      model("down", { tests: [day(1, "responded"), day(2, "error")] }),
      model("eval", { provider: "nvidia", usage_terms: "evaluation-only" }),
      model("cline", { provider: "cline", testable: false }),
      model("eyes", { input_modalities: ["text", "image"] }),
      model("voice", { kind: "tts" }),
    ],
    "https://example.dev",
    "2026-09-30T00:00:00Z",
  );

  it("keeps only places an app can use that answered the latest test, most reliable first", () => {
    expect(feed.lists.chat.map((m) => m.model_id)).toEqual(["steady", "eyes", "flaky"]);
    expect(feed.lists.tts.map((m) => m.model_id)).toEqual(["voice"]);
  });

  it("lists agent models by tool-call record and vision models by input", () => {
    expect(feed.lists.agent.map((m) => m.model_id)).toEqual(["steady"]);
    expect(feed.lists.vision.map((m) => m.model_id)).toEqual(["eyes"]);
    expect(feed.lists.agent[0]).toMatchObject({ tool_calls: { passed: 2, of: 2 }, key_env: "GROQ_API_KEY", page: "https://example.dev/models/groq/steady/" });
  });
});
