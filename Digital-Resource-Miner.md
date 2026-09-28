# FreeTier Radar (working name; project folder: resource_miner)

**Status:** Requirements v1.2 (26-question clarification + design review + Phase 2 research)
**Date:** 28 September 2026
**Previous version:** `Digital-Resource-Miner.v0-original.md` (personal digest-bot concept)

---

## 1. Product in one sentence

> **A public website that tracks free AI models and APIs, plus a short list of the most valuable always-free developer tiers, for indie and solo developers. It shows what is free right now, what changed, and what is best for a given job, with honest labels for the terms that apply.**

The core principle from v0 still holds: **the product is a change detector, not a pile of links.** The public site adds two views on top of the same data: a live directory and rankings.

### What changed from v0

| v0 (concept) | v1.1 (this document) |
|---|---|
| Personal daily digest bot | Public website; the owner is also a heavy user |
| All categories (AI, infra, data, grants) | AI in depth + a focused watchlist of ~15–20 infra tiers; breadth by linking to free-for.dev |
| Supabase database | **JSON files in a public git repo**, so the history comes free |
| Email digest is the UI | Website, RSS, weekly newsletter, JSON feed, auto-generated awesome-list |
| Benchmarks later | LMArena leaderboard dataset (CC-BY-4.0) in Phase 2; BenchLM ruled out (non-commercial licence) |
| No verification | Daily test request to every free model |
| Paid subscriptions | **Sponsor slot** (prepared from the start); paid tier only if traffic ever justifies it |
| NVIDIA NIM listed as "permanent free" | NVIDIA flagged **evaluation-only** (see §4) |

---

## 2. Audience and goals

**Primary audience:** indie and solo developers building side projects and small products who want to run on free tiers.

**Secondary audience (the owner):**
- finding free models for the owner's own apps
- choosing free models for coding-agent work in **Cline**
- spotting tier cuts before they break something

**Language:** English only.

**Goals**
1. Be the most up-to-date and most honest source for which free AI models and tiers actually work today.
2. Remove the owner's manual daily check (the Grok/OpenRouter routine).
3. Build an audience through search, a one-off launch push and the GitHub list, with the sponsor slot as the revenue model.

**Non-goals**
- General AI news aggregation
- Competing with free-for.dev on breadth of free dev tiers. We link to it.
- Datasets, grants and hackathons. They only come in if submissions ask for them.
- User accounts, comments, votes
- Automatically claiming credits or creating accounts (see §15)

**Owner time budget:** 2–4 hours per week. Every design decision below has to fit this.

---

## 3. Core experiences

Three sections, all built on the same resource and event data:

1. **Directory:** a filterable table of everything free right now.
   - Filters: category, provider, modality, context, tool calling, card required, commercial use, eval-only, agent-ready, last test result.
2. **Change feed:** NEW / CHANGED / REMOVED events, newest first.
   - Each event includes old → new values, the source link, and template-generated "why it matters" text.
   - This is also the source for RSS, the newsletter and the weekly roundup.
3. **Rankings ("best free X"):** ranked views, for example:
   - Best free models for coding agents (Cline)
   - Best free vision models
   - Best free long-context models
   - Best always-free compute (from the infra watchlist)
   - Ranking inputs: daily test history, agent readiness, usability and Arena ratings where available. The formula is published on the site.

**Supporting pages (SEO)**
- One page per model, e.g. `/models/openrouter/qwen3-coder-free`: current state, event history, benchmarks, 30-day test history, terms badges, Cline settings snippet.
- One page per provider: free-tier summary, limits table, change history.
- Weekly roundup posts: "This week in free dev resources".
- Methodology page, covering sources, testing, scoring, labels and the sponsor policy.
- Suggest-a-resource form.
- Link to free-for.dev as "more free dev tiers" on the infra pages.

**Guarding against thin content:** a model page only goes live once it has at least the basic metadata, one test result, and a template explanation. Near-duplicate variants (e.g. the same model at two providers) share a main page and are shown as provider rows on it.

---

## 4. Honest labels (terms and usability)

Every resource carries these independent fields. The most important ones appear as **badges** and **filters**.

| Field | Values | Badge |
|---|---|---|
| price | $0 / freemium-quota / trial-credit / paid / unknown | FREE / QUOTA / CREDIT |
| usage_terms | production-ok / **evaluation-only** / non-commercial / unknown | ⚠ EVAL-ONLY |
| licence (weights) | SPDX id / custom / unknown | licence chip |
| card_required | yes / no / unknown | NO CARD |
| account_required | yes / no / phone-verification | NO SIGNUP |
| api_available | yes / no | |
| rate_limits | structured: rpm, rpd, tpm, tpd, monthly; plus `limit_scope` (per-model / shared across the provider's free models) | shown in table |
| expires | date / never / unknown | ⏳ expiry |
| region | global / list / unknown | |
| last_test | responded / rate-limited / failed / untested, with timestamp | 🟢 / 🟡 / 🔴 "responded 06:10 UTC" |
| agent_ready | yes / partial / no (derived, see §6) | 🤖 AGENT-READY |
| data_logging | none-stated / logs-prompts / may-train / unknown | 👁 LOGS PROMPTS (Phase 2) |

"Unknown" is a normal value everywhere; never guess.

**Confirmed example:** NVIDIA's API Trial Terms say that without a paid subscription the API may be used **"only … for internal testing and evaluation purposes, not in production."** NVIDIA models therefore get `usage_terms = evaluation-only`, and they never appear in production-oriented rankings. model-admin already applies this rule (`packages/model-rotation/src/providers.ts`).

---

## 5. Scope and phased rollout

| Phase | Scope | How data is collected |
|---|---|---|
| **0 — Setup** | Repo, Cloudflare Pages, secrets, limit checks, domain | — |
| **1 — MVP** | Free LLMs: OpenRouter, Groq, Google Gemini, NVIDIA (eval-only) | Automated (fetchers exist in model-admin) |
| **2 — AI radar + launch** | More free-model providers, provider offers (credits, trials, quota pools), Arena scores, rankings, weekly roundup, newsletter, public launch. Details in §18a. | Automated where there's an API; otherwise curated + page-change alerts |
| **3 — Infra watchlist** | ~15–20 high-value always-free tiers, e.g. Oracle Always Free, Cloudflare (Workers/Pages/R2/D1), Supabase, Neon, Turso, Vercel, Netlify, AWS/GCP/Azure always-free, GitHub Actions/Codespaces | Curated JSON records + weekly page-change detection |
| **Later / only on demand** | Free image, speech and embedding APIs (Phase 2b if there's demand); datasets, dev programmes, startup credits, grants; accounts/paid features | Submissions only |

**Rule:** a phase is only started once the previous one runs without daily manual work.

---

## 6. Coding-agent readiness (for Cline users)

A derived tag, calculated from metadata and test history. No separate agent benchmark runs.

A model is **AGENT-READY** when all of these hold:
- supports tool/function calling, e.g. OpenRouter `supported_parameters` contains `tools`
- context ≥ 64k tokens, because Cline's system prompt and file context are large
- responded to the daily test on at least 5 of the last 7 days
- free rate limits allow real sessions (thresholds are configurable)
- usage_terms is not `evaluation-only`. Eval-only models can still be tagged "agent-capable (eval only)".

**PARTIAL:** meets the tool-calling and context requirements but fails the test-history or rate-limit checks.

**Being honest about rate limits:** Cline sends one request per tool step, and a single task can take 20–50 requests. When the limit is shared across all free models (`limit_scope = shared`) and is low, the tag says so. Example for OpenRouter:

> 🤖 AGENT-READY: needs the one-time $10 credit for practical use (free accounts get 50 requests/day across all free models, 1,000/day after $10)

The model page shows the provider base URL and model id in a copy-paste block for Cline's OpenAI-compatible / OpenRouter settings.

---

## 7. Daily test request

- Once a day per free model, send one tiny request, e.g. "reply with OK", max 5 tokens.
- Record the result: `responded` / `rate_limited (429)` / `failed (error type)`, plus latency.
- **Wording:** show "responded at 06:10 UTC", not "available" or "reliable". One request a day proves the model was up, not that it's usable at busy times. The methodology page explains this.
- Keep a rolling 30-day history per model and trim it in the same job.
- The site uses **its own provider API keys**, separate from solo_developer. The owner adds them as GitHub Actions secrets.
- Budget: an OpenRouter free account has **50 free-model requests/day**, which rises to 1,000/day after $10 of credit (confirmed in the OpenRouter docs/FAQ). With 50+ free models, the one-time $10 top-up is required for daily testing.
- The test code is adapted from `packages/model-rotation/src/probe.ts` and `classify-error.ts`.

---

## 8. Benchmark enrichment (Phase 2)

**Source: the LMArena leaderboard dataset** (`lmarena-ai/leaderboard-dataset` on Hugging Face).
- Licence: **CC-BY-4.0**, so commercial use is allowed with attribution. Checked 28 Sep 2026.
- Updated daily (latest publish date 27 Sep 2026).
- Subsets used: `text` (overall), `webdev` and `agent` (coding and agent use), and `vision`.

**Ruled out (checked 28 Sep 2026):**
- **BenchLM.ai** is CC BY-NC 4.0. Commercial use, which includes a sponsored site, needs a licence from BenchLM.
- **Artificial Analysis'** free API is "internal use only with attribution". Redistribution needs a commercial package.
- Either can be reconsidered if the owner obtains a licence.

**Rules**
- Fetch weekly; store only the latest rating and rank per model per subset, in `data/benchmarks/arena.json`.
- **Name matching:** `data/aliases.json` maps provider model ids to Arena model names.
  - The bot suggests matches by fuzzy matching.
  - The owner confirms them in the weekly review PR (§9).
  - Unconfirmed matches are never shown.
- Show the rating, rank, subset, publish date and the attribution "Source: LMArena leaderboard dataset (CC-BY-4.0)".
- Arena mostly covers well-known models, so many small or new free models will have no score. Show "No Arena rating yet". Rankings must still work without scores (§18a).

---

## 9. Text generation and approvals through GitHub PRs

| Content | How it's written | How it's published |
|---|---|---|
| Change events (all, including high-impact) | **Templates** from structured fields | Automatically, committed straight to `main` |
| High-impact events | Templates + an owner notification (GitHub issue with label `high-impact`) | Automatically; the owner may add a hand-written note |
| **Weekly roundup** | **LLM draft** (a free model whose terms allow production use) built from the week's events; facts inserted from the data | **PR** → owner edits and merges |
| Arena name matches | Bot suggestion | In the same weekly review PR |
| Offer or infra page changed (page-change detection) | Bot opens an issue with the old/new page excerpt | Owner updates the curated JSON, or closes the issue |
| Suggestions | GitHub **issue form** (template in the repo; needs a GitHub account) | Owner converts it to a curated record, or closes it |

**Owner routine:** one weekly session (about 30–60 minutes) to review and merge the roundup PR, then clear the issues. **No admin website is built.** The GitHub mobile app is the admin UI.

Example templates:
- `NEW FREE MODEL: {name} is now free on {provider}. {context} context, tool calling {yes/no}. {limits}.`
- `TIER CUT: {provider} {field} changed from {old} to {new}.`

---

## 10. Distribution and growth

- **SEO pages:** per-model, per-provider, "best free X", and roundup pages (§3).
- **One-off launch** at the end of Phase 2:
  - Reddit: r/LocalLLaMA, r/CLine, r/SideProject
  - Show HN
  - The owner posts manually, about 1 hour. It's written as a launch/feedback post, not an ad.
- **Awesome-list:** the repo `README.md` is regenerated from the data after each change, as "Awesome free AI models & tiers (auto-updated)" with a link to the site. This brings GitHub stars, backlinks and discovery.
- **RSS/Atom:** feeds for all events, per category, and high-impact only.
- **Weekly email newsletter:** the roundup, sent automatically from the roundup RSS feed by an RSS-to-email feature, so it takes no extra work. Provider still to be chosen: it needs a free tier that includes RSS-to-email (check Buttondown and MailerLite).
- **Public JSON feed:** static files generated on each build (`/api/resources.json`, `/api/events.json`, per category). Free to serve, cacheable, and model-admin could use it later if wanted.

---

## 11. Sponsor slot (monetisation)

The site gets a sponsor slot from Phase 1, filled with a house ad until there is a sponsor.

**Placements**
- One slot in the site header/sidebar, and one on model/provider pages.
- One slot in the weekly newsletter and the roundup post.
- Not in the JSON feed, RSS items or the awesome-list.

**Before a sponsor exists:** the slot shows "Subscribe to the weekly newsletter" and a "Sponsor this site" link to `/sponsor`.

**`/sponsor` page:** audience description, traffic and subscriber numbers (added once available), placements, contact. Pricing can stay "on request" at first.

**Rules (published on the methodology page)**
- Always labelled "Sponsor".
- Never affects rankings, badges, test results or event text.
- One sponsor at a time, as a text/logo card: no tracking scripts, no third-party ad networks.
- Sponsors must be relevant to developers.
- A sponsor whose product appears in the directory is still shown with honest badges.

**Implementation:** `data/sponsor.json` (active flag, name, logo, text, URL, start/end dates) is read by one shared Astro component. Changing the sponsor is a single-file commit.

**Hosting impact:** sponsorship is commercial use. Cloudflare Pages allows it; Vercel Hobby does not.

Paid accounts (personal alerts, wallet) stay possible later, but they are not planned.

---

## 12. Architecture

```
GitHub Actions (cron, one concurrency group so runs never overlap)
   │
   ▼
Source adapters ─► Normaliser ─► Fingerprint + diff ─► Events (template text)
 (API / page-change)                  │
                                      ▼
                  Commit changed JSON to main  ──►  high-impact? ─► GitHub issue
                  (only when something changed)
                                      │
                                      ▼
                    Cloudflare Pages build (git integration)
                                      │
                                      ▼
          Astro static site + JSON feed + RSS + regenerated README
                                      │
          Cloudflare Worker: suggest form (Turnstile) → GitHub issue

Weekly jobs: roundup LLM draft + Arena alias suggestions → PR → owner merges;
            offer/infra page-change watcher → issue
```

**Why git files instead of a database**
- The data is small: hundreds to low thousands of records.
- History, audit trail and rollback come free from git, and a public history helps trust.
- The PR/issue workflow replaces an admin UI and approval queue.
- Nothing to host, back up, or keep under a size limit.

The limits of this approach:
- Commits happen only on change.
- Test history is one rolling file that is rewritten daily. That's one small daily commit, which is acceptable.
- If accounts or dynamic features are ever needed, add Cloudflare D1 then.

**Schedules**

| Job | Frequency |
|---|---|
| AI catalogue fetch + diff | every 6 hours |
| Daily test requests | daily |
| Arena refresh + alias suggestions | weekly |
| Offer / infra page-change watcher | weekly |
| Infra page-change checks | weekly |
| Weekly roundup draft PR | Monday morning |

Pages rebuilds happen only when there are commits: roughly 1–5 per day.

**Stack:** TypeScript, npm, Astro, Cloudflare Pages, one small Cloudflare Worker for the form, and GitHub Actions. The **new repo is public** (recommended, see §22); secrets live in Actions only.

---

## 13. Data layout (in the repo)

```
data/
  resources/
    ai/openrouter.json        # current state of every model from this provider, sorted by id
    ai/groq.json
    ...
    infra/oracle.json         # curated records (Phase 3)
  events/2026-09.jsonl        # append-only, one event per line, one file per month
  tests/history.json          # rolling 30 days of daily test results
  benchmarks/arena.json       # latest Arena ratings only (Phase 2)
  offers/ai/cerebras.json     # curated provider offers: credits, trials, quota pools (Phase 2)
  aliases.json                # provider model id → Arena model name, confirmed flag
  sources.json                # per source: last_checked, last_success, consecutive_failures, page_hash
  sponsor.json
```

**Resource record fields**
- identity: id, slug, name, provider, category, resource_type, url
- pricing and terms: price_type, price_input, price_output, context_length, modalities, tool_calling, rate_limits, limit_scope, usage_terms, licence, card_required, account_required, region, expires_at
- status: agent_ready, status (active / pending_removal / removed), first_seen, last_seen, removed_at, fingerprint

**Event fields:** id, resource_id, detected_at, event_type (NEW / CHANGED / REMOVED / RETURNED / TIER_CUT / TIER_RAISE), field, old_value, new_value, impact_score, source_url, text

**Change-detection rules**
- **Fingerprint unchanged → no write.** `last_seen` is only updated in memory; it's written when the record changes anyway, or once per day at most.
- **Pending removal:** a model must be missing for 2 consecutive runs (≥ 12 h) before a REMOVED event. This avoids false alarms when free capacity flaps.
- **Failed source ≠ mass removal:** if an adapter fails, skip its diff entirely and record the failure in `sources.json`. After 3 consecutive failures, open a GitHub issue. This lesson comes from model-admin's `discovery.ts`.
- Diff on `provider|model_id`, never on the model id alone.

---

## 14. Scoring

A relevance score (0–100) is used for **sorting, rankings and the high-impact label** only. It is not a monetary value. The inputs are published on the methodology page.

| Input | Notes |
|---|---|
| event severity | NEW free / TIER_CUT / REMOVED rank higher than small changes |
| benchmark strength | Arena text/webdev/agent rating, normalised, where available (Phase 2) |
| usability | rate limits and their scope, test history, context |
| terms friendliness | production-ok, no card, no phone verification |
| rarity | how many comparable free options exist |
| urgency | known expiry or promo end |

---

## 15. Automation rules

The site does NOT:
- bypass CAPTCHAs
- create fake or multiple accounts
- circumvent rate limits
- exploit promotions
- bypass geo-restrictions
- auto-claim rewards
- auto-accept terms
- scrape sources where automated access is prohibited

Also:
- Tests use one owner account per provider and stay well within its free limits.
- Page-change detection fetches official pages at most weekly, respects robots.txt, and stores only a hash plus the extracted fields, not the full HTML.
- Source priority: official API → official machine-readable file → RSS → official docs → other permitted pages → search (discovery only).

---

## 16. Reuse from solo_developer (copy, stay separate)

The code is **copied and adapted**. model-admin stays unchanged and does not depend on this project.

| From `solo_developer` | Reuse for |
|---|---|
| `packages/model-rotation/src/discovery.ts`: fetchers for OpenRouter, Gemini, Groq, NVIDIA; `provider\|id` diff; "only attribute removals to providers fetched this run" | Phase 1 adapters and diff logic |
| `packages/model-rotation/src/candidates.ts` | Filter for which models count as usable text models |
| `packages/model-rotation/src/providers.ts` (`EVALUATION_ONLY_PROVIDERS`) | `usage_terms` badge |
| `packages/model-rotation/src/probe.ts`, `classify-error.ts` | Daily test + error classification |
| `speech-discovery.ts`, `tts-discovery.ts`, `stt-eval.ts` | Speech APIs (Phase 2b, if there's demand) |
| Tests next to each module | Port together with the code |

**Not reused:**
- the Supabase schema and the shared database (it hit its 500 MB limit on 26 Sep 2026)
- the evaluator and judge panel
- Vercel crons
- the alerts module (GitHub issues replace it)

---

## 17. Research notes: verification status (28 Sep 2026)

| Claim in v0 | Status |
|---|---|
| OpenRouter free: ~20 RPM / 50 RPD, 1,000 RPD after $10 credit | ✅ Confirmed (OpenRouter docs/FAQ) |
| Oracle Ampere A1 halved to 2 OCPU / 12 GB (1,500 OCPU-h, 9,000 GB-h) | ✅ Confirmed (Oracle docs; InfoQ Jul 2026; effective 15 Jun 2026) |
| BenchLM machine-readable JSON | ✅ Exists, but ❌ **CC BY-NC 4.0**: commercial use needs a licence. Replaced by the LMArena dataset (CC-BY-4.0) |
| NVIDIA NIM "permanent free endpoints" | ❌ **Misleading.** Free but **evaluation-only, not production** (NVIDIA API Trial ToS) |
| Cerebras ~1M tokens/day free tier | ❌ **Outdated.** Now a one-time **$5 trial credit that expires after 30 days** (Cerebras rate-limits docs) |
| SambaNova free tier | ✅ Exists when no payment method is linked, but small: most models **20 RPD / 200k tokens/day**; MiniMax 60 RPM / 12,000 RPD (SambaNova docs) |
| GitHub Models | ❌ **Retired 30 July 2026** (GitHub Docs) |
| Hugging Face $0.10/month | ✅ Confirmed ($2.00/month for PRO) |
| Cloudflare Workers AI 10k Neurons/day | ✅ Confirmed (Cloudflare pricing docs), shared across all models; some models are excluded from the free plan |
| Mistral free tier | ⚠ "Experiment" tier: no card, phone verification, described as evaluation/prototyping; free-plan data may be used for training. Terms to be read before labelling |
| Gemini free-tier limits, Groq numbers, AWS $200 credits / Sep 2026 Builder Experience | ⚠ Not verified; each adapter must source these from official pages when built |
| Competitor list (ClawLabs, freellm.net, modelgrep, etc.) | ⚠ Not verified; review before launch copy |
| New competitor: `mnfst/awesome-free-llm-apis` (GitHub) | Found 28 Sep 2026: a well-kept list with live-request checks and detailed footnotes. Differentiate on change history, daily tests over time, and the site's filters |

The competitive position still holds: most free-model sites show only a snapshot of what's free now. **Event history, daily tests, honest terms badges and a public, auditable data repo** set this site apart. For breadth of free dev tiers, free-for.dev is the reference we link to, not compete with.

---

## 18. Phase 0 and MVP plan

**Phase 0 — setup (1 session)**
- Create the new public GitHub repo and connect a Cloudflare Pages project to it.
- The owner adds the provider API keys as Actions secrets; Claude never handles keys.
- Top up the OpenRouter account with $10 so the daily tests fit in the limit.
- Check free-tier limits: Cloudflare Pages builds/month, Workers, and Actions minutes (unlimited for public repos).
- Check domain availability for "FreeTier Radar" (freetierradar.com / .dev).

**Phase 1 — MVP (private use for 2–4 weeks)**

*Status 28 Sep 2026:* items 1–8 are built locally (pipeline + 35 tests, site, workflows). The site is not deployed yet: that waits on Phase 0. See `CLAUDE.md` for the code layout.

1. Port the OpenRouter, Groq, Gemini and NVIDIA adapters and the diff logic, with tests.
2. JSON data layout, fingerprinting, pending-removal logic and source-failure issues.
3. Daily test request.
4. Derive the agent-ready tag, including the rate-limit caveat.
5. Build the Astro site: directory, change feed, per-model pages, per-provider pages, methodology page.
6. Sponsor component with the house ad, and the `/sponsor` page.
7. RSS, the JSON feed and the regenerated README awesome-list.
8. Template event text and high-impact issues.
9. The owner uses it daily in place of the manual OpenRouter check.

**Phase 1 exit criteria**
- The pipeline ran 14 days in a row without manual fixes.
- No false REMOVED events caused by flapping.
- The owner stopped the manual daily check.
- At least 5 genuinely useful discoveries.

**Phase 2:** see §18a.

**Phase 3:** infra watchlist.

---

## 18a. Phase 2 plan (researched 28 Sep 2026)

Phase 2 as first planned no longer holds:
- Cerebras is now a 30-day trial.
- GitHub Models has been retired.
- BenchLM can't be used on a sponsored site.

This plan replaces it.

### New concept: provider offers

Several providers don't offer free *models*: they offer a free *budget*. Examples:
- Cerebras: $5 of credit for 30 days
- Hugging Face: $0.10/month in credits
- Cloudflare Workers AI: 10k Neurons/day, shared across all models
- Mistral: the Experiment tier

These don't fit one-record-per-model, so they become **offer** records.

- Stored as curated JSON in `data/offers/ai/<provider>.json`, written by the owner.
- Fields:
  - identity: id, provider, name, offer_type (`recurring-quota` / `trial-credit` / `retired`), amount, reset period, expiry
  - terms: usage_terms, card_required, account_required (including phone verification), data_logging
  - `watch_url` and `verified_on`
- **Page-change watcher:** once a week, fetch each `watch_url`, extract the main text, and compare its hash with the last one. On a change, open an issue with a short excerpt of the diff. The owner updates the JSON or closes the issue. Only the hash and date are stored.
- The same mechanism is reused unchanged for the Phase 3 infra watchlist, so Phase 3 becomes mostly data entry.
- Changes to offer JSON (by the owner) go through the same diff and produce events.
- Retired offers stay listed with a `retired` badge, e.g. "GitHub Models: retired 30 Jul 2026". Good roundup and SEO content.

### Providers

| Provider | Free offer (checked 28 Sep 2026) | How | Label | Needs |
|---|---|---|---|---|
| **SambaNova** | Free tier with no payment method; most models 20 RPD / 200k TPD, MiniMax 60 RPM / 12k RPD | Model-list adapter + daily test | production terms to read | owner key |
| **Mistral** | Experiment tier: no card, phone verification, ~1B tokens/month reported, evaluation/prototyping | Model-list adapter + daily test; offer record for the tier | probably eval-only + may-train (read terms first) | owner key |
| **Cloudflare Workers AI** | 10k Neurons/day shared; some models excluded from free | Model-list adapter (`/ai/models/search`, account id + token); exclusions from the pricing page, curated | shared quota | owner token |
| **Kilo Code gateway** | Free pool, no key, 200 req/hour per IP; may log prompts | Model-list adapter + daily test, keyless | 👁 logs prompts | nothing |
| **LLM7.io** | Anonymous access; rotating catalogue | Model-list adapter + daily test, keyless | 👁 logs prompts (verify) | nothing |
| **OVHcloud AI Endpoints** | Anonymous tier, 2 RPM per IP per model, EU-hosted | Model-list adapter + daily test, keyless | verify terms | nothing |
| **Cerebras** | $5 trial credit, expires after 30 days | Offer record only | CREDIT | nothing |
| **Hugging Face** | $0.10/month credits | Offer record only | CREDIT | nothing |
| **GitHub Models** | Retired 30 Jul 2026 | Offer record, `retired` | RETIRED | nothing |

- **Keyless providers:** verify each one's API, terms and logging statement before adding it. The test for these runs without a key, from GitHub Actions' IP.
- **New label `data_logging`:** badge "👁 Logs prompts", plus a filter "Hide providers that log prompts".

### Rankings (our own data first)

Ranking pages work without benchmark scores. Arena ratings refine them where available.

- **Best free models for coding agents:** agent-ready first; then Arena webdev/agent rating (if any), test reliability over 30 days, context, and limits.
- **Most reliable free models:** share of days they responded over 30 days, then median latency.
- **Best free vision models** and **best free long-context models:** filtered by the respective field, same ordering.

The formula is published on the methodology page. Each ranking is one static page, regenerated on build.

### Weekly roundup + newsletter

- **Monday job:**
  1. Collect the week's events.
  2. Ask a free, production-ok model (Groq or an OpenRouter free model) for a short intro and highlights. The prompt lists the facts, and the model may only rephrase them.
  3. Write `content/roundups/YYYY-WW.md`.
  4. Open a PR.
- The owner edits and merges. The site then publishes `/roundups/…`, and the roundup RSS feed updates.
- The newsletter tool sends the roundup RSS as email: nothing to send by hand.
- If the LLM call fails, the PR still opens with a template-only draft.

### Suggestions

A GitHub issue form (`.github/ISSUE_TEMPLATE/suggest-resource.yml`) with fields for name, URL, category and why it's useful. It's linked from the site. There's no web form or Worker unless people ask for one.

### Order of work

**Status 28 Sep 2026:**
- Built and live: offers + page watcher, rankings, roundup generator + pages/RSS, issue form.
- Pulled forward: **TTS and STT models** (Groq, Gemini, OpenRouter hand-listed voices) with their own daily tests.
- Arena ratings live: 4 leaderboards, 34 models linked automatically on 28 Sep, near matches via a weekly review PR.
- Keyless providers live: Kilo Code gateway (15 free models) and LLM7.io (3), tested anonymously, with a per-model data-use label. OVHcloud listed as a free-credits entry instead: its per-IP anonymous limit can't be tested reliably from shared CI servers.
- Chinese providers (28 Sep): Z.ai's three free GLM Flash models get an adapter (waiting on the owner's `ZAI_API_KEY`); SiliconFlow and ModelScope are free-credits entries because both require real-name verification (ModelScope is also non-commercial). Most Chinese models are already tracked through OpenRouter, Kilo, NVIDIA, Groq and LLM7.
- Cloudflare Workers AI added (28 Sep, owner's token): 25 free-plan models incl. 10 image models (FLUX, Stable Diffusion), each with a free-per-day estimate; image tests run weekly. No free video generation API exists (only trials); Gemini image/Veo have a free limit of 0.
- **Phase 2a is complete.** Next: 2b (SambaNova, Mistral, Cloudflare Workers AI adapters; needs keys) and 2c (launch).

**2a — no keys needed; can be built before Phase 0**
1. Offer records + page-change watcher.
2. First offers: Cerebras, Hugging Face, Cloudflare quota, GitHub Models (retired).
3. `data_logging` field and badge; keyless adapters (Kilo, LLM7, OVHcloud), each after checking its terms.
4. Arena adapter + aliases + weekly alias-suggestion PR.
5. Ranking pages.
6. Roundup generator + roundup pages/RSS.
7. Issue form.

**2b — needs the owner's keys**
- SambaNova, Mistral and Cloudflare Workers AI adapters.
- The first real roundup.

**2c — launch**, once there are ≥ 14 days of test history (so agent-ready tags exist):
- newsletter provider set up
- launch posts on Reddit and Hacker News

**Later, if there's demand:** image, speech and embedding models as their own categories (speech code exists in model-admin).

---

## 19. Success criteria

- **30 days after public launch**
  - Pipeline uptime ≥ 95%.
  - Owner time ≤ 4 h/week.
  - Pages indexed; first organic visitors.
  - GitHub stars and newsletter subscribers growing.
- **90 days**
  - The owner uses the site for model choices in their own apps and in Cline.
  - Organic traffic keeps growing.
  - Enough traffic/subscribers to approach a first sponsor (e.g. ≥ 500 newsletter subscribers or ≥ 5k monthly visitors, to be tuned).

---

## 20. Risks

| Risk | Mitigation |
|---|---|
| Free models flap in and out | Pending-removal rule + test history |
| Terms/licence data incomplete | "Unknown" is shown explicitly; eval-only badge; methodology page |
| Owner time runs out | Templates for all events; only the weekly roundup needs review; admin through the GitHub app |
| Test-request budget exhausted | $10 OpenRouter top-up; one tiny request per model per day |
| Scope creep | Infra capped at a ~15–20-item watchlist; free-for.dev for breadth; strict phase gates |
| SEO slow / thin pages | Launch posts + awesome-list; merge near-duplicate model pages; publish only complete pages |
| Benchmark licences | Only CC-BY data (Arena) with attribution; BenchLM and Artificial Analysis need a licence |
| Keyless gateways log prompts | 👁 badge and filter; methodology page explains it |
| Sponsor damages trust | Published sponsor rules; no influence on data; clear labelling |
| Repo commit noise | Commit only on change; one rolling daily test-history file |

---

## 21. Out of scope (parked)

- User accounts, personal alerts, resource wallet, paid tier
- BenchLM and Artificial Analysis scores (both need a commercial licence)
- Automated agent tests of models (an actual Cline-style task)
- A web form for suggestions (the GitHub issue form comes first)
- Datasets, grants, hackathons, startup programmes (unless submissions show demand)
- Social media auto-posting

---

## 22. Open decisions

1. Domain for FreeTier Radar.
2. Newsletter provider: needs a free tier with RSS-to-email.
3. Public repo (recommended: transparency, contributions, free Actions minutes) or private.
4. Which free, production-ok LLM writes the weekly roundup draft (Groq or an OpenRouter free model).
5. The exact list for the infra watchlist (Phase 3).
6. Usage terms for Mistral's Experiment tier and SambaNova's free tier, and the logging and terms statements of the keyless providers (Kilo, LLM7, OVHcloud). To read before each is added.
