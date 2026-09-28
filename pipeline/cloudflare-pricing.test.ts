import { describe, expect, it } from "vitest";
import { audioMinuteCost, catalogueLines, chatCost, costNote, formatUsd, freePerDay, imageCost, parsePricingMarkdown } from "./cloudflare-pricing";

// Rows as published on developers.cloudflare.com/workers-ai/platform/pricing/index.md (2026-09-28).
const MD = `
| Model | Price in Tokens | Price in Neurons |
| --- | --- | --- |
| @cf/zai-org/glm-4.7-flash | $0.060 per M input tokens <br> $0.400 per M output tokens | 5500 neurons per M input tokens <br> 36400 neurons per M output tokens |
| @cf/black-forest-labs/flux-1-schnell | $0.0000528 per 512x512 tile <br> $0.0001056 per step | 4.80 neurons per 512x512 tile <br> 9.60 neurons per step |
| @cf/leonardo/phoenix-1.0 | $0.005830 per 512x512 tile <br> $0.000110 per step | 530.00 neurons per 512x512 tile <br> 10.00 neurons per step |
| @cf/black-forest-labs/flux-2-dev | $0.00021 per input 512x512 tile, per step <br> $0.00041 per output 512x512 tile, per step | 18.75 neurons per input 512x512 tile, per step <br> 37.50 neurons per output 512x512 tile, per step |
| @cf/black-forest-labs/flux-2-klein-4b | $0.000059 per input 512x512 tile <br> $0.000287 per output 512x512 tile | 5.37 neurons per input 512x512 tile <br> 26.05 neurons per output 512x512 tile |
| @cf/black-forest-labs/flux-2-klein-9b | $0.015 per first MP (1024x1024) <br> $0.002 per subsequent MP <br> $0.002 per input image MP | 1363.64 neurons per first MP (1024x1024) <br> 181.82 neurons per subsequent MP <br> 181.82 neurons per input image MP |
| @cf/myshell-ai/melotts | $0.0002 per audio minute | 18.63 neurons per audio minute |
| @cf/deepgram/nova-3 (WebSocket) | $0.0092 per audio minute input | 836.36 neurons per audio minute input |
`;

const prices = parsePricingMarkdown(MD);
const p = (m: string) => prices.get(m)!;

describe("parsePricingMarkdown", () => {
  it("reads every price line with its Neurons, and skips WebSocket variants", () => {
    expect(p("@cf/zai-org/glm-4.7-flash")).toEqual([
      { usd: 0.06, unit: "M input tokens", neurons: 5500 },
      { usd: 0.4, unit: "M output tokens", neurons: 36400 },
    ]);
    expect(p("@cf/black-forest-labs/flux-2-klein-9b")).toHaveLength(3);
    expect(prices.has("@cf/deepgram/nova-3")).toBe(false);
  });
});

describe("estimates", () => {
  it("prices a 1024×1024, 4-step image for each pricing shape", () => {
    // FLUX.1 schnell: 4 tiles + 4 steps
    expect(imageCost(p("@cf/black-forest-labs/flux-1-schnell"))!.neurons).toBeCloseTo(4 * 4.8 + 4 * 9.6);
    // Phoenix: tiles dominate
    expect(imageCost(p("@cf/leonardo/phoenix-1.0"))!.usd).toBeCloseTo(4 * 0.00583 + 4 * 0.00011);
    // FLUX.2 dev: output tiles × steps
    expect(imageCost(p("@cf/black-forest-labs/flux-2-dev"))!.usd).toBeCloseTo(4 * 4 * 0.00041);
    // FLUX.2 klein 4B: output tiles only
    expect(imageCost(p("@cf/black-forest-labs/flux-2-klein-4b"))!.usd).toBeCloseTo(4 * 0.000287);
    // FLUX.2 klein 9B: first megapixel, then per extra megapixel
    expect(imageCost(p("@cf/black-forest-labs/flux-2-klein-9b"))!.usd).toBeCloseTo(0.015);
    expect(imageCost(p("@cf/black-forest-labs/flux-2-klein-9b"), { width: 2048, height: 1024, steps: 4 })!.usd).toBeCloseTo(0.017);
  });

  it("prices a typical chat request and an audio minute", () => {
    expect(chatCost(p("@cf/zai-org/glm-4.7-flash"))!.usd).toBeCloseTo((0.06 * 2000 + 0.4 * 500) / 1e6);
    expect(audioMinuteCost(p("@cf/myshell-ai/melotts"))).toEqual({ usd: 0.0002, neurons: 18.63 });
  });

  it("counts what fits in the free Neurons", () => {
    expect(freePerDay(imageCost(p("@cf/black-forest-labs/flux-1-schnell")))).toBe(173);
    expect(freePerDay(imageCost(p("@cf/leonardo/phoenix-1.0")))).toBe(4);
    expect(freePerDay({ usd: 0, neurons: 0 })).toBe(Infinity);
  });

  it("formats small amounts readably", () => {
    expect(formatUsd(0.015)).toBe("$0.015");
    expect(formatUsd(0.000633)).toBe("$0.00063");
    expect(formatUsd(0)).toBe("$0");
  });
});

describe("catalogueLines", () => {
  it("turns the catalogue's beta $0 per step into an unmetered price", () => {
    const lines = catalogueLines('[{"unit": "per step", "price": 0, "currency": "USD"}]')!;
    expect(lines).toEqual([{ usd: 0, unit: "step", neurons: 0 }]);
    expect(freePerDay(imageCost(lines))).toBe(Infinity);
  });
});

describe("costNote", () => {
  it("shows dollars and Neurons per image", () => {
    expect(costNote("image", p("@cf/black-forest-labs/flux-1-schnell"))).toBe("≈ $0.00063 (58 Neurons) per image (1024×1024, 4 steps)");
  });
});
