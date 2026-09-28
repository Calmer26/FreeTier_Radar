/**
 * The daily test: one tiny chat request per free model.
 *
 * Adapted from solo_developer's model-rotation `probe.ts` (2026-09-28). The site shows
 * the result as "responded at 06:10 UTC", not as "available": one request a day
 * proves the model was up, not that it is usable at busy times.
 *
 * Any HTTP 200 counts as responded, even with empty text. With a 16-token cap a
 * reasoning model can spend everything on thinking and return no content, and that
 * is still a model that answered.
 */

import { SITE } from "../site.config";
import { PROVIDERS } from "./providers";
import type { RateLimits, Resource, TestHistory, TestResult, TestStatus } from "./types";

export const TEST_TIMEOUT_MS = 30_000;
export const SLOW_MS = 20_000;
export const HISTORY_DAYS = 30;

const PROMPT = "Reply with the single word: OK";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Exported for tests. */
export function classifyFailure(err: unknown): TestStatus {
  if ((err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError") return "slow";
  const status = err instanceof HttpError ? err.status : null;
  const message = String((err as Error)?.message ?? err ?? "").toLowerCase();

  // Gemini answers a model outside the key's free tier with 429 and "limit: 0".
  if (/limit:\s*0\b/.test(message) || message.includes("free tier is not available")) return "no_free_quota";
  if (status === 429 || /rate limit|too many requests|resource_exhausted/.test(message)) return "rate_limited";
  if (
    status === 404 || status === 410 ||
    /not found|end of life|does not exist|no endpoints found|unavailable for free|no longer available as a free model|transitioned to a paid model/.test(message)
  ) {
    return "gone";
  }
  return "error";
}

/** Groq sends its per-model limits on every response. Exported for tests. */
export function limitsFromHeaders(h: Headers): RateLimits | null {
  const rpd = Number(h.get("x-ratelimit-limit-requests"));
  const tpm = Number(h.get("x-ratelimit-limit-tokens"));
  if (!rpd && !tpm) return null;
  return {
    ...(rpd ? { rpd } : {}),
    ...(tpm ? { tpm } : {}),
    source: "observed (response headers)",
  };
}

export interface TestOutcome {
  result: TestResult;
  limits: RateLimits | null;
}

export async function testModel(r: Resource, env: Record<string, string | undefined>): Promise<TestOutcome> {
  const info = PROVIDERS[r.provider];
  const started = Date.now();
  const at = new Date(started).toISOString();
  try {
    const res = await fetch(`${info.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env[info.key_env]}`,
        ...(r.provider === "openrouter" ? { "HTTP-Referer": SITE.url, "X-Title": SITE.name } : {}),
      },
      body: JSON.stringify({ model: r.model_id, messages: [{ role: "user", content: PROMPT }], max_tokens: 16 }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    const latency = Date.now() - started;
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 500);
      throw new HttpError(res.status, `${res.status} ${body}`);
    }
    await res.body?.cancel();
    return {
      result: { at, status: latency > SLOW_MS ? "slow" : "responded", latency_ms: latency },
      limits: r.provider === "groq" ? limitsFromHeaders(res.headers) : null,
    };
  } catch (err) {
    return { result: { at, status: classifyFailure(err), latency_ms: Date.now() - started }, limits: null };
  }
}

/**
 * Adds today's result (replacing an earlier one from the same UTC day), trims the
 * window to HISTORY_DAYS, and drops resources that no longer exist. Pure.
 */
export function recordResults(
  history: TestHistory,
  outcomes: Map<string, TestOutcome>,
  knownIds: Set<string>,
  now: string,
): TestHistory {
  const cutoff = new Date(Date.parse(now) - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const results: TestHistory["results"] = {};
  const observed_limits: TestHistory["observed_limits"] = {};

  for (const id of [...new Set([...Object.keys(history.results), ...outcomes.keys()])].sort()) {
    if (!knownIds.has(id)) continue;
    let list = (history.results[id] ?? []).filter((t) => t.at.slice(0, 10) >= cutoff);
    const outcome = outcomes.get(id);
    if (outcome) {
      list = list.filter((t) => t.at.slice(0, 10) !== outcome.result.at.slice(0, 10));
      list.push(outcome.result);
    }
    if (list.length) results[id] = list;
    const limits = outcome?.limits ?? history.observed_limits[id];
    if (limits) observed_limits[id] = limits;
  }
  return { updated_at: now, results, observed_limits };
}
