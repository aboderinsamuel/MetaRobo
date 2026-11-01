// POST { question, context, history?, model? } -> { reply, mode, actions, usage }
// The Control Lab's assistant: Muse Spark or Muse Wonder reads the machine's live state and answers,
// or returns actions. The client checks every action against the real catalogue and limits before
// applying it.
import { z } from "zod";
import { aiEnabled, describeError } from "@/lib/lab/ai";
import { ASSIST_SYSTEM, AssistOut } from "@/lib/lab/assist";
import { metaJson } from "@/lib/meta/client";
import { pickModel } from "@/lib/meta/models";

export const maxDuration = 120;

const Body = z.object({
  question: z.string().min(1).max(2000),
  context: z.string().max(60_000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) }))
    .max(8)
    .optional(),
  model: z.string().max(40).optional(),
});

export async function POST(req: Request) {
  if (!aiEnabled()) return Response.json({ error: "Live AI is paused on this server, so the assistant can't answer right now. Checks, one-click fixes and auto-tune still work." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Malformed request." }, { status: 400 });
  const { question, context, history = [], model } = parsed.data;
  try {
    const res = await metaJson({
      schema: AssistOut,
      schemaName: "lab_assistant",
      system: ASSIST_SYSTEM,
      user: [
        `Machine state:\n${context}`,
        history.length ? `Conversation so far:\n${history.map((h) => `${h.role === "user" ? "User" : "You"}: ${h.text}`).join("\n")}` : "",
        `User: ${question}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 6000,
      effort: "low",
      model: pickModel(model, "muse-spark-1.3"),
    });
    return Response.json({
      ...res.data,
      usage: { model: res.model, cached: res.cached, tokens: res.usage.inputTokens + res.usage.outputTokens, costUsd: res.usage.costUsd },
    });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
}
