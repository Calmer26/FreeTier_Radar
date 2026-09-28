import { describe, expect, it } from "vitest";
import { eventsInRange, introPrompt, isoWeek, renderRoundup, templateIntro } from "./roundup";
import type { ResourceEvent } from "./types";

const ev = (over: Partial<ResourceEvent>): ResourceEvent => ({
  id: "x", resource_id: "groq/m", provider: "groq", name: "M", detected_at: "2026-09-29T06:00:00Z",
  event_type: "NEW", field: null, old_value: null, new_value: null, impact_score: 50, source_url: "", text: "M is free.",
  ...over,
});

describe("isoWeek", () => {
  it("labels ISO weeks with a Monday–Sunday range", () => {
    expect(isoWeek(new Date("2026-09-28T12:00:00Z"))).toEqual({ label: "2026-W40", start: "2026-09-28", end: "2026-10-04" });
    expect(isoWeek(new Date("2026-10-04T23:00:00Z")).label).toBe("2026-W40");
    // 1 Jan 2027 is a Friday, so it belongs to the last week of 2026.
    expect(isoWeek(new Date("2027-01-01T00:00:00Z")).label).toBe("2026-W53");
  });
});

describe("eventsInRange", () => {
  it("keeps the week's events, most important first", () => {
    const out = eventsInRange([
      ev({ id: "a", detected_at: "2026-09-27T23:00:00Z" }),
      ev({ id: "b", impact_score: 40 }),
      ev({ id: "c", impact_score: 80, detected_at: "2026-10-04T10:00:00Z" }),
    ], "2026-09-28", "2026-10-04");
    expect(out.map((e) => e.id)).toEqual(["c", "b"]);
  });
});

describe("renderRoundup", () => {
  it("groups events into sections under a frontmatter header, with links and kinds", () => {
    const md = renderRoundup(
      { label: "2026-W40", start: "2026-09-28", end: "2026-10-04" },
      [ev({}), ev({ id: "r", resource_id: "groq/whisper", name: "Whisper", event_type: "REMOVED", text: "Whisper left." })],
      "Intro text.",
      new Map([["groq/m", "https://x/models/groq/m/"]]),
      new Map([["groq/whisper", "stt"]]),
    );
    expect(md).toContain('title: "Free AI resources, week 40 2026"');
    expect(md).toContain("## New free models\n\n- **[M](https://x/models/groq/m/)**: M is free.");
    expect(md).toContain("## Gone\n\n- **Whisper** (speech-to-text): Whisper left.");
  });
});

describe("intros", () => {
  it("summarises counts in the template intro, or calls it a quiet week", () => {
    expect(templateIntro([ev({}), ev({ event_type: "REMOVED" })])).toBe("This week: 1 model(s) became free, 1 left the free tier.");
    expect(templateIntro([])).toMatch(/quiet week/);
  });
  it("tells the model to use only the given facts", () => {
    expect(introPrompt(["NEW: M is free."])).toMatch(/Use ONLY the facts below[\s\S]*- NEW: M is free\./);
  });
});
