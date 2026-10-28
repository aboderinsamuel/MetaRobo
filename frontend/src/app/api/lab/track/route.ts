// POST multipart { video, prompt, frames } -> TrackResult
// Tracks one object through a short phone clip with SAM 3.1. The browser turns the boxes into a
// motion curve and fits a physics model from it (see lib/lab/video.ts).
import { describeError } from "@/lib/lab/ai";
import { metaEnabled } from "@/lib/meta/client";
import { trackVideo } from "@/lib/meta/sam";

export const maxDuration = 300;

const MAX_BYTES = 60 * 1024 * 1024;
// About 20 s at 30 fps; longer clips cost more and track less reliably.
const MAX_FRAMES = 600;
const TYPES = new Set(["video/mp4", "video/quicktime"]);

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const video = form?.get("video");
  const prompt = String(form?.get("prompt") ?? "").trim().slice(0, 60);
  const frames = Math.round(Number(form?.get("frames")));
  if (!(video instanceof File)) return Response.json({ error: "Choose a video first." }, { status: 400 });
  if (!TYPES.has(video.type)) return Response.json({ error: "Use an MP4 or MOV clip (WebM isn't supported by SAM 3.1)." }, { status: 400 });
  if (video.size > MAX_BYTES) return Response.json({ error: "That clip is over 60 MB. Trim it to a few seconds." }, { status: 400 });
  if (!prompt) return Response.json({ error: "Say what moves in the clip, e.g. \"robot car\"." }, { status: 400 });
  if (!Number.isFinite(frames) || frames < 1 || frames > MAX_FRAMES) return Response.json({ error: "Keep the clip under 20 seconds." }, { status: 400 });

  try {
    const result = await trackVideo(new Uint8Array(await video.arrayBuffer()), video.name || "clip.mp4", video.type, prompt, frames);
    if (!result.boxes.length) return Response.json({ error: `SAM 3.1 couldn't find "${prompt}" in the clip. Try a simpler name for it.`, ...result }, { status: 422 });
    return Response.json(result);
  } catch (err) {
    const status = !metaEnabled() ? 503 : 502;
    return Response.json({ error: `Video tracking failed: ${describeError(err)}` }, { status });
  }
}
