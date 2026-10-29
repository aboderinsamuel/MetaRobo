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

export const WIRE_KINDS = ["power", "ground", "signal", "data", "motor", "tube"] as const;
export type WireKind = (typeof WIRE_KINDS)[number];

export const ConnectionOut = z.object({
  from: z.string().describe("Part id"),
  fromPin: z.string().describe("Pin / port on that part, e.g. 5V, GND, A0, D7, VCC, SIG, NO, COM, OUT, IN, OUTLET"),
  to: z.string().describe("Part id"),
  toPin: z.string(),
  kind: z.enum(WIRE_KINDS).describe("power (red), ground (black), signal (analog/digital), data (I²C/serial/PWM), motor (to a motor/pump/valve), tube (water/air)"),
});

export const SignalOut = z.object({
  id: z.string().describe("Short id, e.g. moisture, temperature, distance, light"),
  sensor: z.string().describe("id of the sensor part that measures it"),
  name: z.string().describe("e.g. 'Soil moisture'"),
  unit: z.string().describe("e.g. %, °C, cm, lux"),
  min: z.number(),
  max: z.number(),
  start: z.number().describe("Value at the start of the simulation"),
  drift: z.number().describe("Natural change per simulated second with nothing on (e.g. soil drying: −0.02 %/s)"),
  effects: z
    .array(z.object({ part: z.string().describe("id of an actuator/output part"), rate: z.number().describe("Change per simulated second while that part is on (e.g. pump on: +0.5 %/s)") }))
    .describe("How outputs change this signal"),
  shows: z.string().describe("id of a part whose look follows this signal (the pot's soil, the reservoir's water), or ''"),
});

export const RuleOut = z.object({
  signal: z.string().describe("Signal id"),
  op: z.enum(["<", ">"]),
  value: z.number().describe("Threshold"),
  hysteresis: z.number().describe("Turn back off only once the signal is this far past the threshold"),
  outputs: z
    .array(z.object({ part: z.string().describe("Output part id: relay, pump, LED, buzzer, fan, solenoid, display"), action: z.enum(["on", "beep", "display"]), text: z.string().describe("display only: text, may use {signal id} placeholders, '\\n' for line 2; else ''") }))
    .describe("What the controller does while the rule is active"),
});

export const AssemblyOut = z.object({
  title: z.string().describe("Name of the machine"),
  parts: z.array(PartOut),
  connections: z.array(ConnectionOut).describe("EVERY wire and tube: power, ground, signals, data, motor leads, water tubes"),
  joints: z.array(JointOut),
  program: z.array(StepOut).describe("A realistic motion routine for the machine's task (empty if nothing moves mechanically)"),
  signals: z.array(SignalOut).describe("What the sensors measure and how it changes over time (empty for pure motion machines)"),
  rules: z.array(RuleOut).describe("The controller's logic: if a signal crosses a threshold, switch outputs"),
  timeScale: z.number().describe("Simulated seconds per real second of playback: 1 for fast mechanisms, 30-600 for slow processes like soil drying"),
  simSeconds: z.number().describe("How many simulated seconds to run the behaviour for (e.g. 1800 for a plant drying and being watered)"),
});

export type AiAssembly = z.infer<typeof AssemblyOut>;
/** What the validator accepts: a full AI design, or an older / partial one without behaviour or wiring. */
export type AssemblyInput = Omit<AiAssembly, "connections" | "signals" | "rules" | "timeScale" | "simSeconds"> &
  Partial<Pick<AiAssembly, "connections" | "signals" | "rules" | "timeScale" | "simSeconds">>;
export type JointSpec = z.infer<typeof JointOut>;
export type ProgramStep = z.infer<typeof StepOut>;
export type Connection = z.infer<typeof ConnectionOut>;
export type SignalSpec = z.infer<typeof SignalOut>;
export type RuleSpec = z.infer<typeof RuleOut>;

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
  /** Every wire and tube between parts. */
  connections: Connection[];
  /** Behaviour: sensor signals, the controller's rules, and how fast to play it back. */
  signals: SignalSpec[];
  rules: RuleSpec[];
  timeScale: number;
  simSeconds: number;
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
export function sanitizeAssembly(raw: AssemblyInput | Assembly, extra: CatalogPart[] = []): Assembly {
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

  // Wires and tubes must join two real parts.
  const seenWire = new Set<string>();
  const connections: Connection[] = [];
  for (const c of (raw.connections ?? []).slice(0, 80)) {
    if (!partById.has(c.from) || !partById.has(c.to) || c.from === c.to) continue;
    const kind = (WIRE_KINDS as readonly string[]).includes(c.kind) ? c.kind : "signal";
    const key = `${c.from}.${c.fromPin}>${c.to}.${c.toPin}`;
    if (seenWire.has(key)) continue;
    seenWire.add(key);
    connections.push({ from: c.from, to: c.to, fromPin: (c.fromPin || "").slice(0, 12), toPin: (c.toPin || "").slice(0, 12), kind });
  }

  // Signals are measured by a real part; effects come from real outputs.
  const signalIds = new Set<string>();
  const signals: SignalSpec[] = [];
  for (const s of (raw.signals ?? []).slice(0, 8)) {
    if (!partById.has(s.sensor)) continue;
    let id = (s.id || s.name || "signal").replace(/[^\w]/g, "_").slice(0, 24);
    while (signalIds.has(id)) id += "_";
    signalIds.add(id);
    const lo = finite(s.min, 0);
    const hi = finite(s.max, 100);
    const span = Math.max(1e-6, Math.abs(hi - lo));
    signals.push({
      ...s,
      id,
      name: (s.name || id).slice(0, 40),
      unit: (s.unit || "").slice(0, 8),
      min: Math.min(lo, hi),
      max: Math.max(lo, hi),
      start: clamp(finite(s.start, lo), Math.min(lo, hi), Math.max(lo, hi)),
      drift: clamp(finite(s.drift, 0), -span, span),
      effects: (s.effects ?? []).filter((e) => partById.has(e.part)).map((e) => ({ part: e.part, rate: clamp(finite(e.rate, 0), -span, span) })),
      shows: partById.has(s.shows) ? s.shows : "",
    });
  }
  const rules: RuleSpec[] = (raw.rules ?? [])
    .slice(0, 12)
    .filter((r) => signalIds.has(r.signal))
    .map((r) => ({
      ...r,
      op: r.op === ">" ? (">" as const) : ("<" as const),
      value: finite(r.value, 0),
      hysteresis: Math.max(0, finite(r.hysteresis, 0)),
      outputs: (r.outputs ?? []).filter((o) => partById.has(o.part)).map((o) => ({ part: o.part, action: o.action === "beep" || o.action === "display" ? o.action : ("on" as const), text: (o.text ?? "").slice(0, 40) })),
    }))
    .filter((r) => r.outputs.length > 0);

  return {
    title: (raw.title || "Machine").slice(0, 80),
    parts,
    joints,
    program,
    connections,
    signals,
    rules,
    timeScale: clamp(finite(raw.timeScale, 1), 1, 3600),
    simSeconds: clamp(finite(raw.simSeconds, 0), 0, 86400),
    unresolved: [...unresolved],
  };
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
Match hardware to the servo's size: micro servos (sg90, mg90s, fs90r) take horn-micro-21t and bracket-u-micro; standard servos (mg996r, ds3218, hs422) take horn-metal-25t and the standard brackets. Kits already include their servos (pan-tilt-sg90 has 2 SG90s, gripper-claw-mg996 has its MG996R): don't add separate servos for them; put joints on the kit itself.
Bodies and enclosures are fab:printed shells (anything over 12 mm in every direction is printed as a 2.5 mm-wall shell) or boxes made of several fab:plate panels.

JOINTS: one per moving part, each driven by the actuator part that really drives it (the servo or motor it's mounted on, or the arm kit itself). Give the real load in grams and its lever arm in mm so torque can be checked. Limits within the actuator's range.

PROGRAM: a realistic routine for the machine's task, 3-12 steps, e.g. for a waving robot: raise the arm to 120°, wave the forearm 60° ↔ 120° three times, lower. Durations long enough for the actuators' real speeds. spin values are rpm, slide/lift mm, rotate degrees, articulate 0 (rest) to 1 (full stroke; use opposite strokes on two arms to alternate).

LAYOUT: lay the device out as it would sit on a desk, compact and tidy. Mount every board, driver, relay, regulator and battery on a base plate (fab:plate) or inside an enclosure (fab:printed shell), close together, with standoffs where a PCB sits on a plate. Separate units (a plant pot, a water reservoir, a sensor on a stalk) sit right next to the base, never far away, and are joined to it by wires and tubes. Nothing loose, nothing floating, nothing scattered across the floor.

WIRING (connections): list EVERY wire and tube, like a real wiring diagram, using each part's real pin names:
- power: the supply (or a regulator's output) to every powered part's VCC / 5V / VIN / + pin; ground: GND to GND for every powered part (a common ground);
- signal: sensor outputs (AOUT, DOUT, SIG, TRIG/ECHO) to the controller's pins (A0-A5 analog, D2-D13 digital); data: I²C / serial / servo PWM leads (SDA, SCL, TX, RX, PWM);
- the controller's output pin to a driver's input (relay IN, MOSFET SIG, L298N IN1-IN4, PCA9685 SDA/SCL);
- motor: a driver's or relay's switched output (relay COM/NO, MOSFET OUT, L298N OUT1-OUT4) to the motor / pump / valve / fan;
- tube: a pump's OUTLET to where the water goes (the pot), and its INLET sits in the reservoir.
A relay or MOSFET always sits between a controller pin and a pump, motor, valve or fan; never drive those straight from a pin.

BEHAVIOUR (signals + rules), for anything that senses and reacts:
- signals: what each sensor measures, with realistic numbers: its range, a start value, its natural drift per simulated second (soil drying ≈ −0.02 %/s, a room warming ≈ +0.002 °C/s), and how each output changes it while on (a 1.2 L/min pump watering a pot ≈ +0.5 %/s). Set shows to the part whose look follows it (the pot's soil for moisture).
- rules: the controller's logic: if signal < or > threshold → switch outputs on (relay, pump, LED, fan, valve), beep a buzzer, or put text on an LCD / OLED (use {signal id} in the text, '\\n' for line 2). Use hysteresis so outputs don't chatter (water below 30 %, stop above 45 %: value 30, hysteresis 15).
- timeScale and simSeconds: real processes are slow, so compress them: soil drying and watering ≈ simSeconds 3600 with timeScale 180 (one simulated hour in 20 s of playback); a thermostat ≈ 1800 / 90; a fast mechanism 1 / 1.

PLAYBOOKS: follow the one that matches the machine.
- Plant care / watering / sensing a value: pot-12cm with soil-cap-v12 pushed into the soil (child of the pot, its tip below the soil surface); reservoir-1l beside it with pump-mini-5v inside (child of the reservoir); a tube from the pump's OUTLET to the pot; arduino-uno (or esp32-devkitc) + relay-1ch (or mosfet-module) + buzzer-active / led-5mm / lcd1602-i2c on a fab:plate base beside the pot; usb-5v-2a or batt-aa4 for power; jumper-kit and tube-silicone-6mm in the build. Signal: moisture; rules: water when dry (relay + pump on, buzzer beep, LCD "Watering..."), LED on when the tank is empty if there's a level sensor.
- Robot arm / manipulator / pick-and-place: an arm kit, or a servo → horn → bracket chain; pca9685 for more than 4 servos; ubec-5a from a 2S battery or a 6 V supply; a motion program for the task.
- Mobile robot / car / line follower / obstacle avoider: chassis-2wd-acrylic (or 4wd), two tt-motor (or n20-100) with wheel-tt-65 on their shafts, caster-ball, l298n or tb6612, batt-18650x2, hc-sr04 / line-array at the front; spin joints on the wheels; signals: distance or line position; rules: stop / turn when an obstacle is close.
- Animatronic / waving / humanoid / desk companion: fab:printed shell body and head, servo-chain limbs (see LIMBS), pan-tilt-sg90 for a head, pir-hcsr501 or hc-sr04 to notice people, oled-128x64 face; a program for the gesture, rules for what the sensor triggers (LED / display / buzzer).
- Linear axis / conveyor / plotter / camera slider: fab:extrusion frame, nema17 + a4988 + lead-screw-t8-300 (or gt2-pulley-20t), limit-switch end stops, psu-12v-5a; slide joints.
- Monitor / weather station / smart home: esp32-devkitc, dht22 / bme280 / ldr-module, lcd1602-i2c or oled-128x64, fan-5v-40 or led-rgb as outputs via mosfet-module; signals with slow drift; rules for the outputs.

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
