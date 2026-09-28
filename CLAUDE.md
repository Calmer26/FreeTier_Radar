# FreeTier Radar (resource_miner)

Public site tracking free AI models: what's free, what changed, what works.
Requirements: `Digital-Resource-Miner.md` (v1.2). Standalone: no dependency on solo_developer;
code there was copied and adapted, not shared.

## Layout

- `pipeline/`: data pipeline (TypeScript, run with tsx). Pure logic (`diff.ts`, `agent-ready.ts`,
  `rankings.ts`, `roundup.ts`, `watch.ts`, `arena.ts`, `reachability.ts`, `probe.ts` helpers, adapter `map*`
  functions) has tests next to it. Entry points: `run-discovery.ts`, `run-tests.ts`,
  `run-watch.ts`, `run-roundup.ts`, `run-arena.ts`.
- `data/`: the database. JSON in git, written only by the pipeline, except the hand-kept
  `sponsor.json` and `offers/ai/*.json`. History = git log. Never store snapshots or full API
  responses or pages.
- Models have a `kind` (chat, tts, stt); each kind has its own daily test in `probe.ts`.
  OpenRouter's free voices are hand-listed in `adapters.ts` (`OPENROUTER_CURATED_SPEECH`).
- `data/benchmarks/arena.json` + `data/aliases.json`: LMArena ratings (CC-BY-4.0, attribute it)
  and the links from our model ids to Arena names. Exact matches are automatic; near matches
  only count once confirmed through the weekly aliases PR (`pipeline/arena.ts`).
- `content/roundups/`: published weekly roundups (Markdown), merged from the Monday PR.
- `fixtures/`: the STT test clip (see its README).
- `src/`: Astro static site; reads `data/` and `content/` at build time through `src/lib/`.
- `scripts/generate-readme.ts`: regenerates the list between the README markers.
- `.github/workflows/`: discovery every 6 h, daily tests, weekly page watch, Arena ratings and roundup, CI.
  Data-writing jobs share the `data-writes` concurrency group.

## Rules

- A quiet run must leave git clean: write files only when content changes; keep
  timestamps at day granularity where they would otherwise change every run.
- A failed or skipped provider must never cause removals (`fetched` in `diff()`).
- Removal needs 12 h of absence (`REMOVAL_GRACE_MS`); a provider's first fetch is a baseline.
- Only put rate limits in `pipeline/providers.ts` after reading them on the provider's own
  page; record the URL and date. "Unknown" is a valid value.
- NVIDIA is evaluation-only (trial terms). Never label it production-ok.
- Kilo and LLM7 are keyless (`key_env: null`). LLM7's terms: not for production, no
  proxying/reselling. Label data use (`data_logging`) only from the provider's own statements.
- A field added to `TRACKED_FIELDS` later is backfilled silently for old records (no events).
- Chat models that pass the daily test also get a tool-call test (`tool-test.ts`); results live in
  `tests/history.json` → `tool_results`. It feeds agent readiness and the Cline Plan/Act rankings.
- Data workflows rebase before pushing (code pushes can land mid-run); keep that loop when editing them.
- The methodology page describes scoring and labels; keep it in step with `scoring.ts`
  and `agent-ready.ts`.
- Never print, copy or commit API keys. The owner adds them as Actions secrets.
- npm, not pnpm (pnpm's corepack install is broken on this machine).

## Commands

`npm test` · `npm run check` · `npm run build` · `npm run discover` · `npm run test-models` ·
`npm run readme` · `npm run dev` (port 4321, also in `.claude/launch.json`).
