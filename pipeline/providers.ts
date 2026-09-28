/**
 * Per-provider facts that the model lists do not carry: terms, limit scope, and
 * rate limits we have checked against the provider's own docs.
 *
 * Type-only imports, so the site can use the labels without pulling in fetchers.
 *
 * Only put a number here after reading it on the provider's page, and record the
 * URL and date. Anything not checked stays out: "unknown" is an honest value, a
 * number copied from a blog post is not.
 */

import type { DataLogging, LimitScope, ProviderId, RateLimits, UsageTerms, YesNoUnknown } from "./types";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  homepage: string;
  /** OpenAI-compatible base URL, for the daily test and for the Cline snippet. */
  base_url: string;
  /** Env var holding the key for the daily test (and for listing, where needed); null when no key is used. */
  key_env: string | null;
  /** Whether listing models works without a key. */
  list_needs_key: boolean;
  /**
   * False when its free models can't be called from outside (Cline serves them only
   * inside its own extension): listed and tracked, never tested.
   */
  testable?: boolean;
  usage_terms: UsageTerms;
  usage_terms_note: string | null;
  limit_scope: LimitScope;
  rate_limits: RateLimits | null;
  card_required: YesNoUnknown;
  account_required: YesNoUnknown;
  /** Provider default; an adapter may set it per model (Kilo publishes it per model). */
  data_logging: DataLogging;
  /** Page a visitor should read for current free-tier limits. */
  limits_url: string;
  /** One-line summary for the provider page. */
  summary: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    homepage: "https://openrouter.ai",
    base_url: "https://openrouter.ai/api/v1",
    key_env: "OPENROUTER_API_KEY",
    list_needs_key: false,
    usage_terms: "production-ok",
    usage_terms_note: null,
    limit_scope: "shared",
    // Checked 2026-09-28: openrouter.ai/docs/faq and the OpenRouter rate-limit article.
    rate_limits: {
      rpm: 20,
      rpd: 50,
      note: "Shared across all free models. 1,000 requests/day after a one-time purchase of 10 credits.",
      source: "https://openrouter.ai/docs/faq",
    },
    card_required: "no",
    account_required: "yes",
    data_logging: "unknown",
    limits_url: "https://openrouter.ai/docs/api_reference/limits",
    summary: "Router over many inference providers. Models with a :free suffix cost nothing, within a daily request cap shared by all free models.",
  },
  groq: {
    id: "groq",
    label: "Groq",
    homepage: "https://groq.com",
    base_url: "https://api.groq.com/openai/v1",
    key_env: "GROQ_API_KEY",
    list_needs_key: true,
    usage_terms: "production-ok",
    usage_terms_note: null,
    limit_scope: "per-model",
    // Per-model limits are read from response headers by the daily test.
    rate_limits: null,
    card_required: "no",
    account_required: "yes",
    data_logging: "unknown",
    limits_url: "https://console.groq.com/docs/rate-limits",
    summary: "Fast inference on Groq hardware. Every active model is usable on the free plan, each with its own limits.",
  },
  "google-ai-studio": {
    id: "google-ai-studio",
    label: "Google AI Studio (Gemini API)",
    homepage: "https://aistudio.google.com",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    key_env: "GOOGLE_AI_STUDIO_API_KEY",
    list_needs_key: true,
    usage_terms: "production-ok",
    usage_terms_note: "Free-tier prompts may be used by Google to improve its products; check the Gemini API terms before sending private data.",
    limit_scope: "per-model",
    rate_limits: null,
    card_required: "no",
    account_required: "yes",
    data_logging: "may-train",
    limits_url: "https://ai.google.dev/gemini-api/docs/rate-limits",
    summary: "Gemini API with a free tier for some models. The model list does not say which; the daily test on a free-tier key does.",
  },
  nvidia: {
    id: "nvidia",
    label: "NVIDIA API catalog (build.nvidia.com)",
    homepage: "https://build.nvidia.com",
    base_url: "https://integrate.api.nvidia.com/v1",
    key_env: "NVIDIA_API_KEY",
    list_needs_key: true,
    usage_terms: "evaluation-only",
    // NVIDIA API Trial Terms of Service, checked 2026-09-13 and 2026-09-28.
    usage_terms_note: "Free for internal testing and evaluation only, not for production, unless you buy a subscription (NVIDIA API Trial Terms of Service).",
    limit_scope: "shared",
    rate_limits: null,
    card_required: "no",
    account_required: "yes",
    data_logging: "logs-prompts",
    limits_url: "https://build.nvidia.com",
    summary: "Hosted NVIDIA NIM endpoints for many open models. Free, but only for testing and evaluation.",
  },
  kilo: {
    id: "kilo",
    label: "Kilo Code gateway",
    homepage: "https://kilo.ai",
    base_url: "https://api.kilo.ai/api/gateway",
    key_env: null,
    list_needs_key: false,
    usage_terms: "unknown",
    // kilo.ai/docs/gateway (authentication, models-and-providers), checked 2026-09-28.
    usage_terms_note: "Free models work without an account or API key. Kilo marks every free model as possibly training on your prompts, and NVIDIA-hosted ones are trial-only and logged. Don't send personal or confidential data.",
    limit_scope: "shared",
    rate_limits: {
      rph: 200,
      note: "Anonymous access: 200 requests per hour per IP address, across all free models.",
      source: "https://kilo.ai/docs/gateway/authentication",
    },
    card_required: "no",
    account_required: "no",
    data_logging: "may-train",
    limits_url: "https://kilo.ai/docs/gateway/authentication",
    summary: "The AI gateway behind the Kilo Code agent. A rotating set of free models, usable anonymously, many shared with OpenRouter's free pool.",
  },
  llm7: {
    id: "llm7",
    label: "LLM7.io",
    homepage: "https://llm7.io",
    base_url: "https://api.llm7.io/v1",
    key_env: null,
    list_needs_key: false,
    usage_terms: "evaluation-only",
    // docs.llm7.io/limits and TERMS.md, checked 2026-09-28.
    usage_terms_note: "LLM7's terms say the service is for education, experimentation, development and research, not production, and that prompts may be processed to operate and improve it. It may not be resold or proxied to others.",
    limit_scope: "shared",
    rate_limits: {
      rpm: 10,
      rph: 60,
      tpd: 500_000,
      note: "Anonymous; a free token (email sign-in) raises this to 40/minute, 100/hour and 1M tokens/day.",
      source: "https://docs.llm7.io/limits",
    },
    card_required: "no",
    account_required: "no",
    data_logging: "may-train",
    limits_url: "https://docs.llm7.io/limits",
    summary: "A gateway with a few fast \"turbo\" models open to anyone without an account; the rest are paid.",
  },
  zai: {
    id: "zai",
    label: "Z.ai (Zhipu)",
    homepage: "https://z.ai",
    base_url: "https://api.z.ai/api/paas/v4",
    key_env: "ZAI_API_KEY",
    list_needs_key: true,
    usage_terms: "unknown",
    // docs.z.ai pricing and privacy policy, checked 2026-09-28.
    usage_terms_note: "Z.ai's privacy policy says it uses data to improve its services, including training its models. Free models allow one request at a time.",
    limit_scope: "per-model",
    rate_limits: { note: "One concurrent request per free model.", source: "https://docs.z.ai/guides/overview/pricing" },
    card_required: "no",
    account_required: "yes",
    data_logging: "may-train",
    limits_url: "https://docs.z.ai/guides/overview/pricing",
    summary: "Zhipu's international API. Three GLM Flash models are priced free, including a vision model.",
  },
  cline: {
    id: "cline",
    label: "Cline (free promotion)",
    homepage: "https://cline.bot",
    base_url: "https://api.cline.bot/api/v1",
    key_env: null,
    list_needs_key: false,
    testable: false,
    usage_terms: "unknown",
    // docs.cline.bot/getting-started/free-models, checked 2026-09-28.
    usage_terms_note: "Free for anyone with a Cline account, up to a usage quota, and only inside the Cline extension and CLI (not the Cline API), so we can't test them. The models rotate. Cline says free usage may be used to improve the models.",
    limit_scope: "per-model",
    rate_limits: { note: "Limited free usage quota per Cline account; the amount isn't published.", source: "https://docs.cline.bot/getting-started/free-models" },
    card_required: "no",
    account_required: "yes",
    data_logging: "may-train",
    limits_url: "https://docs.cline.bot/getting-started/free-models",
    summary: "The models Cline currently gives away inside its own extension, tagged FREE in its model picker. We list them and show how the same models do elsewhere.",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
