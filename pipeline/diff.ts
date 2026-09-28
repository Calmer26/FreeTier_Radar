/**
 * Change detection: previous resources + this run's observations → next resources
 * and the events between them. Pure, so every rule here is covered by tests.
 *
 * Rules:
 * - Match on `provider/model_id`, never on the model id alone.
 * - Only providers that were fetched successfully this run can lose models. A
 *   provider whose fetch failed is left exactly as it was.
 * - A missing model becomes `pending_removal` first, and is only REMOVED once it has
 *   been missing for REMOVAL_GRACE_MS. Free capacity flaps; one bad listing must not
 *   produce a REMOVED event and a NEW event a few hours later.
 * - An unchanged model is only rewritten when its `last_seen` day changes, so a
 *   quiet run produces no diff in git.
 * - The first successful fetch of a provider, or of a model kind at a provider
 *   (e.g. when speech models were added), is a baseline: those models are
 *   recorded without NEW events, because "is now free" would be untrue for all.
 */

import { createHash } from "node:crypto";
import { eventText } from "./templates";
import { impactScore } from "./scoring";
import type { ObservedModel, ProviderId, Resource, ResourceEvent } from "./types";

export const REMOVAL_GRACE_MS = 12 * 60 * 60 * 1000;

/** The fields a change event can be about, in the order events are emitted. */
export const TRACKED_FIELDS = [
  "name", "price_type", "context_length", "input_modalities", "tool_calling",
  "rate_limits", "limit_scope", "usage_terms", "licence", "card_required", "account_required", "data_logging",
] as const satisfies readonly (keyof ObservedModel)[];

export function resourceId(m: Pick<ObservedModel, "provider" | "model_id">): string {
  return `${m.provider}/${m.model_id}`;
}

export function slugFor(modelId: string): string {
  return modelId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Stable JSON: object keys sorted, so key order never changes a fingerprint. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function fingerprint(m: ObservedModel): string {
  const tracked = Object.fromEntries(TRACKED_FIELDS.map((f) => [f, m[f]]));
  return createHash("sha256").update(stable(tracked)).digest("hex").slice(0, 16);
}

const day = (iso: string) => iso.slice(0, 10);

function makeEvent(
  now: string,
  type: ResourceEvent["event_type"],
  m: ObservedModel,
  change?: { field: string; old: unknown; new: unknown },
): ResourceEvent {
  const rid = resourceId(m);
  const field = change?.field ?? null;
  const id = createHash("sha256").update(`${now}|${type}|${rid}|${field ?? ""}`).digest("hex").slice(0, 12);
  return {
    id,
    resource_id: rid,
    provider: m.provider,
    name: m.name,
    detected_at: now,
    event_type: type,
    field,
    old_value: change ? change.old ?? null : null,
    new_value: change ? change.new ?? null : null,
    impact_score: impactScore(type, m, field),
    source_url: m.url,
    text: eventText(type, m, change),
  };
}

export interface DiffInput {
  previous: Resource[];
  observed: ObservedModel[];
  /** Providers fetched successfully this run. */
  fetched: ProviderId[];
  now: string;
}

export interface DiffOutput {
  resources: Resource[];
  events: ResourceEvent[];
}

export function diff({ previous, observed, fetched, now }: DiffInput): DiffOutput {
  const fetchedSet = new Set(fetched);
  const prevById = new Map(previous.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const usedSlugs = new Map<ProviderId, Set<string>>();
  const events: ResourceEvent[] = [];
  const next: Resource[] = [];
  const known = new Set(previous.map((r) => `${r.provider}|${r.kind}`));
  const isBaseline = (m: ObservedModel) => fetchedSet.has(m.provider) && !known.has(`${m.provider}|${m.kind}`);

  for (const r of previous) {
    if (!usedSlugs.has(r.provider)) usedSlugs.set(r.provider, new Set());
    usedSlugs.get(r.provider)!.add(r.slug);
  }

  for (const m of observed) {
    // A provider listing the same id twice must not produce two resources.
    const id = resourceId(m);
    if (seen.has(id)) continue;
    seen.add(id);

    const fp = fingerprint(m);
    const prev = prevById.get(id);

    if (!prev) {
      const slugs = usedSlugs.get(m.provider) ?? new Set<string>();
      usedSlugs.set(m.provider, slugs);
      let slug = slugFor(m.model_id);
      for (let n = 2; slugs.has(slug); n++) slug = `${slugFor(m.model_id)}-${n}`;
      slugs.add(slug);

      next.push({
        ...m, id, slug, category: "ai-model", status: "active",
        first_seen: now, last_seen: now, missing_since: null, removed_at: null, fingerprint: fp,
      });
      if (!isBaseline(m)) events.push(makeEvent(now, "NEW", m));
      continue;
    }

    const merged: Resource = {
      ...prev, ...m, fingerprint: fp, status: "active", missing_since: null, removed_at: null,
      last_seen: day(prev.last_seen) === day(now) ? prev.last_seen : now,
    };

    if (prev.status === "removed") {
      merged.last_seen = now;
      events.push(makeEvent(now, "RETURNED", m));
    } else if (prev.fingerprint !== fp) {
      for (const f of TRACKED_FIELDS) {
        // A field added to the schema after this record was written is filled in
        // silently: "unknown → logs prompts" on every model is not news.
        if (prev[f] === undefined) continue;
        if (stable(prev[f]) !== stable(m[f])) {
          events.push(makeEvent(now, "CHANGED", m, { field: f, old: prev[f], new: m[f] }));
        }
      }
    }
    next.push(merged);
  }

  for (const prev of previous) {
    if (seen.has(prev.id)) continue;

    // Failed or skipped provider, or already removed: nothing to learn this run.
    if (!fetchedSet.has(prev.provider) || prev.status === "removed") {
      next.push(prev);
      continue;
    }

    const missingSince = prev.missing_since ?? now;
    if (Date.parse(now) - Date.parse(missingSince) >= REMOVAL_GRACE_MS) {
      next.push({ ...prev, status: "removed", removed_at: now, missing_since: null });
      events.push(makeEvent(now, "REMOVED", prev));
    } else {
      next.push({ ...prev, status: "pending_removal", missing_since: missingSince });
    }
  }

  next.sort((a, b) => a.id.localeCompare(b.id));
  return { resources: next, events };
}
