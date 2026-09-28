/**
 * Weekly roundup: the past week's events as a Markdown post, with a short intro.
 *
 * Facts (names, numbers, dates) always come from the events. A free model may write
 * the 2–3 sentence intro from a fact list it is told not to go beyond; the owner
 * reviews the draft in a PR before it's published. Without a model, a template
 * intro is used, so the PR always opens.
 *
 * Pure helpers here; the run lives in run-roundup.ts.
 */

import { KIND_LABELS } from "./templates";
import type { ModelKind, ResourceEvent } from "./types";

/** ISO week label (e.g. "2026-W40") and the Monday–Sunday range for a date in it. */
export function isoWeek(date: Date): { label: string; start: string; end: string } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  const monday = new Date(d.getTime() - (dow - 1) * 86_400_000);
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return {
    label: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

export function eventsInRange(events: ResourceEvent[], start: string, end: string): ResourceEvent[] {
  return events
    .filter((e) => e.detected_at.slice(0, 10) >= start && e.detected_at.slice(0, 10) <= end)
    .sort((a, b) => b.impact_score - a.impact_score || a.detected_at.localeCompare(b.detected_at));
}

const SECTIONS: Array<{ title: string; types: ResourceEvent["event_type"][] }> = [
  { title: "New free models", types: ["NEW", "RETURNED"] },
  { title: "Gone", types: ["REMOVED"] },
  { title: "Changed", types: ["CHANGED"] },
  { title: "Free credits and quotas", types: ["OFFER"] },
];

/** The fact list given to the intro writer, and used by the template intro. */
export function factLines(events: ResourceEvent[]): string[] {
  return events.slice(0, 15).map((e) => `${e.event_type}: ${e.text}`);
}

export function templateIntro(events: ResourceEvent[]): string {
  const count = (t: ResourceEvent["event_type"][]) => events.filter((e) => t.includes(e.event_type)).length;
  const parts = [
    count(["NEW", "RETURNED"]) && `${count(["NEW", "RETURNED"])} model(s) became free`,
    count(["REMOVED"]) && `${count(["REMOVED"])} left the free tier`,
    count(["CHANGED"]) && `${count(["CHANGED"])} change(s) to limits, terms or specs`,
    count(["OFFER"]) && `${count(["OFFER"])} update(s) to free credits and quotas`,
  ].filter(Boolean);
  return parts.length ? `This week: ${parts.join(", ")}.` : "A quiet week: nothing changed in the free tiers we track.";
}

export function renderRoundup(
  week: { label: string; start: string; end: string },
  events: ResourceEvent[],
  intro: string,
  links: Map<string, string>,
  kinds: Map<string, ModelKind>,
): string {
  const title = `Free AI resources, week ${week.label.split("-W")[1]} ${week.label.slice(0, 4)}`;
  const body: string[] = [];
  for (const section of SECTIONS) {
    const list = events.filter((e) => section.types.includes(e.event_type));
    if (!list.length) continue;
    body.push(`## ${section.title}`, "");
    for (const e of list) {
      const link = links.get(e.resource_id);
      const kind = kinds.get(e.resource_id);
      const label = kind && kind !== "chat" ? ` (${KIND_LABELS[kind].toLowerCase()})` : "";
      body.push(`- **${link ? `[${e.name}](${link})` : e.name}**${label}: ${e.text}`);
    }
    body.push("");
  }
  return [
    "---",
    `title: "${title}"`,
    `week: "${week.label}"`,
    `start: "${week.start}"`,
    `end: "${week.end}"`,
    `events: ${events.length}`,
    "---",
    "",
    intro.trim(),
    "",
    ...body,
  ].join("\n");
}

/** The prompt for the intro writer. Exported for tests. */
export function introPrompt(facts: string[]): string {
  return [
    "Write a 2–3 sentence intro for a weekly newsletter about free AI models and free tiers for developers.",
    "Use ONLY the facts below. Do not add models, numbers, dates or claims that are not in them.",
    "Plain, friendly English. No hype, no emojis, no headings. Mention the one or two most useful changes.",
    "",
    "Facts:",
    ...facts.map((f) => `- ${f}`),
  ].join("\n");
}
