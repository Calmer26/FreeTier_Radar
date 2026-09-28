# Digital Resource Miner

**Status:** Concept / MVP requirements  
**Date:** 28 September 2026 (updated — additional AI sources + benchmark enrichment)

---

## 1. Product idea

Build a small scheduled bot that discovers free or unusually valuable digital resources and tells the user when something genuinely useful appears.

The user’s existing example is a daily Grok check for free AI models on OpenRouter. The product generalises that task.

> **Continuously detect when useful digital resources become free, cheaper, more capable, or newly usable, then surface only the changes that matter to you—before they disappear or you miss them.**

The bot stores **changes and opportunities**, not copies of websites or high-frequency observations.

**Core product principle**  
Do not build a database of free things.  
Build a **change detector** for useful free resources.

The raw information is often already public.  
The value is in:

```
continuous monitoring
        +
change detection
        +
filtering
        +
relevance
        +
actionable explanation
```

That is what turns an existing public information source into a useful product.

---

## 2. What counts as a resource?

### AI
- Free OpenRouter models
- Free Gemini API capacity
- Free Groq models/API quotas
- Cloudflare Workers AI free capacity
- Hugging Face inference credits
- NVIDIA NIM free endpoints
- Cerebras free tier
- SambaNova Cloud free tier
- Mistral free mode / credits
- Cohere trial keys
- Pollinations AI (anonymous)
- Other low-friction free gateways (LLM7.io, etc.)
- Free image, speech, embedding and vision APIs
- Newly released open-weight models with useful licences

### Compute and cloud
- Free cloud credits
- Always-free compute
- Free serverless execution
- Free GPU/CPU programmes
- Free storage
- Free databases
- Free CDN and networking quotas

### Developer infrastructure
- Free API tiers
- Free monitoring/logging
- Free email/SMS quotas
- Free vector databases
- Free queues and object storage
- Free developer tools
- Temporary Pro/free trials

### Data
- New public datasets
- New free APIs
- Government/open-data releases
- Satellite/geospatial data
- Scientific datasets
- New data feeds

### Opportunities
- Startup programmes
- Developer programmes
- Hackathons with prizes
- Grants
- Free software licences
- Promotional credits

---

## 3. Current research findings (updated 27–28 Sep 2026)

These are the most interesting sources identified for the first version. They are examples of resources to monitor, not guarantees that every resource remains free.

### 3.1 OpenRouter
OpenRouter has an explicit Free Models collection and a public models API. As of late September 2026 the free roster (`:free` suffix, $0 prompt/completion) still contains multiple capable models (examples: NVIDIA Nemotron 3 Ultra with 1M context, Gemma 4 variants, Qwen3.8 27B, inclusionAI Ling models, etc.). The free-model population rotates as providers add or remove capacity.

**Typical free rate limits:** ~20 RPM / 50 RPD (rising to 1,000 RPD after a one-time $10 credit purchase).

**Useful signals to monitor:**
- model enters free tier
- model leaves free tier
- input/output price becomes $0
- context window changes
- modalities change
- tool/function calling appears
- provider changes
- model licence changes
- free-model popularity / capacity changes

**Source:** https://openrouter.ai/collections/free-models (and public `/api/v1/models` endpoint)

**Priority:** VERY HIGH  
This is the first source to implement because it directly matches the user’s existing daily task and is highly automatable via the public API.

### 3.2 Google Gemini API
Google documents free usage and model-specific limits (RPM, TPM, RPD). Exact public numbers are less cleanly tabulated than previously; many limits are visible primarily inside AI Studio per project. Experimental and preview models remain more restricted. Free tier still exists and is useful for prototyping.

**Useful signals:**
- new model enters free tier
- RPD/RPM/TPM changes
- new modality becomes available
- model is promoted from preview
- model is retired

**Source:** https://ai.google.dev/gemini-api/docs/rate-limits

**Priority:** HIGH  
Record quota values as structured fields instead of storing documentation pages.

### 3.3 Groq
Groq publishes model-specific free-plan limits (RPM, RPD, TPM, TPD). Current free models include various gpt-oss and Qwen variants with clear structured numbers (e.g. ~30 RPM / 1K RPD / 8K TPM on several text models).

**Useful signals:**
- new model
- model removed
- RPD/TPM change
- new speech or multimodal capability

**Source:** https://console.groq.com/docs/rate-limits

**Priority:** HIGH  
Especially suitable because rate limits are already structured and easy to compare.

### 3.4 Cloudflare Workers AI
Cloudflare currently gives the Workers Free plan a daily free allocation (commonly referenced as 10,000 Neurons per day, or equivalent token-based limits in newer pricing language). Limits reset daily. Model availability on the free tier has changed in the past.

**Useful signals:**
- model added to / removed from free plan
- free allocation changes
- model pricing changes

**Sources:**
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/changelog/product/workers-ai/

**Priority:** HIGH

### 3.5 Hugging Face Inference Providers
Free users currently receive $0.10/month of Inference Provider credits (subject to change). The platform provides a unified API over multiple inference providers.

**Useful signals:**
- new provider
- new free model/provider combination
- credit changes
- model licence changes
- new inference modality

**Sources:**
- https://huggingface.co/docs/inference-providers/pricing
- https://huggingface.co/docs/inference-providers/index

**Priority:** MEDIUM-HIGH  
The small monetary value makes this less important than OpenRouter, but useful as part of a wider AI resource radar.

### 3.6 NVIDIA NIM
NVIDIA offers permanent free endpoints for many strong models (Nemotron family, Gemma 4, GLM, Kimi, etc.) via the NVIDIA Developer Program. Typical published free-tier ceiling is around 40 RPM shared site-wide.

**Useful signals:**
- model added to / removed from free endpoints
- rate-limit changes
- new multimodal or tool-capable free models

**Source:** https://build.nvidia.com (and integrate.api.nvidia.com)

**Priority:** HIGH  
Large, high-quality free models. Phone verification required for the Developer Program account. Model list changes over time.

### 3.7 Cerebras
Cerebras provides a generous free tier on its ultra-fast inference hardware (often reported around 1M tokens/day). Model roster rotates; context is sometimes capped on the free tier.

**Priority:** HIGH for high-volume prototyping once the core AI radar is live.

### 3.8 SambaNova Cloud
Permanent free tier with rate limits (commonly cited figures around 200k tokens/day and 20 RPM). No credit card required for the free tier.

**Priority:** MEDIUM-HIGH

### 3.9 Other notable free AI sources (lower priority / selective)
- **Mistral** — Free mode / monthly credits, no card in recent checks.
- **Cohere** — Trial keys with monthly call limits.
- **Pollinations AI** — Anonymous free text (and other modalities), no key required; rotating models; lower reliability but zero friction.
- **LLM7.io**, **OVHcloud AI Endpoints**, **GitHub Models**, **Ollama Cloud**, **OpenCode Zen** (promo free), **ModelScope**, **FreeInference.org** — Useful in niches (anonymous access, research, region-specific models, coding agents). Monitor selectively only if they produce repeated high-value changes.

**Note:** Many of these models also appear in OpenRouter’s free pool. Direct monitoring still adds value through better rate-limit data, availability signals, and licence notes.

### 3.10 Oracle Cloud Always Free
Oracle has a substantial Always Free offering. As of mid-2026 the Ampere A1 allocation was **halved** (to the equivalent of 2 OCPU + 12 GB RAM total). Current documentation includes:

- up to two AMD micro VMs
- 1,500 OCPU hours/month and 9,000 GB hours/month for Ampere A1 (≈ 2 OCPUs + 12 GB RAM when allocated together)
- 200 GB combined block volume
- 20 GB object storage
- two Always Free Autonomous AI Databases
- Always Free NoSQL allocation
- 50 GB MySQL HeatWave storage
- 3,000 free emails/month
- 10 TB/month outbound data transfer

**Source:** https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

**Priority:** HIGH for personal resource accumulation  
This is a particularly good example of a high-value resource that changes relatively slowly. Weekly or monthly checks are sufficient. The June 2026 reduction demonstrates why monitoring matters.

### 3.11 AWS Free Tier
AWS currently offers new customers up to $200 in credits ($100 immediate + up to $100 more via activities). The Free plan provides a 6-month window plus access to selected free services; more than 30 services remain always free within monthly limits. A new builder-oriented signup experience was introduced in September 2026.

**Sources:**
- https://aws.amazon.com/free/
- https://aws.amazon.com/about-aws/whats-new/2026/09/New-AWS-Builder-Experience/

**Priority:** MEDIUM  
Much of the offer is account-specific. The bot should monitor the programme rather than attempt to claim credits automatically.

---

## 4. The important distinction: free does not mean usable

Every resource should be classified along several independent dimensions:

| Dimension              | Possible values                  |
|------------------------|----------------------------------|
| price                  | $0 / paid / unknown              |
| commercial_use         | yes / no / unknown               |
| license                | specific licence / unknown       |
| credit_card_required   | yes / no / unknown               |
| account_required       | yes / no                         |
| api_available          | yes / no                         |
| automation_allowed     | yes / no / unknown               |
| expires                | date / never / unknown           |
| region                 | global / EU / specific / unknown |

A model being free through an API does not automatically mean that its licence permits commercial use.  
A cloud credit being advertised does not mean that it can be claimed repeatedly.  
A free tier being available does not mean that automated account creation or claiming is permitted.

The product therefore avoids a single simplistic “value” label.

---

## 5. Recommended architecture

```
                    +-------------------+
                    | Scheduled trigger |
                    +---------+---------+
                              |
                              v
                    +-------------------+
                    | Source adapters    |
                    | OpenRouter         |
                    | Gemini             |
                    | Groq               |
                    | Cloudflare         |
                    | Hugging Face       |
                    | Cloud providers    |
                    +---------+---------+
                              |
                              v
                    +-------------------+
                    | Normaliser         |
                    +---------+---------+
                              |
                              v
                    +-------------------+
                    | Change detector    |
                    +---------+---------+
                              |
                    +---------+---------+
                    |                   |
                 no change          changed
                    |                   |
                  discard               v
                              +-------------------+
                              | Classify + score  |
                              +---------+---------+
                                        |
                              +---------+---------+
                              |                   |
                              v                   v
                       Compact database       Daily digest
                                              (+ optional news layer)
```

A continuously running server is unnecessary for the MVP.  
A scheduled job once or several times per day is enough.

---

## 6. Database design

Keep the database small.

**resources**
- id
- name
- provider
- category
- resource_type
- url
- price
- currency
- commercial_use
- license
- credit_card_required
- account_required
- api_available
- automation_allowed
- region
- expires_at
- first_seen
- last_seen
- status
- current_fingerprint

**resource_events**
- id
- resource_id
- detected_at
- event_type
- old_value
- new_value
- source_url
- news_context (optional link / short factual summary)

**sources**
- id
- name
- url
- access_method
- check_frequency
- last_checked
- last_success
- parser_version

**user_preferences**
- category
- priority
- commercial_required
- no_credit_card_required
- minimum_estimated_value

Do not store full HTML by default.  
Do not store every API response.  
Do not store repeated snapshots when nothing changed.

---

## 7. Change detection

Each source should be converted into a canonical record.

Example:

```json
{
  "provider": "OpenRouter",
  "model": "example-model",
  "input_price": 0,
  "output_price": 0,
  "context": 128000,
  "modalities": ["text", "image"],
  "tools": true,
  "license": "Apache-2.0"
}
```

Generate a fingerprint from the canonical representation.

- If fingerprint is unchanged → **NO DATABASE WRITE**
- If it changes → calculate diff, store event, update current resource

This is the key mechanism that keeps the project tiny.

Distinguish soft vs hard changes where possible (temporary capacity blip vs permanent removal or major capability jump).

---

## 8. Resource scoring

Do not create a fake financial valuation.  
Use a simple relevance score to decide what to show the user.

**Suggested dimensions (0–5):**
- personal_relevance
- resource_value
- rarity
- expiry_urgency
- commercial_relevance
- confidence
- usability (rate limits, reliability signals)
- benchmark_strength (overall / coding / agentic / reasoning where available)

Example (OpenRouter free model):

| Dimension            | Score |
|----------------------|-------|
| personal_relevance   | 5     |
| resource_value       | 4     |
| rarity               | 3     |
| urgency              | 1     |
| commercial           | 4     |
| confidence           | 5     |
| usability            | 3     |
| benchmark_strength   | 4     |

The score is for sorting, not a claim about monetary value. Dimensions should be user-tunable via preferences.

---

## 8.1 Benchmark enrichment (added)

The miner itself does **not** run expensive original benchmarks. Instead it enriches discovered free models with public, machine-readable scores so users can quickly judge usefulness.

**When a free model is detected (especially NEW):**
1. Look up available public scores.
2. Attach key metrics to the resource record.
3. Feed them into the relevance score.
4. Surface them in the daily digest.

**Preferred public sources (as of late Sep 2026):**
- **BenchLM.ai** — overall + category scores (coding, agentic, reasoning…), evidence labels (Supported / Estimated), pricing and runtime; machine-readable JSON.
- **LMArena / Chatbot Arena** — human preference Elo.
- **Artificial Analysis** — Intelligence Index + speed/latency.
- **LiveBench** — contamination-resistant scores.
- Community free-model rankings that already combine Arena and other signals for the free pool.

**Database fields (optional on resource or event):**
- benchmark_source
- benchmark_score
- benchmark_categories (JSON)
- benchmark_updated_at
- evidence_level

**Digest guidance:**  
Always attribute the source. Note when a score is estimated or older. For brand-new free models that lack scores yet, simply state “benchmark data not yet available” and rely on other signals (context, tools, rate limits, licence).

This keeps the core product light while making the “why it matters” explanation far more useful.

---

## 9. Daily output

The first user interface can simply be a daily digest.

**Example:**

```
DIGITAL RESOURCE MINER
28 September 2026

3 useful changes

1. NEW FREE MODEL
NVIDIA Nemotron 3 Ultra
OpenRouter
$0 input / $0 output
Context: 1M
Tools: yes
Benchmark context: Strong open-weight ranking in recent public leaderboards (coding & agents)
Potential use: coding / agents
Restrictions: ~20 RPM / 50 RPD (higher after $10 spend)
Action: Try now via OpenRouter

2. FREE INFRASTRUCTURE
Oracle Cloud Always Free
2 OCPU / 12 GB equivalent Ampere allocation (reduced from prior higher figure)
Potential use: always-on small services
Action: Review current allocation if already claimed

3. API CHANGE
Provider X
Free quota increased
500 → 2,000 requests/day
Potential use: small production API
```

The digest should answer:
1. What changed?
2. Why does it matter?
3. What can I do with it?
4. What restrictions apply?
5. Is action needed now?

---

## 10. Personal resource wallet

A second (high-leverage) feature tracks resources that the user has actually acquired or can use.

```
MY DIGITAL RESOURCE WALLET

AI
12 free models

API
4 free API quotas

COMPUTE
€200 estimated credits

DATABASE
3 free database services

STORAGE
80 GB free allocations

DATA
17 useful datasets
```

This is more useful than a generic deals list because the system can answer:

> “What free resources do I already have available for my next project?”

Later extensions: expiry alerts, remaining-quota estimates (where known), simple usage suggestions, claim links.

---

## 11. Competitive landscape (added)

The space is active but fragmented. Most tools focus narrowly on free LLM APIs / models. Almost none combine structured multi-category change detection, personal relevance scoring, a resource wallet, and actionable digests.

### Main free-AI-model trackers
- **ClawLabs free-ai-models** — daily auto-updated ranked list (mainly OpenRouter), quality scores, live status.
- **freellm.net** — large searchable directory (500+ models), live verification claims, config generators, key vault.
- **modelgrep / freeinference.dev / lmmarketcap free lists** — ranked tables with filters or intelligence scores.
- Multiple **awesome-* GitHub lists** — curated channel-first or BYOK free-tier lists.
- **pricepertoken.com** and similar — pricing-focused with free-tier pages.
- Provider own pages (OpenRouter collections, Groq docs, etc.).

### Broader free-tier / cloud trackers
Mostly static comparison tables or infrequently updated blog posts (cloudpricecheck, various “always free VPS” round-ups). Few perform automated change detection or track the full usability dimensions (licence, card requirement, automation-friendliness, expiry).

### White space this product occupies
- Stateful change detection + event history (most competitors show “what is free right now”).
- Cross-category radar (AI + compute + storage + data + programmes).
- Personal relevance + wallet (“what free capacity do I already control?”).
- Actionable explanation layer + orthogonal usability classification.

This is a real differentiation. Existing free-model lists validate demand for the OpenRouter MVP but leave clear room for a deeper product.

---

## 12. News / context layer (added)

News of new free models, capacity changes, tier cuts, or programme launches drives search traffic and social shares.

**Approach:** Treat news as a **secondary, tightly coupled layer**, not the core product.

- Primary database and digests remain focused on structured resource events (NEW / CHANGED / REMOVED + classification fields).
- For high-value events only, attach optional news context: official announcement link + short factual summary of the resource impact.
- Use the news layer for public free digests, SEO content, and social amplification.
- Do **not** turn the product into a general AI news aggregator. Filter ruthlessly: only news that creates, removes, or materially changes a trackable free/valuable digital resource.

This keeps the product pure while providing a natural traffic engine.

---

## 13. Monetisation

Do not start by trying to sell the information.  
First prove that the bot consistently finds useful things.

**Possible later models:**
- **Free** — Daily public digest.
- **Personalised** — €3–5/month for alerts matching a user’s interests.
- **Developer** — €8/month for advanced filters and API access.
- **Affiliate** — Referral revenue where a provider has an appropriate programme (disclosed).
- **B2B** — Narrow feeds for developers, startups, agencies or procurement teams.

Initial arithmetic targets (not forecasts):
- 10 users × €3/month = €30/month ≈ €1/day
- 100 users × €3/month = €300/month ≈ €10/day

---

## 14. Automation rules

The miner may automatically discover and compare publicly available information where permitted.

It should **NOT**:
- bypass CAPTCHAs
- create fake or multiple accounts
- circumvent rate limits
- exploit promotional systems
- bypass geographic restrictions
- claim rewards that require human verification
- accept contractual terms automatically
- scrape a source where the intended automated access is prohibited

For actions requiring a human, the bot should provide a Claim link and explain what is required.

---

## 15. Source priority

Use sources in this order:
1. Official APIs
2. Official machine-readable endpoints
3. Official RSS/Atom feeds
4. Official documentation/pricing pages
5. Public pages where automated access is permitted
6. Search as a discovery mechanism only

Search engines should help discover sources. They should not become the primary data store.

---

## 16. MVP plan

### MVP 1: OpenRouter Free Model Watcher
Build only this first.

**Daily process**
1. Fetch the current free-model catalogue (prefer public models API, filter pricing = 0).
2. Normalise model metadata.
3. Compare against stored state.
4. Detect additions, removals and important changes.
5. Store only events.
6. Generate a daily digest.
7. Filter against the user’s preferences.

**Output**  
NEW / CHANGED / REMOVED  
For each model: name, provider, prices, context, modalities, tools, license, commercial-use status (if known), rate limits, URL, why it matters, restrictions, action.

### MVP 2: AI resource radar
Add in roughly this order:
- Groq
- Cloudflare Workers AI
- NVIDIA NIM
- Gemini
- Cerebras / SambaNova
- Hugging Face

Optionally begin pulling public benchmark scores (BenchLM, Arena, etc.) as enrichment.

### MVP 3: Infrastructure radar
Add Oracle Cloud, AWS, other free compute, databases, storage, serverless.

### MVP 4: General digital resource radar
Add APIs, datasets, developer programmes, software licences, credits, useful promotions.

---

## 17. Suggested stack

- **Scheduler:** GitHub Actions or Cloudflare Workers Cron
- **Backend:** TypeScript
- **Database:** Supabase PostgreSQL
- **Frontend:** PWA (later)
- **Notifications:** email initially
- **Repository:** GitHub

A scheduled serverless job is preferable to a permanently running server.  
The database should be used for state and events, not as a web cache.

---

## 18. Success criteria

**After the first 30 days:**
- daily job runs reliably
- no manual data collection is required
- duplicate events are avoided
- database remains comfortably below free-tier limits
- at least several genuinely useful discoveries have been found
- false positives are low enough that the digest remains useful

**After 60–90 days:**
- identify the highest-value resource category
- measure useful discoveries per week that the user actually acts on
- determine which discoveries lead to actual use
- test whether other developers want the digest
- test whether personalised alerts have enough value for a small subscription

---

## 19. Risks and mitigations

- Free capacity (especially on OpenRouter) can be transient or capacity-constrained → require persistence or confidence thresholds; surface rate limits clearly.
- Licence / commercial-use data is often incomplete → treat “unknown” as a first-class state.
- Providers change free tiers without announcement (Oracle Ampere reduction is a recent example) → monitoring itself is the value.
- Scraping risk → prefer official APIs and machine-readable endpoints; respect robots/ToS.
- False positives / noise → soft vs hard change distinction; user preferences; scoring.
- Database growth → the design already avoids this; protect it.

---

## 20. Immediate next step

Start with OpenRouter because it is already a real recurring task for the user and is highly automatable.

Then expand the AI radar in this approximate order:
- Groq
- Cloudflare Workers AI
- NVIDIA NIM
- Gemini
- Cerebras / SambaNova
- Hugging Face

Afterwards add infrastructure sources (Oracle Always Free, AWS, etc.).

Do not add dozens of sources initially.  
The first goal is to prove that a tiny bot can discover useful changes automatically and produce a better daily result than a manual Grok search. Benchmark enrichment can be added once multiple free models are flowing through the system.

---

## 21. One-sentence thesis

> **Continuously detect when useful digital resources become free, cheaper, more capable, or newly usable, then surface only the changes that matter to you—before they disappear or you miss them.**
