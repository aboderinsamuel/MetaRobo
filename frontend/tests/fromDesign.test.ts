// A realistic design becomes a Control Lab machine: same body, real hardware inside.
import { describe, expect, it } from "vitest";
import { sanitizeDesign } from "@/lib/create/design";
import { simulateMachine } from "@/lib/lab/actuation";
import { catalogOf } from "@/lib/lab/assembly";
import { designToAssembly } from "@/lib/lab/fromDesign";
import { ARM_FIXTURE } from "./fixtures/createFixtures";

describe("design → Control Lab machine", () => {
  const d = sanitizeDesign(ARM_FIXTURE);
  const { assembly } = designToAssembly(d);

  it("keeps every body part exactly as designed", () => {
    const shells = assembly.parts.filter((p) => p.kind === "shell");
    expect(shells.length).toBe(d.robot.nodes.length);
    const upper = shells.find((p) => p.id === "upper")!;
    expect(upper.shell?.shape).toBe("box");
    expect(upper.shell?.material).toBe("anodized_aluminium");
    expect(upper.massG).toBeGreaterThan(0);
  });

  it("puts a real actuator on every joint, inside the body", () => {
    const moving = d.robot.nodes.filter((n) => n.joint.type !== "fixed");
    expect(assembly.joints.length).toBe(moving.length);
    for (const j of assembly.joints) {
      const act = assembly.parts.find((p) => p.id === j.actuator)!;
      expect(act.internal).toBe(true);
      expect(catalogOf(act)?.actuator).toBeTruthy();
    }
    // The design named Dynamixel XL430s: the lab uses that real part.
    expect(assembly.parts.some((p) => p.catalogId === "dynamixel-xl430")).toBe(true);
  });

  it("adds the controller, power, drivers and wires them", () => {
    expect(assembly.parts.some((p) => catalogOf(p)?.category === "controller")).toBe(true);
    expect(assembly.parts.some((p) => catalogOf(p)?.category === "power")).toBe(true);
    expect(assembly.connections.length).toBeGreaterThan(assembly.joints.length);
  });

  it("runs in the lab's own simulation with a motion program", () => {
    expect(assembly.program.length).toBeGreaterThan(0);
    const sim = simulateMachine(assembly);
    expect(sim.traces.length).toBe(assembly.joints.length);
    expect(sim.checks.some((c) => c.id.startsWith("torque") || c.title.toLowerCase().includes("torque"))).toBe(true);
  });
});
