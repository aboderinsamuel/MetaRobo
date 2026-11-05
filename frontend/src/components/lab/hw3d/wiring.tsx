"use client";

// Wires and tubes between the parts of an AI-designed machine, drawn like a real build: colour-coded
// leads that curve between the parts and follow them as they move, translucent silicone tubing with
// water droplets travelling through it while the pump runs, and pulses along the power leads of
// whatever is switched on. Also plays the buzzer through the speakers while it's on.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { behaviourIndex, type BehaviourSim } from "@/lib/lab/behaviour";
import type { Assembly, Connection, WireKind } from "@/lib/lab/assembly";
import type { Clock } from "./rigs";

const COLORS: Record<WireKind, string> = {
  power: "#e5383b",
  ground: "#24272d",
  signal: "#f4c430",
  data: "#3a86ff",
  motor: "#ff8c42",
  tube: "#e8f6ff",
};

type Refs = Map<string, THREE.Group>;

/** Where a wire attaches on a part: just above its origin, scaled to the part's size; containers
 * (pots, reservoirs) take their tubes over the rim. */
function anchor(g: THREE.Group | undefined, height: number, out: THREE.Vector3, rim = false): boolean {
  if (!g) return false;
  g.getWorldPosition(out);
  out.y += rim ? height * 1.02 : Math.max(0.004, height * 0.6);
  return true;
}

/** Tubing climbs out over the rim of the container it sits in (a pump in a reservoir), arcs across,
 * and drops in over the rim of the one it feeds. */
function tubeRoute(a: THREE.Vector3, b: THREE.Vector3, exitY: number, entryY: number): THREE.CatmullRomCurve3 {
  const top = Math.max(exitY, entryY) + 0.02;
  const a1 = new THREE.Vector3(a.x, Math.max(exitY + 0.012, a.y), a.z);
  const b1 = new THREE.Vector3(b.x, Math.max(entryY + 0.012, b.y), b.z);
  const mid = a1.clone().lerp(b1, 0.5);
  mid.y = top + a.distanceTo(b) * 0.08;
  return new THREE.CatmullRomCurve3([a, a1, mid, b1, b], false, "centripetal");
}

function curveBetween(a: THREE.Vector3, b: THREE.Vector3, k: number): THREE.QuadraticBezierCurve3 {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  // Wires sag slightly sideways and arc up so they don't cut through the parts.
  mid.y += a.distanceTo(b) * 0.25 + 0.01;
  mid.x += Math.sin(k * 1.7) * 0.006;
  mid.z += Math.cos(k * 1.3) * 0.006;
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

function WireMesh({ c, index, nodes, heights, containers, inside, behaviour, clock }: { c: Connection; index: number; nodes: Refs; heights: Map<string, number>; containers: Set<string>; inside: Map<string, string>; behaviour: BehaviourSim | null; clock: React.RefObject<Clock> }) {
  const mesh = useRef<THREE.Mesh>(null);
  const drops = useRef<THREE.InstancedMesh>(null);
  const curve = useRef<THREE.Curve<THREE.Vector3> | null>(null);
  const last = useRef({ a: new THREE.Vector3(1e9, 0, 0), b: new THREE.Vector3(), t: 0 });
  const tube = c.kind === "tube";
  const radius = tube ? 0.0042 : 0.0009;
  const mat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: COLORS[c.kind],
        roughness: tube ? 0.15 : 0.45,
        transparent: tube,
        opacity: tube ? 0.7 : 1,
        clearcoat: tube ? 1 : 0.3,
      }),
    [c.kind, tube],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const DROPS = tube ? 8 : 3;
  // What makes this connection "live": a tube while its pump runs, a power/motor lead to a part that's on.
  const liveId = tube ? index : null;
  const powered = !tube && (c.kind === "power" || c.kind === "motor") ? c.to : null;

  useEffect(() => () => mat.dispose(), [mat]);

  /** World height of the rim a tube end has to clear: its own container's, or the one it sits in. */
  const rimY = (id: string, fallback: number) => {
    const box = containers.has(id) ? id : inside.get(id);
    const g = box ? nodes.get(box) : undefined;
    if (!box || !g) return fallback;
    return g.getWorldPosition(new THREE.Vector3()).y + (heights.get(box) ?? 0);
  };

  useFrame(({ clock: three }) => {
    const m = mesh.current;
    if (!m) return;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    if (!anchor(nodes.get(c.from), heights.get(c.from) ?? 0, a, tube && containers.has(c.from)) || !anchor(nodes.get(c.to), heights.get(c.to) ?? 0, b, tube && containers.has(c.to))) {
      m.visible = false;
      return;
    }
    m.visible = true;
    // Rebuild the geometry only when an end has moved (parts move with joints and edits).
    if (a.distanceToSquared(last.current.a) > 1e-8 || b.distanceToSquared(last.current.b) > 1e-8) {
      last.current.a.copy(a);
      last.current.b.copy(b);
      curve.current = tube ? tubeRoute(a, b, rimY(c.from, a.y), rimY(c.to, b.y)) : curveBetween(a, b, index);
      m.geometry.dispose();
      m.geometry = new THREE.TubeGeometry(curve.current, 24, radius, tube ? 10 : 6, false);
    }
    // Droplets / power pulses.
    const d = drops.current;
    if (!d || !curve.current) return;
    let live = false;
    if (behaviour) {
      const k = behaviourIndex(behaviour, clock.current.t);
      if (liveId !== null) live = (behaviour.flowing.get(liveId)?.[k] ?? 0) > 0;
      else if (powered) live = (behaviour.on.get(powered)?.[k] ?? 0) > 0;
    }
    // A running pump fills its tube with water.
    if (tube) {
      mat.color.set(live ? "#5fb4ff" : COLORS.tube);
      mat.emissive.set(live ? "#0a3a7a" : "#000000");
    }
    d.visible = live && clock.current.playing;
    if (!d.visible) return;
    const speed = tube ? 0.6 : 1.2;
    for (let i = 0; i < DROPS; i++) {
      const u = (three.elapsedTime * speed + i / DROPS) % 1;
      dummy.position.copy(curve.current.getPoint(u));
      dummy.scale.setScalar(tube ? 1 : 0.8);
      dummy.updateMatrix();
      d.setMatrixAt(i, dummy.matrix);
    }
    d.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <mesh ref={mesh} material={mat} castShadow>
        <bufferGeometry />
      </mesh>
      <instancedMesh ref={drops} args={[undefined, undefined, DROPS]} visible={false}>
        <sphereGeometry args={[tube ? radius * 1.05 : radius * 1.8, 10, 8]} />
        <meshBasicMaterial color={tube ? "#2b8cff" : COLORS[c.kind]} toneMapped={false} transparent opacity={tube ? 0.9 : 0.85} />
      </instancedMesh>
    </>
  );
}

export function Wires({ assembly, nodes, behaviour, clock, hidden }: { assembly: Assembly; nodes: Refs; behaviour: BehaviourSim | null; clock: React.RefObject<Clock>; hidden?: Set<string> }) {
  const heights = useMemo(() => new Map(assembly.parts.map((p) => [p.id, p.size[1]])), [assembly.parts]);
  const containers = useMemo(() => new Set(assembly.parts.filter((p) => p.model === "pot_plant" || p.model === "reservoir").map((p) => p.id)), [assembly.parts]);
  const inside = useMemo(() => new Map(assembly.parts.filter((p) => p.parent && containers.has(p.parent)).map((p) => [p.id, p.parent!])), [assembly.parts, containers]);
  return (
    <group>
      {assembly.connections.map((c, i) =>
        hidden?.has(c.from) || hidden?.has(c.to) ? null : (
        <WireMesh key={`${c.from}.${c.fromPin}-${c.to}.${c.toPin}-${i}`} c={c} index={i} nodes={nodes} heights={heights} containers={containers} inside={inside} behaviour={behaviour} clock={clock} />
        ),
      )}
    </group>
  );
}

/** Plays a 2.3 kHz beep (an active piezo buzzer's tone) while any buzzer is on during playback. */
export function useBuzzerAudio(assembly: Assembly, behaviour: BehaviourSim | null, clock: React.RefObject<Clock>, enabled: boolean) {
  const buzzers = useMemo(() => assembly.parts.filter((p) => p.model === "buzzer").map((p) => p.id), [assembly.parts]);
  const audio = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  useEffect(
    () => () => {
      audio.current?.ctx.close().catch(() => {});
      audio.current = null;
    },
    [],
  );
  useFrame(() => {
    if (!behaviour || !buzzers.length) return;
    const k = behaviourIndex(behaviour, clock.current.t);
    const want = enabled && clock.current.playing && buzzers.some((id) => (behaviour.on.get(id)?.[k] ?? 0) > 0);
    if (want && !audio.current && typeof window !== "undefined") {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.value = 2300;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        audio.current = { ctx, gain };
      } catch {
        return;
      }
    }
    const a = audio.current;
    if (a) a.gain.gain.setTargetAtTime(want ? 0.035 : 0, a.ctx.currentTime, 0.01);
  });
}
