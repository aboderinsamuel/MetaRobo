// Offline control engineer: explains a response from its poles and margins, proposes fixes,
// and auto-tunes gains against the specs with the simulation engine in the loop.
// Claude's explanations (api/lab/explain) use the same numbers; this runs when there is no key.
import { nelderMead } from "@/lib/sim/core";
import type { Complex } from "@/lib/sim/core";
import type { Engine } from "@/lib/sim/engine";
import { checkSpecs, fmtNum, run } from "./analysis";
import type { Advice, Analysis, ControllerSpec, DriveModel, LabModel, Proposal } from "./types";

function dominantPair(poles: Complex[]): Complex | null {
  const cx = poles.filter((p) => p.im > 1e-6 && p.re < 0);
  if (!cx.length) return null;
  // The pair that decays slowest dominates the visible ringing.
  return cx.reduce((a, b) => (a.re > b.re ? a : b));
}

export function dampingOf(p: Complex): number {
  return -p.re / Math.hypot(p.re, p.im);
}

export function describePoles(poles: Complex[]): string {
  return poles
    .map((p) => (Math.abs(p.im) < 1e-9 ? fmtNum(p.re) : `${fmtNum(p.re)} ${p.im > 0 ? "+" : "−"} ${fmtNum(Math.abs(p.im))}j`))
    .join(", ");
}

function scalePid(spec: ControllerSpec, f: { kp?: number; ki?: number; kd?: number }): ControllerSpec {
  if (spec.type !== "pid") return spec;
  const kd = spec.kd === 0 && f.kd && f.kd > 1 ? spec.kp * 0.02 * f.kd : spec.kd * (f.kd ?? 1);
  return { ...spec, kp: spec.kp * (f.kp ?? 1), ki: spec.ki * (f.ki ?? 1), kd };
}

export function offlineAdvice(model: LabModel, spec: ControllerSpec, a: Analysis, tuned?: ControllerSpec): Advice {
  const m = a.metrics;
  const checks = checkSpecs(m, model.specs, model.sim.ref);
  const meetsSpecs = checks.every((c) => c.pass);
  const diagnosis: string[] = [];
  const proposals: Proposal[] = [];
  const unstableOpen = a.openPoles.filter((p) => p.re > 1e-9);
  const pair = dominantPair(a.poles);
  const slowest = a.poles.filter((p) => p.re < 0).reduce<Complex | null>((s, p) => (!s || p.re > s.re ? p : s), null);
  let headline: string;
  let explanation: string;

  if (!m.stable) {
    headline = "The loop is unstable: the output grows instead of settling.";
    const rhp = a.poles.filter((p) => p.re >= -1e-9);
    explanation = rhp.length
      ? `The closed-loop poles ${describePoles(rhp)} sit in the right half-plane, so any small error grows exponentially. `
      : `With the dead time of ${fmtNum(model.plant.delay ?? 0)} s, the controller reacts to old measurements and keeps pushing after the output has passed the target. `;
    if (unstableOpen.length)
      explanation += `The plant itself is unstable (open-loop poles ${describePoles(unstableOpen)}), so the controller must act fast and hard enough to catch it.`;
    else explanation += "The plant is stable on its own, so the controller is too aggressive. Lower the gains.";
    diagnosis.push(`Phase margin ${fmtNum(a.pmDeg)}°: a stable, well-damped loop needs about 45°–60°.`);
    if (spec.type === "pid") proposals.push({ label: "Halve all gains", rationale: "Less gain moves the poles back into the left half-plane.", controller: scalePid(spec, { kp: 0.5, ki: 0.4, kd: 0.5 }) });
    if (spec.type === "lqr") proposals.push({ label: "Weight the tilt more", rationale: "A bigger weight on the unstable state makes LQR fight the fall harder.", controller: { ...spec, Q: spec.Q.map((q, i) => (i === 2 ? q * 4 : q)) } });
  } else {
    const parts: string[] = [];
    if (pair) {
      const z = dampingOf(pair);
      const os = z < 1 ? 100 * Math.exp((-Math.PI * z) / Math.sqrt(1 - z * z)) : 0;
      parts.push(
        `The dominant closed-loop poles are at ${describePoles([pair])}. Their damping ratio is ζ = ${z.toFixed(2)}, which on its own predicts about ${os.toFixed(0)}% overshoot and an oscillation at ${fmtNum(pair.im / (2 * Math.PI))} Hz.`,
      );
    } else if (slowest) {
      parts.push(`All closed-loop poles are real, so the response cannot ring. The slowest pole at ${fmtNum(slowest.re)} sets the settling time to roughly 4/${fmtNum(-slowest.re)} ≈ ${fmtNum(4 / -slowest.re)} s.`);
    }
    if (m.overshootPct > model.specs.maxOvershootPct) {
      diagnosis.push(`Overshoot is ${m.overshootPct.toFixed(1)}%, above the ${model.specs.maxOvershootPct}% limit.`);
      if (spec.type === "pid") {
        if (spec.ki > 0) parts.push("The integral term keeps adding effort while the error is positive, so it pushes past the target before the error changes sign.");
        if (spec.kd === 0) parts.push("There is no derivative action to brake the output as it approaches the target.");
        proposals.push({
          label: spec.kd === 0 ? "Add derivative damping" : "More damping, less integral",
          rationale: "Derivative action opposes fast motion near the target; a smaller integral gain stops the windup that causes the overshoot.",
          // A fresh derivative term gets its corner near the measured oscillation frequency.
          controller:
            spec.kd === 0 && pair
              ? { ...spec, ki: spec.ki * 0.6, kd: spec.kp / (2 * Math.hypot(pair.re, pair.im)) }
              : scalePid(spec, { ki: 0.6, kd: 1.6 }),
        });
      } else if (spec.type === "lqr") {
        proposals.push({ label: "Penalise effort more (raise R)", rationale: "A larger R makes LQR use smaller, smoother forces, which reduces overshoot.", controller: { ...spec, R: spec.R * 3 } });
      }
    }
    if (m.settlingTime < 0 || m.settlingTime > model.specs.maxSettlingTime) {
      diagnosis.push(m.settlingTime < 0 ? "The output has not settled inside the 2% band by the end of the run." : `Settling takes ${fmtNum(m.settlingTime)} s, above the ${model.specs.maxSettlingTime} s target.`);
      if (spec.type === "pid" && !pair) proposals.push({ label: "Raise proportional gain", rationale: "More gain moves the slow real pole further left, so the response finishes sooner.", controller: scalePid(spec, { kp: 1.6, ki: 1.3 }) });
      if (spec.type === "lqr") proposals.push({ label: "Lower R for a faster loop", rationale: "Cheaper effort lets LQR move the poles further left.", controller: { ...spec, R: spec.R / 3 } });
    }
    const ssPct = (Math.abs(m.ssError) / Math.max(1e-12, Math.abs(model.sim.ref))) * 100;
    if (ssPct > model.specs.maxSsErrorPct) {
      diagnosis.push(`Steady-state error is ${ssPct.toFixed(2)}%.`);
      if (spec.type === "pid" && spec.ki === 0) {
        parts.push("Without integral action, a constant load needs a constant error to produce the holding effort.");
        proposals.push({ label: "Add integral action", rationale: "The integrator keeps increasing effort until the error is exactly zero.", controller: { ...spec, ki: spec.kp * 0.5 } });
      }
    }
    if (m.saturatedFrac > 0.15) {
      diagnosis.push(`The actuator sits at its limit ${(m.saturatedFrac * 100).toFixed(0)}% of the time (max |u| = ${fmtNum(m.maxAbsU)} ${model.input.unit}).`);
      parts.push("While the actuator is saturated the loop is effectively open, so extra gain only adds windup and does not make the response faster.");
    }
    if (a.pmDeg < 35) diagnosis.push(`Phase margin is only ${fmtNum(a.pmDeg)}°. Small model errors could make the loop oscillate.`);
    if ((model.plant.delay ?? 0) > 0) diagnosis.push(`Dead time of ${fmtNum(model.plant.delay ?? 0)} s limits how fast any controller can be.`);
    headline = meetsSpecs ? "All specs met. The loop is stable and well damped." : diagnosis[0] ?? "The response can be improved.";
    explanation = parts.join(" ") || "The response is stable.";
  }
  if (tuned) proposals.unshift({ label: "Auto-tuned gains", rationale: "Searched with the simulator in the loop to meet every spec with the least tracking error.", controller: tuned });
  return { headline, explanation, diagnosis, proposals: proposals.slice(0, 3), meetsSpecs, source: "offline" };
}

// ---------------------------------------------------------------------------
// Auto-tuning: Nelder-Mead in log-gain space, cost from the engine
// ---------------------------------------------------------------------------

/** Highest motor current averaged over 1/40 of the run (A), from the actuator's electrical model. */
export function sustainedCurrent(d: DriveModel, y: ArrayLike<number>, u: ArrayLike<number>, dt: number): number {
  const n = y.length;
  const win = Math.max(1, Math.round(n / 40));
  let acc = 0,
    best = 0;
  const amps = (i: number) => {
    const w = d.wPerY * (d.mode === "y" ? y[i] : i > 0 ? (y[i] - y[i - 1]) / dt : 0);
    const a = Math.abs((u[i] - d.Ke * w) / d.R) + d.holdA;
    return Number.isFinite(a) ? a : 1e3;
  };
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    buf[i] = amps(i);
    acc += buf[i];
    if (i >= win) acc -= buf[i - win];
    if (i >= win - 1) best = Math.max(best, acc / win);
  }
  return best;
}

export function designCost(engine: Engine, model: LabModel, spec: ControllerSpec): number {
  // Same time step as the verification run: the controller is discrete, so dt changes behaviour.
  const { analysis, sim } = run(engine, model, spec, { noiseStd: 0 });
  const m = analysis.metrics;
  if (!m.stable) return 1e3;
  const s = model.specs;
  const ref = Math.abs(model.sim.ref) || 1;
  const ssPct = (Math.abs(m.ssError) / ref) * 100;
  let cost = m.iae / (ref * model.sim.tEnd);
  cost += 10 * Math.max(0, m.overshootPct - s.maxOvershootPct * 0.8) / Math.max(1, s.maxOvershootPct);
  cost += m.settlingTime < 0 ? 4 : 4 * Math.max(0, m.settlingTime - s.maxSettlingTime * 0.8) / s.maxSettlingTime;
  cost += 6 * Math.max(0, ssPct - s.maxSsErrorPct * 0.5) / Math.max(0.1, s.maxSsErrorPct);
  cost += 1.5 * m.saturatedFrac;
  if (analysis.pmDeg < 40) cost += (40 - analysis.pmDeg) / 40;
  // Hardware-aware: keep the motor current inside the driver's continuous rating.
  if (model.drive) cost += 4 * Math.max(0, sustainedCurrent(model.drive, sim.y, sim.u, sim.dt) / model.drive.limitA - 0.9);
  if (spec.type === "pid") {
    // High-frequency controller gain (kp + kd N) turns sensor noise into actuator chatter.
    // Keep 1% sensor noise below ~4% of the actuator range.
    const range = s.uMax - s.uMin;
    if (Number.isFinite(range) && range < 1e8) {
      const jitter = ((spec.kp + spec.kd * spec.N) * 0.01 * ref) / range;
      cost += 10 * Math.max(0, jitter - 0.04);
    }
  }
  return cost;
}

export function autoTune(engine: Engine, model: LabModel, base: ControllerSpec, iters = 120): ControllerSpec {
  if (base.type === "pid") {
    const useI = base.ki > 0 || model.specs.maxSsErrorPct < 5;
    const x0 = [Math.log(Math.max(base.kp, 1e-6)), Math.log(Math.max(base.ki, base.kp * 0.1, 1e-6)), Math.log(Math.max(base.kd, base.kp * 0.01, 1e-7)), Math.log(base.N || 50)];
    const make = (x: number[]): ControllerSpec => ({
      type: "pid",
      kp: Math.exp(x[0]),
      ki: useI ? Math.exp(x[1]) : 0,
      kd: Math.exp(x[2]),
      // Derivative filter: lower N trades a little phase lead for much less noise gain.
      N: Math.min(500, Math.max(2, Math.exp(x[3]))),
    });
    const f = (x: number[]) => designCost(engine, model, make(x));
    // Multi-start (softer, nominal, harder), each a coarse search then a refinement.
    let best = x0,
      bestCost = Infinity;
    for (const shift of [0, -1.2, 1.2]) {
      const start = x0.map((v, i) => (i < 3 ? v + shift : v));
      let x = nelderMead(f, start, [1, 1, 1.5, 0.7], iters);
      x = nelderMead(f, x, [0.3, 0.3, 0.4, 0.3], Math.floor(iters / 2));
      const c = f(x);
      if (c < bestCost) {
        best = x;
        bestCost = c;
      }
    }
    const tuned = make(best);
    // Drop derivative action if it barely matters (simpler, less noise-sensitive).
    const noD = { ...tuned, kd: 0 } as ControllerSpec;
    return designCost(engine, model, noD) <= designCost(engine, model, tuned) * 1.02 ? noD : tuned;
  }
  if (base.type === "lqr") {
    const idx = base.Q.map((q, i) => (q > 0 ? i : -1)).filter((i) => i >= 0);
    const x0 = [...idx.map((i) => Math.log(base.Q[i])), Math.log(base.R)];
    // Stay within 10x of the physically motivated starting weights: unbounded searches find
    // degenerate designs that look fast in the nominal run but fall over once the actuator saturates.
    const bound = Math.log(10);
    const make = (x: number[]): ControllerSpec => {
      const xc = x.map((v, j) => Math.min(x0[j] + bound, Math.max(x0[j] - bound, v)));
      const Q = base.Q.slice();
      idx.forEach((qi, j) => (Q[qi] = Math.exp(xc[j])));
      return { type: "lqr", Q, R: Math.exp(xc[idx.length]) };
    };
    const f = (x: number[]) => designCost(engine, model, make(x));
    const best = nelderMead(f, x0, x0.map(() => 1), iters);
    return make(best);
  }
  return base;
}

export function proposalPreview(engine: Engine, model: LabModel, spec: ControllerSpec) {
  return run(engine, model, spec, { noiseStd: 0 }).analysis.metrics;
}
