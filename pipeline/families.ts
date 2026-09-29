/**
 * Model families: the same model at every provider that has it free ("Where is
 * Qwen3.8 27B free?"), and the order of the places to use it. Built on the sibling
 * key, so a family is exactly a sibling group. Pure; the site passes in its views.
 */

import { sameModelKey } from "./siblings";
import type { ModelKind, ProviderId, TestResult, ToolResult, UsageTerms } from "./types";
import { reliability, RANKING_WINDOW_DAYS } from "./rankings";
import { toolStats } from "./agent-ready";

export interface FamilyMember {
  id: string;
  provider: ProviderId;
  kind: ModelKind;
  model_id: string;
  name: string;
  usage_terms: UsageTerms;
  testable: boolean;
  tests: TestResult[];
  toolTests: ToolResult[];
  /** LMArena link, when there is one: its name is often the cleanest. */
  arena?: { name: string } | null;
}

export interface Family<T extends FamilyMember> {
  key: string;
  slug: string;
  name: string;
  kind: ModelKind;
  /** Best place to use it first (see `placeOrder`). */
  members: T[];
}

/** "Qwen: Qwen3.8 27B (free)" → "Qwen3.8 27B"; "openai/gpt-oss-20b (OpenAI)" → "openai/gpt-oss-20b". */
export function cleanName(name: string): string {
  return name
    .replace(/\s*\((free|new)\)\s*$/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "") // trailing organisation, e.g. "(Alibaba Cloud)"
    .replace(/^[^:/]+:\s*/, "") // leading "Org: "
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A readable name for the family: a display name (capitals, no slash) from a provider
 * or LMArena, preferring ones with spaces ("Deepseek V4.1 Flash" over "Deepseek-v4.1-Flash");
 * else the model id's last part.
 */
export function familyName(members: Pick<FamilyMember, "name" | "model_id" | "arena">[]): string {
  const cleaned = [...members.map((m) => m.name), ...members.flatMap((m) => (m.arena ? [m.arena.name] : []))].map(cleanName);
  const display = cleaned
    .filter((n) => !n.includes("/") && /[A-Z]/.test(n))
    .sort((a, b) => Number(b.includes(" ")) - Number(a.includes(" ")) || a.length - b.length)[0];
  if (display) return display;
  const id = members[0].model_id;
  return id.slice(id.lastIndexOf("/") + 1).replace(/:free$/, "");
}

/** URL slug from the family key: "chat|qwen3.8-27b" → "qwen3-8-27b"; other kinds get their kind appended. */
export function familySlug(key: string): string {
  const [kind, name] = key.split("|");
  const base = name.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return kind === "chat" ? base : `${base}-${kind}`;
}

/** Usable here and now: callable from outside, not evaluation-only, and it answered the latest test. */
export function usableNow(m: FamilyMember): boolean {
  const last = m.tests.at(-1)?.status;
  return m.testable && m.usage_terms !== "evaluation-only" && (last === "responded" || last === "slow");
}

/**
 * Best place first: usable now, then reliability over the ranking window, then
 * tool-call pass share, then median speed. Evaluation-only and Cline-only places go
 * last because they can't back a real app.
 */
export function placeOrder(a: FamilyMember, b: FamilyMember): number {
  const tier = (m: FamilyMember) => (usableNow(m) ? 0 : m.testable && m.usage_terms !== "evaluation-only" ? 1 : 2);
  const ra = reliability(a.tests);
  const rb = reliability(b.tests);
  const tools = (m: FamilyMember) => toolStats(m.toolTests, RANKING_WINDOW_DAYS).share ?? -1;
  return (
    tier(a) - tier(b) ||
    (rb.share ?? -1) - (ra.share ?? -1) ||
    tools(b) - tools(a) ||
    (ra.medianLatencyMs ?? Number.MAX_SAFE_INTEGER) - (rb.medianLatencyMs ?? Number.MAX_SAFE_INTEGER) ||
    a.provider.localeCompare(b.provider)
  );
}

/** Every family among `models`, best place first within each. */
export function families<T extends FamilyMember>(models: T[]): Family<T>[] {
  const byKey = new Map<string, T[]>();
  for (const m of models) byKey.set(sameModelKey(m), [...(byKey.get(sameModelKey(m)) ?? []), m]);
  return [...byKey.entries()]
    .map(([key, members]) => ({
      key,
      slug: familySlug(key),
      name: familyName(members),
      kind: members[0].kind,
      members: [...members].sort(placeOrder),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
