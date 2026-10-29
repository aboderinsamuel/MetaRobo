"use client";

// Renders a machine Muse Spark composed from real parts (lib/lab/assembly.ts): every part is a
// catalogue part's model, a fabricated part, or an arm kit, and every joint moves with the
// per-actuator simulation (lib/lab/actuation.ts). Click to select; the gizmo moves the selection.
import { Environment, Lightformer, TransformControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { at, type MachineSim } from "@/lib/lab/actuation";
import { armSpec, catalogOf, childrenOf, type Assembly, type PartSpec } from "@/lib/lab/assembly";
import { CatalogMesh, FabMesh } from "./catalogMeshes";
import { Label } from "./parts3d";
import RobotArm from "./robotArm";
import type { LiveFn, PartLive } from "./liveMeshes";
import { Wires, useBuzzerAudio } from "./wiring";
import { behaviourIndex, textAt } from "@/lib/lab/behaviour";
import type { Clock } from "./rigs";

const DEG = Math.PI / 180;

type Refs = Map<string, THREE.Group>;

const isArmKit = (p: PartSpec) => p.model === "arm_kit";

function PartBody({ part, stroke, held, live }: { part: PartSpec; stroke: () => number; held?: React.ReactNode; live?: LiveFn }) {
  if (part.kind === "catalog" && isArmKit(part)) return <RobotArm part={part} stroke={stroke} held={held} />;
  if (part.kind === "catalog") {
    const c = catalogOf(part);
    return c ? <CatalogMesh part={c} color={part.color || undefined} live={live} /> : null;
  }
  if (part.kind === "fab" && part.fab) return <FabMesh kind={part.fab} size={part.size} material={part.material} color={part.color || undefined} />;
  // Not in the catalogue yet: a plain module, outlined in amber so it stands out.
  return (
    <mesh position={[0, 0.005, 0]}>
      <boxGeometry args={[0.03, 0.01, 0.03]} />
      <meshStandardMaterial color="#ffb020" wireframe />
    </mesh>
  );
}

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
  motion: Refs;
  nodes: Refs;
  /** Stroke of each arm kit, set every frame from the simulation. */
  strokes: Map<string, number>;
  /** What each part is doing right now in the behaviour simulation (lit, running, wet, text). */
  live: (id: string) => PartLive | undefined;
  labels: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

// While the gizmo is in use, clicks on empty space must not drop the selection.
let gizmoUntil = 0;
export const gizmoActive = () => performance.now() < gizmoUntil;

function dims(p: PartSpec): string {
  if (isArmKit(p)) {
    const s = armSpec(p);
    return `${s.dof}-DOF · reach ${Math.round(s.reach * 1000)} mm · ${s.effector}`;
  }
  return p.spec;
}

function PartNode({ part, ctx, depth, anchored = false }: { part: PartSpec; ctx: TreeCtx; depth: number; anchored?: boolean }) {
  const children = ctx.kids.get(part.id) ?? [];
  const copies = repeatTransforms(part);
  const [x, y, z] = part.rotation;
  const on = ctx.selected === part.id;
  // An arm kit carries what's attached to it in its gripper.
  const held = isArmKit(part) ? children.map((c) => <PartNode key={c.id} part={c} ctx={ctx} depth={depth + 1} anchored />) : null;
  return (
    <group
      ref={(g) => {
        if (g) ctx.nodes.set(part.id, g);
        else ctx.nodes.delete(part.id);
      }}
      position={anchored ? [0, 0, 0] : part.position}
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
              <PartBody part={part} stroke={() => ctx.strokes.get(part.id) ?? 0} held={k === 0 ? held : undefined} live={() => ctx.live(part.id)} />
            </group>
          ))}
        </group>
        {!isArmKit(part) && children.map((c) => <PartNode key={c.id} part={c} ctx={ctx} depth={depth + 1} />)}
        {(on || (ctx.labels && depth <= 1)) && (
          <Label
            text={on ? `${part.name} · ${dims(part)}` : part.name}
            position={[0, Math.max(part.size[1], 0.02) * (isArmKit(part) ? 1.1 : 0.6) + 0.01, 0]}
            size={0.014}
            color={on ? "#2dd4ff" : part.kind === "need" ? "#ffb020" : "#eceef2"}
          />
        )}
      </group>
    </group>
  );
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

/** Drives every joint's part from its simulated actuator at the clock time. */
function useJoints(assembly: Assembly, sim: MachineSim | null, clock: React.RefObject<Clock>, motion: Refs, strokes: Map<string, number>) {
  const kits = useMemo(() => new Set(assembly.parts.filter(isArmKit).map((p) => p.id)), [assembly.parts]);
  useFrame(() => {
    if (!sim) return;
    const t = clock.current.t;
    for (const tr of sim.traces) {
      const j = tr.joint;
      if (j.kind === "articulate" && kits.has(j.part)) {
        strokes.set(j.part, at(tr.value, t));
        continue;
      }
      const g = motion.get(j.part);
      if (!g) continue;
      const v = at(j.kind === "spin" ? tr.angle : tr.value, t);
      switch (j.kind) {
        case "spin":
        case "rotate":
          g.rotation[j.axis] = v * DEG;
          break;
        case "articulate":
          g.rotation[j.axis] = v * 90 * DEG;
          break;
        case "lift":
          g.position.y = v / 1000;
          break;
        default:
          g.position[j.axis] = v / 1000;
      }
    }
  });
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
  sim,
  clock,
  labels,
  selected,
  onSelect,
  gizmo,
  onTransform,
  sound = true,
}: {
  assembly: Assembly;
  sim: MachineSim | null;
  /** Play the buzzer through the speakers. */
  sound?: boolean;
  clock: React.RefObject<Clock>;
  labels: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  gizmo: GizmoMode;
  /** The gizmo moved a part: its new position (m) and rotation (deg), relative to its parent. */
  onTransform: (id: string, position: [number, number, number], rotation: [number, number, number]) => void;
}) {
  const kids = useMemo(() => childrenOf(assembly), [assembly]);
  const motion = useMemo<Refs>(() => new Map(), []);
  const nodes = useMemo<Refs>(() => new Map(), []);
  const strokes = useMemo(() => new Map<string, number>(), []);
  const root = useRef<THREE.Group>(null);
  useJoints(assembly, sim, clock, motion, strokes);
  // Reframe only for a new design, not for every edit.
  useGroundAndFrame(root, assembly.title);
  const live = useCallback(
    (id: string): PartLive | undefined => {
      const b = sim?.behaviour;
      if (!b) return undefined;
      const k = behaviourIndex(b, clock.current.t);
      const sig = b.signals.find((x) => x.shows === id);
      const fill = b.fill.get(id);
      return {
        on: b.on.get(id)?.[k],
        level: fill ? fill[k] : sig ? (sig.value[k] - sig.min) / Math.max(1e-6, sig.max - sig.min) : undefined,
        text: textAt(b, id, k),
      };
    },
    [sim, clock],
  );
  useBuzzerAudio(assembly, sim?.behaviour ?? null, clock, sound);
  const ctx: TreeCtx = { kids, motion, nodes, strokes, labels, selected, onSelect, live };
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
        {/* Soft panels all round the horizon, so vertical metal faces reflect light from every view. */}
        {[0, 1, 2, 3, 4, 5].map((k) => {
          const a = (k / 6) * Math.PI * 2;
          return <Lightformer key={k} form="rect" intensity={0.9} position={[Math.cos(a) * 5, 0.6, Math.sin(a) * 5]} rotation={[0, -a + Math.PI / 2, 0]} scale={[5, 1.6, 1]} color="#dfe8f5" />;
        })}
      </Environment>
      <group ref={root}>
        {(kids.get("") ?? []).map((p) => (
          <PartNode key={p.id} part={p} ctx={ctx} depth={0} />
        ))}
      </group>
      <Wires assembly={assembly} nodes={nodes} behaviour={sim?.behaviour ?? null} clock={clock} />
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
