// Exports for downstream robotics tools: URDF (ROS, Isaac Sim, Gazebo, MuJoCo importers) with
// links, joints, limits, efforts, masses and inertias, and a bill of materials for the actuators,
// controller, power and sensors the design names.
import * as THREE from "three";
import { CATALOG } from "@/lib/lab/catalog/parts";
import { nodeMassKg, type Design, type NodeSpec } from "./design";

const DEG = Math.PI / 180;
const f = (v: number) => (Math.abs(v) < 1e-9 ? "0" : Number(v.toFixed(6)).toString());
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

/** Our rotations are intrinsic X-Y-Z degrees; URDF rpy is the extrinsic X-Y-Z (= intrinsic Z-Y-X). */
function rpy(r: number[]): string {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG, "XYZ"));
  const e = new THREE.Euler().setFromQuaternion(q, "ZYX");
  return `${f(e.x)} ${f(e.y)} ${f(e.z)}`;
}

function geometry(n: NodeSpec): { xml: string; extraRpy?: number[] } {
  const [a, b, c] = n.dims;
  switch (n.shape) {
    case "box":
      return { xml: `<box size="${f(a)} ${f(b)} ${f(c)}"/>` };
    case "sphere":
      if (Math.abs(a - b) < 1e-4 && Math.abs(b - c) < 1e-4) return { xml: `<sphere radius="${f(a / 2)}"/>` };
      break;
    case "cylinder":
    case "capsule":
      // URDF cylinders run along z; ours run along y.
      return { xml: `<cylinder radius="${f(Math.max(a, n.shape === "cylinder" ? c : a) / 2)}" length="${f(b + (n.shape === "capsule" ? a : 0))}"/>`, extraRpy: [90, 0, 0] };
  }
  // Everything else: its bounding box (URDF has no lathe / extrude primitives).
  const g = new THREE.Box3();
  if (n.points.length) for (const p of n.points) g.expandByPoint(n.shape === "lathe" ? new THREE.Vector3(p[0], p[1], p[0]).setX(Math.abs(p[0])) : new THREE.Vector3(p[0], p[1], p[2] ?? 0));
  const size = g.isEmpty() ? new THREE.Vector3(a, b, c) : g.getSize(new THREE.Vector3());
  if (n.shape === "lathe") size.set(size.x * 2, size.y, size.x * 2);
  if (n.shape === "extrude") size.z = c;
  return { xml: `<box size="${f(Math.max(size.x, 0.001))} ${f(Math.max(size.y, 0.001))} ${f(Math.max(size.z, 0.001))}"/>` };
}

export function toUrdf(d: Design): string {
  const name = d.title.replace(/[^\w]+/g, "_").toLowerCase() || "robot";
  const out = [`<?xml version="1.0"?>`, `<!-- ${esc(d.title)}: designed with RoboCraft (Meta Muse Spark). Lathe / extrude / tube shapes are exported as their bounding boxes. -->`, `<robot name="${name}">`];
  const roots = d.robot.nodes.filter((n) => !n.parent);
  if (roots.length > 1) out.push(`  <link name="base_link"/>`);
  for (const n of d.robot.nodes) {
    const m = Math.max(1e-4, nodeMassKg(n));
    const [a, b, c] = n.dims;
    const g = geometry(n);
    const origin = `<origin xyz="${n.offset.map(f).join(" ")}" rpy="${rpy([n.orient[0] + (g.extraRpy?.[0] ?? 0), n.orient[1], n.orient[2]])}"/>`;
    out.push(
      `  <link name="${n.id}">`,
      `    <inertial><origin xyz="${n.offset.map(f).join(" ")}"/><mass value="${f(m)}"/><inertia ixx="${f((m * (b * b + c * c)) / 12)}" ixy="0" ixz="0" iyy="${f((m * (a * a + c * c)) / 12)}" iyz="0" izz="${f((m * (a * a + b * b)) / 12)}"/></inertial>`,
      `    <visual>${origin}<geometry>${g.xml}</geometry><material name="${n.material}_${n.color.slice(1)}"><color rgba="${new THREE.Color(n.color).toArray().map(f).join(" ")} 1"/></material></visual>`,
      `    <collision>${origin}<geometry>${g.xml}</geometry></collision>`,
      `  </link>`,
    );
  }
  for (const n of d.robot.nodes) {
    const parent = n.parent || (roots.length > 1 ? "base_link" : "");
    if (!parent) continue;
    const j = n.joint;
    const type = j.type === "fixed" ? "fixed" : j.type === "prismatic" ? "prismatic" : j.max - j.min >= 359 ? "continuous" : "revolute";
    const lim = j.type === "revolute" ? [j.min * DEG, j.max * DEG] : [j.min, j.max];
    const vel = j.type === "revolute" ? j.speed * DEG : j.speed;
    out.push(
      `  <joint name="${n.id}_joint" type="${type}">`,
      `    <parent link="${parent}"/><child link="${n.id}"/>`,
      `    <origin xyz="${n.position.map(f).join(" ")}" rpy="${rpy(n.rotation)}"/>`,
      ...(type === "fixed" ? [] : [`    <axis xyz="${j.axis.map(f).join(" ")}"/>`, type === "continuous" ? `    <limit effort="${f(j.torqueNm || 1)}" velocity="${f(vel)}"/>` : `    <limit lower="${f(lim[0])}" upper="${f(lim[1])}" effort="${f(j.torqueNm || 1)}" velocity="${f(vel)}"/>`]),
      `  </joint>`,
    );
  }
  out.push(`</robot>`);
  return out.join("\n");
}

export interface BomLine {
  part: string;
  qty: number;
  where: string;
  buyable: "catalogue" | "named" | "custom";
  unitUsd?: number;
}

/** Actuators, controller, power and sensors the design names, grouped and counted. */
export function billOfMaterials(d: Design): BomLine[] {
  const lines = new Map<string, BomLine>();
  const add = (ref: string, where: string) => {
    if (!ref) return;
    const cat = CATALOG.find((c) => c.id === ref);
    const key = cat?.id ?? ref;
    const l = lines.get(key);
    if (l) {
      l.qty++;
      if (!l.where.includes(where)) l.where = `${l.where}, ${where}`.slice(0, 160);
      return;
    }
    lines.set(key, { part: cat?.name ?? ref.replace(/^need:/, ""), qty: 1, where, buyable: cat ? "catalogue" : ref.startsWith("need:") ? "named" : "custom", unitUsd: cat?.priceUsd });
  };
  for (const n of d.robot.nodes) if (n.joint.type !== "fixed") add(n.joint.actuator || "need:unspecified actuator", n.name);
  add(d.robot.controller, "main computer");
  add(d.robot.power, "power");
  for (const s of d.robot.sensors) add(s, "sensing");
  return [...lines.values()].sort((a, b) => b.qty - a.qty);
}

export function download(name: string, text: string, type = "application/xml") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}
