/**
 * The daily search test: one cheap query per search API each morning. It answers when
 * the API returns at least one result with a URL; we record the status and latency,
 * never the results. A 429 is a rate limit (not recorded, like the model tests); a
 * used-up allowance is `no_free_quota`.
 *
 * The request builders are in search.ts (the site shows them); the run is
 * run-search-tests.ts.
 */

import { classifyFailure, HISTORY_DAYS, HttpError, SLOW_MS, TEST_TIMEOUT_MS } from "./probe";
import { buildSearchRequest, resultUrls } from "./search";
import type { SearchApi, SearchTestFile, TestResult, TestStatus } from "./types";

/**
 * Like the model tests, plus the ways search APIs say the free allowance is used up:
 * 402 (Firecrawl, Exa), Tavily's 432 (plan limit) and 433 (pay-as-you-go limit).
 */
export function classifySearchFailure(err: unknown): TestStatus {
  const status = err instanceof HttpError ? err.status : null;
  if (status === 402 || status === 432 || status === 433) return "no_free_quota";
  const message = String((err as Error)?.message ?? "").toLowerCase();
  if (/insufficient (credits|balance)|out of credits|exceeds your plan|usage limit/.test(message) && status !== 429) return "no_free_quota";
  return classifyFailure(err);
}

export interface SearchOutcome {
  result: TestResult;
  detail: string | null;
}

export async function testSearchApi(api: SearchApi, env: Record<string, string | undefined>): Promise<SearchOutcome> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  try {
    const { url, init } = buildSearchRequest(api, env);
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
    if (!res.ok) throw new HttpError(res.status, `${res.status} ${(await res.text().catch(() => "")).slice(0, 500)}`);
    const urls = resultUrls(api.api.style, await res.json());
    if (urls.length === 0) throw new Error("no results in the response");
    const latency = Date.now() - started;
    return { result: { at, status: latency > SLOW_MS ? "slow" : "responded", latency_ms: latency }, detail: null };
  } catch (err) {
    return {
      result: { at, status: classifySearchFailure(err), latency_ms: Date.now() - started },
      detail: String((err as Error)?.message ?? err).replace(/\s+/g, " ").slice(0, 200),
    };
  }
}

/**
 * Adds today's results (replacing an earlier one from the same UTC day), trims the
 * window to HISTORY_DAYS, and drops APIs no longer listed. Pure.
 */
export function recordSearchResults(file: SearchTestFile, outcomes: Map<string, TestResult>, knownIds: Set<string>, now: string): SearchTestFile {
  const cutoff = new Date(Date.parse(now) - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const day = (t: { at: string }) => t.at.slice(0, 10);
  const results: SearchTestFile["results"] = {};
  for (const id of [...new Set([...Object.keys(file.results), ...outcomes.keys()])].sort()) {
    if (!knownIds.has(id)) continue;
    const next = outcomes.get(id);
    const kept = (file.results[id] ?? []).filter((t) => day(t) >= cutoff && (!next || day(t) !== day(next)));
    const list = next ? [...kept, next] : kept;
    if (list.length) results[id] = list;
  }
  return { updated_at: now, results };
}
