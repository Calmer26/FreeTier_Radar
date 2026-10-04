import { offers, searchApis, searchNearMisses } from "../../lib/data";
import { searchEntry, searchUsableNow, testUsage } from "../../../pipeline/search";
import { SITE } from "../../../site.config";

/**
 * Every free web search API we track, whether or not it answered today, with its
 * sources and recent test results; plus one-time search credits and the near misses.
 * The working subset is `search` in /api/working.json. See /developers/.
 */
export function GET() {
  const body = {
    generated_at: new Date().toISOString(),
    about: `Free web search APIs with a recurring free allowance of at least about 300 searches a month. Numbers come from each provider's own pages (source and date per number). Docs: ${new URL("/developers/", SITE.url).href}`,
    apis: searchApis.map((s) => ({
      ...searchEntry(s, SITE.url),
      answered_latest_test: searchUsableNow(s),
      our_test_usage_per_month: testUsage(s),
      summary: s.summary,
      index: s.index,
      account_required: s.account_required,
      account_note: s.account_note,
      usage_terms_note: s.usage_terms_note,
      data_logging_note: s.data_logging_note,
      locale_note: s.locale.note,
      sources: {
        allowance: s.allowance.source,
        cost_per_query: s.cost_per_query.source,
        limits: s.rate_limits?.source ?? null,
        terms: s.terms_source,
        data_logging: s.data_logging_source,
        locale: s.locale.source,
      },
      verified_on: s.verified_on,
      tests: s.tests,
    })),
    one_time_credits: offers.filter((o) => o.category === "search").map(({ changes, ...o }) => o),
    near_misses: searchNearMisses,
  };
  return new Response(JSON.stringify(body, null, 2), { headers: { "Content-Type": "application/json" } });
}
