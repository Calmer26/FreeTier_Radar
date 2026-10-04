/**
 * Daily search test (GitHub Actions, morning run only): one basic query per search API,
 * results in data/tests/search.json. Search allowances are small and monthly, so there
 * is no peak-hours test: about 30 queries a month per API.
 *
 * APIs run one after the other (one request each). An API whose key isn't set is
 * skipped; a 429 is not recorded, like the model tests.
 */

import { readSearchApis, readSearchTests, writeSearchTests } from "./store";
import { meetsBar } from "./search";
import { recordSearchResults, testSearchApi } from "./search-test";
import type { TestResult } from "./types";

/** Same switches as run-tests.ts: TEST_SLOT=morning|evening overrides the clock; TEST_ONLY=search or =brave,tavily limits the run. */
const EVENING = process.env.TEST_SLOT === "evening" || (process.env.TEST_SLOT !== "morning" && new Date().getUTCHours() >= 12);
const ONLY = (process.env.TEST_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);

async function main() {
  if (EVENING) {
    console.log("Peak-hours run: search APIs are tested in the morning only.");
    return;
  }
  const now = new Date().toISOString();
  const apis = readSearchApis();
  const outcomes = new Map<string, TestResult>();

  for (const api of apis) {
    if (ONLY.length && !ONLY.includes("search") && !ONLY.includes(api.id)) continue;
    // A record below the bar belongs in offers or near-misses; say so rather than test it.
    if (!meetsBar(api)) console.warn(`- ${api.id}: below the inclusion bar; move it to offers or near-misses`);
    if (!process.env[api.key_env]) {
      console.log(`- ${api.id}: skipped (${api.key_env} not set)`);
      continue;
    }
    const { result, detail } = await testSearchApi(api, process.env);
    console.log(`- ${api.id}: ${result.status} (${result.latency_ms} ms)${detail ? `: ${detail}` : ""}`);
    if (result.status === "rate_limited") continue;
    outcomes.set(api.id, result);
  }

  if (outcomes.size === 0) {
    console.log("No search results recorded.");
    return;
  }
  writeSearchTests(recordSearchResults(readSearchTests(), outcomes, new Set(apis.map((a) => a.id)), now));
  console.log(`Recorded ${outcomes.size} search result(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
