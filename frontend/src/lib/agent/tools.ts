// The engineering agent's tools. The model decides what to do; these do it, deterministically, with
// RoboCraft's own physics simulation and engineering checks. Nothing the model says is taken as a
// result: every number it sees comes back from here.
import { z } from "zod";
import { sanitizeDesign, type Design, type DesignAi } from "@/lib/create/design";
import { ACTUATORS, knownActuator, overview } from "@/lib/create/engineering";
import type { Recording } from "@/lib/create/sim";

export type Simulate = (design: Design) => Promise<Recording>;

/** What the agent is working on: the current design and its latest simulation. */
export interface AgentState {
  design: Design;
  recording: Recording | null;
  simulations: number;
  revisions: number;
}

export const LIMITS = { simulations: 6, revisions: 4 } as const;

// ------------------------------------------------------------------------------ measurements

/** The numbers that decide whether a design is better: task success and hardware errors. */
export interface Score {
  stepsOk: number;
  steps: number;
  errors: number;
  warnings: number;
  overloaded: number;
  massKg: number;
}

export function score(d: Design, rec: Recording): Score {
  const o = overview(d, rec);
  return {
    stepsOk: rec.steps.filter((s) => s.ok).length,
    steps: rec.steps.length,
    errors: o.errors,
    warnings: o.warnings,
    overloaded: o.loads.filter((l) => l.status === "over").length,
    massKg: Math.round(rec.massKg * 100) / 100,
  };
}

/** Higher is better: every succeeded step counts, every hardware error costs as much as a step. */
export const merit = (s: Score) => s.stepsOk - s.errors - 0.25 * s.overloaded;

// ------------------------------------------------------------------------------ revisions

const Name = z.string().min(1).max(80);
export const Change = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_actuator"), node: Name, actuator: z.string().min(1).max(80).describe("A library id (see inspect_design) or 'need:<real part name>'"), torqueNm: z.number().min(0).max(2000).describe("Its rated continuous torque, N·m (ignored for library ids, which use the datasheet value)") }),
  z.object({ op: z.literal("set_joint_limits"), node: Name, min: z.number(), max: z.number(), rest: z.number() }),
  z.object({ op: z.literal("set_joint_speed"), node: Name, speed: z.number().min(1).max(2000).describe("deg/s or m/s") }),
  z.object({ op: z.literal("resize_part"), node: Name, scale: z.array(z.number().min(0.4).max(2.5)).length(3).describe("Multipliers for the part's x, y, z size; its children move with it along the long axis") }),
  z.object({ op: z.literal("move_object"), object: Name, position: z.array(z.number().min(-20).max(20)).length(3).describe("New world position, metres (y up, floor 0)") }),
  z.object({ op: z.literal("set_object_mass"), object: Name, massKg: z.number().min(0.001).max(500) }),
  z.object({ op: z.literal("set_step"), index: z.number().int().min(0).max(80), at: z.array(z.number().min(-5).max(5)).length(3).describe("The step's offset or position, metres"), duration: z.number().min(0.2).max(30) }),
]);
export type Change = z.infer<typeof Change>;

export const ReviseArgs = z.object({
  rationale: z.string().min(1).max(600).describe("Which measured failure this fixes and why the change should fix it"),
  changes: z.array(Change).min(1).max(8),
});

export const FinishArgs = z.object({
  verdict: z.enum(["validated", "improved", "limited"]).describe("validated: every step succeeds with no hardware errors; improved: better than the start but not clean; limited: no change helped"),
  summary: z.string().min(1).max(900).describe("What was wrong, what you changed, and the measured before/after"),
  remaining: z.array(z.string().max(240)).max(6).describe("Honest open issues, e.g. what the simulation doesn't model"),
});

/** Mirrored parts are edited together: l_* also changes its r_* twin. */
const twins = (d: Design, id: string) => {
  const ids = [id];
  const twin = id.startsWith("l_") ? `r_${id.slice(2)}` : id.startsWith("r_") ? `l_${id.slice(2)}` : null;
  if (twin && d.robot.nodes.some((n) => n.id === twin)) ids.push(twin);
  return ids;
};

/** Apply validated changes; returns the new (re-sanitised) design and what happened to each change. */
export function applyChanges(d: Design, changes: Change[]): { design: Design; applied: string[]; rejected: string[] } {
  const next: DesignAi = structuredClone({ ...d, version: undefined }) as unknown as DesignAi;
  const applied: string[] = [];
  const rejected: string[] = [];
  const node = (id: string) => next.robot.nodes.find((n) => n.id === id);
  const object = (id: string) => next.scene.find((o) => o.id === id);
  for (const c of changes) {
    switch (c.op) {
      case "set_actuator": {
        const targets = twins(d, c.node).map(node).filter((n) => n && n.joint.type !== "fixed");
        if (!targets.length) { rejected.push(`set_actuator: no moving joint "${c.node}"`); break; }
        const lib = knownActuator(c.actuator);
        if (!lib && !c.actuator.startsWith("need:")) { rejected.push(`set_actuator: "${c.actuator}" is neither a library id nor need:<part>`); break; }
        for (const n of targets) n!.joint = { ...n!.joint, actuator: c.actuator, torqueNm: lib ? lib.ratedNm : c.torqueNm, speed: lib ? Math.min(n!.joint.speed, lib.speed) : n!.joint.speed };
        applied.push(`${targets.map((n) => n!.id).join(" + ")} → ${lib ? `${lib.name} (${lib.ratedNm} N·m)` : `${c.actuator} (${c.torqueNm} N·m)`}`);
        break;
      }
      case "set_joint_limits": {
        const targets = twins(d, c.node).map(node).filter((n) => n && n.joint.type !== "fixed");
        if (!targets.length || c.min >= c.max) { rejected.push(`set_joint_limits: invalid for "${c.node}"`); break; }
        for (const n of targets) n!.joint = { ...n!.joint, min: c.min, max: c.max, rest: Math.min(c.max, Math.max(c.min, c.rest)) };
        applied.push(`${c.node} limits ${c.min}…${c.max} (rest ${c.rest})`);
        break;
      }
      case "set_joint_speed": {
        const targets = twins(d, c.node).map(node).filter((n) => n && n.joint.type !== "fixed");
        if (!targets.length) { rejected.push(`set_joint_speed: no moving joint "${c.node}"`); break; }
        for (const n of targets) n!.joint = { ...n!.joint, speed: c.speed };
        applied.push(`${c.node} speed ${c.speed}`);
        break;
      }
      case "resize_part": {
        const targets = twins(d, c.node).map(node).filter(Boolean);
        if (!targets.length) { rejected.push(`resize_part: no part "${c.node}"`); break; }
        for (const n of targets) {
          const before = [...n!.dims];
          n!.dims = n!.dims.map((v, i) => v * c.scale[i]);
          n!.offset = n!.offset.map((v, i) => v * c.scale[i]);
          // Children hang off the part's far end: move them with it.
          for (const ch of next.robot.nodes.filter((x) => x.parent === n!.id)) ch.position = ch.position.map((v, i) => (Math.abs(v) > 1e-6 && before[i] > 0 ? v * c.scale[i] : v));
        }
        applied.push(`${c.node} size ×[${c.scale.map((s) => s.toFixed(2)).join(", ")}]`);
        break;
      }
      case "move_object": {
        const o = object(c.object);
        if (!o) { rejected.push(`move_object: no object "${c.object}"`); break; }
        o.position = [...c.position];
        applied.push(`${c.object} → [${c.position.map((v) => v.toFixed(2)).join(", ")}]`);
        break;
      }
      case "set_object_mass": {
        const o = object(c.object);
        if (!o) { rejected.push(`set_object_mass: no object "${c.object}"`); break; }
        o.massKg = c.massKg;
        applied.push(`${c.object} mass ${c.massKg} kg`);
        break;
      }
      case "set_step": {
        const s = next.task[c.index];
        if (!s) { rejected.push(`set_step: no step ${c.index}`); break; }
        s.at = [...c.at];
        s.duration = c.duration;
        applied.push(`step ${c.index + 1} "${s.label}" at [${c.at.map((v) => v.toFixed(2)).join(", ")}], ${c.duration}s`);
        break;
      }
    }
  }
  return { design: sanitizeDesign(next, d.version + 1), applied, rejected };
}

// ------------------------------------------------------------------------------ what the model sees

/** A compact, model-readable description of the design (ids it can act on, ratings, the task). */
export function describeDesign(d: Design) {
  return {
    title: d.title,
    mobility: d.robot.mobility,
    joints: d.robot.nodes
      .filter((n) => n.joint.type !== "fixed")
      .map((n) => ({ node: n.id, role: n.role, type: n.joint.type, parent: n.parent, limits: [n.joint.min, n.joint.max], actuator: n.joint.actuator, ratedNm: n.joint.torqueNm, speed: n.joint.speed, sizeM: n.dims.map((v) => +v.toFixed(3)) })),
    links: d.robot.nodes.filter((n) => n.joint.type === "fixed").map((n) => ({ node: n.id, role: n.role, parent: n.parent, sizeM: n.dims.map((v) => +v.toFixed(3)), material: n.material })),
    effectors: d.robot.effectors.map((e) => ({ id: e.id, node: e.node, kind: e.kind, maxPayloadKg: e.maxPayloadKg })),
    scene: d.scene.map((o) => ({ object: o.id, kind: o.kind, position: o.position.map((v) => +v.toFixed(3)), sizeM: o.dims.map((v) => +v.toFixed(3)), massKg: o.massKg })),
    task: d.task.map((s, i) => ({ index: i, label: s.label, action: s.action, effector: s.effector, target: s.target, at: s.at, duration: s.duration })),
    actuatorLibrary: ACTUATORS.map((a) => ({ id: a.id, name: a.name, kind: a.kind, ratedNm: a.ratedNm, speed: a.speed, massKg: a.massKg, usd: a.usd })),
  };
}

/** The simulation and engineering results, as the model sees them. */
export function describeResults(d: Design, rec: Recording) {
  const o = overview(d, rec);
  return {
    score: score(d, rec),
    failedSteps: rec.steps.map((s, i) => ({ index: i, label: s.label, action: s.action, ok: s.ok, note: s.note })).filter((s) => !s.ok),
    hardwareChecks: o.checks.filter((c) => c.severity === "error" || c.severity === "warning").map((c) => ({ severity: c.severity, title: c.title, detail: c.detail, basis: c.basis })),
    jointLoads: o.loads.filter((l) => l.status !== "ok").map((l) => ({ node: l.node.id, status: l.status, peakNm: +l.peakNm.toFixed(2), ratedNm: +l.ratedNm.toFixed(2), suggested: l.upgrade?.id })),
  };
}

// ------------------------------------------------------------------------------ the tool set

export const TOOLS = [
  {
    name: "inspect_design",
    description: "Read the current design: its moving joints (ids, limits, actuators and ratings), links, effectors, scene objects, task steps, and the actuator library you can choose from.",
    args: z.object({}),
  },
  {
    name: "run_simulation",
    description: "Run RoboCraft's physics simulation (rigid bodies, cloth, inverse kinematics) of the current design doing its task, plus the engineering checks. Returns which steps failed and why, hardware errors, and overloaded joints. This is the only source of truth about whether the design works.",
    args: z.object({}),
  },
  {
    name: "revise_design",
    description: "Change the design to fix measured failures. Use the ids from inspect_design. Mirrored parts (l_/r_) change together. Returns what was applied or rejected; run_simulation afterwards to measure the effect.",
    args: ReviseArgs,
  },
  {
    name: "finish",
    description: "End the session with an honest verdict, based only on simulation results.",
    args: FinishArgs,
  },
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

/** OpenAI-compatible tool definitions for the Meta Chat Completions API. */
export function toolDefinitions() {
  return TOOLS.map((t) => {
    const params = z.toJSONSchema(t.args) as Record<string, unknown>;
    delete params.$schema;
    return { type: "function" as const, function: { name: t.name, description: t.description, parameters: params } };
  });
}

export interface ToolOutcome {
  /** JSON string handed back to the model */
  content: string;
  /** for the UI */
  summary: string;
  score?: Score;
  applied?: string[];
  rejected?: string[];
  finish?: z.infer<typeof FinishArgs>;
  error?: boolean;
}

/** Execute one tool call against the state. Bad arguments come back to the model as errors, never as crashes. */
export async function runTool(name: string, rawArgs: string, state: AgentState, simulate: Simulate): Promise<ToolOutcome> {
  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { content: JSON.stringify({ error: "Arguments were not valid JSON." }), summary: "Invalid arguments", error: true };
  }
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: JSON.stringify({ error: `Unknown tool ${name}.` }), summary: `Unknown tool ${name}`, error: true };
  const parsed = tool.args.safeParse(args);
  if (!parsed.success) return { content: JSON.stringify({ error: "Arguments don't match the schema.", issues: parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`) }), summary: "Rejected: arguments didn't match the schema", error: true };

  switch (tool.name) {
    case "inspect_design":
      return { content: JSON.stringify(describeDesign(state.design)), summary: `Read ${state.design.robot.nodes.length} parts, ${state.design.task.length} steps` };
    case "run_simulation": {
      if (state.simulations >= LIMITS.simulations) return { content: JSON.stringify({ error: `Simulation budget used (${LIMITS.simulations}). Call finish.` }), summary: "Simulation budget used", error: true };
      state.recording = await simulate(state.design);
      state.simulations++;
      const res = describeResults(state.design, state.recording);
      const s = res.score;
      return { content: JSON.stringify(res), summary: `${s.stepsOk}/${s.steps} steps succeed · ${s.errors} errors · ${s.overloaded} overloaded joints`, score: s };
    }
    case "revise_design": {
      if (state.revisions >= LIMITS.revisions) return { content: JSON.stringify({ error: `Revision budget used (${LIMITS.revisions}). Call finish.` }), summary: "Revision budget used", error: true };
      const a = parsed.data as z.infer<typeof ReviseArgs>;
      const r = applyChanges(state.design, a.changes);
      if (!r.applied.length) return { content: JSON.stringify({ applied: [], rejected: r.rejected, note: "Nothing changed." }), summary: "No change applied", rejected: r.rejected, error: true };
      state.design = r.design;
      state.recording = null;
      state.revisions++;
      return { content: JSON.stringify({ applied: r.applied, rejected: r.rejected, note: "Not simulated yet: call run_simulation to measure the effect." }), summary: a.rationale, applied: r.applied, rejected: r.rejected };
    }
    case "finish": {
      const f = parsed.data as z.infer<typeof FinishArgs>;
      return { content: JSON.stringify({ ok: true }), summary: f.summary, finish: f };
    }
  }
}
