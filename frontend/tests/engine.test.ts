// Cross-checks the TypeScript engine against golden output from the native C++ build
// (engine/tests/golden.json, written by engine/tests/test_engine.cpp), and checks that every
// preset can be tuned to meet its own specs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { simulate, closedLoopPoles, bode } from "@/lib/sim/core";
import type { Ctrl, Plant } from "@/lib/sim/core";
import { tsEngine } from "@/lib/sim/engine";
import { SELF_TESTS } from "@/lib/sim/selftest";
import { PRESETS, matchPreset } from "@/lib/lab/presets";
import { autoTune } from "@/lib/lab/advisor";
import { checkSpecs, run } from "@/lib/lab/analysis";
import { validateDesign } from "@/lib/lab/validate";

interface GoldenCase {
  name: string;
  problem: { A: number[]; B: number[]; C: number[]; D: number; delay: number; ctrl: Ctrl };
  cfg: { tEnd: number; dt: number; ref: number; distTime: number; distMag: number; uMin: number; uMax: number; noiseStd: number; seed: number };
  metrics: number[];
  y: number[];
  u: number[];
  poles: number[];
  margins: number[];
}

const golden = JSON.parse(readFileSync(new URL("../../engine/tests/golden.json", import.meta.url), "utf8")) as { cases: GoldenCase[] };

describe("TypeScript engine matches the C++ engine", () => {
  for (const c of golden.cases) {
    it(c.name, () => {
      const plant: Plant = { n: c.problem.B.length, A: c.problem.A, B: c.problem.B, C: c.problem.C, D: c.problem.D, delay: c.problem.delay };
      const ctrl = { ...c.problem.ctrl, type: c.problem.ctrl.type as Ctrl["type"] };
      const s = simulate(plant, ctrl, c.cfg);
      const scale = Math.max(1, Math.abs(c.cfg.ref));
      c.y.forEach((v, i) => expect(Math.abs(s.y[i * 10] - v) / scale).toBeLessThan(1e-9));
      c.u.forEach((v, i) => expect(Math.abs(s.u[i * 10] - v)).toBeLessThan(1e-6 * Math.max(1, Math.abs(v))));
      expect(s.metrics.overshootPct).toBeCloseTo(c.metrics[2], 6);
      expect(s.metrics.stable).toBe(c.metrics[10]);
      const poles = closedLoopPoles(plant, ctrl);
      poles.forEach((p, i) => {
        expect(p.re).toBeCloseTo(c.poles[2 * i], 6);
        expect(p.im).toBeCloseTo(c.poles[2 * i + 1], 6);
      });
      const b = bode(plant, ctrl, 400, 1e-2, 1e3);
      expect(Math.min(b.pmDeg, 1e9)).toBeCloseTo(c.margins[1], 4);
    });
  }
});

describe("analytic self-tests", () => {
  for (const t of SELF_TESTS) it(t.name, () => expect(t.run(tsEngine).pass).toBe(true));
});

describe("presets", () => {
  it("every description lands on one of the four hardware rigs", () => {
    expect(matchPreset("my self-balancing robot falls over").preset.id).toBe("balancer");
    expect(matchPreset("a DC motor driving a conveyor").preset.id).toBe("rover");
    expect(matchPreset("quadcopter altitude hold").preset.id).toBe("drone");
    expect(matchPreset("a servo lifting a robot arm joint").preset.id).toBe("arm");
    expect(matchPreset("a camera gimbal that should point steadily").preset.id).toBe("arm");
    expect(matchPreset("something completely different").preset.id).toBe("rover");
    expect(matchPreset("A small DC motor drives the shoulder of a robot arm").preset.id).toBe("arm");
    expect(matchPreset("a two wheeled robot that must stay upright").preset.id).toBe("balancer");
    expect(matchPreset("a motorised lift that raises a platform").preset.id).toBe("drone");
  });

  for (const preset of PRESETS) {
    it(`${preset.id}: auto-tune meets specs and passes validation`, async () => {
      const model = preset.build();
      const first = run(tsEngine, model, model.controller);
      expect(first.analysis.poles.length).toBeGreaterThan(0);
      const tuned = autoTune(tsEngine, model, model.controller);
      const after = run(tsEngine, model, tuned);
      const checks = checkSpecs(after.analysis.metrics, model.specs, model.sim.ref);
      expect(checks.filter((c) => !c.pass).map((c) => `${c.label} ${c.value}`)).toEqual([]);
      const results = [];
      for await (const r of validateDesign(tsEngine, model, tuned)) results.push(r);
      expect(results.filter((r) => r.verdict === "fail").map((r) => `${r.label}: ${r.detail}`)).toEqual([]);
    }, 60_000);
  }
});
