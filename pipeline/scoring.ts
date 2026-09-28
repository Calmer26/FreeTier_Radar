/**
 * Impact score (0–100) for an event. Used for sorting and for deciding which events
 * raise a "high-impact" issue for the owner. It is not a value estimate.
 *
 * The weights are published on the methodology page; keep the two in step.
 */

import type { EventType, ObservedModel } from "./types";

export const HIGH_IMPACT_THRESHOLD = 70;

export function impactScore(
  type: EventType,
  m: Pick<ObservedModel, "context_length" | "tool_calling" | "usage_terms" | "input_modalities">,
  field?: string | null,
): number {
  let score: number;
  switch (type) {
    case "NEW":      score = 50; break;
    case "RETURNED": score = 35; break;
    case "REMOVED":  score = 45; break;
    case "CHANGED":
      score = field === "price_type" || field === "usage_terms" || field === "rate_limits" ? 55 : 25;
      break;
  }

  // What makes a free model worth telling people about: agent use and long context.
  if (m.tool_calling) score += 10;
  if ((m.context_length ?? 0) >= 128_000) score += 10;
  if ((m.context_length ?? 0) >= 1_000_000) score += 5;
  if (m.input_modalities?.includes("image")) score += 5;
  if (m.usage_terms === "evaluation-only") score -= 20;

  return Math.max(0, Math.min(100, score));
}
