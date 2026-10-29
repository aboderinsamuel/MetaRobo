// The AI-native design format. Muse Spark designs the robot's body freely (any proportions, shapes
// and materials, built from a small vocabulary of real geometric primitives), its skeleton
// (joints with axes, limits and the actuator that drives each), the environment it works in
// (furniture, appliances, rigid objects, cloth), and the task as a sequence of actions. The app
// turns that into geometry, physics bodies and a simulation; nothing about the design is chosen
// from a fixed template.
//
// Engineering stays separate from appearance: a joint names a real actuator (a catalogue id or
// "need:<part>"), masses come from shape volume × material density, and the simulation checks
// torque, reach and grasping against them.
import { z } from "zod";

const V3 = z.array(z.number()).describe("[x, y, z]");

export const SHAPES = ["box", "cylinder", "capsule", "sphere", "torus", "lathe", "extrude", "tube", "bin", "drum"] as const;
export type ShapeKind = (typeof SHAPES)[number];

export const MATERIALS = [
  "brushed_aluminium",
  "anodized_aluminium",
  "painted_metal",
  "chrome",
  "steel",
  "matte_plastic",
  "gloss_plastic",
  "soft_touch",
  "rubber",
  "silicone_skin",
  "carbon_fiber",
  "glass",
  "screen",
  "emissive",
  "fabric",
  "wood",
  "ceramic",
  "foam",
] as const;
export type MaterialKind = (typeof MATERIALS)[number];

export const ROLES = ["structure", "cover", "joint_housing", "head", "face", "eye", "torso", "arm", "palm", "finger", "gripper_pad", "leg", "foot", "wheel", "track", "sensor", "camera", "screen", "light", "cable", "base", "tool", "other"] as const;
export type Role = (typeof ROLES)[number];

const ShapeFields = {
  shape: z
    .enum(SHAPES)
    .describe(
      "box: dims [w,h,d], bevel = corner radius. cylinder: [bottom diameter, height, top diameter] (top 0 = cone). capsule: [diameter, length, diameter]. sphere: [dx,dy,dz] ellipsoid. torus: [outer diameter, tube diameter, arc degrees]. lathe: points [[radius, y], ...] revolved round y (bottles, drums, domes, vases, head shells). extrude: points [[x, y], ...] outline in the XY plane, dims[2] = depth, bevel rounds the edges (brackets, panels, fingers, plates, logos). tube: points [[x,y,z], ...] path, dims[0] = diameter (cables, hoses, handles, rails). bin: open-top box [w,h,d], bevel = wall thickness (baskets, trays, boxes). drum: open-ended cylinder lying along z [diameter, wall thickness, depth] (washing-machine drums, pipes).",
    ),
  dims: V3.describe("Metres, meaning depends on shape"),
  bevel: z.number().describe("Metres; box corner radius, extrude edge bevel, bin wall thickness; else 0"),
  points: z.array(z.array(z.number())).describe("lathe / extrude / tube points in metres; else []"),
  offset: V3.describe("Where the shape's centre sits relative to this node's origin (the joint pivot), metres"),
  orient: V3.describe("Shape rotation relative to the node, degrees X,Y,Z"),
  material: z.enum(MATERIALS),
  color: z.string().describe("#rrggbb"),
};

export const JointOut = z.object({
  type: z.enum(["fixed", "revolute", "prismatic"]),
  axis: V3.describe("Unit axis in the node's frame"),
  min: z.number().describe("degrees (revolute) or metres (prismatic)"),
  max: z.number(),
  rest: z.number().describe("Starting value"),
  actuator: z.string().describe("The real actuator: catalogue id (e.g. 'dynamixel-xl430', 'mg996r', 'nema17') or 'need:<real part name>' (e.g. 'need:CubeMars AK80-9 actuator'); '' for fixed or passive joints"),
  torqueNm: z.number().describe("Actuator's rated continuous torque (N·m) or force (N) for prismatic; 0 if none"),
  speed: z.number().describe("Actuator's max speed, deg/s (revolute) or m/s (prismatic)"),
});

export const NodeOut = z.object({
  id: z.string().describe("Unique snake_case id; left-side parts start with l_ (their mirrored copy becomes r_)"),
  name: z.string(),
  parent: z.string().describe("Parent node id, '' for the root"),
  position: V3.describe("Origin (joint pivot) relative to the parent's origin, metres"),
  rotation: V3.describe("Degrees X,Y,Z relative to the parent"),
  ...ShapeFields,
  role: z.enum(ROLES),
  joint: JointOut,
  mirror: z.boolean().describe("true: also build a mirror image of this node and its children across x = 0 (design the left arm/leg once)"),
});

export const EffectorOut = z.object({
  id: z.string().describe("e.g. left_hand, right_hand, gripper"),
  node: z.string().describe("The palm / gripper node; its finger children close when grasping"),
  kind: z.enum(["hand", "gripper", "suction", "tool"]),
  tip: V3.describe("Grasp point relative to that node, metres (between the fingertips)"),
  maxPayloadKg: z.number(),
});

export const ObjectOut = z.object({
  id: z.string(),
  name: z.string(),
  parent: z.string().describe("Object it is attached to ('' = the world), e.g. a door on a washing machine"),
  kind: z.enum(["static", "rigid", "cloth"]).describe("static: furniture, appliances, walls (don't move unless jointed); rigid: things that fall, slide and can be picked up; cloth: garments, towels, sheets (real cloth physics)"),
  position: V3.describe("World position of its centre (relative to the parent if it has one), metres; y up, floor at 0"),
  rotation: V3,
  ...ShapeFields,
  massKg: z.number().describe("rigid / cloth only"),
  cloth: z
    .object({ width: z.number(), length: z.number(), stiffness: z.number().describe("0.2 silk … 0.9 denim") })
    .describe("cloth only: flat size in metres before it's dropped; else zeros"),
  joint: JointOut.describe("Doors, lids, drawers: a hinge or slide relative to the parent; else type fixed"),
});

export const STEP_ACTIONS = ["move_to", "reach", "grasp", "lift", "place", "release", "fold", "open", "close", "pose", "wait"] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

export const StepOut = z.object({
  label: z.string().describe("What's happening, e.g. 'Pick up the red shirt'"),
  action: z
    .enum(STEP_ACTIONS)
    .describe(
      "move_to: walk/drive to stand in front of `target`, facing it (always give a target when going to an object; without one, `at` = [x, 0, z] on the floor). reach: move an effector to the target object (+ `at` offset). grasp: close the effector on the target (cloth is pinched, rigid objects are held). lift: raise what's held by `at`[1] metres. place: carry what's held to the target object (+ `at` offset, e.g. above a basket). release: open and let go. fold: fold the target cloth in half (both hands if available). open / close: swing the target's hinge to its max / min. pose: set joints directly (`joints`). wait: pause.",
    ),
  effector: z.string().describe("Effector id, 'both', or ''"),
  target: z.string().describe("Object id or ''"),
  at: V3.describe("Offset or position in metres, see action; else [0,0,0]"),
  joints: z.array(z.object({ joint: z.string().describe("node id"), value: z.number() })).describe("pose only; else []"),
  duration: z.number().describe("Seconds"),
});

export const DesignOut = z.object({
  title: z.string(),
  summary: z.string().describe("2-3 sentences: what it is, how it's built, what it does"),
  robot: z.object({
    nodes: z.array(NodeOut),
    effectors: z.array(EffectorOut),
    mobility: z.enum(["fixed", "wheels", "legs", "tracks", "flying"]).describe("flying: drones and other aircraft (takes off, cruises, hovers to work)"),
    speed: z.number().describe("Base travel speed m/s (0 if fixed)"),
    gait: z.array(z.object({ joint: z.string(), amplitude: z.number().describe("degrees"), phase: z.number().describe("0..1 of the stride") })).describe("legs only: joints that swing while walking; else []"),
    controller: z.string().describe("Catalogue id or need: for the main computer, e.g. 'need:NVIDIA Jetson Orin Nano'"),
    power: z.string().describe("Catalogue id or need: for the battery / supply"),
    sensors: z.array(z.string()).describe("Catalogue ids or need: refs for cameras, depth sensors, IMUs, force sensors"),
  }),
  scene: z.array(ObjectOut).describe("The environment for the task; [] if the robot needs none"),
  task: z.array(StepOut).describe("The task as executable steps (8-40)"),
  notes: z.array(z.string()).describe("Honest engineering caveats: what would be hard to build or isn't simulated"),
});

export type DesignAi = z.infer<typeof DesignOut>;
export type NodeSpec = z.infer<typeof NodeOut>;
export type JointSpec = z.infer<typeof JointOut>;
export type ObjectSpec = z.infer<typeof ObjectOut>;
export type StepSpec = z.infer<typeof StepOut>;
export type EffectorSpec = z.infer<typeof EffectorOut>;

/** The sanitised design the app runs. Same shape as the AI's, with mirrors expanded and values clamped. */
export type Design = DesignAi & { version: number };

// ------------------------------------------------------------------------- sanitising

const MAX_NODES = 160;
const MAX_OBJECTS = 60;
const finite = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const v3 = (v: number[] | undefined, d = 0, lo = -50, hi = 50): [number, number, number] => [0, 1, 2].map((i) => clamp(finite(v?.[i], d), lo, hi)) as [number, number, number];
const hex = (c: string, d: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : d);
const pick = <T extends string>(v: string, list: readonly T[], d: T): T => ((list as readonly string[]).includes(v) ? (v as T) : d);

function cleanShape<T extends { shape: string; dims: number[]; bevel: number; points: number[][]; offset: number[]; orient: number[]; material: string; color: string }>(s: T) {
  const shape = pick(s.shape, SHAPES, "box");
  const dims = v3(s.dims, 0.05, 0, 20).map((v, i) => (shape === "torus" && i === 2 ? clamp(v || 360, 1, 360) : Math.max(v, i === 2 && shape === "cylinder" ? 0 : 0.002))) as [number, number, number];
  const width = shape === "lathe" || shape === "extrude" ? 2 : 3;
  const points = (s.points ?? [])
    .slice(0, 64)
    .map((p) => Array.from({ length: width }, (_, i) => clamp(finite(p?.[i], 0), -20, 20)))
    .filter((p) => p.every(Number.isFinite));
  // Shapes that need points fall back to a box if they don't have enough.
  const ok = shape === "lathe" ? points.length >= 2 : shape === "extrude" ? points.length >= 3 : shape === "tube" ? points.length >= 2 : true;
  return {
    shape: ok ? shape : ("box" as const),
    dims,
    bevel: clamp(finite(s.bevel, 0), 0, Math.min(...dims.filter((d) => d > 0)) / 2 || 0.01),
    points: ok ? points : [],
    offset: v3(s.offset, 0, -10, 10),
    orient: v3(s.orient, 0, -720, 720),
    material: pick(s.material, MATERIALS, "matte_plastic"),
    color: hex(s.color, "#c8ccd4"),
  };
}

function cleanJoint(j: Partial<JointSpec> | undefined): JointSpec {
  const type = pick(j?.type ?? "fixed", ["fixed", "revolute", "prismatic"] as const, "fixed");
  const ax = v3(j?.axis, 0, -1, 1);
  const len = Math.hypot(...ax);
  const axis = (len > 1e-6 ? ax.map((v) => v / len) : [0, 0, 1]) as [number, number, number];
  const lim = type === "prismatic" ? 5 : 360;
  let min = clamp(finite(j?.min, type === "prismatic" ? 0 : -90), -lim, lim);
  let max = clamp(finite(j?.max, type === "prismatic" ? 0.1 : 90), -lim, lim);
  if (min > max) [min, max] = [max, min];
  return {
    type,
    axis,
    min,
    max,
    rest: clamp(finite(j?.rest, 0), min, max),
    actuator: (j?.actuator ?? "").slice(0, 80),
    torqueNm: clamp(finite(j?.torqueNm, 0), 0, 10000),
    speed: clamp(finite(j?.speed, type === "prismatic" ? 0.2 : 180), type === "prismatic" ? 0.005 : 5, type === "prismatic" ? 5 : 2000),
  };
}

const mirrorId = (id: string) => (id.startsWith("l_") ? `r_${id.slice(2)}` : id.startsWith("left_") ? `right_${id.slice(5)}` : `${id}_m`);
const mirrorName = (n: string) => (/\bleft\b/i.test(n) ? n.replace(/\bleft\b/i, (m) => (m[0] === "L" ? "Right" : "right")) : `${n} (mirrored)`);

/** Mirror across the x = 0 plane. Reflecting every level of the tree is the same as flipping x in
 * local positions and negating the Y and Z Euler angles (and axial vectors' y and z). */
function mirrorNode(n: NodeSpec, idMap: Map<string, string>): NodeSpec {
  return {
    ...n,
    id: idMap.get(n.id)!,
    name: mirrorName(n.name),
    parent: idMap.get(n.parent) ?? n.parent,
    position: [-n.position[0], n.position[1], n.position[2]],
    rotation: [n.rotation[0], -n.rotation[1], -n.rotation[2]],
    offset: [-n.offset[0], n.offset[1], n.offset[2]],
    orient: [n.orient[0], -n.orient[1], -n.orient[2]],
    points: n.shape === "extrude" ? n.points.map(([x, y]) => [-x, y]).reverse() : n.shape === "tube" ? n.points.map(([x, y, z]) => [-x, y, z]) : n.points,
    joint: { ...n.joint, axis: [n.joint.axis[0], -n.joint.axis[1], -n.joint.axis[2]] },
    mirror: false,
  };
}

export function sanitizeDesign(raw: DesignAi, version = 1): Design {
  // Nodes: unique ids, valid shapes and joints.
  const seen = new Set<string>();
  let nodes: NodeSpec[] = [];
  for (const n of (raw.robot?.nodes ?? []).slice(0, MAX_NODES)) {
    let id = (n.id || "part").replace(/[^\w-]/g, "_").slice(0, 40);
    while (seen.has(id)) id += "_";
    seen.add(id);
    nodes.push({
      id,
      name: (n.name || id).slice(0, 60),
      parent: (n.parent ?? "").trim(),
      position: v3(n.position, 0, -20, 20),
      rotation: v3(n.rotation, 0, -720, 720),
      ...cleanShape(n),
      role: pick(n.role, ROLES, "structure"),
      joint: cleanJoint(n.joint),
      mirror: !!n.mirror,
    });
  }
  // Repair the tree: unknown parents and cycles become roots.
  const ids = new Set(nodes.map((n) => n.id));
  nodes = nodes.map((n) => (n.parent && (!ids.has(n.parent) || n.parent === n.id) ? { ...n, parent: "" } : n));
  const parentOf = new Map(nodes.map((n) => [n.id, n.parent]));
  for (const n of nodes) {
    let p = n.parent;
    const path = new Set([n.id]);
    while (p) {
      if (path.has(p)) {
        n.parent = "";
        parentOf.set(n.id, "");
        break;
      }
      path.add(p);
      p = parentOf.get(p) ?? "";
    }
  }
  // Joint housings drawn as cylinders turn to line up with their joint's axis (cylinders run along
  // y; a pitch joint's housing should run along x), unless the design oriented them itself.
  for (const n of nodes) {
    if (n.shape !== "cylinder" || n.joint.type !== "revolute" || n.orient.some((v) => v !== 0)) continue;
    if (!(n.role === "joint_housing" || /joint|pitch|roll|yaw|knee|elbow|hip|shoulder|wrist|ankle|neck/i.test(n.id))) continue;
    const [ax, , az] = n.joint.axis;
    if (Math.abs(ax) > 0.7) n.orient = [0, 0, 90];
    else if (Math.abs(az) > 0.7) n.orient = [90, 0, 0];
  }

  // Joint conventions a model often gets backwards: elbows flex forwards and knees backwards. For a
  // limb hanging down its parent's -y with a pitch (x) axis, positive rotation about +x swings it
  // backwards, so the axis sign must match the side the range is on.
  for (const n of nodes) {
    const j = n.joint;
    if (j.type !== "revolute" || Math.abs(j.axis[0]) < 0.7) continue;
    const forward = /elbow/i.test(n.id) ? true : /knee/i.test(n.id) ? false : null;
    if (forward === null) continue;
    const positiveSide = j.max > -j.min;
    // With axis +x, a positive angle bends backwards; flip the axis if that's the wrong way.
    const bendsBackward = (j.axis[0] > 0) === positiveSide;
    if (bendsBackward === forward) n.joint = { ...j, axis: [-j.axis[0], -j.axis[1], -j.axis[2]] };
  }

  // Mirrors: copy each mirrored node with its whole subtree.
  const kids = new Map<string, NodeSpec[]>();
  for (const n of nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const extra: NodeSpec[] = [];
  for (const m of nodes.filter((n) => n.mirror)) {
    const sub: NodeSpec[] = [];
    const walk = (n: NodeSpec) => {
      sub.push(n);
      for (const c of kids.get(n.id) ?? []) walk(c);
    };
    walk(m);
    const idMap = new Map(sub.map((n) => [n.id, mirrorId(n.id)]));
    if ([...idMap.values()].some((id) => ids.has(id))) continue; // the AI already built the other side
    for (const n of sub) {
      const copy = mirrorNode(n, idMap);
      // Only the mirrored root keeps the parent outside the subtree; children are re-parented.
      extra.push(n === m ? { ...copy, parent: m.parent } : copy);
      ids.add(copy.id);
    }
  }
  nodes = [...nodes.map((n) => ({ ...n, mirror: false })), ...extra].slice(0, MAX_NODES * 2);
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Effectors: mirrored effectors are added for mirrored palms.
  const effectors: EffectorSpec[] = [];
  for (const e of raw.robot?.effectors ?? []) {
    if (!nodeIds.has(e.node)) continue;
    const eff = { id: (e.id || e.node).slice(0, 30), node: e.node, kind: pick(e.kind, ["hand", "gripper", "suction", "tool"] as const, "gripper"), tip: v3(e.tip, 0, -1, 1), maxPayloadKg: clamp(finite(e.maxPayloadKg, 1), 0, 500) };
    effectors.push(eff);
    const twin = mirrorId(e.node);
    if (nodeIds.has(twin) && !(raw.robot.effectors ?? []).some((x) => x.node === twin) && extra.some((n) => n.id === twin)) {
      const swapped = eff.id.replace(/left/i, (m) => (m[0] === "L" ? "Right" : "right")).replace(/^l_/, "r_");
      effectors.push({ ...eff, id: swapped === eff.id ? `${eff.id}_m` : swapped, node: twin, tip: [-eff.tip[0], eff.tip[1], eff.tip[2]] });
    }
  }

  // Scene objects.
  const oseen = new Set<string>();
  const scene: ObjectSpec[] = [];
  for (const o of (raw.scene ?? []).slice(0, MAX_OBJECTS)) {
    let id = (o.id || "object").replace(/[^\w-]/g, "_").slice(0, 40);
    while (oseen.has(id) || nodeIds.has(id)) id += "_";
    oseen.add(id);
    const kind = pick(o.kind, ["static", "rigid", "cloth"] as const, "static");
    scene.push({
      id,
      name: (o.name || id).slice(0, 60),
      parent: (o.parent ?? "").trim(),
      kind,
      position: v3(o.position, 0, -30, 30),
      rotation: v3(o.rotation, 0, -720, 720),
      ...cleanShape(o),
      massKg: clamp(finite(o.massKg, kind === "cloth" ? 0.2 : 1), 0.01, 500),
      cloth: kind === "cloth" ? { width: clamp(finite(o.cloth?.width, 0.5), 0.1, 3), length: clamp(finite(o.cloth?.length, 0.6), 0.1, 3), stiffness: clamp(finite(o.cloth?.stiffness, 0.5), 0.05, 1) } : { width: 0, length: 0, stiffness: 0 },
      joint: cleanJoint(o.joint),
    });
  }
  const objIds = new Set(scene.map((o) => o.id));
  for (const o of scene) if (o.parent && (!objIds.has(o.parent) || o.parent === o.id)) o.parent = "";

  const effIds = new Set(effectors.map((e) => e.id));
  const task: StepSpec[] = (raw.task ?? []).slice(0, 80).map((s) => ({
    label: (s.label || s.action).slice(0, 80),
    action: pick(s.action, STEP_ACTIONS, "wait"),
    effector: s.effector === "both" || effIds.has(s.effector) ? s.effector : (effectors[0]?.id ?? ""),
    target: objIds.has(s.target) ? s.target : "",
    at: v3(s.at, 0, -30, 30),
    joints: (s.joints ?? []).filter((j) => nodeIds.has(j.joint)).map((j) => ({ joint: j.joint, value: finite(j.value, 0) })),
    duration: clamp(finite(s.duration, 1.5), 0.2, 30),
  }));

  const mobility = pick(raw.robot?.mobility ?? "fixed", ["fixed", "wheels", "legs", "tracks", "flying"] as const, "fixed");
  return {
    version,
    title: (raw.title || "Robot").slice(0, 80),
    summary: (raw.summary || "").slice(0, 600),
    robot: {
      nodes,
      effectors,
      mobility,
      speed: mobility === "fixed" ? 0 : clamp(finite(raw.robot?.speed, 0.4), 0.02, 5),
      gait: (raw.robot?.gait ?? []).filter((g) => nodeIds.has(g.joint)).map((g) => ({ joint: g.joint, amplitude: clamp(finite(g.amplitude, 20), -90, 90), phase: finite(g.phase, 0) % 1 })),
      controller: (raw.robot?.controller ?? "").slice(0, 80),
      power: (raw.robot?.power ?? "").slice(0, 80),
      sensors: (raw.robot?.sensors ?? []).slice(0, 12).map((s) => s.slice(0, 80)),
    },
    scene,
    task,
    notes: (raw.notes ?? []).slice(0, 12).map((n) => n.slice(0, 300)),
  };
}

// ------------------------------------------------------------------------- engineering numbers

/** kg/m³ for each material: masses come from the shape's real volume. */
export const DENSITY: Record<MaterialKind, number> = {
  brushed_aluminium: 2700,
  anodized_aluminium: 2700,
  painted_metal: 7850,
  chrome: 7850,
  steel: 7850,
  matte_plastic: 1050,
  gloss_plastic: 1050,
  soft_touch: 1100,
  rubber: 1200,
  silicone_skin: 1100,
  carbon_fiber: 1600,
  glass: 2500,
  screen: 2500,
  emissive: 1100,
  fabric: 300,
  wood: 650,
  ceramic: 2400,
  foam: 60,
};

/** Shells: bodies thicker than this are treated as hollow (a real cover or casting is). */
const SHELL = 0.003;

/** Approximate solid volume of a shape, m³ (hollow shells for big covers). */
export function shapeVolume(s: Pick<NodeSpec, "shape" | "dims" | "bevel" | "points" | "role" | "material">): number {
  const [a, b, c] = s.dims;
  let v: number;
  let area: number;
  switch (s.shape) {
    case "box":
      v = a * b * c;
      area = 2 * (a * b + b * c + a * c);
      break;
    case "cylinder": {
      const r1 = a / 2,
        r2 = c / 2;
      v = (Math.PI * b * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;
      area = Math.PI * (r1 + r2) * b + Math.PI * (r1 * r1 + r2 * r2);
      break;
    }
    case "capsule":
      v = Math.PI * (a / 2) ** 2 * b + (4 / 3) * Math.PI * (a / 2) ** 3;
      area = Math.PI * a * (b + a);
      break;
    case "sphere":
      v = (4 / 3) * Math.PI * (a / 2) * (b / 2) * (c / 2);
      area = 4 * Math.PI * ((a + b + c) / 6) ** 2;
      break;
    case "torus":
      v = Math.PI * (b / 2) ** 2 * Math.PI * (a - b) * (c / 360);
      area = v * 4 / Math.max(1e-3, b);
      break;
    case "lathe": {
      v = 0;
      area = 0;
      for (let i = 1; i < s.points.length; i++) {
        const [r0, y0] = s.points[i - 1];
        const [r1, y1] = s.points[i];
        const h = Math.abs(y1 - y0);
        v += (Math.PI * h * (r0 * r0 + r0 * r1 + r1 * r1)) / 3;
        area += Math.PI * (Math.abs(r0) + Math.abs(r1)) * Math.hypot(h, r1 - r0);
      }
      break;
    }
    case "extrude": {
      let ar = 0;
      let per = 0;
      for (let i = 0; i < s.points.length; i++) {
        const [x0, y0] = s.points[i];
        const [x1, y1] = s.points[(i + 1) % s.points.length];
        ar += x0 * y1 - x1 * y0;
        per += Math.hypot(x1 - x0, y1 - y0);
      }
      v = (Math.abs(ar) / 2) * c;
      area = Math.abs(ar) + per * c;
      break;
    }
    case "tube": {
      let len = 0;
      for (let i = 1; i < s.points.length; i++) len += Math.hypot(s.points[i][0] - s.points[i - 1][0], s.points[i][1] - s.points[i - 1][1], s.points[i][2] - s.points[i - 1][2]);
      v = Math.PI * (a / 2) ** 2 * len;
      area = Math.PI * a * len;
      break;
    }
    case "bin":
      v = a * c * s.bevel + 2 * (a + c) * b * s.bevel;
      area = 0;
      return v;
    case "drum":
      v = Math.PI * a * b * c;
      return v;
  }
  // Large covers and shells are hollow: mass = surface × wall thickness. Lathe / extrude sizes come
  // from their outlines, not dims.
  let ext = s.dims;
  if (s.shape === "lathe" && s.points.length) {
    const r = Math.max(...s.points.map((p) => Math.abs(p[0])));
    const ys = s.points.map((p) => p[1]);
    ext = [2 * r, Math.max(...ys) - Math.min(...ys), 2 * r];
  } else if (s.shape === "extrude" && s.points.length) {
    const xs = s.points.map((p) => p[0]);
    const ys = s.points.map((p) => p[1]);
    ext = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), s.dims[2]];
  }
  const min = Math.min(...ext.filter((d) => d > 0));
  if (min > 0.03 && !["foam", "fabric", "wood"].includes(s.material) && s.shape !== "tube") return Math.min(v, area * SHELL);
  return v;
}

export function nodeMassKg(n: Pick<NodeSpec, "shape" | "dims" | "bevel" | "points" | "role" | "material">): number {
  return shapeVolume(n) * DENSITY[n.material];
}
