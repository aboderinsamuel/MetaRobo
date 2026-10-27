// Turns a LabModel + controller into engine inputs, runs the engine, and scores the result.
import { CTRL_OPEN, CTRL_PID, CTRL_SF, DEFAULT_CTRL, ss2tf, tf2ss } from "@/lib/sim/core";
import type { Ctrl, Metrics, Plant, SimCfg, SimOut } from "@/lib/sim/core";
import type { Engine } from "@/lib/sim/engine";
import type { Analysis, ControllerSpec, LabModel, PlantSpec, Specs } from "./types";

export function specToPlant(spec: PlantSpec): Plant {
  if (spec.kind === "tf") return tf2ss(spec.num, spec.den, spec.delay ?? 0);
  const n = spec.B.length;
  return {
    n,
    A: spec.A.flat(),
    B: spec.B.slice(),
    C: spec.C.slice(),
    D: spec.D ?? 0,
    delay: spec.delay ?? 0,
  };
}

export function plantTf(spec: PlantSpec): { num: number[]; den: number[] } {
  if (spec.kind === "tf") return { num: spec.num, den: spec.den };
  return ss2tf(specToPlant(spec));
}

export function toCtrl(engine: Engine, plant: Plant, spec: ControllerSpec): Ctrl {
  if (spec.type === "pid") return { ...DEFAULT_CTRL, type: CTRL_PID, kp: spec.kp, ki: spec.ki, kd: spec.kd, N: spec.N || 50 };
  if (spec.type === "lqr") {
    const r = engine.lqr(plant, spec.Q, spec.R);
    return { ...DEFAULT_CTRL, type: CTRL_SF, K: r.K, Nbar: r.Nbar };
  }
  return { ...DEFAULT_CTRL, type: CTRL_OPEN };
}

export function simConfig(model: LabModel, overrides: Partial<SimCfg> = {}): SimCfg {
  const tEnd = model.sim.tEnd;
  const dt = model.sim.dt ?? Math.min(0.01, Math.max(1e-4, tEnd / 4000));
  return {
    tEnd,
    dt,
    ref: model.sim.ref,
    distTime: model.sim.disturbance ? model.sim.disturbance.time : -1,
    distMag: model.sim.disturbance?.magnitude ?? 0,
    uMin: model.specs.uMin,
    uMax: model.specs.uMax,
    noiseStd: model.sim.noiseStd ?? 0,
    seed: 7,
    ...overrides,
  };
}

export interface RunResult {
  plant: Plant;
  ctrl: Ctrl;
  sim: SimOut;
  analysis: Analysis;
}

export function run(engine: Engine, model: LabModel, spec: ControllerSpec, overrides: Partial<SimCfg> = {}): RunResult {
  const plant = specToPlant(model.plant);
  const ctrl = toCtrl(engine, plant, spec);
  const cfg = simConfig(model, overrides);
  const sim = engine.simulate(plant, ctrl, cfg);
  const poles = engine.poles(plant, ctrl);
  const openPoles = engine.poles(plant, DEFAULT_CTRL);
  const b = engine.bode(plant, ctrl, 300, 1e-3, 1e4);
  return {
    plant,
    ctrl,
    sim,
    analysis: { metrics: sim.metrics, poles, openPoles, gmDb: b.gmDb, pmDeg: b.pmDeg, wcp: b.wcp, wcg: b.wcg },
  };
}

export interface SpecCheck {
  key: string;
  label: string;
  value: string;
  target: string;
  pass: boolean;
}

export function checkSpecs(m: Metrics, specs: Specs, ref: number): SpecCheck[] {
  const ssPct = Math.abs(ref) > 1e-12 ? (Math.abs(m.ssError) / Math.abs(ref)) * 100 : Math.abs(m.ssError) * 100;
  return [
    { key: "stable", label: "Stable", value: m.stable ? "yes" : "no", target: "yes", pass: m.stable === 1 },
    {
      key: "overshoot",
      label: "Overshoot",
      value: `${m.overshootPct.toFixed(1)}%`,
      target: `≤ ${specs.maxOvershootPct}%`,
      pass: m.stable === 1 && m.overshootPct <= specs.maxOvershootPct,
    },
    {
      key: "settling",
      label: "Settling (2%)",
      value: m.settlingTime < 0 ? "not settled" : `${fmtNum(m.settlingTime)} s`,
      target: `≤ ${specs.maxSettlingTime} s`,
      pass: m.stable === 1 && m.settlingTime >= 0 && m.settlingTime <= specs.maxSettlingTime,
    },
    {
      key: "sserror",
      label: "Steady-state error",
      value: `${ssPct.toFixed(2)}%`,
      target: `≤ ${specs.maxSsErrorPct}%`,
      pass: m.stable === 1 && ssPct <= specs.maxSsErrorPct,
    },
  ];
}

export function fmtNum(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "∞";
  if (Math.abs(v) >= 1e9) return "∞";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return v.toExponential(2);
  if (a >= 1000) return String(Math.round(v));
  return Number(v.toPrecision(Math.min(21, Math.max(1, Math.round(digits) || 3)))).toString();
}

const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
const sup = (s: string) => s.replace(/[-0-9]/g, (c) => SUP[c]);

/** Like fmtNum but with scientific notation written as 2.0×10⁻⁷ for display. */
export function fmtPretty(v: number, digits = 3): string {
  const s = fmtNum(v, digits);
  const m = /^(-?[\d.]+)e([+-]?)(\d+)$/.exec(s);
  if (!m) return s;
  const mant = m[1].replace(/\.?0+$/, "");
  return `${mant === "1" ? "" : mant + "×"}10${sup((m[2] === "-" ? "-" : "") + m[3])}`;
}

export function polyToString(p: number[], v = "s"): string {
  const deg = p.length - 1;
  const terms: string[] = [];
  p.forEach((c, i) => {
    if (Math.abs(c) < 1e-12) return;
    const pow = deg - i;
    const mag = Math.abs(c);
    const coef = pow > 0 && Math.abs(mag - 1) < 1e-12 ? "" : fmtPretty(mag, 4);
    const sym = pow === 0 ? "" : pow === 1 ? v : `${v}${sup(String(pow))}`;
    const body = coef && sym ? `${coef} ${sym}` : coef || sym;
    terms.push((c < 0 ? "− " : terms.length ? "+ " : "") + body);
  });
  return terms.join(" ") || "0";
}
