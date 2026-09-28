/**
 * Build-time view of data/: everything the pages render, derived once.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentReadiness, type AgentReadiness } from "../../pipeline/agent-ready";
import { PROVIDERS } from "../../pipeline/providers";
import { DATA_DIR, readEvents, readResources, readTests } from "../../pipeline/store";
import type { RateLimits, Resource, ResourceEvent, SponsorFile, TestResult } from "../../pipeline/types";

export interface ModelView extends Resource {
  tests: TestResult[];
  lastTest: TestResult | null;
  agent: AgentReadiness;
  /** Documented provider limits, or limits read from response headers. */
  limits: RateLimits | null;
  href: string;
  /** A page is indexed once it has a test result; before that it is noindex. */
  indexable: boolean;
}

const tests = readTests();

export const models: ModelView[] = readResources()
  .map((r) => {
    const history = tests.results[r.id] ?? [];
    return {
      ...r,
      tests: history,
      lastTest: history.at(-1) ?? null,
      agent: agentReadiness(r, history),
      limits: r.rate_limits ?? tests.observed_limits[r.id] ?? null,
      href: `/models/${r.provider}/${r.slug}/`,
      indexable: history.length > 0,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

export const activeModels = models.filter((m) => m.status !== "removed");

/** Newest first. */
export const events: ResourceEvent[] = readEvents().reverse();

export const modelById = new Map(models.map((m) => [m.id, m]));

export const providersInData = [...new Set(models.map((m) => m.provider))].map((p) => PROVIDERS[p]);

export const testsUpdatedAt = tests.updated_at;

export const sponsor: SponsorFile = (() => {
  const path = join(DATA_DIR, "sponsor.json");
  const s = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as SponsorFile) : null;
  const today = new Date().toISOString().slice(0, 10);
  const live = s && s.active && (!s.starts || s.starts <= today) && (!s.ends || s.ends >= today);
  return live ? s : { active: false, name: "", text: "", url: "", logo: null, starts: null, ends: null };
})();

export function formatDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
}
