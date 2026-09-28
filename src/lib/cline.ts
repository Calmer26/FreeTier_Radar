/**
 * Cline helpers: the settings snippet for a model, and the Plan/Act rankings and
 * suggested pair, computed once per build.
 */

import { PROVIDERS } from "../../pipeline/providers";
import { rank, RANKINGS, type RankedModel } from "../../pipeline/rankings";
import { activeModels, type ModelView } from "./data";

/** What to fill in under Cline's API provider settings for this model. */
export function clineSnippet(m: ModelView): string {
  const p = PROVIDERS[m.provider];
  if (m.provider === "openrouter") return `API Provider: OpenRouter\nModel:        ${m.model_id}`;
  const key = p.key_env ? `your ${p.label.split(" (")[0]} API key` : "any text (no key needed)";
  return `API Provider: OpenAI Compatible\nBase URL:     ${p.base_url}\nAPI Key:      ${key}\nModel ID:     ${m.model_id}`;
}

const inputs = activeModels.map((m) => ({ r: m, history: m.tests, tools: m.toolTests, arena: m.arena }));
const def = (slug: string) => RANKINGS.find((r) => r.slug === slug)!;

export const planRanking = rank(def("cline-plan"), inputs);
export const actRanking = rank(def("cline-act"), inputs);

const planPos = new Map(planRanking.map((x, i) => [x.r.id, i + 1]));
const actPos = new Map(actRanking.map((x, i) => [x.r.id, i + 1]));

/** 1-based positions in the Plan and Act rankings, when the model is in them. */
export function clineFit(id: string): { plan: number | null; act: number | null } {
  return { plan: planPos.get(id) ?? null, act: actPos.get(id) ?? null };
}

/** The strongest Plan model and the strongest Act model, from any provider. */
export const suggestedPair: { plan: RankedModel | null; act: RankedModel | null } = {
  plan: planRanking[0] ?? null,
  act: actRanking[0] ?? null,
};
