"use client";

// Renders any machine Muse Spark designs (lib/lab/assembly.ts) and drives its moving parts from the
// simulation. Realism comes from three things: real-scale geometry with bevels and chamfers that
// catch the light, physically based materials lit by studio reflections, and the same hand-built
// part meshes the built-in robots use (gearmotors, wheels, batteries, boards, drivers, sensors).
import { Environment, Lightformer, RoundedBox, TransformControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { childrenOf, type Assembly, type MaterialKind, type MotionSpec, type PartSpec } from "@/lib/lab/assembly";
import { BATTERIES, BOARDS, DRIVERS, GEARMOTORS, IMUS } from "@/lib/lab/hardware/parts";
import { integrate } from "@/lib/lab/rig";
import { BatteryMesh, BoardMesh, DriverMesh, GearMotorMesh, Label, SensorMesh, Wheel } from "./parts3d";
import { sample, type Clock } from "./rigs";

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

type MatProps = {
  color: string;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  transparent?: boolean;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  toneMapped?: boolean;
};

const MATERIALS: Record<MaterialKind, MatProps> = {
  aluminium: { color: "#c9ced6", metalness: 1, roughness: 0.32 },
  steel: { color: "#b4bac3", metalness: 1, roughness: 0.22 },
  dark_metal: { color: "#2c3138", metalness: 0.9, roughness: 0.38 },
  brass: { color: "#c9a24a", metalness: 1, roughness: 0.3 },
  copper: { color: "#c87a4a", metalness: 1, roughness: 0.28 },
  plastic: { color: "#d9dde3", metalness: 0, roughness: 0.55 },
  glossy_plastic: { color: "#e8ebef", metalness: 0, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 },
  rubber: { color: "#15181c", metalness: 0, roughness: 0.92 },
  wood: { color: "#a0703f", metalness: 0, roughness: 0.72 },
  glass: { color: "#dfefff", metalness: 0, roughness: 0.04, transparent: true, opacity: 0.32, clearcoat: 1 },
  painted_metal: { color: "#3b6fd6", metalness: 0.45, roughness: 0.34, clearcoat: 0.7, clearcoatRoughness: 0.15 },
  pcb: { color: "#1d6b3a", metalness: 0.1, roughness: 0.6 },
  light: { color: "#ffffff", metalness: 0, roughness: 0.4, emissiveIntensity: 2.2, toneMapped: false },
};

function Mat({ part }: { part: PartSpec }) {
  const base = MATERIALS[part.material] ?? MATERIALS.plastic;
  const color = part.color || base.color;
  return (
    <meshPhysicalMaterial
      color={color}
      metalness={base.metalness}
      roughness={base.roughness}
      clearcoat={base.clearcoat ?? 0}
      clearcoatRoughness={base.clearcoatRoughness ?? 0}
      transparent={base.transparent ?? false}
      opacity={base.opacity ?? 1}
      emissive={base.emissiveIntensity ? color : "#000000"}
      emissiveIntensity={base.emissiveIntensity ?? 0}
      toneMapped={base.toneMapped ?? true}
      envMapIntensity={1.1}
    />
  );
}

// ---------------------------------------------------------------------------
// Geometry: built once per part, at real scale
// ---------------------------------------------------------------------------

/** Lathe profile (radius, y) pairs → a solid of revolution about y. */
function lathe(points: [number, number][], segments = 64): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)),
    segments,
  );
}

function chamferedCylinder(r: number, h: number): THREE.BufferGeometry {
  const c = Math.min(r, h) * 0.08;
  return lathe([
    [0, -h / 2],
    [r - c, -h / 2],
    [r, -h / 2 + c],
    [r, h / 2 - c],
    [r - c, h / 2],
    [0, h / 2],
  ]);
}

function tube(ro: number, h: number, ri: number): THREE.BufferGeometry {
  const inner = Math.min(Math.max(ri, ro * 0.1), ro * 0.95);
  const c = Math.min(ro - inner, h) * 0.15;
  return lathe([
    [inner, -h / 2],
    [ro - c, -h / 2],
    [ro, -h / 2 + c],
    [ro, h / 2 - c],
    [ro - c, h / 2],
    [inner, h / 2],
    [inner, -h / 2],
  ]);
}

function pulley(r: number, w: number): THREE.BufferGeometry {
  const g = w * 0.35;
  return lathe([
    [0, -w / 2],
    [r, -w / 2],
    [r, -g],
    [r * 0.78, 0],
    [r, g],
    [r, w / 2],
    [0, w / 2],
  ]);
}

function gear(d: number, t: number, teeth: number): THREE.BufferGeometry {
  const n = Math.max(8, Math.min(120, Math.round(teeth) || Math.round(d * 400) || 20));
  const ro = d / 2;
  const depth = Math.min(ro * 0.18, (Math.PI * d) / n / 1.6);
  const ri = ro - depth;
  const shape = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const step = (Math.PI * 2) / n;
    const pts: [number, number][] = [
      [ri, a0],
      [ro, a0 + step * 0.18],
      [ro, a0 + step * 0.42],
      [ri, a0 + step * 0.6],
    ];
    pts.forEach(([r, a], k) => (i === 0 && k === 0 ? shape.moveTo(r * Math.cos(a), r * Math.sin(a)) : shape.lineTo(r * Math.cos(a), r * Math.sin(a))));
  }
  shape.closePath();
  const bore = new THREE.Path();
  bore.absarc(0, 0, ro * 0.18, 0, Math.PI * 2, true);
  shape.holes.push(bore);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: true, bevelSize: t * 0.06, bevelThickness: t * 0.06, bevelSegments: 2, curveSegments: 4 });
  geo.translate(0, 0, -t / 2);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Aluminium T-slot profile along y. */
function extrusion(w: number, len: number): THREE.BufferGeometry {
  const s = w / 2;
  const slot = w * 0.13;
  const shape = new THREE.Shape();
  // Square with a slot cut into the middle of each side.
  const side = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const tx = (bx - ax) / Math.hypot(bx - ax, by - ay);
    const ty = (by - ay) / Math.hypot(bx - ax, by - ay);
    shape.lineTo(mx - tx * slot, my - ty * slot);
    shape.lineTo(mx - tx * slot - nx * slot * 1.4, my - ty * slot - ny * slot * 1.4);
    shape.lineTo(mx + tx * slot - nx * slot * 1.4, my + ty * slot - ny * slot * 1.4);
    shape.lineTo(mx + tx * slot, my + ty * slot);
    shape.lineTo(bx, by);
  };
  shape.moveTo(-s, -s);
  side(-s, -s, s, -s, 0, -1);
  side(s, -s, s, s, 1, 0);
  side(s, s, -s, s, 0, 1);
  side(-s, s, -s, -s, -1, 0);
  const core = new THREE.Path();
  core.absarc(0, 0, w * 0.12, 0, Math.PI * 2, true);
  shape.holes.push(core);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 12 });
  geo.translate(0, 0, -len / 2);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function spring(d: number, len: number, turns: number): THREE.BufferGeometry {
  const n = Math.max(2, Math.min(40, Math.round(turns) || 8));
  const r = d / 2;
  const pts: THREE.Vector3[] = [];
  const steps = n * 32;
  for (let i = 0; i <= steps; i++) {
    const a = (i / 32) * Math.PI * 2;
    pts.push(new THREE.Vector3(r * Math.cos(a), -len / 2 + (len * i) / steps, r * Math.sin(a)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps, Math.max(0.0004, d * 0.06), 8, false);
}

/** A twisted, tapered, cambered airfoil from the origin along +x. */
function blade(len: number, chord: number, thick: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(len, Math.max(thick, 0.0005), chord, 28, 1, 10);
  geo.translate(len / 2, 0, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const u = Math.min(1, Math.max(0, x / len)); // 0 root → 1 tip
    let y = p.getY(i);
    let z = p.getZ(i);
    // Taper and round the tip.
    const taper = 1 - 0.35 * u - 0.45 * Math.pow(u, 6);
    z *= taper;
    // Thin towards the edges (airfoil-ish) and camber.
    const e = Math.min(1, Math.abs(z) / ((chord / 2) * taper + 1e-9));
    y = y * (1 - 0.7 * e * e) + chord * 0.06 * taper * (1 - e * e);
    // Twist: steep at the root, flatter at the tip.
    const tw = (32 - 22 * u) * DEG;
    const c = Math.cos(tw);
    const s = Math.sin(tw);
    p.setXYZ(i, x, y * c - z * s, y * s + z * c);
  }
  geo.computeVertexNormals();
  return geo;
}

function useGeometry(part: PartSpec): THREE.BufferGeometry | null {
  const [a, b, c] = part.size;
  return useMemo(() => {
    switch (part.shape) {
      case "cylinder":
        return chamferedCylinder(a / 2, b);
      case "tube":
        return tube(a / 2, b, c / 2);
      case "cone":
        return lathe([
          [0, -b / 2],
          [a / 2, -b / 2],
          [0, b / 2],
        ]);
      case "sphere":
        return new THREE.SphereGeometry(a / 2, 48, 32);
      case "capsule":
        return new THREE.CapsuleGeometry(a / 2, Math.max(0, b - a), 12, 32);
      case "torus":
        return new THREE.TorusGeometry(a / 2, Math.max(b / 2, 0.0004), 20, 64).rotateX(Math.PI / 2);
      case "gear":
        return gear(a, b, c);
      case "pulley":
        return pulley(a / 2, b);
      case "extrusion":
        return extrusion(a, b);
      case "spring":
        return spring(a, b, c);
      case "blade":
        return blade(a, b, c);
      default:
        return null;
    }
  }, [part.shape, a, b, c]);
}

// ---------------------------------------------------------------------------
// One part (shape only, no transform)
// ---------------------------------------------------------------------------

function motorFor(diameter: number) {
  const look = diameter <= 0.014 ? "n20" : diameter <= 0.027 ? "jga25" : diameter <= 0.04 ? "37d" : "pg45";
  return GEARMOTORS.find((m) => m.look === look) ?? GEARMOTORS[0];
}

function PartShape({ part }: { part: PartSpec }) {
  const geo = useGeometry(part);
  const [a, b, c] = part.size;
  if (geo) {
    return (
      <mesh geometry={geo} castShadow receiveShadow>
        <Mat part={part} />
      </mesh>
    );
  }
  switch (part.shape) {
    case "box":
    case "rounded_box": {
      const r = Math.min(a, b, c) * (part.shape === "box" ? 0.06 : 0.22);
      return (
        <RoundedBox args={[a, b, c]} radius={Math.max(0.0002, r)} smoothness={4} castShadow receiveShadow>
          <Mat part={part} />
        </RoundedBox>
      );
    }
    case "bearing":
      return <Bearing d={a} w={b} />;
    case "propeller":
      return <Propeller part={part} />;
    case "dc_motor":
      return <GearMotorMesh motor={motorFor(b)} />;
    case "wheel":
      return <Wheel r={a / 2} w={Math.max(0.004, b)} hub={part.color || "#2dd4ff"} />;
    case "battery":
      return <BatteryMesh battery={BATTERIES.find((x) => x.look === "18650") ?? BATTERIES[0]} />;
    case "controller_board":
      return <BoardMesh board={BOARDS[0]} />;
    case "motor_driver":
      return <DriverMesh driver={DRIVERS[0]} />;
    case "sensor":
      return <SensorMesh sensor={IMUS[0]} />;
    case "servo":
      return <Servo />;
    default:
      return null;
  }
}

/** A ball bearing: outer and inner steel races with the ball cage between them, axis along y. */
function Bearing({ d, w }: { d: number; w: number }) {
  const ro = d / 2;
  const [outer, inner] = useMemo(() => [tube(ro, w, ro * 1.45), tube(ro * 0.62, w * 1.02, ro * 0.62)], [ro, w]);
  return (
    <group>
      {[outer, inner].map((g, i) => (
        <mesh key={i} geometry={g} castShadow>
          <meshPhysicalMaterial color="#c4c9d1" metalness={1} roughness={0.18} />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[ro * 0.78, w * 0.32, 12, 48]} />
        <meshPhysicalMaterial color="#1c2026" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

/** Two-blade propeller spinning about y. */
function Propeller({ part }: { part: PartSpec }) {
  const r = part.size[0] / 2;
  const [hub, b] = useMemo(() => [chamferedCylinder(r * 0.09, r * 0.12), blade(r * 0.95, r * 0.16, r * 0.02)], [r]);
  return (
    <group>
      <mesh geometry={hub} castShadow>
        <Mat part={part} />
      </mesh>
      {[0, Math.PI].map((rot) => (
        <mesh key={rot} geometry={b} rotation={[0, rot, 0]} castShadow>
          <Mat part={part} />
        </mesh>
      ))}
    </group>
  );
}

/** A standard hobby servo, horn on top (+y). */
function Servo() {
  return (
    <group>
      <RoundedBox args={[0.04, 0.036, 0.02]} radius={0.0015} position={[0, 0.018, 0]} castShadow>
        <meshPhysicalMaterial color="#1e3f8f" roughness={0.45} clearcoat={0.4} />
      </RoundedBox>
      <mesh position={[0, 0.027, 0]} castShadow>
        <boxGeometry args={[0.055, 0.0025, 0.02]} />
        <meshPhysicalMaterial color="#1e3f8f" roughness={0.45} />
      </mesh>
      <mesh position={[0.01, 0.038, 0]} castShadow>
        <cylinderGeometry args={[0.006, 0.006, 0.004, 32]} />
        <meshPhysicalMaterial color="#f2f2f2" roughness={0.4} />
      </mesh>
      <mesh position={[0.01, 0.0405, 0]} castShadow>
        <boxGeometry args={[0.03, 0.0018, 0.005]} />
        <meshPhysicalMaterial color="#f2f2f2" roughness={0.4} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// The tree: transforms, repeats, motion
// ---------------------------------------------------------------------------

type MotionRefs = Map<string, THREE.Group>;

function repeatTransforms(part: PartSpec): { position: [number, number, number]; rotation: [number, number, number] }[] {
  const n = part.repeat;
  const axis = part.repeatAxis === "x" ? 0 : part.repeatAxis === "y" ? 1 : 2;
  return Array.from({ length: n }, (_, k) => {
    const position: [number, number, number] = [0, 0, 0];
    const rotation: [number, number, number] = [0, 0, 0];
    if (part.repeatMode === "radial") rotation[axis] = (part.repeatStep ? part.repeatStep * DEG : (Math.PI * 2) / n) * k;
    else position[axis] = part.repeatStep * k;
    return { position, rotation };
  });
}

interface TreeCtx {
  kids: Map<string, PartSpec[]>;
  /** Motion groups (moved by the simulation) and transform groups (moved by the gizmo), by part id. */
  motion: MotionRefs;
  nodes: MotionRefs;
  labels: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

// While the gizmo is in use, clicks on empty space must not drop the selection.
let gizmoUntil = 0;
export const gizmoActive = () => performance.now() < gizmoUntil;

function PartNode({ part, ctx, depth }: { part: PartSpec; ctx: TreeCtx; depth: number }) {
  const children = ctx.kids.get(part.id) ?? [];
  const copies = repeatTransforms(part);
  const [x, y, z] = part.rotation;
  const on = ctx.selected === part.id;
  return (
    <group
      ref={(g) => {
        if (g) ctx.nodes.set(part.id, g);
        else ctx.nodes.delete(part.id);
      }}
      position={part.position as [number, number, number]}
      rotation={[x * DEG, y * DEG, z * DEG]}
    >
      {/* The motion group: the simulation turns or moves this, and everything attached follows. */}
      <group
        ref={(g) => {
          if (g) ctx.motion.set(part.id, g);
          else ctx.motion.delete(part.id);
        }}
      >
        <group
          onClick={(e) => {
            e.stopPropagation();
            ctx.onSelect(part.id);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => (document.body.style.cursor = "")}
        >
          {copies.map((t, k) => (
            <group key={k} position={t.position} rotation={t.rotation}>
              <PartShape part={part} />
            </group>
          ))}
        </group>
        {children.map((c) => (
          <PartNode key={c.id} part={c} ctx={ctx} depth={depth + 1} />
        ))}
        {(on || (ctx.labels && depth <= 1)) && (
          <Label
            text={on ? `${part.name} · ${dims(part)}` : part.name}
            position={[0, Math.max(part.size[1], 0.02) * 0.6 + 0.01, 0]}
            size={0.014}
            color={on ? "#2dd4ff" : "#eceef2"}
          />
        )}
      </group>
    </group>
  );
}

/** Engineering dimensions for the selection label, following each shape's size convention. */
function dims(p: PartSpec): string {
  const mm = (v: number) => (v >= 0.1 ? Math.round(v * 1000) : Math.round(v * 10000) / 10);
  const [a, b, c] = p.size;
  switch (p.shape) {
    case "cylinder":
    case "pulley":
    case "bearing":
    case "capsule":
    case "cone":
      return `Ø${mm(a)} × ${mm(b)} mm`;
    case "tube":
      return `Ø${mm(a)}/Ø${mm(c)} × ${mm(b)} mm`;
    case "sphere":
    case "propeller":
      return `Ø${mm(a)} mm`;
    case "gear":
      return `Ø${mm(a)} × ${mm(b)} mm, ${Math.round(c)} teeth`;
    case "wheel":
      return `Ø${mm(a)} × ${mm(b)} mm`;
    case "blade":
      return `${mm(a)} × ${mm(b)} mm`;
    case "servo":
    case "battery":
    case "controller_board":
    case "motor_driver":
    case "sensor":
      return p.spec || "library part";
    default:
      return `${mm(a)} × ${mm(b)} × ${mm(c)} mm`;
  }
}

/** A cyan box around the selected part (and everything attached to it), tracking it as it moves. */
function SelectionBox({ target }: { target: THREE.Object3D | undefined }) {
  const ref = useRef<THREE.Box3Helper>(null);
  const box = useMemo(() => new THREE.Box3(), []);
  useFrame(() => {
    const h = ref.current;
    if (!h) return;
    h.visible = !!target;
    if (target) {
      h.box.setFromObject(target);
      h.box.expandByScalar(Math.max(0.0015, h.box.getSize(new THREE.Vector3()).length() * 0.02));
    }
  });
  return <box3Helper ref={ref} args={[box, new THREE.Color("#2dd4ff")]} />;
}

export interface MachineRun {
  y: ArrayLike<number>;
  dt: number;
}

/** Applies each motion to its part's motion group from the simulated output at the clock time. */
function useMotions(assembly: Assembly, run: MachineRun, clock: React.RefObject<Clock>, refs: MotionRefs) {
  const integral = useMemo(() => integrate(run.y, run.dt), [run]);
  useFrame(() => {
    const t = clock.current.t;
    for (const m of assembly.motions) {
      const g = refs.get(m.part);
      if (!g) continue;
      apply(g, m, sample(run.y, run.dt, t), sample(integral, run.dt, t));
    }
  });
}

function apply(g: THREE.Group, m: MotionSpec, y: number, yInt: number) {
  const axis = m.kind === "lift" ? "y" : m.axis;
  switch (m.kind) {
    case "spin":
      g.rotation[axis] = m.gain * yInt;
      break;
    case "rotate":
      g.rotation[axis] = Math.max(-4 * Math.PI, Math.min(4 * Math.PI, m.gain * y));
      break;
    default:
      g.position[axis] = Math.max(-25, Math.min(25, m.gain * y));
  }
}

/** Sits the machine on the floor and frames the camera around it, once per design. */
function useGroundAndFrame(root: React.RefObject<THREE.Group | null>, key: string) {
  const get = useThree((s) => s.get);
  // Re-frame once the orbit controls exist (they mount after the scene).
  const hasControls = useThree((s) => !!s.controls);
  useLayoutEffect(() => {
    const g = root.current;
    if (!g) return;
    const { camera } = get();
    const controls = get().controls as OrbitControlsImpl | null;
    g.position.set(0, 0, 0);
    g.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(g);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    g.position.set(-c.x, -box.min.y, -c.z);
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z, 0.05);
    const target = new THREE.Vector3(0, size.y * 0.45, 0);
    const dir = new THREE.Vector3(0.9, 0.55, 1.25).normalize();
    camera.position.copy(target.clone().add(dir.multiplyScalar(r * 1.9)));
    camera.near = r / 200;
    camera.far = r * 60;
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(target);
      controls.maxDistance = r * 8;
      controls.minDistance = r * 0.15;
      controls.update();
    }
  }, [root, key, get, hasControls]);
}

export type GizmoMode = "translate" | "rotate";

export default function MachineRig({
  assembly,
  run,
  clock,
  labels,
  selected,
  onSelect,
  gizmo,
  onTransform,
}: {
  assembly: Assembly;
  run: MachineRun;
  clock: React.RefObject<Clock>;
  labels: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  gizmo: GizmoMode;
  /** The gizmo moved a part: its new position (m) and rotation (deg), relative to its parent. */
  onTransform: (id: string, position: [number, number, number], rotation: [number, number, number]) => void;
}) {
  const kids = useMemo(() => childrenOf(assembly), [assembly]);
  const motion = useMemo<MotionRefs>(() => new Map(), []);
  const nodes = useMemo<MotionRefs>(() => new Map(), []);
  const root = useRef<THREE.Group>(null);
  useMotions(assembly, run, clock, motion);
  // Reframe only for a new design, not for every edit.
  useGroundAndFrame(root, assembly.title);
  const ctx: TreeCtx = { kids, motion, nodes, labels, selected, onSelect };
  // Look the selected node up after render, when its group exists.
  const [target, setTarget] = useState<THREE.Group | undefined>(undefined);
  // The selected part's group only exists after commit, so it can't be read during render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useLayoutEffect(() => setTarget(selected ? nodes.get(selected) : undefined), [selected, nodes, assembly]);
  return (
    <>
      {/* Studio reflections: what makes metal and gloss read as real. Built locally, no downloads. */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={3} position={[0, 4, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[6, 6, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[-4, 1.5, 1]} rotation={[0, Math.PI / 2, 0]} scale={[4, 2, 1]} color="#cfe0ff" />
        <Lightformer form="rect" intensity={1.2} position={[4, 1, -1]} rotation={[0, -Math.PI / 2, 0]} scale={[4, 2, 1]} color="#ffe6d0" />
        <Lightformer form="ring" intensity={0.8} position={[0, 1, 4]} scale={2} color="#9b5cff" />
      </Environment>
      <group ref={root}>
        {(kids.get("") ?? []).map((p) => (
          <PartNode key={p.id} part={p} ctx={ctx} depth={0} />
        ))}
      </group>
      <SelectionBox target={target} />
      {target && selected && (
        <TransformControls
          object={target}
          mode={gizmo}
          size={0.7}
          onMouseDown={() => (gizmoUntil = Infinity)}
          onMouseUp={() => {
            gizmoUntil = performance.now() + 300;
            const r = target.rotation;
            const p = target.position;
            const round = (v: number, k: number) => Math.round(v * k) / k;
            onTransform(selected, [round(p.x, 1e5), round(p.y, 1e5), round(p.z, 1e5)], [round(r.x / DEG, 100), round(r.y / DEG, 100), round(r.z / DEG, 100)]);
          }}
        />
      )}
    </>
  );
}
