// The task simulation. The environment is real physics: Rapier rigid bodies for objects and
// furniture (gravity, contact, friction, stacking), hinged doors and lids, and position-based cloth
// for garments. The robot is position-controlled like a real servo robot: each step reads the
// current state of the world, solves inverse kinematics to where it must go, and moves its joints
// no faster than their actuators allow. Grasps only succeed if the fingers really reach the object
// and it's within the hand's payload. Everything is recorded so the viewport can play, pause and
// scrub it.
//
// What is NOT simulated (and is reported as such): the robot's own dynamics and balance (walking
// is a kinematic gait), motor control loops, and contact forces between fingers and objects
// (grasping attaches what's under the fingertips).
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { Cloth, type Obb, type Sphere } from "./cloth";
import type { Design, EffectorSpec, JointSpec, ObjectSpec, StepSpec } from "./design";
import { buildColliders, buildGeometry, type Collider } from "./geometry";
import { RobotModel } from "./kinematics";

const DEG = Math.PI / 180;
const DT = 1 / 60;
export const REC_FPS = 30;
export const CLOTH_FPS = 15;

export interface SimCheck {
  id: string;
  level: "pass" | "warn" | "error" | "info";
  title: string;
  detail: string;
  /** what kind of evidence backs it */
  basis: "physics" | "kinematics" | "engineering" | "ai";
}

export interface StepResult {
  label: string;
  action: StepSpec["action"];
  start: number;
  end: number;
  ok: boolean;
  note: string;
}

export interface Recording {
  fps: number;
  frames: number;
  duration: number;
  /** node indices of the robot's moving joints, and their values per frame */
  joints: number[];
  q: Float32Array;
  /** x, z, yaw, crouch, lean per frame */
  base: Float32Array;
  baseY: number;
  rigid: string[];
  /** per frame, per rigid object: x y z qx qy qz qw */
  rigidPose: Float32Array;
  cloth: { id: string; nx: number; ny: number; pos: Float32Array }[];
  clothFrames: number;
  sceneJoints: string[];
  sceneQ: Float32Array;
  steps: StepResult[];
  checks: SimCheck[];
  massKg: number;
  /** worst joint load as a fraction of its actuator's rating */
  torque: { node: string; peakNm: number; ratedNm: number }[];
}

// ------------------------------------------------------------------------------ helpers

const euler = (r: number[]) => new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG));

function jointMatrix(j: JointSpec, v: number): THREE.Matrix4 {
  if (j.type === "revolute") return new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...j.axis), v * DEG);
  if (j.type === "prismatic") return new THREE.Matrix4().makeTranslation(j.axis[0] * v, j.axis[1] * v, j.axis[2] * v);
  return new THREE.Matrix4();
}

function colliderDesc(c: Collider): RAPIER.ColliderDesc | null {
  let d: RAPIER.ColliderDesc | null;
  switch (c.type) {
    case "cuboid":
      d = RAPIER.ColliderDesc.cuboid(...c.half);
      break;
    case "ball":
      d = RAPIER.ColliderDesc.ball(c.r);
      break;
    case "capsule":
      d = RAPIER.ColliderDesc.capsule(c.halfHeight, c.r);
      break;
    case "cylinder":
      d = RAPIER.ColliderDesc.cylinder(c.halfHeight, c.r);
      break;
    case "hull":
      d = RAPIER.ColliderDesc.convexHull(c.points);
      break;
    case "trimesh":
      d = RAPIER.ColliderDesc.trimesh(c.vertices, c.indices);
      break;
  }
  if (!d) return null;
  return d.setTranslation(c.pos.x, c.pos.y, c.pos.z).setRotation({ x: c.rot.x, y: c.rot.y, z: c.rot.z, w: c.rot.w });
}

const smooth = (t: number) => t * t * (3 - 2 * t);

// ------------------------------------------------------------------------------ the scene

interface SceneObj {
  spec: ObjectSpec;
  /** joint value (doors) */
  q: number;
  world: THREE.Matrix4;
  body?: RAPIER.RigidBody;
  cloth?: Cloth;
  /** local bounding box of its shape (in the object frame) */
  box: THREE.Box3;
  held?: string;
}

class Scene {
  readonly objs = new Map<string, SceneObj>();
  readonly order: SceneObj[] = [];

  constructor(
    design: Design,
    readonly world: RAPIER.World,
  ) {
    const byId = new Map(design.scene.map((o) => [o.id, o]));
    const depth = (o: ObjectSpec): number => (o.parent && byId.get(o.parent) ? 1 + depth(byId.get(o.parent)!) : 0);
    const sorted = [...design.scene].sort((a, b) => depth(a) - depth(b));
    for (const spec of sorted) {
      const g = buildGeometry(spec);
      const box = g.boundingBox!.clone();
      g.dispose();
      const o: SceneObj = { spec, q: spec.joint.type === "fixed" ? 0 : spec.joint.rest, world: new THREE.Matrix4(), box };
      this.objs.set(spec.id, o);
      this.order.push(o);
    }
    this.updateTransforms();
    for (const o of this.order) {
      const { spec } = o;
      const pos = new THREE.Vector3();
      const rot = new THREE.Quaternion();
      o.world.decompose(pos, rot, new THREE.Vector3());
      if (spec.kind === "cloth") {
        const yaw = new THREE.Euler().setFromQuaternion(rot, "YXZ").y;
        o.cloth = new Cloth(spec.cloth.width, spec.cloth.length, pos, yaw, spec.massKg, spec.cloth.stiffness);
        continue;
      }
      const moving = this.jointed(o);
      const desc = spec.kind === "rigid" ? RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0.2).setAngularDamping(0.4) : moving ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed();
      const body = world.createRigidBody(desc.setTranslation(pos.x, pos.y, pos.z).setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }));
      const cols = buildColliders(spec, spec.kind === "rigid" ? "dynamic" : "static");
      for (const c of cols) {
        const cd = colliderDesc(c);
        if (!cd) continue;
        cd.setFriction(0.7).setRestitution(0.05);
        if (spec.kind === "rigid") cd.setMass(spec.massKg / cols.length);
        world.createCollider(cd, body);
      }
      o.body = body;
    }
  }

  /** Does this object, or anything it hangs from, have a moving joint? */
  jointed(o: SceneObj): boolean {
    for (let k: SceneObj | undefined = o; k; k = k.spec.parent ? this.objs.get(k.spec.parent) : undefined) if (k.spec.joint.type !== "fixed") return true;
    return false;
  }

  /** World transforms of static / jointed objects from their parents and joint values. */
  updateTransforms(): void {
    for (const o of this.order) {
      if (o.body && o.spec.kind === "rigid") continue;
      const local = new THREE.Matrix4().compose(new THREE.Vector3(...o.spec.position), euler(o.spec.rotation), new THREE.Vector3(1, 1, 1)).multiply(jointMatrix(o.spec.joint, o.q));
      const parent = o.spec.parent ? this.objs.get(o.spec.parent) : undefined;
      o.world.copy(parent ? parent.world.clone().multiply(local) : local);
    }
  }

  /** Push jointed objects' new poses to the physics engine. */
  syncKinematic(): void {
    for (const o of this.order) {
      if (!o.body || o.spec.kind === "rigid" || !this.jointed(o)) continue;
      const p = new THREE.Vector3();
      const r = new THREE.Quaternion();
      o.world.decompose(p, r, new THREE.Vector3());
      o.body.setNextKinematicTranslation(p);
      o.body.setNextKinematicRotation(r);
    }
  }

  /** Rigid bodies' transforms from the physics engine. */
  readRigid(): void {
    for (const o of this.order) {
      if (!o.body || o.spec.kind !== "rigid") continue;
      const t = o.body.translation();
      const r = o.body.rotation();
      o.world.compose(new THREE.Vector3(t.x, t.y, t.z), new THREE.Quaternion(r.x, r.y, r.z, r.w), new THREE.Vector3(1, 1, 1));
    }
  }

  /** Oriented boxes the cloth collides with (every non-cloth object's shape bounds); fixtures only
   * for checking where the hands may not go. */
  /** Appliances with a drum or bin inside (a washing machine) are hollow: their box isn't solid. */
  private hosts(o: SceneObj): boolean {
    return this.order.some((c) => c.spec.parent === o.spec.id && (c.spec.shape === "drum" || c.spec.shape === "bin"));
  }

  obbs(fixturesOnly = false): Obb[] {
    const out: Obb[] = [];
    for (const o of this.order) {
      if (o.cloth || (fixturesOnly && o.spec.kind === "rigid") || this.hosts(o)) continue;
      const centre = o.box.getCenter(new THREE.Vector3());
      const half = o.box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      if (o.spec.shape === "bin" || o.spec.shape === "drum") {
        // Hollow: the cloth may go inside. Use the floor of the container only.
        const floor = o.spec.shape === "bin" ? new THREE.Vector3(centre.x, o.box.min.y + 0.003, centre.z) : new THREE.Vector3(centre.x, centre.y, o.box.min.z + 0.003);
        const fh = o.spec.shape === "bin" ? new THREE.Vector3(half.x, 0.004, half.z) : new THREE.Vector3(half.x, half.y, 0.004);
        const m = o.world.clone().multiply(new THREE.Matrix4().makeTranslation(floor.x, floor.y, floor.z));
        out.push({ m, inv: m.clone().invert(), half: fh });
        // …and its walls as thin boxes.
        if (o.spec.shape === "bin") {
          const t = 0.004;
          for (const [dx, dz, hx, hz] of [
            [half.x, 0, t, half.z],
            [-half.x, 0, t, half.z],
            [0, half.z, half.x, t],
            [0, -half.z, half.x, t],
          ] as const) {
            const wm = o.world.clone().multiply(new THREE.Matrix4().makeTranslation(centre.x + dx, centre.y, centre.z + dz));
            out.push({ m: wm, inv: wm.clone().invert(), half: new THREE.Vector3(hx, half.y, hz) });
          }
        }
        continue;
      }
      const m = o.world.clone().multiply(new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z));
      out.push({ m, inv: m.clone().invert(), half });
    }
    return out;
  }

  /** Half the object's footprint along a horizontal direction (world), for standing in front of it. */
  halfDepth(id: string, dir: THREE.Vector3): number {
    const o = this.objs.get(id);
    if (!o) return 0.2;
    if (o.cloth) return 0.15;
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => new THREE.Vector3(k & 1 ? o.box.max.x : o.box.min.x, k & 2 ? o.box.max.y : o.box.min.y, k & 4 ? o.box.max.z : o.box.min.z).applyMatrix4(o.world));
    const c = corners.reduce((a, b) => a.clone().add(b), new THREE.Vector3()).multiplyScalar(1 / 8);
    return Math.max(...corners.map((p) => p.clone().sub(c).setY(0).dot(dir)));
  }

  /** A point to reach on an object: its top centre (+ offset) for solids, nearest cloth point for cloth. */
  targetPoint(id: string, from: THREE.Vector3, at: number[]): THREE.Vector3 | null {
    const o = this.objs.get(id);
    if (!o) return null;
    if (o.cloth) return o.cloth.point(o.cloth.nearest(from)).add(new THREE.Vector3(at[0], at[1] + 0.012, at[2]));
    const c = o.box.getCenter(new THREE.Vector3());
    if (o.spec.kind === "rigid") return c.applyMatrix4(o.world).add(new THREE.Vector3(...at));
    // Drums: their centre. Furniture and bins: just above the top surface (inside for bins).
    if (o.spec.shape === "drum") return c.applyMatrix4(o.world).add(new THREE.Vector3(...at));
    const top = new THREE.Vector3(c.x, o.spec.shape === "bin" ? o.box.min.y + (o.box.max.y - o.box.min.y) * 0.6 : o.box.max.y, c.z).applyMatrix4(o.world);
    return top.add(new THREE.Vector3(at[0], at[1] + (o.spec.shape === "bin" ? 0 : 0.03), at[2]));
  }
}

// ------------------------------------------------------------------------------ simulation

type Op = { label?: string; T: number; tick: (u: number, dt: number) => void; done?: () => void };

interface Grip {
  eff: EffectorSpec;
  node: number;
  obj?: string;
  /** rigid: object pose relative to the effector frame */
  offset?: THREE.Matrix4;
}

export async function simulate(design: Design, onProgress?: (f: number) => void): Promise<Recording> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.05, 50).setTranslation(0, -0.05, 0).setFriction(0.8));
  const scene = new Scene(design, world);
  const robot = new RobotModel(design);
  const effectors = design.robot.effectors.filter((e) => robot.index.has(e.node));
  const effNode = (e: EffectorSpec) => robot.index.get(e.node)!;
  const effFrame = (e: EffectorSpec) => robot.world[effNode(e)].clone().multiply(new THREE.Matrix4().makeTranslation(e.tip[0], e.tip[1], e.tip[2]));
  const effPoint = (e: EffectorSpec) => new THREE.Vector3(...e.tip).applyMatrix4(robot.world[effNode(e)]);
  const grips = new Map<string, Grip>(effectors.map((e) => [e.id, { eff: e, node: effNode(e) }]));
  // Fingers of each effector close towards their joint's max.
  const fingers = new Map(effectors.map((e) => [e.id, [...robot.subtree(effNode(e))].filter((i) => i !== effNode(e) && robot.nodes[i].joint.type !== "fixed")]));
  const checks: SimCheck[] = [];
  const steps: StepResult[] = [];
  const warn = (id: string, title: string, detail: string, basis: SimCheck["basis"] = "kinematics", level: SimCheck["level"] = "warn") => {
    if (!checks.some((c) => c.id === id)) checks.push({ id, level, title, detail, basis });
  };

  const effsFor = (s: StepSpec): EffectorSpec[] => {
    if (s.effector === "both") return effectors.slice(0, 2);
    const e = effectors.find((x) => x.id === s.effector) ?? effectors[0];
    return e ? [e] : [];
  };
  const objName = (id: string) => scene.objs.get(id)?.spec.name ?? id;

  // Legged robots crouch (hips, knees and ankles bend together) to reach low things.
  const legs = design.robot.mobility === "legs" ? robot.legs() : [];
  const legJoints = legs.flatMap((l) => [l.hip, l.knee, l.ankle]);
  // Every joint from the hips down to the ankles carries the body while standing (toes inside a
  // flat foot don't).
  const feet = robot.nodes.map((n, i) => [n, i] as const).filter(([n]) => n.role === "foot" || /foot|sole/i.test(n.id));
  const inFoot = new Set(feet.flatMap(([, i]) => [...robot.subtree(i)]));
  const stanceJoints = new Set(legs.flatMap((l) => [...robot.subtree(l.hip)].filter((i) => robot.nodes[i].joint.type === "revolute" && !inFoot.has(i))));
  // Drones: altitude is the base's height offset; propellers spin while airborne.
  const flying = design.robot.mobility === "flying";
  const props = robot.moving.filter((i) => /prop|rotor/i.test(robot.nodes[i].id) || /propeller|rotor/i.test(robot.nodes[i].name));
  /** Goals-map keys for the body's crouch height and forward lean (not joints). */
  const CROUCH = -1;
  const LEAN = -2;
  /** …and the base's horizontal position (a hovering drone lines its tool up over the target). */
  const BASEX = -3;
  const BASEZ = -4;

  /**
   * Plan joint goals that bring each effector to its target; shared torso joints stay put. Legged
   * robots also pick the shallowest crouch that gets there.
   */
  function planReach(targets: [EffectorSpec, THREE.Vector3][], stepLabel: string): Map<number, number> {
    const chains = targets.map(([e]) => robot.chain(effNode(e)));
    const shared = targets.length > 1 ? new Set(chains[0].filter((j) => chains.slice(1).every((c) => c.includes(j)))) : new Set<number>();
    const saved = Float64Array.from(robot.q);
    const savedCrouch = robot.base.crouch;
    const savedLean = robot.base.lean;
    if (flying && targets.length) {
      // Hover so the tool sits over the target, at the right height, then let the IK do the rest.
      const [e, p] = targets[0];
      const ep = effPoint(e);
      const goals = new Map<number, number>([
        [CROUCH, Math.max(0, savedCrouch + p.y - ep.y)],
        [BASEX, robot.base.x + p.x - ep.x],
        [BASEZ, robot.base.z + p.z - ep.z],
      ]);
      return goals;
    }
    const deepest = robot.maxCrouch();
    // Postures to try, most upright first: crouch depth (m) × forward lean (degrees).
    const postures: [number, number][] = legs.length
      ? [0, 15, 30, 45, 60, 75].flatMap((lean) => [...new Set([0, -0.1, -0.2, -0.3, -0.4, -0.5].map((c) => Math.max(deepest, c)))].map((c) => [c, lean] as [number, number]))
      : [[savedCrouch, savedLean / DEG]];
    let best: { score: number; q: Float64Array; crouch: number; lean: number; errs: number[] } | null = null;
    for (const [c, lean] of postures) {
      robot.q.set(saved);
      if (legs.length) robot.setPosture(c, lean * DEG);
      else robot.fk();
      // A quick solve to rank postures; the winner is refined below.
      const errs = targets.map(([e, p], k) => robot.solveIK(effNode(e), e.tip, p, chains[k].filter((j) => !shared.has(j)), 10));
      // Prefer standing tall unless bending really gets closer.
      const score = errs.reduce((a, b) => a + b, 0) - c * 0.05 + lean * 0.0008;
      if (!best || score < best.score) best = { score, q: Float64Array.from(robot.q), crouch: c, lean: lean * DEG, errs };
      if (Math.max(...errs) < 0.02) break;
    }
    // Refine the best posture with a full solve.
    robot.q.set(best!.q);
    if (legs.length) {
      robot.base.crouch = best!.crouch;
      robot.base.lean = best!.lean;
    }
    robot.fk();
    best!.errs = targets.map(([e, p], k) => robot.solveIK(effNode(e), e.tip, p, chains[k].filter((j) => !shared.has(j)), 30));
    best!.q = Float64Array.from(robot.q);
    const goals = new Map<number, number>();
    targets.forEach(([e], k) => {
      const chain = chains[k].filter((j) => !shared.has(j));
      const err = best!.errs[k];
      if (err > 0.04) warn(`reach-${stepLabel}-${e.id}`, `${e.id} can't reach: ${stepLabel}`, `Closest it gets is ${(err * 100).toFixed(0)} cm away${legs.length ? ", even crouching" : ""}. Longer arms, a torso joint or standing closer would fix it.`);
      for (const j of chain) goals.set(j, best!.q[j]);
    });
    if (legs.length) {
      for (const j of legJoints) goals.set(j, best!.q[j]);
      goals.set(CROUCH, best!.crouch);
      goals.set(LEAN, best!.lean);
    }
    robot.q.set(saved);
    robot.base.crouch = savedCrouch;
    robot.base.lean = savedLean;
    robot.fk();
    return goals;
  }

  /** Move joints to goals, no faster than each actuator's rated speed. */
  function jointsOp(goals: Map<number, number>, minT: number, label?: string): Op {
    const read = (j: number) => (j === CROUCH ? robot.base.crouch : j === LEAN ? robot.base.lean : j === BASEX ? robot.base.x : j === BASEZ ? robot.base.z : robot.q[j]);
    const start = new Map([...goals.keys()].map((j) => [j, read(j)]));
    let T = minT;
    // The body lowers at up to 0.35 m/s and leans at 60°/s; joints move at their actuators' rated speed.
    for (const [j, g] of goals) T = Math.max(T, Math.abs(g - start.get(j)!) / (j === CROUCH ? (flying ? 0.8 : 0.35) : j === LEAN ? 60 * DEG : j === BASEX || j === BASEZ ? 0.5 : robot.nodes[j].joint.speed));
    return {
      label,
      T,
      tick: (u) => {
        const s = smooth(u);
        for (const [j, g] of goals) {
          const v = start.get(j)! + (g - start.get(j)!) * s;
          if (j === CROUCH) robot.base.crouch = v;
          else if (j === LEAN) robot.base.lean = v;
          else if (j === BASEX) robot.base.x = v;
          else if (j === BASEZ) robot.base.z = v;
          else robot.q[j] = v;
        }
      },
    };
  }

  function gripOp(effs: EffectorSpec[], close: boolean, target: string, label: string): Op {
    const goals = new Map<number, number>();
    for (const e of effs) for (const f of fingers.get(e.id) ?? []) goals.set(f, close ? robot.nodes[f].joint.max : robot.nodes[f].joint.min);
    const op = jointsOp(goals, 0.5, label);
    return {
      ...op,
      done: () => {
        for (const e of effs) {
          const g = grips.get(e.id)!;
          if (!close) {
            if (g.obj) {
              const o = scene.objs.get(g.obj)!;
              o.cloth?.unpin(e.id);
              if (o.body) {
                o.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
                o.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                o.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
              }
              o.held = undefined;
            }
            g.obj = undefined;
            continue;
          }
          const tip = effPoint(e);
          const o = target ? scene.objs.get(target) : undefined;
          if (!o) {
            warn(`grasp-none-${label}`, `Nothing to grasp: ${label}`, "The step names no object.");
            continue;
          }
          if (o.cloth) {
            const frameInv = effFrame(e).invert();
            let n = o.cloth.pinNear(tip, 0.035, e.id, frameInv);
            if (!n && o.cloth.point(o.cloth.nearest(tip)).distanceTo(tip) < 0.07) n = o.cloth.pinNear(o.cloth.point(o.cloth.nearest(tip)), 0.02, e.id, frameInv);
            if (!n) {
              warn(`grasp-miss-${label}-${e.id}`, `Missed the ${objName(o.spec.id)}`, `${e.id} closed ${(o.cloth.point(o.cloth.nearest(tip)).distanceTo(tip) * 100).toFixed(0)} cm from the cloth.`, "physics", "error");
              continue;
            }
            g.obj = o.spec.id;
            o.held = e.id;
          } else if (o.body && o.spec.kind === "rigid") {
            const c = o.body.translation();
            const size = o.box.getSize(new THREE.Vector3()).length() / 2;
            const d = tip.distanceTo(new THREE.Vector3(c.x, c.y, c.z));
            if (d > size + 0.04) {
              warn(`grasp-miss-${label}-${e.id}`, `Missed the ${objName(o.spec.id)}`, `${e.id} closed ${(d * 100).toFixed(0)} cm from it.`, "physics", "error");
              continue;
            }
            if (o.spec.massKg > e.maxPayloadKg) {
              warn(`payload-${o.spec.id}`, `${objName(o.spec.id)} is too heavy for ${e.id}`, `${o.spec.massKg} kg against a ${e.maxPayloadKg} kg payload; it stays put.`, "engineering", "error");
              continue;
            }
            o.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
            g.obj = o.spec.id;
            g.offset = effFrame(e).invert().multiply(o.world.clone());
            o.held = e.id;
          } else warn(`grasp-static-${o.spec.id}`, `Can't pick up the ${objName(o.spec.id)}`, "It's fixed furniture.", "physics");
        }
      },
    };
  }

  function baseOp(s: StepSpec): Op {
    const from = { ...robot.base };
    const t = s.target ? scene.targetPoint(s.target, new THREE.Vector3(robot.base.x, 1, robot.base.z), [0, 0, 0]) : null;
    // Without a target: walk to the floor point [x, _, z] (models sometimes write [x, z, 0]).
    let tx = s.at[0],
      tz = Math.abs(s.at[2]) > 1e-6 ? s.at[2] : s.at[1];
    if (t && flying) {
      // Fly over it, cruising above everything, and hover with the tool a little above it, or land
      // on it if it's a pad.
      const pad = /pad|land|dock|helipad|station/i.test(`${s.target} ${scene.objs.get(s.target)?.spec.name ?? ""}`);
      const tool = effectors[0] ? effPoint(effectors[0]) : new THREE.Vector3(robot.base.x, robot.baseY + robot.base.crouch, robot.base.z);
      const hang = robot.baseY + robot.base.crouch - tool.y;
      const off = new THREE.Vector3(tool.x - robot.base.x, 0, tool.z - robot.base.z);
      const end = pad ? Math.max(0, t.y - 0.03) : Math.max(0.3, t.y + 0.35 + hang - robot.baseY);
      const cruise = Math.max(from.crouch, end, 1.2);
      const fx = t.x - (pad ? 0 : off.x),
        fz = t.z - (pad ? 0 : off.z);
      const dx = fx - from.x,
        dz = fz - from.z;
      const dist = Math.hypot(dx, dz);
      const T = Math.max(s.duration, dist / Math.max(0.5, design.robot.speed || 2) + (cruise - from.crouch + cruise - end) / 0.8 + 0.6);
      return {
        label: s.label,
        T,
        tick: (u) => {
          // Climb (first 25%), cruise, descend (last 25%).
          const up = smooth(Math.min(1, u / 0.25));
          const across = smooth(Math.max(0, Math.min(1, (u - 0.2) / 0.6)));
          const down = smooth(Math.max(0, (u - 0.75) / 0.25));
          robot.base.crouch = from.crouch + (cruise - from.crouch) * up + (end - cruise) * down;
          robot.base.x = from.x + dx * across;
          robot.base.z = from.z + dz * across;
        },
      };
    }
    if (t) {
      // With a target: stand just in front of it, on the side we're coming from, within reach.
      const dir = new THREE.Vector3(t.x - robot.base.x, 0, t.z - robot.base.z);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      dir.normalize();
      const stand = scene.halfDepth(s.target, dir.clone().negate()) + 0.22;
      tx = t.x - dir.x * stand;
      tz = t.z - dir.z * stand;
    }
    const dx = tx - from.x,
      dz = tz - from.z;
    const dist = Math.hypot(dx, dz);
    const face = t ? Math.atan2(t.x - tx, t.z - tz) : dist > 1e-3 ? Math.atan2(dx, dz) : from.yaw;
    let dyaw = face - from.yaw;
    while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
    while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
    if (design.robot.mobility === "fixed" && dist > 0.01) {
      warn(`fixed-${s.label}`, "A fixed robot can't move", `"${s.label}" asks it to travel ${dist.toFixed(2)} m; it stays where it is.`, "kinematics");
      return { T: 0.2, tick: () => {} };
    }
    const speed = Math.max(0.05, design.robot.speed || 0.4);
    const T = Math.max(s.duration, dist / speed + Math.abs(dyaw) / 1.5);
    const gait = design.robot.gait.map((g) => ({ j: robot.index.get(g.joint)!, ...g, rest: robot.q[robot.index.get(g.joint)!] }));
    const wheels = robot.moving.filter((i) => ["wheel", "track"].includes(robot.nodes[i].role));
    const stride = 0.45;
    return {
      label: s.label,
      T,
      tick: (u) => {
        const k = smooth(u);
        robot.base.x = from.x + dx * k;
        robot.base.z = from.z + dz * k;
        robot.base.yaw = from.yaw + dyaw * Math.min(1, u * 2.5);
        const travelled = dist * k;
        const ph = (travelled / stride) * Math.PI * 2;
        const fade = Math.min(1, Math.min(u, 1 - u) * 8);
        for (const g of gait) if (g.j !== undefined) robot.q[g.j] = THREE.MathUtils.clamp(g.rest + g.amplitude * Math.sin(ph + g.phase * Math.PI * 2) * fade, robot.nodes[g.j].joint.min, robot.nodes[g.j].joint.max);
        for (const w of wheels) {
          const r = Math.max(0.02, robot.nodes[w].dims[0] / 2);
          robot.q[w] = (((travelled / r) * 180) / Math.PI) % 360;
        }
      },
    };
  }

  function sceneJointOp(s: StepSpec, open: boolean): Op[] {
    const o = scene.objs.get(s.target);
    if (!o || o.spec.joint.type === "fixed") {
      warn(`open-${s.target}`, `Nothing to ${open ? "open" : "close"}`, `"${s.label}" names no hinged object.`, "kinematics", "info");
      return [];
    }
    const from = o.q;
    const to = open ? o.spec.joint.max : o.spec.joint.min;
    const ops: Op[] = [];
    const e = effsFor(s)[0];
    // The hand goes to the door's far edge, then pushes / pulls it round.
    const handle = () => {
      const c = o.box.getCenter(new THREE.Vector3());
      const far = new THREE.Vector3(o.box.max.x, c.y, o.box.max.z);
      return far.applyMatrix4(o.world);
    };
    if (e) ops.push(jointsOp(planReach([[e, handle()]], s.label), 0.6, s.label));
    ops.push({
      label: s.label,
      T: Math.max(s.duration, 1),
      tick: (u) => {
        o.q = from + (to - from) * smooth(u);
        scene.updateTransforms();
        if (e) {
          const ch = robot.chain(effNode(e));
          robot.solveIK(effNode(e), e.tip, handle(), ch, 4);
        }
      },
    });
    return ops;
  }

  /** Like a real task planner: if the target is out of reach and the robot can move, walk over first. */
  function approach(s: StepSpec): Op[] {
    if (design.robot.mobility === "fixed" || !s.target) return [];
    const here = new THREE.Vector3(robot.base.x, 1, robot.base.z);
    const t = scene.targetPoint(s.target, here, [0, 0, 0]);
    if (!t) return [];
    const toRobot = new THREE.Vector3(robot.base.x - t.x, 0, robot.base.z - t.z);
    const d = toRobot.length();
    if (d < 1e-6 || d <= scene.halfDepth(s.target, toRobot.normalize()) + 0.4) return [];
    return [baseOp({ ...s, action: "move_to", at: [0, 0, 0], duration: 1, label: `${s.label} (walk over first)` })];
  }

  /** Expand a task step into operations, planned when they start (closed loop on the real state). */
  function expand(s: StepSpec): (() => Op[])[] {
    const effs = effsFor(s);
    const walk = () => approach(s);
    switch (s.action) {
      case "move_to":
        return [() => [baseOp(s)]];
      case "reach":
        return [
          walk,
          () => {
            const t = effs.map((e) => [e, scene.targetPoint(s.target, effPoint(e), s.at) ?? effPoint(e).add(new THREE.Vector3(...s.at))] as [EffectorSpec, THREE.Vector3]);
            return [jointsOp(planReach(t, s.label), s.duration, s.label)];
          },
        ];
      case "grasp":
        return [
          walk,
          () => {
            // Close the last few centimetres first, then the fingers.
            const t = effs.map((e) => [e, scene.targetPoint(s.target, effPoint(e), [0, -0.005, 0]) ?? effPoint(e)] as [EffectorSpec, THREE.Vector3]);
            return [jointsOp(planReach(t, s.label), 0.3, s.label), gripOp(effs, true, s.target, s.label)];
          },
        ];
      case "lift":
        return [() => [jointsOp(planReach(effs.map((e) => [e, effPoint(e).add(new THREE.Vector3(0, s.at[1] || 0.15, 0))]), s.label), s.duration, s.label)]];
      case "place":
        return [
          walk,
          () => {
            const t = effs.map((e, k) => {
              const p = scene.targetPoint(s.target, effPoint(e), s.at) ?? effPoint(e).add(new THREE.Vector3(...s.at));
              // Two hands holding one thing keep their spacing.
              if (effs.length > 1) p.add(effPoint(e).sub(effPoint(effs[1 - k])).multiplyScalar(0.5).setY(0));
              if (s.at[1] === 0 && scene.objs.get(s.target)?.spec.shape !== "bin") p.y += 0.1;
              return [e, p] as [EffectorSpec, THREE.Vector3];
            });
            return [jointsOp(planReach(t, s.label), s.duration, s.label)];
          },
        ];
      case "release":
        return [() => [gripOp(effs, false, "", s.label)]];
      case "fold":
        return [walk, ...foldOps(s)];
      case "open":
      case "close":
        return [walk, () => sceneJointOp(s, s.action === "open")];
      case "pose":
        return [() => [jointsOp(new Map(s.joints.map((j) => [robot.index.get(j.joint)!, j.value])), s.duration, s.label)]];
      case "wait":
        return [() => [{ label: s.label, T: s.duration, tick: () => {} }]];
    }
  }

  /** Fold a cloth in half: pinch the two near corners, carry them over the far edge, lay them down. */
  function foldOps(s: StepSpec): (() => Op[])[] {
    const effs = effsFor(s);
    const o = scene.objs.get(s.target);
    if (!o?.cloth) {
      warn(`fold-${s.target}`, "Nothing to fold", `"${s.label}" names no cloth.`, "physics");
      return [];
    }
    const c = o.cloth;
    const before = c.footprint();
    let pairs: { e: EffectorSpec; from: number; to: number }[] = [];
    const lift = new THREE.Vector3(0, 0.03, 0);
    return [
      () => {
        // Near edge = the one closest to the robot.
        const me = new THREE.Vector3(robot.base.x, 0, robot.base.z);
        const corners = [0, 1, 2, 3].map((k) => c.corner(k as 0 | 1 | 2 | 3));
        const byDist = [...corners].sort((a, b) => c.point(a).setY(0).distanceTo(me) - c.point(b).setY(0).distanceTo(me));
        const near = byDist.slice(0, 2);
        // The two nearest corners share an edge; each one's partner is straight across the cloth.
        const sameRow = Math.floor(near[0] / c.nx) === Math.floor(near[1] / c.nx);
        const opposite = (k: number) => {
          const i = k % c.nx,
            j = Math.floor(k / c.nx);
          return sameRow ? (c.ny - 1 - j) * c.nx + i : j * c.nx + (c.nx - 1 - i);
        };
        if (effs.length >= 2) {
          // Left hand takes the left corner (in the robot's view).
          const right = new THREE.Vector3(Math.cos(robot.base.yaw), 0, -Math.sin(robot.base.yaw));
          const sorted = [...near].sort((a, b) => c.point(a).dot(right) - c.point(b).dot(right));
          const hands = [...effs].sort((a, b) => effPoint(a).dot(right) - effPoint(b).dot(right));
          pairs = hands.slice(0, 2).map((e, k) => ({ e, from: sorted[k], to: opposite(sorted[k]) }));
        } else if (effs[0]) {
          // One hand: the middle of the near edge to the middle of the far edge.
          const [a, b] = near.map((k) => [k % c.nx, Math.floor(k / c.nx)]);
          const mid = Math.round((a[1] + b[1]) / 2) * c.nx + Math.round((a[0] + b[0]) / 2);
          pairs = [{ e: effs[0], from: mid, to: opposite(mid) }];
        }
        return [jointsOp(planReach(pairs.map((p) => [p.e, c.point(p.from).add(lift)]), s.label), 1, `${s.label}: reach the corners`)];
      },
      () => [jointsOp(planReach(pairs.map((p) => [p.e, c.point(p.from).add(new THREE.Vector3(0, 0.008, 0))]), s.label), 0.5, `${s.label}: pinch`)],
      () => pairs.map((p) => gripOp([p.e], true, s.target, `${s.label}: pinch`)),
      () => {
        const span = pairs.length ? c.point(pairs[0].from).distanceTo(c.point(pairs[0].to)) : 0.3;
        return [jointsOp(planReach(pairs.map((p) => [p.e, c.point(p.from).lerp(c.point(p.to), 0.5).add(new THREE.Vector3(0, span * 0.45, 0))]), s.label), Math.max(1.2, s.duration / 3), `${s.label}: lift over`)];
      },
      () => [jointsOp(planReach(pairs.map((p) => [p.e, c.point(p.to).add(new THREE.Vector3(0, 0.03, 0))]), s.label), Math.max(1, s.duration / 3), `${s.label}: lay down`)],
      () => [gripOp(pairs.map((p) => p.e), false, "", `${s.label}: let go`)],
      () => [
        {
          T: 0.8,
          tick: () => {},
          done: () => {
            const after = c.footprint();
            const ratio = after / Math.max(1e-6, before);
            if (ratio < 0.7) warn(`folded-${o.spec.id}`, `Folded the ${o.spec.name}`, `Its footprint went from ${(before * 1e4).toFixed(0)} to ${(after * 1e4).toFixed(0)} cm² (${Math.round(ratio * 100)}%), measured on the cloth simulation.`, "physics", "pass");
            else warn(`folded-${o.spec.id}`, `The ${o.spec.name} didn't fold`, `Its footprint only went to ${Math.round(ratio * 100)}% of the original.`, "physics");
          },
        },
      ],
    ];
  }

  // ---- run -------------------------------------------------------------------------------
  const plan: { step: StepSpec; parts: (() => Op[])[] }[] = design.task.map((s) => ({ step: s, parts: expand(s) }));
  // Rough length, for the recording buffers: the steps plus settling time, re-grown if needed.
  const estimate = 2 + design.task.reduce((s, x) => s + Math.max(x.duration, 1.5) * (x.action === "fold" ? 3 : x.action === "move_to" ? 2 : 1.3), 0);
  const maxT = Math.min(600, estimate * 2 + 10);

  const moving = robot.moving;
  const rigidObjs = scene.order.filter((o) => o.spec.kind === "rigid" && o.body);
  const clothObjs = scene.order.filter((o) => o.cloth);
  const jointObjs = scene.order.filter((o) => o.spec.joint.type !== "fixed");
  const qRec: number[] = [];
  const baseRec: number[] = [];
  const rigidRec: number[] = [];
  const sceneRec: number[] = [];
  const clothRec: number[][] = clothObjs.map(() => []);
  let frames = 0;
  let clothFrames = 0;
  const peak = new Map<number, number>();
  const clothAwake = clothObjs.map(() => 120);


  const record = (t: number) => {
    while (frames <= t * REC_FPS) {
      for (const j of moving) qRec.push(robot.q[j]);
      baseRec.push(robot.base.x, robot.base.z, robot.base.yaw, robot.base.crouch, robot.base.lean);
      for (const o of rigidObjs) {
        const p = o.body!.translation();
        const r = o.body!.rotation();
        rigidRec.push(p.x, p.y, p.z, r.x, r.y, r.z, r.w);
      }
      for (const o of jointObjs) sceneRec.push(o.q);
      frames++;
    }
    while (clothFrames <= t * CLOTH_FPS) {
      clothObjs.forEach((o, k) => {
        for (const v of o.cloth!.pos) clothRec[k].push(v);
      });
      clothFrames++;
    }
  };

  let t = 0;
  let collisions = 0;
  let tipping = 0;
  let tipStep = "";
  let currentStep = "";
  const support = robot.supportPoints();
  const physicsStep = () => {
    // Held rigid objects follow their hands.
    for (const g of grips.values()) {
      if (!g.obj || !g.offset) continue;
      const o = scene.objs.get(g.obj)!;
      if (!o.body) continue;
      const m = effFrame(g.eff).multiply(g.offset);
      const p = new THREE.Vector3();
      const r = new THREE.Quaternion();
      m.decompose(p, r, new THREE.Vector3());
      o.body.setNextKinematicTranslation(p);
      o.body.setNextKinematicRotation(r);
    }
    scene.syncKinematic();
    world.step();
    scene.readRigid();
    // Cloth: wakes when something touches it.
    const boxes = clothObjs.length && Math.round(t / DT) % 2 === 0 ? scene.obbs() : [];
    const spheres: Sphere[] = [];
    const handFrames = new Map<string, THREE.Matrix4>();
    for (const e of effectors) {
      handFrames.set(e.id, effFrame(e));
      spheres.push({ c: effPoint(e), r: 0.018 });
    }
    for (const i of robot.order) {
      const n = robot.nodes[i];
      if (!["finger", "gripper_pad", "palm"].includes(n.role)) continue;
      spheres.push({ c: new THREE.Vector3(...n.offset).applyMatrix4(robot.world[i]), r: Math.max(0.008, Math.min(...n.dims.filter((d) => d > 0)) / 2) });
    }
    // Cloth steps at 30 Hz (every other physics step) with a doubled time step.
    const clothTick = Math.round(t / DT) % 2 === 0;
    clothObjs.forEach((o, k) => {
      if (!clothTick) return;
      const c = o.cloth!;
      const cen = c.centroid();
      const near = c.pins.size > 0 || spheres.some((s) => s.c.distanceTo(cen) < 0.6);
      if (near) clothAwake[k] = 90;
      if (clothAwake[k] <= 0) return;
      clothAwake[k]--;
      c.step(DT * 2, handFrames, boxes, spheres, 6);
    });
    // Robot hands must not pass through furniture.
    const fixtures = scene.obbs(true);
    for (const e of effectors) {
      const p = effPoint(e);
      for (const b of fixtures) {
        const l = p.clone().applyMatrix4(b.inv);
        if (Math.abs(l.x) < b.half.x - 0.01 && Math.abs(l.y) < b.half.y - 0.01 && Math.abs(l.z) < b.half.z - 0.01) collisions++;
      }
    }
    // Joint loads, every few steps.
    if (Math.round(t / DT) % 6 === 0) {
      const held = [...grips.values()].filter((g) => g.obj).map((g) => ({ node: g.node, point: effPoint(g.eff), kg: scene.objs.get(g.obj!)!.spec.massKg }));
      for (const [j, tau] of robot.gravityTorques(held, stanceJoints, legs.length)) peak.set(j, Math.max(peak.get(j) ?? 0, tau));
      // Static balance: is the centre of mass over the support area (feet / wheels)?
      if (support.length && !(flying && robot.base.crouch > 0.01)) {
        const com = robot.centreOfMass(held);
        const pts = robot.supportPoints();
        if (pts.length >= 3) {
          const xs = pts.map((p) => p.x),
            zs = pts.map((p) => p.y);
          const m = 0.02;
          const inside = com.x > Math.min(...xs) - m && com.x < Math.max(...xs) + m && com.z > Math.min(...zs) - m && com.z < Math.max(...zs) + m;
          if (!inside) {
            tipping += DT * 6;
            if (!tipStep) tipStep = currentStep;
          }
        }
      }
    }
  };

  // Let the scene settle (cloth drops onto surfaces) before the robot starts.
  robot.fk();
  for (let k = 0; k < 60; k++) {
    physicsStep();
    record(t);
    t += DT;
  }

  for (let si = 0; si < plan.length && t < maxT; si++) {
    const { step, parts } = plan[si];
    currentStep = step.label;
    const start = t;
    const before = checks.filter((c) => c.level === "error" || c.level === "warn").length;
    for (const make of parts) {
      for (const op of make()) {
        const T = Math.max(DT, op.T);
        for (let el = 0; el < T && t < maxT; el += DT) {
          op.tick(Math.min(1, (el + DT) / T), DT);
          if (flying) for (const p of props) robot.q[p] = robot.base.crouch > 0.01 ? (robot.q[p] + 2400 * DT) % 360 : robot.q[p];
          robot.fk();
          physicsStep();
          t += DT;
          record(t);
        }
        op.done?.();
      }
    }
    const added = checks.slice(before).filter((c) => c.level === "error" || c.level === "warn");
    steps.push({ label: step.label, action: step.action, start, end: t, ok: added.length === 0, note: added.map((c) => c.title).join("; ") });
    onProgress?.(Math.min(0.99, (si + 1) / plan.length));
  }
  for (let k = 0; k < 60; k++) {
    physicsStep();
    t += DT;
    record(t);
  }

  // ---- checks ------------------------------------------------------------------------------
  const torque: Recording["torque"] = [];
  for (const [j, nm] of peak) {
    const n = robot.nodes[j];
    torque.push({ node: n.id, peakNm: nm, ratedNm: n.joint.torqueNm });
    if (n.joint.torqueNm > 0 && nm > n.joint.torqueNm) warn(`torque-${n.id}`, `${n.name} is overloaded`, `Needs ${nm.toFixed(2)} N·m holding its load; ${n.joint.actuator || "the actuator"} is rated ${n.joint.torqueNm} N·m.`, "engineering", "error");
  }
  const rated = torque.filter((x) => x.ratedNm > 0);
  if (rated.length && rated.every((x) => x.peakNm <= x.ratedNm)) {
    const worst = rated.reduce((a, b) => (b.peakNm / b.ratedNm > a.peakNm / a.ratedNm ? b : a));
    checks.push({ id: "torque-ok", level: "pass", title: "Every joint holds its load", detail: `Worst case ${worst.node}: ${worst.peakNm.toFixed(2)} of ${worst.ratedNm} N·m (${Math.round((worst.peakNm / worst.ratedNm) * 100)}%), from link masses and what it carried.`, basis: "engineering" });
  }
  const unrated = robot.moving.filter((j) => robot.nodes[j].joint.torqueNm <= 0 && !["finger", "gripper_pad"].includes(robot.nodes[j].role));
  if (unrated.length) checks.push({ id: "unrated", level: "info", title: `${unrated.length} joints have no rated actuator`, detail: unrated.slice(0, 6).map((j) => robot.nodes[j].name).join(", "), basis: "engineering" });
  if (tipping > 0.2)
    checks.push({ id: "balance", level: "error", title: "It would tip over", detail: `For ${tipping.toFixed(1)} s its centre of mass is outside its feet (first during "${tipStep}"). A real robot needs a wider stance, a counterweight, or to reach less far.`, basis: "engineering" });
  else if (support.length) checks.push({ id: "balance", level: "pass", title: "Stays balanced", detail: "Its centre of mass stays over its feet / wheels throughout (static check).", basis: "engineering" });
  if (collisions > 30) warn("collide", "A hand passes through furniture", `For about ${(collisions * DT).toFixed(1)} s a hand is inside a solid object; the motion needs re-planning.`, "kinematics");
  const okSteps = steps.filter((s) => s.ok).length;
  checks.unshift({ id: "task", level: okSteps === steps.length ? "pass" : okSteps > steps.length / 2 ? "warn" : "error", title: `${okSteps} of ${steps.length} task steps succeeded`, detail: "Robot motion is planned with inverse kinematics within each joint's limits and speed; objects and cloth are physically simulated.", basis: "physics" });
  checks.push({ id: "not-simulated", level: "info", title: "Not simulated", detail: `${design.robot.mobility === "legs" ? "Walking is a kinematic gait, not balance-controlled. " : flying ? "Flight follows a planned path; aerodynamics and thrust aren't simulated. " : ""}Motor control loops and finger contact forces aren't simulated: a grasp holds what's under the fingertips.`, basis: "physics" });

  const rec: Recording = {
    fps: REC_FPS,
    frames,
    duration: t,
    joints: moving,
    q: Float32Array.from(qRec),
    base: Float32Array.from(baseRec),
    baseY: robot.baseY,
    rigid: rigidObjs.map((o) => o.spec.id),
    rigidPose: Float32Array.from(rigidRec),
    cloth: clothObjs.map((o, k) => ({ id: o.spec.id, nx: o.cloth!.nx, ny: o.cloth!.ny, pos: Float32Array.from(clothRec[k]) })),
    clothFrames,
    sceneJoints: jointObjs.map((o) => o.spec.id),
    sceneQ: Float32Array.from(sceneRec),
    steps,
    checks,
    massKg: robot.totalMass(),
    torque,
  };
  world.free();
  onProgress?.(1);
  return rec;
}
