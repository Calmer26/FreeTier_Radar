/**
 * "Best free X" rankings, from our own data: daily test history, agent readiness,
 * context and terms. No benchmark scores yet, so the order says "works reliably
 * and fits the job", not "is the smartest". The methodology page describes each
 * ordering; keep the two in step.
 *
 * Pure: the site passes in resources with their history.
 */

import { AGENT_MIN_CONTEXT, agentReadiness, toolStats } from "./agent-ready";
import type { ArenaBoard, ArenaScores } from "./arena";
import { imageCost } from "./cloudflare-pricing";
import { lastDays } from "./test-days";
import { transcriptAccuracy } from "./wer";
import type { ModelKind, Resource, TestResult, ToolResult } from "./types";

export const RANKING_WINDOW_DAYS = 30;
/** Fewer tested days than this and a model isn't ranked on reliability yet. */
export const MIN_TESTED_DAYS = 3;

export interface Reliability {
  tested: number;
  responded: number;
  /** responded / tested, or null when untested. */
  share: number | null;
  medianLatencyMs: number | null;
}

/**
 * Over the last RANKING_WINDOW_DAYS test days, both daily tests (morning and peak hours).
 * Rate-limited tests say nothing about the model, so they don't count as tested.
 */
export function reliability(history: TestResult[]): Reliability {
  const recent = lastDays(history, RANKING_WINDOW_DAYS).filter((t) => t.status !== "rate_limited");
  const ok = recent.filter((t) => t.status === "responded");
  const latencies = ok.map((t) => t.latency_ms ?? 0).sort((a, b) => a - b);
  return {
    tested: recent.length,
    responded: ok.length,
    share: recent.length ? ok.length / recent.length : null,
    medianLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
  };
}

export interface RankInput {
  r: Resource;
  history: TestResult[];
  tools?: ToolResult[];
  arena?: ArenaScores | null;
}

export interface RankedModel extends RankInput {
  rel: Reliability;
  /** Set by rank() for experiments: evaluation-only models may take part. */
  allowEval?: boolean;
}

export interface RankingDef {
  slug: string;
  title: string;
  intro: string;
  /** How the list is ordered, in one sentence, for the page and the methodology. */
  order: string;
  filter: (x: RankedModel) => boolean;
  compare: (a: RankedModel, b: RankedModel) => number;
  /**
   * For rankings led by an Arena rating: the board and the rating the order uses, so
   * paid subscription models (opt-in, /settings/) can be slotted in at their height.
   */
  paid?: { board: ArenaBoard; rating: (x: RankedModel) => number };
}

const share = (x: RankedModel) => x.rel.share ?? -1;
const latency = (x: RankedModel) => x.rel.medianLatencyMs ?? Number.MAX_SAFE_INTEGER;
const enoughTests = (x: RankedModel) => x.rel.tested >= MIN_TESTED_DAYS;
/**
 * Rankable: active, not evaluation-only, and not refused by the free tier at the
 * latest test (Gemini lists paid-only models; the test is what reveals them).
 */
const usable = (x: RankedModel) =>
  x.r.status === "active" && (x.allowEval || x.r.usage_terms !== "evaluation-only") && x.history.at(-1)?.status !== "no_free_quota";
const ofKind = (k: ModelKind) => (x: RankedModel) => x.r.kind === k;

/** Most reliable first, then fastest. */
const byReliability = (a: RankedModel, b: RankedModel) => share(b) - share(a) || latency(a) - latency(b);

/** Tool-call pass share over the whole window; -1 when never tested. */
const toolShare = (x: RankedModel) => toolStats(x.tools, RANKING_WINDOW_DAYS).share ?? -1;
const agentLevel = (x: RankedModel) => agentReadiness(x.r, x.history, x.tools).level;

/** Arena rating for coding: WebDev when rated there, else Text; -1 when unrated. */
const codingRating = (x: RankedModel) => x.arena?.boards.webdev?.rating ?? x.arena?.boards.text?.rating ?? -1;
const textRating = (x: RankedModel) => x.arena?.boards.text?.rating ?? -1;
/** Mean word error rate on our clip; unscored models sort last. */
const sttError = (x: RankedModel) => transcriptAccuracy(x.history).mean ?? Number.MAX_SAFE_INTEGER;
const visionRating = (x: RankedModel) => x.arena?.boards.vision?.rating ?? -1;
const imageRating = (x: RankedModel) => x.arena?.boards.text_to_image?.rating ?? -1;
/** Neurons per 1024×1024 image; unknown prices sort last. */
const imageNeurons = (x: RankedModel) => (x.r.pricing ? imageCost(x.r.pricing)?.neurons : null) ?? Number.MAX_SAFE_INTEGER;

export const RANKINGS: RankingDef[] = [
  {
    slug: "coding",
    title: "Best free models for coding",
    intro: "Free chat models for writing and fixing code: in a chat, an editor plugin or a coding agent. Coding quality comes first, then whether the model can call tools and keeps answering.",
    order: "LMArena WebDev rating (Text rating when there's no WebDev one; unrated models after rated ones), then share of days it passed our tool-call test, then how often it answered the daily test. Only models that answered on at least half their test days.",
    filter: (x) => usable(x) && ofKind("chat")(x) && (x.rel.share ?? 0) >= 0.5,
    compare: (a, b) => codingRating(b) - codingRating(a) || toolShare(b) - toolShare(a) || share(b) - share(a),
    paid: { board: "webdev", rating: codingRating },
  },
  {
    slug: "coding-plan",
    title: "Best free models for coding: Plan mode",
    intro: "Coding agents with a plan step (Cline, Roo Code, Kilo Code and others) read your code and work out an approach before changing anything, so reasoning and coding quality matter most. The model still needs tool calling (to read files) and at least 64k of context.",
    order: "LMArena WebDev rating (Text rating when there's no WebDev one; unrated models after rated ones), then context size, then how often the model answered the daily test.",
    filter: (x) => usable(x) && ofKind("chat")(x) && agentLevel(x) !== "no",
    compare: (a, b) => codingRating(b) - codingRating(a) || (b.r.context_length ?? 0) - (a.r.context_length ?? 0) || share(b) - share(a),
    paid: { board: "webdev", rating: codingRating },
  },
  {
    slug: "coding-act",
    title: "Best free models for coding: Act mode",
    intro: "In act mode a coding agent edits files and runs commands through many tool calls in a row, so reliable tool calling and speed matter most.",
    order: "Share of days the model passed our tool-call test, then how often it answered the daily test, then median response time, then LMArena WebDev rating. Only models that passed at least half their tool-call tests.",
    filter: (x) =>
      usable(x) && ofKind("chat")(x) && (x.r.context_length ?? 0) >= AGENT_MIN_CONTEXT && toolShare(x) >= 0.5,
    compare: (a, b) => toolShare(b) - toolShare(a) || share(b) - share(a) || latency(a) - latency(b) || codingRating(b) - codingRating(a),
  },
  {
    slug: "top-rated",
    title: "Highest-rated free chat models",
    intro: "Free chat models ranked by their LMArena Text rating: how people rate their answers in blind comparisons.",
    order: "LMArena Text rating, highest first; only models with a rating. Then reliability over the last 30 days.",
    filter: (x) => usable(x) && ofKind("chat")(x) && textRating(x) > 0,
    compare: (a, b) => textRating(b) - textRating(a) || share(b) - share(a),
    paid: { board: "text", rating: textRating },
  },
  {
    slug: "most-reliable",
    title: "Most reliable free chat models",
    intro: "Free chat models that answered the daily test most often.",
    order: `Share of test days they answered over the last 30 days (at least ${MIN_TESTED_DAYS} tested days), then median response time.`,
    filter: (x) => usable(x) && ofKind("chat")(x) && enoughTests(x),
    compare: byReliability,
  },
  {
    slug: "vision",
    title: "Best free vision models",
    intro: "Free chat models that accept images as input.",
    order: "Reliability over the last 30 days, then LMArena Vision rating, then median response time.",
    filter: (x) => usable(x) && ofKind("chat")(x) && !!x.r.input_modalities?.includes("image"),
    compare: (a, b) => share(b) - share(a) || visionRating(b) - visionRating(a) || latency(a) - latency(b),
  },
  {
    slug: "long-context",
    title: "Best free long-context models",
    intro: "Free chat models with a context window of at least 200k tokens.",
    order: "Context size, then reliability over the last 30 days, then LMArena Text rating, then median response time.",
    filter: (x) => usable(x) && ofKind("chat")(x) && (x.r.context_length ?? 0) >= 200_000,
    compare: (a, b) =>
      (b.r.context_length ?? 0) - (a.r.context_length ?? 0) || share(b) - share(a) || textRating(b) - textRating(a) || latency(a) - latency(b),
  },
  {
    slug: "text-to-speech",
    title: "Best free text-to-speech models",
    intro: "Free TTS models, tested daily by asking them to speak one word.",
    order: "Reliability over the last 30 days, then median response time.",
    filter: (x) => usable(x) && ofKind("tts")(x),
    compare: byReliability,
  },
  {
    slug: "image-generation",
    title: "Best free image generation models",
    intro: "Free text-to-image models (FLUX, Stable Diffusion and more), tested weekly by generating one small picture. Check each model's licence before using images commercially.",
    order: "LMArena text-to-image rating (unrated models after rated ones), then fewer Neurons per image, then reliability over the last 30 days.",
    filter: (x) => usable(x) && ofKind("image")(x),
    compare: (a, b) => imageRating(b) - imageRating(a) || imageNeurons(a) - imageNeurons(b) || byReliability(a, b),
    paid: { board: "text_to_image", rating: imageRating },
  },
  {
    slug: "speech-to-text",
    title: "Best free speech-to-text models",
    intro: "Free STT models, tested daily by transcribing an 18-second clip and scoring the transcript against its script.",
    order: "Reliability over the last 30 days, then transcript accuracy on our 18-second clip (word error rate over the last 7 tests), then median response time.",
    filter: (x) => usable(x) && ofKind("stt")(x),
    compare: (a, b) => share(b) - share(a) || sttError(a) - sttError(b) || latency(a) - latency(b),
  },
];

/** The published rankings leave evaluation-only models out; `allowEval` lets them in (the picker's "just experimenting"). */
export function rank(def: RankingDef, inputs: RankInput[], limit = 25, opts: { allowEval?: boolean } = {}): RankedModel[] {
  return inputs
    .map((x) => ({ ...x, rel: reliability(x.history), allowEval: opts.allowEval }))
    .filter(def.filter)
    .sort((a, b) => def.compare(a, b) || a.r.name.localeCompare(b.r.name))
    .slice(0, limit);
}
