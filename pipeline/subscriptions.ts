/**
 * Paid chat subscriptions a visitor may already have (Claude, ChatGPT, Google AI).
 * Their models aren't free and we don't test them; the rankings only show their
 * LMArena rating next to the free models, when a visitor opts in on /settings/.
 *
 * Built from the Arena file we already fetch weekly: no extra data. Pure.
 */

import type { ArenaBoard, ArenaFile } from "./arena";

export interface Subscription {
  id: string;
  label: string;
  /** Arena `org` whose models this subscription gives access to. */
  org: string;
  plans: string;
  /** What the subscription covers, in one line: it's not an API key. */
  covers: string;
  url: string;
  /** Open-weight models from the same maker: free elsewhere, not a reason to subscribe. */
  exclude?: RegExp;
}

export const SUBSCRIPTIONS: Subscription[] = [
  {
    id: "claude",
    label: "Claude",
    org: "anthropic",
    plans: "Pro, Max",
    covers: "claude.ai and Claude Code. Not an API key: in Cline or other tools you'd need a paid API account.",
    url: "https://claude.com/pricing",
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    org: "openai",
    plans: "Plus, Pro",
    covers: "chatgpt.com and Codex. Not an API key: in Cline or other tools you'd need a paid API account.",
    url: "https://chatgpt.com/pricing",
    exclude: /^gpt-oss/i,
  },
  {
    id: "google",
    label: "Google AI",
    org: "google",
    plans: "AI Pro, AI Ultra",
    covers: "the Gemini app and Google's coding tools. Not an API key, but some Gemini models are free through the API anyway.",
    url: "https://gemini.google/subscriptions/",
    exclude: /gemma/i,
  },
];

/** Settings key in the browser's localStorage: a JSON array of subscription ids. */
export const SUBSCRIPTIONS_STORAGE_KEY = "ftr.subscriptions";

/** Top models shown per subscription and ranking; more would crowd the free ones out. */
export const SUBSCRIPTION_ROWS = 5;

/** Trailing words that pick an effort level, size, snapshot or harness rather than another model. */
const VARIANT_TAIL = /^(high|medium|low|max|min|minimal|xhigh|thinking|reasoning|preview|latest|\d+k|\d{8})$/;

/**
 * The model behind an Arena name, without effort, snapshot or harness words:
 * "claude-opus-5-max" and "claude-opus-5-high" are both "claude-opus-5";
 * "gpt-5.6-sol-xhigh (codex-harness)" is "gpt-5.6-sol". Exported for tests.
 */
export function baseModel(arenaName: string): string {
  const tokens = arenaName
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean);
  while (tokens.length > 1 && VARIANT_TAIL.test(tokens.at(-1)!)) tokens.pop();
  return tokens.join("-");
}

export interface SubscriptionModel {
  sub: Subscription;
  base: string;
  /** Arena name of the best-rated variant. */
  name: string;
  /** Every Arena name of this model, to spot one that's also free somewhere. */
  names: string[];
  rating: number;
  rank: number;
  of: number;
}

/** The best-rated models of each subscription on one Arena board, variants merged. */
export function subscriptionModels(file: ArenaFile | null, board: ArenaBoard, limit = SUBSCRIPTION_ROWS): SubscriptionModel[] {
  const data = file?.boards[board];
  if (!data) return [];
  return SUBSCRIPTIONS.flatMap((sub) => {
    const byBase = new Map<string, SubscriptionModel>();
    for (const m of data.models) {
      if (m.org.toLowerCase() !== sub.org || m.rating == null || sub.exclude?.test(m.name)) continue;
      const base = baseModel(m.name);
      const seen = byBase.get(base);
      if (!seen) byBase.set(base, { sub, base, name: m.name, names: [m.name], rating: m.rating, rank: m.rank, of: data.models.length });
      else {
        seen.names.push(m.name);
        if (m.rating > seen.rating) Object.assign(seen, { name: m.name, rating: m.rating, rank: m.rank });
      }
    }
    return [...byBase.values()].sort((a, b) => b.rating - a.rating).slice(0, limit);
  });
}

export type Row<T> = { free: T } | { paid: SubscriptionModel };

/**
 * Slots paid models into a ranking that's ordered by rating: each goes just above
 * the first free model rated lower (unrated ones count as lowest). The free order
 * never changes.
 */
export function interleave<T>(free: T[], paid: SubscriptionModel[], ratingOf: (x: T) => number): Row<T>[] {
  const queue = [...paid].sort((a, b) => b.rating - a.rating);
  const rows: Row<T>[] = [];
  for (const x of free) {
    while (queue.length && queue[0].rating > ratingOf(x)) rows.push({ paid: queue.shift()! });
    rows.push({ free: x });
  }
  return [...rows, ...queue.map((p) => ({ paid: p }))];
}
