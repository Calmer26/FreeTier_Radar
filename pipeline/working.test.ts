import { describe, expect, it } from "vitest";
import type { TestResult } from "./types";
import { endpointFor, workingFeed, type WorkingInput } from "./working";

const day = (d: number, status: TestResult["status"], latency = 500): TestResult =>
  ({ at: `2026-09-${String(d).padStart(2, "0")}T06:00:00Z`, status, latency_ms: latency });
const result = <S extends "pass" | "fail" | "error">(status: S) => (d: number) =>
  ({ at: `2026-09-${String(d).padStart(2, "0")}T06:01:00Z`, status, latency_ms: 500 });
const pass = result("pass");
const fail = result("fail");

const model = (id: string, over: Partial<WorkingInput> = {}): WorkingInput => ({
  id, provider: "groq", kind: "chat", model_id: id, name: id, usage_terms: "production-ok", testable: true,
  tests: [day(1, "responded"), day(2, "responded")], toolTests: [], multiToolTests: [], jsonTests: [], context_length: 131_072, input_modalities: ["text"],
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
    expect(endpointFor({ provider: "elevenlabs", kind: "tts", model_id: "e" })).toEqual({ api: "elevenlabs", endpoint: "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}" });
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

  it("carries its schema version", () => {
    expect(feed.schema_version).toBe(1);
  });

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

describe("workingFeed: multi-turn and JSON tests", () => {
  const feed = workingFeed(
    [
      model("loops", { toolTests: [pass(1), pass(2)], multiToolTests: [pass(1), pass(2)], jsonTests: [{ ...pass(2), mode: "json_object" }] }),
      model("single", { toolTests: [pass(1), pass(2)] }),
      model("stuck", { toolTests: [pass(1), pass(2)], multiToolTests: [fail(1), fail(2)] }),
      model("half", { toolTests: [pass(1), pass(2)], multiToolTests: [fail(1), pass(2)], jsonTests: [{ ...pass(1), mode: "json_schema" }, result("error")(2)] }),
    ],
    "https://example.dev",
    "2026-09-30T00:00:00Z",
  );
  const byId = Object.fromEntries(feed.lists.chat.map((m) => [m.model_id, m]));

  it("reports passes per test, and the response_format the provider took last", () => {
    expect(byId.loops).toMatchObject({ multi_tool_calls: { passed: 2, of: 2 }, json_schema: { passed: 1, of: 1, response_format: "json_object" } });
    expect(byId.half.json_schema).toEqual({ passed: 1, of: 1, response_format: "json_schema" });
    expect(byId.single).toMatchObject({ multi_tool_calls: null, json_schema: null });
  });

  it("leaves models that fail the multi-turn test out of the agent list, multi-turn passers first", () => {
    expect(feed.lists.agent.map((m) => m.model_id)).toEqual(["loops", "single", "half"]);
  });
});
