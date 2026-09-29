import { describe, expect, it } from "vitest";
import type { ArenaFile } from "./arena";
import { baseModel, interleave, subscriptionModels } from "./subscriptions";

const entry = (name: string, org: string, rating: number, rank: number) => ({ name, org, rating, rank, votes: 100 });
const file: ArenaFile = {
  source: "",
  fetched_on: "2026-09-28",
  boards: {
    webdev: {
      published: "2026-09-25",
      models: [
        entry("claude-opus-5-max", "anthropic", 1690, 1),
        entry("claude-opus-5-high", "anthropic", 1660, 2),
        entry("gpt-5.6-sol-xhigh (codex-harness)", "openai", 1610, 3),
        entry("gpt-oss-120b", "openai", 1300, 4),
        entry("qwen3.8-27b", "alibaba", 1400, 5),
        entry("claude-sonnet-5-high", "anthropic", 1530, 6),
      ],
    },
  },
};

describe("baseModel", () => {
  it("drops effort, snapshot and harness words, not the model name", () => {
    expect(baseModel("claude-opus-5-max")).toBe("claude-opus-5");
    expect(baseModel("claude-opus-4-5-20251101-high-32k")).toBe("claude-opus-4-5");
    expect(baseModel("gpt-5.6-sol-xhigh (codex-harness)")).toBe("gpt-5.6-sol");
    expect(baseModel("gemini-3.8-flash-high")).toBe("gemini-3.8-flash");
    expect(baseModel("Deepseek V4.1 Flash (Max)")).toBe("deepseek-v4.1-flash");
    expect(baseModel("gpt-image-2 (medium)")).toBe("gpt-image-2");
  });
});

describe("subscriptionModels", () => {
  it("merges variants, keeps the best rating, and skips other makers and open-weight models", () => {
    const out = subscriptionModels(file, "webdev");
    expect(out.map((m) => [m.sub.id, m.base, m.name, m.rating])).toEqual([
      ["claude", "claude-opus-5", "claude-opus-5-max", 1690],
      ["claude", "claude-sonnet-5", "claude-sonnet-5-high", 1530],
      ["chatgpt", "gpt-5.6-sol", "gpt-5.6-sol-xhigh (codex-harness)", 1610],
    ]);
    expect(out[0].names).toEqual(["claude-opus-5-max", "claude-opus-5-high"]);
  });

  it("returns nothing for a board we don't have", () => {
    expect(subscriptionModels(file, "text_to_image")).toEqual([]);
    expect(subscriptionModels(null, "webdev")).toEqual([]);
  });
});

describe("interleave", () => {
  it("puts each paid model above the first lower-rated free one and keeps the free order", () => {
    const paid = subscriptionModels(file, "webdev");
    const free = [{ id: "a", r: 1650 }, { id: "b", r: 1500 }, { id: "c", r: -1 }];
    const rows = interleave(free, paid, (x) => x.r).map((row) => ("free" in row ? row.free.id : row.paid.base));
    expect(rows).toEqual(["claude-opus-5", "a", "gpt-5.6-sol", "claude-sonnet-5", "b", "c"]);
  });
});
