import { describe, expect, it } from "vitest";
import { half, lastDays, slotKey, testDays } from "./test-days";
import type { TestResult } from "./types";

const t = (at: string, status: TestResult["status"] = "responded"): TestResult => ({ at, status, latency_ms: 100 });

describe("test days", () => {
  it("tells the morning and the peak-hours test apart by time", () => {
    expect(half({ at: "2026-10-02T06:10:00Z" })).toBe("am");
    expect(half({ at: "2026-10-02T18:10:00Z" })).toBe("pm");
    expect(slotKey({ at: "2026-10-02T18:10:00Z" })).toBe("2026-10-02|pm");
  });

  it("keeps the last N days, with both tests of each", () => {
    const h = [t("2026-10-01T06:00:00Z"), t("2026-10-01T18:00:00Z"), t("2026-10-02T06:00:00Z"), t("2026-10-02T18:00:00Z")];
    expect(lastDays(h, 1).map((x) => x.at)).toEqual(["2026-10-02T06:00:00Z", "2026-10-02T18:00:00Z"]);
  });

  it("counts a day as answered only when every test that day answered", () => {
    const days = testDays([
      t("2026-10-01T06:00:00Z"), t("2026-10-01T18:00:00Z", "error"),
      t("2026-10-02T06:00:00Z"), t("2026-10-02T18:00:00Z", "rate_limited"),
      t("2026-10-03T06:00:00Z", "rate_limited"),
    ]);
    expect(days.map((d) => [d.day, d.answered])).toEqual([["2026-10-01", false], ["2026-10-02", true], ["2026-10-03", false]]);
  });
});
