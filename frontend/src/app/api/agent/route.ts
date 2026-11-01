import { z } from "zod";
import { MAX_TURNS } from "@/lib/agent/loop";
import { toolDefinitions } from "@/lib/agent/tools";
import { AGENT_MODEL, MetaError, metaChat, metaEnabled } from "@/lib/meta/client";

// One turn of the engineering agent: Muse Wonder reads the conversation (including the results of
// the tools RoboCraft ran in the browser) and decides the next tool call. The tool list is fixed
// server-side; the client can't widen what the model may do.
export const maxDuration = 300;

const Call = z.object({ id: z.string().max(200), type: z.literal("function"), function: z.object({ name: z.string().max(64), arguments: z.string().max(40_000) }) });
const Msg = z.union([
  z.object({ role: z.enum(["developer", "user"]), content: z.string().max(60_000) }),
  z.object({ role: z.literal("assistant"), content: z.string().max(60_000).nullable(), tool_calls: z.array(Call).max(8).optional() }),
  z.object({ role: z.literal("tool"), tool_call_id: z.string().max(200), content: z.string().max(200_000) }),
]);
const Body = z.object({ messages: z.array(Msg).min(2).max(MAX_TURNS * 10) });

export async function POST(req: Request) {
  if (!metaEnabled()) return Response.json({ error: "The engineering agent is paused on this demo right now (live AI is off)." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Malformed agent conversation." }, { status: 400 });
  try {
    const turn = await metaChat({ messages: parsed.data.messages, tools: toolDefinitions(), model: AGENT_MODEL, label: "engineering_agent" });
    return Response.json(turn);
  } catch (err) {
    const status = err instanceof MetaError && err.status === 429 ? 429 : 502;
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

export function GET() {
  return Response.json({ model: AGENT_MODEL, live: metaEnabled(), maxTurns: MAX_TURNS });
}
