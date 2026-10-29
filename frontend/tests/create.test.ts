// The AI-native design pipeline: sanitising, mirroring, kinematics and the physics simulation.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { sanitizeDesign } from "@/lib/create/design";
import { buildColliders, buildGeometry } from "@/lib/create/geometry";
import { RobotModel } from "@/lib/create/kinematics";
import { simulate } from "@/lib/create/sim";
import { ARM_FIXTURE } from "./fixtures/createFixtures";

describe("design format", () => {
  it("mirrors left-side parts and keeps ids unique", () => {
    const d = sanitizeDesign(ARM_FIXTURE);
    const ids = d.robot.nodes.map((n) => n.id);
    expect(ids).toContain("r_finger");
    expect(new Set(ids).size).toBe(ids.length);
    const r = d.robot.nodes.find((n) => n.id === "r_finger")!;
    expect(r.position[0]).toBeCloseTo(-0.018);
    expect(r.parent).toBe("wrist");
  });

  it("repairs bad input instead of failing", () => {
    const d = sanitizeDesign({
      ...ARM_FIXTURE,
      robot: { ...ARM_FIXTURE.robot, nodes: [...ARM_FIXTURE.robot.nodes, { ...ARM_FIXTURE.robot.nodes[1], id: "loop", parent: "loop", shape: "lathe" as const, points: [[0.1, 0]] }] },
      task: [{ ...ARM_FIXTURE.task[0], target: "ghost", action: "dance" as never }],
    });
    const loop = d.robot.nodes.find((n) => n.id === "loop")!;
    expect(loop.parent).toBe("");
    expect(loop.shape).toBe("box");
    expect(d.task[0].action).toBe("wait");
    expect(d.task[0].target).toBe("");
  });

  it("builds geometry and colliders for every shape", () => {
    for (const shape of ["box", "cylinder", "capsule", "sphere", "torus", "bin", "drum"] as const) {
      const s = { shape, dims: [0.2, 0.1, 0.15], bevel: 0.01, points: [], offset: [0, 0, 0], orient: [0, 0, 0] };
      expect(buildGeometry(s).attributes.position.count).toBeGreaterThan(0);
      expect(buildColliders(s, "static").length).toBeGreaterThan(0);
    }
    const lathe = { shape: "lathe" as const, dims: [0.1, 0.1, 0.1], bevel: 0, points: [[0, 0], [0.05, 0.02], [0.04, 0.1]], offset: [0, 0, 0], orient: [0, 0, 0] };
    expect(buildColliders(lathe, "dynamic")[0].type).toBe("hull");
  });
});

describe("kinematics", () => {
  it("reaches a point in front of the arm within its limits", () => {
    const robot = new RobotModel(sanitizeDesign(ARM_FIXTURE));
    const wrist = robot.index.get("wrist")!;
    const target = new THREE.Vector3(0.1, 0.1, 0.4);
    expect(robot.solveIK(wrist, [0, 0.085, 0], target)).toBeLessThan(0.01);
    for (const j of robot.moving) {
      const { min, max } = robot.nodes[j].joint;
      expect(robot.q[j]).toBeGreaterThanOrEqual(min - 1e-6);
      expect(robot.q[j]).toBeLessThanOrEqual(max + 1e-6);
    }
  });

  it("computes holding torques from the links' real masses", () => {
    const robot = new RobotModel(sanitizeDesign(ARM_FIXTURE));
    const t = robot.gravityTorques();
    const shoulder = t.get(robot.index.get("upper")!)!;
    expect(shoulder).toBeGreaterThan(0.05);
    expect(shoulder).toBeLessThan(12);
  });
});

describe("task simulation", () => {
  it("picks up the box, drops it in the bin, and folds the towel", async () => {
    const d = sanitizeDesign(ARM_FIXTURE);
    const rec = await simulate(d);
    expect(rec.frames).toBeGreaterThan(100);
    // The box ends up inside the bin's footprint.
    const k = rec.rigid.indexOf("box");
    const last = (rec.frames - 1) * rec.rigid.length * 7 + k * 7;
    const [x, y, z] = [rec.rigidPose[last], rec.rigidPose[last + 1], rec.rigidPose[last + 2]];
    expect(Math.abs(x - 0.38)).toBeLessThan(0.12);
    expect(Math.abs(z - 0.2)).toBeLessThan(0.12);
    expect(y).toBeLessThan(0.15);
    expect(rec.checks.find((c) => c.id === "folded-towel")?.level).toBe("pass");
    expect(rec.steps.every((s) => s.ok)).toBe(true);
  }, 60_000);
});
