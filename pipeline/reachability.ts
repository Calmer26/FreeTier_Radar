/**
 * A model is "listed but not callable" when its provider lists it but the daily test
 * got "not found" on the last UNREACHABLE_AFTER days in a row. NVIDIA's catalogue is
 * full of these: on 2026-09-28, 36 of its 54 listed chat models answered 404.
 *
 * Such models leave the directory, the counts and the README list, but keep their
 * page (labelled) and a section on their provider page: the finding itself is useful.
 * One good answer brings a model straight back.
 */

import type { TestResult } from "./types";

export const UNREACHABLE_AFTER = 3;

export function isUnreachable(history: TestResult[]): boolean {
  const recent = history.slice(-UNREACHABLE_AFTER);
  return recent.length === UNREACHABLE_AFTER && recent.every((t) => t.status === "gone");
}
