/**
 * Shared shapes for the pipeline and the site.
 *
 * Nothing here imports anything, so the Astro site can read these types without
 * pulling in the fetchers.
 */

export type ProviderId = "openrouter" | "groq" | "google-ai-studio" | "nvidia" | "kilo" | "llm7" | "zai" | "cline" | "cloudflare" | "mistral" | "ollama" | "cohere" | "elevenlabs" | "hetzner"
  | "requesty" | "amd" | "bazaarlink" | "orcarouter" | "opencode" | "speechify" | "cartesia";

/** What a model does. Each kind has its own directory tab and its own daily test. */
export type ModelKind = "chat" | "tts" | "stt" | "image";

export const MODEL_KINDS: readonly ModelKind[] = ["chat", "tts", "stt", "image"];

export type PriceType = "free" | "freemium-quota" | "trial-credit" | "paid" | "unknown";
export type UsageTerms = "production-ok" | "evaluation-only" | "non-commercial" | "unknown";
export type LimitScope = "per-model" | "shared" | "unknown";
export type YesNoUnknown = "yes" | "no" | "unknown";
/** What the provider says it does with prompts. "may-train" includes "to improve the service". */
/** "not-used": the provider states it never logs or trains on prompts (Ollama Cloud). "none-stated": it publishes data use and states nothing. */
export type DataLogging = "not-used" | "none-stated" | "logs-prompts" | "may-train" | "unknown";

export interface RateLimits {
  rpm?: number;
  rph?: number;
  rpd?: number;
  tpm?: number;
  tpd?: number;
  /** Free-text note, e.g. "1,000 RPD after a one-time $10 credit purchase". */
  note?: string;
  /** Where the numbers come from: a docs URL, or "observed" (response headers). */
  source?: string;
}

/**
 * What an adapter observed for one model in one run. Only these fields feed the
 * fingerprint, so a change in any of them is a change event and nothing else is.
 */
export interface ObservedModel {
  provider: ProviderId;
  model_id: string;
  kind: ModelKind;
  /**
   * "api" when the provider's model list returned it; "curated" when the provider
   * publishes no list for this kind (OpenRouter speech) and it is kept by hand. The
   * daily test is what shows a curated entry still works.
   */
  listed_by: "api" | "curated";
  name: string;
  url: string;
  price_type: PriceType;
  context_length: number | null;
  input_modalities: string[] | null;
  tool_calling: boolean | null;
  rate_limits: RateLimits | null;
  limit_scope: LimitScope;
  usage_terms: UsageTerms;
  licence: string | null;
  card_required: YesNoUnknown;
  account_required: YesNoUnknown;
  data_logging: DataLogging;
  /** The model's own terms or licence page, when the provider links one (Cloudflare). */
  terms_url?: string | null;
  /** What going beyond the free allowance costs (Cloudflare's pricing page). */
  pricing?: PriceLine[] | null;
  /** Price of the paid version of a free model (OpenRouter: same id without ":free"). Not tracked. */
  paid_version_pricing?: PriceLine[] | null;
}

/** One price: "$0.06 per M input tokens" (= 5,500 Neurons on Cloudflare). */
export interface PriceLine {
  usd: number;
  unit: string;
  neurons: number | null;
}

export type ResourceStatus = "active" | "pending_removal" | "removed";

export interface Resource extends ObservedModel {
  /** `${provider}/${model_id}` — unique across the whole dataset. */
  id: string;
  /** URL-safe, unique within its provider. */
  slug: string;
  category: "ai-model";
  status: ResourceStatus;
  first_seen: string;
  last_seen: string;
  /** Set while a model is absent from its provider's list but not yet removed. */
  missing_since: string | null;
  removed_at: string | null;
  fingerprint: string;
}

export type EventType = "NEW" | "CHANGED" | "REMOVED" | "RETURNED" | "OFFER";

export interface ResourceEvent {
  id: string;
  /** A model id, or `offer/<id>` for OFFER events. */
  resource_id: string;
  provider: ProviderId | string;
  name: string;
  detected_at: string;
  event_type: EventType;
  /** Set on CHANGED events only. */
  field: string | null;
  old_value: unknown;
  new_value: unknown;
  impact_score: number;
  source_url: string;
  text: string;
}

/**
 * Result of the daily test request.
 *
 *   responded      answered within the slow threshold
 *   slow           answered late, or timed out
 *   rate_limited   429 — says nothing about the model
 *   no_free_quota  the provider refused because this key's free tier has no quota for it
 *   gone           404/410/"not found"/moved to paid
 *   restricted     only served through certain apps (OpenRouter: "only available on
 *                  agentic harnesses", i.e. the coding agents it lists)
 *   error          anything else
 */
export type TestStatus = "responded" | "slow" | "rate_limited" | "no_free_quota" | "gone" | "restricted" | "error";

export interface TestResult {
  /** ISO timestamp of the request. */
  at: string;
  status: TestStatus;
  latency_ms: number | null;
  /** Speech-to-text only: word error rate of the transcript of our clip (0 = perfect). */
  wer?: number;
}

/** Result of the daily tool-call test (chat models only). See tool-test.ts. */
export interface ToolResult {
  at: string;
  status: "pass" | "fail" | "error";
  latency_ms: number | null;
}

/** Result of the JSON-schema output test (chat models only). See json-test.ts. */
export interface JsonResult extends ToolResult {
  /** The response_format the provider accepted; absent when it refused both. */
  mode?: "json_schema" | "json_object";
}

export interface TestHistory {
  updated_at: string | null;
  /** Rolling window, newest last, at most one entry per UTC day per resource. */
  results: Record<string, TestResult[]>;
  /** Tool-call test results, same window; absent in files written before it existed. */
  tool_results?: Record<string, ToolResult[]>;
  /** Multi-turn tool test (tool result → final answer); absent in older files. */
  multi_tool_results?: Record<string, ToolResult[]>;
  /** JSON-schema output test; absent in older files. */
  json_results?: Record<string, JsonResult[]>;
  /** Limits read from response headers (Groq publishes them), by resource id. */
  observed_limits: Record<string, RateLimits>;
}

/**
 * Kept at day granularity on purpose: a timestamp per run would make every quiet
 * run a commit and a site rebuild.
 */
export interface SourceState {
  /** UTC day (YYYY-MM-DD) of the last successful fetch. */
  last_success: string | null;
  consecutive_failures: number;
  last_error: string | null;
  /** Set once an issue has been raised for the current failure streak. */
  alerted: boolean;
}

export type SourcesFile = Record<string, SourceState>;

export interface SponsorFile {
  active: boolean;
  name: string;
  text: string;
  url: string;
  logo: string | null;
  starts: string | null;
  ends: string | null;
}

/**
 * A provider's free budget rather than a free model: trial credit, a monthly credit,
 * or a daily quota pool shared by all its models. Curated by the owner in
 * data/offers/ai/*.json; a weekly page watcher flags when the source page changes.
 */
export interface Offer {
  id: string;
  provider: string;
  name: string;
  /** "search": one-time web search API credits (data/offers/search/); absent: AI. */
  category?: "ai" | "search";
  offer_type: "recurring-quota" | "recurring-credit" | "trial-credit" | "retired";
  /** One line, e.g. "10,000 Neurons per day, shared across all models". */
  amount: string;
  summary: string;
  expires: string | null;
  usage_terms: UsageTerms;
  card_required: YesNoUnknown;
  account_required: "yes" | "no" | "phone-verification" | "unknown";
  data_logging: DataLogging;
  url: string;
  /** Page the watcher fetches weekly; null to skip watching. */
  watch_url: string | null;
  verified_on: string;
  source_note: string;
  /** Newest last. Each entry appears in the change feed as an OFFER event. */
  changes: Array<{ date: string; text: string }>;
}

/**
 * A consumer app (web or phone) that makes images or videos for free but has no free
 * API: Gemini app, Meta AI, Dreamina... Hand-kept in data/apps/, like offers.
 * Allowances only from the app's own pages; "not published" is a valid value.
 */
export interface FreeApp {
  id: string;
  name: string;
  maker: string;
  url: string;
  summary: string;
  image: FreeAppMedia | null;
  video: FreeAppMedia | null;
  account_required: YesNoUnknown;
  /** Can you use what you make commercially on the free plan? */
  commercial_use: "yes" | "no" | "conditions" | "unknown";
  commercial_note: string | null;
  /** Free-plan output carries a visible watermark. */
  watermark: YesNoUnknown;
  /** Free-plan creations are public (others can see them). */
  public_by_default: YesNoUnknown;
  data_logging: DataLogging;
  /** Page the watcher fetches weekly; null when the site blocks automated reads. */
  watch_url: string | null;
  verified_on: string;
  source_note: string;
}

export interface FreeAppMedia {
  /** Model names as the app gives them. */
  models: string;
  /** Free allowance in the app's own words, e.g. "120 credits a day, shared by images and video". */
  allowance: string;
  /** LMArena name of the model free users get, only when the app's pages make that clear. */
  arena: string | null;
  arena_note?: string;
}

export interface WatchState {
  hash: string;
  checked_on: string;
  changed_on: string | null;
}

/** Where a number or statement comes from: the provider's own page, and the day we read it. */
export interface Sourced {
  url: string;
  /** YYYY-MM-DD */
  checked: string;
}

/** Request style of a search API; each has its own request and response shape (search.ts). */
export type SearchStyle = "brave" | "tavily" | "exa" | "firecrawl" | "parallel" | "linkup";

/**
 * A web search API with a recurring free allowance. Hand-kept in data/search/apis/,
 * like offers: numbers only from the provider's own pages, each with its source and
 * date. One-time credits are offers (data/offers/search/), not these.
 */
export interface SearchApi {
  id: string;
  name: string;
  maker: string;
  url: string;
  docs_url: string;
  summary: string;
  /** Whose results: its own index, scraped Google/Bing results, or both. */
  index: "own" | "google-serp" | "mixed" | "unknown";
  api: {
    style: SearchStyle;
    endpoint: string;
    method: "GET" | "POST";
    /** How the key is sent, e.g. "Authorization: Bearer <key>" or "X-Subscription-Token: <key>". */
    auth: string;
  };
  /** Env var name we use for the key. */
  key_env: string;
  allowance: {
    period: "month" | "day";
    amount: number;
    unit: "queries" | "credits" | "usd";
    /** The provider's own words, e.g. "$5 in free credits every month". */
    text: string;
    /** When it renews, e.g. "1st of each month"; null when not stated. */
    resets: string | null;
    source: Sourced;
  };
  /** What one search costs, in the allowance's unit. */
  cost_per_query: {
    /** The cheapest plain web search (what our daily test sends). */
    basic: number;
    basic_label: string;
    /** The deeper search mode, when there is one with a published price. */
    advanced: number | null;
    advanced_label: string | null;
    source: Sourced;
  };
  rate_limits: {
    rps?: number;
    rpm?: number;
    rph?: number;
    rpd?: number;
    concurrency?: number;
    note?: string;
    source: Sourced;
  } | null;
  card_required: YesNoUnknown;
  /** Shown as the card badge's text when a card is required. */
  card_note: string | null;
  account_required: YesNoUnknown;
  account_note: string | null;
  usage_terms: UsageTerms;
  usage_terms_note: string | null;
  terms_source: Sourced | null;
  /** May you store or cache results? Brave: only on a plan that grants storage rights. */
  result_storage: "allowed" | "not-allowed" | "unknown";
  /** What the provider says it does with queries. */
  data_logging: DataLogging;
  data_logging_note: string | null;
  data_logging_source: Sourced | null;
  /** Can a search target a country and a language (e.g. NL / nl)? */
  locale: {
    country: YesNoUnknown;
    language: YesNoUnknown;
    /** Request fields for Dutch results from the Netherlands, when supported. */
    example: string | null;
    note: string | null;
    source: Sourced;
  };
  /** Page the weekly watcher fetches; null to skip. */
  watch_url: string | null;
  verified_on: string;
  /** Newest last; shown in the change feed. */
  changes: Array<{ date: string; text: string }>;
}

/** A search API we checked and left out, with the reason (not tested, not ranked). */
export interface SearchNearMiss {
  name: string;
  url: string;
  reason: string;
  source: Sourced;
}

/** data/tests/search.json: the daily search test, 30 days, one result per day per API. */
export interface SearchTestFile {
  updated_at: string | null;
  results: Record<string, TestResult[]>;
}
