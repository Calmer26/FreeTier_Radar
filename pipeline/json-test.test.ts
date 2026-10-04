import { afterEach, describe, expect, it, vi } from "vitest";
import { buildJsonRequest, checkEvent, parseAnswer, testJsonOutput } from "./json-test";
import type { Resource } from "./types";

const good = { title: "De Gruffalo", date: "2026-11-14", price_eur: 7.5, age_min: 6, age_max: null };

describe("parseAnswer", () => {
  it("parses plain JSON and JSON in a code fence", () => {
    expect(parseAnswer(JSON.stringify(good))).toEqual(good);
    expect(parseAnswer("```json\n" + JSON.stringify(good) + "\n```")).toEqual(good);
  });
  it("gives undefined for text around the JSON or broken JSON", () => {
    expect(parseAnswer(`Here it is: ${JSON.stringify(good)}`)).toBeUndefined();
    expect(parseAnswer("{title: 'x'}")).toBeUndefined();
  });
});

describe("checkEvent", () => {
  it("passes the right object, whatever the title's wording", () => {
    expect(checkEvent(good)).toBeNull();
    expect(checkEvent({ ...good, title: "Kindervoorstelling De Gruffalo" })).toBeNull();
  });
  it("fails invalid JSON, wrong shapes and wrong types", () => {
    expect(checkEvent(undefined)).toBe("not valid JSON");
    expect(checkEvent([good])).toBe("not a JSON object");
    expect(checkEvent({ ...good, venue: "Het Anker" })).toBe("unexpected field venue");
    const { age_max: _, ...noMax } = good;
    expect(checkEvent(noMax)).toBe("missing field age_max");
    expect(checkEvent({ ...good, price_eur: "7,50" })).toBe("price_eur not a number or null");
    expect(checkEvent({ ...good, age_min: 6.5 })).toBe("age_min not an integer or null");
  });
  it("fails wrong values, including an invented upper age", () => {
    expect(checkEvent({ ...good, date: "14-11-2026" })).toBe('wrong date "14-11-2026"');
    expect(checkEvent({ ...good, price_eur: 750 })).toBe("wrong price_eur 750");
    expect(checkEvent({ ...good, age_max: 12 })).toBe("wrong age_max 12");
    expect(checkEvent({ ...good, title: "Theater Het Anker" })).toBe('wrong title "Theater Het Anker"');
  });
});

describe("buildJsonRequest", () => {
  const r = { provider: "groq", model_id: "m", kind: "chat" } as Resource;
  it("asks for json_schema with our schema, or for JSON mode", () => {
    const schema = JSON.parse(buildJsonRequest(r, {}, "json_schema").init.body as string);
    expect(schema.response_format.type).toBe("json_schema");
    expect(schema.response_format.json_schema.schema.required).toEqual(["title", "date", "price_eur", "age_min", "age_max"]);
    expect(schema.messages[0].content).toMatch(/Gruffalo/);
    const object = JSON.parse(buildJsonRequest(r, {}, "json_object").init.body as string);
    expect(object.response_format).toEqual({ type: "json_object" });
  });
});

describe("testJsonOutput", () => {
  const r = { id: "groq/m", provider: "groq", model_id: "m", kind: "chat" } as Resource;
  const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  const mockFetch = (...responses: Array<Response | Error>) => {
    const fn = vi.fn();
    for (const res of responses) fn.mockImplementationOnce(async () => { if (res instanceof Error) throw res; return res; });
    vi.stubGlobal("fetch", fn);
    return fn;
  };
  const sentFormats = (fn: ReturnType<typeof vi.fn>) =>
    fn.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).response_format.type);
  afterEach(() => vi.unstubAllGlobals());

  it("passes with json_schema when the provider takes it", async () => {
    const fetch = mockFetch(reply(JSON.stringify(good)));
    const run = await testJsonOutput(r, {});
    expect(run.result).toMatchObject({ status: "pass", mode: "json_schema" });
    expect(sentFormats(fetch)).toEqual(["json_schema"]);
  });

  it("falls back to JSON mode when json_schema is refused", async () => {
    const fetch = mockFetch(new Response("response_format json_schema not supported", { status: 400 }), reply(JSON.stringify(good)));
    const run = await testJsonOutput(r, {});
    expect(run.result).toMatchObject({ status: "pass", mode: "json_object" });
    expect(sentFormats(fetch)).toEqual(["json_schema", "json_object"]);
  });

  it("fails wrong output with the mode it used, and a refusal of both without one", async () => {
    mockFetch(reply(JSON.stringify({ ...good, age_max: 99 })));
    const wrong = await testJsonOutput(r, {});
    expect(wrong.result).toMatchObject({ status: "fail", mode: "json_schema" });
    expect(wrong.detail).toBe("json_schema: wrong age_max 99");
    mockFetch(new Response("no", { status: 400 }), new Response("no", { status: 422 }));
    const refused = await testJsonOutput(r, {});
    expect(refused.result?.status).toBe("fail");
    expect(refused.result?.mode).toBeUndefined();
  });

  it("doesn't fall back on errors or rate limits: errors count, rate limits aren't recorded", async () => {
    const fetch = mockFetch(new Response("overloaded", { status: 503 }));
    expect((await testJsonOutput(r, {})).result?.status).toBe("error");
    expect(fetch).toHaveBeenCalledTimes(1);
    mockFetch(Object.assign(new Error("t"), { name: "TimeoutError" }));
    expect((await testJsonOutput(r, {})).result?.status).toBe("error");
    mockFetch(new Response("slow down", { status: 429 }));
    expect((await testJsonOutput(r, {})).result).toBeNull();
    mockFetch(new Response("no", { status: 400 }), new Response("slow down", { status: 429 }));
    expect((await testJsonOutput(r, {})).result).toBeNull();
  });
});
