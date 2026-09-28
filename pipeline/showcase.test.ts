import { describe, expect, it } from "vitest";
import { planShowcase, showcaseKey, SHOWCASE_PROMPTS } from "./showcase";

const models = [
  { id: "cheap", neurons: 58 },
  { id: "mid", neurons: 600 },
  { id: "pricey", neurons: 2592 },
];

describe("planShowcase", () => {
  it("fills prompt rows cheapest first and stays within the budget", () => {
    const plan = planShowcase(models, { images: {} }, 3500);
    expect(plan.map((p) => `${p.promptId}:${p.resourceId}`)).toEqual([
      "text:cheap", "text:mid", "text:pricey", "hands:cheap", "layout:cheap",
    ]);
    expect(plan.reduce((s, p) => s + p.neurons, 0)).toBeLessThanOrEqual(3500);
  });

  it("skips images that already exist", () => {
    const images = Object.fromEntries(
      SHOWCASE_PROMPTS.flatMap((p) => ["cheap", "mid"].map((m) => [showcaseKey(m, p.id), { file: "", generated_on: "", neurons: 1, ms: 1 }])),
    );
    expect(planShowcase(models, { images }, 3500).map((p) => p.resourceId)).toEqual(["pricey"]);
  });

  it("still makes one image for a model that costs more than a day's budget", () => {
    expect(planShowcase([{ id: "huge", neurons: 9000 }], { images: {} }, 3500)).toEqual([
      { resourceId: "huge", promptId: "text", neurons: 9000 },
    ]);
  });

  it("returns nothing when everything exists", () => {
    const images = Object.fromEntries(SHOWCASE_PROMPTS.map((p) => [showcaseKey("cheap", p.id), { file: "", generated_on: "", neurons: 1, ms: 1 }]));
    expect(planShowcase([{ id: "cheap", neurons: 58 }], { images })).toEqual([]);
  });
});
