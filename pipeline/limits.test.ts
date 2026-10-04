import { describe, expect, it } from "vitest";
import { effectiveLimits, feedLimits } from "./limits";
import { MODEL_RATE_LIMITS, PROVIDERS } from "./providers";

const OBSERVED = "observed (response headers)";

describe("effectiveLimits", () => {
  const docs = { rpm: 30, rpd: 1_000, tpm: 8_000, tpd: 200_000, source: "https://example.dev/limits" };

  it("uses provider-wide limits as they are", () => {
    const provider = { rpm: 20, rpd: 50, source: "https://example.dev/faq" };
    expect(effectiveLimits(provider, docs, { tpm: 1, source: OBSERVED })).toBe(provider);
  });

  it("takes headers per field and fills the rest from the model's docs", () => {
    expect(effectiveLimits(null, docs, { rpd: 1_000, tpm: 6_000, source: OBSERVED })).toEqual({
      rpm: 30, rpd: 1_000, tpm: 6_000, tpd: 200_000, source: `${OBSERVED}; https://example.dev/limits`,
    });
  });

  it("keeps the docs' note and source when headers add nothing", () => {
    const whisper = { rpm: 20, rpd: 2_000, note: "audio seconds", source: "https://example.dev/limits" };
    expect(effectiveLimits(null, whisper, { source: OBSERVED })).toEqual(whisper);
  });

  it("falls back to whichever exists, or null", () => {
    expect(effectiveLimits(null, docs, undefined)).toBe(docs);
    const seen = { tpm: 50_000, source: OBSERVED };
    expect(effectiveLimits(null, undefined, seen)).toBe(seen);
    expect(effectiveLimits(null, undefined, undefined)).toBeNull();
  });
});

describe("feedLimits", () => {
  it("always has every field, null when unknown", () => {
    expect(feedLimits(null)).toEqual({ rpm: null, rph: null, rpd: null, tpm: null, tpd: null, note: null, source: null });
    expect(feedLimits({ rpd: 200, note: "n", source: "s" })).toEqual({ rpm: null, rph: null, rpd: 200, tpm: null, tpd: null, note: "n", source: "s" });
  });
});

describe("MODEL_RATE_LIMITS", () => {
  it("only covers providers whose limits are per model, each with a source URL", () => {
    for (const [id, l] of Object.entries(MODEL_RATE_LIMITS)) {
      const provider = id.split("/")[0] as keyof typeof PROVIDERS;
      expect(PROVIDERS[provider]?.limit_scope, id).toBe("per-model");
      expect(PROVIDERS[provider].rate_limits, id).toBeNull();
      expect(l?.source, id).toMatch(/^https:\/\//);
    }
  });
});
