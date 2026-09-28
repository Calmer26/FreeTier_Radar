import { describe, expect, it } from "vitest";
import { mapGoogle, mapGroq, mapKilo, mapLlm7, mapNvidia, freeAllowance, mapCline, mapCloudflare, mapOpenRouter, mapZai, OPENROUTER_CURATED_SPEECH } from "./adapters";
import { classifyModel } from "./candidates";

describe("classifyModel", () => {
  it.each([
    ["qwen/qwen3-coder:free", "chat"],
    ["whisper-large-v3-turbo", "stt"],
    ["gemini-3.5-transcribe", "stt"],
    ["canopylabs/orpheus-v1-english", "tts"],
    ["gemini-2.5-flash-preview-tts", "tts"],
    ["deepgram/flux-tts:free", "tts"],
    ["text-embedding-005", null],
    ["gemini-3-flash-image", null],
    ["meta-llama/llama-guard-4-12b", null],
  ])("%s → %s", (id, kind) => {
    expect(classifyModel(id)).toBe(kind);
  });
});

describe("mapOpenRouter", () => {
  it("keeps :free models, reads tools and modalities, and appends curated speech models", () => {
    const out = mapOpenRouter([
      { id: "qwen/qwen3-coder:free", name: "Qwen3 Coder (free)", context_length: 262_144,
        architecture: { input_modalities: ["text"] }, supported_parameters: ["tools", "temperature"] },
      { id: "qwen/qwen3-coder", name: "Qwen3 Coder", context_length: 262_144 },
      { id: "google/lyria-3:free", name: "Lyria" },
      { id: "openrouter/free", name: "Free router" },
    ]);
    const chat = out.filter((m) => m.kind === "chat");
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({
      provider: "openrouter", model_id: "qwen/qwen3-coder:free", price_type: "free", listed_by: "api",
      tool_calling: true, input_modalities: ["text"], limit_scope: "shared", usage_terms: "production-ok",
    });
    const curated = out.filter((m) => m.listed_by === "curated");
    expect(curated.map((m) => m.model_id)).toEqual(OPENROUTER_CURATED_SPEECH.map((c) => c.id));
    expect(curated.every((m) => m.kind === "tts")).toBe(true);
  });

  it("does not duplicate a curated model once OpenRouter lists it", () => {
    const id = OPENROUTER_CURATED_SPEECH[0].id;
    const out = mapOpenRouter([{ id, name: "Listed now" }]);
    expect(out.filter((m) => m.model_id === id)).toEqual([expect.objectContaining({ listed_by: "api", name: "Listed now" })]);
  });

  it("leaves tool calling unknown when supported_parameters is absent", () => {
    expect(mapOpenRouter([{ id: "a/b:free", name: "B" }])[0].tool_calling).toBeNull();
  });
});

describe("mapGroq", () => {
  it("keeps active chat and speech models, drops the rest", () => {
    const out = mapGroq([
      { id: "openai/gpt-oss-120b", active: true, context_window: 131_072, owned_by: "OpenAI" },
      { id: "whisper-large-v3", active: true, context_window: 448 },
      { id: "canopylabs/orpheus-v1-english", active: true },
      { id: "meta-llama/llama-guard-4-12b", active: true },
      { id: "old-model", active: false },
    ]);
    expect(out.map((m) => [m.model_id, m.kind])).toEqual([
      ["openai/gpt-oss-120b", "chat"],
      ["whisper-large-v3", "stt"],
      ["canopylabs/orpheus-v1-english", "tts"],
    ]);
    expect(out[0].price_type).toBe("freemium-quota");
    // A Whisper "context window" is not a chat context.
    expect(out[1].context_length).toBeNull();
  });
});

describe("mapGoogle", () => {
  it("keeps generateContent models, strips the prefix, skips -latest aliases, tags speech", () => {
    const out = mapGoogle([
      { name: "models/gemini-3-flash", displayName: "Gemini 3 Flash", inputTokenLimit: 1_048_576, supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3-flash-tts", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-flash-latest", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-005", supportedGenerationMethods: ["embedContent"] },
      { name: "models/gemini-3-flash-image", supportedGenerationMethods: ["generateContent"] },
    ]);
    expect(out.map((m) => [m.model_id, m.kind])).toEqual([["gemini-3-flash", "chat"], ["gemini-3-flash-tts", "tts"]]);
    expect(out[0].price_type).toBe("unknown");
  });
});

describe("mapNvidia", () => {
  it("keeps chat models only, all evaluation-only", () => {
    const out = mapNvidia([
      { id: "nvidia/nemotron-3-ultra", owned_by: "nvidia" },
      { id: "nvidia/nv-embedqa-e5-v5" },
      { id: "nvidia/magpie-tts-multilingual" },
    ]);
    expect(out.map((m) => m.model_id)).toEqual(["nvidia/nemotron-3-ultra"]);
    expect(out[0].usage_terms).toBe("evaluation-only");
  });
});

describe("mapKilo", () => {
  it("keeps free models, skips routers, and labels data use per model", () => {
    const out = mapKilo([
      { id: "cohere/north-mini-code:free", name: "North Mini Code", isFree: true, mayTrainOnYourPrompts: true, context_length: 256_000, supported_parameters: ["tools"] },
      { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super", isFree: true, mayTrainOnYourPrompts: true },
      { id: "acme/private:free", name: "Private", isFree: true, mayTrainOnYourPrompts: false },
      { id: "kilo-auto/free", name: "Auto Free", isFree: true },
      { id: "openrouter/free", name: "Free router", isFree: true },
      { id: "anthropic/claude-sonnet-4.6", name: "Sonnet", isFree: false },
    ]);
    expect(out.map((m) => [m.model_id, m.data_logging, m.usage_terms])).toEqual([
      ["cohere/north-mini-code:free", "may-train", "unknown"],
      ["nvidia/nemotron-3-super-120b-a12b:free", "logs-prompts", "evaluation-only"],
      ["acme/private:free", "none-stated", "unknown"],
    ]);
    expect(out[0]).toMatchObject({ provider: "kilo", tool_calling: true, account_required: "no" });
  });
});

describe("mapLlm7", () => {
  it("keeps only turbo chat models that aren't billed by usage", () => {
    const out = mapLlm7([
      { id: "GLM-5.3-Flash", tier: "turbo", model_type: "chat", usage_based_only: false, context_window: { tokens: 400_000 }, tools_calling: true },
      { id: "DeepSeek-V4-Flash-0731", tier: "turbo", model_type: "chat", usage_based_only: true },
      { id: "gpt-5.4", tier: "pro", model_type: "chat" },
      { id: "seedance-2.0-mini", tier: "turbo", model_type: "video" },
    ]);
    expect(out.map((m) => m.model_id)).toEqual(["GLM-5.3-Flash"]);
    expect(out[0]).toMatchObject({ usage_terms: "evaluation-only", data_logging: "may-train", context_length: 400_000, tool_calling: true });
  });
});

describe("mapZai", () => {
  it("keeps only the models the pricing page lists as free", () => {
    const out = mapZai([{ id: "glm-4.7-flash", context_length: 200_000 }, { id: "GLM-4.6V-Flash" }, { id: "glm-5.3" }]);
    expect(out.map((m) => [m.model_id, m.name, m.input_modalities])).toEqual([
      ["glm-4.7-flash", "GLM-4.7-Flash", ["text"]],
      ["GLM-4.6V-Flash", "GLM-4.6V-Flash", ["text", "image"]],
    ]);
    expect(out[0]).toMatchObject({ provider: "zai", data_logging: "may-train", context_length: 200_000 });
  });
});

describe("mapCline", () => {
  it("lists Cline's free promotion as untested trial models", () => {
    const out = mapCline({ free: [
      { id: "cline-free/deepseek-v4.1-flash", name: "Deepseek-v4.1-Flash" },
      { id: "stealth/pixel-canary", name: "Pixel Canary" },
      { id: "cline-free/x", name: "cline-free/x" },
    ] });
    expect(out.map((m) => [m.model_id, m.name])).toEqual([
      ["cline-free/deepseek-v4.1-flash", "Deepseek-v4.1-Flash"],
      ["stealth/pixel-canary", "Pixel Canary"],
      ["cline-free/x", "x"],
    ]);
    expect(out[0]).toMatchObject({ provider: "cline", price_type: "trial-credit", account_required: "yes", data_logging: "may-train" });
  });
});

describe("Cloudflare", () => {
  const prop = (property_id: string, value: unknown) => ({ property_id, value });
  it("maps tasks to kinds and drops paid-only, realtime and LoRA models", () => {
    const out = mapCloudflare([
      { name: "@cf/openai/gpt-oss-20b", task: { name: "Text Generation" }, properties: [prop("context_window", "128000"), prop("function_calling", "true"), prop("price", '[{"unit":"per M input tokens","price":0.2}]')] },
      { name: "@cf/black-forest-labs/flux-1-schnell", task: { name: "Text-to-Image" }, properties: [prop("terms", "https://bfl.ai/legal/terms-of-service")] },
      { name: "@cf/openai/whisper", task: { name: "Automatic Speech Recognition" } },
      { name: "@cf/myshell-ai/melotts", task: { name: "Text-to-Speech" } },
      { name: "@cf/moonshotai/kimi-k2.6", task: { name: "Text Generation" }, properties: [prop("require_workers_paid", "true")] },
      { name: "@cf/deepgram/flux", task: { name: "Automatic Speech Recognition" }, properties: [prop("realtime", "true")] },
      { name: "@cf/google/gemma-2b-it-lora", task: { name: "Text Generation" } },
      { name: "@cf/baai/bge-m3", task: { name: "Text Embeddings" } },
    ]);
    expect(out.map((m) => [m.model_id, m.kind])).toEqual([
      ["@cf/openai/gpt-oss-20b", "chat"],
      ["@cf/black-forest-labs/flux-1-schnell", "image"],
      ["@cf/openai/whisper", "stt"],
      ["@cf/myshell-ai/melotts", "tts"],
    ]);
    expect(out[0]).toMatchObject({ name: "openai/gpt-oss-20b", context_length: 128_000, tool_calling: true, limit_scope: "shared" });
    expect(out[0].rate_limits?.note).toBe("≈ 550k input tokens a day within the free Neurons");
    expect(out[1].terms_url).toBe("https://bfl.ai/legal/terms-of-service");
  });

  it("turns a price into a free-per-day estimate", () => {
    expect(freeAllowance('[{"unit":"per 512 by 512 tile","price":0.00583}]')).toBe("≈ 18 images (512×512) a day within the free Neurons");
    expect(freeAllowance('[{"unit":"per step","price":0}]')).toMatch(/No charge listed/);
    expect(freeAllowance(undefined)).toBeNull();
  });
});
