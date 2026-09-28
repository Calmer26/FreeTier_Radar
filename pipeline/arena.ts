/**
 * LMArena ratings for free chat models.
 *
 * Source: the LMArena leaderboard dataset on Hugging Face (lmarena-ai/leaderboard-dataset),
 * licensed CC-BY-4.0, so it may be shown on a commercial site with attribution. Checked
 * 2026-09-28. We keep only each model's "overall" row per board.
 *
 * Names differ between Arena and the providers, so every resource is linked to an Arena
 * name through data/aliases.json:
 *   exact      the names are equal after normalising: accepted automatically
 *   variant    Arena's name is ours plus only reasoning-effort or size words
 *              ("-high", "(Max)", "-30b-a3b"): the same model, accepted automatically
 *   confirmed  a near match the owner accepted (by merging the weekly aliases PR)
 *   rejected   a near match the owner turned down; never suggested again
 * Only exact and confirmed links are shown.
 *
 * Pure helpers here; the run lives in run-arena.ts.
 */

export const ARENA_BOARDS = ["text", "webdev", "vision", "agent"] as const;
export type ArenaBoard = (typeof ARENA_BOARDS)[number];

export const ARENA_BOARD_LABELS: Record<ArenaBoard, string> = {
  text: "Text",
  webdev: "WebDev",
  vision: "Vision",
  agent: "Agent",
};

export const ARENA_ATTRIBUTION = "LMArena leaderboard dataset (CC-BY-4.0)";
export const ARENA_DATASET_URL = "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset";

export interface ArenaEntry {
  name: string;
  org: string;
  /** Elo-style rating (text, webdev, vision); null on the agent board, which uses `score`. */
  rating: number | null;
  /** Agent board only: its own score. */
  score?: number | null;
  rank: number;
  /** Votes (rating boards) or sessions (agent board). */
  votes: number;
}

export interface ArenaBoardData {
  published: string;
  models: ArenaEntry[];
}

export interface ArenaFile {
  source: string;
  fetched_on: string;
  boards: Partial<Record<ArenaBoard, ArenaBoardData>>;
}

export interface Alias {
  arena: string | null;
  status: "exact" | "variant" | "confirmed" | "rejected";
  on: string;
}

export type AliasFile = Record<string, Alias>;

const DROP_SUFFIXES = ["-it", "-instruct", "-chat", "-nvfp4", "-fp8", "-bf16", "-fp4", "-awq"];

/** Comparable form of a provider model id or an Arena name. Exported for tests. */
export function normaliseName(raw: string, org?: string): string {
  let s = raw.toLowerCase().replace(/:free$/, "");
  s = s.slice(s.lastIndexOf("/") + 1);
  s = s.replace(/[\s_()]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (org) {
    const prefix = `${org.toLowerCase().replace(/[\s_]+/g, "-")}-`;
    if (s.startsWith(prefix)) s = s.slice(prefix.length);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of DROP_SUFFIXES) {
      if (s.endsWith(suffix)) {
        s = s.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return s;
}

/**
 * Both normalised forms of an Arena name: as is, and with a leading organisation
 * removed. Stripping alone would turn "deepseek-v4.1-flash-max" (org "deepseek")
 * into "v4.1-flash-max"; keeping alone would miss "nvidia-nemotron-3-ultra…".
 */
export function nameForms(name: string, org?: string): string[] {
  return [...new Set([normaliseName(name), normaliseName(name, org)])];
}

/** Every Arena name across boards, under each of its normalised forms, with total votes. */
export function arenaIndex(file: ArenaFile): Map<string, { name: string; votes: number }[]> {
  const totals = new Map<string, { org: string; votes: number }>();
  for (const board of Object.values(file.boards)) {
    for (const m of board?.models ?? []) {
      totals.set(m.name, { org: m.org, votes: (totals.get(m.name)?.votes ?? 0) + m.votes });
    }
  }
  const byNorm = new Map<string, { name: string; votes: number }[]>();
  for (const [name, { org, votes }] of totals) {
    for (const key of nameForms(name, org)) byNorm.set(key, [...(byNorm.get(key) ?? []), { name, votes }]);
  }
  return byNorm;
}

/** Words that change effort or size, not the model: "high", "max", "thinking", "30b", "a3b". */
const VARIANT_TOKEN = /^(high|medium|low|max|min|minimal|xhigh|thinking|reasoning|\d+(\.\d+)?b|a\d+(\.\d+)?b)$/;

/** Whether `arenaKey` is `ours` plus only variant words. Exported for tests. */
export function isVariantOf(ours: string, arenaKey: string): boolean {
  if (!arenaKey.startsWith(`${ours}-`)) return false;
  return arenaKey.slice(ours.length + 1).split("-").every((t) => VARIANT_TOKEN.test(t));
}

export interface MatchResult {
  exact: string | null;
  /** True when `near` is only an effort or size variant of our model. */
  variant?: boolean;
  /**
   * Best near match: an Arena name that extends ours at a "-" boundary, i.e. a variant
   * of our model (gemini-3.8-flash → gemini-3.8-flash-high). Never the reverse:
   * gemini-2.5-flash-lite is not gemini-2.5-flash.
   */
  near: string | null;
}

/** Finds the Arena name for a provider model id. Exported for tests. */
export function matchModel(modelId: string, index: Map<string, { name: string; votes: number }[]>): MatchResult {
  const ours = normaliseName(modelId);
  const exact = index.get(ours);
  if (exact?.length) return { exact: exact.sort((a, b) => b.votes - a.votes)[0].name, near: null };
  // Prefer variants (same model) over other extensions of the name; most votes wins.
  let best: { name: string; votes: number; variant: boolean } | null = null;
  for (const [key, names] of index) {
    if (!key.startsWith(`${ours}-`)) continue;
    const variant = isVariantOf(ours, key);
    for (const n of names) {
      if (!best || (variant && !best.variant) || (variant === best.variant && n.votes > best.votes)) best = { ...n, variant };
    }
  }
  return best ? { exact: null, near: best.name, variant: best.variant } : { exact: null, near: null };
}

export interface AliasUpdate {
  aliases: AliasFile;
  /** Near matches not seen before, for the owner to confirm. */
  suggestions: Array<{ id: string; arena: string }>;
}

/**
 * Adds exact matches for chat models without an alias, and collects near matches as
 * suggestions. Existing aliases (any status) are never changed. Pure.
 */
export function updateAliases(
  current: AliasFile,
  chatModelIds: Array<{ id: string; model_id: string }>,
  index: Map<string, { name: string; votes: number }[]>,
  today: string,
): AliasUpdate {
  const aliases: AliasFile = { ...current };
  const suggestions: AliasUpdate["suggestions"] = [];
  for (const { id, model_id } of chatModelIds) {
    if (aliases[id]) continue;
    const m = matchModel(model_id, index);
    if (m.exact) aliases[id] = { arena: m.exact, status: "exact", on: today };
    else if (m.near && m.variant) aliases[id] = { arena: m.near, status: "variant", on: today };
    else if (m.near) suggestions.push({ id, arena: m.near });
  }
  return { aliases: sortKeys(aliases), suggestions };
}

export function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

export interface ArenaScores {
  name: string;
  boards: Partial<Record<ArenaBoard, { rating: number | null; rank: number; of: number; votes: number }>>;
  published: string | null;
}

/**
 * Scores for a resource, only through an exact or confirmed alias. Boards spell the
 * same model differently ("glm-5.3-flash" vs "GLM 5.3 Flash"), so entries are matched
 * on the normalised name.
 */
export function scoresFor(resourceId: string, aliases: AliasFile, file: ArenaFile | null): ArenaScores | null {
  const alias = aliases[resourceId];
  if (!file || !alias || !alias.arena || alias.status === "rejected") return null;
  const aliasOrg = Object.values(file.boards).flatMap((b) => b?.models ?? []).find((m) => m.name === alias.arena)?.org;
  const targets = new Set(nameForms(alias.arena, aliasOrg));
  const boards: ArenaScores["boards"] = {};
  let published: string | null = null;
  for (const b of ARENA_BOARDS) {
    const data = file.boards[b];
    const entry = data?.models.find((m) => nameForms(m.name, m.org).some((f) => targets.has(f)));
    if (!data || !entry) continue;
    boards[b] = { rating: entry.rating, rank: entry.rank, of: data.models.length, votes: entry.votes };
    if (!published || data.published > published) published = data.published;
  }
  return Object.keys(boards).length ? { name: alias.arena, boards, published } : null;
}
