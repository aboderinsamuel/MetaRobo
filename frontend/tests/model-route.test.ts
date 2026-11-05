// A description must only ever become what Muse Spark designs: never a demo robot.
// fetch is stubbed; nothing reaches the network.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const post = async (body: unknown) => {
  vi.resetModules();
  const { POST } = await import("@/app/api/lab/model/route");
  const res = await POST(new Request("http://x/api/lab/model", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, json: (await res.json()) as { model?: { source: string; presetId?: string; assembly?: unknown }; error?: string } };
};

// Each test imports the route fresh; under a full parallel run that first import can exceed 5 s.
vi.setConfig({ testTimeout: 30_000 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("META_CACHE_DIR", mkdtempSync(path.join(tmpdir(), "route-test-")));
  vi.stubEnv("MODEL_API_KEY", "test-key");
  vi.stubEnv("META_LIVE", "1");
  vi.stubEnv("META_DAILY_BUDGET_USD", "1");
  // Every Muse Spark call runs out of tokens, like the two-armed robot did.
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "" } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/lab/model", () => {
  it("retries once, then returns an error, never a demo robot", async () => {
    const { status, json } = await post({ description: "a two armed robot that folds laundry" });
    expect(status).toBe(502);
    expect(json.model).toBeUndefined();
    expect(json.error).toMatch(/couldn't model/);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    // The feasibility review failed twice but didn't stop the build: the physics was still attempted.
    expect(bodies.map((b) => b.response_format.json_schema.name)).toEqual(["feasibility_review", "feasibility_review", "plant_model", "plant_model"]);
    // Each retry gets more room and thinks less.
    expect(bodies[3].max_completion_tokens).toBeGreaterThan(bodies[2].max_completion_tokens);
    expect(bodies.slice(2).map((b) => b.reasoning_effort)).toEqual(["low", "minimal"]);
  });

  it("says Muse Spark is off instead of loading a demo when live mode is off", async () => {
    vi.stubEnv("META_LIVE", "0");
    const { status, json } = await post({ description: "a robot arm that sorts screws" });
    expect(status).toBe(503);
    expect(json.model).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads a demo robot only when one is picked", async () => {
    const { status, json } = await post({ description: "", presetId: "rover" });
    expect(status).toBe(200);
    expect(json.model?.source).toBe("offline");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
