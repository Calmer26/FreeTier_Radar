/**
 * Weekly page-watch run (GitHub Actions): fetch every curated record's watch_url,
 * compare its text hash with data/watch.json, and write out/watch-alert.md when a
 * page changed, for the workflow to turn into an issue.
 *
 * A page that fails to load keeps its old state and is listed in the alert, so a
 * moved or blocked page gets noticed too.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readOffers, readWatch, writeWatch } from "./store";
import { extractText, hashText, nextWatchState, relevantLines } from "./watch";

const OUT_DIR = join(process.cwd(), "out");

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const watch = readWatch();
  const changed: string[] = [];
  const failed: string[] = [];

  for (const offer of readOffers().filter((o) => o.watch_url)) {
    const url = offer.watch_url!;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "FreeTierRadar-watch/1.0 (+https://github.com/Calmer26/FreeTier_Radar)", Accept: "text/html" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = extractText(await res.text());
      const update = nextWatchState(watch[offer.id], hashText(text), today);
      watch[offer.id] = update.state;
      console.log(`- ${offer.id}: ${update.changed ? "CHANGED" : "unchanged"}`);
      if (update.changed) {
        changed.push(
          [
            `### ${offer.name}`,
            `Page: ${url}`,
            `Record: \`data/offers/ai/${offer.id}.json\` (last verified ${offer.verified_on})`,
            "",
            "Lines on the page about limits, credits and prices now:",
            "",
            ...relevantLines(text).map((l) => `> ${l}`),
            "",
          ].join("\n"),
        );
      }
    } catch (err) {
      failed.push(`- **${offer.name}**: ${url} could not be read (${String((err as Error)?.message ?? err)})`);
      console.error(`- ${offer.id}: FAILED ${url}`);
    }
  }

  writeWatch(watch);
  rmSync(OUT_DIR, { recursive: true, force: true });
  if (changed.length || failed.length) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      join(OUT_DIR, "watch-alert.md"),
      [
        "Watched pages changed. Compare the quoted lines with the JSON record; update it (and add an entry to its `changes`) or close this issue.\n",
        ...changed,
        ...(failed.length ? ["### Pages that could not be read", ...failed] : []),
      ].join("\n"),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
