// Design validation: the checks a control engineer would run before trusting a loop on hardware.
import { tsEngine } from "@/lib/sim/engine";
import type { Engine } from "@/lib/sim/engine";
import { checkSpecs, fmtNum, run, simConfig, specToPlant, toCtrl } from "./analysis";
import type { ControllerSpec, LabModel } from "./types";

export type Verdict = "pass" | "warn" | "fail";

export interface CheckResult {
  id: string;
  group: string;
  label: string;
  detail: string;
  verdict: Verdict;
  traces?: { label: string; y: Float64Array; dt: number }[];
}

type Check = (engine: Engine, model: LabModel, spec: ControllerSpec) => CheckResult;

const base = (engine: Engine, model: LabModel, spec: ControllerSpec) => run(engine, model, spec, { noiseStd: 0 });

const CHECKS: Check[] = [
  (engine, model, spec) => {
    const { analysis } = base(engine, model, spec);
    const worst = analysis.poles.reduce((w, p) => Math.max(w, p.re), -Infinity);
    return {
      id: "stability",
      group: "Stability",
      label: "Closed-loop poles in the left half-plane",
      detail: `Slowest pole real part ${fmtNum(worst)} s⁻¹ (${analysis.poles.length} poles)`,
      verdict: analysis.metrics.stable && worst < 0 ? "pass" : "fail",
    };
  },
  (engine, model, spec) => {
    const { analysis } = base(engine, model, spec);
    const pm = analysis.pmDeg,
      gm = analysis.gmDb;
    const pmOk = pm >= 30 || pm >= 1e8;
    const gmOk = gm >= 6;
    return {
      id: "margins",
      group: "Stability",
      label: "Phase margin ≥ 30°, gain margin ≥ 6 dB",
      detail: `PM ${pm >= 1e8 ? "∞" : fmtNum(pm) + "°"} · GM ${gm >= 1e8 ? "∞" : fmtNum(gm) + " dB"}`,
      verdict: pmOk && gmOk ? "pass" : pm > 15 && gm > 3 ? "warn" : "fail",
    };
  },
  (engine, model, spec) => {
    const { analysis } = base(engine, model, spec);
    const checks = checkSpecs(analysis.metrics, model.specs, model.sim.ref).filter((c) => c.key !== "stable");
    const failed = checks.filter((c) => !c.pass);
    return {
      id: "specs",
      group: "Performance",
      label: "Meets overshoot, settling and accuracy specs",
      detail: checks.map((c) => `${c.label} ${c.value}`).join(" · "),
      verdict: failed.length === 0 ? "pass" : failed.length === 1 ? "warn" : "fail",
    };
  },
  (engine, model, spec) => {
    const { analysis } = base(engine, model, spec);
    const m = analysis.metrics;
    return {
      id: "actuator",
      group: "Hardware",
      label: "Actuator stays within its limits",
      detail: `Peak |u| ${fmtNum(m.maxAbsU)} ${model.input.unit} of [${fmtNum(model.specs.uMin)}, ${fmtNum(model.specs.uMax)}], saturated ${(m.saturatedFrac * 100).toFixed(1)}% of the time`,
      verdict: m.saturatedFrac < 0.1 ? "pass" : m.saturatedFrac < 0.35 ? "warn" : "fail",
    };
  },
  (engine, model, spec) => {
    // Robustness: the real plant never matches the model. Vary gain and speed by ±30% / ±25%.
    const nominal = specToPlant(model.plant);
    const cases = [
      { label: "gain ×0.7", g: 0.7, s: 1 },
      { label: "gain ×1.3", g: 1.3, s: 1 },
      { label: "slower ×0.8", g: 1, s: 0.8 },
      { label: "faster ×1.25", g: 1, s: 1.25 },
    ];
    const cfg = simConfig(model, { noiseStd: 0 });
    const ctrl = toCtrl(engine, nominal, spec);
    const traces: CheckResult["traces"] = [];
    let unstable = 0,
      worstOs = 0;
    for (const c of cases) {
      const plant = { ...nominal, A: nominal.A.map((v) => v * c.s), B: nominal.B.map((v) => v * c.s * c.g) };
      const sim = engine.simulate(plant, ctrl, cfg);
      if (!sim.metrics.stable) unstable++;
      worstOs = Math.max(worstOs, sim.metrics.overshootPct);
      traces.push({ label: c.label, y: sim.y, dt: sim.dt });
    }
    return {
      id: "robust",
      group: "Robustness",
      label: "Survives ±30% gain and ±25% speed model error",
      detail: unstable ? `${unstable} of 4 variants went unstable` : `All 4 variants stable, worst overshoot ${worstOs.toFixed(1)}%`,
      verdict: unstable ? "fail" : worstOs > model.specs.maxOvershootPct * 2.5 ? "warn" : "pass",
      traces,
    };
  },
  (engine, model, spec) => {
    const ref = Math.abs(model.sim.ref) || 1;
    const clean = run(engine, model, spec, { noiseStd: 0, distTime: -1 }).sim;
    const noisy = run(engine, model, spec, { noiseStd: ref * 0.01, distTime: -1 }).sim;
    const rms = (u: Float64Array, from: number) => {
      let acc = 0;
      for (let i = from; i < u.length; i++) acc += u[i] * u[i];
      return Math.sqrt(acc / Math.max(1, u.length - from));
    };
    const from = Math.floor(clean.u.length * 0.6);
    let jitter = 0;
    for (let i = from; i < clean.u.length; i++) jitter += (noisy.u[i] - clean.u[i]) ** 2;
    jitter = Math.sqrt(jitter / Math.max(1, clean.u.length - from));
    const span = Math.max(1e-9, model.specs.uMax - model.specs.uMin, rms(clean.u, from));
    const ratio = jitter / span;
    return {
      id: "noise",
      group: "Robustness",
      label: "Sensor noise does not chatter the actuator",
      detail: `1% sensor noise → actuator jitter ${(ratio * 100).toFixed(1)}% of its range`,
      verdict: ratio < 0.05 ? "pass" : ratio < 0.15 ? "warn" : "fail",
      traces: [{ label: "with 1% noise", y: noisy.y, dt: noisy.dt }],
    };
  },
  (engine, model, spec) => {
    const tEnd = model.sim.tEnd;
    const range = model.specs.uMax - model.specs.uMin;
    const mag = Number.isFinite(range) && range < 1e8 ? -0.15 * range : -0.2 * Math.abs(model.sim.ref);
    const { sim } = run(engine, model, spec, { noiseStd: 0, distTime: tEnd * 0.5, distMag: mag, tEnd: tEnd * 1.6 });
    const ref = model.sim.ref;
    const tail = sim.y.slice(Math.floor(sim.y.length * 0.95));
    const endErr = Math.abs(tail.reduce((a, b) => a + b, 0) / tail.length - ref) / (Math.abs(ref) || 1);
    let dip = 0;
    for (let i = Math.floor(sim.y.length * (0.5 / 1.6)); i < sim.y.length; i++) dip = Math.max(dip, Math.abs(sim.y[i] - ref));
    return {
      id: "disturbance",
      group: "Robustness",
      label: "Rejects a step load disturbance",
      detail:
        `Load step of ${fmtNum(mag)} ${model.input.unit}: peak deviation ${(100 * dip / (Math.abs(ref) || 1)).toFixed(1)}%, residual error ${(endErr * 100).toFixed(2)}%` +
        (endErr >= 0.02 && (spec.type === "lqr" || (spec.type === "pid" && spec.ki === 0)) ? " · no integral action, so a constant load leaves an offset" : ""),
      // A residual error is a design limitation (no integral action), not a broken loop.
      verdict: !sim.metrics.stable ? "fail" : endErr < 0.02 ? "pass" : "warn",
      traces: [{ label: "load step", y: sim.y, dt: sim.dt }],
    };
  },
  (engine, model, spec) => {
    // Cross-check: the C++/WASM engine and the TypeScript port must agree on this exact design.
    if (engine.backend !== "wasm")
      return {
        id: "crosscheck",
        group: "Engine",
        label: "WASM and TypeScript engines agree",
        detail: "WebAssembly module not loaded; running on the TypeScript port (validated against C++ golden data in CI).",
        verdict: "warn",
      };
    const a = run(engine, model, spec, { noiseStd: 0 }).sim;
    const b = run(tsEngine, model, spec, { noiseStd: 0 }).sim;
    let diff = 0;
    for (let i = 0; i < a.y.length; i++) diff = Math.max(diff, Math.abs(a.y[i] - b.y[i]));
    const scale = Math.max(1e-9, Math.abs(model.sim.ref));
    return {
      id: "crosscheck",
      group: "Engine",
      label: "WASM and TypeScript engines agree",
      detail: `Max difference over ${a.y.length} samples: ${(diff / scale).toExponential(1)} (relative)`,
      verdict: diff / scale < 1e-6 ? "pass" : "fail",
    };
  },
];

export const CHECK_COUNT = CHECKS.length;

export async function* validateDesign(engine: Engine, model: LabModel, spec: ControllerSpec): AsyncGenerator<CheckResult> {
  for (const check of CHECKS) {
    // Yield to the browser between checks so the list animates in as results arrive.
    await new Promise((r) => setTimeout(r, 140));
    try {
      yield check(engine, model, spec);
    } catch (err) {
      yield { id: "error", group: "Engine", label: "Check crashed", detail: String(err), verdict: "fail" };
    }
  }
}
