/**
 * Weekly Arena run (GitHub Actions): download the LMArena leaderboards, keep each
 * model's "overall" row in data/benchmarks/arena.json, and link free chat models to
 * Arena names in data/aliases.json.
 *
 * Exact matches are written straight to data/aliases.json. Near matches are written
 * to out/aliases-suggested.json (the full file with them added as "confirmed") and
 * out/alias-suggestions.md, for the workflow to open as a PR: merging it confirms
 * them, and changing an entry to "rejected" turns it down for good.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parquetReadObjects } from "hyparquet";
import {
  ARENA_ATTRIBUTION, ARENA_BOARDS, ARENA_DATASET_URL, arenaIndex, sortKeys, updateAliases,
  type AliasFile, type ArenaBoardData, type ArenaFile,
} from "./arena";
import { DATA_DIR, readResources } from "./store";

const OUT_DIR = join(process.cwd(), "out");
const ARENA_FILE = join(DATA_DIR, "benchmarks", "arena.json");
const ALIAS_FILE = join(DATA_DIR, "aliases.json");

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "number" && Number.isFinite(v) ? v : null);

async function readBoard(board: string): Promise<ArenaBoardData> {
  const url = `${ARENA_DATASET_URL}/resolve/main/${board}/latest-00000-of-00001.parquet`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${board}: HTTP ${res.status}`);
  const rows = (await parquetReadObjects({ file: await res.arrayBuffer() })) as Row[];
  const overall = rows.filter((r) => r.category === "overall");
  if (overall.length === 0) throw new Error(`${board}: no "overall" rows`);
  const models = overall
    .map((r) => {
      const rating = num(r.rating);
      const score = num(r.score);
      return {
        name: String(r.model_name),
        org: String(r.organization ?? ""),
        rating: rating == null ? null : Math.round(rating * 10) / 10,
        ...(score == null ? {} : { score: Math.round(score * 10_000) / 10_000 }),
        rank: num(r.rank) ?? 0,
        votes: num(r.vote_count) ?? num(r.session_count) ?? 0,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return { published: String(overall[0].leaderboard_publish_date), models };
}

function writeJson(path: string, value: unknown) {
  mkdirSync(join(path, ".."), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text);
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const file: ArenaFile = { source: `${ARENA_ATTRIBUTION}: ${ARENA_DATASET_URL}`, fetched_on: today, boards: {} };
  for (const board of ARENA_BOARDS) {
    file.boards[board] = await readBoard(board);
    console.log(`- ${board}: ${file.boards[board]!.models.length} models, published ${file.boards[board]!.published}`);
  }

  // Keep fetched_on from changing the file when the leaderboards didn't.
  const previous: ArenaFile | null = existsSync(ARENA_FILE) ? JSON.parse(readFileSync(ARENA_FILE, "utf8")) : null;
  if (previous && JSON.stringify(previous.boards) === JSON.stringify(file.boards)) file.fetched_on = previous.fetched_on;
  writeJson(ARENA_FILE, file);

  const current: AliasFile = existsSync(ALIAS_FILE) ? JSON.parse(readFileSync(ALIAS_FILE, "utf8")) : {};
  // Chat models match the text boards, image models the text-to-image board.
  const rated = readResources().filter((r) => (r.kind === "chat" || r.kind === "image") && r.status !== "removed");
  const { aliases, suggestions } = updateAliases(current, rated, arenaIndex(file), today);
  writeJson(ALIAS_FILE, aliases);
  const linked = Object.values(aliases).filter((a) => a.status !== "rejected" && a.arena).length;
  console.log(`\n${linked} model(s) linked to Arena; ${suggestions.length} near match(es) to review.`);

  rmSync(join(OUT_DIR, "aliases-suggested.json"), { force: true });
  rmSync(join(OUT_DIR, "alias-suggestions.md"), { force: true });
  if (suggestions.length) {
    mkdirSync(OUT_DIR, { recursive: true });
    const withSuggestions = { ...aliases };
    for (const s of suggestions) withSuggestions[s.id] = { arena: s.arena, status: "confirmed", on: today };
    writeFileSync(join(OUT_DIR, "aliases-suggested.json"), `${JSON.stringify(sortKeys(withSuggestions), null, 2)}\n`);
    writeFileSync(
      join(OUT_DIR, "alias-suggestions.md"),
      [
        "These free models have no exact name match on LMArena, but a close one. Merging this PR links them, and their Arena ratings will show on the site.",
        "",
        'To turn one down, change its `"status"` to `"rejected"` in `data/aliases.json` in this PR (it won\'t be suggested again). To skip one for now, delete its entry.',
        "",
        "| Our model | Suggested Arena name |",
        "|---|---|",
        ...suggestions.map((s) => `| \`${s.id}\` | \`${s.arena}\` |`),
      ].join("\n"),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
