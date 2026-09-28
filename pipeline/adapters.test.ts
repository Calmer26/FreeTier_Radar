import { describe, expect, it } from "vitest";
import { mapGoogle, mapGroq, mapNvidia, mapOpenRouter, OPENROUTER_CURATED_SPEECH } from "./adapters";
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
