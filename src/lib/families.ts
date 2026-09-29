/** Model families for the "Where is X free?" pages, computed once per build. */

import { families, type Family } from "../../pipeline/families";
import { activeModels, type ModelView } from "./data";

export type ModelFamily = Family<ModelView>;

/** Every model on the site, grouped by model; best place to use it first. */
export const allFamilies: ModelFamily[] = families(activeModels);

/** Families free at more than one provider: these get their own page. */
export const sharedFamilies: ModelFamily[] = allFamilies.filter((f) => new Set(f.members.map((m) => m.provider)).size > 1);

const familyOf = new Map(sharedFamilies.flatMap((f) => f.members.map((m) => [m.id, f] as const)));

/** The family page for a model, when its model is free at more than one provider. */
export function familyFor(id: string): ModelFamily | null {
  return familyOf.get(id) ?? null;
}
