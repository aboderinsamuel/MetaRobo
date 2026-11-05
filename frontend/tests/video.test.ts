// Video → model: SAM output parsing, motion extraction and fitting. No network: fetch is stubbed.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStepCsv } from "@/lib/lab/data";
import { estimateFps, tracksToStepCsv } from "@/lib/lab/video";
import { mainTrack, parseSamText, samCost, streamText, type SamBox } from "@/lib/meta/sam";
import { tsEngine } from "@/lib/sim/engine";

const box = (x1: number, y1: number, x2: number, y2: number) => `<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=640;h=360|>`;
// Masks are base85 and may contain characters like "," "<" "!" — they must not confuse the parser.
const mask = "<|mask;x=0;y=0;data=8,8,~a,b<c>!d9f~|>";

/** A side-on clip of a 0.2 m robot (100 px long) accelerating like v = 0.5 (1 - e^(-t/0.3)) m/s. */
function syntheticClip(fps = 30, seconds = 2.5): SamBox[] {
  const out: SamBox[] = [];
  const mpp = 0.2 / 100;
  for (let f = 0; f <= fps * seconds; f++) {
    const t = f / fps;
    const x = 0.5 * (t - 0.3 * (1 - Math.exp(-t / 0.3))); // position = ∫v
    const px = 50 + x / mpp;
    out.push({ frame: f, id: 3, x1: px, y1: 200, x2: px + 100, y2: 240, w: 640, h: 360 });
  }
  return out;
}

describe("SAM 3.1 output parsing", () => {
  it("reads boxes per frame, by key, ignoring masks", () => {
    const text = [`<0f>0${box(10, 20, 110, 60)}${mask},2${box(300, 10, 320, 30)}${mask}`, `<1f>0${box(14, 20, 114, 60)}${mask}`, `<3f>2${box(301, 10, 321, 30)}`].join("\n");
    const boxes = parseSamText(text);
    expect(boxes).toHaveLength(4);
    expect(boxes[0]).toMatchObject({ frame: 0, id: 0, x1: 10, y1: 20, x2: 110, y2: 60, w: 640, h: 360 });
    expect(boxes.map((b) => `${b.frame}:${b.id}`)).toEqual(["0:0", "0:2", "1:0", "3:2"]);
  });

  it("reads fields by key even with confidence added", () => {
    const [b] = parseSamText("<5f>7<|box;x1=1;y1=2;x2=3;y2=4;w=10;h=10;c=0.93|>");
    expect(b).toMatchObject({ frame: 5, id: 7, x1: 1, y2: 4 });
  });

  it("keeps the object tracked in the most frames, one box per frame", () => {
    const text = `<0f>0${box(0, 0, 10, 10)},1${box(50, 0, 60, 10)}\n<1f>1${box(51, 0, 61, 10)}\n<2f>1${box(52, 0, 62, 10)}`;
    const t = mainTrack(parseSamText(text));
    expect(t.id).toBe(1);
    expect(t.boxes.map((b) => b.frame)).toEqual([0, 1, 2]);
  });

  it("collects text deltas from the event stream", () => {
    const sse = [
      `data: ${JSON.stringify({ type: "response.created" })}`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: `<0f>0${box(1, 1, 5, 5)}` })}`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: `<1f>0${box(2, 1, 6, 5)}` })}`,
      `data: ${JSON.stringify({ type: "response.completed" })}`,
    ].join("\n\n");
    expect(parseSamText(streamText(sse))).toHaveLength(2);
  });

  it("costs video at $0.20 per 1,000 frames with a 50-frame minimum", () => {
    expect(samCost(10)).toBeCloseTo(0.01, 6);
    expect(samCost(300)).toBeCloseTo(0.06, 6);
  });
});

describe("motion → model", () => {
  it("recovers the robot's speed and time constant from its tracked boxes", () => {
    const out = tracksToStepCsv({ boxes: syntheticClip(), fps: 30, lengthM: 0.2, measure: "speed", uStep: 6 });
    expect(out.axis).toBe("x");
    expect(out.metresPerPixel).toBeCloseTo(0.002, 6);
    expect(out.peakSpeed).toBeGreaterThan(0.45);
    expect(out.peakSpeed).toBeLessThan(0.55);

    const data = parseStepCsv(out.csv, "clip.mp4");
    expect(data.uStep).toBe(6);
    const fit = tsEngine.fit(data.t, data.y, data.uStep, 0);
    // v = 0.5 m/s for a 6 V step → K ≈ 0.083 (m/s)/V; τ ≈ 0.3 s (smoothing adds a little lag).
    expect(fit.K).toBeGreaterThan(0.075);
    expect(fit.K).toBeLessThan(0.092);
    expect(fit.tau + fit.theta).toBeGreaterThan(0.2);
    expect(fit.tau + fit.theta).toBeLessThan(0.45);
    expect(fit.r2).toBeGreaterThan(0.95);
  });

  it("measures position too, positive in the direction of travel", () => {
    const mirrored = syntheticClip().map((b) => ({ ...b, x1: 640 - b.x2, x2: 640 - b.x1 }));
    const out = tracksToStepCsv({ boxes: mirrored, fps: 30, lengthM: 0.2, measure: "position", uStep: 1 });
    expect(out.distanceM).toBeGreaterThan(0.8);
  });

  it("refuses clips where the object was barely seen", () => {
    expect(() => tracksToStepCsv({ boxes: syntheticClip().slice(0, 4), fps: 30, lengthM: 0.2, measure: "speed", uStep: 1 })).toThrow(/few frames/);
  });

  it("estimates fps from frame count and duration, with a safe fallback", () => {
    expect(estimateFps(300, 10)).toBe(30);
    expect(estimateFps(5, 10)).toBe(30);
  });
});

describe("trackVideo (stubbed network)", () => {
  let dir: string;
  let calls: string[];

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sam-test-"));
    vi.stubEnv("META_CACHE_DIR", dir);
    vi.stubEnv("MODEL_API_KEY", "test-key");
    vi.stubEnv("META_LIVE", "1");
    vi.stubEnv("META_DAILY_BUDGET_USD", "1");
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url.replace("https://api.meta.ai/v1", "")}`);
        if (url.endsWith("/files")) return new Response(JSON.stringify({ id: "file_1" }), { status: 200 });
        if (url.endsWith("/responses")) {
          const deltas = syntheticClip()
            .slice(0, 20)
            .map((b) => `data: ${JSON.stringify({ type: "response.output_text.delta", delta: `<${b.frame}f>3${box(b.x1, b.y1, b.x2, b.y2)}${mask}` })}`);
          return new Response(deltas.join("\n\n"), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uploads, tracks, deletes the upload, logs the cost, then serves repeats from cache", async () => {
    vi.resetModules();
    const { trackVideo } = await import("@/lib/meta/sam");
    const clip = new Uint8Array([1, 2, 3, 4]);
    const first = await trackVideo(clip, "clip.mp4", "video/mp4", "robot car", 75);
    expect(first.boxes).toHaveLength(20);
    expect(first.objectId).toBe(3);
    expect(first.costUsd).toBeCloseTo(0.015, 6); // 75 frames
    expect(calls).toEqual(["POST /files", "POST /responses", "DELETE /files/file_1"]);
    const log = readFileSync(path.join(dir, "usage.jsonl"), "utf8").trim().split("\n");
    expect(JSON.parse(log[0])).toMatchObject({ model: "sam-3.1", call: "track_video" });

    vi.stubEnv("META_LIVE", "0");
    const again = await trackVideo(clip, "clip.mp4", "video/mp4", "robot car", 75);
    expect(again.cached).toBe(true);
    expect(again.costUsd).toBe(0);
    expect(calls).toHaveLength(3);
  });

  it("makes no call when live mode is off", async () => {
    vi.stubEnv("META_LIVE", "0");
    vi.resetModules();
    const { trackVideo } = await import("@/lib/meta/sam");
    await expect(trackVideo(new Uint8Array([9]), "c.mp4", "video/mp4", "robot", 60)).rejects.toThrow(/off/);
    expect(calls).toHaveLength(0);
  });
});
