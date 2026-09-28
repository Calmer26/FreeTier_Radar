import { describe, expect, it } from "vitest";
import { mapGoogle, mapGroq, mapNvidia, mapOpenRouter } from "./adapters";

describe("mapOpenRouter", () => {
  it("keeps only :free chat models and reads tools and modalities", () => {
    const out = mapOpenRouter([
      { id: "qwen/qwen3-coder:free", name: "Qwen3 Coder (free)", context_length: 262_144,
        architecture: { input_modalities: ["text"] }, supported_parameters: ["tools", "temperature"] },
      { id: "qwen/qwen3-coder", name: "Qwen3 Coder", context_length: 262_144 },
      { id: "google/lyria-3:free", name: "Lyria" },
      { id: "openrouter/free", name: "Free router" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      provider: "openrouter", model_id: "qwen/qwen3-coder:free", price_type: "free",
      tool_calling: true, input_modalities: ["text"], limit_scope: "shared", usage_terms: "production-ok",
    });
  });

  it("leaves tool calling unknown when supported_parameters is absent", () => {
    expect(mapOpenRouter([{ id: "a/b:free", name: "B" }])[0].tool_calling).toBeNull();
  });
});

describe("mapGroq", () => {
  it("drops inactive and non-chat models", () => {
    const out = mapGroq([
      { id: "openai/gpt-oss-120b", active: true, context_window: 131_072, owned_by: "OpenAI" },
      { id: "whisper-large-v3", active: true },
      { id: "old-model", active: false },
    ]);
    expect(out.map((m) => m.model_id)).toEqual(["openai/gpt-oss-120b"]);
    expect(out[0].price_type).toBe("freemium-quota");
  });
});

describe("mapGoogle", () => {
  it("keeps generateContent models, strips the prefix, skips -latest aliases", () => {
    const out = mapGoogle([
      { name: "models/gemini-3-flash", displayName: "Gemini 3 Flash", inputTokenLimit: 1_048_576, supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-flash-latest", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-005", supportedGenerationMethods: ["embedContent"] },
      { name: "models/gemini-3-flash-image", supportedGenerationMethods: ["generateContent"] },
    ]);
    expect(out.map((m) => m.model_id)).toEqual(["gemini-3-flash"]);
    expect(out[0].price_type).toBe("unknown");
  });
});

describe("mapNvidia", () => {
  it("marks every model evaluation-only and filters retrieval models", () => {
    const out = mapNvidia([
      { id: "nvidia/nemotron-3-ultra", owned_by: "nvidia" },
      { id: "nvidia/nv-embedqa-e5-v5" },
    ]);
    expect(out.map((m) => m.model_id)).toEqual(["nvidia/nemotron-3-ultra"]);
    expect(out[0].usage_terms).toBe("evaluation-only");
  });
});
