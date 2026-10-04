/**
 * Weekly roundup run (Monday, GitHub Actions): writes content/roundups/<week>.md
 * for the week that just ended. The workflow opens it as a PR for the owner.
 *
 * The intro comes from a free Groq model (production use allowed) when
 * GROQ_API_KEY is set, else from a template. A quiet week still gets a post.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SITE } from "../site.config";
import { eventsInRange, factLines, introPrompt, isoWeek, renderRoundup, templateIntro } from "./roundup";
import { readEvents, readOffers, readResources, readSearchApis } from "./store";
import { searchEvents } from "./search";
import type { ModelKind, ResourceEvent } from "./types";

const INTRO_MODEL = "openai/gpt-oss-120b";

async function writeIntro(facts: string[]): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key || facts.length === 0) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      // gpt-oss is a reasoning model: with a small budget and default effort it can
      // spend every token thinking and return no text (seen 2026-09-28).
      body: JSON.stringify({
        model: INTRO_MODEL,
        messages: [{ role: "user", content: introPrompt(facts) }],
        max_tokens: 1500,
        reasoning_effort: "low",
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content?.trim();
    return text ? text : null;
  } catch (err) {
    console.error("Intro model failed, using the template intro:", err);
    return null;
  }
}

async function main() {
  // The week that ended yesterday (the run is on Monday).
  const week = isoWeek(new Date(Date.now() - 86_400_000));
  const path = join(process.cwd(), "content", "roundups", `${week.label}.md`);
  if (existsSync(path)) {
    console.log(`${week.label} already exists; not overwriting.`);
    return;
  }

  const resources = readResources();
  const offerEvents: ResourceEvent[] = readOffers().flatMap((o) =>
    o.changes.map((c, i) => ({
      id: `offer-${o.id}-${i}`, resource_id: `offer/${o.id}`, provider: o.provider, name: o.name,
      detected_at: `${c.date}T00:00:00.000Z`, event_type: "OFFER" as const, field: null,
      old_value: null, new_value: null, impact_score: 60, source_url: o.url, text: c.text,
    })),
  );
  const searchApis = readSearchApis();
  const events = eventsInRange([...readEvents(), ...offerEvents, ...searchEvents(searchApis)], week.start, week.end);

  const links = new Map<string, string>([
    ...resources.map((r) => [r.id, `${SITE.url}/models/${r.provider}/${r.slug}/`] as [string, string]),
    ...readOffers().map((o) => [`offer/${o.id}`, `${SITE.url}/offers/#${o.id}`] as [string, string]),
    ...searchApis.map((s) => [`search/${s.id}`, `${SITE.url}/search-apis/${s.id}/`] as [string, string]),
  ]);
  const kinds = new Map<string, ModelKind>(resources.map((r) => [r.id, r.kind ?? "chat"]));

  const intro = (await writeIntro(factLines(events))) ?? templateIntro(events);
  mkdirSync(join(process.cwd(), "content", "roundups"), { recursive: true });
  writeFileSync(path, renderRoundup(week, events, intro, links, kinds));
  console.log(`Wrote ${path} (${events.length} events).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
