/**
 * The working-models feed (/api/working.json): free models that answered the latest
 * daily test, ready for an app to pick from and fall back through. Pure; the site
 * passes in its model views.
 *
 * Only places an app may use: evaluation-only providers and Cline (usable only inside
 * its extension) are left out. Everything else is in /api/resources.json.
 */

import { toolStats, AGENT_MIN_CONTEXT } from "./agent-ready";
import type { ArenaScores } from "./arena";
import { usableNow, type FamilyMember } from "./families";
import { PROVIDERS } from "./providers";
import { reliability, RANKING_WINDOW_DAYS } from "./rankings";
import type { DataLogging, LimitScope, ModelKind, RateLimits } from "./types";

export interface WorkingInput extends FamilyMember {
  context_length: number | null;
  input_modalities: string[] | null;
  limits: RateLimits | null;
  limit_scope: LimitScope;
  data_logging: DataLogging;
  arena: ArenaScores | null;
  href: string;
}

export type ApiStyle = "openai" | "cloudflare-run" | "gemini-native";

export interface WorkingModel {
  provider: string;
  model_id: string;
  name: string;
  /** "openai": POST `endpoint` with the OpenAI request shape. Others: see `page`. */
  api: ApiStyle;
  /** Full URL. Cloudflare's contains `{account}`: your account id. */
  endpoint: string;
  /** Env var name we use for the key; null when no key is needed. */
  key_env: string | null;
  context_length: number | null;
  answered: { days: number; of: number; share: number | null };
  median_latency_ms: number | null;
  tool_calls: { passed: number; of: number } | null;
  last_test_at: string;
  limits: RateLimits | null;
  limit_scope: LimitScope;
  data_logging: DataLogging;
  arena_text: number | null;
  page: string;
}

/** Where to send a request for this model, and in which shape. */
export function endpointFor(m: Pick<WorkingInput, "provider" | "kind" | "model_id">): { api: ApiStyle; endpoint: string } {
  const base = PROVIDERS[m.provider].base_url;
  if (m.kind === "chat") return { api: "openai", endpoint: `${base}/chat/completions` };
  if (m.provider === "cloudflare") return { api: "cloudflare-run", endpoint: `${base.replace(/\/v1$/, "")}/run/${m.model_id}` };
  if (m.provider === "google-ai-studio") {
    return { api: "gemini-native", endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${m.model_id}:generateContent` };
  }
  return { api: "openai", endpoint: `${base}/${m.kind === "tts" ? "audio/speech" : m.kind === "stt" ? "audio/transcriptions" : "images/generations"}` };
}

function entry(m: WorkingInput, siteUrl: string): WorkingModel {
  const rel = reliability(m.tests);
  const tools = toolStats(m.toolTests, RANKING_WINDOW_DAYS);
  return {
    provider: m.provider,
    model_id: m.model_id,
    name: m.name,
    ...endpointFor(m),
    key_env: PROVIDERS[m.provider].key_env,
    context_length: m.context_length,
    answered: { days: rel.responded, of: rel.tested, share: rel.share == null ? null : Math.round(rel.share * 100) / 100 },
    median_latency_ms: rel.medianLatencyMs,
    tool_calls: m.kind === "chat" && tools.tested ? { passed: tools.passed, of: tools.tested } : null,
    last_test_at: m.tests.at(-1)!.at,
    limits: m.limits,
    limit_scope: m.limit_scope,
    data_logging: m.data_logging,
    arena_text: m.arena?.boards.text?.rating ?? null,
    page: new URL(m.href, siteUrl).href,
  };
}

const share = (m: WorkingInput) => reliability(m.tests).share ?? -1;
const latency = (m: WorkingInput) => reliability(m.tests).medianLatencyMs ?? Number.MAX_SAFE_INTEGER;
const toolShare = (m: WorkingInput) => toolStats(m.toolTests, RANKING_WINDOW_DAYS).share ?? -1;
const arena = (m: WorkingInput) => m.arena?.boards.text?.rating ?? -1;

/** General order: answers most often, then rated higher, then faster. */
const general = (a: WorkingInput, b: WorkingInput) => share(b) - share(a) || arena(b) - arena(a) || latency(a) - latency(b);
/** Agent order: passes tool calls most often, then answers most often, then faster. */
const agentOrder = (a: WorkingInput, b: WorkingInput) => toolShare(b) - toolShare(a) || general(a, b);

export interface WorkingFeed {
  generated_at: string;
  about: string;
  lists: Record<"chat" | "agent" | "vision" | Exclude<ModelKind, "chat">, WorkingModel[]>;
}

export function workingFeed(models: WorkingInput[], siteUrl: string, now: string): WorkingFeed {
  const ok = models.filter(usableNow);
  const chat = ok.filter((m) => m.kind === "chat");
  const list = (xs: WorkingInput[], order = general) => [...xs].sort(order).map((m) => entry(m, siteUrl));
  return {
    generated_at: now,
    about: `Free models that answered the latest daily test, best first. Evaluation-only and Cline-only models are left out. Docs: ${new URL("/developers/", siteUrl).href}`,
    lists: {
      chat: list(chat),
      agent: list(chat.filter((m) => toolShare(m) >= 0.5 && (m.context_length ?? 0) >= AGENT_MIN_CONTEXT), agentOrder),
      vision: list(chat.filter((m) => m.input_modalities?.includes("image"))),
      tts: list(ok.filter((m) => m.kind === "tts")),
      stt: list(ok.filter((m) => m.kind === "stt")),
      image: list(ok.filter((m) => m.kind === "image")),
    },
  };
}
