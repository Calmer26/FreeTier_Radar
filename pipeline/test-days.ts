/**
 * The daily test runs twice: in the quiet morning (06:10 UTC) and at peak hours
 * (18:10 UTC, chat models only). A result's half of the day comes from its timestamp,
 * so history needs no extra field: each day holds at most one morning and one evening
 * result. Pure.
 */

import type { TestResult } from "./types";

export const day = (t: { at: string }) => t.at.slice(0, 10);
/** "am" before 12:00 UTC, "pm" after: the morning and the peak-hours test. */
export const half = (t: { at: string }) => (Number(t.at.slice(11, 13)) < 12 ? "am" : "pm");
/** One result per test slot: a rerun in the same half-day replaces the earlier one. */
export const slotKey = (t: { at: string }) => `${day(t)}|${half(t)}`;

/** Results from the last `days` distinct test days (not the last `days` results). */
export function lastDays<T extends { at: string }>(history: T[], days: number): T[] {
  const keep = new Set([...new Set(history.map(day))].sort().slice(-days));
  return history.filter((t) => keep.has(day(t)));
}

export interface TestDay {
  day: string;
  tests: TestResult[];
  /** Every test that day answered (rate-limited ones aside), and at least one did. */
  answered: boolean;
}

/** History grouped by day, oldest first. */
export function testDays(history: TestResult[]): TestDay[] {
  const byDay = new Map<string, TestResult[]>();
  for (const t of history) byDay.set(day(t), [...(byDay.get(day(t)) ?? []), t]);
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, tests]) => {
      const counted = tests.filter((t) => t.status !== "rate_limited");
      return { day: d, tests, answered: counted.length > 0 && counted.every((t) => t.status === "responded") };
    });
}
