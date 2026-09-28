/**
 * The daily tool-call test, for Cline's Act mode: can the model call a tool with
 * correct arguments when asked to?
 *
 * One tool (get_weather) and one request that needs it. A pass is a response whose
 * first tool call names get_weather with JSON arguments containing a city of
 * "Paris". Answering in text, calling the wrong tool, bad JSON or a provider that
 * rejects the `tools` parameter are all fails. Rate limits aren't recorded, timeouts
 * and server errors count as "error".
 *
 * It runs only for chat models that just passed the normal daily test, so a model
 * that's down doesn't also collect a tool failure.
 */

import { SITE } from "../site.config";
import { HttpError } from "./probe";
import { baseUrl, PROVIDERS } from "./providers";
import type { Resource, ToolResult } from "./types";

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

export function buildToolRequest(r: Resource, env: Record<string, string | undefined>): { url: string; init: RequestInit } {
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
      body: JSON.stringify({
        model: r.model_id,
        messages: [{ role: "user", content: PROMPT }],
        tools: [TOOL_DEFINITION],
        max_tokens: MAX_TOKENS,
      }),
    },
  };
}

interface ChatResponse {
  choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
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
  if (status === 429 || /rate limit|too many requests|resource_exhausted/.test(message)) return null;
  // A 4xx means the provider or model refused the tool request itself: a fail for Act mode.
  if (status !== null && status >= 400 && status < 500) return "fail";
  return "error";
}

export async function testToolCall(
  r: Resource,
  env: Record<string, string | undefined>,
): Promise<{ result: ToolResult | null; detail: string | null }> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  try {
    const { url, init } = buildToolRequest(r, env);
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TOOL_TEST_TIMEOUT_MS) });
    if (!res.ok) throw new HttpError(res.status, `${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
    const pass = isCorrectToolCall((await res.json()) as ChatResponse);
    return {
      result: { at, status: pass ? "pass" : "fail", latency_ms: Date.now() - started },
      detail: pass ? null : "answered without a correct get_weather call",
    };
  } catch (err) {
    const status = classifyToolFailure(err);
    const detail = String((err as Error)?.message ?? err).replace(/\s+/g, " ").slice(0, 200);
    return { result: status ? { at, status, latency_ms: Date.now() - started } : null, detail };
  }
}
