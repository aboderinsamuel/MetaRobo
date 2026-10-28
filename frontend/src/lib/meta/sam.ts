// SAM 3.1 video tracking through the Meta Model API, under the same credit rules as client.ts:
// off unless live, cached by a hash of the video + prompt, cost logged, daily cap enforced.
//
// SAM streams one text line per frame: `<Nf>` then, for each match, an object id, a box token and a
// mask token. We only need the boxes, so masks are dropped before parsing.
// Docs: dev.meta.ai/docs/sam/segmenting, dev.meta.ai/docs/sam/reading-segmentation
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { BASE_URL, MetaError, assertCanSpend, cachePath, recordUsage, zeroUsage } from "./client";

export const SAM_MODEL = "sam-3.1";
// $0.20 per 1,000 video frames, billed for at least 50 frames per request.
const USD_PER_FRAME = 0.0002;
const MIN_FRAMES = 50;

export interface SamBox {
  frame: number;
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Source frame size the box coordinates refer to. */
  w: number;
  h: number;
}

export interface TrackResult {
  /** Boxes of the most-tracked object, sorted by frame. */
  boxes: SamBox[];
  objectId: number | null;
  /** Highest frame index SAM reported, plus one. */
  frameCount: number;
  cached: boolean;
  costUsd: number;
}

export function samCost(frames: number): number {
  return Math.max(MIN_FRAMES, frames) * USD_PER_FRAME;
}

/** Parses SAM's special-token text into boxes. Fields are read by key, never by position. */
export function parseSamText(text: string): SamBox[] {
  const noMasks = text.replace(/<\|mask;[^|]*\|>/g, "");
  const out: SamBox[] = [];
  // split with a capture group gives [before, frame, records, frame, records, ...]
  const parts = noMasks.split(/<(\d+)f>/);
  for (let p = 1; p + 1 < parts.length; p += 2) {
    const frame = Number(parts[p]);
    for (const bm of parts[p + 1].matchAll(/(\d+)\s*<\|box;([^|]*)\|>/g)) {
      const f: Record<string, number> = {};
      for (const kv of bm[2].split(";")) {
        const [k, v] = kv.split("=");
        if (k && v !== undefined) f[k.trim()] = Number(v);
      }
      if ([f.x1, f.y1, f.x2, f.y2, f.w, f.h].some((v) => !Number.isFinite(v))) continue;
      out.push({ frame, id: Number(bm[1]), x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, w: f.w, h: f.h });
    }
  }
  return out;
}

/** Keeps the object SAM followed through the most frames (ids are stable within one response). */
export function mainTrack(boxes: SamBox[]): { id: number | null; boxes: SamBox[] } {
  const counts = new Map<number, number>();
  for (const b of boxes) counts.set(b.id, (counts.get(b.id) ?? 0) + 1);
  let id: number | null = null;
  for (const [k, n] of counts) if (id === null || n > (counts.get(id) ?? 0)) id = k;
  const seen = new Set<number>();
  const track = boxes
    .filter((b) => b.id === id)
    .sort((a, b) => a.frame - b.frame)
    .filter((b) => (seen.has(b.frame) ? false : (seen.add(b.frame), true)));
  return { id, boxes: track };
}

/** Collects the text deltas from a Responses API event stream (or a plain JSON response). */
export function streamText(body: string): string {
  if (!body.includes("data:")) {
    try {
      const j = JSON.parse(body) as { output_text?: string; output?: { content?: { text?: string }[] }[] };
      return j.output_text ?? j.output?.flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("") ?? "";
    } catch {
      return "";
    }
  }
  let text = "";
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const ev = JSON.parse(data) as { type?: string; delta?: string };
      if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") text += ev.delta + "\n";
    } catch {
      // Ignore keep-alives and partial lines.
    }
  }
  return text;
}

function auth(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.MODEL_API_KEY}` };
}

/**
 * Tracks `prompt` (a short noun phrase, e.g. "robot car") through a video clip.
 * `frameEstimate` is the client's guess of the clip's frame count, used to cost the call.
 */
export async function trackVideo(video: Uint8Array, filename: string, mime: string, prompt: string, frameEstimate: number): Promise<TrackResult> {
  const key = createHash("sha256").update(SAM_MODEL).update("\0").update(prompt).update("\0").update(video).digest("hex");
  const file = await cachePath(key);
  try {
    const hit = JSON.parse(await readFile(file, "utf8")) as { text: string };
    const all = parseSamText(hit.text);
    const t = mainTrack(all);
    return { boxes: t.boxes, objectId: t.id, frameCount: maxFrame(all), cached: true, costUsd: 0 };
  } catch {
    // Not cached: go live.
  }

  await assertCanSpend();

  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new Blob([video as BlobPart], { type: mime }), filename);
  const up = await fetch(`${BASE_URL}/files`, { method: "POST", headers: auth(), body: form, signal: AbortSignal.timeout(120_000) });
  const upJson = (await up.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null;
  if (!up.ok || !upJson?.id) throw new MetaError(upJson?.error?.message ?? `Video upload failed (${up.status})`, up.status);

  try {
    const res = await fetch(`${BASE_URL}/responses`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model: SAM_MODEL,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_video", file_id: upJson.id }] }],
        stream: true,
      }),
      signal: AbortSignal.timeout(280_000),
    });
    const body = await res.text();
    if (!res.ok) {
      let msg = `SAM 3.1 error ${res.status}`;
      try {
        msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? msg;
      } catch {}
      throw new MetaError(msg, res.status);
    }
    const text = streamText(body);
    const all = parseSamText(text);
    const costUsd = samCost(Math.max(frameEstimate, maxFrame(all)));
    await recordUsage(SAM_MODEL, "track_video", { ...zeroUsage(), costUsd });
    await writeFile(file, JSON.stringify({ model: SAM_MODEL, prompt, text })).catch(() => {});
    const t = mainTrack(all);
    return { boxes: t.boxes, objectId: t.id, frameCount: maxFrame(all), cached: false, costUsd };
  } finally {
    // Don't leave the clip stored on Meta's side.
    await fetch(`${BASE_URL}/files/${upJson.id}`, { method: "DELETE", headers: auth() }).catch(() => {});
  }
}

function maxFrame(boxes: SamBox[]): number {
  return boxes.reduce((m, b) => Math.max(m, b.frame + 1), 0);
}
