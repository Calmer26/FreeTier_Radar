/**
 * Discovery run (every 6 hours in GitHub Actions):
 * fetch every provider → diff against data/ → write changed files and new events.
 *
 * Writes two files for the workflow to turn into GitHub issues, only when needed:
 *   out/high-impact.md    events at or above HIGH_IMPACT_THRESHOLD
 *   out/source-alert.md   a provider that failed 3 runs in a row (raised once per streak)
 *
 * A provider without its API key configured is skipped, not failed.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FETCHERS } from "./adapters";
import { diff } from "./diff";
import { PROVIDER_IDS, PROVIDERS } from "./providers";
import { HIGH_IMPACT_THRESHOLD } from "./scoring";
import { appendEvents, readResources, readSources, writeResources, writeSources } from "./store";
import type { ObservedModel, ProviderId, SourceState } from "./types";

const OUT_DIR = join(process.cwd(), "out");
const ALERT_AFTER_FAILURES = 3;

async function main() {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const sources = readSources();
  const observed: ObservedModel[] = [];
  const fetched: ProviderId[] = [];
  const newlyFailing: string[] = [];

  for (const p of PROVIDER_IDS) {
    const info = PROVIDERS[p];
    if (info.list_needs_key && !process.env[info.key_env]) {
      console.log(`- ${p}: skipped (${info.key_env} not set)`);
      continue;
    }
    const prev: SourceState = sources[p] ?? { last_success: null, consecutive_failures: 0, last_error: null, alerted: false };
    try {
      const models = await FETCHERS[p](process.env);
      observed.push(...models);
      fetched.push(p);
      sources[p] = { last_success: today, consecutive_failures: 0, last_error: null, alerted: false };
      console.log(`- ${p}: ${models.length} free chat models`);
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300);
      const failures = prev.consecutive_failures + 1;
      const alert = failures >= ALERT_AFTER_FAILURES && !prev.alerted;
      if (alert) newlyFailing.push(`- **${info.label}** failed ${failures} runs in a row. Last error: \`${message}\``);
      sources[p] = { ...prev, consecutive_failures: failures, last_error: message, alerted: prev.alerted || alert };
      console.error(`- ${p}: FAILED (${failures} in a row): ${message}`);
    }
  }

  const { resources, events } = diff({ previous: readResources(), observed, fetched, now });
  writeResources(resources);
  appendEvents(events);
  writeSources(sources);

  console.log(`\n${events.length} event(s):`);
  for (const e of events) console.log(`  [${e.impact_score}] ${e.event_type} ${e.resource_id}${e.field ? ` (${e.field})` : ""}`);

  rmSync(OUT_DIR, { recursive: true, force: true });
  const highImpact = events.filter((e) => e.impact_score >= HIGH_IMPACT_THRESHOLD);
  if (highImpact.length || newlyFailing.length) mkdirSync(OUT_DIR, { recursive: true });
  if (highImpact.length) {
    writeFileSync(
      join(OUT_DIR, "high-impact.md"),
      [
        `High-impact changes detected ${now}. They are already live with template text;`,
        "reply here or edit the event if a hand-written note would help.\n",
        ...highImpact.map((e) => `- **${e.event_type}** (score ${e.impact_score}): ${e.text} — ${e.source_url}`),
      ].join("\n"),
    );
  }
  if (newlyFailing.length) {
    writeFileSync(
      join(OUT_DIR, "source-alert.md"),
      ["A source keeps failing. Its models are frozen (not removed) until it recovers.\n", ...newlyFailing].join("\n"),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
