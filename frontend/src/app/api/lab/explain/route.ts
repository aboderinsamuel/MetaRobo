// POST { model, controller, history?, question?, offline? } -> Advice
// The server re-runs the simulation itself, so the explanation is always grounded in real numbers.
// `offline: true` (used for the automatic explanation when a design loads) never spends Meta credit;
// Muse Spark is only called when the user asks.
import { aiEnabled, describeError, explain, offlineExplain } from "@/lib/lab/ai";
import { autoTune } from "@/lib/lab/advisor";
import { run } from "@/lib/lab/analysis";
import type { ControllerSpec, LabModel } from "@/lib/lab/types";
import { pickModel } from "@/lib/meta/models";
import { tsEngine } from "@/lib/sim/engine";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    model?: LabModel;
    controller?: ControllerSpec;
    history?: { label: string; controller: ControllerSpec; summary: string }[];
    question?: string;
    offline?: boolean;
    /** Which Meta model explains: Muse Spark (default) or Muse Wonder. */
    llm?: string;
  } | null;
  if (!body?.model || !body.controller) return Response.json({ error: "model and controller are required" }, { status: 400 });
  const { model, controller } = body;
  let analysis;
  try {
    analysis = run(tsEngine, model, controller).analysis;
  } catch {
    return Response.json({ error: "Could not simulate that model." }, { status: 400 });
  }
  if (aiEnabled() && !body.offline) {
    try {
      return Response.json(await explain(model, controller, analysis, (body.history ?? []).slice(-6), body.question?.slice(0, 2000), pickModel(body.llm, "muse-spark-1.3")));
    } catch (err) {
      const advice = offlineExplain(model, controller, analysis);
      return Response.json({ ...advice, notice: `The Meta model was unavailable (${describeError(err)}); this explanation comes from the offline advisor.` });
    }
  }
  const advice = offlineExplain(model, controller, analysis);
  if (!advice.meetsSpecs) {
    const tuned = autoTune(tsEngine, model, controller, 80);
    advice.proposals.unshift({ label: "Auto-tuned gains", rationale: "Searched with the simulator in the loop to meet every spec with the least tracking error.", controller: tuned });
    advice.proposals = advice.proposals.slice(0, 3);
  }
  return Response.json(advice);
}
