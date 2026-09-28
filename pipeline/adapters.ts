/**
 * One fetcher per provider, each returning the provider's free models (chat, TTS,
 * STT) in the shared ObservedModel shape.
 *
 * Ported from solo_developer's model-rotation `discovery.ts`, `tts-discovery.ts` and
 * `speech-discovery.ts` (2026-09-28), extended to keep the fields this site shows
 * (pricing, tool calling, licence where published).
 *
 * A fetcher throws on any failure. The caller then skips that provider's diff for the
 * run, so a failed HTTP call can never look like every model being removed.
 */

import { classifyModel } from "./candidates";
import { PROVIDERS } from "./providers";
import type { ModelKind, ObservedModel, ProviderId } from "./types";

const TIMEOUT_MS = 30_000;

type Env = Record<string, string | undefined>;

function base(provider: ProviderId, kind: ModelKind, listed_by: ObservedModel["listed_by"] = "api"): Pick<
  ObservedModel,
  "provider" | "kind" | "listed_by" | "limit_scope" | "usage_terms" | "rate_limits" | "card_required" | "account_required" | "licence" | "data_logging"
> {
  const p = PROVIDERS[provider];
  return {
    provider,
    kind,
    listed_by,
    limit_scope: p.limit_scope,
    usage_terms: p.usage_terms,
    rate_limits: p.rate_limits,
    card_required: p.card_required,
    account_required: p.account_required,
    licence: null,
    data_logging: p.data_logging,
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

/** Keeps the models this site covers and tags each with its kind. */
function withKind<T>(items: T[], idOf: (t: T) => string): Array<{ item: T; kind: ModelKind }> {
  return items.flatMap((item) => {
    const kind = classifyModel(idOf(item));
    return kind ? [{ item, kind }] : [];
  });
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
 * OpenRouter's free speech models are in no model list: `/api/v1/models` only
 * returns chat models, and there is no audio listing (checked in model-admin,
 * 2026-09-14). So they are kept by hand, and the daily test shows whether each one
 * still answers. Add or remove entries here when OpenRouter's site changes.
 */
export const OPENROUTER_CURATED_SPEECH: Array<{ id: string; name: string; kind: ModelKind }> = [
  { id: "deepgram/flux-tts:free", name: "Deepgram: Flux TTS (free)", kind: "tts" },
  { id: "fish-audio/s2.1-pro-free:free", name: "Fish Audio: S2.1 Pro (free)", kind: "tts" },
];

/**
 * The `:free` suffix is the test, not a zero price: checked 2026-09-07 in
 * model-admin, the zero-priced models without the suffix were music models and the
 * `openrouter/free` router alias.
 */
export function mapOpenRouter(models: OpenRouterModel[]): ObservedModel[] {
  const listed = withKind(models.filter((m) => m.id.endsWith(":free")), (m) => m.id).map(({ item: m, kind }) => ({
    ...base("openrouter", kind),
    model_id: m.id,
    name: m.name,
    url: `https://openrouter.ai/${m.id}`,
    price_type: "free" as const,
    context_length: m.context_length ?? null,
    input_modalities: m.architecture?.input_modalities ?? null,
    tool_calling: m.supported_parameters ? m.supported_parameters.includes("tools") : null,
  }));
  const listedIds = new Set(listed.map((m) => m.model_id));
  const curated = OPENROUTER_CURATED_SPEECH.filter((c) => !listedIds.has(c.id)).map((c) => ({
    ...base("openrouter", c.kind, "curated"),
    model_id: c.id,
    name: c.name,
    url: `https://openrouter.ai/${c.id.replace(/:free$/, "")}`,
    price_type: "free" as const,
    context_length: null,
    input_modalities: c.kind === "stt" ? ["audio"] : ["text"],
    tool_calling: null,
  }));
  return [...listed, ...curated];
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

/**
 * On Groq's free plan every active model is free within its own limits. Groq lists
 * speech models next to chat models: Whisper (STT) and Orpheus (TTS).
 */
export function mapGroq(models: GroqModel[]): ObservedModel[] {
  return withKind(models.filter((m) => m.active !== false), (m) => m.id).map(({ item: m, kind }) => ({
    ...base("groq", kind),
    model_id: m.id,
    name: m.owned_by ? `${m.id} (${m.owned_by})` : m.id,
    url: kind === "chat" ? "https://console.groq.com/docs/models" : kind === "tts" ? "https://console.groq.com/docs/text-to-speech" : "https://console.groq.com/docs/speech-to-text",
    price_type: "freemium-quota" as const,
    context_length: kind === "chat" ? m.context_window ?? null : null,
    // Groq publishes neither modalities nor tool support in its list.
    input_modalities: kind === "stt" ? ["audio"] : kind === "tts" ? ["text"] : null,
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
 * "unknown"; the daily test on a free-tier key is what shows it. TTS and transcribe
 * models are listed like chat models and served through generateContent too.
 *
 * `-latest` aliases are skipped: they silently re-point to another model.
 */
export function mapGoogle(models: GoogleModel[]): ObservedModel[] {
  const usable = models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => ({ m, id: m.name.replace(/^models\//, "") }))
    .filter(({ id }) => !id.endsWith("-latest"));
  return withKind(usable, ({ id }) => id).map(({ item: { m, id }, kind }) => ({
    ...base("google-ai-studio", kind),
    model_id: id,
    name: m.displayName ?? id,
    url: kind === "tts" ? "https://ai.google.dev/gemini-api/docs/speech-generation" : "https://ai.google.dev/gemini-api/docs/models",
    price_type: "unknown" as const,
    context_length: kind === "chat" ? m.inputTokenLimit ?? null : null,
    input_modalities: kind === "stt" ? ["audio"] : kind === "tts" ? ["text"] : null,
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

/**
 * The list carries only id and owner; retired models drop out of it. Chat only:
 * NVIDIA's speech models use its own gRPC interface, not an OpenAI-compatible one.
 */
export function mapNvidia(models: NvidiaModel[]): ObservedModel[] {
  return withKind(models, (m) => m.id)
    .filter(({ kind }) => kind === "chat")
    .map(({ item: m }) => ({
      ...base("nvidia", "chat"),
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

// ── Kilo Code gateway ────────────────────────────────────────────────────────────

export interface KiloModel {
  id: string;
  name: string;
  isFree?: boolean;
  mayTrainOnYourPrompts?: boolean;
  context_length?: number | null;
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[];
}

/** Routers pick another model per request; they're not models to list. */
const KILO_ROUTERS = /^(kilo-auto\/|openrouter\/free$)/;

/**
 * Kilo's free models need no key (200 requests/hour per IP). Each model says whether
 * its provider may train on prompts; NVIDIA-hosted ones are also trial-only and
 * logged, per Kilo's docs (checked 2026-09-28).
 */
export function mapKilo(models: KiloModel[]): ObservedModel[] {
  const free = models.filter((m) => (m.isFree || m.id.endsWith(":free")) && !KILO_ROUTERS.test(m.id));
  return withKind(free, (m) => m.id).map(({ item: m, kind }) => {
    const nvidia = m.id.startsWith("nvidia/");
    return {
      ...base("kilo", kind),
      model_id: m.id,
      name: m.name,
      url: "https://kilo.ai/models",
      price_type: "free" as const,
      context_length: m.context_length ?? null,
      input_modalities: m.architecture?.input_modalities ?? null,
      tool_calling: m.supported_parameters ? m.supported_parameters.includes("tools") : null,
      usage_terms: nvidia ? ("evaluation-only" as const) : ("unknown" as const),
      data_logging: nvidia ? ("logs-prompts" as const) : m.mayTrainOnYourPrompts ? ("may-train" as const) : ("none-stated" as const),
    };
  });
}

async function fetchKilo(): Promise<ObservedModel[]> {
  const json = await getJson<{ data?: KiloModel[] }>("https://api.kilo.ai/api/gateway/models");
  return mapKilo(json.data ?? []);
}

// ── LLM7.io ──────────────────────────────────────────────────────────────────────

export interface Llm7Model {
  id: string;
  model_type?: string;
  tier?: string;
  usage_based_only?: boolean;
  context_window?: { tokens?: number | null };
  modalities?: { input?: string[]; output?: string[] };
  tools_calling?: boolean;
}

/**
 * Only "turbo" models are open to anonymous users, and a turbo model marked
 * usage_based_only is billed anyway (docs.llm7.io models API, 2026-09-28).
 */
export function mapLlm7(models: Llm7Model[]): ObservedModel[] {
  const free = models.filter((m) => m.tier === "turbo" && !m.usage_based_only && (m.model_type ?? "chat") === "chat");
  return withKind(free, (m) => m.id).map(({ item: m, kind }) => ({
    ...base("llm7", kind),
    model_id: m.id,
    name: m.id,
    url: "https://docs.llm7.io/guides/models",
    price_type: "free" as const,
    context_length: m.context_window?.tokens ?? null,
    input_modalities: m.modalities?.input ?? null,
    tool_calling: m.tools_calling ?? null,
  }));
}

async function fetchLlm7(): Promise<ObservedModel[]> {
  const json = await getJson<{ data?: Llm7Model[] }>("https://api.llm7.io/v1/models");
  return mapLlm7(json.data ?? []);
}

// ── Z.ai (Zhipu) ─────────────────────────────────────────────────────────────────

/**
 * Z.ai's model list carries no prices, so the free models come from its pricing page
 * (docs.z.ai/guides/overview/pricing, checked 2026-09-28). The weekly page watch on the
 * "zai" offer flags when that page changes; update this list then.
 */
export const ZAI_FREE_MODELS: Record<string, { name: string; input_modalities: string[] }> = {
  "glm-4.7-flash": { name: "GLM-4.7-Flash", input_modalities: ["text"] },
  "glm-4.5-flash": { name: "GLM-4.5-Flash", input_modalities: ["text"] },
  "glm-4.6v-flash": { name: "GLM-4.6V-Flash", input_modalities: ["text", "image"] },
};

export interface ZaiModel {
  id: string;
  context_length?: number | null;
}

/** Keeps the listed models that the pricing page marks free. */
export function mapZai(models: ZaiModel[]): ObservedModel[] {
  return models.flatMap((m) => {
    const free = ZAI_FREE_MODELS[m.id.toLowerCase()];
    if (!free) return [];
    return [{
      ...base("zai", "chat"),
      model_id: m.id,
      name: free.name,
      url: "https://docs.z.ai/guides/overview/pricing",
      price_type: "free" as const,
      context_length: m.context_length ?? null,
      input_modalities: free.input_modalities,
      tool_calling: null,
    }];
  });
}

async function fetchZai(env: Env): Promise<ObservedModel[]> {
  const json = await getJson<{ data?: ZaiModel[] }>("https://api.z.ai/api/paas/v4/models", {
    Authorization: `Bearer ${env.ZAI_API_KEY}`,
  });
  return mapZai(json.data ?? []);
}

// ── Cline (free promotion) ───────────────────────────────────────────────────────

export interface ClineRecommended {
  free?: Array<{ id: string; name?: string; description?: string }>;
}

/**
 * The "free" list the Cline extension shows under its own provider, from the public
 * endpoint the extension itself uses (found via cline/cline#12140, 2026-09-28). These
 * models only work inside Cline, so they're listed, never tested.
 */
export function mapCline(json: ClineRecommended): ObservedModel[] {
  return withKind(json.free ?? [], (m) => m.id).map(({ item: m, kind }) => ({
    ...base("cline", kind),
    model_id: m.id,
    name: m.name && m.name !== m.id ? m.name : m.id.split("/").pop() ?? m.id,
    url: "https://docs.cline.bot/getting-started/free-models",
    price_type: "trial-credit" as const,
    context_length: null,
    input_modalities: null,
    tool_calling: null,
  }));
}

async function fetchCline(): Promise<ObservedModel[]> {
  return mapCline(await getJson<ClineRecommended>("https://api.cline.bot/api/v1/ai/cline/recommended-models"));
}

// ── Cloudflare Workers AI ────────────────────────────────────────────────────────

export interface CloudflareModel {
  name: string;
  task?: { name?: string };
  properties?: Array<{ property_id: string; value: unknown }>;
}

const CLOUDFLARE_TASKS: Record<string, ModelKind> = {
  "Text Generation": "chat",
  "Text-to-Speech": "tts",
  "Automatic Speech Recognition": "stt",
  "Text-to-Image": "image",
};

/** Workers Paid costs $0.011 per 1,000 Neurons, so the free 10,000 Neurons are worth $0.11 a day. */
export const CLOUDFLARE_FREE_USD_PER_DAY = 0.11;

const UNITS: Array<{ match: RegExp; label: (n: number) => string }> = [
  { match: /per m input tokens/i, label: (n) => `≈ ${fmt(n * 1_000_000)} input tokens a day` },
  { match: /per 512 by 512 tile/i, label: (n) => `≈ ${fmt(n)} images (512×512) a day` },
  { match: /per audio minute/i, label: (n) => `≈ ${fmt(n)} audio minutes a day` },
  { match: /per 1k characters/i, label: (n) => `≈ ${fmt(n * 1000)} characters a day` },
];

function fmt(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return String(Math.floor(n));
}

/**
 * How far the free daily Neurons go for one model, from its first listed price.
 * Exported for tests. Null when the model lists no price we can convert.
 */
export function freeAllowance(price: unknown): string | null {
  let list: Array<{ unit?: string; price?: number }> = [];
  try {
    list = typeof price === "string" ? JSON.parse(price) : Array.isArray(price) ? price : [];
  } catch {
    return null;
  }
  const first = list[0];
  if (!first || typeof first.price !== "number") return null;
  if (first.price === 0) return "No charge listed (beta): doesn't use the free Neurons";
  const unit = UNITS.find((u) => u.match.test(first.unit ?? ""));
  return unit ? `${unit.label(CLOUDFLARE_FREE_USD_PER_DAY / first.price)} within the free Neurons` : null;
}

/**
 * Cloudflare's catalogue (models/search) carries task, context, tool support, price and
 * a `require_workers_paid` flag (checked 2026-09-28). Paid-only models are left out,
 * as are realtime and async-queue models (websocket or batch only).
 */
export function mapCloudflare(models: CloudflareModel[]): ObservedModel[] {
  return models.flatMap((m) => {
    const kind = CLOUDFLARE_TASKS[m.task?.name ?? ""];
    if (!kind) return [];
    const p = Object.fromEntries((m.properties ?? []).map((x) => [x.property_id, x.value]));
    if (String(p.require_workers_paid) === "true" || String(p.realtime) === "true" || String(p.async_queue) === "true") return [];
    if (kind === "chat" && classifyModel(m.name) !== "chat") return [];
    // Inpainting models edit an existing picture (they need an image and a mask): not text-to-image.
    if (kind === "image" && /inpaint/i.test(m.name)) return [];
    const allowance = freeAllowance(p.price);
    return [{
      ...base("cloudflare", kind),
      model_id: m.name,
      name: m.name.replace(/^@cf\//, ""),
      url: `https://developers.cloudflare.com/workers-ai/models/${m.name.split("/").pop()}/`,
      price_type: "freemium-quota" as const,
      context_length: kind === "chat" && p.context_window ? Number(p.context_window) : null,
      input_modalities: kind === "chat" ? (String(p.vision) === "true" ? ["text", "image"] : ["text"]) : kind === "stt" ? ["audio"] : ["text"],
      tool_calling: kind === "chat" ? String(p.function_calling) === "true" : null,
      rate_limits: { ...PROVIDERS.cloudflare.rate_limits, ...(allowance ? { note: allowance } : {}) },
      terms_url: typeof p.terms === "string" ? p.terms : typeof p.info === "string" ? p.info : null,
    }];
  });
}

async function fetchCloudflare(env: Env): Promise<ObservedModel[]> {
  if (!env.CLOUDFLARE_ACCOUNT_ID) throw new Error("CLOUDFLARE_ACCOUNT_ID not set");
  const json = await getJson<{ result?: CloudflareModel[] }>(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/models/search?per_page=500`,
    { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
  );
  return mapCloudflare(json.result ?? []);
}

// ── Registry ─────────────────────────────────────────────────────────────────────

export const FETCHERS: Record<ProviderId, (env: Env) => Promise<ObservedModel[]>> = {
  openrouter: () => fetchOpenRouter(),
  groq: fetchGroq,
  "google-ai-studio": fetchGoogle,
  nvidia: fetchNvidia,
  kilo: () => fetchKilo(),
  llm7: () => fetchLlm7(),
  zai: fetchZai,
  cline: () => fetchCline(),
  cloudflare: fetchCloudflare,
};
