# FreeTier Radar (resource_miner)

Public site tracking free AI models: what's free, what changed, what works.
Requirements: `Digital-Resource-Miner.md` (v1.3; §18a has the build status).
Live: https://freetier-radar.marcelkanters.workers.dev (Cloudflare Worker with static assets, built from main). Standalone: no dependency on solo_developer;
code there was copied and adapted, not shared.

## Layout

- `pipeline/`: data pipeline (TypeScript, run with tsx). Pure logic (`diff.ts`, `agent-ready.ts`,
  `rankings.ts`, `roundup.ts`, `watch.ts`, `arena.ts`, `siblings.ts`, `reachability.ts`, `cloudflare-pricing.ts`,
  `showcase.ts`, `probe.ts` helpers, adapter `map*` functions) has tests next to it. Entry points:
  `run-discovery.ts`, `run-tests.ts`, `run-watch.ts`, `run-roundup.ts`, `run-arena.ts`, `run-showcase.ts`.
- `data/`: the database. JSON in git, written only by the pipeline, except the hand-kept
  `sponsor.json`, `offers/ai/*.json` and `apps/*.json`. History = git log. Never store snapshots or full API
  responses or pages.
- Models have a `kind` (chat, tts, stt, image); each kind has its own test in `probe.ts` (image: weekly,
  120 s timeout). Tests run at 06:10 UTC (everything + tool calls) and 18:10 UTC (chat only, peak hours); a run
  after 12:00 UTC is the peak-hours run. `test-days.ts`: one result per half-day, derived from the timestamp
  (no extra field); reliability counts tests, agent-ready counts days on which every test answered.
- STT tests also store a word error rate (`wer.ts`) against the clip's script; never the transcript. Hand-listed in `adapters.ts`: OpenRouter's free voices (`OPENROUTER_CURATED_SPEECH`) and
  Z.ai's free Flash models (`ZAI_FREE_MODELS`; its `/models` leaves them out).
- Cloudflare Workers AI: `base_url` has an `{account}` placeholder (`baseUrl()`). Prices come from its pricing
  page (`cloudflare-pricing.ts`, fetched each discovery; a failed fetch throws rather than wiping prices);
  paid-plan-only models are left out. Costs are shown in Neurons against the 10,000 free a day.
- `voices.ts` / `run-voices.ts`: every free English TTS model reads three sentences once (`/voice-models/`); requests
  reuse the daily test's `buildRequest` with the sentence; ffmpeg (installed in the showcase workflow) stores MP3s
  in `public/voices/`, metadata in `data/voices.json`. Runs in the same daily job as the image showcase.
- `showcase.ts`: every free image model draws the same three prompts once, within a daily Neuron budget;
  images in `public/showcase/` (768 px JPEG), metadata in `data/showcase.json`.
- `siblings.ts`: the same model at several providers, by normalised name. A model without its own Arena
  link or context size borrows it from a sibling (shown as borrowed).
- `data/benchmarks/arena.json` + `data/aliases.json`: LMArena ratings (CC-BY-4.0, attribute it)
  and the links from our model ids to Arena names. Exact matches and effort/size variants
  ("-high", "(Max)", "-30b-a3b") are automatic; other near matches only count once confirmed
  through the weekly aliases PR (`pipeline/arena.ts`). Rejected ones stay rejected.
- `src/components/HistoryStrip.astro`: the last N test days (top row mornings, bottom peak hours).
  `src/lib/picker.ts` + `Picker.astro`: "Help me choose" on the home page, from the rankings (`rank(…, { allowEval })`
  for experiments); never recommends a model that hasn't answered a test.
- `families.ts`: the same model at every free provider (sibling groups) → `/free/<model>/` pages for models free at
  2+ providers, best place first (`placeOrder`). `working.ts`: `/api/working.json`, the models an app can use
  that answered the latest test, per use; documented on `/developers/`. Keep that page in step with the feed.
- `data/apps/`: consumer apps with free image/video generation but no free API (`/free-apps/`). Same rules as
  offers: numbers only from the app's own page, an Arena name only when the app says which model free users
  get, `watch_url: null` when the page blocks bots (the page flags records older than 60 days).
- `content/roundups/`: published weekly roundups (Markdown), merged from the Monday PR.
- `fixtures/`: the STT test clip (see its README).
- `src/`: Astro static site; reads `data/` and `content/` at build time through `src/lib/`, bundled with
  `import.meta.glob` (Cloudflare prerenders in its own runtime; `fs` reads come back empty there).
- `site.config.ts`: `SITE.url` must be the address the site is really served from (canonical links,
  sitemap, RSS, README). Change it in the same push as adding a domain.
- `playground/`: local-only Cloudflare prompt tester (`npx tsx playground/server.mjs`, port 4400). Never
  commit it (it's in `.git/info/exclude`).
- `scripts/generate-readme.ts`: regenerates the list between the README markers.
- `.github/workflows/`: discovery every 6 h, daily tests, daily showcase, weekly page watch, Arena ratings
  and roundup (opens a PR), CI.
  Data-writing jobs share the `data-writes` concurrency group.
- `scheduler/`: a separate Cloudflare Worker (cron every 10 min) that starts the data workflows on time via
  workflow_dispatch; the times live in `scheduler/schedule.ts`. GitHub's own cron was late or skipped runs.
  The workflows have no GitHub `schedule` of their own. Its `GITHUB_TOKEN` secret (fine-grained, Actions
  read/write) is set by the owner; deploy from `scheduler/` with `CLOUDFLARE_API_TOKEN` unset (the `.env` one
  is Workers AI only).

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
  `tests/history.json` → `tool_results`. It feeds agent readiness and the coding rankings (`coding`,
  `coding-plan`, `coding-act`). Rankings aren't tied to one tool; the Cline pair lives on `/cline/`.
- Paid subscriptions (`subscriptions.ts`): opt-in on `/settings/` (localStorage only). Rankings with a `paid`
  board show those makers' top Arena models as shaded, unranked rows; never tested, never counted as free.
  A paid model that's also free and in the list isn't repeated.
- Cline (free promotion) is list-only (`testable: false`): its free list comes from the public
  endpoint the Cline extension uses; models are linked to the same model elsewhere by normalised name.
  OpenCode Zen is list-only the same way (its API refuses free models outside OpenCode).
- Gateways with a public model list (Requesty, BazaarLink, OrcaRouter) still have `list_needs_key: true`,
  so their models only appear once a key exists and they can be tested.
- Inclusion bar for a provider: at least 10 free requests a day, or a monthly amount worth about 300
  (TTS ≈10k characters, STT ≈1 hour), surviving our own daily tests; one-time credits are offers.
  Left out on purpose: Nous Portal (its terms forbid monitoring availability), UnoRouter and
  Api.Airforce (unidentified resellers), Aion Labs (20k tokens a day).
- Data workflows rebase before pushing (code pushes can land mid-run); keep that loop when editing them.
- The methodology page describes scoring and labels; keep it in step with `scoring.ts`
  and `agent-ready.ts`.
- Never print, copy or commit API keys. The owner adds them as Actions secrets.
- npm, not pnpm (pnpm's corepack install is broken on this machine).

## Commands

`npm test` · `npm run check` · `npm run build` · `npm run discover` · `npm run test-models` ·
`npm run readme` · `npm run dev` (port 4321, also in `.claude/launch.json`).
