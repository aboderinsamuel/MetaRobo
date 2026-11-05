// The robot as a kinematic tree: forward kinematics from joint values, inverse kinematics (CCD,
// respecting every joint's axis and limits) to reach targets, and static joint torques from the
// real masses of the links. Used by the simulation (to move the robot) and the viewport.
import * as THREE from "three";
import { nodeMassKg, type Design, type NodeSpec } from "./design";

const DEG = Math.PI / 180;
const G = 9.81;

export interface BasePose {
  x: number;
  z: number;
  /** radians about y; 0 = the design's own orientation (it faces +z) */
  yaw: number;
  /** metres the body is lowered by bending the legs (≤ 0); legged robots crouch to reach low things */
  crouch: number;
  /** radians the upper body leans forward from the hips (legs stay where they are) */
  lean: number;
}

interface Leg {
  hip: number;
  knee: number;
  ankle: number;
  thigh: number;
  shin: number;
  /** +1 if a positive knee angle bends the shin backwards (the usual), else −1 */
  sign: number;
}

/**
 * The robot's base transform: travel (x, z), height (floor offset + crouch), heading (yaw about the
 * vertical), and the upper body's forward lean, which pivots at the pelvis (`pivot`, in the base
 * frame), not at the floor.
 */
export function baseTransform(pose: BasePose, baseY: number, pivot: THREE.Vector3, out = new THREE.Matrix4()): THREE.Matrix4 {
  const yaw = new THREE.Matrix4().makeRotationY(pose.yaw);
  const lean = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(new THREE.Matrix4().makeRotationX(pose.lean)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  return out.makeTranslation(pose.x, baseY + pose.crouch, pose.z).multiply(yaw).multiply(lean);
}

export class RobotModel {
  readonly nodes: NodeSpec[];
  readonly index = new Map<string, number>();
  readonly parent: number[];
  /** nodes in parent-before-child order */
  readonly order: number[];
  readonly children: number[][];
  readonly rest: THREE.Matrix4[];
  readonly world: THREE.Matrix4[];
  readonly mass: number[];
  /** centre of mass of each node in its own frame */
  readonly com: THREE.Vector3[];
  /** joint value per node (deg / m); fixed joints stay 0 */
  q: Float64Array;
  base: BasePose = { x: 0, z: 0, yaw: 0, crouch: 0, lean: 0 };
  /** lift so the lowest point of the robot at rest touches the floor */
  baseY = 0;
  /** where the upper body leans from: the root node's origin (the pelvis) */
  readonly pivot: THREE.Vector3;
  readonly moving: number[];

  constructor(design: Design) {
    this.nodes = design.robot.nodes;
    this.nodes.forEach((n, i) => this.index.set(n.id, i));
    this.parent = this.nodes.map((n) => (n.parent ? (this.index.get(n.parent) ?? -1) : -1));
    this.children = this.nodes.map(() => []);
    this.parent.forEach((p, i) => p >= 0 && this.children[p].push(i));
    this.order = [];
    const visit = (i: number) => {
      this.order.push(i);
      for (const c of this.children[i]) visit(c);
    };
    this.parent.forEach((p, i) => p < 0 && visit(i));
    this.rest = this.nodes.map((n) => new THREE.Matrix4().compose(new THREE.Vector3(...n.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(n.rotation[0] * DEG, n.rotation[1] * DEG, n.rotation[2] * DEG)), new THREE.Vector3(1, 1, 1)));
    this.world = this.nodes.map(() => new THREE.Matrix4());
    this.mass = this.nodes.map((n) => nodeMassKg(n));
    this.com = this.nodes.map((n) => new THREE.Vector3(...n.offset));
    this.q = Float64Array.from(this.nodes.map((n) => (n.joint.type === "fixed" ? 0 : n.joint.rest)));
    this.moving = this.nodes.map((n, i) => (n.joint.type === "fixed" ? -1 : i)).filter((i) => i >= 0);
    const root = this.nodes.find((n) => !n.parent);
    this.pivot = new THREE.Vector3().fromArray(root?.position ?? [0, 0, 0]);
    this.fk();
    // Stand on the floor: the lowest vertex-ish point (shape centre minus half its height).
    let minY = Infinity;
    const p = new THREE.Vector3();
    this.nodes.forEach((n, i) => {
      p.fromArray(n.offset).applyMatrix4(this.world[i]);
      const half = n.shape === "tube" ? n.dims[0] / 2 : Math.max(n.dims[1], n.shape === "sphere" ? n.dims[1] : 0) / 2;
      minY = Math.min(minY, p.y - half);
    });
    this.baseY = Number.isFinite(minY) && (minY < 0 || design.robot.mobility !== "fixed") ? -minY : 0;
    this.fk();
  }

  private jointMatrix(i: number, out: THREE.Matrix4): THREE.Matrix4 {
    const j = this.nodes[i].joint;
    if (j.type === "revolute") return out.makeRotationAxis(new THREE.Vector3(...j.axis), this.q[i] * DEG);
    if (j.type === "prismatic") return out.makeTranslation(j.axis[0] * this.q[i], j.axis[1] * this.q[i], j.axis[2] * this.q[i]);
    return out.identity();
  }

  baseMatrix(out = new THREE.Matrix4()): THREE.Matrix4 {
    return baseTransform(this.base, this.baseY, this.pivot, out);
  }

  /** World matrices from the base pose and joint values. */
  fk(from = -1): void {
    const jm = new THREE.Matrix4();
    const base = this.baseMatrix();
    const start = from < 0 ? 0 : this.order.indexOf(from);
    const sub = from < 0 ? null : this.subtree(from);
    for (let k = start; k < this.order.length; k++) {
      const i = this.order[k];
      if (sub && !sub.has(i)) continue;
      const p = this.parent[i];
      this.world[i].multiplyMatrices(p >= 0 ? this.world[p] : base, this.rest[i]).multiply(this.jointMatrix(i, jm));
    }
  }

  private subtreeCache = new Map<number, Set<number>>();
  subtree(i: number): Set<number> {
    let s = this.subtreeCache.get(i);
    if (s) return s;
    s = new Set<number>();
    const walk = (k: number) => {
      s!.add(k);
      for (const c of this.children[k]) walk(c);
    };
    walk(i);
    this.subtreeCache.set(i, s);
    return s;
  }

  pointOn(i: number, local: number[] | THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return (Array.isArray(local) ? out.fromArray(local) : out.copy(local)).applyMatrix4(this.world[i]);
  }

  /** Joints between a node and the root, nearest first, skipping fingers and legs. */
  chain(i: number, max = 9): number[] {
    const out: number[] = [];
    let k = i;
    while (k >= 0 && out.length < max) {
      const n = this.nodes[k];
      if (n.joint.type !== "fixed" && !["finger", "gripper_pad", "leg", "foot", "wheel", "track"].includes(n.role)) out.push(k);
      k = this.parent[k];
    }
    return out;
  }

  /**
   * Cyclic-coordinate-descent IK: move `node`'s point `tip` to `target`, adjusting only `chain`
   * joints within their limits. Returns the remaining distance (m).
   */
  solveIK(node: number, tip: number[], target: THREE.Vector3, chain = this.chain(node), iterations = 24): number {
    const end = new THREE.Vector3();
    const pivot = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const toEnd = new THREE.Vector3();
    const toTarget = new THREE.Vector3();
    const rot = new THREE.Matrix3();
    for (let it = 0; it < iterations; it++) {
      for (const j of chain) {
        const n = this.nodes[j];
        this.pointOn(node, tip, end);
        if (end.distanceTo(target) < 0.002) return end.distanceTo(target);
        pivot.setFromMatrixPosition(this.world[j]);
        rot.setFromMatrix4(this.world[j]);
        axis.fromArray(n.joint.axis).applyMatrix3(rot).normalize();
        if (n.joint.type === "prismatic") {
          const d = toTarget.subVectors(target, end).dot(axis);
          this.q[j] = THREE.MathUtils.clamp(this.q[j] + d, n.joint.min, n.joint.max);
        } else {
          toEnd.subVectors(end, pivot).projectOnPlane(axis);
          toTarget.subVectors(target, pivot).projectOnPlane(axis);
          if (toEnd.lengthSq() < 1e-8 || toTarget.lengthSq() < 1e-8) continue;
          let ang = toEnd.angleTo(toTarget);
          if (toEnd.clone().cross(toTarget).dot(axis) < 0) ang = -ang;
          // Damped: don't swing a joint more than 25° per pass (keeps poses natural).
          ang = THREE.MathUtils.clamp(ang, -25 * DEG, 25 * DEG);
          this.q[j] = THREE.MathUtils.clamp(this.q[j] + ang / DEG, n.joint.min, n.joint.max);
        }
        // Only this joint's subtree moved (it contains the effector).
        this.fk(j);
      }
    }
    return this.pointOn(node, tip, end).distanceTo(target);
  }

  /**
   * Static gravity torque (N·m) on each revolute joint, plus held loads (kg) at a node's point. For
   * legs standing on the floor (`stance`), the joint carries everything above it instead of the
   * leg below it, shared between the legs.
   */
  gravityTorques(held: { node: number; point: THREE.Vector3; kg: number }[] = [], stance: Set<number> = new Set(), legCount = 1): Map<number, number> {
    const out = new Map<number, number>();
    const c = new THREE.Vector3();
    const pivot = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const rot = new THREE.Matrix3();
    const force = new THREE.Vector3();
    for (const j of this.moving) {
      const n = this.nodes[j];
      if (n.joint.type !== "revolute") continue;
      pivot.setFromMatrixPosition(this.world[j]);
      rot.setFromMatrix4(this.world[j]);
      axis.fromArray(n.joint.axis).applyMatrix3(rot).normalize();
      let tau = 0;
      const sub = this.subtree(j);
      const standing = stance.has(j);
      // Hanging: the joint holds its own subtree. Standing: it holds the rest of the robot.
      const carries = (k: number) => (standing ? !sub.has(k) : sub.has(k));
      for (let k = 0; k < this.nodes.length; k++) {
        if (!carries(k)) continue;
        this.pointOn(k, this.com[k], c);
        force.set(0, -this.mass[k] * G, 0);
        tau += c.sub(pivot).cross(force).dot(axis);
      }
      for (const h of held) {
        if (!carries(h.node)) continue;
        force.set(0, -h.kg * G, 0);
        tau += c.copy(h.point).sub(pivot).cross(force).dot(axis);
      }
      out.set(j, Math.abs(tau) / (standing ? Math.max(1, legCount) : 1));
    }
    return out;
  }

  // ---- crouching ---------------------------------------------------------------------------

  private legCache: Leg[] | null = null;
  /** Hip-pitch / knee / ankle-pitch triples, found by name and checked to bend in the sagittal plane. */
  legs(): Leg[] {
    if (this.legCache) return this.legCache;
    const legs: Leg[] = [];
    const isPitch = (i: number) => this.nodes[i].joint.type === "revolute" && Math.abs(this.nodes[i].joint.axis[0]) > 0.7;
    for (const k of this.moving) {
      if (!/knee/i.test(this.nodes[k].id) || !isPitch(k)) continue;
      // Walk up for the hip pitch, down for the ankle pitch.
      let hip = -1;
      for (let p = this.parent[k]; p >= 0; p = this.parent[p])
        if (isPitch(p) && /hip/i.test(this.nodes[p].id)) {
          hip = p;
          break;
        }
      const ankle = [...this.subtree(k)].find((i) => i !== k && isPitch(i) && /ankle/i.test(this.nodes[i].id)) ?? -1;
      if (hip < 0 || ankle < 0) continue;
      const pos = (i: number) => new THREE.Vector3().setFromMatrixPosition(this.world[i]);
      const thigh = pos(hip).distanceTo(pos(k));
      const shin = pos(k).distanceTo(pos(ankle));
      // Which way does a positive knee angle swing the ankle?
      const saved = this.q[k];
      const z0 = this.toBase(pos(ankle)).z;
      this.q[k] = saved + 10;
      this.fk();
      const z1 = this.toBase(pos(ankle)).z;
      this.q[k] = saved;
      this.fk();
      legs.push({ hip, knee: k, ankle, thigh, shin, sign: z1 < z0 ? 1 : -1 });
    }
    this.legCache = legs;
    return legs;
  }

  private toBase(p: THREE.Vector3): THREE.Vector3 {
    return p.applyMatrix4(this.baseMatrix().invert());
  }

  /** Deepest crouch the legs allow (m, negative), keeping 25° of knee in reserve. */
  maxCrouch(): number {
    const legs = this.legs();
    if (!legs.length) return 0;
    return -Math.min(...legs.map((l) => (l.thigh + l.shin) * (1 - Math.cos(55 * DEG))));
  }

  /**
   * Lower the body by d (≤ 0) and lean the upper body forward by `lean` radians: hips, knees and
   * ankles bend to match so the feet stay flat where they are.
   */
  setPosture(d: number, lean = 0): void {
    const legs = this.legs();
    if (!legs.length) return;
    this.base.crouch = Math.max(this.maxCrouch(), Math.min(0, d));
    this.base.lean = Math.max(0, Math.min(70 * DEG, lean));
    for (const l of legs) {
      const L = l.thigh + l.shin;
      // Equal-angle approximation: thigh tilts forward by a, shin back by a.
      const a = Math.acos(THREE.MathUtils.clamp((L + this.base.crouch) / L, -1, 1)) / DEG;
      const set = (i: number, v: number) => {
        const j = this.nodes[i].joint;
        this.q[i] = THREE.MathUtils.clamp(v, j.min, j.max);
      };
      // The pelvis pitches forward by the lean; the hip turns back by the same amount so the thigh doesn't.
      const hipAxis = Math.sign(this.nodes[l.hip].joint.axis[0]) || 1;
      set(l.hip, -a * l.sign - (this.base.lean / DEG) * hipAxis);
      set(l.knee, 2 * a * l.sign);
      set(l.ankle, -a * l.sign);
    }
    this.fk();
  }

  /** Whole-robot centre of mass (world), plus a held load. */
  centreOfMass(held: { point: THREE.Vector3; kg: number }[] = []): THREE.Vector3 {
    const c = new THREE.Vector3();
    const p = new THREE.Vector3();
    let m = 0;
    this.nodes.forEach((_, k) => {
      c.addScaledVector(this.pointOn(k, this.com[k], p), this.mass[k]);
      m += this.mass[k];
    });
    for (const h of held) {
      c.addScaledVector(h.point, h.kg);
      m += h.kg;
    }
    return c.multiplyScalar(1 / Math.max(1e-9, m));
  }

  /** Feet (or wheels / tracks) on the floor: the support area's corners in world x/z. */
  supportPoints(): THREE.Vector2[] {
    const feet = this.nodes.map((n, i) => [n, i] as const).filter(([n]) => ["foot", "wheel", "track", "base"].includes(n.role) || /foot|sole/i.test(n.id));
    const out: THREE.Vector2[] = [];
    for (const [n, i] of feet) {
      const [a, , c] = n.dims;
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ])
        out.push(((v) => new THREE.Vector2(v.x, v.z))(this.pointOn(i, [n.offset[0] + (sx * a) / 2, n.offset[1], n.offset[2] + (sz * c) / 2])));
    }
    return out;
  }

  totalMass(): number {
    return this.mass.reduce((s, m) => s + m, 0);
  }
}
