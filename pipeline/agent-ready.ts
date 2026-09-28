/**
 * Coding-agent readiness (for Cline and similar agents), derived at build time from
 * the resource and its test history. Not stored, so it never creates change events
 * or commits of its own.
 *
 *   yes      tool calling, ≥ 64k context, responded on ≥ 5 of the last 7 test days,
 *            and not evaluation-only
 *   partial  tool calling and ≥ 64k context, but the test history or terms fall short
 *   no       otherwise (including "tool support unknown")
 *
 * `caveat` carries the rate-limit warning: an agent sends one request per tool step,
 * so a low daily cap shared across all free models runs out within a task or two.
 */

import { PROVIDERS } from "./providers";
import type { Resource, TestResult } from "./types";

export const AGENT_MIN_CONTEXT = 64_000;
export const AGENT_MIN_RESPONDED_DAYS = 5;
export const AGENT_WINDOW_DAYS = 7;
/** Below this many requests per day an agent is not practically usable. */
export const AGENT_PRACTICAL_RPD = 200;

export interface AgentReadiness {
  level: "yes" | "partial" | "no";
  reasons: string[];
  caveat: string | null;
}

export function agentReadiness(r: Resource, history: TestResult[] = []): AgentReadiness {
  if (r.kind !== "chat") return { level: "no", reasons: ["not a chat model"], caveat: null };
  const reasons: string[] = [];
  if (r.tool_calling !== true) reasons.push(r.tool_calling === false ? "no tool calling" : "tool calling not published");
  if ((r.context_length ?? 0) < AGENT_MIN_CONTEXT) reasons.push("context under 64k or unknown");
  if (reasons.length) return { level: "no", reasons, caveat: null };

  const recent = history.slice(-AGENT_WINDOW_DAYS);
  const responded = recent.filter((t) => t.status === "responded").length;
  if (recent.length === 0) reasons.push("not tested yet");
  else if (responded < AGENT_MIN_RESPONDED_DAYS) reasons.push(`responded on ${responded} of the last ${recent.length} test days`);
  if (r.usage_terms === "evaluation-only") reasons.push("evaluation-only terms");

  let caveat: string | null = null;
  const rpd = r.rate_limits?.rpd;
  if (r.limit_scope === "shared" && rpd != null && rpd < AGENT_PRACTICAL_RPD) {
    caveat = r.provider === "openrouter"
      ? "Free accounts get 50 requests/day across all free models; an agent uses 20–50 per task. Practical use needs the one-time 10-credit purchase (1,000 requests/day)."
      : `${PROVIDERS[r.provider].label} allows ${rpd} requests/day across all free models; an agent uses 20–50 per task.`;
  }

  return { level: reasons.length ? "partial" : "yes", reasons, caveat };
}
