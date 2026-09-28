# FreeTier Radar: awesome free AI models (auto-updated)

Free AI models for developers, tested daily. This list is regenerated from the data in
this repo every time something changes. The website adds filters, rate limits, the full
change history and ready-to-paste Cline settings.

- **Directory:** what's free right now
- **Changes:** what appeared, changed or disappeared (also as RSS)
- **Honest labels:** evaluation-only terms, shared rate limits, "unknown" when a provider doesn't say

## The list

<!-- LIST:START -->
_16 free chat models. Updated automatically; see [FreeTier Radar](https://freetierradar.com) for filters, limits and change history._

🟢 responded to the latest daily test · 🟡 rate-limited or slow · 🔴 failed · 🤖 agent-ready (tool calling, ≥64k context, answered 5 of the last 7 days)

### OpenRouter

Router over many inference providers. Models with a :free suffix cost nothing, within a daily request cap shared by all free models.

| Model | ID | Context | Tools | Last test | Agent |
|---|---|---|---|---|---|
| [Cohere: North Mini Code (free)](https://freetierradar.com/models/openrouter/cohere-north-mini-code-free/) | `cohere/north-mini-code:free` | 256k | yes | – |  |
| [Dots Studio: Dots3-Note Preview (free)](https://freetierradar.com/models/openrouter/dots-studio-dots-3-note-preview-free/) | `dots-studio/dots-3-note-preview:free` | 512k | yes | – |  |
| [Google: Gemma 4 26B A4B  (free)](https://freetierradar.com/models/openrouter/google-gemma-4-26b-a4b-it-free/) | `google/gemma-4-26b-a4b-it:free` | 262k | yes | – |  |
| [Google: Gemma 4 31B (free)](https://freetierradar.com/models/openrouter/google-gemma-4-31b-it-free/) | `google/gemma-4-31b-it:free` | 262k | yes | – |  |
| [inclusionAI: Ling 3.0 Flash Fin (free)](https://freetierradar.com/models/openrouter/inclusionai-ling-3-0-flash-fin-free/) | `inclusionai/ling-3.0-flash-fin:free` | 262k | yes | – |  |
| [inclusionAI: Ling 3.0 Flash Sante (free)](https://freetierradar.com/models/openrouter/inclusionai-ling-3-0-flash-sante-free/) | `inclusionai/ling-3.0-flash-sante:free` | 262k | yes | – |  |
| [LiquidAI: LFM2.5-2.6B (free)](https://freetierradar.com/models/openrouter/liquid-lfm-2-5-2-6b-free/) | `liquid/lfm-2.5-2.6b:free` | 66k | yes | – |  |
| [NVIDIA: Nemotron 3 Nano Omni (free)](https://freetierradar.com/models/openrouter/nvidia-nemotron-3-nano-omni-30b-a3b-reasoning-free/) | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 256k | yes | – |  |
| [NVIDIA: Nemotron 3 Super (free)](https://freetierradar.com/models/openrouter/nvidia-nemotron-3-super-120b-a12b-free/) | `nvidia/nemotron-3-super-120b-a12b:free` | 262k | yes | – |  |
| [NVIDIA: Nemotron 3 Ultra (free)](https://freetierradar.com/models/openrouter/nvidia-nemotron-3-ultra-550b-a55b-free/) | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1M | yes | – |  |
| [NVIDIA: Nemotron 3.5 Lightning (free)](https://freetierradar.com/models/openrouter/nvidia-nemotron-3-5-lightning-free/) | `nvidia/nemotron-3.5-lightning:free` | 1M | yes | – |  |
| [Poolside: Laguna S 2.1 (free)](https://freetierradar.com/models/openrouter/poolside-laguna-s-2-1-free/) | `poolside/laguna-s-2.1:free` | 262k | yes | – |  |
| [Poolside: Laguna XS 2.1 (free)](https://freetierradar.com/models/openrouter/poolside-laguna-xs-2-1-free/) | `poolside/laguna-xs-2.1:free` | 262k | yes | – |  |
| [Qwen: Qwen3.8 27B (free)](https://freetierradar.com/models/openrouter/qwen-qwen3-8-27b-free/) | `qwen/qwen3.8-27b:free` | 262k | yes | – |  |
| [Thinking Machines: Inkling (free)](https://freetierradar.com/models/openrouter/thinkingmachines-inkling-free/) | `thinkingmachines/inkling:free` | 1M | yes | – |  |
| [Thinking Machines: Inkling Small (free)](https://freetierradar.com/models/openrouter/thinkingmachines-inkling-small-free/) | `thinkingmachines/inkling-small:free` | 1M | yes | – |  |

<!-- LIST:END -->

## How it works

- **Every 6 hours:** each provider's official model list is fetched and compared with `data/`. Changes are committed as events in `data/events/`.
- **Daily:** one tiny test request per free model, stored in `data/tests/history.json` (rolling 30 days).
- **On every commit:** the Astro site is rebuilt on Cloudflare Pages.

Methodology, labels and the sponsor policy are on the website's methodology page.

## Development

```bash
npm install
npm test               # unit tests
npm run discover       # fetch providers and update data/ (keys optional; OpenRouter needs none)
npm run test-models    # daily test requests (needs provider keys)
npm run readme         # regenerate the list above
npm run dev            # site on http://localhost:4321
```

Provider keys go in environment variables (see `.env.example`); in GitHub they are Actions secrets.
