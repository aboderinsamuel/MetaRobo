// Motion programs: what the machine does in the 3D view. "mission" replays the exact simulated
// run (disturbance, noise and actuator limits included). The other programs chain setpoints - a
// square or figure-8 for the rover, stacking for the arm - and get their motion by superposing the
// closed-loop step response of the same plant and controller (linear, so actuator limits are not
// applied). A sluggish or oscillating controller shows up as a robot that cuts corners or wobbles.
import type { Engine } from "@/lib/sim/engine";
import { run, simConfig } from "./analysis";
import type { RunResult } from "./analysis";
import { ARM_GRIP, ARM_START, payloadSize, roverTrack } from "./hardware/build";
import type { HardwareBuild } from "./hardware/build";
import type { ControllerSpec, LabModel, RigKind } from "./types";

export interface ProgramDef {
  id: string;
  name: string;
  blurb: string;
}

export const PROGRAMS: Record<RigKind, ProgramDef[]> = {
  rover: [
    { id: "mission", name: "Cruise + ramp", blurb: "Hold the cruise speed up a ramp" },
    { id: "square", name: "Square", blurb: "Four 0.5 m sides, turning on the spot" },
    { id: "figure8", name: "Figure-8", blurb: "A left loop, then a right loop" },
    { id: "spin", name: "Spin", blurb: "Two turns on the spot, then one back" },
  ],
  arm: [
    { id: "mission", name: "Pick & place", blurb: "Lift the part to the shelf and release it" },
    { id: "stack", name: "Stack ×3", blurb: "Three parts stacked on the shelf" },
    { id: "wave", name: "Wave", blurb: "Swing the shoulder back and forth" },
  ],
  balancer: [
    { id: "mission", name: "Drive to mark", blurb: "Stay upright and drive to the flag" },
    { id: "shuttle", name: "Shuttle", blurb: "Forward, back past the start, forward again" },
    { id: "long", name: "Long run", blurb: "Drive a metre out and come home" },
  ],
  drone: [
    { id: "mission", name: "Climb & hold", blurb: "Climb, hold, ride out a down-gust" },
    { id: "stairs", name: "Stair climb", blurb: "Three equal steps up" },
    { id: "hop", name: "Hop & land", blurb: "Up, down to the pad, up, down" },
  ],
};

export interface ProgramRun {
  id: string;
  dt: number;
  tEnd: number;
  /** Main output in model units, its setpoint and the control signal. */
  y: Float64Array;
  r: Float64Array;
  u: Float64Array;
  tilt?: Float64Array;
  /** Rover: wheel speeds (m/s), their commands, and the pose they produce. */
  vL?: Float64Array;
  vR?: Float64Array;
  uL?: Float64Array;
  uR?: Float64Array;
  pose?: { x: Float64Array; z: Float64Array; h: Float64Array };
  /** Rover: the commanded path, for drawing the route. */
  plan?: [number, number][];
  /** Arm: base yaw (rad). */
  yaw?: Float64Array;
  segs: { t0: number; t1: number; label: string }[];
  events: { t: number; kind: "grip" | "release" }[];
  /** Distinct setpoints, for drawing targets (flags, rings). */
  targets: number[];
  disturbance: number;
  linear: boolean;
}

interface Seg {
  dur: number;
  label: string;
  ref?: number;
  wheels?: [number, number];
  yaw?: number;
  grip?: boolean;
  release?: boolean;
}

const fmt = (v: number, d = 2) => Number(v.toFixed(d)).toString();
const deg = (r: number) => Math.round((r * 180) / Math.PI);

/** y(t) = Σ Δr_k · s(t − t_k): the response to a staircase of setpoints, from the unit step response s. */
function superpose(basis: ArrayLike<number>, steps: { i: number; d: number }[], n: number): Float64Array {
  const out = new Float64Array(n);
  for (const { i: k, d } of steps) {
    if (d === 0) continue;
    for (let i = k; i < n; i++) out[i] += d * basis[i - k];
  }
  return out;
}

function staircase(values: number[], starts: number[], n: number): { steps: { i: number; d: number }[]; profile: Float64Array } {
  const steps: { i: number; d: number }[] = [];
  const profile = new Float64Array(n);
  let prev = 0;
  values.forEach((v, k) => {
    steps.push({ i: starts[k], d: v - prev });
    prev = v;
    for (let i = starts[k]; i < (starts[k + 1] ?? n); i++) profile[i] = v;
  });
  return { steps, profile };
}

/** Unit step response of the closed loop (and of the tilt state for the balancer), limits off. */
function basis(engine: Engine, model: LabModel, ctrl: ControllerSpec, tEnd: number, dt: number) {
  const m: LabModel = {
    ...model,
    specs: { ...model.specs, uMin: -1e12, uMax: 1e12 },
    sim: { ...model.sim, tEnd, dt, ref: 1, disturbance: undefined, noiseStd: 0 },
  };
  const r = run(engine, m, ctrl);
  let tilt: Float64Array | undefined;
  if (model.rig?.kind === "balancer" && model.plant.kind === "ss" && r.ctrl.type === 2) {
    const plant = { ...r.plant, C: r.plant.C.map((_, j) => (j === 2 ? 1 : 0)), D: 0 };
    tilt = Float64Array.from(engine.simulate(plant, r.ctrl, simConfig(m)).y);
  }
  return { y: r.sim.y, u: r.sim.u, tilt, dt: r.sim.dt };
}

function segments(kind: RigKind, id: string, build: HardwareBuild, model: LabModel): Seg[] {
  const g = build.geom;
  const target = model.sim.ref;
  const T = Math.max(0.6, model.specs.maxSettlingTime * 1.6);
  if (kind === "rover") {
    const v = target;
    const track = roverTrack(g);
    if (id === "square") {
      const vt = 0.5 * v;
      const w = (2 * vt) / track;
      const out: Seg[] = [];
      for (let k = 0; k < 4; k++) {
        out.push({ dur: 0.5 / v, wheels: [v, v], label: `side ${k + 1} · ${fmt(v)} m/s · 0°/s` });
        out.push({ dur: Math.PI / 2 / w, wheels: [-vt, vt], label: `turn 90° · 0 m/s · ${deg(w)}°/s` });
      }
      out.push({ dur: 1, wheels: [0, 0], label: "stop" });
      return out;
    }
    if (id === "figure8") {
      const R = Math.max(0.25, track * 1.6);
      const w = v / R;
      const d = (w * track) / 2;
      return [
        { dur: (2 * Math.PI) / w, wheels: [v - d, v + d], label: `left loop · ${fmt(v)} m/s · ${deg(w)}°/s` },
        { dur: (2 * Math.PI) / w, wheels: [v + d, v - d], label: `right loop · ${fmt(v)} m/s · ${deg(w)}°/s` },
        { dur: 1, wheels: [0, 0], label: "stop" },
      ];
    }
    const vt = 0.6 * v;
    const w = (2 * vt) / track;
    return [
      { dur: (4 * Math.PI) / w, wheels: [-vt, vt], label: `spin left · ${deg(w)}°/s` },
      { dur: (2 * Math.PI) / w, wheels: [vt, -vt], label: `spin right · ${deg(w)}°/s` },
      { dur: 1, wheels: [0, 0], label: "stop" },
    ];
  }
  if (kind === "arm") {
    if (id === "stack") {
      // Each level is one part higher on the shelf: raise the lift by the angle that adds a part's height.
      const box = payloadSize(g.payload);
      const reachArm = g.upper * Math.cos(ARM_START + target) + 0.5 * (g.fore + ARM_GRIP);
      const dTheta = box / Math.max(0.05, g.upper * 0.9 + reachArm * 0.2);
      const out: Seg[] = [];
      for (let k = 0; k < 3; k++) {
        out.push({ dur: 0.5, ref: 0, yaw: 0, grip: true, label: `grip part ${k + 1}` });
        out.push({ dur: T, ref: target + k * dTheta, yaw: Math.PI / 2, label: `lift to level ${k + 1} · ${deg(target + k * dTheta)}°` });
        out.push({ dur: 0.4, ref: target + k * dTheta, yaw: Math.PI / 2, release: true, label: `release on level ${k + 1}` });
        out.push({ dur: T, ref: 0, yaw: 0, label: "return to pick" });
      }
      return out;
    }
    const lo = target * 0.45;
    return [
      { dur: T, ref: target, yaw: 0.35, label: `wave up · ${deg(target)}°` },
      { dur: T * 0.7, ref: lo, yaw: -0.35, label: `wave down · ${deg(lo)}°` },
      { dur: T * 0.7, ref: target, yaw: 0.35, label: `wave up · ${deg(target)}°` },
      { dur: T * 0.7, ref: lo, yaw: -0.35, label: `wave down · ${deg(lo)}°` },
      { dur: T, ref: 0, yaw: 0, label: "rest" },
    ];
  }
  if (kind === "balancer") {
    const H = Math.max(3, model.specs.maxSettlingTime * 1.6);
    if (id === "shuttle")
      return [
        { dur: H, ref: target, label: `forward to ${fmt(target)} m` },
        { dur: H, ref: -target * 0.7, label: `back to ${fmt(-target * 0.7)} m` },
        { dur: H, ref: target, label: `forward to ${fmt(target)} m` },
        { dur: H, ref: 0, label: "home" },
      ];
    return [
      { dur: H * 1.6, ref: 1, label: "out to 1 m" },
      { dur: H * 1.6, ref: 0, label: "back home" },
    ];
  }
  // drone
  const H = Math.max(3, model.specs.maxSettlingTime * 1.3);
  if (id === "stairs")
    return [
      { dur: H, ref: target / 3, label: `step 1 · ${fmt(target / 3)} m` },
      { dur: H, ref: (2 * target) / 3, label: `step 2 · ${fmt((2 * target) / 3)} m` },
      { dur: H * 1.3, ref: target, label: `step 3 · ${fmt(target)} m` },
    ];
  return [
    { dur: H, ref: target, label: `hop to ${fmt(target)} m` },
    { dur: H, ref: 0, label: "land" },
    { dur: H, ref: target, label: `hop to ${fmt(target)} m` },
    { dur: H, ref: 0, label: "land" },
  ];
}

/** Builds the playback for a program. `mission` wraps the real simulation. */
export function programRun(
  engine: Engine,
  id: string,
  build: HardwareBuild | null,
  model: LabModel,
  ctrl: ControllerSpec,
  mission: RunResult,
  missionTilt?: Float64Array,
): ProgramRun {
  const kind = model.rig?.kind ?? "rover";
  if (id === "mission" || !build) {
    const n = mission.sim.y.length;
    const dt = mission.sim.dt;
    const tEnd = (n - 1) * dt;
    const dist = model.sim.disturbance?.time ?? -1;
    return {
      id: "mission",
      dt,
      tEnd,
      y: Float64Array.from(mission.sim.y),
      r: new Float64Array(n).fill(model.sim.ref),
      u: Float64Array.from(mission.sim.u),
      tilt: missionTilt,
      segs: [{ t0: 0, t1: tEnd, label: PROGRAMS[kind][0].blurb.toLowerCase() }],
      events: kind === "arm" ? [{ t: 0, kind: "grip" }, ...(dist > 0 ? [{ t: dist, kind: "release" as const }] : [])] : [],
      targets: [model.sim.ref],
      disturbance: dist,
      linear: false,
    };
  }
  const segs = segments(kind, id, build, model);
  const tEnd = segs.reduce((a, s) => a + s.dur, 0);
  const dt = Math.max(mission.sim.dt, tEnd / 30000);
  const b = basis(engine, model, ctrl, tEnd, dt);
  const n = b.y.length;
  const starts: number[] = [];
  const timed: ProgramRun["segs"] = [];
  let t = 0;
  for (const s of segs) {
    starts.push(Math.min(n - 1, Math.round(t / b.dt)));
    timed.push({ t0: t, t1: t + s.dur, label: s.label });
    t += s.dur;
  }
  const events: ProgramRun["events"] = [];
  segs.forEach((s, k) => {
    if (s.grip) events.push({ t: timed[k].t0 + s.dur * 0.6, kind: "grip" });
    if (s.release) events.push({ t: timed[k].t0 + s.dur * 0.5, kind: "release" });
  });

  if (kind === "rover") {
    const L = staircase(segs.map((s) => s.wheels![0]), starts, n);
    const R = staircase(segs.map((s) => s.wheels![1]), starts, n);
    const vL = superpose(b.y, L.steps, n),
      vR = superpose(b.y, R.steps, n);
    const uL = superpose(b.u, L.steps, n),
      uR = superpose(b.u, R.steps, n);
    const track = roverTrack(build.geom);
    const y = new Float64Array(n),
      r = new Float64Array(n),
      u = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      y[i] = (vL[i] + vR[i]) / 2;
      r[i] = (L.profile[i] + R.profile[i]) / 2;
      u[i] = Math.abs(uL[i]) > Math.abs(uR[i]) ? uL[i] : uR[i];
    }
    // Integrate the pose from the wheel speeds, and the plan from the commands.
    const pose = { x: new Float64Array(n), z: new Float64Array(n), h: new Float64Array(n) };
    const plan: [number, number][] = [[0, 0]];
    let px = 0,
      pz = 0,
      ph = 0;
    const every = Math.max(1, Math.floor(n / 600));
    for (let i = 1; i < n; i++) {
      const v = y[i],
        w = (vR[i] - vL[i]) / track;
      const h = pose.h[i - 1] + w * b.dt;
      pose.h[i] = h;
      pose.x[i] = pose.x[i - 1] + v * Math.cos(h) * b.dt;
      pose.z[i] = pose.z[i - 1] - v * Math.sin(h) * b.dt;
      const vc = r[i],
        wc = (R.profile[i] - L.profile[i]) / track;
      ph += wc * b.dt;
      px += vc * Math.cos(ph) * b.dt;
      pz -= vc * Math.sin(ph) * b.dt;
      if (i % every === 0) plan.push([px, pz]);
    }
    return { id, dt: b.dt, tEnd, y, r, u, vL, vR, uL, uR, pose, plan, segs: timed, events, targets: [build.geom.target], disturbance: -1, linear: true };
  }

  const S = staircase(
    segs.map((s) => s.ref ?? 0),
    starts,
    n,
  );
  const y = superpose(b.y, S.steps, n);
  const u = superpose(b.u, S.steps, n);
  const tilt = b.tilt ? superpose(b.tilt, S.steps, n) : undefined;
  let yaw: Float64Array | undefined;
  if (kind === "arm") {
    // The base servo follows its own setpoints with a short lag.
    const Y = staircase(
      segs.map((s) => s.yaw ?? 0),
      starts,
      n,
    ).profile;
    yaw = new Float64Array(n);
    const a = 1 - Math.exp(-b.dt / 0.25);
    for (let i = 1; i < n; i++) yaw[i] = yaw[i - 1] + (Y[i] - yaw[i - 1]) * a;
  }
  return {
    id,
    dt: b.dt,
    tEnd,
    y,
    r: S.profile,
    u,
    tilt,
    yaw,
    segs: timed,
    events,
    targets: [...new Set(segs.map((s) => s.ref ?? 0).filter((v) => v !== 0))],
    disturbance: -1,
    linear: true,
  };
}

/** Index of the segment playing at time t. */
export function segmentAt(run: ProgramRun, t: number): number {
  for (let i = 0; i < run.segs.length; i++) if (t < run.segs[i].t1) return i;
  return run.segs.length - 1;
}
