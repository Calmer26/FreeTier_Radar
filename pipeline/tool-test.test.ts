import { describe, expect, it } from "vitest";
import { HttpError, recordResults } from "./probe";
import { buildToolRequest, classifyToolFailure, isCorrectToolCall } from "./tool-test";
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
