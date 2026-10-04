/**
 * The daily tool-call tests, for Cline's Act mode and other agents.
 *
 * Single turn: can the model call a tool with correct arguments when asked to? One
 * tool (get_weather) and one request that needs it. A pass is a response whose first
 * tool call names get_weather with JSON arguments containing a city of "Paris".
 * Answering in text, calling the wrong tool, bad JSON or a provider that rejects the
 * `tools` parameter are all fails.
 *
 * Multi-turn: the same first turn, then we send the tool's result back
 * (FOLLOW_UP_RESULT) and the model must answer in text using it: 18 °C and cloudy, no
 * further tool call. It passes only when both turns pass, so it costs one extra
 * request. Run every day, or every few days for small budgets (`extraTestsDue`).
 *
 * Rate limits aren't recorded, timeouts and server errors count as "error". The tests
 * run only for chat models that just passed the normal daily test, so a model that's
 * down doesn't also collect a tool failure.
 */

import { SITE } from "../site.config";
import { HttpError } from "./probe";
import { baseUrl, PROVIDERS } from "./providers";
import type { Resource, ToolResult } from "./types";

type Env = Record<string, string | undefined>;

export const TOOL_TEST_TIMEOUT_MS = 60_000;
/** Reasoning models think before calling; leave room for that. */
const MAX_TOKENS = 1024;

export const TOOL_DEFINITION = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "City name, e.g. Amsterdam" } },
      required: ["city"],
    },
  },
} as const;

const PROMPT = "What's the weather in Paris right now? Use the get_weather tool.";

/** What our get_weather "returns" in the multi-turn test. */
export const FOLLOW_UP_RESULT = { city: "Paris", temp_c: 18, condition: "cloudy" };

/** A chat completions request to the model's provider. Shared with json-test.ts. */
export function chatRequest(r: Resource, env: Env, body: Record<string, unknown>): { url: string; init: RequestInit } {
  const info = PROVIDERS[r.provider];
  const key = info.key_env ? env[info.key_env] ?? "" : "";
  return {
    url: `${baseUrl(r.provider, env)}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(r.provider === "openrouter" ? { "HTTP-Referer": SITE.url, "X-Title": SITE.name } : {}),
      },
      body: JSON.stringify({ model: r.model_id, ...body, max_tokens: MAX_TOKENS }),
    },
  };
}

/** Sends a request and returns the parsed 200 response; throws HttpError otherwise. */
export async function postChat(req: { url: string; init: RequestInit }): Promise<ChatResponse> {
  const res = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(TOOL_TEST_TIMEOUT_MS) });
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return (await res.json()) as ChatResponse;
}

export function buildToolRequest(r: Resource, env: Env): { url: string; init: RequestInit } {
  return chatRequest(r, env, { messages: [{ role: "user", content: PROMPT }], tools: [TOOL_DEFINITION] });
}

interface ToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export interface ChatMessage {
  content?: string | Array<{ type?: string; text?: string }> | null;
  tool_calls?: ToolCall[];
  /** DeepSeek-style reasoning; some providers want it sent back with the tool calls. */
  reasoning_content?: string;
}

export interface ChatResponse {
  choices?: Array<{ message?: ChatMessage }>;
}

/** The answer's text, without a leading <think> block. Exported for tests and json-test.ts. */
export function messageText(m: ChatMessage | undefined): string {
  const c = m?.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p?.text ?? "").join("") : "";
  return text.replace(/^\s*<think>[\s\S]*?<\/think>/, "").trim();
}

/**
 * The second turn: our question, the model's own tool-call message sent back as it
 * came (ids, extra fields such as Gemini's thought signatures), and one tool result
 * per call. Exported for tests.
 */
export function buildFollowUpRequest(r: Resource, env: Env, first: ChatMessage): { url: string; init: RequestInit } {
  const calls = (first.tool_calls ?? []).map((c, i) => ({ ...c, type: c.type ?? "function", id: c.id || `call_${i}` }));
  const assistant = {
    role: "assistant",
    // Cloudflare refuses a null content (seen 2026-10-04); "" is valid everywhere.
    content: first.content ?? "",
    tool_calls: calls,
    ...(first.reasoning_content ? { reasoning_content: first.reasoning_content } : {}),
  };
  const results = calls.map((c) => ({ role: "tool", tool_call_id: c.id, content: JSON.stringify(FOLLOW_UP_RESULT) }));
  return chatRequest(r, env, { messages: [{ role: "user", content: PROMPT }, assistant, ...results], tools: [TOOL_DEFINITION] });
}

/** Whether the final answer uses the tool result: 18 degrees and cloudy, no further tool call. Exported for tests. */
export function isCorrectFinalAnswer(json: ChatResponse): boolean {
  const m = json.choices?.[0]?.message;
  if (!m || (m.tool_calls?.length ?? 0) > 0) return false;
  const text = messageText(m);
  return /(^|[^\d.])18([^\d]|$)/.test(text) && /cloud|overcast/i.test(text);
}

/** Whether a 200 response holds the tool call asked for. Exported for tests. */
export function isCorrectToolCall(json: ChatResponse): boolean {
  const call = json.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (call?.name !== "get_weather" || typeof call.arguments !== "string") return false;
  try {
    const args = JSON.parse(call.arguments) as { city?: unknown };
    return typeof args.city === "string" && /paris/i.test(args.city);
  } catch {
    return false;
  }
}

/** Status for a failed request; null for a rate limit (not recorded). Exported for tests. */
export function classifyToolFailure(err: unknown): ToolResult["status"] | null {
  if ((err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError") return "error";
  const status = err instanceof HttpError ? err.status : null;
  const message = String((err as Error)?.message ?? err ?? "").toLowerCase();
  if (status === 429 || /rate limit|too many requests|resource_exhausted|used up your daily free allocation/.test(message)) return null;
  // A 4xx means the provider or model refused the tool request itself: a fail for Act mode.
  if (status !== null && status >= 400 && status < 500) return "fail";
  return "error";
}

/**
 * Whether the multi-turn and JSON tests run for this model today: daily by default;
 * for providers with `extra_tests_every_days` each model gets one day in that cycle,
 * picked from its id so the models spread over the days. Pure; exported for tests.
 */
export function extraTestsDue(r: Pick<Resource, "id" | "provider">, now: string): boolean {
  const every = PROVIDERS[r.provider].extra_tests_every_days ?? 1;
  if (every <= 1) return true;
  let hash = 0;
  for (const ch of r.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (hash + Math.floor(Date.parse(now) / 86_400_000)) % every === 0;
}

export interface TestRun<T extends ToolResult = ToolResult> {
  /** Null for a rate limit (not recorded). */
  result: T | null;
  /** For the run log only; never written to data/. */
  detail: string | null;
}

const errorDetail = (err: unknown) => String((err as Error)?.message ?? err).replace(/\s+/g, " ").slice(0, 200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The single-turn test, plus the multi-turn test when `multiTurn` is set (its first
 * turn is the single-turn request). `pauseMs` keeps the provider's request gap
 * between the two turns.
 */
export async function testToolCall(
  r: Resource,
  env: Env,
  opts: { multiTurn?: boolean; pauseMs?: number } = {},
): Promise<{ single: TestRun; multi: TestRun | null }> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  const fail = (status: ToolResult["status"] | null, detail: string | null): TestRun =>
    ({ result: status ? { at, status, latency_ms: Date.now() - started } : null, detail });

  let first: ChatResponse;
  try {
    first = await postChat(buildToolRequest(r, env));
  } catch (err) {
    const run = fail(classifyToolFailure(err), errorDetail(err));
    return { single: run, multi: opts.multiTurn ? run : null };
  }
  if (!isCorrectToolCall(first)) {
    const run = fail("fail", "answered without a correct get_weather call");
    return { single: run, multi: opts.multiTurn ? run : null };
  }
  const single = fail("pass", null);
  if (!opts.multiTurn) return { single, multi: null };

  await sleep(opts.pauseMs ?? 0);
  const secondStarted = Date.now();
  try {
    const pass = isCorrectFinalAnswer(await postChat(buildFollowUpRequest(r, env, first.choices![0].message!)));
    // Latency of the turn we added; the first turn's is in the single-turn result.
    const latency_ms = Date.now() - secondStarted;
    return {
      single,
      multi: { result: { at, status: pass ? "pass" : "fail", latency_ms }, detail: pass ? null : "final answer didn't use the tool result" },
    };
  } catch (err) {
    const status = classifyToolFailure(err);
    return { single, multi: { result: status ? { at, status, latency_ms: Date.now() - secondStarted } : null, detail: `second turn: ${errorDetail(err)}` } };
  }
}
