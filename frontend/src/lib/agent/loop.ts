// The closed engineering loop: Muse Wonder plans and decides; RoboCraft's tools simulate, check and
// revise. Plan → simulate → diagnose → revise → re-simulate, bounded, until the physics says the
// design works or the budget runs out. The best design the physics measured is kept, whatever the
// model claims. Runs the same in the browser (worker simulation) and in tests (fake model).
import type { Design } from "@/lib/create/design";
import { LIMITS, merit, runTool, score, toolDefinitions, type AgentState, type Score, type Simulate, type ToolOutcome } from "./tools";

export const MAX_TURNS = 12;

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export type Message =
  | { role: "developer" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ModelTurn {
  message: { content: string | null; tool_calls?: ToolCall[] };
  usage?: { costUsd: number; inputTokens: number; outputTokens: number };
  cached?: boolean;
  model?: string;
}
export type CallModel = (messages: Message[], tools: ReturnType<typeof toolDefinitions>) => Promise<ModelTurn>;

export type AgentEvent =
  | { kind: "thought"; turn: number; text: string }
  | { kind: "tool"; turn: number; name: string; args: unknown; outcome: ToolOutcome }
  | { kind: "design"; design: Design; label: string }
  | { kind: "turn"; turn: number; costUsd: number; cached: boolean; model?: string }
  | { kind: "done"; result: AgentResult };

export interface AgentResult {
  verdict: "validated" | "improved" | "limited" | "stopped";
  summary: string;
  remaining: string[];
  before: Score | null;
  after: Score | null;
  /** the best design the simulation measured (the starting one if nothing beat it) */
  design: Design;
  turns: number;
  simulations: number;
  revisions: number;
  costUsd: number;
}

export const AGENT_SYSTEM = `You are RoboCraft's engineering agent. You make a robot design actually work, measured by a physics simulation, not by your own judgement.

You have tools:
- inspect_design: the design's joints, links, effectors, scene, task steps and the actuator library.
- run_simulation: the physics simulation of the task plus engineering checks. It is the only source of truth.
- revise_design: concrete changes (actuators, joint limits and speeds, part sizes, object positions and masses, step offsets and durations).
- finish: your verdict.

Method:
1. Inspect the design, then run the simulation to get a baseline.
2. Diagnose the root cause of each failure from the measured data: an overloaded joint needs an actuator that holds its measured peak torque with margin (≥1.3×); a reach that falls short needs longer links, a better position, or an object moved within reach; a step that times out may need more duration or a joint speed within the actuator's rating.
3. Make the smallest set of changes that addresses the root causes, in one revise_design call, with a rationale citing the measured numbers.
4. Run the simulation again and compare with the baseline. Keep what helped; undo or try another approach if it got worse.
5. Stop with finish as soon as every step succeeds with no hardware errors, or when you run out of useful ideas. Budget: ${LIMITS.simulations} simulations and ${LIMITS.revisions} revisions.

Rules: never claim a result the simulation didn't report. Prefer real library actuators (by id) over invented ones. Don't change what the robot is for or remove task steps to make the score look better. Keep each turn short: think briefly, then call a tool.`;

/** Run the agent on a design. `onEvent` streams progress to the UI. */
export async function runAgent(opts: {
  design: Design;
  goal: string;
  callModel: CallModel;
  simulate: Simulate;
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
  maxTurns?: number;
}): Promise<AgentResult> {
  const { callModel, simulate, onEvent = () => {}, signal } = opts;
  const maxTurns = opts.maxTurns ?? MAX_TURNS;
  const state: AgentState = { design: opts.design, recording: null, simulations: 0, revisions: 0 };
  const tools = toolDefinitions();
  const messages: Message[] = [
    { role: "developer", content: AGENT_SYSTEM },
    { role: "user", content: `Design: "${opts.design.title}". ${opts.design.summary}\n\nGoal: ${opts.goal}` },
  ];

  let before: Score | null = null;
  let best: { design: Design; score: Score } | null = null;
  let costUsd = 0;
  let finish: ToolOutcome["finish"] | undefined;
  let turn = 0;

  for (; turn < maxTurns && !finish; turn++) {
    if (signal?.aborted) break;
    const res = await callModel(messages, tools);
    costUsd += res.usage?.costUsd ?? 0;
    onEvent({ kind: "turn", turn, costUsd, cached: !!res.cached, model: res.model });
    const calls = res.message.tool_calls ?? [];
    messages.push({ role: "assistant", content: res.message.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (res.message.content?.trim()) onEvent({ kind: "thought", turn, text: res.message.content.trim() });
    if (!calls.length) {
      // The model answered in text instead of calling a tool: nudge it once more, then stop.
      messages.push({ role: "user", content: "Continue by calling a tool (run_simulation, revise_design or finish)." });
      continue;
    }
    for (const call of calls) {
      if (signal?.aborted) break;
      const designBefore = state.design;
      const outcome = await runTool(call.function.name, call.function.arguments, state, simulate);
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {}
      onEvent({ kind: "tool", turn, name: call.function.name, args, outcome });
      messages.push({ role: "tool", tool_call_id: call.id, content: outcome.content });
      if (state.design !== designBefore) onEvent({ kind: "design", design: state.design, label: outcome.summary });
      if (outcome.score && state.recording) {
        if (!before) before = outcome.score;
        if (!best || merit(outcome.score) > merit(best.score)) best = { design: state.design, score: outcome.score };
      }
      if (outcome.finish) finish = outcome.finish;
    }
  }

  // The physics has the last word: the best measured design, re-measured if the last change wasn't simulated.
  let after = best?.score ?? null;
  let design = best?.design ?? opts.design;
  if (state.recording === null && state.revisions > 0 && state.simulations < LIMITS.simulations + 1 && !signal?.aborted) {
    const rec = await simulate(state.design);
    const s = score(state.design, rec);
    if (!best || merit(s) > merit(best.score)) {
      after = s;
      design = state.design;
    }
  }
  const verdict: AgentResult["verdict"] = finish
    ? after && after.stepsOk === after.steps && after.errors === 0
      ? "validated"
      : finish.verdict === "validated"
        ? "improved" // the model said validated, the numbers say otherwise
        : finish.verdict
    : "stopped";
  const result: AgentResult = {
    verdict,
    summary: finish?.summary ?? (signal?.aborted ? "Stopped." : `Stopped after ${turn} turns without a verdict.`),
    remaining: finish?.remaining ?? [],
    before,
    after,
    design,
    turns: turn,
    simulations: state.simulations,
    revisions: state.revisions,
    costUsd,
  };
  onEvent({ kind: "done", result });
  return result;
}
