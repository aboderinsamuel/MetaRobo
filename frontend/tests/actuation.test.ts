// Per-actuator simulation: real speeds, torque limits, current and the engineering checks.
import { describe, expect, it } from "vitest";
import { at, loadKgcm, simulateMachine } from "@/lib/lab/actuation";
import { sanitizeAssembly, type AiAssembly } from "@/lib/lab/assembly";

type Raw = AiAssembly["parts"][number];
const raw = (p: Partial<Raw> & Pick<Raw, "id" | "ref">): Raw => ({
  name: p.id,
  parent: "",
  size: [0, 0, 0],
  material: "",
  color: "",
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  repeat: 1,
  repeatMode: "radial",
  repeatAxis: "y",
  repeatStep: 0,
  ...p,
});

/** One servo lifting a load on an arm, with a controller and a supply. */
function rig({ servo = "mg996r", loadG = 40, leverMm = 60, duration = 1, target = 90, supply = "batt-18650x2", regulator = true } = {}) {
  return sanitizeAssembly({
    title: "Test arm",
    parts: [
      raw({ id: "base", ref: "fab:plate", size: [0.2, 0.003, 0.15] }),
      raw({ id: "servo", ref: servo, parent: "base" }),
      raw({ id: "arm", ref: "fab:printed", parent: "servo", size: [0.1, 0.008, 0.02] }),
      raw({ id: "uno", ref: "arduino-uno", parent: "base" }),
      raw({ id: "power", ref: supply, parent: "base" }),
      ...(regulator ? [raw({ id: "bec", ref: "ubec-5a", parent: "base" })] : []),
    ],
    joints: [{ id: "lift", part: "arm", actuator: "servo", kind: "rotate", axis: "z", min: 0, max: 180, loadG, leverMm }],
    program: [{ label: "Lift", duration, targets: [{ joint: "lift", value: target }] }],
  });
}

describe("simulateMachine", () => {
  it("moves a servo at its real speed: an MG996R takes ~0.21 s for 90°", () => {
    const sim = simulateMachine(rig({ loadG: 0, leverMm: 0 }));
    const tr = sim.traces[0];
    // Program starts at 0.3 s; 428°/s → 90° in ≈ 0.21 s.
    expect(at(tr.value, 0.3 + 0.1)).toBeGreaterThan(30);
    expect(at(tr.value, 0.3 + 0.1)).toBeLessThan(60);
    expect(at(tr.value, 0.3 + 0.3)).toBeCloseTo(90, 0);
  });

  it("slows down under load", () => {
    const light = simulateMachine(rig({ loadG: 0, leverMm: 0 })).traces[0];
    const heavy = simulateMachine(rig({ loadG: 1200, leverMm: 60 })).traces[0];
    expect(at(heavy.value, 0.4)).toBeLessThan(at(light.value, 0.4));
    expect(heavy.torqueRatio).toBeCloseTo(loadKgcm(1200, 60) / 11, 5);
  });

  it("flags a servo that can't lift its load, and it doesn't move", () => {
    const sim = simulateMachine(rig({ servo: "sg90", loadG: 500, leverMm: 100 }));
    expect(sim.traces[0].stalled).toBe(true);
    expect(at(sim.traces[0].value, 1)).toBeLessThan(5);
    expect(sim.checks[0]).toMatchObject({ level: "error", id: "torque-lift" });
  });

  it("warns when a step is too short for the actuator's real speed", () => {
    const sim = simulateMachine(rig({ servo: "hs422", duration: 0.1, target: 180 }));
    expect(sim.checks.some((c) => c.id === "late-lift")).toBe(true);
  });

  it("catches over-voltage without a regulator, and missing controller / driver / supply", () => {
    const over = simulateMachine(rig({ servo: "sg90", supply: "lipo-3s-2200", regulator: false }));
    expect(over.checks.some((c) => c.id === "voltage" && c.level === "error")).toBe(true);

    const bare = simulateMachine(
      sanitizeAssembly({
        title: "Bare",
        parts: [raw({ id: "m", ref: "tt-motor" })],
        joints: [],
        program: [],
      }),
    );
    const ids = bare.checks.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["power", "controller", "motor-driver"]));
  });

  it("estimates current and runtime", () => {
    const sim = simulateMachine(rig());
    expect(sim.peakA).toBeGreaterThan(0.05);
    expect(sim.checks.some((c) => c.id === "runtime")).toBe(true);
    expect(sim.checks.some((c) => c.id === "current" && c.level === "pass")).toBe(true);
  });
});
