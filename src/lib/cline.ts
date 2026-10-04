/**
 * Coding helpers: the Cline settings snippet for a model, and the coding, Plan and Act
 * rankings and suggested pair, computed once per build.
 */

import { PROVIDERS } from "../../pipeline/providers";
import { rank, RANKINGS, reliability, type RankedModel, type Reliability } from "../../pipeline/rankings";
import { activeModels, type ModelView } from "./data";

/** What to fill in under Cline's API provider settings for this model. */
export function clineSnippet(m: ModelView): string {
  const p = PROVIDERS[m.provider];
  if (m.provider === "openrouter") return `API Provider: OpenRouter\nModel:        ${m.model_id}`;
  const key = p.key_env ? `your ${p.label.split(" (")[0]} API key` : "any text (no key needed)";
  return `API Provider: OpenAI Compatible\nBase URL:     ${p.base_url}\nAPI Key:      ${key}\nModel ID:     ${m.model_id}`;
}

const inputs = activeModels.map((m) => ({ r: m, history: m.tests, tools: m.toolTests, multiTools: m.multiToolTests, arena: m.arena }));
const def = (slug: string) => RANKINGS.find((r) => r.slug === slug)!;

export const planRanking = rank(def("coding-plan"), inputs);
export const actRanking = rank(def("coding-act"), inputs);

export const codingRanking = rank(def("coding"), inputs);

const codingPos = new Map(codingRanking.map((x, i) => [x.r.id, i + 1]));
const planPos = new Map(planRanking.map((x, i) => [x.r.id, i + 1]));
const actPos = new Map(actRanking.map((x, i) => [x.r.id, i + 1]));

/** 1-based positions in the coding, Plan and Act rankings, when the model is in them. */
export function codingFit(id: string): { coding: number | null; plan: number | null; act: number | null } {
  return { coding: codingPos.get(id) ?? null, plan: planPos.get(id) ?? null, act: actPos.get(id) ?? null };
}

/** The strongest Plan model and the strongest Act model, from any provider. */
export const suggestedPair: { plan: RankedModel | null; act: RankedModel | null } = {
  plan: planRanking[0] ?? null,
  act: actRanking[0] ?? null,
};

export interface EvalReasoner {
  m: ModelView;
  /** LMArena WebDev rating, or Text when there's no WebDev one. */
  rating: number;
  board: "WebDev" | "Text";
  rel: Reliability;
}

/**
 * Strong reasoners whose free access is evaluation-only (NVIDIA's API, LLM7, NVIDIA
 * models on Kilo). Not recommended, because the terms rule out production use and
 * the providers log prompts, but shown with their real test record so a visitor can
 * judge them for their own experiments. Ordered by coding rating.
 */
export const evalReasoners: EvalReasoner[] = activeModels
  .filter((m) => m.kind === "chat" && m.testable && m.usage_terms === "evaluation-only")
  .flatMap((m) => {
    const webdev = m.arena?.boards.webdev?.rating;
    const text = m.arena?.boards.text?.rating;
    const rating = webdev ?? text;
    return rating ? [{ m, rating, board: webdev ? ("WebDev" as const) : ("Text" as const), rel: reliability(m.tests) }] : [];
  })
  .sort((a, b) => b.rating - a.rating || (b.rel.share ?? -1) - (a.rel.share ?? -1))
  .slice(0, 12);
