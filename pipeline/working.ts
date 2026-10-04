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
import { feedLimits, type FeedLimits } from "./limits";
import { PROVIDERS } from "./providers";
import { reliability, RANKING_WINDOW_DAYS } from "./rankings";
import { workingSearch, type SearchView, type WorkingSearch } from "./search";
import type { DataLogging, JsonResult, LimitScope, ModelKind, RateLimits, ToolResult, UsageTerms } from "./types";

export interface WorkingInput extends FamilyMember {
  multiToolTests: ToolResult[];
  jsonTests: JsonResult[];
  context_length: number | null;
  input_modalities: string[] | null;
  limits: RateLimits | null;
  limit_scope: LimitScope;
  data_logging: DataLogging;
  arena: ArenaScores | null;
  href: string;
}

export type ApiStyle = "openai" | "cloudflare-run" | "gemini-native" | "elevenlabs" | "speechify" | "cartesia";

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
  /** Multi-turn tool test: sends the tool result back, expects a final answer that uses it. */
  multi_tool_calls: { passed: number; of: number } | null;
  /**
   * JSON-schema output test. `response_format`: what the provider accepted at the latest
   * test ("json_schema", or "json_object" after refusing json_schema; null: neither).
   */
  json_schema: { passed: number; of: number; response_format: JsonResult["mode"] | null } | null;
  last_test_at: string;
  /** Always an object; each number is null when unknown (not published, not seen in headers). */
  limits: FeedLimits;
  limit_scope: LimitScope;
  /** "non-commercial": fine for personal projects, not for a product (ElevenLabs' Free plan). */
  usage_terms: UsageTerms;
  data_logging: DataLogging;
  arena_text: number | null;
  page: string;
}

/** Where to send a request for this model, and in which shape. */
export function endpointFor(m: Pick<WorkingInput, "provider" | "kind" | "model_id">): { api: ApiStyle; endpoint: string } {
  const base = PROVIDERS[m.provider].base_url;
  if (m.kind === "chat") return { api: "openai", endpoint: `${base}/chat/completions` };
  if (m.provider === "cloudflare") return { api: "cloudflare-run", endpoint: `${base.replace(/\/v1$/, "")}/run/${m.model_id}` };
  if (m.provider === "elevenlabs") {
    return { api: "elevenlabs", endpoint: m.kind === "tts" ? `${base}/text-to-speech/{voice_id}` : `${base}/speech-to-text` };
  }
  if (m.provider === "speechify") return { api: "speechify", endpoint: `${base}/audio/speech` };
  if (m.provider === "cartesia") return { api: "cartesia", endpoint: `${base}/${m.kind === "tts" ? "tts/bytes" : "stt"}` };
  if (m.provider === "google-ai-studio") {
    return { api: "gemini-native", endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${m.model_id}:generateContent` };
  }
  return { api: "openai", endpoint: `${base}/${m.kind === "tts" ? "audio/speech" : m.kind === "stt" ? "audio/transcriptions" : "images/generations"}` };
}

/** passed/of over the ranking window, or null when never tested (or not a chat model). */
function passCounts(m: WorkingInput, results: ToolResult[]): { passed: number; of: number } | null {
  const s = toolStats(results, RANKING_WINDOW_DAYS);
  return m.kind === "chat" && s.tested ? { passed: s.passed, of: s.tested } : null;
}

function entry(m: WorkingInput, siteUrl: string): WorkingModel {
  const rel = reliability(m.tests);
  const json = passCounts(m, m.jsonTests);
  return {
    provider: m.provider,
    model_id: m.model_id,
    name: m.name,
    ...endpointFor(m),
    key_env: PROVIDERS[m.provider].key_env,
    context_length: m.context_length,
    answered: { days: rel.responded, of: rel.tested, share: rel.share == null ? null : Math.round(rel.share * 100) / 100 },
    median_latency_ms: rel.medianLatencyMs,
    tool_calls: passCounts(m, m.toolTests),
    multi_tool_calls: passCounts(m, m.multiToolTests),
    json_schema: json && { ...json, response_format: m.jsonTests.findLast((t) => t.status !== "error")?.mode ?? null },
    last_test_at: m.tests.at(-1)!.at,
    limits: feedLimits(m.limits),
    limit_scope: m.limit_scope,
    usage_terms: m.usage_terms,
    data_logging: m.data_logging,
    arena_text: m.arena?.boards.text?.rating ?? null,
    page: new URL(m.href, siteUrl).href,
  };
}

const share = (m: WorkingInput) => reliability(m.tests).share ?? -1;
const latency = (m: WorkingInput) => reliability(m.tests).medianLatencyMs ?? Number.MAX_SAFE_INTEGER;
const toolShare = (m: WorkingInput) => toolStats(m.toolTests, RANKING_WINDOW_DAYS).share ?? -1;
/** Null when never tested: the multi-turn test is newer than the tool-call test. */
const multiShare = (m: WorkingInput) => toolStats(m.multiToolTests, RANKING_WINDOW_DAYS).share;
const arena = (m: WorkingInput) => m.arena?.boards.text?.rating ?? -1;

/** General order: answers most often, then rated higher, then faster. */
const general = (a: WorkingInput, b: WorkingInput) => share(b) - share(a) || arena(b) - arena(a) || latency(a) - latency(b);
/**
 * Agent order: passes the multi-turn tool test most often (the single-turn test until it
 * has one), then single-turn tool calls, then answers most often, then faster.
 */
const agentShare = (m: WorkingInput) => multiShare(m) ?? toolShare(m);
const agentOrder = (a: WorkingInput, b: WorkingInput) => agentShare(b) - agentShare(a) || toolShare(b) - toolShare(a) || general(a, b);
/** Tool calls pass at least half the time, multi-turn too once tested, and the context fits an agent. */
const agentOk = (m: WorkingInput) =>
  toolShare(m) >= 0.5 && (multiShare(m) ?? 1) >= 0.5 && (m.context_length ?? 0) >= AGENT_MIN_CONTEXT;

/**
 * Bumped only for a breaking change: a field removed, renamed, or changing type or
 * meaning. Added fields don't bump it. Documented on /developers/.
 */
export const FEED_SCHEMA_VERSION = 1;

export interface WorkingFeed {
  schema_version: number;
  generated_at: string;
  about: string;
  lists: Record<"chat" | "agent" | "vision" | Exclude<ModelKind, "chat">, WorkingModel[]>;
  /**
   * Free web search APIs that answered the latest morning test, best first. Not inside
   * `lists`: these aren't models and have their own entry shape (search.ts).
   */
  search: WorkingSearch[];
}

export function workingFeed(models: WorkingInput[], siteUrl: string, now: string, search: SearchView[] = []): WorkingFeed {
  const ok = models.filter(usableNow);
  const chat = ok.filter((m) => m.kind === "chat");
  const list = (xs: WorkingInput[], order = general) => [...xs].sort(order).map((m) => entry(m, siteUrl));
  return {
    schema_version: FEED_SCHEMA_VERSION,
    generated_at: now,
    about: `Free models (lists) and free web search APIs (search) that answered the latest daily test, best first. Evaluation-only and Cline-only models are left out. Docs: ${new URL("/developers/", siteUrl).href}`,
    lists: {
      chat: list(chat),
      agent: list(chat.filter(agentOk), agentOrder),
      vision: list(chat.filter((m) => m.input_modalities?.includes("image"))),
      tts: list(ok.filter((m) => m.kind === "tts")),
      stt: list(ok.filter((m) => m.kind === "stt")),
      image: list(ok.filter((m) => m.kind === "image")),
    },
    search: workingSearch(search, siteUrl),
  };
}
