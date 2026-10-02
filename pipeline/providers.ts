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
  /** OpenAI-compatible base URL, for the daily test and for the Cline snippet. "{account}" is filled in from CLOUDFLARE_ACCOUNT_ID. */
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
  /** False to skip the 18:10 UTC peak-hours test (a small monthly call budget, like Cohere's). */
  peak_test?: boolean;
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
    usage_terms_note: "Z.ai's privacy policy says it uses data to improve its services, including training its models.",
    limit_scope: "per-model",
    // The pricing page (checked 2026-09-29) lists the Flash models as Free but gives no rate limits.
    rate_limits: null,
    card_required: "no",
    account_required: "yes",
    data_logging: "may-train",
    limits_url: "https://docs.z.ai/guides/overview/pricing",
    summary: "Zhipu's international API. Three GLM Flash models are priced free (in the Text and Vision tables of its pricing page), including a vision model.",
  },
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    homepage: "https://developers.cloudflare.com/workers-ai/",
    base_url: "https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1",
    key_env: "CLOUDFLARE_API_TOKEN",
    list_needs_key: true,
    usage_terms: "production-ok",
    // developers.cloudflare.com/workers-ai/platform/pricing, checked 2026-09-28.
    usage_terms_note: "Free on the Workers Free plan within 10,000 Neurons a day, shared by all models and reset at 00:00 UTC; going over doesn't bill you, requests just fail. Some large models need the paid plan and are left out. Each model also has its own licence or terms, linked on its page.",
    limit_scope: "shared",
    rate_limits: {
      note: "10,000 Neurons per day across all models (resets 00:00 UTC). How far that goes depends on the model; see the estimate per model.",
      source: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
    },
    card_required: "no",
    account_required: "yes",
    data_logging: "unknown",
    limits_url: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
    summary: "Cloudflare's hosted models: chat, speech and image generation (FLUX, Stable Diffusion), free within a daily Neuron allowance. One of the few real free options for image generation.",
  },
  mistral: {
    id: "mistral",
    label: "Mistral AI (Free mode)",
    homepage: "https://mistral.ai",
    base_url: "https://api.mistral.ai/v1",
    key_env: "MISTRAL_API_KEY",
    list_needs_key: true,
    usage_terms: "unknown",
    // help.mistral.ai "Do you use my user data to train…" and docs.mistral.ai, checked 2026-09-29.
    usage_terms_note: "Mistral's Free mode: API access with no credit card, with usage and rate limits. Mistral says it may use Free-mode inputs and outputs to train its models. Some models (Mistral Small, Mistral Medium) have a free limit of 0.",
    limit_scope: "per-model",
    // Not published; each response carries the model's per-minute limits, which the daily test records.
    rate_limits: null,
    card_required: "no",
    account_required: "yes",
    data_logging: "may-train",
    limits_url: "https://docs.mistral.ai/admin/billing-usage/usage-limits",
    summary: "Mistral's own API. Free mode covers its smaller models (Ministral, Codestral, Voxtral) within per-minute limits shown in your account; the bigger ones need pay-as-you-go.",
  },
  ollama: {
    id: "ollama",
    label: "Ollama Cloud (Free plan)",
    homepage: "https://ollama.com",
    base_url: "https://ollama.com/v1",
    key_env: "OLLAMA_API_KEY",
    list_needs_key: true,
    usage_terms: "unknown",
    // ollama.com/pricing, checked 2026-10-02.
    usage_terms_note: "Ollama's Free plan includes a starter amount of cloud usage for a smaller set of starter models, reset monthly from your signup date, one request at a time. Ollama says prompt and response data is never logged or trained on. Other cloud models need paid usage credits.",
    limit_scope: "shared",
    rate_limits: {
      note: "A starter amount of usage per month (not published as a number), reset monthly from signup; 1 concurrent request.",
      source: "https://ollama.com/pricing",
    },
    card_required: "unknown",
    account_required: "yes",
    data_logging: "not-used",
    limits_url: "https://ollama.com/pricing",
    summary: "Ollama's hosted models, called with an API key. The Free plan covers a few starter models (Nemotron, gpt-oss, Gemma) and Ollama says it never logs or trains on prompts.",
  },
  cohere: {
    id: "cohere",
    label: "Cohere (trial key)",
    homepage: "https://cohere.com",
    base_url: "https://api.cohere.ai/compatibility/v1",
    key_env: "COHERE_API_KEY",
    list_needs_key: true,
    peak_test: false,
    usage_terms: "unknown",
    // docs.cohere.com: rate-limits, cohere-faqs, going-live; cohere.com/enterprise-data-commitments. Checked 2026-10-02.
    usage_terms_note: "Cohere gives every account a free, rate-limited trial key, which its FAQ describes for personal projects and prototyping; going live means upgrading to a paid production key. Trial keys get 1,000 API calls a month in total. Prompts and generations may be used to train Cohere's models unless you opt out in the dashboard.",
    limit_scope: "shared",
    rate_limits: {
      rpm: 20,
      note: "20 requests/minute per chat model (5 for transcription), and 1,000 API calls a month across everything on a trial key.",
      source: "https://docs.cohere.com/docs/rate-limits",
    },
    card_required: "no",
    account_required: "yes",
    data_logging: "may-train",
    limits_url: "https://docs.cohere.com/docs/rate-limits",
    summary: "Cohere's Command and Aya models and its speech-to-text model, free on a trial key with 1,000 calls a month. Good for trying them, not for an app.",
  },
  elevenlabs: {
    id: "elevenlabs",
    label: "ElevenLabs (Free plan)",
    homepage: "https://elevenlabs.io",
    base_url: "https://api.elevenlabs.io/v1",
    key_env: "ELEVENLABS_API_KEY",
    list_needs_key: true,
    usage_terms: "non-commercial",
    // help.elevenlabs.io "Can I publish the content I generate…" and elevenlabs.io/pricing(/api), checked 2026-10-02.
    usage_terms_note: "ElevenLabs' Free plan \"does not include a commercial license and cannot be used for any commercial purpose\"; content shared non-commercially needs attribution to ElevenLabs.",
    limit_scope: "shared",
    rate_limits: {
      note: "10,000 credits a month for text-to-speech (about 1 per character; Flash and Turbo models use half) and 4.5 hours of Scribe v2 speech-to-text.",
      source: "https://elevenlabs.io/pricing/api",
    },
    card_required: "unknown",
    account_required: "yes",
    data_logging: "unknown",
    limits_url: "https://elevenlabs.io/pricing/api",
    summary: "Well-known text-to-speech voices and Scribe speech-to-text, with a monthly free allowance. Non-commercial use only on the Free plan.",
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

/** The provider's base URL with account placeholders filled in. */
export function baseUrl(p: ProviderId, env: Record<string, string | undefined>): string {
  return PROVIDERS[p].base_url.replace("{account}", env.CLOUDFLARE_ACCOUNT_ID ?? "{account}");
}
