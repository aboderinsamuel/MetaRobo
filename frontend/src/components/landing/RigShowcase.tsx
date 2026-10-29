"use client";

// A demo robot in 3D for its landing card: built from the same real parts and the same simulated
// motion as in the Control Lab (the arm lifts, the balancer settles, the drone climbs), turning
// slowly on a soft studio stage. Each card's canvas mounts only while it's on screen and pauses
// off-screen, and nothing moves for people who prefer reduced motion.
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { run } from "@/lib/lab/analysis";
import { applyHints, defaultBuild, deriveHardware, telemetry } from "@/lib/lab/hardware/build";
import type { SlotId } from "@/lib/lab/hardware/parts";
import { displayScale, rigFor, tiltFromPosition } from "@/lib/lab/rig";
import type { RigKind } from "@/lib/lab/types";
import { useEngine } from "@/lib/sim/useEngine";
import { useTheme } from "@/lib/theme";
import { Scene, type SceneCtx } from "../lab/hw3d/parts3d";
import { ArmRig, BalancerRig, DroneRig, RoverRig, rigCamera, type Clock, type Motion } from "../lab/hw3d/rigs";

function Turntable({ target, still, children }: { target: [number, number, number]; still: boolean; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (g.current && !still) g.current.rotation.y += dt * 0.28;
  });
  // Spin about the machine's own centre, not the world origin.
  return (
    <group position={target}>
      <group ref={g} rotation={[0, -0.5, 0]}>
        <group position={[-target[0], -target[1], -target[2]]}>{children}</group>
      </group>
    </group>
  );
}

function Frame({ pos, target }: { pos: [number, number, number]; target: [number, number, number] }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(...pos);
    camera.lookAt(...target);
  }, [camera, pos, target]);
  return null;
}

function Rig({ kind, prompt, still }: { kind: RigKind; prompt: string; still: boolean }) {
  const engine = useEngine();
  const data = useMemo(() => {
    const hw = deriveHardware(applyHints(defaultBuild(kind), prompt));
    const model = hw.model;
    const r = run(engine, model, model.controller);
    const rig = rigFor(model);
    const scale = displayScale(model, rig);
    const y = Float64Array.from(r.sim.y, (v) => v * scale);
    const tEnd = y.length * r.sim.dt;
    const base = { dt: r.sim.dt, tEnd, u: r.sim.u, target: model.sim.ref * scale, distTime: tEnd + 1, targets: [model.sim.ref * scale], events: [] };
    // The rover holds its place on the stage (it would drive out of the card); the rest move as simulated.
    const m: Motion =
      kind === "rover"
        ? { ...base, main: new Float64Array(y.length), speed: new Float64Array(y.length) }
        : kind === "balancer"
          ? { ...base, main: y, tilt: tiltFromPosition(y, r.sim.dt) }
          : kind === "drone"
            ? // Hovers just above its pad so it stays in the card (the real climb is metres).
              { ...base, main: new Float64Array(y.length).fill(0.12) }
            : { ...base, main: y };
    // Frame the robot itself, closer than the lab does (no track, targets or ramp to fit in).
    const c = rigCamera(hw);
    const target: [number, number, number] = kind === "rover" ? [0, c.target[1], 0] : kind === "drone" ? [0, c.target[1] + 0.06, 0] : c.target;
    const k = { rover: 0.82, arm: 0.92, balancer: 0.7, drone: 0.85 }[kind];
    const pos = c.pos.map((v, i) => target[i] + (v - c.target[i]) * k) as [number, number, number];
    return { hw, m, tel: telemetry(hw, r.sim.y, r.sim.u, r.sim.dt), cam: { pos, target } };
  }, [engine, kind, prompt]);
  const clock = useRef<Clock>({ t: kind === "rover" ? 0 : 0.4, playing: true, rate: 1 });
  useFrame((_, dt) => {
    if (still) return;
    // Play the motion, rest a moment at the end, then go again.
    clock.current.t = (clock.current.t + dt) % (data.m.tEnd + 1.2);
  });
  const load = useRef<Partial<Record<SlotId, number>>>({});
  const ctx: SceneCtx = useMemo(() => ({ selected: null, status: {}, onSelect: () => {}, labels: false, load, showcase: true }), []);
  const props = { hw: data.hw, m: data.m, clock, tel: data.tel };
  return (
    <Scene.Provider value={ctx}>
      <Frame pos={data.cam.pos} target={data.cam.target} />
      <Turntable target={data.cam.target} still={still}>
        {kind === "rover" && <RoverRig {...props} />}
        {kind === "arm" && <ArmRig {...props} />}
        {kind === "balancer" && <BalancerRig {...props} />}
        {kind === "drone" && <DroneRig {...props} />}
      </Turntable>
    </Scene.Provider>
  );
}

export default function RigShowcase({ kind, prompt }: { kind: RigKind; prompt: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [still] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const light = useTheme() === "light";
  // Mount when first near the viewport; only render frames while it's visible.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setVisible(e.isIntersecting);
        if (e.isIntersecting) setMounted(true);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={host} className="relative h-full w-full">
      {mounted && (
        <Canvas shadows dpr={[1, 1.75]} frameloop={visible && !still ? "always" : "demand"} gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: light ? 0.95 : 1.05 }} camera={{ fov: 32, near: 0.005, far: 40 }}>
          <hemisphereLight args={[light ? "#f4f4f6" : "#d6dcff", light ? "#b9bcc2" : "#121212", light ? 0.85 : 0.6]} />
          <directionalLight position={[1.2, 2.2, 1.4]} intensity={light ? 1.9 : 1.7} castShadow shadow-mapSize={[1024, 1024]} />
          <directionalLight position={[-1.4, 0.9, -1]} intensity={0.5} color="#8b7fff" />
          <Environment resolution={128} frames={1}>
            <Lightformer form="rect" intensity={2.2} position={[0, 4, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[6, 6, 1]} />
            <Lightformer form="rect" intensity={1.2} position={[-4, 1.5, 1]} rotation={[0, Math.PI / 2, 0]} scale={[4, 2, 1]} color="#dbe6ff" />
            <Lightformer form="rect" intensity={1} position={[4, 1, -1]} rotation={[0, -Math.PI / 2, 0]} scale={[4, 2, 1]} color="#ffe9dc" />
          </Environment>
          <ContactShadows position={[0, 0.0005, 0]} opacity={light ? 0.35 : 0.55} scale={1.6} blur={2.4} far={0.8} frames={still ? 1 : Infinity} />
          <Rig kind={kind} prompt={prompt} still={still} />
        </Canvas>
      )}
    </div>
  );
}
