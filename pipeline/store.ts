/**
 * Reading and writing the JSON data files under data/.
 *
 * Writers only touch a file when its content changed, so a quiet run leaves git
 * clean and triggers no site rebuild.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PROVIDER_IDS } from "./providers";
import { withDefaults } from "./store-defaults";
import type { ProviderId, Resource, ResourceEvent, SourcesFile, TestHistory } from "./types";

/** Resolved from the project root: scripts and the Astro build both run there. */
export const DATA_DIR = join(process.cwd(), "data");

const resourcesFile = (p: ProviderId) => join(DATA_DIR, "resources", "ai", `${p}.json`);
const eventsDir = join(DATA_DIR, "events");
const testsFile = join(DATA_DIR, "tests", "history.json");
const sourcesFile = join(DATA_DIR, "sources.json");

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Writes pretty JSON with a trailing newline; returns whether the file changed. */
function writeJsonIfChanged(path: string, value: unknown): boolean {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return true;
}

export function readResources(): Resource[] {
  return PROVIDER_IDS.flatMap((p) => readJson<Resource[]>(resourcesFile(p), [])).map(withDefaults);
}

export function writeResources(resources: Resource[]): void {
  for (const p of PROVIDER_IDS) {
    const mine = resources.filter((r) => r.provider === p).sort((a, b) => a.id.localeCompare(b.id));
    // Don't create an empty file for a provider that has never been fetched.
    if (mine.length === 0 && !existsSync(resourcesFile(p))) continue;
    writeJsonIfChanged(resourcesFile(p), mine);
  }
}

/** All events, oldest first. */
export function readEvents(): ResourceEvent[] {
  if (!existsSync(eventsDir)) return [];
  return readdirSync(eventsDir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .flatMap((f) =>
      readFileSync(join(eventsDir, f), "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as ResourceEvent),
    );
}

/** Appends to one file per month (events/YYYY-MM.jsonl). */
export function appendEvents(events: ResourceEvent[]): void {
  if (events.length === 0) return;
  mkdirSync(eventsDir, { recursive: true });
  const byMonth = new Map<string, ResourceEvent[]>();
  for (const e of events) {
    const month = e.detected_at.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), e]);
  }
  for (const [month, list] of byMonth) {
    const path = join(eventsDir, `${month}.jsonl`);
    const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
    writeFileSync(path, existing + list.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
}

export function readTests(): TestHistory {
  return readJson<TestHistory>(testsFile, { updated_at: null, results: {}, observed_limits: {} });
}

export function writeTests(history: TestHistory): void {
  writeJsonIfChanged(testsFile, history);
}

export function readSources(): SourcesFile {
  return readJson<SourcesFile>(sourcesFile, {});
}

export function writeSources(sources: SourcesFile): void {
  writeJsonIfChanged(sourcesFile, sources);
}
