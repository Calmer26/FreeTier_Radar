/**
 * The daily test: one tiny request per free model, shaped by its kind.
 *
 *   chat  "Reply with the single word: OK", 16 tokens max. Any HTTP 200 counts, even
 *         with empty text: a reasoning model can spend 16 tokens thinking.
 *   tts   speak "OK"; responded when audio comes back.
 *   stt   transcribe fixtures/stt-sample.mp3 (18 s narration); responded when the
 *         transcript contains a word from its script.
 *   image generate a small picture; responded when an image comes back. Weekly, not
 *         daily (see run-tests.ts): image models use much more of a free allowance.
 *
 * Adapted from solo_developer's model-rotation `probe.ts`, `stt-eval.ts` and the tts
 * package (2026-09-28). The site shows the result as "responded at 06:10 UTC", not
 * as "available": one request a day proves the model was up, not that it is usable
 * at busy times.
 */

import { slotKey } from "./test-days";
import { wordErrorRate } from "./wer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SITE } from "../site.config";
import { baseUrl, PROVIDERS } from "./providers";
import type { RateLimits, Resource, TestHistory, TestResult, TestStatus, ToolResult } from "./types";

export const TEST_TIMEOUT_MS = 30_000;
/** Large image models (FLUX.2 dev) need well over 30 s for one picture. */
export const IMAGE_TEST_TIMEOUT_MS = 120_000;
export const SLOW_MS = 20_000;
export const HISTORY_DAYS = 30;

const PROMPT = "Reply with the single word: OK";

/** The STT sample and a word its transcript must contain. Script in fixtures/README.md. */
const STT_SAMPLE_PATH = join(process.cwd(), "fixtures", "stt-sample.mp3");
export const STT_EXPECTED_WORD = "olympus";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Exported for tests. */
export function classifyFailure(err: unknown): TestStatus {
  if ((err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError") return "slow";
  const status = err instanceof HttpError ? err.status : null;
  const message = String((err as Error)?.message ?? err ?? "").toLowerCase();

  // Gemini answers a model outside the key's free tier with 429 and "limit: 0".
  if (/limit:\s*0\b/.test(message) || message.includes("free tier is not available")) return "no_free_quota";
  // OpenRouter serves some free models only through the agent apps it lists (seen 2026-09-28).
  if (status === 403 && /only available on agentic harnesses|only available (in|on|through) /.test(message)) return "restricted";
  // Cloudflare's shared daily Neurons running out says nothing about the model either.
  if (status === 429 || /rate limit|too many requests|resource_exhausted|used up your daily free allocation/.test(message)) return "rate_limited";
  if (
    status === 404 || status === 410 ||
    /not found|end of life|does not exist|no endpoints found|unavailable for free|no longer available as a free model|transitioned to a paid model/.test(message)
  ) {
    return "gone";
  }
  return "error";
}

/**
 * Per-model limits sent on every response. Groq: requests/day and tokens/minute.
 * Mistral: requests/minute and tokens/minute. Exported for tests.
 */
export function limitsFromHeaders(h: Headers): RateLimits | null {
  const rpd = Number(h.get("x-ratelimit-limit-requests"));
  const rpm = Number(h.get("x-ratelimit-limit-req-minute"));
  const tpm = Number(h.get("x-ratelimit-limit-tokens") ?? h.get("x-ratelimit-limit-tokens-minute"));
  if (!rpd && !rpm && !tpm) return null;
  return {
    ...(rpm ? { rpm } : {}),
    ...(rpd ? { rpd } : {}),
    ...(tpm ? { tpm } : {}),
    source: "observed (response headers)",
  };
}

export interface TestOutcome {
  result: TestResult;
  limits: RateLimits | null;
  /** First part of the error, for the run log only; never written to data/. */
  detail: string | null;
  /** Tool-call test result, when one ran and wasn't rate-limited. */
  tool?: ToolResult | null;
}

/**
 * Voice to use per TTS model; undefined sends no voice. Groq's Orpheus and
 * Deepgram's Flux refuse a request without one; Fish Audio uses its default.
 */
export function ttsVoice(r: Pick<Resource, "provider" | "model_id">): string | undefined {
  const id = r.model_id.toLowerCase();
  if (id.includes("orpheus")) return id.includes("arabic") ? "fahad" : "troy";
  if (id.includes("flux-tts")) return "flux-cole-en";
  // Mistral's speech model needs a preset voice (GET /v1/audio/voices, checked 2026-09-29).
  if (r.provider === "mistral") return "en_paul_neutral";
  return undefined;
}

interface TestRequest {
  url: string;
  init: RequestInit;
  /** Throws when a 200 response is not the kind of answer asked for. */
  /** Speech-to-text checks return the transcript's word error rate. */
  check: (res: Response) => Promise<void | number>;
}

/** Exported for tests. */
/** `speech` is what a TTS model is asked to say: "OK" for the test, a sentence for the voice samples. */
export function buildRequest(r: Resource, env: Record<string, string | undefined>, speech = "OK"): TestRequest {
  const info = PROVIDERS[r.provider];
  const key = info.key_env ? env[info.key_env] ?? "" : "";
  const base = baseUrl(r.provider, env);
  // Keyless providers (Kilo, LLM7) are called anonymously.
  const auth: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  const extra: Record<string, string> = r.provider === "openrouter" ? { "HTTP-Referer": SITE.url, "X-Title": SITE.name } : {};
  const drain = async (res: Response) => { await res.body?.cancel(); };

  if (r.kind === "chat") {
    return {
      url: `${base}/chat/completions`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth, ...extra },
        body: JSON.stringify({ model: r.model_id, messages: [{ role: "user", content: PROMPT }], max_tokens: 16 }),
      },
      check: drain,
    };
  }

  // Cloudflare runs speech and image models through /ai/run, each family with its own
  // input format (checked 2026-09-28).
  if (r.provider === "cloudflare") return cloudflareRequest(r, base.replace(/\/v1$/, ""), auth, speech);

  // Gemini's speech models are only reachable through its native API.
  if (r.provider === "google-ai-studio") {
    const parts = r.kind === "tts"
      ? [{ text: `Say: ${speech}` }]
      : [{ text: "Transcribe this audio." }, { inline_data: { mime_type: "audio/mp3", data: Buffer.from(readFileSync(STT_SAMPLE_PATH)).toString("base64") } }];
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${r.model_id}:generateContent`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          ...(r.kind === "tts"
            ? { generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } } }
            : {}),
        }),
      },
      check: async (res) => {
        type Part = { text?: string; inlineData?: { data?: string }; audioTranscription?: { text?: string } };
        const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Part[] } }> };
        const out = json.candidates?.[0]?.content?.parts ?? [];
        if (r.kind === "tts" && !out.some((p) => p.inlineData?.data)) throw new Error("no audio in response");
        // Transcribe models answer in `audioTranscription`, not `text` (checked 2026-09-28).
        if (r.kind === "stt") return expectTranscript(out.map((p) => p.audioTranscription?.text ?? p.text ?? "").join(" "));
      },
    };
  }

  if (r.kind === "tts") {
    const voice = ttsVoice(r);
    return {
      url: `${base}/audio/speech`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth, ...extra },
        // OpenRouter accepts only mp3 or pcm; Groq's Orpheus only wav (checked 2026-09-28).
        body: JSON.stringify({ model: r.model_id, input: speech, response_format: r.provider === "groq" ? "wav" : "mp3", ...(voice ? { voice } : {}) }),
      },
      check: async (res) => {
        const bytes = (await res.arrayBuffer()).byteLength;
        if (bytes < 200) throw new Error(`audio response too small (${bytes} bytes)`);
      },
    };
  }

  const form = new FormData();
  form.append("file", new Blob([readFileSync(STT_SAMPLE_PATH)], { type: "audio/mpeg" }), "stt-sample.mp3");
  form.append("model", r.model_id);
  return {
    url: `${base}/audio/transcriptions`,
    init: { method: "POST", headers: { ...auth, ...extra }, body: form },
    check: async (res) => expectTranscript(((await res.json()) as { text?: string }).text ?? ""),
  };
}

const IMAGE_PROMPT = "a red apple on a white table";

function cloudflareRequest(r: Resource, aiBase: string, auth: Record<string, string>, speech: string): TestRequest {
  const url = `${aiBase}/run/${r.model_id}`;
  const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify(body) });
  const sample = () => readFileSync(STT_SAMPLE_PATH);
  const id = r.model_id.toLowerCase();
  let init: RequestInit;
  if (r.kind === "image") {
    if (id.includes("flux-2")) {
      const form = new FormData();
      form.append("prompt", IMAGE_PROMPT);
      form.append("width", "256");
      form.append("height", "256");
      init = { method: "POST", headers: auth, body: form };
    } else {
      init = json({ prompt: IMAGE_PROMPT, steps: 4 });
    }
  } else if (r.kind === "tts") {
    init = json(id.includes("deepgram") ? { text: speech } : { prompt: speech });
  } else if (id.includes("whisper-large-v3-turbo")) {
    init = json({ audio: Buffer.from(sample()).toString("base64") });
  } else {
    init = { method: "POST", headers: { "Content-Type": "audio/mpeg", ...auth }, body: sample() };
  }
  return { url, init, check: (res) => checkCloudflare(r, res) };
}

/** A Cloudflare answer holds the media asked for, either raw or as base64 in JSON. Exported for tests. */
export async function checkCloudflare(r: Pick<Resource, "kind">, res: Response): Promise<void | number> {
  const type = res.headers.get("content-type") ?? "";
  const want = r.kind === "image" ? "image/" : r.kind === "tts" ? "audio/" : null;
  if (want && type.startsWith(want)) {
    const bytes = (await res.arrayBuffer()).byteLength;
    if (bytes < 500) throw new Error(`${r.kind} response too small (${bytes} bytes)`);
    return;
  }
  const text = await res.text();
  if (r.kind === "stt") {
    // Whisper on Cloudflare answers {"result":{"text":…}}; score the text, not the JSON around it.
    let transcript = text;
    try {
      const json = JSON.parse(text) as { result?: { text?: string }; text?: string };
      transcript = json.result?.text ?? json.text ?? text;
    } catch { /* not JSON: the body is the transcript */ }
    return expectTranscript(transcript);
  }
  const field = r.kind === "image" ? /"image"\s*:\s*"([A-Za-z0-9+/=]{500,})/ : /"audio"\s*:\s*"([A-Za-z0-9+/=]{200,})/;
  if (!field.test(text)) throw new Error(`no ${r.kind} in response: ${text.slice(0, 120)}`);
}

/** Throws when the transcript isn't of our clip; otherwise its word error rate (3 decimals). */
function expectTranscript(text: string): number {
  if (!text.toLowerCase().includes(STT_EXPECTED_WORD)) {
    throw new Error(`transcript did not match the sample: "${text.slice(0, 80)}"`);
  }
  return Math.round(wordErrorRate(text) * 1000) / 1000;
}

export async function testModel(r: Resource, env: Record<string, string | undefined>): Promise<TestOutcome> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  try {
    const { url, init, check } = buildRequest(r, env);
    const timeout = r.kind === "image" ? IMAGE_TEST_TIMEOUT_MS : TEST_TIMEOUT_MS;
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 500);
      // Mistral answers a model outside Free mode with 429 and a per-minute limit of 0.
      const zero = res.headers.get("x-ratelimit-limit-req-minute") === "0" ? "limit: 0 " : "";
      throw new HttpError(res.status, `${res.status} ${zero}${body}`);
    }
    const wer = await check(res);
    const latency = Date.now() - started;
    // An image taking 20+ s is normal, not slow.
    const slow = r.kind === "image" ? latency > IMAGE_TEST_TIMEOUT_MS : latency > SLOW_MS;
    return {
      result: { at, status: slow ? "slow" : "responded", latency_ms: latency, ...(typeof wer === "number" ? { wer } : {}) },
      limits: r.provider === "groq" || r.provider === "mistral" ? limitsFromHeaders(res.headers) : null,
      detail: null,
    };
  } catch (err) {
    return {
      result: { at, status: classifyFailure(err), latency_ms: Date.now() - started },
      limits: null,
      detail: String((err as Error)?.message ?? err).replace(/\s+/g, " ").slice(0, 200),
    };
  }
}

/**
 * Adds today's result (replacing an earlier one from the same UTC day), trims the
 * window to HISTORY_DAYS, and drops resources that no longer exist. Pure.
 */
export function recordResults(
  history: TestHistory,
  outcomes: Map<string, TestOutcome>,
  knownIds: Set<string>,
  now: string,
): TestHistory {
  const cutoff = new Date(Date.parse(now) - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const day = (t: { at: string }) => t.at.slice(0, 10);
  /**
   * Keep the window, and replace an earlier entry from the same slot: test results keep
   * one per half-day (morning and peak hours), tool results one per day.
   */
  const merge = <T extends { at: string }>(old: T[] | undefined, next: T | null | undefined, key: (t: { at: string }) => string = slotKey): T[] => {
    const kept = (old ?? []).filter((t) => day(t) >= cutoff && (!next || key(t) !== key(next)));
    return next ? [...kept, next] : kept;
  };
  const results: TestHistory["results"] = {};
  const tool_results: NonNullable<TestHistory["tool_results"]> = {};
  const observed_limits: TestHistory["observed_limits"] = {};
  const oldTools = history.tool_results ?? {};

  const ids = new Set([...Object.keys(history.results), ...Object.keys(oldTools), ...outcomes.keys()]);
  for (const id of [...ids].sort()) {
    if (!knownIds.has(id)) continue;
    const outcome = outcomes.get(id);
    const list = merge(history.results[id], outcome?.result);
    if (list.length) results[id] = list;
    const tools = merge(oldTools[id], outcome?.tool, day);
    if (tools.length) tool_results[id] = tools;
    const limits = outcome?.limits ?? history.observed_limits[id];
    if (limits) observed_limits[id] = limits;
  }
  return { updated_at: now, results, tool_results, observed_limits };
}
