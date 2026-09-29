import { describe, expect, it } from "vitest";
import { buildRequest, checkCloudflare, classifyFailure, HttpError, limitsFromHeaders, recordResults, ttsVoice, type TestOutcome } from "./probe";
import type { Resource, TestHistory } from "./types";

describe("classifyFailure", () => {
  it("treats Mistral's zero per-minute limit as no free quota, not a passing rate limit", () => {
    expect(classifyFailure(new HttpError(429, '429 limit: 0 {"message":"Rate limit exceeded"}'))).toBe("no_free_quota");
  });

  it.each([
    [new HttpError(429, "429 Too Many Requests"), "rate_limited"],
    [new HttpError(400, "AiError: you have used up your daily free allocation of 10,000 neurons"), "rate_limited"],
    [new HttpError(429, 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0'), "no_free_quota"],
    [new HttpError(404, "404 No endpoints found for x:free"), "gone"],
    [new HttpError(410, "410 model has reached its end of life"), "gone"],
    [new HttpError(400, "This model is unavailable for free. Use this slug instead: x/y"), "gone"],
    [new HttpError(403, '403 {"error":{"message":"x:free is only available on agentic harnesses. Try plugging it into a coding agent'), "restricted"],
    [new HttpError(403, "403 Forbidden"), "error"],
    [new HttpError(500, "500 internal"), "error"],
    [Object.assign(new Error("timed out"), { name: "TimeoutError" }), "slow"],
  ])("%s → %s", (err, expected) => {
    expect(classifyFailure(err)).toBe(expected);
  });
});

describe("limitsFromHeaders", () => {
  it("reads Mistral's per-minute limits", () => {
    const h = new Headers({ "x-ratelimit-limit-req-minute": "60", "x-ratelimit-limit-tokens-minute": "50000" });
    expect(limitsFromHeaders(h)).toEqual({ rpm: 60, tpm: 50000, source: "observed (response headers)" });
  });

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
    ({ result: { at, status, latency_ms: 100 }, limits: null, detail: null });

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

describe("buildRequest", () => {
  const env = { OPENROUTER_API_KEY: "k", GROQ_API_KEY: "k", GOOGLE_AI_STUDIO_API_KEY: "k" };
  const r = (provider: Resource["provider"], model_id: string, kind: Resource["kind"]) =>
    ({ provider, model_id, kind } as Resource);

  it("sends chat models to chat completions", () => {
    expect(buildRequest(r("groq", "openai/gpt-oss-120b", "chat"), env).url).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("sends TTS to /audio/speech with the voice the model needs", () => {
    const req = buildRequest(r("groq", "canopylabs/orpheus-v1-english", "tts"), env);
    expect(req.url).toBe("https://api.groq.com/openai/v1/audio/speech");
    expect(JSON.parse(req.init.body as string)).toMatchObject({ voice: "troy", input: "OK" });
    expect(ttsVoice({ provider: "openrouter", model_id: "fish-audio/s2.1-pro-free:free" })).toBeUndefined();
  });

  it("sends STT to /audio/transcriptions with the sample clip", () => {
    const req = buildRequest(r("groq", "whisper-large-v3", "stt"), env);
    expect(req.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect((req.init.body as FormData).get("model")).toBe("whisper-large-v3");
  });

  it("uses Gemini's native API for its speech models", () => {
    const req = buildRequest(r("google-ai-studio", "gemini-3-flash-tts", "tts"), env);
    expect(req.url).toContain("/models/gemini-3-flash-tts:generateContent");
    expect(JSON.parse(req.init.body as string).generationConfig.responseModalities).toEqual(["AUDIO"]);
  });

  it("rejects an STT transcript that doesn't match the sample", async () => {
    const req = buildRequest(r("groq", "whisper-large-v3", "stt"), env);
    await expect(req.check(new Response(JSON.stringify({ text: "hello there" })))).rejects.toThrow(/did not match/);
    await expect(req.check(new Response(JSON.stringify({ text: "Olympus Mons is…" })))).resolves.toBeUndefined();
  });
});

describe("Cloudflare requests", () => {
  const env = { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "acc" };
  const r = (model_id: string, kind: Resource["kind"]) => ({ provider: "cloudflare", model_id, kind } as Resource);

  it("runs chat through the OpenAI-compatible path with the account filled in", () => {
    expect(buildRequest(r("@cf/openai/gpt-oss-20b", "chat"), env).url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/ai/v1/chat/completions");
  });
  it("runs images through /ai/run, FLUX.2 as a form", () => {
    expect(buildRequest(r("@cf/black-forest-labs/flux-1-schnell", "image"), env).url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/black-forest-labs/flux-1-schnell");
    expect(buildRequest(r("@cf/black-forest-labs/flux-2-klein-4b", "image"), env).init.body).toBeInstanceOf(FormData);
  });
  it("accepts raw or base64 media and rejects empty answers", async () => {
    await expect(checkCloudflare({ kind: "image" }, new Response(new Uint8Array(2000), { headers: { "content-type": "image/png" } }))).resolves.toBeUndefined();
    await expect(checkCloudflare({ kind: "image" }, new Response(JSON.stringify({ result: { image: "A".repeat(600) } })))).resolves.toBeUndefined();
    await expect(checkCloudflare({ kind: "tts" }, new Response(JSON.stringify({ result: {} })))).rejects.toThrow(/no tts/);
    await expect(checkCloudflare({ kind: "stt" }, new Response(JSON.stringify({ result: { text: "Olympus Mons is" } })))).resolves.toBeUndefined();
  });
});
