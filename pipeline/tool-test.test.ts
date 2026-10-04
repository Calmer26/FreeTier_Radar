import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, recordResults } from "./probe";
import {
  buildFollowUpRequest, buildToolRequest, classifyToolFailure, extraTestsDue, isCorrectFinalAnswer, isCorrectToolCall,
  messageText, testToolCall,
} from "./tool-test";
import type { Resource, TestHistory } from "./types";

const call = (name: string, args: string) => ({ choices: [{ message: { tool_calls: [{ function: { name, arguments: args } }] } }] });

describe("isCorrectToolCall", () => {
  it("passes a get_weather call for Paris", () => {
    expect(isCorrectToolCall(call("get_weather", '{"city":"Paris"}'))).toBe(true);
    expect(isCorrectToolCall(call("get_weather", '{"city":"Paris, France"}'))).toBe(true);
  });
  it("fails text answers, wrong tools, wrong or broken arguments", () => {
    expect(isCorrectToolCall({ choices: [{ message: {} }] })).toBe(false);
    expect(isCorrectToolCall(call("get_time", '{"city":"Paris"}'))).toBe(false);
    expect(isCorrectToolCall(call("get_weather", '{"city":"London"}'))).toBe(false);
    expect(isCorrectToolCall(call("get_weather", "{city: Paris"))).toBe(false);
  });
});

describe("classifyToolFailure", () => {
  it("treats a refused tools request as a fail, rate limits as unrecorded, the rest as errors", () => {
    expect(classifyToolFailure(new HttpError(400, "400 `tool calling` is not supported with this model"))).toBe("fail");
    expect(classifyToolFailure(new HttpError(429, "429 rate limited"))).toBeNull();
    expect(classifyToolFailure(new HttpError(503, "503 overloaded"))).toBe("error");
    expect(classifyToolFailure(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe("error");
  });
});

describe("buildToolRequest", () => {
  it("sends one tool, and no Authorization header for keyless providers", () => {
    const req = buildToolRequest({ provider: "llm7", model_id: "GLM-5.3-Flash", kind: "chat" } as Resource, {});
    expect(req.url).toBe("https://api.llm7.io/v1/chat/completions");
    expect((req.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(req.init.body as string).tools[0].function.name).toBe("get_weather");
  });
});

describe("recordResults with tool results", () => {
  it("stores tool results beside the normal ones, one per day, and keeps old files readable", () => {
    const legacy: TestHistory = { updated_at: null, results: {}, observed_limits: {} };
    const ids = new Set(["p/m"]);
    const h1 = recordResults(legacy, new Map([["p/m", {
      result: { at: "2026-09-28T06:00:00Z", status: "responded" as const, latency_ms: 1 }, limits: null, detail: null,
      tool: { at: "2026-09-28T06:00:05Z", status: "fail" as const, latency_ms: 1 },
    }]]), ids, "2026-09-28T06:10:00Z");
    const h2 = recordResults(h1, new Map([["p/m", {
      result: { at: "2026-09-28T12:00:00Z", status: "responded" as const, latency_ms: 1 }, limits: null, detail: null,
      tool: { at: "2026-09-28T12:00:05Z", status: "pass" as const, latency_ms: 1 },
    }]]), ids, "2026-09-28T12:10:00Z");
    expect(h2.tool_results).toEqual({ "p/m": [{ at: "2026-09-28T12:00:05Z", status: "pass", latency_ms: 1 }] });
  });
});

const answer = (content: string, tool_calls?: Array<{ function: { name: string; arguments: string } }>) => ({ choices: [{ message: { content, ...(tool_calls ? { tool_calls } : {}) } }] });

describe("isCorrectFinalAnswer", () => {
  it("passes a text answer with 18 degrees and cloudy", () => {
    expect(isCorrectFinalAnswer(answer("It's 18 °C and cloudy in Paris."))).toBe(true);
    expect(isCorrectFinalAnswer(answer("Paris: overcast, 18°C (64 °F)."))).toBe(true);
    expect(isCorrectFinalAnswer(answer("<think>The tool said 20?</think>Cloudy skies and 18 degrees."))).toBe(true);
  });
  it("fails another tool call, a wrong number or a missing condition", () => {
    expect(isCorrectFinalAnswer(answer("18 °C and cloudy", [{ function: { name: "get_weather", arguments: "{}" } }]))).toBe(false);
    expect(isCorrectFinalAnswer(answer("It's 118 °C and cloudy."))).toBe(false);
    expect(isCorrectFinalAnswer(answer("It's 18 °C and sunny."))).toBe(false);
    expect(isCorrectFinalAnswer(answer(""))).toBe(false);
    expect(isCorrectFinalAnswer({ choices: [] })).toBe(false);
  });
});

describe("messageText", () => {
  it("reads string and array content and drops a leading think block", () => {
    expect(messageText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("ab");
    expect(messageText({ content: "<think>x</think>\n ok " })).toBe("ok");
    expect(messageText({ content: null })).toBe("");
  });
});

describe("buildFollowUpRequest", () => {
  const r = { provider: "groq", model_id: "m", kind: "chat" } as Resource;
  it("sends the model's tool calls back as they came, with one tool result per call", () => {
    const first = {
      content: null,
      reasoning_content: "need weather",
      tool_calls: [
        { id: "abc", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' }, extra_content: { sig: "s" } },
        { function: { name: "get_weather", arguments: '{"city":"Paris"}' } },
      ],
    };
    const body = JSON.parse(buildFollowUpRequest(r, { GROQ_API_KEY: "k" }, first).init.body as string);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "tool", "tool"]);
    expect(body.messages[1]).toMatchObject({ content: null, reasoning_content: "need weather", tool_calls: [{ id: "abc", extra_content: { sig: "s" } }, { id: "call_1", type: "function" }] });
    expect(body.messages[2]).toEqual({ role: "tool", tool_call_id: "abc", content: '{"city":"Paris","temp_c":18,"condition":"cloudy"}' });
    expect(body.messages[3].tool_call_id).toBe("call_1");
    expect(body.tools[0].function.name).toBe("get_weather");
  });
});

describe("extraTestsDue", () => {
  it("is daily by default, and once per cycle per model on small budgets, spread over the days", () => {
    const days = Array.from({ length: 7 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}T06:10:00Z`);
    expect(days.every((d) => extraTestsDue({ id: "groq/m", provider: "groq" }, d))).toBe(true);
    const ids = Array.from({ length: 20 }, (_, i) => `cohere/model-${i}`);
    for (const id of ids) expect(days.filter((d) => extraTestsDue({ id, provider: "cohere" }, d))).toHaveLength(1);
    const firstDay = ids.filter((id) => extraTestsDue({ id, provider: "cohere" }, days[0])).length;
    expect(firstDay).toBeLessThan(ids.length / 2);
  });
});

describe("testToolCall", () => {
  const r = { id: "groq/m", provider: "groq", model_id: "m", kind: "chat" } as Resource;
  const call = { choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } }] } }] };
  const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
  const mockFetch = (...responses: Array<Response | Error>) => {
    const fn = vi.fn();
    for (const res of responses) fn.mockImplementationOnce(async () => { if (res instanceof Error) throw res; return res; });
    vi.stubGlobal("fetch", fn);
    return fn;
  };
  afterEach(() => vi.unstubAllGlobals());

  it("passes both when the model calls the tool and then uses its result", async () => {
    const fetch = mockFetch(ok(call), ok(answer("It is 18°C and cloudy in Paris.")));
    const { single, multi } = await testToolCall(r, {}, { multiTurn: true });
    expect(single.result?.status).toBe("pass");
    expect(multi?.result?.status).toBe("pass");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sends one request and no multi-turn result when the multi-turn test isn't due", async () => {
    const fetch = mockFetch(ok(call));
    const { single, multi } = await testToolCall(r, {});
    expect(single.result?.status).toBe("pass");
    expect(multi).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails the multi-turn test with the first turn, without a second request", async () => {
    const fetch = mockFetch(ok(answer("I can't check the weather.")));
    const { single, multi } = await testToolCall(r, {}, { multiTurn: true });
    expect([single.result?.status, multi?.result?.status]).toEqual(["fail", "fail"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails a final answer that ignores the result or calls the tool again", async () => {
    mockFetch(ok(call), ok(call));
    expect((await testToolCall(r, {}, { multiTurn: true })).multi?.result?.status).toBe("fail");
  });

  it("classifies the second turn like the first: 4xx fail, 5xx and timeouts error, rate limits unrecorded", async () => {
    mockFetch(ok(call), new Response("tool role not supported", { status: 400 }));
    expect((await testToolCall(r, {}, { multiTurn: true })).multi?.result?.status).toBe("fail");
    mockFetch(ok(call), new Response("overloaded", { status: 503 }));
    expect((await testToolCall(r, {}, { multiTurn: true })).multi?.result?.status).toBe("error");
    mockFetch(ok(call), Object.assign(new Error("t"), { name: "TimeoutError" }));
    expect((await testToolCall(r, {}, { multiTurn: true })).multi?.result?.status).toBe("error");
    mockFetch(ok(call), new Response("slow down", { status: 429 }));
    const limited = await testToolCall(r, {}, { multiTurn: true });
    expect(limited.single.result?.status).toBe("pass");
    expect(limited.multi?.result).toBeNull();
  });

  it("records neither when the first turn is rate-limited", async () => {
    mockFetch(new Response("slow down", { status: 429 }));
    const { single, multi } = await testToolCall(r, {}, { multiTurn: true });
    expect(single.result).toBeNull();
    expect(multi?.result).toBeNull();
  });
});

describe("recordResults with multi-turn and JSON results", () => {
  it("keeps one of each per day beside the tool results, and drops removed models", () => {
    const at = (h: string) => `2026-09-28T${h}:00:00Z`;
    const outcome = (h: string, status: "pass" | "fail") => ({
      result: { at: at(h), status: "responded" as const, latency_ms: 1 }, limits: null, detail: null,
      multiTool: { at: at(h), status, latency_ms: 1 },
      json: { at: at(h), status, latency_ms: 1, mode: "json_schema" as const },
    });
    const h1 = recordResults({ updated_at: null, results: {}, observed_limits: {} }, new Map([["p/m", outcome("06", "fail")], ["p/gone", outcome("06", "pass")]]), new Set(["p/m", "p/gone"]), at("06"));
    const h2 = recordResults(h1, new Map([["p/m", outcome("07", "pass")]]), new Set(["p/m"]), at("07"));
    expect(h2.multi_tool_results).toEqual({ "p/m": [{ at: at("07"), status: "pass", latency_ms: 1 }] });
    expect(h2.json_results).toEqual({ "p/m": [{ at: at("07"), status: "pass", latency_ms: 1, mode: "json_schema" }] });
    // A run without these tests (peak hours) keeps them as they were.
    const h3 = recordResults(h2, new Map([["p/m", { result: { at: "2026-09-28T18:10:00Z", status: "responded" as const, latency_ms: 1 }, limits: null, detail: null }]]), new Set(["p/m"]), "2026-09-28T18:10:00Z");
    expect(h3.multi_tool_results).toEqual(h2.multi_tool_results);
    expect(h3.json_results).toEqual(h2.json_results);
  });
});
