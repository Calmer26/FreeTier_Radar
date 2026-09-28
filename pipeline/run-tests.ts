/**
 * Daily test run (GitHub Actions, once a day): one request per active free model.
 *
 * Providers run in parallel; models within a provider run one at a time with a gap
 * that keeps us well inside the free limits. After three rate-limit answers in a row
 * a provider is stopped for the day: its remaining models get no entry today, rather
 * than a misleading failure.
 */

import { testModel, recordResults, type TestOutcome } from "./probe";
import { PROVIDER_IDS, PROVIDERS } from "./providers";
import { readResources, readTests, writeTests } from "./store";
import type { ProviderId, Resource } from "./types";

/** Minimum gap between requests per provider, from the published or assumed limits. */
const GAP_MS: Record<ProviderId, number> = {
  openrouter: 3_500,         // 20 requests/minute shared across free models
  nvidia: 1_600,             // shared limit, commonly around 40 requests/minute
  groq: 500,                 // per-model limits
  "google-ai-studio": 1_000, // per-model limits
};
const STOP_AFTER_RATE_LIMITS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runProvider(p: ProviderId, models: Resource[], outcomes: Map<string, TestOutcome>) {
  let rateLimitedInARow = 0;
  for (const [i, r] of models.entries()) {
    const outcome = await testModel(r, process.env);
    if (outcome.detail) console.log(`  ${p} ${r.model_id}: ${outcome.result.status}: ${outcome.detail}`);
    if (outcome.result.status === "rate_limited") {
      rateLimitedInARow++;
      if (rateLimitedInARow >= STOP_AFTER_RATE_LIMITS) {
        console.warn(`- ${p}: stopped after ${STOP_AFTER_RATE_LIMITS} rate limits; ${models.length - i - 1} model(s) left for tomorrow`);
        return;
      }
      // A single 429 says nothing about the model; don't record it.
      await sleep(GAP_MS[p] * 2);
      continue;
    }
    rateLimitedInARow = 0;
    outcomes.set(r.id, outcome);
    if (!outcome.detail) console.log(`  ${p} ${r.model_id}: ${outcome.result.status} (${outcome.result.latency_ms} ms)`);
    await sleep(GAP_MS[p]);
  }
}

async function main() {
  const now = new Date().toISOString();
  const resources = readResources();
  const outcomes = new Map<string, TestOutcome>();

  await Promise.all(
    PROVIDER_IDS.map((p) => {
      if (!process.env[PROVIDERS[p].key_env]) {
        console.log(`- ${p}: skipped (${PROVIDERS[p].key_env} not set)`);
        return Promise.resolve();
      }
      const models = resources.filter((r) => r.provider === p && r.status === "active");
      console.log(`- ${p}: testing ${models.length} model(s)`);
      return runProvider(p, models, outcomes);
    }),
  );

  const known = new Set(resources.filter((r) => r.status !== "removed").map((r) => r.id));
  writeTests(recordResults(readTests(), outcomes, known, now));
  console.log(`\nRecorded ${outcomes.size} result(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
