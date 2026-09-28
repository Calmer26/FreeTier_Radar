/**
 * The same model at different providers ("siblings"): OpenRouter's
 * `qwen/qwen3.8-27b:free`, Groq's `qwen/qwen3.8-27b` and Cline's
 * `cline-free/deepseek-v4.1-flash` vs NVIDIA's `deepseek-ai/deepseek-v4.1-flash`.
 * Matched on kind plus the normalised name used for Arena matching.
 *
 * Pure, so the site and tests share it. Type-only imports apart from normaliseName.
 */

import { normaliseName } from "./arena";
import type { ModelKind, ProviderId, ResourceStatus } from "./types";

interface Sibling {
  id: string;
  provider: ProviderId;
  kind: ModelKind;
  model_id: string;
  status: ResourceStatus;
  context_length: number | null;
}

export function sameModelKey(r: Pick<Sibling, "kind" | "model_id">): string {
  return `${r.kind}|${normaliseName(r.model_id)}`;
}

/** Id → ids of the same model at other providers. Removed models are left out. */
export function siblingIds(items: Sibling[]): Map<string, string[]> {
  const byKey = new Map<string, Sibling[]>();
  for (const r of items) {
    if (r.status === "removed") continue;
    const key = sameModelKey(r);
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  const out = new Map<string, string[]>();
  for (const group of byKey.values()) {
    for (const r of group) out.set(r.id, group.filter((o) => o.id !== r.id).map((o) => o.id));
  }
  return out;
}

/**
 * A context size for a model whose provider publishes none, borrowed from the same
 * model elsewhere. The smallest known value is used: providers sometimes cap a free
 * variant below the model's maximum, and overstating context would be worse than
 * understating it. Null when the model has its own value or no sibling has one.
 */
export function borrowedContext(r: Sibling, siblings: Sibling[]): { context_length: number; from: ProviderId } | null {
  if (r.context_length) return null;
  const known = siblings.filter((s) => s.context_length).sort((a, b) => a.context_length! - b.context_length!);
  return known.length ? { context_length: known[0].context_length!, from: known[0].provider } : null;
}
