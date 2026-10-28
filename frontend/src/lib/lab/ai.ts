// Server-side Meta Muse Spark integration for the Control Lab.
//
// Muse Spark does two jobs: turn a plain-language description (or identified step data) into a
// physical model + starting controller, and explain a simulated response with proposed fixes.
// Everything it returns is checked numerically before the studio uses it, and every route
// falls back to the offline library in presets.ts / advisor.ts when live calls are off.
import { z } from "zod";
import { MetaError, TEXT_MODEL, metaEnabled, metaJson } from "@/lib/meta/client";
import { tsEngine } from "@/lib/sim/engine";
import { offlineAdvice } from "./advisor";
import { checkSpecs, fmtNum, run } from "./analysis";
import { matchPreset, presetById } from "./presets";
import type { Advice, Analysis, ControllerSpec, LabModel, PlantSpec } from "./types";

export const MODEL_ID = TEXT_MODEL;

export function aiEnabled(): boolean {
  return metaEnabled();
}

// Flat schemas: unused fields are empty arrays / zeros. Flat shapes are easier for the model to
// fill reliably than nested unions, and we convert to the app's types afterwards.
const ControllerOut = z.object({
  type: z.enum(["pid", "lqr"]),
  kp: z.number(),
  ki: z.number(),
  kd: z.number(),
  N: z.number().describe("Derivative filter cutoff in rad/s (PID only, typically 5-20x the desired bandwidth)"),
  Q: z.array(z.number()).describe("LQR state weights, one per state (LQR only, else [])"),
  R: z.number().describe("LQR input weight (LQR only, else 1)"),
});

const ModelOut = z.object({
  rig: z.object({
    kind: z.enum(["rover", "arm", "balancer", "drone"]).describe("Closest built-in 3D hardware rig"),
    signal: z.enum(["speed", "position", "angle", "altitude"]).describe("What the output means on that rig"),
  }),
  title: z.string(),
  summary: z.string().describe("2-3 plain sentences: what the system is and what we control"),
  domain: z.string(),
  input: z.object({ name: z.string(), unit: z.string() }),
  output: z.object({ name: z.string(), unit: z.string() }),
  params: z.array(z.object({ symbol: z.string(), name: z.string(), value: z.number(), unit: z.string() })),
  equations: z.array(z.string()).describe("Governing equations in plain-text math, e.g. 'J dω/dt = Kt i − b ω'"),
  assumptions: z.array(z.string()),
  plant: z.object({
    kind: z.enum(["tf", "ss"]),
    num: z.array(z.number()).describe("TF numerator, descending powers of s ([] for ss)"),
    den: z.array(z.number()).describe("TF denominator, descending powers of s ([] for ss)"),
    A: z.array(z.array(z.number())).describe("State matrix rows ([] for tf)"),
    B: z.array(z.number()),
    C: z.array(z.number()),
    stateNames: z.array(z.string()),
    delay: z.number().describe("Pure input/measurement dead time in seconds, 0 if none"),
  }),
  controller: ControllerOut,
  controllerRationale: z.string(),
  specs: z.object({
    maxOvershootPct: z.number(),
    maxSettlingTime: z.number(),
    maxSsErrorPct: z.number(),
    uMin: z.number().describe("Physical actuator lower limit in input units"),
    uMax: z.number().describe("Physical actuator upper limit in input units"),
  }),
  sim: z.object({
    tEnd: z.number().describe("Simulation length, about 3-5x the target settling time"),
    ref: z.number().describe("Reference step size in output units"),
    disturbanceTime: z.number().describe("Time of an input load disturbance step, or -1 for none"),
    disturbanceMagnitude: z.number().describe("Size of the disturbance in input units"),
  }),
});

const AdviceOut = z.object({
  headline: z.string().describe("One sentence verdict"),
  explanation: z.string().describe("Why the response looks the way it does, citing the pole locations, damping, margins and saturation numbers given"),
  diagnosis: z.array(z.string()).describe("Short bullet findings"),
  proposals: z.array(z.object({ label: z.string(), rationale: z.string(), controller: ControllerOut })).describe("1-3 concrete changes, each a complete controller"),
  meetsSpecs: z.boolean(),
});

const MODELER_SYSTEM = `You are a senior control-systems engineer inside RoboCraft Control Lab.
The user describes a physical system in plain language (sometimes with identified step-response data).
Build a linear model of it from first principles and propose a starting controller.

Rules:
- Use SI units unless the user's units are clearer (state them in params).
- When the user doesn't give a parameter, pick a realistic value for that kind of hardware and list it in assumptions.
- The model output must be the variable the user wants to control. Input is the physical actuator command.
- Prefer a transfer function (kind "tf", polynomials in descending powers of s, strictly proper).
- Use state space (kind "ss", n ≤ 6, A as rows) when the plant is open-loop unstable with several coupled states (e.g. balancing robots, inverted pendulums) and choose an LQR controller with Q (one weight per state) and R.
- Put pure dead time in plant.delay rather than in the polynomials.
- PID gains are for u = kp e + ki ∫e + kd·(filtered derivative of the measurement), with N the filter cutoff in rad/s. Make them a sensible first guess (e.g. from IMC / pole placement), not perfect - the user will iterate.
- Specs and actuator limits must be physically plausible for that hardware.
- Keep the model order ≤ 6. Linearise around the operating point and say so.
- If identified data is provided, the plant must match the identified gain, time constants and dead time.
- Pick the closest of four built-in 3D hardware rigs that will animate the simulation: "rover" (wheeled vehicles, carts, conveyors, motor speed → signal "speed", or travel distance → "position"), "arm" (joints, servos, gimbals, any angle → "angle"), "balancer" (inverted pendulums, self-balancing robots → "position"), "drone" (altitude, vertical motion, lifting → "altitude").`;

const EXPLAINER_SYSTEM = `You are a senior control-systems engineer coaching a user in RoboCraft Control Lab.
You get a plant model, the current controller, and numbers from a C++ simulation (step metrics, closed-loop poles, margins, saturation).
Explain in plain language why the response overshoots, oscillates, is slow, has an offset, or is unstable - always tie it to the numbers (pole locations, damping ratio ζ, phase margin, saturation, dead time).
Then propose 1-3 concrete controller changes that should fix it, each as a complete controller of the same type, with a one-sentence rationale.
Be specific and short. Use the user's units. No markdown headings.
If the user asks something, answer it directly first.`;

function finiteAll(xs: unknown[]): boolean {
  return xs.every((v) => typeof v === "number" && Number.isFinite(v));
}

function toPlant(p: z.infer<typeof ModelOut>["plant"]): PlantSpec {
  if (p.kind === "ss") {
    const n = p.B.length;
    if (n < 1 || n > 8 || p.A.length !== n || p.A.some((r) => r.length !== n) || p.C.length !== n) throw new Error("state-space dimensions do not match");
    if (!finiteAll([...p.A.flat(), ...p.B, ...p.C, p.delay])) throw new Error("non-finite state-space entries");
    return { kind: "ss", A: p.A, B: p.B, C: p.C, delay: Math.max(0, p.delay), stateNames: p.stateNames.length === n ? p.stateNames : p.B.map((_, i) => `x${i + 1}`) };
  }
  const den = p.den.slice();
  while (den.length > 1 && Math.abs(den[0]) < 1e-14) den.shift();
  if (den.length < 2 || den.length > 9) throw new Error("denominator order must be 1-8");
  if (p.num.length > den.length) throw new Error("transfer function is not proper");
  if (!finiteAll([...p.num, ...den, p.delay])) throw new Error("non-finite polynomial coefficients");
  return { kind: "tf", num: p.num, den, delay: Math.max(0, p.delay) };
}

export function toController(c: z.infer<typeof ControllerOut>, nStates: number): ControllerSpec {
  if (c.type === "lqr") {
    const Q = c.Q.length === nStates ? c.Q.map((q) => Math.max(0, q)) : new Array(nStates).fill(1);
    return { type: "lqr", Q, R: c.R > 0 ? c.R : 1 };
  }
  return { type: "pid", kp: c.kp, ki: Math.max(0, c.ki), kd: Math.max(0, c.kd), N: c.N > 0 ? c.N : 50 };
}

export interface ModelResult {
  model: LabModel;
  notice?: string;
}

export function offlineModel(description: string, presetId?: string): ModelResult {
  const direct = presetById(presetId);
  const { preset, confident } = direct ? { preset: direct, confident: true } : matchPreset(description);
  const model = preset.build();
  return {
    model,
    notice: aiEnabled()
      ? undefined
      : confident
        ? `Offline modeler: matched "${preset.name}" from the physics library. Turn on Muse Spark to model any system you describe.`
        : `Offline modeler couldn't match that description, so it loaded "${preset.name}". Turn on Muse Spark to model any system you describe.`,
  };
}

export async function modelFromDescription(description: string, dataSummary?: string): Promise<ModelResult> {
  const { data: out } = await metaJson({
    schema: ModelOut,
    schemaName: "plant_model",
    system: MODELER_SYSTEM,
    user: dataSummary ? `${description}\n\nIdentified from uploaded step-response data:\n${dataSummary}` : description,
    maxTokens: 6000,
    effort: "medium",
  });

  const plant = toPlant(out.plant);
  const nStates = plant.kind === "ss" ? plant.B.length : plant.den.length - 1;
  const tEnd = Math.min(Math.max(out.sim.tEnd, 0.05), 3600);
  const model: LabModel = {
    rig: out.rig,
    title: out.title,
    summary: out.summary,
    domain: out.domain,
    input: out.input,
    output: out.output,
    params: out.params.filter((p) => Number.isFinite(p.value)),
    equations: out.equations,
    assumptions: out.assumptions,
    plant,
    controller: toController(out.controller, nStates),
    controllerRationale: out.controllerRationale,
    specs: {
      maxOvershootPct: Math.max(0, out.specs.maxOvershootPct),
      maxSettlingTime: Math.max(1e-3, out.specs.maxSettlingTime),
      maxSsErrorPct: Math.max(0.01, out.specs.maxSsErrorPct),
      uMin: Math.min(out.specs.uMin, out.specs.uMax),
      uMax: Math.max(out.specs.uMin, out.specs.uMax),
    },
    sim: {
      tEnd,
      ref: out.sim.ref || 1,
      disturbance: out.sim.disturbanceTime > 0 && out.sim.disturbanceTime < tEnd ? { time: out.sim.disturbanceTime, magnitude: out.sim.disturbanceMagnitude } : undefined,
    },
    source: dataSummary ? "data" : "meta",
  };
  // Smoke-run it: a model the engine can't simulate is worse than the offline library.
  const { analysis } = run(tsEngine, model, model.controller);
  if (!analysis.poles.length) throw new Error("model has no dynamics");
  return { model };
}

function analysisDigest(model: LabModel, controller: ControllerSpec, a: Analysis): string {
  const m = a.metrics;
  const checks = checkSpecs(m, model.specs, model.sim.ref);
  const poles = (ps: Analysis["poles"]) => ps.map((p) => (Math.abs(p.im) < 1e-9 ? fmtNum(p.re) : `${fmtNum(p.re)}±${fmtNum(Math.abs(p.im))}j`)).filter((v, i, arr) => arr.indexOf(v) === i).join(", ");
  return [
    `Controller: ${JSON.stringify(controller)}`,
    `Stable: ${m.stable ? "yes" : "no"}`,
    `Closed-loop poles: ${poles(a.poles)}`,
    `Open-loop plant poles: ${poles(a.openPoles)}`,
    `Phase margin: ${a.pmDeg >= 1e8 ? "∞" : fmtNum(a.pmDeg) + "°"} at ${fmtNum(a.wcp)} rad/s; gain margin: ${a.gmDb >= 1e8 ? "∞" : fmtNum(a.gmDb) + " dB"}`,
    `Rise time ${fmtNum(m.riseTime)} s, peak ${fmtNum(m.peak)} at ${fmtNum(m.peakTime)} s, overshoot ${m.overshootPct.toFixed(1)}%, settling ${m.settlingTime < 0 ? "not settled" : fmtNum(m.settlingTime) + " s"}, final ${fmtNum(m.finalValue)} (ref ${model.sim.ref}), steady-state error ${fmtNum(m.ssError)}`,
    `Actuator: max |u| ${fmtNum(m.maxAbsU)} ${model.input.unit}, saturated ${(m.saturatedFrac * 100).toFixed(1)}% of the time (limits ${model.specs.uMin}..${model.specs.uMax})`,
    `Spec checks: ${checks.map((c) => `${c.label} ${c.value} (${c.target}) ${c.pass ? "PASS" : "FAIL"}`).join("; ")}`,
  ].join("\n");
}

export async function explain(
  model: LabModel,
  controller: ControllerSpec,
  analysis: Analysis,
  history: { label: string; controller: ControllerSpec; summary: string }[],
  question?: string,
): Promise<Advice> {
  const nStates = model.plant.kind === "ss" ? model.plant.B.length : model.plant.den.length - 1;
  const modelDigest = {
    title: model.title,
    input: model.input,
    output: model.output,
    plant: model.plant,
    params: model.params,
    assumptions: model.assumptions,
    specs: model.specs,
    sim: model.sim,
  };
  const { data: out } = await metaJson({
    schema: AdviceOut,
    schemaName: "controller_advice",
    system: EXPLAINER_SYSTEM,
    user: [
      `Model:\n${JSON.stringify(modelDigest)}`,
      history.length ? `Earlier iterations:\n${history.map((h) => `- ${h.label}: ${JSON.stringify(h.controller)} → ${h.summary}`).join("\n")}` : "",
      `Current simulation:\n${analysisDigest(model, controller, analysis)}`,
      question ? `User: ${question}` : "Explain this response and propose fixes.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: 4000,
    effort: "low",
  });
  return {
    headline: out.headline,
    explanation: out.explanation,
    diagnosis: out.diagnosis,
    proposals: out.proposals.slice(0, 3).map((p) => ({ label: p.label, rationale: p.rationale, controller: toController(p.controller, nStates) })),
    meetsSpecs: out.meetsSpecs,
    source: "meta",
  };
}

export function offlineExplain(model: LabModel, controller: ControllerSpec, analysis: Analysis): Advice {
  return offlineAdvice(model, controller, analysis);
}

export function describeError(err: unknown): string {
  if (err instanceof MetaError) {
    if (err.status === 401 || err.status === 403) return "The Meta API key was rejected.";
    if (err.status === 429) return err.message.startsWith("Daily") ? err.message : "Muse Spark is rate-limited right now.";
    return err.message;
  }
  if (err instanceof z.ZodError) return "Muse Spark returned data that failed validation.";
  return err instanceof Error ? err.message : String(err);
}
