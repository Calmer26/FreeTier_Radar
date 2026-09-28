/**
 * Cloudflare Workers AI prices and cost estimates.
 *
 * The model catalogue lacks prices for several models (all FLUX ones), so prices come
 * from Cloudflare's pricing page, which is also published as Markdown with one table
 * row per model: "| @cf/model | $X per unit <br> … | N neurons per unit <br> … |".
 * Checked 2026-09-28. Free plan: 10,000 Neurons a day; paid: $0.011 per 1,000 Neurons.
 *
 * Pure apart from the fetch in fetchCloudflarePricing(); no Node-only imports, so the
 * site and the playground can use the estimates.
 */

export const PRICING_MD_URL = "https://developers.cloudflare.com/workers-ai/platform/pricing/index.md";
export const FREE_NEURONS_PER_DAY = 10_000;

import type { ModelKind, PriceLine } from "./types";
export type { PriceLine };

/** Model name → its price lines, from the pricing page's Markdown tables. */
export function parsePricingMarkdown(md: string): Map<string, PriceLine[]> {
  const out = new Map<string, PriceLine[]>();
  for (const line of md.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    // ["", "@cf/…", "$… per … <br> …", "N neurons per … <br> …", ""]
    if (cells.length < 4 || !cells[1].startsWith("@cf/")) continue;
    const name = cells[1].replace(/\s*\(.*\)$/, "");
    if (cells[1].includes("(")) continue; // e.g. "(WebSocket)" variants: not what the REST API bills
    const usd = cells[2].split(/<br\s*\/?>/i).map((s) => s.trim());
    const neurons = cells[3].split(/<br\s*\/?>/i).map((s) => s.trim());
    const lines: PriceLine[] = usd.flatMap((u, i) => {
      const m = u.match(/^\$([\d.]+)\s+per\s+(.+)$/i);
      if (!m) return [];
      const n = neurons[i]?.replace(/,/g, "").match(/^([\d.]+)\s+neurons/i);
      return [{ usd: Number(m[1]), unit: m[2].trim(), neurons: n ? Number(n[1]) : null }];
    });
    if (lines.length) out.set(name, lines);
  }
  return out;
}

/**
 * The model catalogue's own price property, as price lines. Used when the pricing page
 * doesn't list a model (the beta Stable Diffusion models: "$0 per step"). No Neurons.
 */
export function catalogueLines(price: unknown): PriceLine[] | null {
  let list: Array<{ unit?: string; price?: number }> = [];
  try {
    list = typeof price === "string" ? JSON.parse(price) : Array.isArray(price) ? price : [];
  } catch {
    return null;
  }
  const lines = list
    .filter((l) => typeof l.price === "number" && l.unit)
    .map((l) => ({ usd: l.price!, unit: l.unit!.replace(/^per\s+/i, ""), neurons: l.price === 0 ? 0 : null }));
  return lines.length ? lines : null;
}

export async function fetchCloudflarePricing(): Promise<Map<string, PriceLine[]>> {
  const res = await fetch(PRICING_MD_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`pricing page returned ${res.status}`);
  return parsePricingMarkdown(await res.text());
}

const find = (lines: PriceLine[], re: RegExp) => lines.find((l) => re.test(l.unit));

export interface ImageSettings {
  width: number;
  height: number;
  steps: number;
}

/** Default settings for the per-image estimate shown on the site. */
export const DEFAULT_IMAGE: ImageSettings = { width: 1024, height: 1024, steps: 4 };

export interface Estimate {
  usd: number;
  neurons: number | null;
}

/**
 * Cost of one generated image. Handles the three pricing shapes on the page:
 * per 512×512 tile (+ per step), per output tile per step (FLUX.2 dev), and per
 * megapixel (FLUX.2 klein 9B). Null when a model has no image price.
 */
export function imageCost(lines: PriceLine[], s: ImageSettings = DEFAULT_IMAGE): Estimate | null {
  const tiles = Math.ceil(s.width / 512) * Math.ceil(s.height / 512);
  const mp = (s.width * s.height) / (1024 * 1024);
  const add = (acc: Estimate, l: PriceLine | undefined, times: number): Estimate => {
    if (!l) return acc;
    return { usd: acc.usd + l.usd * times, neurons: acc.neurons == null || l.neurons == null ? null : acc.neurons + l.neurons * times };
  };
  let e: Estimate = { usd: 0, neurons: 0 };
  let priced = false;

  const firstMp = find(lines, /first mp/i);
  if (firstMp) {
    e = add(e, firstMp, 1);
    e = add(e, find(lines, /subsequent mp/i), Math.max(0, Math.ceil(mp) - 1));
    return e;
  }
  const outTilePerStep = find(lines, /output .*tile, per step/i);
  if (outTilePerStep) return add(e, outTilePerStep, tiles * s.steps);
  const outTile = find(lines, /output .*tile/i);
  if (outTile) return add(e, outTile, tiles);
  const tile = find(lines, /^512x512 tile$/i);
  if (tile) { e = add(e, tile, tiles); priced = true; }
  const step = find(lines, /^step$/i);
  if (step) { e = add(e, step, s.steps); priced = true; }
  return priced ? e : null;
}

/** Cost of one typical chat request: 2,000 tokens in, 500 out. */
export const TYPICAL_REQUEST = { input: 2_000, output: 500 };

export function chatCost(lines: PriceLine[]): Estimate | null {
  const input = find(lines, /^m input tokens$/i);
  const output = find(lines, /^m output tokens$/i);
  if (!input) return null;
  const inPart = (input.usd * TYPICAL_REQUEST.input) / 1e6;
  const outPart = output ? (output.usd * TYPICAL_REQUEST.output) / 1e6 : 0;
  const neurons = input.neurons != null ? (input.neurons * TYPICAL_REQUEST.input) / 1e6 + (output?.neurons ?? 0) * TYPICAL_REQUEST.output / 1e6 : null;
  return { usd: inPart + outPart, neurons };
}

/** Cost of one audio minute (TTS output or STT input). */
export function audioMinuteCost(lines: PriceLine[]): Estimate | null {
  const l = find(lines, /audio minute/i);
  return l ? { usd: l.usd, neurons: l.neurons } : null;
}

/** How many of something fit in the free daily Neurons. */
export function freePerDay(e: Estimate | null): number | null {
  if (!e || !e.neurons) return e && e.usd === 0 ? Infinity : null;
  return Math.floor(FREE_NEURONS_PER_DAY / e.neurons);
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd >= 0.01) return `$${Number(usd.toFixed(3))}`;
  // Two significant digits, written out in full (no 5.3e-7).
  const digits = 1 - Math.floor(Math.log10(usd));
  return `$${usd.toFixed(Math.min(digits, 10)).replace(/0+$/, "")}`;
}

/** One-line "how far does free go" for a model, or null when it can't be estimated. */
export function allowanceNote(kind: ModelKind, lines: PriceLine[] | null | undefined): string | null {
  if (!lines?.length) return null;
  if (lines.every((l) => l.usd === 0)) return "Listed at $0 (beta), but it still stops once the daily free Neurons are used up";
  const n = (e: Estimate | null) => freePerDay(e);
  const fmt = (x: number) => (x >= 10_000 ? `${Math.round(x / 1000)}k` : String(x));
  if (kind === "image") {
    const per = n(imageCost(lines));
    return per != null ? `≈ ${fmt(per)} images (1024×1024, 4 steps) a day within the free Neurons` : null;
  }
  if (kind === "chat") {
    const per = n(chatCost(lines));
    return per != null ? `≈ ${fmt(per)} typical requests (2,000 tokens in, 500 out) a day within the free Neurons` : null;
  }
  const per = n(audioMinuteCost(lines));
  return per != null ? `≈ ${fmt(per)} audio minutes a day within the free Neurons` : null;
}

/** "58 Neurons" / "2,592 Neurons"; empty when unknown. */
export function formatNeurons(n: number | null | undefined): string {
  if (n == null) return "";
  return `${n < 10 ? +n.toFixed(1) : Math.round(n).toLocaleString("en")} Neurons`;
}

/** The paid price of one typical unit of use, e.g. "≈ $0.00063 (58 Neurons) per image (1024×1024, 4 steps)". */
export function costNote(kind: ModelKind, lines: PriceLine[] | null | undefined): string | null {
  if (!lines?.length) return null;
  const e = kind === "image" ? imageCost(lines) : kind === "chat" ? chatCost(lines) : audioMinuteCost(lines);
  if (!e) return null;
  const what = kind === "image" ? "image (1024×1024, 4 steps)" : kind === "chat" ? "typical request (2,000 tokens in, 500 out)" : "audio minute";
  const neurons = e.neurons != null ? ` (${formatNeurons(e.neurons)})` : "";
  return `≈ ${formatUsd(e.usd)}${neurons} per ${what}`;
}
