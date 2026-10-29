import { readScene } from "@/lib/create/ai";
import { metaEnabled } from "@/lib/meta/client";

// Muse Spark vision: keyframes from the user's video → a structured scene description.
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { images?: string[]; note?: string };
  if (!metaEnabled()) return Response.json({ error: "Video reading is paused on this demo right now." }, { status: 503 });
  const images = (body.images ?? []).filter((s) => typeof s === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(s) && s.length < 4_000_000).slice(0, 12);
  if (images.length < 2) return Response.json({ error: "Send at least two keyframes." }, { status: 400 });
  try {
    return Response.json(await readScene(images, (body.note ?? "").slice(0, 500)));
  } catch (err) {
    console.warn("[create] vision failed:", err);
    return Response.json({ error: `Muse Spark couldn't read the video: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}
