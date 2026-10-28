// AI-designed machines: the 3D assembly Muse Spark returns for anything you describe, and the
// validator that makes sure a bad answer can never break the scene.
//
// Conventions (also given to the model):
// - Metres, y up, the machine stands on y = 0. Rotations in degrees, applied X then Y then Z.
// - Every part is positioned relative to its parent ("" = the world).
// - Round shapes are built along their local Y axis.
// - A motion binds the simulated output to one part; children move with it.
import { z } from "zod";

export const SHAPES = [
  // primitives, refined: bevelled edges, chamfered cylinders
  "box",
  "rounded_box",
  "cylinder",
  "tube",
  "sphere",
  "cone",
  "capsule",
  "torus",
  // mechanical
  "blade",
  "gear",
  "pulley",
  "bearing",
  "extrusion",
  "spring",
  "propeller",
  // electromechanical parts from RoboCraft's library (same meshes as the built-in robots)
  "dc_motor",
  "servo",
  "wheel",
  "battery",
  "controller_board",
  "motor_driver",
  "sensor",
] as const;
export type Shape = (typeof SHAPES)[number];

export const MATERIALS = ["aluminium", "steel", "dark_metal", "brass", "copper", "plastic", "glossy_plastic", "rubber", "wood", "glass", "painted_metal", "pcb", "light"] as const;
export type MaterialKind = (typeof MATERIALS)[number];

export const MOTION_KINDS = ["spin", "rotate", "slide", "lift"] as const;
export type MotionKind = (typeof MOTION_KINDS)[number];

const V3 = z.array(z.number()).describe("[x, y, z]");

export const PartOut = z.object({
  id: z.string().describe("Short unique id, e.g. hub, blade, base"),
  name: z.string().describe("What it is, e.g. 'Fan blade'"),
  spec: z.string().describe("Engineering spec of the real part, e.g. 'ERM coin motor, 10 mm, 3 V, 12,000 rpm' or 'ABS, 2 mm wall'"),
  massG: z.number().describe("Mass of one copy in grams"),
  parent: z.string().describe("id of the part it is attached to, or '' for the world"),
  shape: z.enum(SHAPES),
  material: z.enum(MATERIALS),
  color: z.string().describe("#rrggbb"),
  size: V3.describe("Shape size in metres; see the shape conventions"),
  position: V3.describe("Metres, relative to the parent"),
  rotation: V3.describe("Degrees about X, Y, Z, relative to the parent"),
  repeat: z.number().describe("Copies of this part (1 = just one). Use for blades, spokes, rollers, bolts"),
  repeatMode: z.enum(["radial", "linear"]),
  repeatAxis: z.enum(["x", "y", "z"]),
  repeatStep: z.number().describe("radial: degrees between copies (0 = spread evenly over 360); linear: metres between copies"),
});

export const MotionOut = z.object({
  part: z.string().describe("id of the part that moves (its children move with it)"),
  kind: z.enum(MOTION_KINDS).describe("spin: continuous rotation at a rate; rotate: turn to an angle; slide: move along an axis; lift: move up"),
  axis: z.enum(["x", "y", "z"]).describe("In the part's own frame"),
  gain: z
    .number()
    .describe("Converts the simulated output to motion. spin: rad/s per output unit; rotate: radians per output unit; slide and lift: metres per output unit"),
});

export const AssemblyOut = z.object({
  title: z.string().describe("Name of the machine"),
  parts: z.array(PartOut),
  motions: z.array(MotionOut),
});

export type PartSpec = z.infer<typeof PartOut>;
export type MotionSpec = z.infer<typeof MotionOut>;
export type Assembly = z.infer<typeof AssemblyOut>;

export const MAX_PARTS = 60;
const MAX_REPEAT = 36;
const MAX_INSTANCES = 400;

const finite = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const vec = (v: number[] | undefined, d: number, lo: number, hi: number): [number, number, number] => [0, 1, 2].map((i) => clamp(finite(v?.[i], d), lo, hi)) as [number, number, number];

/**
 * Cleans an AI assembly so it always renders: unknown parents and cycles are re-attached to the
 * world, sizes and positions are clamped, repeats are capped, and motions must name a real part.
 * Throws only when nothing usable is left.
 */
export function sanitizeAssembly(raw: Assembly): Assembly {
  const seen = new Set<string>();
  let instances = 0;
  const parts: PartSpec[] = [];
  for (const p of raw.parts.slice(0, MAX_PARTS)) {
    let id = (p.id || "part").trim().slice(0, 40);
    while (seen.has(id)) id += "_";
    seen.add(id);
    const repeat = clamp(Math.round(finite(p.repeat, 1)), 1, MAX_REPEAT);
    if (instances + repeat > MAX_INSTANCES) break;
    instances += repeat;
    parts.push({
      ...p,
      id,
      name: (p.name || id).slice(0, 60),
      spec: (p.spec ?? "").slice(0, 120),
      massG: clamp(finite(p.massG, 0), 0, 1e6),
      parent: (p.parent ?? "").trim(),
      color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "",
      size: vec(p.size, 0.05, 0.0005, 20),
      position: vec(p.position, 0, -30, 30),
      rotation: vec(p.rotation, 0, -720, 720),
      repeat,
      repeatStep: finite(p.repeatStep, 0),
    });
  }
  if (!parts.length) throw new Error("The 3D design had no parts.");

  // Parents must exist and must not form a loop.
  const byId = new Map(parts.map((p) => [p.id, p]));
  for (const p of parts) {
    if (p.parent && (!byId.has(p.parent) || p.parent === p.id)) p.parent = "";
  }
  for (const p of parts) {
    const chain = new Set<string>([p.id]);
    let cur = p.parent;
    while (cur) {
      if (chain.has(cur)) {
        p.parent = "";
        break;
      }
      chain.add(cur);
      cur = byId.get(cur)?.parent ?? "";
    }
  }

  const motions = raw.motions
    .filter((m) => byId.has(m.part))
    .slice(0, 6)
    .map((m) => ({ ...m, gain: finite(m.gain, 1) || 1 }));

  return { title: (raw.title || "Machine").slice(0, 80), parts, motions };
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

/** The prompt section that teaches Muse Spark the format. */
export const ASSEMBLY_GUIDE = `Design the machine as a realistic 3D assembly that a person would recognise.

Units and frames: metres, y is up, the machine stands on the floor at y = 0. Every part is positioned relative to its parent ("" = world). Rotations are degrees about X, then Y, then Z. Real-world sizes matter: a desk fan is ~0.35 m tall, a robot arm ~0.5 m, a garage door ~2.4 m.

Shapes and their size = [a, b, c]:
- box [width x, height y, depth z] (slightly bevelled); rounded_box same, softer corners
- cylinder [diameter, length along y, unused]; tube [outer diameter, length along y, inner diameter]
- sphere [diameter, -, -]; cone [base diameter, height along y, -]; capsule [diameter, total length along y, -]
- torus [ring diameter, tube diameter, -] lying in the x-z plane
- blade [length along +x from the origin, chord width, thickness]: a twisted airfoil, root at the origin. Put it on a hub and repeat it radially about y for fan or turbine blades
- gear [diameter, thickness along y, number of teeth]; pulley [diameter, width along y, -]; bearing [outer diameter, width along y, -]
- extrusion [profile width, length along y, -]: aluminium T-slot frame member; spring [coil diameter, length along y, turns]
- propeller [diameter, -, -]: two-blade prop spinning about y
- dc_motor [body length, diameter, -]: gearmotor, output shaft at the origin pointing +x
- servo [-, -, -]: hobby servo, horn on top (+y); wheel [diameter, width, -]: tyre and hub, axle along z
- battery, controller_board, motor_driver, sensor [-, -, -]: real modules at their real size, sitting on y = 0 of their frame

Materials: aluminium, steel, dark_metal, brass, copper, plastic, glossy_plastic, rubber, wood, glass, painted_metal, pcb, light (glows). Give each part a realistic colour as #rrggbb.

Repeats: repeat > 1 makes copies. radial: copies rotate about repeatAxis by repeatStep degrees (0 = spread evenly over 360). linear: copies step repeatStep metres along repeatAxis.

Motion: bind the simulated output to the part(s) that really move. spin for things that turn continuously at the simulated speed (fan hubs, wheels, rollers, pulleys); rotate for joints and hinges driven to the simulated angle; slide for linear axes and doors; lift for platforms, lifts and anything that rises. gain converts the output's unit: spin = rad/s per unit (rpm → 0.10472, rad/s → 1), rotate = radians per unit (degrees → 0.017453), slide/lift = metres per unit (cm → 0.01, mm → 0.001, m → 1). For a vehicle whose speed is simulated, spin its wheels with gain = 1 / wheel radius.

Scope: build ONLY the device the user asked for, as the real product would be built. Never add tables, benches, stands, floors, walls, rooms, people, test equipment, bench power supplies, cables to elsewhere or other props, unless the user explicitly asked for them. If the physics description mentions a test setup, ignore the setup and design the device itself. The device rests directly on y = 0. Electronics (boards, batteries, motors, drivers) appear only where the real device contains them, inside or on it.

Detail: 12-50 parts, like an engineering CAD assembly: the enclosure or frame, the drive (motor, gears, pulleys, shaft), the moving parts, internal components, and fasteners where they matter. Each part gets a realistic spec and mass in grams. Keep parts touching: no floating pieces.`;

/** Engineering summary of an assembly: the parts list the physics is re-derived from. */
export function describeAssembly(a: Assembly): string {
  const moving = new Map(a.motions.map((m) => [m.part, m]));
  const total = a.parts.reduce((s, p) => s + p.massG * p.repeat, 0);
  const mm = (v: number) => Math.round(v * 1000);
  const lines = a.parts.map((p) => {
    const m = moving.get(p.id);
    return `- ${p.name}${p.repeat > 1 ? ` ×${p.repeat}` : ""}: ${p.shape}, ${p.material}, ${mm(p.size[0])}×${mm(p.size[1])}×${mm(p.size[2])} mm, ${p.massG} g${p.spec ? `, ${p.spec}` : ""}${m ? ` — MOVES (${m.kind} about/along ${m.axis})` : ""}`;
  });
  return [`${a.title}: ${a.parts.length} parts, total mass ${Math.round(total)} g.`, ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Editing: pure operations on an assembly, used by the parts panel and the 3D gizmo
// ---------------------------------------------------------------------------

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

/** Adds a new part attached to `parent` ("" = the world) and returns it with the new assembly. */
export function addPart(a: Assembly, parent: string, shape: Shape = "box"): { assembly: Assembly; id: string } {
  const id = uniqueId(a, shape);
  const p: PartSpec = {
    id,
    name: "New part",
    spec: "",
    massG: 10,
    parent,
    shape,
    material: "aluminium",
    color: "",
    size: [0.03, 0.03, 0.03],
    position: [0, 0.04, 0],
    rotation: [0, 0, 0],
    repeat: 1,
    repeatMode: "radial",
    repeatAxis: "y",
    repeatStep: 0,
  };
  return { assembly: { ...a, parts: [...a.parts, p] }, id };
}

/** Copies a part and everything attached to it, offset slightly so the copy is visible. */
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
  const motions = [...a.motions, ...a.motions.filter((m) => map.has(m.part)).map((m) => ({ ...m, part: map.get(m.part)! }))];
  return { assembly: { ...a, parts: [...a.parts, ...out], motions }, id: map.get(id)! };
}

/** Removes a part and everything attached to it, and any motion on them. */
export function deletePart(a: Assembly, id: string): Assembly {
  const kids = childrenOf(a);
  const gone = new Set<string>();
  const walk = (pid: string) => {
    gone.add(pid);
    for (const k of kids.get(pid) ?? []) walk(k.id);
  };
  walk(id);
  return { ...a, parts: a.parts.filter((p) => !gone.has(p.id)), motions: a.motions.filter((m) => !gone.has(m.part)) };
}

/** Sets (or clears, with null) how a part moves with the simulation. */
export function setMotion(a: Assembly, part: string, motion: Omit<MotionSpec, "part"> | null): Assembly {
  const rest = a.motions.filter((m) => m.part !== part);
  return { ...a, motions: motion ? [...rest, { ...motion, part }] : rest };
}

export function totalMassG(a: Assembly): number {
  return a.parts.reduce((s, p) => s + p.massG * p.repeat, 0);
}
