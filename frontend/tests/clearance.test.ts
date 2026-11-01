import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Clearance } from "@/lib/create/clearance";
import { sanitizeDesign } from "@/lib/create/design";
import { buildGeometry } from "@/lib/create/geometry";
import { bringWithinReach } from "@/lib/create/layout";
import { simulate } from "@/lib/create/sim";
import { RobotModel } from "@/lib/create/kinematics";

const humanoid = () => sanitizeDesign(JSON.parse(readFileSync("public/examples/laundry-humanoid.json", "utf8")));

describe("arm clearance", () => {
  it("finds a hand pushed into the hip, and none when the arm hangs free", () => {
    const d = humanoid();
    const robot = new RobotModel(d);
    const clear = new Clearance(robot, d.robot.effectors.map((e) => robot.index.get(e.node)!));
    expect(clear.arms).toHaveLength(2);
    robot.fk();
    expect(clear.selfDepth()).toBe(0);
    // Swing the left arm in across the body (shoulder roll towards the hips) and bend the elbow.
    const roll = robot.index.get("l_shoulder_roll")!;
    const elbow = robot.index.get("l_elbow")!;
    robot.q[roll] = robot.nodes[roll].joint.min;
    robot.q[elbow] = 90;
    robot.fk();
    const left = clear.arms.find((a) => robot.nodes[a.effector].id === "l_palm")!;
    expect(clear.selfDepth(left)).toBeGreaterThan(0);
    expect(clear.worstSelf()).not.toBeNull();
  });
});

describe("lathe shapes", () => {
  it("are centred on their offset, like every other shape", () => {
    const g = buildGeometry({ shape: "lathe", dims: [0, 0, 0], bevel: 0, points: [[0.1, 0], [0.15, 0.2], [0.1, 0.44]], offset: [0, 0.5, 0], orient: [0, 0, 0] });
    const c = g.boundingBox!.getCenter(new THREE.Vector3());
    expect(c.y).toBeCloseTo(0.5, 3);
    expect(g.boundingBox!.getSize(new THREE.Vector3()).y).toBeCloseTo(0.44, 3);
  });
});

describe("real contact and real outcomes", () => {
  const deskBuddy = () => sanitizeDesign(JSON.parse(readFileSync("public/examples/desk-buddy.json", "utf8")));

  it("sets a loose item the arm can't reach out within reach, with the cup it stands in", () => {
    const d = deskBuddy();
    const { design, moved } = bringWithinReach(d);
    expect(moved.map((m) => m.id)).toContain("moved-desk_pen");
    const before = (id: string) => d.scene.find((o) => o.id === id)!.position;
    const after = (id: string) => design.scene.find((o) => o.id === id)!.position;
    // Pen and cup move together, along the desk (same height), and the original is untouched.
    expect(after("desk_pen")[0] - before("desk_pen")[0]).toBeCloseTo(after("pen_cup")[0] - before("pen_cup")[0], 6);
    expect(after("desk_pen")[1]).toBe(before("desk_pen")[1]);
    expect(after("desk_pen")).not.toEqual(before("desk_pen"));
  });

  it("only holds what the fingers touch, and completes the desk buddy's whole task", async () => {
    const r = await simulate(deskBuddy());
    expect(r.checks.some((c) => c.title.startsWith("Missed"))).toBe(false);
    expect(r.steps.every((s) => s.ok)).toBe(true);
  }, 60_000);
});
