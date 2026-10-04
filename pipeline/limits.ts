/**
 * One model's rate limits, from the three places we have them. Pure.
 *
 * - Provider-wide limits from its docs (`rate_limits` on the resource) apply to every
 *   model and are used as they are.
 * - Otherwise the limits the daily test read from response headers, per field, because
 *   they are what the API enforces today; the provider's per-model docs
 *   (`MODEL_RATE_LIMITS`) fill the fields headers don't carry (Groq: rpm, tpd).
 */

import type { RateLimits } from "./types";

const NUMBERS = ["rpm", "rph", "rpd", "tpm", "tpd"] as const;
const OBSERVED = "observed (response headers)";

export function effectiveLimits(
  provider: RateLimits | null,
  documented: RateLimits | null | undefined,
  observed: RateLimits | null | undefined,
): RateLimits | null {
  if (provider) return provider;
  if (!documented || !observed) return documented ?? observed ?? null;
  const merged: RateLimits = {};
  let fromHeaders = false;
  for (const k of NUMBERS) {
    const v = observed[k] ?? documented[k];
    if (v == null) continue;
    merged[k] = v;
    if (observed[k] != null) fromHeaders = true;
  }
  if (documented.note) merged.note = documented.note;
  merged.source = fromHeaders ? `${OBSERVED}; ${documented.source}` : documented.source;
  return merged;
}

/**
 * Limits as the working feed publishes them: every field present, null when the provider
 * doesn't publish it and we haven't seen it in headers (unknown, not unlimited).
 */
export interface FeedLimits {
  rpm: number | null;
  rph: number | null;
  rpd: number | null;
  tpm: number | null;
  tpd: number | null;
  note: string | null;
  source: string | null;
}

export function feedLimits(l: RateLimits | null): FeedLimits {
  return {
    rpm: l?.rpm ?? null,
    rph: l?.rph ?? null,
    rpd: l?.rpd ?? null,
    tpm: l?.tpm ?? null,
    tpd: l?.tpd ?? null,
    note: l?.note ?? null,
    source: l?.source ?? null,
  };
}
