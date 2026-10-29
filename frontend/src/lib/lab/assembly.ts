// AI-designed machines, constrained to real hardware.
//
// Muse Spark composes every machine from RoboCraft's catalogue of off-the-shelf parts
// (lib/lab/catalog/parts.ts) plus fabricated parts a student can get made (laser-cut plates, 3D
// prints, cut extrusion and rod). It cannot invent free-form shapes: dimensions, mass, price and
// suppliers of catalogue parts always come from the catalogue, never from the model.
//
// Motion is described as joints, each driven by a real actuator in the design, plus a motion
// program; lib/lab/actuation.ts simulates it with the actuators' real ratings.
//
// Conventions (also given to the model): metres, y up, the machine stands on y = 0, rotations in
// degrees X then Y then Z, every part positioned relative to its parent ("" = the world).
import { z } from "zod";
import { CATALOG, CATALOG_BY_ID, FAB_KINDS, FAB_MATERIALS, catalogForPrompt, fabricate, type CatalogPart, type FabKind, type ModelKind } from "./catalog/parts";
import type { SupplierKey } from "./catalog/suppliers";

export const JOINT_KINDS = ["rotate", "spin", "slide", "lift", "articulate"] as const;
export type JointKind = (typeof JOINT_KINDS)[number];

export const ARM_EFFECTORS = ["gripper", "hand", "suction"] as const;
export type ArmEffector = (typeof ARM_EFFECTORS)[number];

const V3 = z.array(z.number()).describe("[x, y, z]");

// ---------------------------------------------------------------- what Muse Spark returns

export const PartOut = z.object({
  id: z.string().describe("Short unique id, e.g. base_plate, shoulder_servo"),
  name: z.string().describe("What it does in this machine, e.g. 'Shoulder servo'"),
  parent: z.string().describe("id of the part it is mounted on, or '' for the world"),
  ref: z
    .string()
    .describe("A catalogue id (e.g. 'mg996r'), or 'fab:plate' / 'fab:printed' / 'fab:extrusion' / 'fab:rod' for a fabricated part, or 'need:<exact part name>' for a real part that isn't in the catalogue"),
  size: V3.describe("Fabricated parts only, metres: plate [w, thickness, d]; printed [x, y, z]; extrusion [0.02, length, 0.02]; rod [diameter, length, diameter]. Catalogue parts: [0, 0, 0]"),
  material: z.string().describe("Fabricated parts only: plate acrylic|plywood|aluminium|carbon_fiber; printed pla|petg|tpu; extrusion aluminium; rod steel|aluminium|carbon_fiber. Else ''"),
  color: z.string().describe("#rrggbb for fabricated parts and accents, else ''"),
  position: V3.describe("Metres, relative to the parent"),
  rotation: V3.describe("Degrees about X, Y, Z, relative to the parent"),
  repeat: z.number().describe("Copies (1 = one). E.g. 4 standoffs, 2 wheels"),
  repeatMode: z.enum(["radial", "linear"]),
  repeatAxis: z.enum(["x", "y", "z"]),
  repeatStep: z.number().describe("radial: degrees between copies (0 = evenly over 360); linear: metres between copies"),
});

export const JointOut = z.object({
  id: z.string().describe("Short id, e.g. shoulder, left_wheel"),
  part: z.string().describe("id of the part that moves; its children move with it. Its origin is the pivot"),
  actuator: z.string().describe("id of the catalogue servo, motor, stepper or arm kit PART in this design that drives it"),
  kind: z.enum(JOINT_KINDS).describe("rotate: to an angle (deg); spin: continuous (rpm); slide / lift: linear (mm); articulate: an arm kit's whole motion (stroke 0..1)"),
  axis: z.enum(["x", "y", "z"]).describe("In the moving part's frame"),
  min: z.number().describe("Lower limit: deg, rpm, mm or stroke"),
  max: z.number().describe("Upper limit"),
  loadG: z.number().describe("Mass the joint moves or holds, grams (including the parts after it)"),
  leverMm: z.number().describe("Distance from the pivot to that mass's centre, mm (for torque). 0 for spin with no load arm"),
});

export const StepOut = z.object({
  label: z.string().describe("What happens, e.g. 'Raise arm', 'Wave left'"),
  duration: z.number().describe("Seconds allowed for this step"),
  targets: z.array(z.object({ joint: z.string(), value: z.number() })).describe("Where each joint should go (joints not listed hold)"),
});

export const AssemblyOut = z.object({
  title: z.string().describe("Name of the machine"),
  parts: z.array(PartOut),
  joints: z.array(JointOut),
  program: z.array(StepOut).describe("A realistic motion routine for the machine's task, 3-12 steps"),
});

export type AiAssembly = z.infer<typeof AssemblyOut>;
export type JointSpec = z.infer<typeof JointOut>;
export type ProgramStep = z.infer<typeof StepOut>;

// ---------------------------------------------------------------- the resolved design

export interface PartSpec {
  id: string;
  name: string;
  parent: string;
  ref: string;
  kind: "catalog" | "fab" | "need";
  /** catalogue parts */
  catalogId?: string;
  model?: ModelKind;
  /** fabricated parts */
  fab?: FabKind;
  /** metres: catalogue dims, or the fabricated size */
  size: [number, number, number];
  material: string;
  color: string;
  position: [number, number, number];
  rotation: [number, number, number];
  repeat: number;
  repeatMode: "radial" | "linear";
  repeatAxis: "x" | "y" | "z";
  repeatStep: number;
  spec: string;
  massG: number;
  priceUsd: number;
  suppliers: SupplierKey[];
  search: string;
  source?: string;
  /** Parts from uploads or web search carry their own catalogue entry. */
  catalog?: CatalogPart;
}

export interface Assembly {
  title: string;
  parts: PartSpec[];
  joints: JointSpec[];
  program: ProgramStep[];
  /** Parts the design needs that aren't in the catalogue yet ("need:" refs not yet resolved). */
  unresolved?: string[];
}

export const MAX_PARTS = 80;
const MAX_REPEAT = 36;
const MAX_INSTANCES = 400;

const finite = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const vec = (v: number[] | undefined, d: number, lo: number, hi: number): [number, number, number] => [0, 1, 2].map((i) => clamp(finite(v?.[i], d), lo, hi)) as [number, number, number];

/** The catalogue entry behind a part: built-in, uploaded or found by web search. */
export function catalogOf(p: Pick<PartSpec, "catalogId" | "catalog">): CatalogPart | undefined {
  return p.catalog ?? (p.catalogId ? CATALOG_BY_ID.get(p.catalogId) : undefined);
}

/** Arm kits: [reach m, base Ø m, joints] for the arm renderer, from the catalogue. */
export function armSpec(p: Pick<PartSpec, "catalogId" | "catalog">): { reach: number; baseD: number; dof: number; effector: ArmEffector } {
  const c = catalogOf(p);
  return {
    reach: (c?.kit?.reachMm ?? 300) / 1000,
    baseD: (c?.dims[0] ?? 120) / 1000,
    dof: c?.kit?.dof ?? 6,
    effector: c?.kit?.effector ?? "gripper",
  };
}

/** Fills a catalogue part's real size, mass, price and suppliers. */
function fromCatalog(c: CatalogPart): Pick<PartSpec, "kind" | "catalogId" | "model" | "size" | "spec" | "massG" | "priceUsd" | "suppliers" | "search" | "source" | "catalog"> {
  return {
    // Built-in parts are looked up by id; others travel with the design.
    catalog: CATALOG_BY_ID.get(c.id) === c ? undefined : c,
    kind: "catalog",
    catalogId: c.id,
    model: c.model,
    size: c.dims.map((v) => v / 1000) as [number, number, number],
    spec: c.spec,
    massG: c.massG,
    priceUsd: c.priceUsd,
    suppliers: c.suppliers,
    search: c.search,
    source: c.source,
  };
}

/**
 * Resolves and cleans an AI design so it always renders and only uses real parts: catalogue refs get
 * their real data, fabricated parts are clamped to what the process can make, anything else is listed
 * as unresolved. Parents and joints are repaired; throws only when nothing usable is left.
 * `extra` adds parts found by web search or uploaded by the user.
 */
export function sanitizeAssembly(raw: AiAssembly | Assembly, extra: CatalogPart[] = []): Assembly {
  const byId = new Map<string, CatalogPart>(CATALOG_BY_ID);
  for (const e of extra) byId.set(e.id, e);
  const seen = new Set<string>();
  let instances = 0;
  const parts: PartSpec[] = [];
  const unresolved = new Set<string>();

  for (const p of (raw.parts as (z.infer<typeof PartOut> & Partial<PartSpec>)[]).slice(0, MAX_PARTS)) {
    let id = (p.id || "part").trim().slice(0, 40);
    while (seen.has(id)) id += "_";
    seen.add(id);
    const repeat = clamp(Math.round(finite(p.repeat, 1)), 1, MAX_REPEAT);
    if (instances + repeat > MAX_INSTANCES) break;
    instances += repeat;
    const base = {
      id,
      name: (p.name || id).slice(0, 60),
      parent: (p.parent ?? "").trim(),
      ref: (p.ref ?? "").trim(),
      color: /^#[0-9a-f]{6}$/i.test(p.color ?? "") ? p.color! : "",
      position: vec(p.position, 0, -30, 30),
      rotation: vec(p.rotation, 0, -720, 720),
      repeat,
      repeatMode: p.repeatMode === "linear" ? ("linear" as const) : ("radial" as const),
      repeatAxis: p.repeatAxis === "x" || p.repeatAxis === "z" ? p.repeatAxis : ("y" as const),
      repeatStep: finite(p.repeatStep, 0),
      material: "",
    };
    const ref = base.ref.toLowerCase();
    const cat = byId.get(ref) ?? byId.get(base.ref);
    if (cat) {
      parts.push({ ...base, ref: cat.id, ...fromCatalog(cat) });
    } else if (ref.startsWith("fab:") && (FAB_KINDS as readonly string[]).includes(ref.slice(4))) {
      const kind = ref.slice(4) as FabKind;
      const f = fabricate({ kind, size: vec(p.size, 0.05, 0, 2), material: (p.material ?? "").toLowerCase() });
      parts.push({ ...base, ref, kind: "fab", fab: kind, size: f.size, material: f.material, spec: f.spec, massG: f.massG, priceUsd: f.priceUsd, suppliers: ["pcbway"], search: f.process });
    } else {
      // Not a real part we know: keep its place in the tree, flag it, draw it as a generic module.
      const name = ref.startsWith("need:") ? base.ref.slice(5).trim() : base.ref || base.name;
      unresolved.add(name);
      parts.push({
        ...base,
        ref: `need:${name}`,
        kind: "need",
        model: "module_pcb",
        size: [0.03, 0.01, 0.03],
        spec: `Not in the catalogue yet: ${name}`,
        massG: 0,
        priceUsd: 0,
        suppliers: [],
        search: name,
      });
    }
  }
  if (!parts.length) throw new Error("The design had no parts.");

  // Parents must exist and must not form a loop.
  const partById = new Map(parts.map((p) => [p.id, p]));
  for (const p of parts) if (p.parent && (!partById.has(p.parent) || p.parent === p.id)) p.parent = "";
  for (const p of parts) {
    const chain = new Set<string>([p.id]);
    let cur = p.parent;
    while (cur) {
      if (chain.has(cur)) {
        p.parent = "";
        break;
      }
      chain.add(cur);
      cur = partById.get(cur)?.parent ?? "";
    }
  }

  // Joints must move a real part, driven by a real actuator (or arm kit) in the design.
  const isActuator = (id: string) => {
    const a = partById.get(id);
    const c = a ? (catalogOf(a) ?? (a.catalogId ? byId.get(a.catalogId) : undefined)) : undefined;
    return !!c && (!!c.actuator || c.model === "arm_kit" || c.model === "gripper_claw" || c.model === "pan_tilt");
  };
  const jointIds = new Set<string>();
  const joints: JointSpec[] = [];
  for (const j of (raw.joints ?? []).slice(0, 24)) {
    if (!partById.has(j.part) || !isActuator(j.actuator)) continue;
    let id = (j.id || j.part).slice(0, 40);
    while (jointIds.has(id)) id += "_";
    jointIds.add(id);
    const lo = finite(j.min, 0);
    const hi = finite(j.max, 1);
    joints.push({
      ...j,
      id,
      kind: (JOINT_KINDS as readonly string[]).includes(j.kind) ? j.kind : "rotate",
      axis: j.axis === "x" || j.axis === "y" ? j.axis : "z",
      min: Math.min(lo, hi),
      max: Math.max(lo, hi),
      loadG: clamp(finite(j.loadG, 0), 0, 1e5),
      leverMm: clamp(finite(j.leverMm, 0), 0, 3000),
    });
  }

  const program: ProgramStep[] = (raw.program ?? [])
    .slice(0, 24)
    .map((s) => ({
      label: (s.label || "Move").slice(0, 60),
      duration: clamp(finite(s.duration, 1), 0.1, 30),
      targets: (s.targets ?? []).filter((t) => jointIds.has(t.joint) && Number.isFinite(t.value)),
    }))
    .filter((s) => s.targets.length > 0 || s.duration > 0);

  return { title: (raw.title || "Machine").slice(0, 80), parts, joints, program, unresolved: [...unresolved] };
}

/** Children of each part id ("" = roots), in input order. */
export function childrenOf(a: Assembly): Map<string, PartSpec[]> {
  const m = new Map<string, PartSpec[]>();
  for (const p of a.parts) {
    const list = m.get(p.parent) ?? [];
    list.push(p);
    m.set(p.parent, list);
  }
  return m;
}

export function totalMassG(a: Assembly): number {
  return a.parts.reduce((s, p) => s + p.massG * p.repeat, 0);
}

export function totalPriceUsd(a: Assembly): number {
  return a.parts.reduce((s, p) => s + p.priceUsd * p.repeat, 0);
}

/** Bill of materials: catalogue and fabricated parts grouped, with quantities and suppliers. */
export function billOfMaterials(a: Assembly): { key: string; name: string; spec: string; qty: number; unitUsd: number; kind: PartSpec["kind"]; suppliers: SupplierKey[]; search: string; source?: string }[] {
  const rows = new Map<string, ReturnType<typeof billOfMaterials>[number]>();
  for (const p of a.parts) {
    const key = p.kind === "catalog" ? p.catalogId! : `${p.ref}:${p.spec}`;
    const name = p.kind === "catalog" ? (catalogOf(p)?.name ?? p.name) : p.kind === "fab" ? `${p.name} (fabricated)` : p.name;
    const r = rows.get(key);
    if (r) r.qty += p.repeat;
    else rows.set(key, { key, name, spec: p.spec, qty: p.repeat, unitUsd: p.priceUsd, kind: p.kind, suppliers: p.suppliers, search: p.search, source: p.source });
  }
  return [...rows.values()];
}

/** Engineering summary: the parts list the physics is re-derived from. */
export function describeAssembly(a: Assembly): string {
  const moving = new Map(a.joints.map((j) => [j.part, j]));
  const lines = a.parts.map((p) => {
    const j = moving.get(p.id);
    return `- ${p.name}${p.repeat > 1 ? ` ×${p.repeat}` : ""}: ${p.kind === "catalog" ? (catalogOf(p)?.name ?? p.ref) : p.spec}, ${p.massG} g${j ? ` — JOINT ${j.id} (${j.kind}, load ${j.loadG} g at ${j.leverMm} mm)` : ""}`;
  });
  return [`${a.title}: ${a.parts.length} parts, total mass ${Math.round(totalMassG(a))} g, parts cost ≈ $${Math.round(totalPriceUsd(a))}.`, ...lines].join("\n");
}

/** The prompt section that teaches Muse Spark to build only from real parts. */
export function assemblyGuide(extra: CatalogPart[] = []): string {
  return `Design the machine as a real, buildable assembly, like an engineer composing it from parts a school or university lab can order online.

PARTS: every part MUST be one of:
1. A catalogue part, by its id (ref = id). Its size, mass and price come from the catalogue; do not invent them. Catalogue (id | name | size mm | mass | price | ratings):
${catalogForPrompt([...CATALOG, ...extra])}
2. A fabricated part that a service like PCBWay makes to order:
   - fab:plate: laser-cut sheet, size [w, thickness, d], thickness 2-6 mm, material acrylic|plywood|aluminium|carbon_fiber. Use for chassis decks, bodies, panels, brackets, mounts
   - fab:printed: 3D-printed part, size [x, y, z] up to 250 mm, material pla|petg|tpu. Use for shells, mounts, couplers, custom brackets, grippers
   - fab:extrusion: 2020 aluminium extrusion cut to length, size [0.02, length, 0.02]
   - fab:rod: steel/aluminium/carbon rod, size [diameter, length, diameter]
3. Only if a real part is essential and missing from the catalogue: ref = "need:<exact real part name>" (it will be looked up online).
Never use solid blocks, cones, spheres or shapes that aren't a real part. Bodies and shells are fab:plate boxes (several plates) or fab:printed parts. Every machine needs its real electronics: a controller, the right driver (PCA9685 for many servos, L298N/TB6612 for DC motors, A4988 for steppers), and a power source that matches the actuators' voltage (a buck converter or UBEC when it doesn't).

FRAMES: metres, y up, the machine stands on the floor at y = 0. Every part is positioned relative to its parent ('' = world); rotations in degrees X then Y then Z.
Part origins: servos at the output shaft on top of the case (the case hangs below and extends towards −x); DC gearmotors at the output shaft pointing +x; steppers at the shaft pointing +y (body below); wheels centred with the axle along z; arm kits with the base on y = 0 reaching +x; boards, modules, batteries, plates and printed parts centred in x/z sitting on y = 0 of their frame.
To make a link move with a servo: make the link a child of the servo, positioned at the servo's origin (the shaft), and add a joint on the link.
For any robot arm, prefer an arm kit (xarm-6dof, mearm, mycobot-280) as ONE part, with an articulate joint; two arms = two kits facing each other (second one rotated [0, 180, 0]).

LIMBS (arms, legs, necks, waving arms, fingers): build them exactly like a real servo kit (Hiwonder, LewanSoul, Robotis): servo → its horn (horn-metal-25t) → a servo bracket (bracket-multi-servo or bracket-u-servo) → the next servo held in that bracket → its horn → bracket → … ending in a gripper-claw-mg996, a sensor, or a pan-tilt-sg90. Use bracket-l-servo for 90° turns. NEVER use a fab:printed or fab:plate part as a moving limb segment, and nothing printed or cut that moves may be longer than 60 mm.
Recipe for a joint that swings in a vertical plane: give the servo rotation [0, 0, -90] so its shaft points +x; put the horn at the servo's origin (position [0, 0, 0]) and the joint on the horn (axis y); put the bracket on the horn with rotation [0, 0, 90] so it reaches upward ([0, 0, -90] reaches downward); mount the next servo at the bracket's far end (position [0, 0.045, 0]) with rotation [0, 0, -90] again, and repeat.
Bodies and enclosures are fab:printed shells (anything over 12 mm in every direction is printed as a 2.5 mm-wall shell) or boxes made of several fab:plate panels.

JOINTS: one per moving part, each driven by the actuator part that really drives it (the servo or motor it's mounted on, or the arm kit itself). Give the real load in grams and its lever arm in mm so torque can be checked. Limits within the actuator's range.

PROGRAM: a realistic routine for the machine's task, 3-12 steps, e.g. for a waving robot: raise the arm to 120°, wave the forearm 60° ↔ 120° three times, lower. Durations long enough for the actuators' real speeds. spin values are rpm, slide/lift mm, rotate degrees, articulate 0 (rest) to 1 (full stroke; use opposite strokes on two arms to alternate).

SCOPE: only the device itself; no tables, benches, rooms, people or props.`;
}

// ---------------------------------------------------------------- editing

function uniqueId(a: Assembly, base: string): string {
  const ids = new Set(a.parts.map((p) => p.id));
  const stem = base.replace(/_\d+$/, "") || "part";
  let n = 2;
  let id = stem;
  while (ids.has(id)) id = `${stem}_${n++}`;
  return id;
}

export function updatePart(a: Assembly, id: string, patch: Partial<PartSpec>): Assembly {
  return { ...a, parts: a.parts.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)) };
}

/** Swaps a part for another catalogue part or a fabricated part, refilling its real data. */
export function setPartRef(a: Assembly, id: string, ref: string): Assembly {
  const p = a.parts.find((x) => x.id === id);
  if (!p) return a;
  const resolved = sanitizeAssembly({ title: a.title, parts: [{ ...p, ref, size: p.kind === "fab" ? p.size : [0.1, 0.003, 0.1] }], joints: [], program: [] }).parts[0];
  return updatePart(a, id, { ...resolved, position: p.position, rotation: p.rotation, parent: p.parent, name: p.name });
}

/** Re-sizes or re-materials a fabricated part, recomputing its mass, cost and spec. */
export function setFab(a: Assembly, id: string, size: [number, number, number], material: string): Assembly {
  const p = a.parts.find((x) => x.id === id);
  if (!p?.fab) return a;
  const f = fabricate({ kind: p.fab, size, material });
  return updatePart(a, id, { size: f.size, material: f.material, massG: f.massG, priceUsd: f.priceUsd, spec: f.spec });
}

/** Adds a catalogue or fabricated part attached to `parent` and returns its id. */
export function addPart(a: Assembly, parent: string, ref = "fab:plate"): { assembly: Assembly; id: string } {
  const id = uniqueId(a, ref.replace(/^fab:/, "").replace(/[^a-z0-9]+/gi, "_"));
  const raw = { id, name: ref.startsWith("fab:") ? "New plate" : (CATALOG_BY_ID.get(ref)?.name ?? "New part"), parent, ref, size: [0.06, 0.003, 0.06], material: "acrylic", color: "", position: [0, 0.01, 0], rotation: [0, 0, 0], repeat: 1, repeatMode: "radial" as const, repeatAxis: "y" as const, repeatStep: 0 };
  const p = sanitizeAssembly({ title: a.title, parts: [raw], joints: [], program: [] }).parts[0];
  return { assembly: { ...a, parts: [...a.parts, { ...p, id, parent }] }, id };
}

/** Copies a part and everything attached to it, with their joints, offset so the copy is visible. */
export function duplicatePart(a: Assembly, id: string): { assembly: Assembly; id: string } {
  const src = a.parts.find((p) => p.id === id);
  if (!src) return { assembly: a, id };
  const kids = childrenOf(a);
  const map = new Map<string, string>();
  const out: PartSpec[] = [];
  let next = a;
  const copy = (p: PartSpec, parent: string, top: boolean) => {
    const nid = uniqueId(next, p.id);
    map.set(p.id, nid);
    const c: PartSpec = { ...p, id: nid, parent, name: top ? `${p.name} copy` : p.name };
    if (top) c.position = [p.position[0] + Math.max(p.size[0], 0.01) * 1.2, p.position[1], p.position[2]];
    out.push(c);
    next = { ...next, parts: [...next.parts, c] };
    for (const k of kids.get(p.id) ?? []) copy(k, nid, false);
  };
  copy(src, src.parent, true);
  const jointCopies = a.joints
    .filter((j) => map.has(j.part))
    .map((j) => ({ ...j, id: `${j.id}_copy`, part: map.get(j.part)!, actuator: map.get(j.actuator) ?? j.actuator }));
  return { assembly: { ...a, parts: [...a.parts, ...out], joints: [...a.joints, ...jointCopies] }, id: map.get(id)! };
}

/** Removes a part, everything attached to it, and the joints that move or are driven by them. */
export function deletePart(a: Assembly, id: string): Assembly {
  const kids = childrenOf(a);
  const gone = new Set<string>();
  const walk = (pid: string) => {
    gone.add(pid);
    for (const k of kids.get(pid) ?? []) walk(k.id);
  };
  walk(id);
  const joints = a.joints.filter((j) => !gone.has(j.part) && !gone.has(j.actuator));
  const keep = new Set(joints.map((j) => j.id));
  return { ...a, parts: a.parts.filter((p) => !gone.has(p.id)), joints, program: a.program.map((s) => ({ ...s, targets: s.targets.filter((t) => keep.has(t.joint)) })) };
}

/** Adds, changes or (with null) removes the joint on a part. */
export function setJoint(a: Assembly, part: string, joint: Omit<JointSpec, "part" | "id"> | null): Assembly {
  const existing = a.joints.find((j) => j.part === part);
  if (!joint) {
    const joints = a.joints.filter((j) => j.part !== part);
    return { ...a, joints, program: a.program.map((s) => ({ ...s, targets: s.targets.filter((t) => t.joint !== existing?.id) })) };
  }
  const id = existing?.id ?? part;
  return { ...a, joints: [...a.joints.filter((j) => j.part !== part), { ...joint, part, id }] };
}

/** Parts in the design that can drive a joint (servos, motors, steppers, kits). */
export function actuatorParts(a: Assembly): PartSpec[] {
  return a.parts.filter((p) => {
    const c = catalogOf(p);
    return !!c && (!!c.actuator || c.model === "arm_kit" || c.model === "gripper_claw" || c.model === "pan_tilt");
  });
}

export { FAB_KINDS, FAB_MATERIALS };

/** Swaps "need:" parts for the real parts found for them (by web search or upload), keeping placement. */
export function resolveNeeds(a: Assembly, found: Map<string, CatalogPart>): Assembly {
  if (!found.size) return a;
  const parts = a.parts.map((p) => {
    if (p.kind !== "need") return p;
    const c = found.get(p.search) ?? found.get(p.ref.replace(/^need:/, ""));
    return c ? { ...p, ref: c.id, ...fromCatalog(c) } : p;
  });
  return { ...a, parts, unresolved: (a.unresolved ?? []).filter((n) => !found.has(n)) };
}
