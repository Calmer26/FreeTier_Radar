# FreeTier Radar (resource_miner)

Public site tracking free AI models: what's free, what changed, what works.
Requirements: `Digital-Resource-Miner.md` (v1.1). Standalone: no dependency on solo_developer;
code there was copied and adapted, not shared.

## Layout

- `pipeline/`: data pipeline (TypeScript, run with tsx). Pure logic (`diff.ts`, `agent-ready.ts`,
  `probe.ts` helpers, adapter `map*` functions) has tests next to it.
- `data/`: the database. JSON in git, written only by the pipeline (and by hand for
  `sponsor.json`). History = git log. Never store snapshots or full API responses.
- `src/`: Astro static site; reads `data/` at build time through `src/lib/data.ts`.
- `scripts/generate-readme.ts`: regenerates the list between the README markers.
- `.github/workflows/`: discovery every 6 h, daily tests, CI. Both data jobs share the
  `data-writes` concurrency group.

## Rules

- A quiet run must leave git clean: write files only when content changes; keep
  timestamps at day granularity where they would otherwise change every run.
- A failed or skipped provider must never cause removals (`fetched` in `diff()`).
- Removal needs 12 h of absence (`REMOVAL_GRACE_MS`); a provider's first fetch is a baseline.
- Only put rate limits in `pipeline/providers.ts` after reading them on the provider's own
  page; record the URL and date. "Unknown" is a valid value.
- NVIDIA is evaluation-only (trial terms). Never label it production-ok.
- The methodology page describes scoring and labels; keep it in step with `scoring.ts`
  and `agent-ready.ts`.
- Never print, copy or commit API keys. The owner adds them as Actions secrets.
- npm, not pnpm (pnpm's corepack install is broken on this machine).

## Commands

`npm test` · `npm run check` · `npm run build` · `npm run discover` · `npm run test-models` ·
`npm run readme` · `npm run dev` (port 4321, also in `.claude/launch.json`).
