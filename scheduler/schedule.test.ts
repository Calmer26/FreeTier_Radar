import { describe, expect, it } from "vitest";
import { due } from "./schedule";

const at = (iso: string) => new Date(iso);

describe("due", () => {
  it("starts the showcase just after the Neuron reset and the tests at 06:10", () => {
    expect(due(at("2026-09-30T00:30:00Z"))).toEqual(["showcase.yml"]);
    expect(due(at("2026-09-30T06:10:05Z"))).toEqual(["daily-tests.yml"]);
    expect(due(at("2026-09-30T18:10:00Z"))).toEqual(["daily-tests.yml"]); // peak-hours test
  });

  it("rounds a late wake-up down to its 10-minute window", () => {
    expect(due(at("2026-09-30T06:19:59Z"))).toEqual(["daily-tests.yml"]);
    expect(due(at("2026-09-30T06:20:00Z"))).toEqual([]);
  });

  it("runs discovery every 6 hours and the weekly jobs only on Monday", () => {
    expect(["03:20", "09:20", "15:20", "21:20"].map((t) => due(at(`2026-09-30T${t}:00Z`)))).toEqual(
      Array(4).fill(["discovery.yml"]),
    );
    expect(due(at("2026-10-05T06:20:00Z"))).toEqual(["arena.yml"]); // Monday
    expect(due(at("2026-10-06T06:20:00Z"))).toEqual([]);
    expect(due(at("2026-10-05T07:00:00Z"))).toEqual(["roundup.yml"]);
  });
});
