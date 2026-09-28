import { describe, expect, it } from "vitest";
import { borrowedContext, siblingIds } from "./siblings";

const r = (id: string, provider: string, model_id: string, context_length: number | null = null, over = {}) =>
  ({ id, provider, model_id, kind: "chat", status: "active", context_length, ...over }) as Parameters<typeof siblingIds>[0][number];

describe("siblingIds", () => {
  it("links the same model across providers, not across kinds or removed models", () => {
    const out = siblingIds([
      r("openrouter/qwen/qwen3.8-27b:free", "openrouter", "qwen/qwen3.8-27b:free"),
      r("groq/qwen/qwen3.8-27b", "groq", "qwen/qwen3.8-27b"),
      r("cline/cline-free/deepseek-v4.1-flash", "cline", "cline-free/deepseek-v4.1-flash"),
      r("nvidia/deepseek-ai/deepseek-v4.1-flash", "nvidia", "deepseek-ai/deepseek-v4.1-flash"),
      r("old/qwen3.8-27b", "kilo", "qwen/qwen3.8-27b:free", null, { status: "removed" }),
      r("tts/qwen3.8-27b", "groq", "qwen3.8-27b", null, { kind: "tts" }),
    ]);
    expect(out.get("groq/qwen/qwen3.8-27b")).toEqual(["openrouter/qwen/qwen3.8-27b:free"]);
    expect(out.get("cline/cline-free/deepseek-v4.1-flash")).toEqual(["nvidia/deepseek-ai/deepseek-v4.1-flash"]);
    expect(out.get("tts/qwen3.8-27b")).toEqual([]);
    expect(out.has("old/qwen3.8-27b")).toBe(false);
  });
});

describe("borrowedContext", () => {
  const nvidia = r("nvidia/x", "nvidia", "x");
  it("borrows the smallest known context from siblings", () => {
    expect(borrowedContext(nvidia, [r("a", "openrouter", "x", 262_144), r("b", "kilo", "x", 131_072)]))
      .toEqual({ context_length: 131_072, from: "kilo" });
  });
  it("keeps a model's own value, and returns null when nobody knows", () => {
    expect(borrowedContext(r("own", "groq", "x", 8_192), [r("a", "openrouter", "x", 262_144)])).toBeNull();
    expect(borrowedContext(nvidia, [r("a", "cline", "x")])).toBeNull();
  });
});
