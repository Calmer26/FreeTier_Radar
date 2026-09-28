/**
 * Coding-agent readiness (for Cline and similar agents), derived at build time from
 * the resource and its test history. Not stored, so it never creates change events
 * or commits of its own.
 *
 *   yes      tool calling, ≥ 64k context, responded on ≥ 5 of the last 7 test days,
 *            passed at least half its recent tool-call tests, and not evaluation-only
 *   partial  tool calling and ≥ 64k context, but the test history or terms fall short
 *   no       otherwise (including "tool support unknown")
 *
 * Tool calling counts as present when the provider says so OR the model passed our
 * daily tool-call test (Groq publishes nothing, the test shows it).
 *
 * `caveat` carries the rate-limit warning: an agent sends one request per tool step,
 * so a low daily cap shared across all free models runs out within a task or two.
 */

import { PROVIDERS } from "./providers";
import type { Resource, TestResult, ToolResult } from "./types";

export const AGENT_MIN_CONTEXT = 64_000;
export const AGENT_MIN_RESPONDED_DAYS = 5;
export const AGENT_WINDOW_DAYS = 7;
/** Below this many requests per day (or hour) an agent is not practically usable. */
export const AGENT_PRACTICAL_RPD = 200;
export const AGENT_PRACTICAL_RPH = 100;

export interface ToolStats {
  tested: number;
  passed: number;
  /** passed / tested, or null when never tested. Timeouts and server errors don't count. */
  share: number | null;
}

export function toolStats(tools: ToolResult[] = [], window = AGENT_WINDOW_DAYS): ToolStats {
  const recent = tools.slice(-window).filter((t) => t.status !== "error");
  const passed = recent.filter((t) => t.status === "pass").length;
  return { tested: recent.length, passed, share: recent.length ? passed / recent.length : null };
}

export interface AgentReadiness {
  level: "yes" | "partial" | "no";
  reasons: string[];
  caveat: string | null;
}

export function agentReadiness(r: Resource, history: TestResult[] = [], tools: ToolResult[] = []): AgentReadiness {
  if (r.kind !== "chat") return { level: "no", reasons: ["not a chat model"], caveat: null };
  const reasons: string[] = [];
  const ts = toolStats(tools);
  if (r.tool_calling !== true && ts.passed === 0) {
    reasons.push(r.tool_calling === false || ts.tested > 0 ? "no working tool calling" : "tool calling not published or tested yet");
  }
  if ((r.context_length ?? 0) < AGENT_MIN_CONTEXT) reasons.push("context under 64k or unknown");
  if (reasons.length) return { level: "no", reasons, caveat: null };

  const recent = history.slice(-AGENT_WINDOW_DAYS);
  const responded = recent.filter((t) => t.status === "responded").length;
  if (recent.length === 0) reasons.push("not tested yet");
  else if (responded < AGENT_MIN_RESPONDED_DAYS) reasons.push(`responded on ${responded} of the last ${recent.length} test days`);
  if (ts.share !== null && ts.share < 0.5) reasons.push(`passed the tool-call test on ${ts.passed} of ${ts.tested} days`);
  if (r.usage_terms === "evaluation-only") reasons.push("evaluation-only terms");

  let caveat: string | null = null;
  const rpd = r.rate_limits?.rpd;
  const rph = r.rate_limits?.rph;
  if (r.limit_scope === "shared" && rpd != null && rpd < AGENT_PRACTICAL_RPD) {
    caveat = r.provider === "openrouter"
      ? "Free accounts get 50 requests/day across all free models; an agent uses 20–50 per task. Practical use needs the one-time 10-credit purchase (1,000 requests/day)."
      : `${PROVIDERS[r.provider].label} allows ${rpd} requests/day across all free models; an agent uses 20–50 per task.`;
  } else if (rph != null && rph < AGENT_PRACTICAL_RPH) {
    caveat = `${PROVIDERS[r.provider].label} allows ${rph} requests/hour without an account; an agent uses 20–50 per task.`;
  }

  return { level: reasons.length ? "partial" : "yes", reasons, caveat };
}
