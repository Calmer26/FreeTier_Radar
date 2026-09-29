/**
 * When each data workflow runs (UTC). The scheduler Worker wakes every 10 minutes and
 * starts whatever is due; GitHub's own cron is late or skips runs when busy.
 *
 * Times sit on 10-minute marks and apart from each other: the workflows share one
 * concurrency group, and GitHub keeps only one waiting run per group.
 */

export interface Slot {
  workflow: string;
  hour: number | "every-6h";
  minute: number;
  /** 1 = Monday; omitted = every day. */
  weekday?: number;
}

export const SCHEDULE: Slot[] = [
  { workflow: "showcase.yml", hour: 0, minute: 30 },              // just after the Neuron reset
  { workflow: "discovery.yml", hour: "every-6h", minute: 20 },    // 03:20, 09:20, 15:20, 21:20
  { workflow: "watch.yml", hour: 5, minute: 40, weekday: 1 },
  { workflow: "daily-tests.yml", hour: 6, minute: 10 },
  { workflow: "arena.yml", hour: 6, minute: 20, weekday: 1 },     // waits for the tests to finish
  { workflow: "roundup.yml", hour: 7, minute: 0, weekday: 1 },
];

/** Workflows due in the 10-minute window that starts at `now` (rounded down). */
export function due(now: Date, schedule: Slot[] = SCHEDULE): string[] {
  const h = now.getUTCHours();
  const m = Math.floor(now.getUTCMinutes() / 10) * 10;
  const day = now.getUTCDay();
  return schedule
    .filter((s) => s.minute === m)
    .filter((s) => (s.hour === "every-6h" ? h % 6 === 3 : s.hour === h))
    .filter((s) => s.weekday === undefined || s.weekday === day)
    .map((s) => s.workflow);
}
