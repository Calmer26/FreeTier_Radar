import { describe, expect, it } from "vitest";
import { freeQueriesPerMonth, meetsBar, searchEvents, testUsage, workingSearch, type SearchView } from "./search";
import { readOffers, readSearchApis, readSearchNearMisses } from "./store";
import type { SearchApi, TestResult } from "./types";

const src = { url: "https://example.com/pricing", checked: "2026-10-04" };

function api(over: Partial<SearchApi> = {}): SearchApi {
  return {
    id: "x", name: "X Search", maker: "X", url: "https://x.dev", docs_url: "https://x.dev/docs", summary: "", index: "own",
    api: { style: "tavily", endpoint: "https://api.x.dev/search", method: "POST", auth: "Authorization: Bearer <key>" },
    key_env: "X_API_KEY",
    allowance: { period: "month", amount: 1000, unit: "credits", text: "1,000 credits a month", resets: null, source: src },
    cost_per_query: { basic: 1, basic_label: "basic", advanced: 2, advanced_label: "advanced", source: src },
    rate_limits: { rpm: 100, source: src },
    card_required: "no", card_note: null, account_required: "yes", account_note: null,
    usage_terms: "unknown", usage_terms_note: null, terms_source: null, result_storage: "unknown",
    data_logging: "unknown", data_logging_note: null, data_logging_source: null,
    locale: { country: "yes", language: "unknown", example: null, note: null, source: src },
    watch_url: null, verified_on: "2026-10-04", changes: [],
    ...over,
  };
}

const t = (day: string, status: TestResult["status"], latency_ms = 500): TestResult => ({ at: `2026-10-${day}T06:15:00.000Z`, status, latency_ms });
const view = (a: SearchApi, tests: TestResult[]): SearchView => ({ ...a, tests });

describe("freeQueriesPerMonth", () => {
  it("divides a dollar or credit allowance by the basic search price", () => {
    expect(freeQueriesPerMonth(api({ allowance: { ...api().allowance, amount: 5, unit: "usd" }, cost_per_query: { ...api().cost_per_query, basic: 0.005 } }))).toBe(1000);
    expect(freeQueriesPerMonth(api({ cost_per_query: { ...api().cost_per_query, basic: 2 } }))).toBe(500);
  });

  it("counts a daily allowance over 30 days, and queries as queries", () => {
    expect(freeQueriesPerMonth(api({ allowance: { ...api().allowance, period: "day", amount: 100, unit: "queries" } }))).toBe(3000);
  });
});

describe("the inclusion bar", () => {
  it("needs about 300 searches a month", () => {
    expect(meetsBar(api({ allowance: { ...api().allowance, amount: 250, unit: "queries" } }))).toBe(false);
    expect(meetsBar(api({ allowance: { ...api().allowance, amount: 300, unit: "queries" } }))).toBe(true);
  });

  it("puts our own test at one search a morning", () => {
    expect(testUsage(api())).toEqual({ queries: 30, of: 1000, share: 0.03 });
  });
});

describe("workingSearch", () => {
  const steady = view(api({ id: "steady", name: "Steady" }), [t("01", "responded", 900), t("02", "responded", 900)]);
  const bigger = view(api({ id: "bigger", name: "Bigger", allowance: { ...api().allowance, amount: 5000 } }), [t("01", "responded"), t("02", "responded")]);
  const flaky = view(api({ id: "flaky", name: "Flaky" }), [t("01", "error"), t("02", "responded")]);
  const down = view(api({ id: "down", name: "Down" }), [t("01", "responded"), t("02", "error")]);
  const evalOnly = view(api({ id: "eval", name: "Eval", usage_terms: "evaluation-only" }), [t("02", "responded")]);
  const feed = workingSearch([flaky, down, steady, evalOnly, bigger], "https://example.dev");

  it("lists only APIs that answered the latest test and may back an app", () => {
    expect(feed.map((s) => s.id)).toEqual(["bigger", "steady", "flaky"]);
  });

  it("orders by answered share, then free allowance, then speed", () => {
    expect(feed[0].free_allowance.queries_per_month).toBe(5000);
    expect(feed[2].answered).toEqual({ days: 1, of: 2, share: 0.5 });
  });

  it("always gives limits as an object, with null for what isn't published", () => {
    expect(feed[1].limits).toEqual({ rps: null, rpm: 100, rph: null, rpd: null, concurrency: null, note: null, source: src.url });
    expect(feed[1]).toMatchObject({ key_env: "X_API_KEY", page: "https://example.dev/search-apis/steady/", cost_per_query: { basic: 1, unit: "credits" } });
  });
});

describe("searchEvents", () => {
  it("turns hand-written changes into change-feed events", () => {
    const [e] = searchEvents([api({ changes: [{ date: "2026-10-05", text: "Free credit cut to $3." }] })]);
    expect(e).toMatchObject({ resource_id: "search/x", event_type: "OFFER", detected_at: "2026-10-05T00:00:00.000Z", text: "Free credit cut to $3." });
  });
});

describe("data/search", () => {
  const apis = readSearchApis();
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const sourced = (s: { url: string; checked: string } | null) => s === null || (/^https:\/\//.test(s.url) && day.test(s.checked));

  it("lists only APIs above the bar, each with its own key variable", () => {
    expect(apis.length).toBeGreaterThan(0);
    for (const a of apis) expect(meetsBar(a), a.id).toBe(true);
    expect(new Set(apis.map((a) => a.key_env)).size).toBe(apis.length);
  });

  it("gives every number and statement a source URL and date", () => {
    for (const a of apis) {
      for (const s of [a.allowance.source, a.cost_per_query.source, a.rate_limits?.source ?? null, a.terms_source, a.data_logging_source, a.locale.source]) {
        expect(sourced(s), a.id).toBe(true);
      }
      // A label other than "unknown" needs the page it came from.
      if (a.data_logging !== "unknown") expect(a.data_logging_source, a.id).not.toBeNull();
      if (a.usage_terms !== "unknown") expect(a.terms_source, a.id).not.toBeNull();
      if (a.card_required === "yes") expect(a.card_note, a.id).toBeTruthy();
    }
  });

  it("keeps one-time search credits as offers and near misses sourced", () => {
    for (const o of readOffers().filter((o) => o.category === "search")) expect(o.offer_type).not.toBe("recurring-credit");
    for (const n of readSearchNearMisses()) expect(sourced(n.source), n.name).toBe(true);
  });
});
