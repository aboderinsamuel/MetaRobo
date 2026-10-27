// Analytic self-test of whichever engine is loaded. Mirrors engine/tests/test_engine.cpp so the
// landing page can prove, live in the browser, that the simulator matches textbook answers.
import { CTRL_PID, CTRL_SF, DEFAULT_CTRL, stepFOPDT, tf2ss } from "./core";
import type { Ctrl, SimCfg } from "./core";
import type { Engine } from "./engine";

export interface SelfTest {
  name: string;
  expected: string;
  run(engine: Engine): { pass: boolean; got: string; ms: number };
}

const cfg = (o: Partial<SimCfg> = {}): SimCfg => ({
  tEnd: 10,
  dt: 1e-3,
  ref: 1,
  distTime: -1,
  distMag: 0,
  uMin: -1e9,
  uMax: 1e9,
  noiseStd: 0,
  seed: 1,
  ...o,
});
const pid = (kp: number, ki: number, kd: number): Ctrl => ({ ...DEFAULT_CTRL, type: CTRL_PID, kp, ki, kd });

function timed<T>(f: () => T): [T, number] {
  const t0 = performance.now();
  const r = f();
  return [r, performance.now() - t0];
}

export const SELF_TESTS: SelfTest[] = [
  {
    name: "First-order lag",
    expected: "y(t) = 1 − e^(−t)",
    run(e) {
      const [s, ms] = timed(() => e.simulate(tf2ss([1], [1, 1]), DEFAULT_CTRL, cfg({ tEnd: 5 })));
      let err = 0;
      for (let i = 0; i < s.y.length; i++) err = Math.max(err, Math.abs(s.y[i] - (1 - Math.exp(-i * s.dt))));
      return { pass: err < 1e-6, got: `max err ${err.toExponential(1)}`, ms };
    },
  },
  {
    name: "Second-order overshoot",
    expected: "ζ = 0.3 → 37.2%",
    run(e) {
      const [s, ms] = timed(() => e.simulate(tf2ss([4], [1, 1.2, 4]), DEFAULT_CTRL, cfg({ tEnd: 15 })));
      const exp = 100 * Math.exp((-Math.PI * 0.3) / Math.sqrt(1 - 0.09));
      return { pass: Math.abs(s.metrics.overshootPct - exp) < 0.2, got: `${s.metrics.overshootPct.toFixed(2)}%`, ms };
    },
  },
  {
    name: "Closed-loop poles",
    expected: "s² + s + 4.25 → −0.5 ± 2j",
    run(e) {
      const [p, ms] = timed(() => e.poles(tf2ss([1], [1, 1, 0]), pid(4.25, 0, 0)));
      const ok = p.length === 2 && Math.abs(p[0].re + 0.5) < 1e-9 && Math.abs(Math.abs(p[0].im) - 2) < 1e-9;
      return { pass: ok, got: `${p[0].re.toFixed(3)} ± ${Math.abs(p[0].im).toFixed(3)}j`, ms };
    },
  },
  {
    name: "Phase margin",
    expected: "1/(s(s+1)) → 51.8°",
    run(e) {
      const [b, ms] = timed(() => e.bode(tf2ss([1], [1, 1, 0]), DEFAULT_CTRL, 800, 1e-3, 1e4));
      return { pass: Math.abs(b.pmDeg - 51.83) < 0.1, got: `${b.pmDeg.toFixed(2)}°`, ms };
    },
  },
  {
    name: "PI removes offset",
    expected: "e_ss → 0",
    run(e) {
      const [s, ms] = timed(() => e.simulate(tf2ss([1], [1, 1]), pid(2, 3, 0), cfg()));
      return { pass: Math.abs(s.metrics.ssError) < 1e-3, got: `e_ss ${s.metrics.ssError.toExponential(1)}`, ms };
    },
  },
  {
    name: "LQR double integrator",
    expected: "K = [1, √3]",
    run(e) {
      const plant = { n: 2, A: [0, 1, 0, 0], B: [0, 1], C: [1, 0], D: 0, delay: 0 };
      const [r, ms] = timed(() => e.lqr(plant, [1, 1], 1));
      return { pass: r.ok && Math.abs(r.K[0] - 1) < 5e-3 && Math.abs(r.K[1] - Math.sqrt(3)) < 5e-3, got: `[${r.K.map((k) => k.toFixed(3)).join(", ")}]`, ms };
    },
  },
  {
    name: "Pendulum balance",
    expected: "unstable plant → stable loop",
    run(e) {
      const M = 0.5,
        m = 0.2,
        b = 0.1,
        I = 0.006,
        g = 9.8,
        l = 0.3;
      const q = I * (M + m) + M * m * l * l;
      const plant = {
        n: 4,
        A: [0, 1, 0, 0, 0, (-(I + m * l * l) * b) / q, (m * m * g * l * l) / q, 0, 0, 0, 0, 1, 0, (-m * l * b) / q, (m * g * l * (M + m)) / q, 0],
        B: [0, (I + m * l * l) / q, 0, (m * l) / q],
        C: [1, 0, 0, 0],
        D: 0,
        delay: 0,
      };
      const [s, ms] = timed(() => {
        const k = e.lqr(plant, [5000, 0, 100, 0], 1);
        return e.simulate(plant, { ...DEFAULT_CTRL, type: CTRL_SF, K: k.K, Nbar: k.Nbar }, cfg({ tEnd: 6, ref: 0.2 }));
      });
      return { pass: s.metrics.stable === 1 && Math.abs(s.metrics.ssError) < 1e-3, got: `final ${s.metrics.finalValue.toFixed(4)} m`, ms };
    },
  },
  {
    name: "System identification",
    expected: "K 2 · τ 1.5 · θ 0.4",
    run(e) {
      const t: number[] = [],
        y: number[] = [];
      for (let i = 0; i <= 300; i++) {
        t.push(i * 0.02);
        y.push(stepFOPDT(2, 1.5, 0.4, i * 0.02) * 0.5);
      }
      const [f, ms] = timed(() => e.fit(t, y, 0.5, 1));
      return {
        pass: Math.abs(f.K - 2) < 0.01 && Math.abs(f.tau - 1.5) < 0.02 && Math.abs(f.theta - 0.4) < 0.02,
        got: `K ${f.K.toFixed(3)} · τ ${f.tau.toFixed(3)} · θ ${f.theta.toFixed(3)}`,
        ms,
      };
    },
  },
];

export function benchmark(engine: Engine): { steps: number; ms: number } {
  const plant = tf2ss([8], [0.05, 1.05, 1.0]);
  const c = cfg({ tEnd: 20, dt: 1e-4 });
  const t0 = performance.now();
  const s = engine.simulate(plant, pid(3, 4, 0.08), c);
  return { steps: s.y.length, ms: performance.now() - t0 };
}
