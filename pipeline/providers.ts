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

import type { LimitScope, ProviderId, RateLimits, UsageTerms, YesNoUnknown } from "./types";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  homepage: string;
  /** OpenAI-compatible base URL, for the daily test and for the Cline snippet. */
  base_url: string;
  /** Env var holding the key for the daily test (and for listing, where needed). */
  key_env: string;
  /** Whether listing models works without a key. */
  list_needs_key: boolean;
  usage_terms: UsageTerms;
  usage_terms_note: string | null;
  limit_scope: LimitScope;
  rate_limits: RateLimits | null;
  card_required: YesNoUnknown;
  account_required: YesNoUnknown;
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
    limits_url: "https://build.nvidia.com",
    summary: "Hosted NVIDIA NIM endpoints for many open models. Free, but only for testing and evaluation.",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
