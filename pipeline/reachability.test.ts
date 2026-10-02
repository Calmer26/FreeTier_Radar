import { describe, expect, it } from "vitest";
import { isPaidOnly, isUnreachable } from "./reachability";
import type { TestResult } from "./types";

const t = (status: TestResult["status"], day: number): TestResult => ({ at: `2026-09-${String(day).padStart(2, "0")}T06:00:00Z`, status, latency_ms: 100 });

describe("isUnreachable", () => {
  it("needs three 'gone' results in a row", () => {
    expect(isUnreachable([t("gone", 1), t("gone", 2)])).toBe(false);
    expect(isUnreachable([t("gone", 1), t("gone", 2), t("gone", 3)])).toBe(true);
  });
  it("is reset by any other result", () => {
    expect(isUnreachable([t("gone", 1), t("gone", 2), t("gone", 3), t("responded", 4)])).toBe(false);
    expect(isUnreachable([t("gone", 1), t("rate_limited", 2), t("gone", 3)])).toBe(false);
  });
});

describe("isPaidOnly", () => {
  const t = (status: TestResult["status"]): TestResult => ({ at: "2026-10-02T06:00:00Z", status, latency_ms: 1 });
  it("is true when the latest real test said no free quota, ignoring rate limits", () => {
    expect(isPaidOnly([t("responded"), t("no_free_quota")])).toBe(true);
    expect(isPaidOnly([t("no_free_quota"), t("rate_limited")])).toBe(true);
    expect(isPaidOnly([t("no_free_quota"), t("responded")])).toBe(false);
    expect(isPaidOnly([])).toBe(false);
  });
});
