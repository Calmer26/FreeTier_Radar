/**
 * Build-time view of data/: everything the pages render, derived once.
 *
 * The data files are bundled with import.meta.glob rather than read with node:fs.
 * Pages may be prerendered outside Node (Cloudflare's build renders them in its own
 * runtime, where the disk isn't there), and a missing file read would silently
 * produce an empty site instead of an error.
 */

import { agentReadiness, type AgentReadiness } from "../../pipeline/agent-ready";
import { PROVIDERS } from "../../pipeline/providers";
import type { RateLimits, Resource, ResourceEvent, SponsorFile, TestHistory, TestResult } from "../../pipeline/types";

const resourceFiles = import.meta.glob<Resource[]>("../../data/resources/ai/*.json", { eager: true, import: "default" });
const eventFiles = import.meta.glob<string>("../../data/events/*.jsonl", { eager: true, query: "?raw", import: "default" });
const testFiles = import.meta.glob<TestHistory>("../../data/tests/history.json", { eager: true, import: "default" });
const sponsorFiles = import.meta.glob<SponsorFile>("../../data/sponsor.json", { eager: true, import: "default" });

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

const tests: TestHistory = Object.values(testFiles)[0] ?? { updated_at: null, results: {}, observed_limits: {} };

const resources = Object.values(resourceFiles).flat();
if (resources.length === 0) {
  // An empty directory is never a valid build: fail loudly instead of deploying it.
  throw new Error("No resources found under data/resources/ai: refusing to build an empty site");
}

export const models: ModelView[] = resources
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

/** Newest first. Files are named YYYY-MM.jsonl, so sorting by path is chronological. */
export const events: ResourceEvent[] = Object.keys(eventFiles)
  .sort()
  .flatMap((path) => eventFiles[path].split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as ResourceEvent))
  .reverse();

export const modelById = new Map(models.map((m) => [m.id, m]));

export const providersInData = [...new Set(models.map((m) => m.provider))].map((p) => PROVIDERS[p]);

export const testsUpdatedAt = tests.updated_at;

export const sponsor: SponsorFile = (() => {
  const s = Object.values(sponsorFiles)[0] ?? null;
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
