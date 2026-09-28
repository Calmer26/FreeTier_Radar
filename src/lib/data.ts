/**
 * Build-time view of data/: everything the pages render, derived once.
 *
 * The data files are bundled with import.meta.glob rather than read with node:fs.
 * Pages may be prerendered outside Node (Cloudflare's build renders them in its own
 * runtime, where the disk isn't there), and a missing file read would silently
 * produce an empty site instead of an error.
 */

import { agentReadiness, type AgentReadiness } from "../../pipeline/agent-ready";
import { scoresFor, type AliasFile, type ArenaFile, type ArenaScores } from "../../pipeline/arena";
import { borrowedContext, siblingIds } from "../../pipeline/siblings";
import { PROVIDERS } from "../../pipeline/providers";
import { isUnreachable } from "../../pipeline/reachability";
import { withDefaults } from "../../pipeline/store-defaults";
import type { Offer, ProviderId, RateLimits, Resource, ResourceEvent, SponsorFile, TestHistory, TestResult, ToolResult } from "../../pipeline/types";

const resourceFiles = import.meta.glob<Resource[]>("../../data/resources/ai/*.json", { eager: true, import: "default" });
const eventFiles = import.meta.glob<string>("../../data/events/*.jsonl", { eager: true, query: "?raw", import: "default" });
const testFiles = import.meta.glob<TestHistory>("../../data/tests/history.json", { eager: true, import: "default" });
const arenaFiles = import.meta.glob<ArenaFile>("../../data/benchmarks/arena.json", { eager: true, import: "default" });
const aliasFiles = import.meta.glob<AliasFile>("../../data/aliases.json", { eager: true, import: "default" });
const offerFiles = import.meta.glob<Offer>("../../data/offers/ai/*.json", { eager: true, import: "default" });
const sponsorFiles = import.meta.glob<SponsorFile>("../../data/sponsor.json", { eager: true, import: "default" });

export interface ModelView extends Resource {
  tests: TestResult[];
  /** Daily tool-call test results (chat models). */
  toolTests: ToolResult[];
  lastTest: TestResult | null;
  agent: AgentReadiness;
  /** Documented provider limits, or limits read from response headers. */
  limits: RateLimits | null;
  href: string;
  /** A page is indexed once it has a test result; before that it is noindex. */
  indexable: boolean;
  /** Listed by the provider, but "not found" on the last 3 daily tests. */
  unreachable: boolean;
  /** LMArena ratings through an exact or confirmed alias; chat models only. */
  arena: ArenaScores | null;
  /** Ids of the same model at other providers (same normalised name, same kind). */
  siblings: string[];
  /** False when the provider's free models can't be called from outside (Cline). */
  testable: boolean;
  /** Set when context_length was borrowed from the same model at this provider. */
  context_from: ProviderId | null;
}

export const arenaFile: ArenaFile | null = Object.values(arenaFiles)[0] ?? null;
const aliases: AliasFile = Object.values(aliasFiles)[0] ?? {};

const tests: TestHistory = Object.values(testFiles)[0] ?? { updated_at: null, results: {}, observed_limits: {} };

// data_logging arrived after the first records were written; show those as "unknown".
const resources = Object.values(resourceFiles).flat().map(withDefaults).map((r) => ({ ...r, data_logging: r.data_logging ?? "unknown" }));
if (resources.length === 0) {
  // An empty directory is never a valid build: fail loudly instead of deploying it.
  throw new Error("No resources found under data/resources/ai: refusing to build an empty site");
}

// The same model at other providers, and context sizes borrowed from them where the
// provider publishes none (NVIDIA, Z.ai). Done before agent readiness, which needs context.
const siblingsById = siblingIds(resources);
const resourceById = new Map(resources.map((r) => [r.id, r]));
const withContext = resources.map((r) => {
  const borrowed = borrowedContext(r, (siblingsById.get(r.id) ?? []).map((id) => resourceById.get(id)!));
  return borrowed ? { ...r, context_length: borrowed.context_length, context_from: borrowed.from } : { ...r, context_from: null };
});

export const models: ModelView[] = withContext
  .map((r) => {
    const history = tests.results[r.id] ?? [];
    const toolTests = tests.tool_results?.[r.id] ?? [];
    return {
      ...r,
      tests: history,
      toolTests,
      lastTest: history.at(-1) ?? null,
      agent: agentReadiness(r, history, toolTests),
      limits: r.rate_limits ?? tests.observed_limits[r.id] ?? null,
      href: `/models/${r.provider}/${r.slug}/`,
      indexable: history.length > 0,
      unreachable: isUnreachable(history),
      arena: r.kind === "chat" ? scoresFor(r.id, aliases, arenaFile) : null,
      siblings: siblingsById.get(r.id) ?? [],
      testable: PROVIDERS[r.provider].testable !== false,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

// A model without its own Arena link uses a sibling's (Cline's
// "cline-free/deepseek-v4.1-flash" is NVIDIA's DeepSeek V4.1 Flash).
{
  const byId = new Map(models.map((m) => [m.id, m]));
  for (const m of models) m.arena ??= m.siblings.map((id) => byId.get(id)?.arena).find(Boolean) ?? null;
}

/** What the directory shows: not removed, and callable as far as we know. */
export const activeModels = models.filter((m) => m.status !== "removed" && !m.unreachable);

/** Listed by their provider but answering "not found" day after day. */
export const unreachableModels = models.filter((m) => m.status !== "removed" && m.unreachable);

/** Curated offers: free credits, trials and quota pools. */
export const offers: Offer[] = Object.values(offerFiles).sort((a, b) => a.name.localeCompare(b.name));

/** An offer's `changes` entries, as change-feed events. */
const offerEvents: ResourceEvent[] = offers.flatMap((o) =>
  o.changes.map((c, i) => ({
    id: `offer-${o.id}-${i}`,
    resource_id: `offer/${o.id}`,
    provider: o.provider,
    name: o.name,
    detected_at: `${c.date}T00:00:00.000Z`,
    event_type: "OFFER" as const,
    field: null,
    old_value: null,
    new_value: null,
    impact_score: 60,
    source_url: o.url,
    text: c.text,
  })),
);

/** Model events (events/YYYY-MM.jsonl) and offer changes, newest first. */
export const events: ResourceEvent[] = [
  ...Object.keys(eventFiles)
    .sort()
    .flatMap((path) => eventFiles[path].split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as ResourceEvent)),
  ...offerEvents,
].sort((a, b) => b.detected_at.localeCompare(a.detected_at));

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
