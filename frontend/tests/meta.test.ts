// Meta client: never calls the network in tests. fetch is stubbed with a recorded-style response.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const Schema = z.object({ answer: z.string(), score: z.number() });

const reply = (content: string, usage = { prompt_tokens: 1000, completion_tokens: 500 }) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }], usage }), { status: 200 });

async function load() {
  vi.resetModules();
  return import("@/lib/meta/client");
}

const ask = (m: Awaited<ReturnType<typeof load>>, user = "hi") =>
  m.metaJson({ schema: Schema, schemaName: "t", system: "sys", user, maxTokens: 100 });

let dir: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "meta-test-"));
  vi.stubEnv("META_CACHE_DIR", dir);
  vi.stubEnv("MODEL_API_KEY", "test-key");
  vi.stubEnv("META_LIVE", "1");
  vi.stubEnv("META_DAILY_BUDGET_USD", "1");
  vi.stubEnv("META_TEXT_MODEL", "");
  fetchMock = vi.fn(async () => reply('{"answer":"ok","score":3}'));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("meta client", () => {
  it("is off unless META_LIVE=1 and a key are set", async () => {
    vi.stubEnv("META_LIVE", "0");
    const m = await load();
    expect(m.metaEnabled()).toBe(false);
    await expect(ask(m)).rejects.toThrow(/off/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a strict JSON-schema request with an output cap and low effort", async () => {
    const m = await load();
    const res = await ask(m);
    expect(res.data).toEqual({ answer: "ok", score: 3 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.meta.ai/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("muse-spark-1.3");
    expect(body.max_completion_tokens).toBe(100);
    expect(body.reasoning_effort).toBe("low");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();
  });

  it("serves repeats from the cache, even with live calls off", async () => {
    const m = await load();
    await ask(m);
    vi.stubEnv("META_LIVE", "0");
    const again = await ask(m);
    expect(again.cached).toBe(true);
    expect(again.usage.costUsd).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs usage with an estimated cost", async () => {
    const m = await load();
    const res = await ask(m);
    // 1000 in × $1.25/M + 500 out × $4.25/M
    expect(res.usage.costUsd).toBeCloseTo(0.003375, 6);
    const log = readFileSync(path.join(dir, "usage.jsonl"), "utf8").trim().split("\n");
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0]).costUsd).toBeCloseTo(0.003375, 6);
  });

  it("refuses live calls once today's budget is spent", async () => {
    const day = new Date().toISOString().slice(0, 10);
    writeFileSync(path.join(dir, "usage.jsonl"), JSON.stringify({ day, costUsd: 1.5 }) + "\n");
    const m = await load();
    await expect(ask(m)).rejects.toThrow(/Daily Meta budget/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects responses that fail the schema and does not cache them", async () => {
    fetchMock.mockImplementation(async () => reply('{"answer":42}'));
    const m = await load();
    await expect(ask(m)).rejects.toThrow();
    fetchMock.mockImplementation(async () => reply('{"answer":"fixed","score":1}'));
    const res = await ask(m);
    expect(res.cached).toBe(false);
    expect(res.data.answer).toBe("fixed");
  });

  it("surfaces API errors with their status", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }));
    const m = await load();
    await expect(ask(m)).rejects.toMatchObject({ status: 401, message: "bad key" });
  });

  it("treats a truncated answer as an error", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: '{"ans' } }] }), { status: 200 }));
    const m = await load();
    await expect(ask(m)).rejects.toThrow(/ran out of output tokens/);
  });
});
