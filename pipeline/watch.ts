/**
 * Page-change watcher for curated records (offers now, the infra watchlist later).
 *
 * Once a week each record's `watch_url` is fetched, reduced to its visible text, and
 * hashed. Only the hash is stored (data/watch.json), never the page. When the hash
 * changes, the run opens an issue quoting the page's lines that mention limits,
 * credits or prices, so the owner can compare them with the JSON record.
 *
 * Pure helpers here; the run lives in run-watch.ts.
 */

import { createHash } from "node:crypto";
import type { WatchState } from "./types";

const BLOCK_TAGS = /<\/?(p|div|li|tr|td|th|h[1-6]|br|section|article|table|ul|ol|dd|dt|pre)\b[^>]*>/gi;

/** Visible text of an HTML page, one block per line. Exported for tests. */
export function extractText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head|nav|footer)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(BLOCK_TAGS, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

const RELEVANT = /\bfree\b|limit|credit|quota|trial|per (day|month|minute|hour)|\brp[md]\b|\btp[md]\b|tokens?\b|neurons?|\$\d/i;

/** Lines worth quoting in the issue: the ones about limits, credits and prices. */
export function relevantLines(text: string, max = 25): string[] {
  return text
    .split("\n")
    .filter((line) => line.length >= 12 && RELEVANT.test(line))
    .slice(0, max)
    .map((line) => (line.length > 200 ? `${line.slice(0, 197)}…` : line));
}

export interface WatchUpdate {
  state: WatchState;
  /** True when the page changed since the last successful check. */
  changed: boolean;
}

/** Next state for one watched page. The first check is a baseline, never "changed". */
export function nextWatchState(prev: WatchState | undefined, hash: string, today: string): WatchUpdate {
  if (!prev) return { state: { hash, checked_on: today, changed_on: null }, changed: false };
  const changed = prev.hash !== hash;
  return { state: { hash, checked_on: today, changed_on: changed ? today : prev.changed_on }, changed };
}
