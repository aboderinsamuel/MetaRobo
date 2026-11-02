// Keeping a robot's arms out of its own body and out of the furniture. The simulator moves the
// robot by inverse kinematics, which knows nothing about volume: left alone, a hand can hang inside
// a hip or an elbow can swing through a table. This measures how far an arm's parts are inside
// solid things, so the planner can prefer arm configurations that stay clear and report the ones
// that don't.
//
// Cheap on purpose (it runs on every planned reach): each forearm, wrist, hand and finger is a few
// sample points; the body and the furniture are boxes. A point inside a box counts by its depth.
import * as THREE from "three";
import type { Obb } from "./cloth";
import { buildGeometry } from "./geometry";
import type { RobotModel } from "./kinematics";

/** Body boxes are shrunk by this much on every side: touching is fine, going in is not. */
const SKIN = 0.008;

interface Box {
  node: number;
  /** box centre in the node's frame */
  centre: THREE.Vector3;
  half: THREE.Vector3;
  radius: number;
}

interface Probe {
  node: number;
  /** sample points in the node's frame */
  points: THREE.Vector3[];
  centre: THREE.Vector3;
  radius: number;
  /** part of the hand (touching what it works on is its job) */
  hand: boolean;
}

export interface Arm {
  /** the effector's node */
  effector: number;
  /** the arm's first own joint (not shared with another arm) */
  root: number;
  /** its joints, nearest the body first */
  joints: number[];
}

export class Clearance {
  readonly arms: Arm[];
  private probes: Probe[] = [];
  private body: Box[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly inv = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly c = new THREE.Vector3();

  constructor(
    private readonly robot: RobotModel,
    effectorNodes: number[],
  ) {
    const chains = effectorNodes.map((e) => robot.chain(e));
    this.arms = effectorNodes.map((e, k) => {
      // The arm starts at the first joint (from the body outwards) that no other arm shares.
      const own = chains[k].filter((j) => !chains.some((c, o) => o !== k && c.includes(j)));
      const joints = [...own].reverse();
      return { effector: e, root: joints[0] ?? e, joints };
    });
    const inArm = new Set(this.arms.flatMap((a) => [...robot.subtree(a.root)]));
    robot.nodes.forEach((n, i) => {
      if (n.shape === "tube" || n.role === "cable") return;
      const g = buildGeometry(n);
      const bb = g.boundingBox!;
      g.dispose();
      const size = bb.getSize(new THREE.Vector3());
      if (Math.max(size.x, size.y, size.z) < 0.01) return;
      const centre = bb.getCenter(new THREE.Vector3());
      if (!inArm.has(i)) {
        const half = size.multiplyScalar(0.5).subScalar(SKIN);
        if (Math.min(half.x, half.y, half.z) <= 0.002) return;
        this.body.push({ node: i, centre, half, radius: half.length() });
      }
    });
    // Probes: an arm's parts from the elbow out (the shoulder and upper arm are built into the body).
    for (const a of this.arms) {
      const hand = robot.subtree(a.effector);
      const elbowOut = new Set<number>();
      const elbow = a.joints[Math.min(2, a.joints.length - 1)];
      if (elbow === undefined) continue;
      for (const i of robot.subtree(elbow)) elbowOut.add(i);
      for (const i of elbowOut) {
        const n = robot.nodes[i];
        if (n.shape === "tube" || n.role === "cable") continue;
        const g = buildGeometry(n);
        const bb = g.boundingBox!;
        g.dispose();
        const size = bb.getSize(new THREE.Vector3());
        if (Math.max(size.x, size.y, size.z) < 0.008) continue;
        const centre = bb.getCenter(new THREE.Vector3());
        // The centre and the corners pulled 30% in (so a part's rounded edges don't count).
        const points = [centre.clone()];
        for (let k = 0; k < 8; k++) points.push(new THREE.Vector3(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).lerp(centre, 0.3));
        this.probes.push({ node: i, points, centre, radius: size.length() / 2, hand: hand.has(i) });
      }
    }
  }

  /** How deep (m, summed over sample points) the arms are inside the robot's own body right now. */
  selfDepth(only?: Arm): number {
    const r = this.robot;
    let total = 0;
    const probes = only ? this.probes.filter((p) => r.subtree(only.root).has(p.node)) : this.probes;
    const bodyWorld = this.body.map((b) => {
      this.c.copy(b.centre).applyMatrix4(r.world[b.node]);
      return this.c.clone();
    });
    for (const pr of probes) {
      const pc = this.p.copy(pr.centre).applyMatrix4(r.world[pr.node]).clone();
      for (let k = 0; k < this.body.length; k++) {
        const b = this.body[k];
        if (pc.distanceTo(bodyWorld[k]) > pr.radius + b.radius) continue;
        this.m.copy(r.world[b.node]).multiply(new THREE.Matrix4().makeTranslation(b.centre.x, b.centre.y, b.centre.z));
        this.inv.copy(this.m).invert();
        for (const pt of pr.points) total += depthIn(this.p.copy(pt).applyMatrix4(r.world[pr.node]).applyMatrix4(this.inv), b.half);
      }
    }
    return total;
  }

  /** How deep the arms' non-hand parts (forearm, elbow, wrist) are inside furniture (hands too, if asked). */
  sceneDepth(fixtures: Obb[], only?: Arm, hands = false): number {
    const r = this.robot;
    let total = 0;
    const probes = (only ? this.probes.filter((p) => r.subtree(only.root).has(p.node)) : this.probes).filter((p) => hands || !p.hand);
    for (const pr of probes)
      for (const b of fixtures)
        for (const pt of pr.points) total += depthIn(this.p.copy(pt).applyMatrix4(r.world[pr.node]).applyMatrix4(b.inv), b.half);
    return total;
  }

  /** How deep world points (the corners of something the robot holds) are inside its own body. */
  pointsInBody(points: THREE.Vector3[]): number {
    const r = this.robot;
    let total = 0;
    for (const b of this.body) {
      this.c.copy(b.centre).applyMatrix4(r.world[b.node]);
      if (!points.some((p) => p.distanceTo(this.c) < b.radius + 0.3)) continue;
      this.m.copy(r.world[b.node]).multiply(new THREE.Matrix4().makeTranslation(b.centre.x, b.centre.y, b.centre.z));
      this.inv.copy(this.m).invert();
      for (const p of points) total += depthIn(this.p.copy(p).applyMatrix4(this.inv), b.half);
    }
    return total;
  }

  /** Which arm part is inside which body part, for the report (the deepest pair). */
  worstSelf(): { probe: number; body: number } | null {
    const r = this.robot;
    let best: { probe: number; body: number; d: number } | null = null;
    for (const pr of this.probes)
      for (const b of this.body) {
        this.m.copy(r.world[b.node]).multiply(new THREE.Matrix4().makeTranslation(b.centre.x, b.centre.y, b.centre.z));
        this.inv.copy(this.m).invert();
        let d = 0;
        for (const pt of pr.points) d += depthIn(this.p.copy(pt).applyMatrix4(r.world[pr.node]).applyMatrix4(this.inv), b.half);
        if (d > 0 && (!best || d > best.d)) best = { probe: pr.node, body: b.node, d };
      }
    return best && { probe: best.probe, body: best.body };
  }
}

/** Depth of a box-local point inside a box (0 when outside). */
function depthIn(l: THREE.Vector3, half: THREE.Vector3): number {
  const dx = half.x - Math.abs(l.x),
    dy = half.y - Math.abs(l.y),
    dz = half.z - Math.abs(l.z);
  return dx > 0 && dy > 0 && dz > 0 ? Math.min(dx, dy, dz) : 0;
}
