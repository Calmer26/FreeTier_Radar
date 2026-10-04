/**
 * Free web search APIs: the inclusion bar, what our own test uses of each free
 * allowance, and the feed entries (/api/working.json `search`, /api/search.json). Pure
 * and free of Node imports, so the site can use it; the daily test lives in
 * search-test.ts.
 */

import { reliability } from "./rankings";
import type { ResourceEvent, SearchApi, TestResult } from "./types";

/**
 * A search API is listed when its recurring free allowance covers at least this many
 * basic searches a month (about 10 a day), matching the bar for AI providers.
 */
export const SEARCH_MIN_QUERIES_PER_MONTH = 300;
/** One basic search each morning. */
export const SEARCH_TESTS_PER_MONTH = 30;

/** Always has results, in every index and language. */
export const SEARCH_QUERY = "wikipedia";

export interface SearchRequest {
  url: string;
  init: RequestInit;
}

/** The cheapest plain search each API offers: one result, no page content, no answer. */
export function buildSearchRequest(api: Pick<SearchApi, "api" | "key_env">, env: Record<string, string | undefined>, query = SEARCH_QUERY): SearchRequest {
  const key = env[api.key_env] ?? "";
  const json = (headers: Record<string, string>, body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const { style, endpoint } = api.api;
  switch (style) {
    case "brave":
      return {
        url: `${endpoint}?${new URLSearchParams({ q: query, count: "1" })}`,
        init: { method: "GET", headers: { Accept: "application/json", "X-Subscription-Token": key } },
      };
    case "tavily":
      return { url: endpoint, init: json({ Authorization: `Bearer ${key}` }, { query, search_depth: "basic", max_results: 1 }) };
    case "exa":
      return { url: endpoint, init: json({ "x-api-key": key }, { query, type: "instant", numResults: 1, contents: { text: false } }) };
    case "firecrawl":
      return { url: endpoint, init: json({ Authorization: `Bearer ${key}` }, { query, limit: 1 }) };
    case "parallel":
      return { url: endpoint, init: json({ "x-api-key": key }, { search_queries: [query], max_results: 1, mode: "turbo" }) };
    case "linkup":
      return { url: endpoint, init: json({ Authorization: `Bearer ${key}` }, { q: query, depth: "fast", outputType: "searchResults", maxResults: 1 }) };
  }
}

/** Result URLs in a successful response; an empty list means the search didn't answer. */
export function resultUrls(style: SearchApi["api"]["style"], body: unknown): string[] {
  const b = (body ?? {}) as Record<string, any>;
  const list: unknown =
    style === "brave" ? b.web?.results :
    style === "firecrawl" ? b.data?.web ?? b.data :
    b.results;
  if (!Array.isArray(list)) return [];
  return list.map((r) => r?.url).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
}

/** Basic searches the free allowance covers in a month (a daily allowance counts 30 days). */
export function freeQueriesPerMonth(api: Pick<SearchApi, "allowance" | "cost_per_query">): number {
  const perPeriod = api.allowance.unit === "queries" ? api.allowance.amount : api.allowance.amount / api.cost_per_query.basic;
  return Math.floor(api.allowance.period === "day" ? perPeriod * 30 : perPeriod);
}

export function meetsBar(api: Pick<SearchApi, "allowance" | "cost_per_query">): boolean {
  return freeQueriesPerMonth(api) >= SEARCH_MIN_QUERIES_PER_MONTH;
}

/** How much of the free allowance our daily test uses in a month. */
export function testUsage(api: Pick<SearchApi, "allowance" | "cost_per_query">): { queries: number; of: number; share: number } {
  const of = freeQueriesPerMonth(api);
  return { queries: SEARCH_TESTS_PER_MONTH, of, share: of ? SEARCH_TESTS_PER_MONTH / of : 1 };
}

export interface SearchView extends SearchApi {
  tests: TestResult[];
}

/** Answered the latest test (slow counts: it answered) and may back a real app. */
export function searchUsableNow(s: SearchView): boolean {
  const last = s.tests.at(-1)?.status;
  return s.usage_terms !== "evaluation-only" && (last === "responded" || last === "slow");
}

/** Entry in /api/working.json `search` and /api/search.json. */
export interface WorkingSearch {
  id: string;
  name: string;
  /** Request style; every API has its own request and response shape. See `docs`. */
  api: SearchApi["api"]["style"];
  endpoint: string;
  method: "GET" | "POST";
  auth: string;
  key_env: string;
  free_allowance: {
    period: "month" | "day";
    amount: number;
    unit: "queries" | "credits" | "usd";
    text: string;
    resets: string | null;
    /** Basic searches it covers per month. */
    queries_per_month: number;
    source: string;
    checked: string;
  };
  /** In the allowance's unit (queries, credits or usd). */
  cost_per_query: { basic: number; basic_label: string; advanced: number | null; advanced_label: string | null; unit: "queries" | "credits" | "usd" };
  /** Always an object; each number is null when not published. */
  limits: { rps: number | null; rpm: number | null; rph: number | null; rpd: number | null; concurrency: number | null; note: string | null; source: string | null };
  card_required: SearchApi["card_required"];
  card_note: string | null;
  usage_terms: SearchApi["usage_terms"];
  result_storage: SearchApi["result_storage"];
  data_logging: SearchApi["data_logging"];
  locale: { country: SearchApi["locale"]["country"]; language: SearchApi["locale"]["language"]; example: string | null };
  answered: { days: number; of: number; share: number | null };
  median_latency_ms: number | null;
  last_test_at: string | null;
  docs: string;
  page: string;
}

export function searchEntry(s: SearchView, siteUrl: string): WorkingSearch {
  const rel = reliability(s.tests);
  const l = s.rate_limits;
  return {
    id: s.id,
    name: s.name,
    api: s.api.style,
    endpoint: s.api.endpoint,
    method: s.api.method,
    auth: s.api.auth,
    key_env: s.key_env,
    free_allowance: {
      period: s.allowance.period,
      amount: s.allowance.amount,
      unit: s.allowance.unit,
      text: s.allowance.text,
      resets: s.allowance.resets,
      queries_per_month: freeQueriesPerMonth(s),
      source: s.allowance.source.url,
      checked: s.allowance.source.checked,
    },
    cost_per_query: {
      basic: s.cost_per_query.basic,
      basic_label: s.cost_per_query.basic_label,
      advanced: s.cost_per_query.advanced,
      advanced_label: s.cost_per_query.advanced_label,
      unit: s.allowance.unit,
    },
    limits: {
      rps: l?.rps ?? null, rpm: l?.rpm ?? null, rph: l?.rph ?? null, rpd: l?.rpd ?? null,
      concurrency: l?.concurrency ?? null, note: l?.note ?? null, source: l?.source.url ?? null,
    },
    card_required: s.card_required,
    card_note: s.card_note,
    usage_terms: s.usage_terms,
    result_storage: s.result_storage,
    data_logging: s.data_logging,
    locale: { country: s.locale.country, language: s.locale.language, example: s.locale.example },
    answered: { days: rel.responded, of: rel.tested, share: rel.share == null ? null : Math.round(rel.share * 100) / 100 },
    median_latency_ms: rel.medianLatencyMs,
    last_test_at: s.tests.at(-1)?.at ?? null,
    docs: s.docs_url,
    page: new URL(`/search-apis/${s.id}/`, siteUrl).href,
  };
}

/** Answers most often, then the larger free allowance, then faster. */
export function searchOrder(a: SearchView, b: SearchView): number {
  const ra = reliability(a.tests);
  const rb = reliability(b.tests);
  return (
    (rb.share ?? -1) - (ra.share ?? -1) ||
    freeQueriesPerMonth(b) - freeQueriesPerMonth(a) ||
    (ra.medianLatencyMs ?? Number.MAX_SAFE_INTEGER) - (rb.medianLatencyMs ?? Number.MAX_SAFE_INTEGER) ||
    a.name.localeCompare(b.name)
  );
}

/** The working feed's `search` list: APIs that answered the latest test, best first. */
export function workingSearch(apis: SearchView[], siteUrl: string): WorkingSearch[] {
  return apis.filter(searchUsableNow).sort(searchOrder).map((s) => searchEntry(s, siteUrl));
}

/** A search API's `changes`, as change-feed events (shown like offer changes). */
export function searchEvents(apis: SearchApi[]): ResourceEvent[] {
  return apis.flatMap((s) =>
    s.changes.map((c, i) => ({
      id: `search-${s.id}-${i}`,
      resource_id: `search/${s.id}`,
      provider: s.maker,
      name: s.name,
      detected_at: `${c.date}T00:00:00.000Z`,
      event_type: "OFFER" as const,
      field: null,
      old_value: null,
      new_value: null,
      impact_score: 60,
      source_url: s.url,
      text: c.text,
    })),
  );
}
