/**
 * "Best free X" rankings, from our own data: daily test history, agent readiness,
 * context and terms. No benchmark scores yet, so the order says "works reliably
 * and fits the job", not "is the smartest". The methodology page describes each
 * ordering; keep the two in step.
 *
 * Pure: the site passes in resources with their history.
 */

import { agentReadiness } from "./agent-ready";
import type { ArenaScores } from "./arena";
import type { ModelKind, Resource, TestResult } from "./types";

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

/** Rate-limited days say nothing about the model, so they don't count as tested. */
export function reliability(history: TestResult[]): Reliability {
  const recent = history.slice(-RANKING_WINDOW_DAYS).filter((t) => t.status !== "rate_limited");
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
  arena?: ArenaScores | null;
}

export interface RankedModel extends RankInput {
  rel: Reliability;
}

export interface RankingDef {
  slug: string;
  title: string;
  intro: string;
  /** How the list is ordered, in one sentence, for the page and the methodology. */
  order: string;
  filter: (x: RankedModel) => boolean;
  compare: (a: RankedModel, b: RankedModel) => number;
}

const share = (x: RankedModel) => x.rel.share ?? -1;
const latency = (x: RankedModel) => x.rel.medianLatencyMs ?? Number.MAX_SAFE_INTEGER;
const enoughTests = (x: RankedModel) => x.rel.tested >= MIN_TESTED_DAYS;
const usable = (x: RankedModel) => x.r.status === "active" && x.r.usage_terms !== "evaluation-only";
const ofKind = (k: ModelKind) => (x: RankedModel) => x.r.kind === k;

/** Most reliable first, then fastest. */
const byReliability = (a: RankedModel, b: RankedModel) => share(b) - share(a) || latency(a) - latency(b);

/** Arena rating for coding: WebDev when rated there, else Text; -1 when unrated. */
const codingRating = (x: RankedModel) => x.arena?.boards.webdev?.rating ?? x.arena?.boards.text?.rating ?? -1;
const textRating = (x: RankedModel) => x.arena?.boards.text?.rating ?? -1;

export const RANKINGS: RankingDef[] = [
  {
    slug: "coding-agents",
    title: "Best free models for coding agents",
    intro: "Free chat models that can drive Cline and similar agents: tool calling and at least 64k of context.",
    order: "Agent-ready models first; then by LMArena WebDev rating (Text rating when there's no WebDev one; unrated models after rated ones); then by how often they answered the daily test over the last 30 days; then by context size.",
    filter: (x) => usable(x) && ofKind("chat")(x) && agentReadiness(x.r, x.history).level !== "no",
    compare: (a, b) => {
      const level = (x: RankedModel) => (agentReadiness(x.r, x.history).level === "yes" ? 1 : 0);
      return level(b) - level(a) || codingRating(b) - codingRating(a) || share(b) - share(a) ||
        (b.r.context_length ?? 0) - (a.r.context_length ?? 0);
    },
  },
  {
    slug: "top-rated",
    title: "Highest-rated free chat models",
    intro: "Free chat models ranked by their LMArena Text rating: how people rate their answers in blind comparisons.",
    order: "LMArena Text rating, highest first; only models with a rating. Then reliability over the last 30 days.",
    filter: (x) => usable(x) && ofKind("chat")(x) && textRating(x) > 0,
    compare: (a, b) => textRating(b) - textRating(a) || share(b) - share(a),
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
    order: "Reliability over the last 30 days, then median response time.",
    filter: (x) => usable(x) && ofKind("chat")(x) && !!x.r.input_modalities?.includes("image"),
    compare: byReliability,
  },
  {
    slug: "long-context",
    title: "Best free long-context models",
    intro: "Free chat models with a context window of at least 200k tokens.",
    order: "Context size, then reliability over the last 30 days.",
    filter: (x) => usable(x) && ofKind("chat")(x) && (x.r.context_length ?? 0) >= 200_000,
    compare: (a, b) => (b.r.context_length ?? 0) - (a.r.context_length ?? 0) || share(b) - share(a),
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
    slug: "speech-to-text",
    title: "Best free speech-to-text models",
    intro: "Free STT models, tested daily by transcribing an 18-second clip.",
    order: "Reliability over the last 30 days, then median response time.",
    filter: (x) => usable(x) && ofKind("stt")(x),
    compare: byReliability,
  },
];

export function rank(def: RankingDef, inputs: RankInput[], limit = 25): RankedModel[] {
  return inputs
    .map((x) => ({ ...x, rel: reliability(x.history) }))
    .filter(def.filter)
    .sort((a, b) => def.compare(a, b) || a.r.name.localeCompare(b.r.name))
    .slice(0, limit);
}
