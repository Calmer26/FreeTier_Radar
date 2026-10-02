/**
 * Daily test run (GitHub Actions, twice a day): one request per active free model.
 *
 * Morning (06:10 UTC): every kind, plus the tool-call test. Peak hours (18:10 UTC, any run
 * after 12:00): chat models only and no tool test, to see which free models still answer
 * when they're busiest. Each half-day keeps its own result (test-days.ts).
 *
 * Providers run in parallel; models within a provider run one at a time with a gap
 * that keeps us well inside the free limits. After three rate-limit answers in a row
 * a provider is stopped for the day: its remaining models get no entry today, rather
 * than a misleading failure.
 */

import { testModel, recordResults, type TestOutcome } from "./probe";
import { testToolCall } from "./tool-test";
import { PROVIDER_IDS, PROVIDERS } from "./providers";
import { readResources, readTests, writeTests } from "./store";
import type { ProviderId, Resource, TestHistory } from "./types";

/** Minimum gap between requests per provider, from the published or assumed limits. */
const GAP_MS: Record<ProviderId, number> = {
  openrouter: 3_500,         // 20 requests/minute shared across free models
  nvidia: 1_600,             // shared limit, commonly around 40 requests/minute
  groq: 500,                 // per-model limits
  "google-ai-studio": 1_000, // per-model limits
  kilo: 20_000,              // anonymous: 200 requests/hour per IP
  llm7: 7_000,               // anonymous: 10 requests/minute, 60/hour
  zai: 2_000,                // limits not published; stay gentle
  cline: 0,                  // never tested: free models work only inside Cline
  cloudflare: 1_000,         // shared daily Neurons; requests are tiny
  mistral: 2_000,            // per-model limits (30+ requests/minute seen); stay gentle
  ollama: 3_000,             // one request at a time on the Free plan
  cohere: 3_500,             // 20 requests/minute per model on a trial key
  elevenlabs: 1_500,         // monthly credits, not a rate; requests are tiny
};
const STOP_AFTER_RATE_LIMITS = 3;
/** Image models are tested weekly: one picture uses far more of a free allowance than a chat reply. */
const IMAGE_TEST_EVERY_DAYS = 7;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** TEST_SLOT=morning|evening overrides the clock (manual runs); TEST_ONLY=a,b limits the run to those providers. */
const EVENING = process.env.TEST_SLOT === "evening" || (process.env.TEST_SLOT !== "morning" && new Date().getUTCHours() >= 12);
const ONLY = (process.env.TEST_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);

async function runProvider(p: ProviderId, models: Resource[], outcomes: Map<string, TestOutcome>, history: TestHistory) {
  let rateLimitedInARow = 0;
  for (const [i, r] of models.entries()) {
    const last = history.results[r.id]?.at(-1);
    if (r.kind === "image" && last && Date.now() - Date.parse(last.at) < (IMAGE_TEST_EVERY_DAYS - 0.5) * 86_400_000) continue;
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

    // Act-mode signal: only for chat models that just answered, and not ones known to lack tools.
    if (!EVENING && r.kind === "chat" && outcome.result.status === "responded" && r.tool_calling !== false) {
      const tool = await testToolCall(r, process.env);
      outcome.tool = tool.result;
      console.log(`  ${p} ${r.model_id}: tool call ${tool.result?.status ?? "rate-limited"}${tool.detail ? `: ${tool.detail}` : ""}`);
      await sleep(GAP_MS[p]);
    }
  }
}

async function main() {
  const now = new Date().toISOString();
  console.log(EVENING ? "Peak-hours test: chat models only, no tool test." : "Morning test: every model, plus tool calls.");
  const resources = readResources();
  const history = readTests();
  const outcomes = new Map<string, TestOutcome>();

  await Promise.all(
    PROVIDER_IDS.map((p) => {
      if (ONLY.length && !ONLY.includes(p)) return Promise.resolve();
      if (PROVIDERS[p].testable === false) {
        console.log(`- ${p}: not testable from outside; listed only`);
        return Promise.resolve();
      }
      const keyEnv = PROVIDERS[p].key_env;
      if (keyEnv && !process.env[keyEnv]) {
        console.log(`- ${p}: skipped (${keyEnv} not set)`);
        return Promise.resolve();
      }
      if (EVENING && PROVIDERS[p].peak_test === false) {
        console.log(`- ${p}: no peak-hours test (small monthly call budget)`);
        return Promise.resolve();
      }
      const models = resources.filter((r) => r.provider === p && r.status === "active" && (!EVENING || r.kind === "chat"));
      console.log(`- ${p}: testing ${models.length} model(s)`);
      return runProvider(p, models, outcomes, history);
    }),
  );

  const known = new Set(resources.filter((r) => r.status !== "removed").map((r) => r.id));
  writeTests(recordResults(history, outcomes, known, now));
  console.log(`\nRecorded ${outcomes.size} result(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
