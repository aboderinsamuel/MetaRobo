// Hand-written designs in exactly the format Muse Spark returns, for tests and the dev preview.
import type { DesignAi, NodeSpec, ObjectSpec, StepSpec } from "@/lib/create/design";

const J0 = { type: "fixed" as const, axis: [0, 0, 1], min: 0, max: 0, rest: 0, actuator: "", torqueNm: 0, speed: 90 };
const node = (p: Partial<NodeSpec> & Pick<NodeSpec, "id" | "shape" | "dims">): NodeSpec => ({
  name: p.id,
  parent: "",
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  bevel: 0,
  points: [],
  offset: [0, 0, 0],
  orient: [0, 0, 0],
  material: "anodized_aluminium",
  color: "#d9dde3",
  role: "structure",
  joint: J0,
  mirror: false,
  ...p,
});
const obj = (p: Partial<ObjectSpec> & Pick<ObjectSpec, "id" | "kind" | "shape" | "dims" | "position">): ObjectSpec => ({
  name: p.id,
  parent: "",
  rotation: [0, 0, 0],
  bevel: 0,
  points: [],
  offset: [0, 0, 0],
  orient: [0, 0, 0],
  material: "matte_plastic",
  color: "#8899aa",
  massKg: 0.2,
  cloth: { width: 0, length: 0, stiffness: 0 },
  joint: J0,
  ...p,
});
const step = (p: Partial<StepSpec> & Pick<StepSpec, "action" | "label">): StepSpec => ({ effector: "gripper", target: "", at: [0, 0, 0], joints: [], duration: 1.5, ...p });
const rev = (axis: number[], min: number, max: number, rest: number, torqueNm: number, actuator = "dynamixel-xl430") => ({ type: "revolute" as const, axis, min, max, rest, actuator, torqueNm, speed: 120 });

/** A 4-joint arm with a two-finger gripper, a box to put in a bin, and a towel to fold. */
export const ARM_FIXTURE: DesignAi = {
  title: "Desk arm (test fixture)",
  summary: "A four-joint arm with a parallel gripper.",
  robot: {
    nodes: [
      node({ id: "base", shape: "cylinder", dims: [0.16, 0.06, 0.16], offset: [0, 0.03, 0], material: "painted_metal", color: "#2b2f36", role: "base" }),
      node({ id: "turret", parent: "base", position: [0, 0.06, 0], shape: "cylinder", dims: [0.12, 0.05, 0.12], offset: [0, 0.025, 0], joint: rev([0, 1, 0], -180, 180, 0, 8) }),
      node({ id: "upper", parent: "turret", position: [0, 0.07, 0], shape: "box", dims: [0.05, 0.3, 0.05], bevel: 0.01, offset: [0, 0.15, 0], role: "arm", joint: rev([1, 0, 0], -110, 110, 20, 12) }),
      node({ id: "fore", parent: "upper", position: [0, 0.3, 0], shape: "box", dims: [0.04, 0.28, 0.04], bevel: 0.008, offset: [0, 0.14, 0], role: "arm", joint: rev([1, 0, 0], -150, 150, 70, 6) }),
      node({ id: "wrist", parent: "fore", position: [0, 0.28, 0], shape: "box", dims: [0.05, 0.05, 0.04], offset: [0, 0.025, 0], role: "palm", material: "matte_plastic", color: "#1d2026", joint: rev([1, 0, 0], -120, 120, 60, 2, "mg996r") }),
      node({ id: "l_finger", parent: "wrist", position: [0.018, 0.05, 0], shape: "box", dims: [0.01, 0.045, 0.02], offset: [0, 0.022, 0], role: "finger", material: "rubber", color: "#16181c", joint: { ...rev([0, 0, 1], 0, 18, 0, 0.5, "sg90") }, mirror: true }),
    ],
    effectors: [{ id: "gripper", node: "wrist", kind: "gripper", tip: [0, 0.085, 0], maxPayloadKg: 1 }],
    mobility: "fixed",
    speed: 0,
    gait: [],
    controller: "esp32-devkitc",
    power: "psu-12v-5a",
    sensors: [],
  },
  scene: [
    obj({ id: "box", name: "Box", kind: "rigid", shape: "box", dims: [0.05, 0.05, 0.05], position: [0, 0.025, 0.42], color: "#e85d4a", massKg: 0.15 }),
    obj({ id: "bin", name: "Bin", kind: "static", shape: "bin", dims: [0.24, 0.12, 0.24], bevel: 0.005, position: [0.38, 0.06, 0.2], color: "#3a86ff" }),
    obj({ id: "towel", name: "Towel", kind: "cloth", shape: "box", dims: [0.36, 0.002, 0.28], position: [-0.32, 0.02, 0.36], material: "fabric", color: "#f2c94c", massKg: 0.12, cloth: { width: 0.36, length: 0.28, stiffness: 0.4 } }),
  ],
  task: [
    step({ label: "Reach the box", action: "reach", target: "box", at: [0, 0.02, 0] }),
    step({ label: "Grasp the box", action: "grasp", target: "box" }),
    step({ label: "Lift it", action: "lift", at: [0, 0.18, 0] }),
    step({ label: "Carry it over the bin", action: "place", target: "bin", at: [0, 0.12, 0] }),
    step({ label: "Drop it in", action: "release" }),
    step({ label: "Fold the towel", action: "fold", target: "towel", duration: 4 }),
  ],
  notes: [],
  hardware: { kind: "none", board: "", driver: "", motor: "", battery: "", sensor: "", prop: "", geom: [] },
};
