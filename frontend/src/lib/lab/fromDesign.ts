// A realistic design (from the designer: shells, proportions, materials, joints) becomes a Control
// Lab machine without losing any realism: every body part stays exactly as designed (a "shell"
// part), and inside it goes the real hardware: an actuator on every joint (the one the design
// named, with datasheet ratings where known, else the smallest real actuator that holds the load
// measured from the design's own masses), the controller, power, servo driver or bus adapter,
// sensors, and every wire. The motion program comes from the design's gait and poses.
import * as THREE from "three";
import { nodeMassKg, type Design, type NodeSpec } from "../create/design";
import { knownActuator, pickActuator, type Actuator as LibActuator } from "../create/engineering";
import { RobotModel } from "../create/kinematics";
import { sanitizeAssembly, sanitizeHardware, type Assembly, type Connection, type HardwareOutput, type JointSpec, type PartSpec, type ProgramStep } from "./assembly";
import { CATALOG_BY_ID, type CatalogPart, type ModelKind } from "./catalog/parts";

const DEG = Math.PI / 180;
const slug = (s: string) => s.toLowerCase().replace(/^need:/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "part";

/** A catalogue entry for a real actuator that isn't in the built-in catalogue. */
function actuatorEntry(name: string, lib: LibActuator | undefined, ratedNm: number, speedDeg: number, housing: [number, number, number]): CatalogPart {
  const rated = lib?.ratedNm ?? ratedNm;
  const peak = lib?.peakNm ?? rated * 2;
  const volts = lib?.volts ?? (rated <= 2 ? 7.4 : rated <= 15 ? 24 : 48);
  const big = rated > 3;
  return {
    id: `act-${slug(lib?.name ?? name)}`,
    name: lib?.name ?? name,
    category: "servo",
    model: (big ? "servo_bus" : rated > 0.4 ? "servo_standard" : "servo_micro") as ModelKind,
    dims: housing.map((v) => Math.round(v * 1000)) as [number, number, number],
    massG: Math.round((lib?.massKg ?? Math.max(0.01, rated * 0.06)) * 1000),
    priceUsd: lib?.usd ?? Math.round(20 + rated * 15),
    spec: `${rated.toFixed(1)} N·m rated · ${peak.toFixed(1)} N·m peak · ${volts} V${lib ? ` · ${lib.source}` : " · rating from the design"}`,
    suppliers: [],
    search: lib?.name ?? name,
    source: lib?.source ?? "Named by the designer",
    actuator: { kind: "servo", ratedV: volts, stallKgcm: peak / 0.0981, speed: lib?.speed ?? speedDeg, rangeDeg: 360, stallA: Math.max(0.5, (peak * 2) / volts), idleA: big ? 0.15 : 0.02 },
  };
}

/** A catalogue entry for a named controller / battery / sensor / adapter we don't stock. */
function moduleEntry(name: string, category: CatalogPart["category"], model: ModelKind, dims: [number, number, number], usd: number): CatalogPart {
  return { id: `mod-${slug(name)}`, name: name.replace(/^need:/, ""), category, model, dims, massG: Math.round((dims[0] * dims[1] * dims[2]) / 2000), priceUsd: usd, spec: "Named by the designer", suppliers: [], search: name.replace(/^need:/, ""), source: "Named by the designer" };
}

function controllerEntry(ref: string): CatalogPart {
  const c = CATALOG_BY_ID.get(ref);
  if (c) return c;
  const n = ref.toLowerCase();
  if (/raspberry|\bpi\b|rpi/.test(n)) return CATALOG_BY_ID.get("rpi-4b") ?? moduleEntry(ref || "Raspberry Pi 4", "controller", "board_pi", [85, 18, 56], 55);
  if (/esp32/.test(n)) return CATALOG_BY_ID.get("esp32-devkitc")!;
  if (/arduino|uno/.test(n)) return CATALOG_BY_ID.get("arduino-uno")!;
  return moduleEntry(ref || "Main computer", "controller", "module_pcb", [100, 25, 80], /jetson|orin/.test(n) ? 499 : 120);
}

function sensorEntry(ref: string): CatalogPart {
  const c = CATALOG_BY_ID.get(ref);
  if (c) return c;
  const n = ref.toLowerCase();
  const model: ModelKind = /camera|depth|realsense|oak|lidar|vision/.test(n) ? "sensor_camera" : /imu|mpu|bno|gyro/.test(n) ? "sensor_imu" : /sonar|ultrasonic|hc-sr04/.test(n) ? "sensor_sonar" : /tof|vl53/.test(n) ? "sensor_tof" : "module_pcb";
  return moduleEntry(ref, "sensor", model, model === "sensor_camera" ? [90, 25, 25] : [25, 6, 20], model === "sensor_camera" ? 99 : 12);
}

function powerEntry(ref: string, volts: number, wh: number): CatalogPart {
  const c = CATALOG_BY_ID.get(ref);
  if (c) return c;
  const cells = Math.max(1, Math.round(volts / 3.7));
  const name = ref ? ref.replace(/^need:/, "") : `${cells}S Li-ion pack, ${Math.round(wh)} Wh`;
  return moduleEntry(name, "power", "battery_lipo", [Math.round(60 + wh * 0.6), Math.round(20 + cells * 3), 45], Math.round(15 + wh * 0.4));
}

/** Rotation that turns a servo (shaft up, +y) to drive about `axis`, composed with the node's own rotation. */
function servoRotation(n: NodeSpec): [number, number, number] {
  const own = new THREE.Quaternion().setFromEuler(new THREE.Euler(n.rotation[0] * DEG, n.rotation[1] * DEG, n.rotation[2] * DEG));
  const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().fromArray(n.joint.axis).normalize());
  const e = new THREE.Euler().setFromQuaternion(own.multiply(align), "XYZ");
  return [e.x / DEG, e.y / DEG, e.z / DEG];
}

export function designToAssembly(d: Design, hardware?: HardwareOutput): { assembly: Assembly; extra: CatalogPart[] } {
  const robot = new RobotModel(d);
  const loads = robot.gravityTorques();
  const extra = new Map<string, CatalogPart>();
  const register = (c: CatalogPart) => {
    if (!CATALOG_BY_ID.has(c.id)) extra.set(c.id, c);
    return c.id;
  };
  const parts: PartSpec[] = [];
  const joints: JointSpec[] = [];
  const conns: Connection[] = [];
  const shellPart = (n: NodeSpec): PartSpec => ({
    id: n.id,
    name: n.name,
    parent: n.parent,
    ref: "shell",
    kind: "shell",
    shell: { shape: n.shape, dims: n.dims as [number, number, number], bevel: n.bevel, points: n.points, offset: n.offset as [number, number, number], orient: n.orient as [number, number, number], material: n.material, color: n.color },
    size: n.dims as [number, number, number],
    material: n.material,
    color: n.color,
    position: n.position as [number, number, number],
    rotation: n.rotation as [number, number, number],
    repeat: 1,
    repeatMode: "radial",
    repeatAxis: "y",
    repeatStep: 0,
    spec: "",
    massG: 0,
    priceUsd: 0,
    suppliers: [],
    search: "",
  });
  for (const n of d.robot.nodes) parts.push(shellPart(n));

  // ---- an actuator on every joint
  const actuated: { node: NodeSpec; act: string; cat: CatalogPart }[] = [];
  robot.nodes.forEach((n, i) => {
    if (n.joint.type === "fixed") return;
    const finger = ["finger", "gripper_pad"].includes(n.role);
    const measured = (loads.get(i) ?? 0) * 1.5;
    const named = n.joint.actuator;
    const lib = named ? knownActuator(named) : undefined;
    let cat: CatalogPart;
    if (named && CATALOG_BY_ID.get(named)?.actuator) cat = CATALOG_BY_ID.get(named)!;
    else if (finger && !lib) cat = CATALOG_BY_ID.get("sg90")!;
    else if (lib || (named && n.joint.torqueNm > 0)) cat = actuatorEntry(named, lib, n.joint.torqueNm, n.joint.speed, n.dims.map((v) => Math.min(v, 0.08)) as [number, number, number]);
    else {
      const pick = pickActuator(Math.max(0.05, measured));
      cat = pick ? actuatorEntry(pick.name, pick, pick.ratedNm, pick.speed, [0.045, 0.04, 0.03]) : actuatorEntry("Custom actuator", undefined, Math.max(1, measured), n.joint.speed, [0.06, 0.06, 0.06]);
    }
    const act = `${n.id}__act`;
    parts.push({
      ...shellPart(n),
      id: act,
      name: `${n.name} actuator`,
      parent: n.parent,
      ref: register(cat),
      kind: "catalog",
      shell: undefined,
      internal: true,
      rotation: servoRotation(n),
    });
    actuated.push({ node: n, act, cat });
    // Load the joint carries: everything after it, at its centre of mass.
    const sub = robot.subtree(i);
    let mass = 0;
    const com = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (const k of sub) {
      const m = nodeMassKg(robot.nodes[k]);
      mass += m;
      com.addScaledVector(robot.pointOn(k, robot.nodes[k].offset, p), m);
    }
    if (mass > 0) com.multiplyScalar(1 / mass);
    const pivot = new THREE.Vector3().setFromMatrixPosition(robot.world[i]);
    const ax = n.joint.axis;
    const k = [0, 1, 2].reduce((b, c) => (Math.abs(ax[c]) > Math.abs(ax[b]) ? c : b), 0);
    const sign = Math.sign(ax[k]) || 1;
    const prismatic = n.joint.type === "prismatic";
    const scale = prismatic ? 1000 : 1;
    const lo = (sign > 0 ? n.joint.min : -n.joint.max) * scale;
    const hi = (sign > 0 ? n.joint.max : -n.joint.min) * scale;
    const continuous = !prismatic && n.joint.max - n.joint.min >= 359;
    joints.push({
      id: n.id,
      part: n.id,
      actuator: act,
      kind: prismatic ? "slide" : continuous ? "spin" : "rotate",
      axis: (["x", "y", "z"] as const)[k],
      min: continuous ? -(n.joint.speed / 6) : lo,
      max: continuous ? n.joint.speed / 6 : hi,
      loadG: Math.round(mass * 1000),
      leverMm: Math.round(com.distanceTo(pivot) * 1000),
    });
  });

  // ---- the electronics, inside the body (the root node)
  const root = d.robot.nodes.find((n) => !n.parent);
  const host = root?.id ?? "";
  const at = (x: number, y: number, z: number): [number, number, number] => [(root?.offset[0] ?? 0) + x, (root?.offset[1] ?? 0) + y, (root?.offset[2] ?? 0) + z];
  const internal = (id: string, name: string, cat: CatalogPart, position: [number, number, number]) => {
    parts.push({ ...shellPart(d.robot.nodes[0]), id, name, parent: host, ref: register(cat), kind: "catalog", shell: undefined, internal: true, position, rotation: [0, 0, 0] });
    return id;
  };
  const ctrl = internal("controller", "Controller", controllerEntry(d.robot.controller), at(0, 0.02, 0));
  const peakW = actuated.reduce((s, a) => s + (a.cat.actuator!.stallKgcm * 0.0981 * (a.cat.actuator!.speed * DEG)) * 0.15, 0);
  const busV = Math.max(...actuated.map((a) => a.cat.actuator!.ratedV), 5);
  const power = internal("battery", "Battery", powerEntry(d.robot.power, busV, Math.max(20, peakW * 0.4 * 1.5)), at(0, -0.02, 0));
  conns.push({ from: power, fromPin: "+", to: ctrl, toPin: "VIN", kind: "power" }, { from: power, fromPin: "-", to: ctrl, toPin: "GND", kind: "ground" });
  const hobby = actuated.filter((a) => ["servo_micro", "servo_standard"].includes(a.cat.model));
  const bus = actuated.filter((a) => !hobby.includes(a));
  if (hobby.length) {
    const pca = internal("servo_driver", "Servo driver", CATALOG_BY_ID.get("pca9685")!, at(0.03, 0.02, 0));
    conns.push({ from: ctrl, fromPin: "SDA", to: pca, toPin: "SDA", kind: "data" }, { from: power, fromPin: "+", to: pca, toPin: "V+", kind: "power" });
    hobby.forEach((a, i) => conns.push({ from: pca, fromPin: `CH${i % 16}`, to: a.act, toPin: "SIG", kind: "data" }));
  }
  if (bus.length) {
    const adapter = internal("bus_adapter", "Actuator bus adapter", moduleEntry(bus.some((b) => /cubemars|ak\d/i.test(b.cat.name)) ? "CAN bus adapter (CANable)" : /dynamixel/i.test(bus[0].cat.name) ? "ROBOTIS U2D2 bus adapter" : "Serial bus servo adapter", "driver", "module_pcb", [40, 12, 25], 30), at(-0.03, 0.02, 0));
    conns.push({ from: ctrl, fromPin: "USB", to: adapter, toPin: "USB", kind: "data" });
    bus.forEach((a) => conns.push({ from: adapter, fromPin: "BUS", to: a.act, toPin: "DATA", kind: "data" }));
  }
  for (const a of actuated) conns.push({ from: power, fromPin: "+", to: a.act, toPin: "V+", kind: "power" });
  d.robot.sensors.slice(0, 6).forEach((s, i) => {
    const id = internal(`sensor_${i + 1}`, `Sensor: ${s.replace(/^need:/, "")}`, sensorEntry(s), at(0, 0.04, 0.03 + i * 0.01));
    conns.push({ from: ctrl, fromPin: i % 2 ? "USB" : "I2C", to: id, toPin: "DATA", kind: "data" });
  });

  // ---- motion: the gait, the task's poses, else a joint check
  const jointOf = new Map(joints.map((j) => [j.id, j]));
  const sign = (id: string) => {
    const n = d.robot.nodes.find((x) => x.id === id)!;
    const k = [0, 1, 2].reduce((b, c) => (Math.abs(n.joint.axis[c]) > Math.abs(n.joint.axis[b]) ? c : b), 0);
    return Math.sign(n.joint.axis[k]) || 1;
  };
  const clampTo = (id: string, v: number) => {
    const j = jointOf.get(id)!;
    return Math.max(j.min, Math.min(j.max, v));
  };
  const program: ProgramStep[] = [];
  const gait = d.robot.gait.filter((g) => jointOf.has(g.joint));
  for (let cycle = 0; cycle < 2 && gait.length; cycle++)
    for (let k = 0; k < 4; k++)
      program.push({ label: cycle === 0 && k === 0 ? "Walk (gait cycle)" : "Walk", duration: 0.3, targets: gait.map((g) => ({ joint: g.joint, value: clampTo(g.joint, sign(g.joint) * g.amplitude * Math.sin(2 * Math.PI * (g.phase + k / 4))) })) });
  for (const s of d.task.filter((t) => t.action === "pose" && t.joints.length).slice(0, 10))
    program.push({ label: s.label, duration: Math.max(0.4, s.duration), targets: s.joints.filter((j) => jointOf.has(j.joint)).map((j) => ({ joint: j.joint, value: clampTo(j.joint, sign(j.joint) * j.value) })) });
  if (!program.length) {
    const moving = joints.filter((j) => j.kind !== "spin");
    for (let i = 0; i < moving.length; i += 6) {
      const group = moving.slice(i, i + 6);
      program.push({ label: `Exercise ${group.map((j) => d.robot.nodes.find((n) => n.id === j.id)?.name ?? j.id).slice(0, 2).join(", ")}${group.length > 2 ? "…" : ""}`, duration: 0.8, targets: group.map((j) => ({ joint: j.id, value: j.min + (j.max - j.min) * 0.65 })) });
      program.push({ label: "Back to rest", duration: 0.8, targets: group.map((j) => ({ joint: j.id, value: Math.max(j.min, Math.min(j.max, 0)) })) });
    }
  }

  const extras = [...extra.values()];
  const assembly = sanitizeAssembly({ title: d.title, parts, joints, program: program.slice(0, 40), connections: conns, signals: [], rules: [], timeScale: 1, simSeconds: 0, ...(hardware ? { hardware } : {}) } as unknown as Assembly, extras);
  if (hardware) assembly.hardware = sanitizeHardware(hardware);
  return { assembly, extra: extras };
}

