import { designFromPrompt, reviseDesign } from "@/lib/create/ai";
import { sanitizeDesign, type Design } from "@/lib/create/design";
import { metaEnabled } from "@/lib/meta/client";

// Muse Spark designs a new machine from a prompt, or revises the current one from a change.
export const maxDuration = 300;

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { prompt?: string; observed?: string; design?: Design; change?: string; history?: string[] };
  if (!metaEnabled()) return Response.json({ error: "New designs are paused on this demo right now. Saved projects still open and simulate." }, { status: 503 });
  try {
    if (body.design && body.change?.trim()) {
      // The client's design is untrusted input: validate it before sending it back to the model.
      const current = sanitizeDesign(body.design, Math.max(1, Math.round(Number(body.design.version) || 1)));
      const r = await reviseDesign(current, body.change.trim().slice(0, 2000), (body.history ?? []).slice(-8).map((h) => String(h).slice(0, 300)));
      return Response.json(r);
    }
    const prompt = (body.prompt ?? "").trim().slice(0, 4000);
    if (!prompt) return Response.json({ error: "Describe what you want to build." }, { status: 400 });
    const r = await designFromPrompt(prompt, body.observed?.slice(0, 6000));
    return Response.json(r);
  } catch (err) {
    console.warn("[create] design failed:", err);
    return Response.json({ error: `Muse Spark couldn't finish the design: ${reason(err)}. Try again.` }, { status: 502 });
  }
}
