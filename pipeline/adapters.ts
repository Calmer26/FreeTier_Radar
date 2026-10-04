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
import { catalogueLines, fetchCloudflarePricing } from "./cloudflare-pricing";
import { CARTESIA_VERSION, PROVIDERS } from "./providers";
import type { ModelKind, ObservedModel, PriceLine, ProviderId } from "./types";

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
  const byId = new Map(models.map((m) => [m.id, m]));
  const paidVersion = (id: string): PriceLine[] | null => {
    const p = byId.get(id.replace(/:free$/, ""))?.pricing;
    const input = Number(p?.prompt);
    const output = Number(p?.completion);
    if (!p || !(input > 0)) return null;
    return [
      { usd: +(input * 1e6).toFixed(4), unit: "M input tokens", neurons: null },
      ...(output > 0 ? [{ usd: +(output * 1e6).toFixed(4), unit: "M output tokens", neurons: null }] : []),
    ];
  };
  const listed = withKind(models.filter((m) => m.id.endsWith(":free")), (m) => m.id).map(({ item: m, kind }) => ({
    ...base("openrouter", kind),
    model_id: m.id,
    name: m.name,
    url: `https://openrouter.ai/${m.id}`,
    price_type: "free" as const,
    context_length: m.context_length ?? null,
    input_modalities: m.architecture?.input_modalities ?? null,
    tool_calling: m.supported_parameters ? m.supported_parameters.includes("tools") : null,
    paid_version_pricing: paidVersion(m.id),
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
 * Z.ai's free models, from its pricing page (docs.z.ai/guides/overview/pricing, checked
 * 2026-09-29: "Free" in the Text and Vision tables). Its /models list leaves them out
 * (it only lists paid models), so they're hand-listed; the daily test shows whether
 * each still answers, and the weekly watch on the "zai" offer flags pricing changes.
 */
export const ZAI_FREE_MODELS: Array<{ id: string; name: string; input_modalities: string[] }> = [
  { id: "glm-4.7-flash", name: "GLM-4.7-Flash", input_modalities: ["text"] },
  { id: "glm-4.5-flash", name: "GLM-4.5-Flash", input_modalities: ["text"] },
  { id: "glm-4.6v-flash", name: "GLM-4.6V-Flash", input_modalities: ["text", "image"] },
];

export function mapZai(): ObservedModel[] {
  return ZAI_FREE_MODELS.map((m) => ({
    ...base("zai", "chat", "curated"),
    model_id: m.id,
    name: m.name,
    url: "https://docs.z.ai/guides/overview/pricing",
    price_type: "free" as const,
    context_length: null,
    input_modalities: m.input_modalities,
    tool_calling: null,
  }));
}

async function fetchZai(env: Env): Promise<ObservedModel[]> {
  // The list itself isn't used (see above), but calling it checks the key works, so a bad
  // key shows up as a failing source rather than as three broken models.
  await getJson("https://api.z.ai/api/paas/v4/models", { Authorization: `Bearer ${env.ZAI_API_KEY}` });
  return mapZai();
}

// ── Mistral ──────────────────────────────────────────────────────────────────────

export interface MistralModel {
  id: string;
  name: string;
  max_context_length?: number;
  deprecation?: string | null;
  capabilities?: Record<string, boolean | undefined>;
}

/** "ministral-3b-2512" → "Ministral 3B 2512"; "voxtral-mini-tts-2603" → "Voxtral Mini TTS 2603". Exported for tests. */
export function mistralName(id: string): string {
  return id
    .split("-")
    .map((w) => (/^\d+b$/.test(w) ? w.toUpperCase() : /^(tts|ocr)$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Mistral lists every alias as its own entry; `name` is the canonical id, so only the
 * entry whose id equals its name is kept. Chat, transcription and speech models only
 * (no embeddings, moderation, OCR or realtime), and no Labs models, which need an admin
 * opt-in. Which ones are free isn't in the list: free mode gives some models a limit
 * of 0, and the daily test reports those as "no free quota" (checked 2026-09-29).
 */
export function mapMistral(models: MistralModel[]): ObservedModel[] {
  return models.flatMap((m) => {
    if (m.id !== m.name || m.deprecation || m.id.startsWith("labs-")) return [];
    const c = m.capabilities ?? {};
    const kind: ModelKind | null = c.completion_chat ? "chat" : c.audio_transcription ? "stt" : c.audio_speech ? "tts" : null;
    if (!kind) return [];
    return [{
      ...base("mistral", kind),
      model_id: m.id,
      name: mistralName(m.id),
      url: "https://docs.mistral.ai/getting-started/models/",
      price_type: "free" as const,
      context_length: kind === "chat" ? m.max_context_length ?? null : null,
      input_modalities: kind === "chat" ? ["text", ...(c.vision ? ["image"] : []), ...(c.audio ? ["audio"] : [])] : kind === "stt" ? ["audio"] : ["text"],
      tool_calling: kind === "chat" ? c.function_calling === true : null,
    }];
  });
}

async function fetchMistral(env: Env): Promise<ObservedModel[]> {
  const json = await getJson<{ data?: MistralModel[] }>("https://api.mistral.ai/v1/models", { Authorization: `Bearer ${env.MISTRAL_API_KEY}` });
  return mapMistral(json.data ?? []);
}

// ── Ollama Cloud ─────────────────────────────────────────────────────────────────

export interface OllamaModel {
  name: string;
  model?: string;
}

/**
 * Every cloud model on the account's list. Which are "starter models" on the Free plan
 * isn't published; the others answer 402 "not included in your free usage", which the
 * daily test records as "no free quota" (checked 2026-10-02: 6 of 17 free).
 */
export function mapOllama(models: OllamaModel[]): ObservedModel[] {
  return models.map((m) => ({
    ...base("ollama", "chat"),
    model_id: m.name,
    name: m.name,
    url: `https://ollama.com/library/${m.name.split(":")[0]}`,
    price_type: "free" as const,
    context_length: null,
    input_modalities: ["text"],
    tool_calling: null,
  }));
}

async function fetchOllama(env: Env): Promise<ObservedModel[]> {
  const json = await getJson<{ models?: OllamaModel[] }>("https://ollama.com/api/tags", { Authorization: `Bearer ${env.OLLAMA_API_KEY}` });
  return mapOllama(json.models ?? []);
}

// ── Hetzner Inference API (experiment) ───────────────────────────────────────────

export interface HetznerModel {
  id: string;
  max_model_len?: number;
}

/**
 * Hetzner's docs say the /models list is definitive and everything on it is free while
 * the API is an experiment (checked 2026-10-03: two Qwen models, both with vision).
 */
export function mapHetzner(models: HetznerModel[]): ObservedModel[] {
  return models.map((m) => ({
    ...base("hetzner", "chat"),
    model_id: m.id,
    name: m.id.split("/").at(-1) ?? m.id,
    url: "https://docs.hetzner.com/general/company-and-policy/experiments/inference/",
    price_type: "free" as const,
    context_length: m.max_model_len ?? null,
    // The list carries no modalities; the docs table is the only place they appear.
    input_modalities: null,
    tool_calling: null,
  }));
}

async function fetchHetzner(env: Env): Promise<ObservedModel[]> {
  const json = await getJson<{ data?: HetznerModel[] }>("https://inference.hetzner.com/api/v1/models", {
    Authorization: `Bearer ${env.HETZNER_API_KEY}`,
  });
  return mapHetzner(json.data ?? []);
}

// ── Requesty ─────────────────────────────────────────────────────────────────────

export interface RequestyModel {
  id: string;
  api?: string;
  input_price?: number;
  output_price?: number;
  context_window?: number;
  supports_vision?: boolean;
  supports_tool_calling?: boolean;
  data_retention_days?: number;
  data_used_for_training?: boolean;
}

/**
 * The chat models Requesty prices at $0 (checked 2026-10-03: 12 of 749). Each entry says
 * whether prompts are retained and used for training; NVIDIA-hosted ones are trial terms.
 */
export function mapRequesty(models: RequestyModel[]): ObservedModel[] {
  const free = models.filter((m) => (m.api ?? "chat") === "chat" && m.input_price === 0 && m.output_price === 0);
  return withKind(free, (m) => m.id).map(({ item: m, kind }) => ({
    ...base("requesty", kind),
    model_id: m.id,
    name: m.id.split("/").at(-1) ?? m.id,
    url: "https://www.requesty.ai/free-models",
    price_type: "free" as const,
    context_length: m.context_window ?? null,
    input_modalities: m.supports_vision ? ["text", "image"] : ["text"],
    tool_calling: m.supports_tool_calling ?? null,
    ...(m.id.startsWith("nvidia/") ? { usage_terms: "evaluation-only" as const } : {}),
    data_logging: m.data_used_for_training ? ("may-train" as const)
      : (m.data_retention_days ?? 0) > 0 ? ("logs-prompts" as const)
      : m.data_used_for_training === false ? ("not-used" as const)
      : ("unknown" as const),
  }));
}

async function fetchRequesty(): Promise<ObservedModel[]> {
  const json = await getJson<{ data?: RequestyModel[] }>("https://router.requesty.ai/v1/models");
  return mapRequesty(json.data ?? []);
}

// ── AMD Radeon Cloud (Public Free Model APIs) ────────────────────────────────────

export interface AmdModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[] };
  providers?: Array<{ tools?: boolean }>;
}

/**
 * Every model on the shared list is free (amd-aim.github.io/radeon-cloud-docs, checked
 * 2026-10-03); the prices it carries are what a dedicated endpoint would cost.
 */
export function mapAmd(models: AmdModel[]): ObservedModel[] {
  return withKind(models, (m) => m.id).map(({ item: m, kind }) => ({
    ...base("amd", kind),
    model_id: m.id,
    name: m.name ?? m.id,
    url: "https://amd-aim.github.io/radeon-cloud-docs/models/overview/",
    price_type: "free" as const,
    context_length: m.context_length ?? null,
    input_modalities: m.architecture?.input_modalities ?? null,
    tool_calling: m.providers?.[0]?.tools ?? null,
  }));
}

async function fetchAmd(env: Env): Promise<ObservedModel[]> {
  const json = await getJson<{ data?: AmdModel[] }>("https://developer.amd.com.cn/radeon/api/v1/models", {
    Authorization: `Bearer ${env.AMD_RADEON_API_KEY}`,
  });
  return mapAmd(json.data ?? []);
}

// ── BazaarLink ───────────────────────────────────────────────────────────────────

export interface BazaarLinkModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[] };
}

/** Free models carry a ":free" id; "auto:free" is a router, not a model (checked 2026-10-03). */
export function mapBazaarLink(models: BazaarLinkModel[]): ObservedModel[] {
  const free = models.filter((m) => m.id.endsWith(":free") && !m.id.startsWith("auto:"));
  return withKind(free, (m) => m.id).map(({ item: m, kind }) => ({
    ...base("bazaarlink", kind),
    model_id: m.id,
    name: m.name ?? m.id,
    url: "https://bazaarlink.ai/free",
    price_type: "free" as const,
    context_length: m.context_length ?? null,
    input_modalities: m.architecture?.input_modalities ?? null,
    tool_calling: null,
  }));
}

async function fetchBazaarLink(): Promise<ObservedModel[]> {
  const json = await getJson<{ data?: BazaarLinkModel[] }>("https://api.bazaarlink.ai/v1/models");
  return mapBazaarLink(json.data ?? []);
}

// ── OrcaRouter ───────────────────────────────────────────────────────────────────

export interface OrcaRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[] };
}

/** Free models end in "-free"; "orcarouter/free" routes between them (checked 2026-10-03). */
export function mapOrcaRouter(models: OrcaRouterModel[]): ObservedModel[] {
  const free = models.filter((m) => m.id.endsWith("-free") && !m.id.startsWith("orcarouter/"));
  return withKind(free, (m) => m.id).map(({ item: m, kind }) => ({
    ...base("orcarouter", kind),
    model_id: m.id,
    name: m.name ?? m.id,
    url: "https://docs.orcarouter.ai/routing/free-models",
    price_type: "free" as const,
    context_length: m.context_length ?? null,
    input_modalities: m.architecture?.input_modalities ?? null,
    tool_calling: null,
  }));
}

async function fetchOrcaRouter(): Promise<ObservedModel[]> {
  const json = await getJson<{ data?: OrcaRouterModel[] }>("https://api.orcarouter.ai/v1/models");
  return mapOrcaRouter(json.data ?? []);
}

// ── OpenCode Zen (free promotion) ────────────────────────────────────────────────

/**
 * Zen's free models end in "-free", plus the stealth "big-pickle". They only work inside
 * OpenCode, so they're listed, never tested. Jev is a decision model on its own endpoint,
 * not chat. Data use per model from opencode.ai/docs/zen#privacy (checked 2026-10-03).
 */
export function mapOpenCode(models: Array<{ id: string }>): ObservedModel[] {
  const free = models.filter((m) => (m.id.endsWith("-free") || m.id === "big-pickle") && !m.id.startsWith("jev-"));
  return withKind(free, (m) => m.id).map(({ item: m, kind }) => {
    const nvidia = m.id.startsWith("nemotron-");
    const zeroRetention = /^(space-bunny|longcat)-/.test(m.id);
    return {
      ...base("opencode", kind),
      model_id: m.id,
      name: m.id,
      url: "https://opencode.ai/docs/zen/",
      price_type: "trial-credit" as const,
      context_length: null,
      input_modalities: null,
      tool_calling: null,
      ...(nvidia ? { usage_terms: "evaluation-only" as const } : {}),
      data_logging: nvidia ? ("logs-prompts" as const) : zeroRetention ? ("not-used" as const) : ("may-train" as const),
    };
  });
}

async function fetchOpenCode(): Promise<ObservedModel[]> {
  const json = await getJson<{ data?: Array<{ id: string }> }>("https://opencode.ai/zen/v1/models");
  return mapOpenCode(json.data ?? []);
}

// ── SpeechifyAI ──────────────────────────────────────────────────────────────────

export interface SpeechifyModel {
  id?: string;
  model?: string;
  name?: string;
}

/**
 * GET /v1/audio/models: the TTS models this workspace can use (docs.speechify.ai/llms.txt,
 * checked 2026-10-03: simba-3.2 English, simba-3.0 six languages). The response shape
 * isn't documented there, so both a bare array and a wrapped one are accepted.
 */
export function mapSpeechify(json: SpeechifyModel[] | { data?: SpeechifyModel[]; models?: SpeechifyModel[] }): ObservedModel[] {
  const list = Array.isArray(json) ? json : json.data ?? json.models ?? [];
  return list.flatMap((m) => {
    const id = m.id ?? m.model;
    if (!id) return [];
    return [{
      ...base("speechify", "tts"),
      model_id: id,
      name: m.name ?? id,
      url: "https://speechify.ai/models",
      price_type: "freemium-quota" as const,
      context_length: null,
      input_modalities: ["text"],
      tool_calling: null,
    }];
  });
}

async function fetchSpeechify(env: Env): Promise<ObservedModel[]> {
  return mapSpeechify(await getJson("https://api.speechify.ai/v1/audio/models", { Authorization: `Bearer ${env.SPEECHIFY_API_KEY}` }));
}

// ── Cartesia ─────────────────────────────────────────────────────────────────────

/**
 * Cartesia publishes no model list; these are the current models in its API reference
 * (docs.cartesia.ai, checked 2026-10-03). The Free plan covers both TTS and STT.
 */
export const CARTESIA_MODELS: Array<{ id: string; name: string; kind: ModelKind }> = [
  { id: "sonic-3.6", name: "Sonic 3.6", kind: "tts" },
  { id: "ink-whisper", name: "Ink Whisper", kind: "stt" },
];

export function mapCartesia(): ObservedModel[] {
  return CARTESIA_MODELS.map((m) => ({
    ...base("cartesia", m.kind, "curated"),
    model_id: m.id,
    name: m.name,
    url: m.kind === "tts" ? "https://docs.cartesia.ai/build-with-cartesia/tts-models/latest" : "https://docs.cartesia.ai/build-with-cartesia/stt/latest",
    price_type: "freemium-quota" as const,
    context_length: null,
    input_modalities: m.kind === "stt" ? ["audio"] : ["text"],
    tool_calling: null,
  }));
}

async function fetchCartesia(env: Env): Promise<ObservedModel[]> {
  // Checks the key works, so a bad key shows up as a failing source, not as broken models.
  await getJson("https://api.cartesia.ai/voices?limit=1", { Authorization: `Bearer ${env.CARTESIA_API_KEY}`, "Cartesia-Version": CARTESIA_VERSION });
  return mapCartesia();
}

// ── Cohere ───────────────────────────────────────────────────────────────────────

export interface CohereModel {
  name: string;
  endpoints?: string[];
  context_length?: number;
  features?: string[] | null;
  is_deprecated?: boolean;
}

/**
 * Chat and transcription models (no embed/rerank/parse). Translation-only, Arabic-only
 * and the small regional tiny-aya variants are left out: a trial key has 1,000 calls a
 * month in total, and testing every variant daily would use more than that.
 */
export const COHERE_SKIP = /translate|arabic|tiny-aya/;

export function mapCohere(models: CohereModel[]): ObservedModel[] {
  return models.flatMap((m) => {
    if (m.is_deprecated || COHERE_SKIP.test(m.name)) return [];
    const eps = m.endpoints ?? [];
    const kind: ModelKind | null = eps.includes("chat") ? "chat" : eps.includes("transcriptions") ? "stt" : null;
    if (!kind) return [];
    const f = m.features ?? [];
    return [{
      ...base("cohere", kind),
      model_id: m.name,
      name: m.name,
      url: "https://docs.cohere.com/docs/models",
      price_type: "free" as const,
      context_length: kind === "chat" ? m.context_length ?? null : null,
      input_modalities: kind === "chat" ? ["text", ...(f.includes("vision") ? ["image"] : [])] : ["audio"],
      tool_calling: kind === "chat" ? f.includes("tools") : null,
    }];
  });
}

async function fetchCohere(env: Env): Promise<ObservedModel[]> {
  const json = await getJson<{ models?: CohereModel[] }>("https://api.cohere.com/v1/models?page_size=1000", { Authorization: `Bearer ${env.COHERE_API_KEY}` });
  return mapCohere(json.models ?? []);
}

// ── ElevenLabs ───────────────────────────────────────────────────────────────────

export interface ElevenLabsModel {
  model_id: string;
  name: string;
  can_do_text_to_speech?: boolean;
}

/**
 * Speech-to-text models aren't in /v1/models; Scribe v2 is the one its pricing page
 * includes on the Free plan (4.5 hours a month, checked 2026-10-02). Realtime is left out.
 */
export const ELEVENLABS_STT_MODELS = [{ id: "scribe_v2", name: "Scribe v2" }];

export function mapElevenLabs(models: ElevenLabsModel[]): ObservedModel[] {
  const tts = models.filter((m) => m.can_do_text_to_speech).map((m) => ({
    ...base("elevenlabs", "tts"),
    model_id: m.model_id,
    name: m.name,
    url: "https://elevenlabs.io/docs/models",
    price_type: "free" as const,
    context_length: null,
    input_modalities: ["text"],
    tool_calling: null,
  }));
  const stt = ELEVENLABS_STT_MODELS.map((m) => ({
    ...base("elevenlabs", "stt", "curated"),
    model_id: m.id,
    name: m.name,
    url: "https://elevenlabs.io/docs/models",
    price_type: "free" as const,
    context_length: null,
    input_modalities: ["audio"],
    tool_calling: null,
  }));
  return [...tts, ...stt];
}

async function fetchElevenLabs(env: Env): Promise<ObservedModel[]> {
  const json = await getJson<ElevenLabsModel[]>("https://api.elevenlabs.io/v1/models", { "xi-api-key": env.ELEVENLABS_API_KEY ?? "" });
  return mapElevenLabs(Array.isArray(json) ? json : []);
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

/**
 * Cloudflare's catalogue (models/search) carries task, context, tool support, price and
 * a `require_workers_paid` flag (checked 2026-09-28). Paid-only models are left out,
 * as are realtime and async-queue models (websocket or batch only).
 */
export function mapCloudflare(models: CloudflareModel[], pricing: Map<string, PriceLine[]> = new Map()): ObservedModel[] {
  return models.flatMap((m) => {
    const kind = CLOUDFLARE_TASKS[m.task?.name ?? ""];
    if (!kind) return [];
    const p = Object.fromEntries((m.properties ?? []).map((x) => [x.property_id, x.value]));
    if (String(p.require_workers_paid) === "true" || String(p.realtime) === "true" || String(p.async_queue) === "true") return [];
    if (kind === "chat" && classifyModel(m.name) !== "chat") return [];
    // Inpainting models edit an existing picture (they need an image and a mask): not text-to-image.
    if (kind === "image" && /inpaint/i.test(m.name)) return [];
    // The free-per-day estimate is derived from these prices when the site is built, so
    // rewording it never counts as a change.
    const lines = pricing.get(m.name) ?? catalogueLines(p.price);
    return [{
      ...base("cloudflare", kind),
      model_id: m.name,
      name: m.name.replace(/^@cf\//, ""),
      url: `https://developers.cloudflare.com/workers-ai/models/${m.name.split("/").pop()}/`,
      price_type: "freemium-quota" as const,
      context_length: kind === "chat" && p.context_window ? Number(p.context_window) : null,
      input_modalities: kind === "chat" ? (String(p.vision) === "true" ? ["text", "image"] : ["text"]) : kind === "stt" ? ["audio"] : ["text"],
      tool_calling: kind === "chat" ? String(p.function_calling) === "true" : null,
      rate_limits: PROVIDERS.cloudflare.rate_limits,
      terms_url: typeof p.terms === "string" ? p.terms : typeof p.info === "string" ? p.info : null,
      pricing: lines,
    }];
  });
}

async function fetchCloudflare(env: Env): Promise<ObservedModel[]> {
  if (!env.CLOUDFLARE_ACCOUNT_ID) throw new Error("CLOUDFLARE_ACCOUNT_ID not set");
  const json = await getJson<{ result?: CloudflareModel[] }>(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/models/search?per_page=500`,
    { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
  );
  // Prices come from the pricing page. If it can't be read, the whole fetch fails, so the
  // provider is skipped this run instead of every model "losing" its price.
  const pricing = await fetchCloudflarePricing();
  if (pricing.size === 0) throw new Error("Cloudflare pricing page had no price rows");
  return mapCloudflare(json.result ?? [], pricing);
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
  mistral: fetchMistral,
  ollama: fetchOllama,
  cohere: fetchCohere,
  elevenlabs: fetchElevenLabs,
  hetzner: fetchHetzner,
  requesty: () => fetchRequesty(),
  amd: fetchAmd,
  bazaarlink: () => fetchBazaarLink(),
  orcarouter: () => fetchOrcaRouter(),
  opencode: () => fetchOpenCode(),
  speechify: fetchSpeechify,
  cartesia: fetchCartesia,
};
