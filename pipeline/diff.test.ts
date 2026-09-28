import { describe, expect, it } from "vitest";
import { diff, fingerprint, REMOVAL_GRACE_MS, slugFor } from "./diff";
import type { ObservedModel, Resource } from "./types";

const T0 = "2026-09-28T00:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(T0) + hours * 3_600_000).toISOString();

function model(id: string, over: Partial<ObservedModel> = {}): ObservedModel {
  return {
    provider: "openrouter",
    model_id: id,
    kind: "chat",
    listed_by: "api",
    name: id,
    url: `https://openrouter.ai/${id}`,
    price_type: "free",
    context_length: 131_072,
    input_modalities: ["text"],
    tool_calling: true,
    rate_limits: { rpm: 20, rpd: 50 },
    limit_scope: "shared",
    usage_terms: "production-ok",
    licence: null,
    card_required: "no",
    account_required: "yes",
    data_logging: "unknown",
    ...over,
  };
}

function run(previous: Resource[], observed: ObservedModel[], now: string, fetched = ["openrouter" as const]) {
  return diff({ previous, observed, fetched: [...fetched], now });
}

/** A provider that already has one resource, so later runs are not a baseline. */
const seeded = () => run([], [model("seed:free")], T0).resources;

describe("diff", () => {
  it("records a provider's first fetch as a baseline, without NEW events", () => {
    const { resources, events } = run([], [model("a/x:free")], T0);
    expect(events).toEqual([]);
    expect(resources[0]).toMatchObject({ id: "openrouter/a/x:free", slug: "a-x-free", status: "active", first_seen: T0 });
  });

  it("creates NEW events for models that appear after the baseline", () => {
    const { resources, events } = run(seeded(), [model("seed:free"), model("a/x:free")], at(6));
    expect(events.map((e) => [e.event_type, e.resource_id])).toEqual([["NEW", "openrouter/a/x:free"]]);
    expect(resources.find((r) => r.model_id === "a/x:free")?.first_seen).toBe(at(6));
  });

  it("writes nothing new on an unchanged run the same day", () => {
    const first = run([], [model("a/x:free")], T0);
    const second = run(first.resources, [model("a/x:free")], at(6));
    expect(second.events).toEqual([]);
    expect(second.resources).toEqual(first.resources);
  });

  it("bumps last_seen once the UTC day changes", () => {
    const first = run([], [model("a/x:free")], T0);
    const next = run(first.resources, [model("a/x:free")], at(25));
    expect(next.resources[0].last_seen).toBe(at(25));
    expect(next.events).toEqual([]);
  });

  it("emits one CHANGED event per changed field", () => {
    const first = run([], [model("a/x:free")], T0);
    const { events } = run(first.resources, [model("a/x:free", { context_length: 262_144, tool_calling: false })], at(6));
    expect(events.map((e) => [e.event_type, e.field, e.old_value, e.new_value])).toEqual([
      ["CHANGED", "context_length", 131_072, 262_144],
      ["CHANGED", "tool_calling", true, false],
    ]);
  });

  it("marks a missing model pending first, and removes it only after the grace period", () => {
    const first = run([], [model("a/x:free")], T0);
    const r1 = run(first.resources, [], at(6));
    expect(r1.events).toEqual([]);
    expect(r1.resources[0]).toMatchObject({ status: "pending_removal", missing_since: at(6) });

    const r2 = run(r1.resources, [], at(12));
    expect(r2.events).toEqual([]);
    expect(r2.resources[0].status).toBe("pending_removal");

    const r3 = run(r2.resources, [], at(6 + REMOVAL_GRACE_MS / 3_600_000));
    expect(r3.events.map((e) => e.event_type)).toEqual(["REMOVED"]);
    expect(r3.resources[0]).toMatchObject({ status: "removed", missing_since: null });
  });

  it("silently restores a pending model that comes back within the grace period", () => {
    const first = run([], [model("a/x:free")], T0);
    const pending = run(first.resources, [], at(6));
    const back = run(pending.resources, [model("a/x:free")], at(12));
    expect(back.events).toEqual([]);
    expect(back.resources[0]).toMatchObject({ status: "active", missing_since: null });
  });

  it("emits RETURNED for a removed model that reappears", () => {
    const first = run([], [model("a/x:free")], T0);
    const p = run(first.resources, [], at(1));
    const removed = run(p.resources, [], at(13));
    const back = run(removed.resources, [model("a/x:free")], at(30));
    expect(back.events.map((e) => e.event_type)).toEqual(["RETURNED"]);
    expect(back.resources[0].status).toBe("active");
  });

  it("never removes models of a provider that was not fetched this run", () => {
    const first = run([], [model("a/x:free")], T0);
    const failed = run(first.resources, [], at(24), []);
    expect(failed.events).toEqual([]);
    expect(failed.resources).toEqual(first.resources);
  });

  it("matches on provider and id, so the same id under two providers is two resources", () => {
    const { resources } = diff({
      previous: [],
      observed: [model("m"), model("m", { provider: "groq" })],
      fetched: ["openrouter", "groq"],
      now: T0,
    });
    expect(resources.map((r) => r.id)).toEqual(["groq/m", "openrouter/m"]);
  });

  it("gives colliding slugs a suffix", () => {
    const { resources } = run([], [model("a/x:free"), model("a-x:free")], T0);
    expect(resources.map((r) => r.slug).sort()).toEqual(["a-x-free", "a-x-free-2"]);
  });

  it("ignores duplicate listings of the same id", () => {
    const { resources, events } = run(seeded(), [model("seed:free"), model("a/x:free"), model("a/x:free")], at(6));
    expect(resources).toHaveLength(2);
    expect(events).toHaveLength(1);
  });
});

describe("fingerprint", () => {
  it("does not depend on key order in nested objects", () => {
    const a = model("m", { rate_limits: { rpm: 1, rpd: 2 } });
    const b = model("m", { rate_limits: { rpd: 2, rpm: 1 } });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
});

describe("slugFor", () => {
  it("makes ids URL-safe", () => {
    expect(slugFor("meta-llama/Llama-3.3-70B-Instruct:free")).toBe("meta-llama-llama-3-3-70b-instruct-free");
  });
});

describe("diff baselines per kind", () => {
  it("records a new kind at a known provider as a baseline, then reports later additions", () => {
    const chatOnly = run([], [model("a:free")], T0).resources;
    const speech = model("whisper-x", { kind: "stt" });
    const first = run(chatOnly, [model("a:free"), speech], at(6));
    expect(first.events).toEqual([]);
    const later = run(first.resources, [model("a:free"), speech, model("whisper-y", { kind: "stt" })], at(12));
    expect(later.events.map((e) => [e.event_type, e.resource_id])).toEqual([["NEW", "openrouter/whisper-y"]]);
  });
});

describe("fields added after a record was written", () => {
  it("are filled in without CHANGED events", () => {
    const first = run([], [model("a:free")], T0).resources;
    const { data_logging: _, ...legacy } = first[0];
    const next = run([legacy as Resource], [model("a:free", { data_logging: "logs-prompts" })], at(6));
    expect(next.events).toEqual([]);
    expect(next.resources[0].data_logging).toBe("logs-prompts");
    // …and changes to it after that are reported as usual.
    const later = run(next.resources, [model("a:free", { data_logging: "may-train" })], at(12));
    expect(later.events.map((e) => e.field)).toEqual(["data_logging"]);
  });
});

describe("rate limit changes", () => {
  it("only count when a number changes, not the wording of the note", () => {
    const first = run(seeded(), [model("seed:free"), model("x:free", { rate_limits: { rpd: 50, note: "old wording" } })], T0).resources;
    const reworded = run(first, [model("seed:free"), model("x:free", { rate_limits: { rpd: 50, note: "new wording", source: "u" } })], at(6));
    expect(reworded.events).toEqual([]);
    const cut = run(reworded.resources, [model("seed:free"), model("x:free", { rate_limits: { rpd: 20, note: "new wording" } })], at(12));
    expect(cut.events.map((e) => [e.field, e.old_value, e.new_value])).toEqual([["rate_limits", { rpd: 50, note: "new wording", source: "u" }, { rpd: 20, note: "new wording" }]]);
  });
});
