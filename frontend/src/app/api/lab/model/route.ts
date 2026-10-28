// POST { description, dataSummary?, presetId? } -> { model, notice? }
import { aiEnabled, describeError, modelFromDescription, offlineModel } from "@/lib/lab/ai";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { description?: string; dataSummary?: string; presetId?: string };
  const description = (body.description ?? "").slice(0, 4000).trim();
  if (body.presetId || !aiEnabled()) return Response.json(offlineModel(description, body.presetId));
  if (!description) return Response.json({ error: "Describe the system first." }, { status: 400 });
  try {
    return Response.json(await modelFromDescription(description, body.dataSummary?.slice(0, 4000)));
  } catch (err) {
    const fallback = offlineModel(description);
    return Response.json({ ...fallback, notice: `Muse Spark modeling failed (${describeError(err)}). Loaded the closest model from the offline physics library instead.` });
  }
}
