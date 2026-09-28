import { describe, expect, it } from "vitest";
import { extractText, hashText, nextWatchState, relevantLines } from "./watch";

describe("extractText", () => {
  it("keeps visible text, one block per line, without scripts or navigation", () => {
    const html = `<html><head><title>x</title></head><body><nav>Menu</nav>
      <h1>Pricing</h1><script>var a = 1;</script>
      <p>Free plan: <b>10,000</b>&nbsp;Neurons per day</p><!-- note --><footer>© 2026</footer></body></html>`;
    expect(extractText(html)).toBe("Pricing\nFree plan: 10,000 Neurons per day");
  });
});

describe("relevantLines", () => {
  it("keeps the lines about limits, credits and prices", () => {
    const text = "Welcome to our docs\nFree users get $0.10 of credits per month\nContact sales\n20 RPM on the free tier";
    expect(relevantLines(text)).toEqual(["Free users get $0.10 of credits per month", "20 RPM on the free tier"]);
  });
});

describe("nextWatchState", () => {
  it("treats the first check as a baseline", () => {
    expect(nextWatchState(undefined, "h1", "2026-09-28")).toEqual({
      state: { hash: "h1", checked_on: "2026-09-28", changed_on: null },
      changed: false,
    });
  });

  it("flags a changed hash and remembers when", () => {
    const first = nextWatchState(undefined, "h1", "2026-09-28").state;
    expect(nextWatchState(first, "h1", "2026-10-05")).toMatchObject({ changed: false, state: { changed_on: null } });
    expect(nextWatchState(first, "h2", "2026-10-05")).toMatchObject({ changed: true, state: { hash: "h2", changed_on: "2026-10-05" } });
  });

  it("gives equal text an equal hash", () => {
    expect(hashText("a\nb")).toBe(hashText("a\nb"));
    expect(hashText("a\nb")).not.toBe(hashText("a\nc"));
  });
});
