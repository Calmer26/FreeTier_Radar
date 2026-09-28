/**
 * One fetcher per provider, each returning the provider's free chat models in the
 * shared ObservedModel shape.
 *
 * Ported from solo_developer's model-rotation `discovery.ts` (2026-09-28), extended to
 * keep the fields this site shows (pricing, tool calling, licence where published).
 *
 * A fetcher throws on any failure. The caller then skips that provider's diff for the
 * run, so a failed HTTP call can never look like every model being removed.
 */

import { isChatModel } from "./candidates";
import { PROVIDERS } from "./providers";
import type { ObservedModel, ProviderId } from "./types";

const TIMEOUT_MS = 30_000;

type Env = Record<string, string | undefined>;

function base(provider: ProviderId): Pick<
  ObservedModel,
  "provider" | "limit_scope" | "usage_terms" | "rate_limits" | "card_required" | "account_required" | "licence"
> {
  const p = PROVIDERS[provider];
  return {
    provider,
    limit_scope: p.limit_scope,
    usage_terms: p.usage_terms,
    rate_limits: p.rate_limits,
    card_required: p.card_required,
    account_required: p.account_required,
    licence: null,
  };
}

async function getJson<T>(url: string | URL, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
  return (await res.json()) as T;
}

// ── OpenRouter ───────────────────────────────────────────────────────────────────

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number | null;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[];
}

/**
 * The `:free` suffix is the test, not a zero price: checked 2026-09-07 in
 * model-admin, the zero-priced models without the suffix were music models and the
 * `openrouter/free` router alias.
 */
export function mapOpenRouter(models: OpenRouterModel[]): ObservedModel[] {
  return models
    .filter((m) => m.id.endsWith(":free") && isChatModel(m.id))
    .map((m) => ({
      ...base("openrouter"),
      model_id: m.id,
      name: m.name,
      url: `https://openrouter.ai/${m.id}`,
      price_type: "free" as const,
      context_length: m.context_length ?? null,
      input_modalities: m.architecture?.input_modalities ?? null,
      tool_calling: m.supported_parameters ? m.supported_parameters.includes("tools") : null,
    }));
}

async function fetchOpenRouter(): Promise<ObservedModel[]> {
  const json = await getJson<{ data?: OpenRouterModel[] }>("https://openrouter.ai/api/v1/models");
  return mapOpenRouter(json.data ?? []);
}

// ── Groq ─────────────────────────────────────────────────────────────────────────

export interface GroqModel {
  id: string;
  active?: boolean;
  context_window?: number;
  owned_by?: string;
}

/** On Groq's free plan every active model is free within its own limits. */
export function mapGroq(models: GroqModel[]): ObservedModel[] {
  return models
    .filter((m) => m.active !== false && isChatModel(m.id))
    .map((m) => ({
      ...base("groq"),
      model_id: m.id,
      name: m.owned_by ? `${m.id} (${m.owned_by})` : m.id,
      url: "https://console.groq.com/docs/models",
      price_type: "freemium-quota" as const,
      context_length: m.context_window ?? null,
      // Groq publishes neither modalities nor tool support in its list.
      input_modalities: null,
      tool_calling: null,
    }));
}

async function fetchGroq(env: Env): Promise<ObservedModel[]> {
  const json = await getJson<{ data?: GroqModel[] }>("https://api.groq.com/openai/v1/models", {
    Authorization: `Bearer ${env.GROQ_API_KEY}`,
  });
  return mapGroq(json.data ?? []);
}

// ── Google AI Studio ─────────────────────────────────────────────────────────────

export interface GoogleModel {
  name: string;
  displayName?: string;
  inputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

/**
 * The list does not say which models the free tier covers, so price_type stays
 * "unknown"; the daily test on a free-tier key is what shows it.
 *
 * `-latest` aliases are skipped: they silently re-point to another model.
 */
export function mapGoogle(models: GoogleModel[]): ObservedModel[] {
  return models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => ({ m, id: m.name.replace(/^models\//, "") }))
    .filter(({ id }) => !id.endsWith("-latest") && isChatModel(id))
    .map(({ m, id }) => ({
      ...base("google-ai-studio"),
      model_id: id,
      name: m.displayName ?? id,
      url: "https://ai.google.dev/gemini-api/docs/models",
      price_type: "unknown" as const,
      context_length: m.inputTokenLimit ?? null,
      input_modalities: null,
      tool_calling: null,
    }));
}

async function fetchGoogle(env: Env): Promise<ObservedModel[]> {
  const out: GoogleModel[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    // Header rather than ?key= so the key never ends up in a logged URL.
    const json = await getJson<{ models?: GoogleModel[]; nextPageToken?: string }>(url, {
      "x-goog-api-key": env.GOOGLE_AI_STUDIO_API_KEY ?? "",
    });
    out.push(...(json.models ?? []));
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return mapGoogle(out);
}

// ── NVIDIA ───────────────────────────────────────────────────────────────────────

export interface NvidiaModel {
  id: string;
  owned_by?: string;
}

/** The list carries only id and owner; retired models drop out of it. */
export function mapNvidia(models: NvidiaModel[]): ObservedModel[] {
  return models
    .filter((m) => isChatModel(m.id))
    .map((m) => ({
      ...base("nvidia"),
      model_id: m.id,
      name: m.owned_by ? `${m.id} (${m.owned_by})` : m.id,
      url: `https://build.nvidia.com/${m.id}`,
      price_type: "free" as const,
      context_length: null,
      input_modalities: null,
      tool_calling: null,
    }));
}

async function fetchNvidia(env: Env): Promise<ObservedModel[]> {
  const json = await getJson<{ data?: NvidiaModel[] }>("https://integrate.api.nvidia.com/v1/models", {
    Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
  });
  return mapNvidia(json.data ?? []);
}

// ── Registry ─────────────────────────────────────────────────────────────────────

export const FETCHERS: Record<ProviderId, (env: Env) => Promise<ObservedModel[]>> = {
  openrouter: () => fetchOpenRouter(),
  groq: fetchGroq,
  "google-ai-studio": fetchGoogle,
  nvidia: fetchNvidia,
};
