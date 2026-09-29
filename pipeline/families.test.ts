import { describe, expect, it } from "vitest";
import { cleanName, families, familyName, familySlug, type FamilyMember } from "./families";
import type { TestResult } from "./types";

const day = (d: number, status: TestResult["status"], latency = 500): TestResult =>
  ({ at: `2026-09-${String(d).padStart(2, "0")}T06:00:00Z`, status, latency_ms: latency });

const member = (id: string, over: Partial<FamilyMember> = {}): FamilyMember => ({
  id, provider: "openrouter", kind: "chat", model_id: "qwen/qwen3.8-27b:free", name: "Qwen: Qwen3.8 27B (free)",
  usage_terms: "production-ok", testable: true, tests: [day(1, "responded"), day(2, "responded")], toolTests: [], ...over,
});

describe("names", () => {
  it("cleans provider decorations", () => {
    expect(cleanName("Qwen: Qwen3.8 27B (free)")).toBe("Qwen3.8 27B");
    expect(cleanName("qwen/qwen3.8-27b (Alibaba Cloud)")).toBe("qwen/qwen3.8-27b");
    expect(cleanName("Space Bunny Alpha (new)")).toBe("Space Bunny Alpha");
  });

  it("prefers a display name, else the model id's last part", () => {
    expect(familyName([{ name: "qwen/qwen3.8-27b (Alibaba Cloud)", model_id: "qwen/qwen3.8-27b" }, { name: "Qwen: Qwen3.8 27B (free)", model_id: "x" }])).toBe("Qwen3.8 27B");
    expect(familyName([{ name: "openai/gpt-oss-20b (OpenAI)", model_id: "openai/gpt-oss-20b" }])).toBe("gpt-oss-20b");
    expect(familyName([{ name: "Deepseek-v4.1-Flash", model_id: "x", arena: { name: "Deepseek V4.1 Flash (Max)" } }])).toBe("Deepseek V4.1 Flash");
  });

  it("makes URL slugs, marking non-chat kinds", () => {
    expect(familySlug("chat|qwen3.8-27b")).toBe("qwen3-8-27b");
    expect(familySlug("tts|orpheus-v1")).toBe("orpheus-v1-tts");
  });
});

describe("families", () => {
  it("groups the same model and puts the best usable place first", () => {
    const out = families([
      member("openrouter/q", { tests: [day(1, "responded", 900), day(2, "error")] }),
      member("groq/q", { provider: "groq", model_id: "qwen/qwen3.8-27b", name: "qwen/qwen3.8-27b (Alibaba Cloud)", tests: [day(1, "responded", 200), day(2, "responded", 200)] }),
      member("nvidia/q", { provider: "nvidia", model_id: "qwen/qwen3.8-27b", usage_terms: "evaluation-only" }),
      member("cline/q", { provider: "cline", model_id: "cline-free/qwen3.8-27b", testable: false, tests: [] }),
      member("other", { model_id: "other-model", name: "Other" }),
    ]);
    const q = out.find((f) => f.slug === "qwen3-8-27b")!;
    expect(q.name).toBe("Qwen3.8 27B");
    expect(q.members.map((m) => m.id)).toEqual(["groq/q", "openrouter/q", "nvidia/q", "cline/q"]);
    expect(out).toHaveLength(2);
  });
});
