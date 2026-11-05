// Hardware builds: parts → physics, design checks, auto-fixes, wiring and hardware-aware tuning.
import { describe, expect, it } from "vitest";
import { autoTune, sustainedCurrent } from "@/lib/lab/advisor";
import { checkSpecs, run } from "@/lib/lab/analysis";
import { SLOTS, applyHints, defaultBuild, deriveHardware, liveChecks, telemetry } from "@/lib/lab/hardware/build";
import type { HardwareBuild } from "@/lib/lab/hardware/build";
import type { RigKind } from "@/lib/lab/types";
import { tsEngine } from "@/lib/sim/engine";

const KINDS: RigKind[] = ["rover", "arm", "balancer", "drone"];
const errors = (b: HardwareBuild) => deriveHardware(b).checks.filter((c) => c.level === "error");
const withPart = (kind: RigKind, parts: HardwareBuild["parts"], geom: Record<string, number> = {}): HardwareBuild => {
  const b = defaultBuild(kind);
  return { ...b, parts: { ...b.parts, ...parts }, geom: { ...b.geom, ...geom } };
};

describe("default builds", () => {
  for (const kind of KINDS) {
    it(`${kind}: derives a stable, buildable design with consistent wiring`, () => {
      const hw = deriveHardware(defaultBuild(kind));
      expect(errors(hw.build)).toEqual([]);
      expect(hw.stats).toHaveLength(4);
      expect(hw.cost).toBeGreaterThan(0);
      expect(hw.massKg).toBeGreaterThan(0.1);
      const r = run(tsEngine, hw.model, hw.model.controller);
      expect(r.analysis.metrics.stable).toBe(1);
      // Every wire lands on a real pin of a real node.
      const nodes = new Map(hw.wiring.nodes.map((n) => [n.id, n]));
      for (const e of hw.wiring.edges)
        for (const [id, pin] of [e.from, e.to]) {
          expect(nodes.has(id), `${kind}: node ${id}`).toBe(true);
          expect(nodes.get(id)!.pins, `${kind}: ${id}.${pin}`).toContain(pin);
        }
    });
  }

  it("every part option derives without NaNs", () => {
    for (const kind of KINDS)
      for (const s of SLOTS[kind])
        for (const o of s.options) {
          const hw = deriveHardware(withPart(kind, { [s.slot]: o.id }));
          const nums = hw.model.plant.kind === "tf" ? [...hw.model.plant.num, ...hw.model.plant.den] : [...hw.model.plant.A.flat(), ...hw.model.plant.B];
          expect(nums.every(Number.isFinite), `${kind}/${o.id}`).toBe(true);
          expect(Number.isFinite(hw.model.specs.uMax) && hw.model.specs.uMax > 0, `${kind}/${o.id} uMax`).toBe(true);
        }
  });
});

describe("design checks catch wrong hardware", () => {
  it("arm: a TT motor can't hold the arm, and the suggested fix resolves it", () => {
    const bad = withPart("arm", { motor: "tt" });
    const hold = deriveHardware(bad).checks.find((c) => c.id === "hold")!;
    expect(hold.level).toBe("error");
    expect(hold.fix?.parts?.motor).toBeDefined();
    const fixed = { ...bad, parts: { ...bad.parts, ...hold.fix!.parts } };
    expect(deriveHardware(fixed).checks.find((c) => c.id === "hold")!.level).not.toBe("error");
  });

  it("arm: a heavy payload on a narrow base tips over", () => {
    expect(errors(withPart("arm", {}, { payload: 0.6, baseR: 0.04 })).map((c) => c.id)).toContain("tip");
  });

  it("rover: motors that don't fit across the chassis are flagged with a widen fix", () => {
    const c = deriveHardware(withPart("rover", { motor: "jgb37" }, { chassisW: 0.1 })).checks.find((x) => x.id === "fit-motor")!;
    expect(c.level).toBe("error");
    expect(c.fix?.geom?.chassisW).toBeGreaterThan(0.16);
  });

  it("rover: slow motors can't reach the cruise speed", () => {
    expect(errors(withPart("rover", { motor: "jgb37" }, { target: 1.5 })).map((c) => c.id)).toContain("topspeed");
  });

  it("battery over the driver's voltage limit is an error with a driver fix", () => {
    const c = deriveHardware(withPart("rover", { battery: "lipo-4s", driver: "tb6612" })).checks.find((x) => x.id === "drv-volt")!;
    expect(c.level).toBe("error");
    expect(c.fix?.parts?.driver).toBeDefined();
  });

  it("3.3 V boards get a level shifter for 5 V sensor outputs", () => {
    const hw = deriveHardware(withPart("rover", { board: "esp32" }));
    expect(hw.checks.find((c) => c.id === "level")!.auto).toBe(true);
    expect(hw.wiring.nodes.some((n) => n.id === "ls")).toBe(true);
    expect(deriveHardware(withPart("rover", { board: "uno" })).wiring.nodes.some((n) => n.id === "ls")).toBe(false);
  });

  it("drone: a 6S pack on a 2–4S ESC, an under-powered build and an out-of-range altimeter", () => {
    expect(errors(withPart("drone", { battery: "d6s1100" })).map((c) => c.id)).toContain("esc-cells");
    expect(errors(withPart("drone", { motor: "1404", prop: "p3" }, { payload: 1.2 })).map((c) => c.id)).toContain("twr");
    expect(errors(withPart("drone", { sensor: "hcsr04" }, { target: 4.5 })).map((c) => c.id)).toContain("alt-range");
  });

  it("swapping parts changes the physics", () => {
    const slow = deriveHardware(withPart("rover", { motor: "jgb37" }));
    const fast = deriveHardware(withPart("rover", { motor: "jga25-12" }));
    expect(fast.facts.vTop).toBeGreaterThan(slow.facts.vTop);
    const lipo = deriveHardware(withPart("balancer", { driver: "tb6612", battery: "lipo-2s" }));
    expect(lipo.model.specs.uMax).toBeCloseTo(7.4 - 0.5, 6);
  });
});

describe("live checks and hardware-aware tuning", () => {
  it("the arm's first guess overdraws the L298N; auto-tune meets the specs inside its rating", () => {
    const hw = deriveHardware(defaultBuild("arm"));
    const m = hw.model;
    const r0 = run(tsEngine, m, m.controller);
    const live0 = liveChecks(hw, telemetry(hw, r0.sim.y, r0.sim.u, r0.sim.dt), r0.sim.u, r0.analysis.wcp, true);
    expect(live0.find((c) => c.id === "live-amps")!.level).not.toBe("pass");
    const tuned = autoTune(tsEngine, m, m.controller, 80);
    const r1 = run(tsEngine, m, tuned, { noiseStd: 0 });
    expect(checkSpecs(r1.analysis.metrics, m.specs, m.sim.ref).every((c) => c.pass)).toBe(true);
    expect(sustainedCurrent(m.drive!, r1.sim.y, r1.sim.u, r1.sim.dt)).toBeLessThanOrEqual(m.drive!.limitA);
  }, 60000);
});

describe("description hints", () => {
  it("sizes each rig from the words", () => {
    expect(applyHints(defaultBuild("balancer"), "centre of mass 20 cm above the axle; drive it 50 cm forward").geom).toMatchObject({ comH: 0.2, target: 0.5 });
    const d = applyHints(defaultBuild("drone"), "a quad carrying a 200 g camera that must climb 2 m").geom;
    expect(d.target).toBe(2);
    expect(d.payload).toBeCloseTo(0.2, 6);
    const a = applyHints(defaultBuild("arm"), "lift a 100 g part 45 degrees").geom;
    expect(a.payload).toBeCloseTo(0.1, 6);
    expect(a.target).toBeCloseTo(Math.PI / 4, 6);
    expect(applyHints(defaultBuild("rover"), "cruise at 0.8 m/s").geom.target).toBe(0.8);
  });
});
