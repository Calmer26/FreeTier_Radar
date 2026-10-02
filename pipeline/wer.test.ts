import { describe, expect, it } from "vitest";
import { STT_REFERENCE, wordErrorRate, words } from "./wer";

describe("wordErrorRate", () => {
  it("ignores case and punctuation", () => {
    expect(words("Edge, you... COULD not!")).toEqual(["edge", "you", "could", "not"]);
    expect(wordErrorRate(STT_REFERENCE.toUpperCase().replace(/[.,]/g, ""))).toBe(0);
  });

  it("counts substitutions, dropped and added words against the script length", () => {
    const n = words(STT_REFERENCE).length;
    expect(wordErrorRate(STT_REFERENCE.replace("Poland", "Holland"))).toBeCloseTo(1 / n);
    expect(wordErrorRate(STT_REFERENCE.replace("Follow for more space facts.", ""))).toBeCloseTo(5 / n);
    expect(wordErrorRate(`Hello. ${STT_REFERENCE}`)).toBeCloseTo(1 / n);
    expect(wordErrorRate("")).toBe(1);
  });
});

describe("transcriptAccuracy", () => {
  it("averages the scored tests in the window and ignores unscored ones", async () => {
    const { transcriptAccuracy } = await import("./wer");
    expect(transcriptAccuracy([{}, { wer: 0.1 }, { wer: 0.3 }], 7)).toEqual({ latest: 0.3, mean: 0.2, scored: 2 });
    expect(transcriptAccuracy([{ wer: 0.5 }, { wer: 0 }], 1)).toEqual({ latest: 0, mean: 0, scored: 1 });
    expect(transcriptAccuracy([])).toEqual({ latest: null, mean: null, scored: 0 });
  });
});
