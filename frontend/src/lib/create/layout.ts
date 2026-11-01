// Setting the scene out for the robot before it runs (shared by the simulator and the 3D view, so
// both show the same layout).
import * as THREE from "three";
import type { Design, ObjectSpec } from "./design";
import { RobotModel } from "./kinematics";
import type { SimCheck } from "./sim";

/**
 * A fixed robot can only work on what its arms reach. When the design puts a loose item it has to
 * pick up beyond that (a pen out of the hand's reach on the desk), slide it along the surface it
 * stands on towards the arm, a couple of centimetres at a time, until the arm's own inverse
 * kinematics (with its joint limits) reaches it, bringing the small container it stands in along,
 * the way you'd set things out for the robot. And say so.
 */
export function bringWithinReach(design: Design): { design: Design; moved: SimCheck[] } {
  if (design.robot.mobility !== "fixed") return { design, moved: [] };
  const d: Design = structuredClone(design);
  const robot = new RobotModel(d);
  robot.fk();
  const rest = Float64Array.from(robot.q);
  const moved: SimCheck[] = [];
  const done = new Set<string>();
  for (const s of d.task) {
    if (!["reach", "grasp"].includes(s.action) || !s.target || done.has(s.target)) continue;
    const o = d.scene.find((x) => x.id === s.target);
    if (!o || o.kind !== "rigid" || o.parent) continue;
    const e = d.robot.effectors.find((x) => x.id === s.effector) ?? d.robot.effectors[0];
    const node = e && robot.index.get(e.node);
    if (node === undefined) continue;
    const chain = robot.chain(node);
    if (!chain.length) continue;
    const reaches = (p: THREE.Vector3) => {
      robot.q.set(rest);
      robot.fk();
      return robot.solveIK(node, e.tip, p, chain, 40) < 0.025;
    };
    const start = new THREE.Vector3(...o.position);
    if (reaches(start)) continue;
    const shoulder = new THREE.Vector3().setFromMatrixPosition(robot.world[chain[chain.length - 1]]);
    const toArm = new THREE.Vector3(shoulder.x - start.x, 0, shoulder.z - start.z);
    const far = toArm.length();
    toArm.normalize();
    const support = supportUnder(d.scene, o);
    let shift: THREE.Vector3 | null = null;
    for (let k = 0.02; k <= Math.min(0.5, far - 0.08); k += 0.02) {
      const p = start.clone().addScaledVector(toArm, k);
      if (support && !onTop(support, p)) break;
      if (reaches(p)) {
        shift = toArm.clone().multiplyScalar(k);
        break;
      }
    }
    robot.q.set(rest);
    robot.fk();
    if (!shift) continue;
    // Whatever it stands in (a cup, a small tray) comes along.
    const holders = d.scene.filter((x) => x.kind === "static" && x.shape === "bin" && !x.parent && Math.max(...x.dims) < 0.4 && Math.abs(x.position[0] - start.x) < x.dims[0] / 2 + 0.01 && Math.abs(x.position[2] - start.z) < x.dims[2] / 2 + 0.01);
    for (const x of [o, ...holders]) {
      x.position = [x.position[0] + shift.x, x.position[1], x.position[2] + shift.z];
      done.add(x.id);
    }
    moved.push({
      id: `moved-${o.id}`,
      level: "info",
      title: `Moved the ${o.name} ${Math.round(shift.length() * 100)} cm closer`,
      detail: `Where the design put it, ${e.id} can't reach it within its joint limits, so it's set out ${Math.round(shift.length() * 100)} cm closer${holders.length ? `, with the ${holders.map((h) => h.name).join(" and ")}` : ""}. Place it there for the real robot too.`,
      basis: "kinematics",
    });
  }
  return { design: d, moved };
}

/** The static surface an item stands on (a desk top under it), if the design has one. */
function supportUnder(scene: ObjectSpec[], o: ObjectSpec): ObjectSpec | undefined {
  const bottom = o.position[1] - o.dims[1] / 2;
  return scene
    .filter((x) => x.kind === "static" && !x.parent && x.shape === "box" && onTop(x, new THREE.Vector3(...o.position)) && x.position[1] + x.dims[1] / 2 <= bottom + 0.15)
    .sort((a, b) => b.position[1] + b.dims[1] / 2 - (a.position[1] + a.dims[1] / 2))[0];
}

function onTop(x: ObjectSpec, p: THREE.Vector3): boolean {
  return Math.abs(p.x - x.position[0]) < x.dims[0] / 2 - 0.02 && Math.abs(p.z - x.position[2]) < x.dims[2] / 2 - 0.02;
}
