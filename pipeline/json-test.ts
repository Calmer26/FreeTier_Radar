/**
 * The daily JSON-schema output test: can the model pull a small structured object out
 * of a text and return it as valid JSON with the right values?
 *
 * One short Dutch event announcement (date in words, a price with a decimal comma, a
 * minimum age but no maximum) and a five-field schema. We ask with
 * `response_format: json_schema`; when the provider refuses that (a 4xx), we ask again
 * in JSON mode (`json_object`) with the same prompt, which also spells out the fields.
 * The result records which of the two the provider accepted.
 *
 * A pass is an answer that parses as JSON (a <think> block or code fence around it is
 * tolerated), has exactly the schema's fields with the right types, and the right
 * values, including null for the age limit the text doesn't give. Failure
 * classification is the tool test's: rate limits aren't recorded, timeouts and 5xx are
 * "error", 4xx on both formats and wrong output are "fail".
 */

import { HttpError } from "./probe";
import { chatRequest, classifyToolFailure, messageText, postChat, type ChatResponse, type TestRun } from "./tool-test";
import type { JsonResult, Resource } from "./types";

type Env = Record<string, string | undefined>;
export type JsonMode = NonNullable<JsonResult["mode"]>;

export const EVENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    date: { type: "string", description: "ISO 8601 date, YYYY-MM-DD" },
    price_eur: { type: ["number", "null"] },
    age_min: { type: ["integer", "null"] },
    age_max: { type: ["integer", "null"] },
  },
  required: ["title", "date", "price_eur", "age_min", "age_max"],
  additionalProperties: false,
} as const;

const SNIPPET =
  "Op zaterdag 14 november 2026 speelt Theater Het Anker de kindervoorstelling 'De Gruffalo'. " +
  "Aanvang 14.00 uur, zaal open om 13.30 uur. Kaartjes kosten € 7,50. Geschikt voor kinderen vanaf 6 jaar.";

const PROMPT =
  "Extract the event from this Dutch text as a JSON object with exactly these fields: " +
  "title (string), date (ISO 8601, YYYY-MM-DD), price_eur (number, or null if no price is given), " +
  "age_min and age_max (integers, or null if the text doesn't give one). Reply with the JSON object only.\n\n" +
  `Text: ${SNIPPET}`;

export const EXPECTED = { date: "2026-11-14", price_eur: 7.5, age_min: 6, age_max: null } as const;

export function buildJsonRequest(r: Resource, env: Env, mode: JsonMode): { url: string; init: RequestInit } {
  const response_format = mode === "json_schema"
    ? { type: "json_schema", json_schema: { name: "event", schema: EVENT_SCHEMA } }
    : { type: "json_object" };
  return chatRequest(r, env, { messages: [{ role: "user", content: PROMPT }], response_format });
}

/** The answer as JSON, or undefined when it doesn't parse. Exported for tests. */
export function parseAnswer(text: string): unknown {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  try {
    return JSON.parse(fenced ? fenced[1] : text);
  } catch {
    return undefined;
  }
}

/** Null when the object matches the schema and the expected values; else what's wrong. Exported for tests. */
export function checkEvent(value: unknown): string | null {
  if (value === undefined) return "not valid JSON";
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "not a JSON object";
  const o = value as Record<string, unknown>;
  const fields = EVENT_SCHEMA.required as readonly string[];
  const extra = Object.keys(o).filter((k) => !fields.includes(k));
  if (extra.length) return `unexpected field ${extra[0]}`;
  const missing = fields.filter((k) => !(k in o));
  if (missing.length) return `missing field ${missing[0]}`;
  if (typeof o.title !== "string" || typeof o.date !== "string") return "title or date not a string";
  if (o.price_eur !== null && typeof o.price_eur !== "number") return "price_eur not a number or null";
  for (const k of ["age_min", "age_max"]) {
    if (o[k] !== null && !Number.isInteger(o[k])) return `${k} not an integer or null`;
  }
  if (!/gruffalo/i.test(o.title)) return `wrong title ${JSON.stringify(o.title)}`;
  for (const [k, v] of Object.entries(EXPECTED)) {
    if (o[k] !== v) return `wrong ${k} ${JSON.stringify(o[k])}`;
  }
  return null;
}

/** `pauseMs` keeps the provider's request gap before the JSON-mode retry. */
export async function testJsonOutput(r: Resource, env: Env, opts: { pauseMs?: number } = {}): Promise<TestRun<JsonResult>> {
  let started = Date.now();
  const at = new Date(started).toISOString();
  const done = (status: JsonResult["status"] | null, detail: string | null, mode?: JsonMode): TestRun<JsonResult> => ({
    // Latency of the request that counted, not the pause before a retry.
    result: status ? { at, status, latency_ms: Date.now() - started, ...(mode ? { mode } : {}) } : null,
    detail,
  });

  let json: ChatResponse | null = null;
  let mode: JsonMode = "json_schema";
  try {
    try {
      json = await postChat(buildJsonRequest(r, env, mode));
    } catch (err) {
      // Refused json_schema (a 4xx that isn't a rate limit): try JSON mode instead.
      if (!(err instanceof HttpError) || classifyToolFailure(err) !== "fail") throw err;
      await new Promise((res) => setTimeout(res, opts.pauseMs ?? 0));
      mode = "json_object";
      started = Date.now();
      json = await postChat(buildJsonRequest(r, env, mode));
    }
  } catch (err) {
    const detail = `${mode}: ${String((err as Error)?.message ?? err).replace(/\s+/g, " ").slice(0, 200)}`;
    return done(classifyToolFailure(err), detail);
  }
  const problem = checkEvent(parseAnswer(messageText(json.choices?.[0]?.message)));
  return problem ? done("fail", `${mode}: ${problem}`, mode) : done("pass", null, mode);
}
