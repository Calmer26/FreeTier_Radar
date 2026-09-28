import { describe, expect, it } from "vitest";
import { arenaIndex, isVariantOf, matchModel, normaliseName, scoresFor, updateAliases, type ArenaFile } from "./arena";

const file: ArenaFile = {
  source: "test",
  fetched_on: "2026-09-28",
  boards: {
    text: {
      published: "2026-09-25",
      models: [
        { name: "gemma-4-31b", org: "google", rating: 1443, rank: 20, votes: 5000 },
        { name: "nvidia-nemotron-3-ultra-550b-a55b-nvfp4", org: "nvidia", rating: 1444, rank: 19, votes: 3000 },
        { name: "gemini-3.8-flash-high", org: "google", rating: 1494, rank: 3, votes: 8000 },
        { name: "gemini-3.8-flash-medium", org: "google", rating: 1480, rank: 9, votes: 2000 },
        { name: "qwen3.8-27b", org: "alibaba", rating: 1441, rank: 22, votes: 4000 },
      ],
    },
    webdev: {
      published: "2026-09-25",
      models: [{ name: "qwen3.8-27b", org: "alibaba", rating: 1591, rank: 10, votes: 900 }],
    },
    agent: {
      published: "2026-09-27",
      models: [{ name: "Inkling Small", org: "thinkingmachines", rating: null, score: 0.05, rank: 12, votes: 300 }],
    },
  },
};

describe("normaliseName", () => {
  it.each([
    ["google/gemma-4-31b-it:free", undefined, "gemma-4-31b"],
    ["nvidia-nemotron-3-ultra-550b-a55b-nvfp4", "nvidia", "nemotron-3-ultra-550b-a55b"],
    ["Inkling Small", "thinkingmachines", "inkling-small"],
    ["gemini-3-flash (thinking-minimal)", "google", "gemini-3-flash-thinking-minimal"],
    ["qwen/qwen3.8-27b:free", undefined, "qwen3.8-27b"],
  ])("%s → %s", (raw, org, out) => {
    expect(normaliseName(raw, org)).toBe(out);
  });
});

describe("matchModel", () => {
  const index = arenaIndex(file);
  it("finds exact matches after normalising", () => {
    expect(matchModel("google/gemma-4-31b-it:free", index)).toEqual({ exact: "gemma-4-31b", near: null });
    expect(matchModel("nvidia/nemotron-3-ultra-550b-a55b:free", index).exact).toBe("nvidia-nemotron-3-ultra-550b-a55b-nvfp4");
    expect(matchModel("thinkingmachines/inkling-small:free", index).exact).toBe("Inkling Small");
  });
  it("offers the most-voted effort variant, flagged as a variant", () => {
    expect(matchModel("gemini-3.8-flash", index)).toEqual({ exact: null, near: "gemini-3.8-flash-high", variant: true });
  });
  it("never offers the shorter name of a different model", () => {
    const idx = arenaIndex({ source: "", fetched_on: "", boards: { text: { published: "", models: [{ name: "gemini-2.5-flash", org: "google", rating: 1, rank: 1, votes: 1 }] } } });
    expect(matchModel("gemini-2.5-flash-lite", idx)).toEqual({ exact: null, near: null });
  });

  it("treats only effort and size words as variants", () => {
    expect(isVariantOf("kimi-k3", "kimi-k3-max")).toBe(true);
    expect(isVariantOf("nemotron-3.5-lightning", "nemotron-3.5-lightning-30b-a3b")).toBe(true);
    expect(isVariantOf("gemini-3-flash", "gemini-3-flash-thinking-minimal")).toBe(true);
    expect(isVariantOf("llama2-70b", "llama2-70b-steerlm-chat")).toBe(false);
    expect(isVariantOf("gemini-3.1-flash-lite", "gemini-3.1-flash-lite-preview")).toBe(false);
    expect(isVariantOf("mistral-large", "mistral-large-3")).toBe(false);
  });

  it("keeps the family name when it equals the organisation", () => {
    const idx = arenaIndex({ source: "", fetched_on: "", boards: { text: { published: "", models: [
      { name: "deepseek-v4.1-flash-max", org: "deepseek", rating: 1465, rank: 5, votes: 900 },
    ] } } });
    expect(matchModel("deepseek-ai/deepseek-v4.1-flash", idx)).toEqual({ exact: null, near: "deepseek-v4.1-flash-max", variant: true });
    expect(matchModel("cline-free/deepseek-v4.1-flash", idx).near).toBe("deepseek-v4.1-flash-max");
  });

  it("returns nothing for unknown models", () => {
    expect(matchModel("acme/unknown-7b:free", index)).toEqual({ exact: null, near: null });
  });
});

describe("updateAliases", () => {
  it("adds exact matches and variants, suggests other near ones, and never touches existing aliases", () => {
    const { aliases, suggestions } = updateAliases(
      { "groq/qwen/qwen3.8-27b": { arena: null, status: "rejected", on: "2026-09-01" } },
      [
        { id: "groq/qwen/qwen3.8-27b", model_id: "qwen/qwen3.8-27b" },
        { id: "openrouter/google/gemma-4-31b-it:free", model_id: "google/gemma-4-31b-it:free" },
        { id: "google-ai-studio/gemini-3.8-flash", model_id: "gemini-3.8-flash" },
      ],
      arenaIndex(file),
      "2026-09-28",
    );
    expect(aliases).toEqual({
      "groq/qwen/qwen3.8-27b": { arena: null, status: "rejected", on: "2026-09-01" },
      "google-ai-studio/gemini-3.8-flash": { arena: "gemini-3.8-flash-high", status: "variant", on: "2026-09-28" },
      "openrouter/google/gemma-4-31b-it:free": { arena: "gemma-4-31b", status: "exact", on: "2026-09-28" },
    });
    expect(suggestions).toEqual([]);
  });
});

describe("scoresFor", () => {
  it("collects every board the model appears on, with rank out of the board size", () => {
    const s = scoresFor("x", { x: { arena: "qwen3.8-27b", status: "confirmed", on: "" } }, file);
    expect(s).toEqual({
      name: "qwen3.8-27b",
      boards: {
        text: { rating: 1441, rank: 22, of: 5, votes: 4000 },
        webdev: { rating: 1591, rank: 10, of: 1, votes: 900 },
      },
      published: "2026-09-25",
    });
  });
  it("finds the same model on boards that spell it differently", () => {
    const s = scoresFor("x", { x: { arena: "inkling-small", status: "exact", on: "" } }, {
      ...file,
      boards: { ...file.boards, text: { published: "2026-09-25", models: [{ name: "inkling-small", org: "thinkingmachines", rating: 1408, rank: 40, votes: 100 }] } },
    });
    expect(Object.keys(s!.boards)).toEqual(["text", "agent"]);
  });

  it("shows nothing for rejected or missing aliases", () => {
    expect(scoresFor("x", { x: { arena: "qwen3.8-27b", status: "rejected", on: "" } }, file)).toBeNull();
    expect(scoresFor("y", {}, file)).toBeNull();
  });
});
