"use client";

import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import MachineRig from "@/components/lab/hw3d/machine";
import type { Clock } from "@/components/lab/hw3d/rigs";
import { simulateMachine } from "@/lib/lab/actuation";
import { sanitizeAssembly, type AiAssembly } from "@/lib/lab/assembly";

// A test fixture in exactly the format Muse Spark returns: a waving robot built only from catalogue
// parts and fabricated parts.
type Raw = AiAssembly["parts"][number];
const P = (p: Partial<Raw> & Pick<Raw, "id" | "ref">): Raw => ({
  name: p.id,
  parent: "",
  size: [0, 0, 0],
  material: "",
  color: "",
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  repeat: 1,
  repeatMode: "radial",
  repeatAxis: "y",
  repeatStep: 0,
  ...p,
});

const FIXTURE: AiAssembly = {
  title: "Waving robot (test fixture)",
  parts: [
    P({ id: "base", name: "Base plate", ref: "fab:plate", size: [0.22, 0.003, 0.2], material: "acrylic" }),
    P({ id: "body", name: "Body shell", ref: "fab:printed", parent: "base", size: [0.09, 0.12, 0.07], material: "pla", color: "#e9edf2", position: [0, 0.003, 0] }),
    P({ id: "head", name: "Head shell", ref: "fab:printed", parent: "body", size: [0.07, 0.055, 0.06], material: "petg", color: "#2d6cdf", position: [0, 0.12, 0] }),
    P({ id: "eyes", name: "Eyes (ultrasonic)", ref: "hc-sr04", parent: "head", position: [0, 0.028, 0.032] }),
    P({ id: "shoulder", name: "Shoulder servo", ref: "mg996r", parent: "body", position: [0.065, 0.118, 0] }),
    P({ id: "horn", name: "Shoulder horn", ref: "horn-metal-25t", parent: "shoulder" }),
    P({ id: "arm", name: "Arm", ref: "fab:printed", parent: "horn", size: [0.11, 0.008, 0.02], material: "pla", color: "#ff7a1a", position: [0.05, 0.004, 0] }),
    P({ id: "uno", name: "Controller", ref: "arduino-uno", parent: "base", position: [0, 0.003, 0.07] }),
    P({ id: "pwm", name: "Servo driver", ref: "pca9685", parent: "base", position: [-0.075, 0.003, 0] }),
    P({ id: "battery", name: "Battery", ref: "batt-18650x2", parent: "base", position: [0, 0.003, -0.07] }),
    P({ id: "ubec", name: "5 V UBEC", ref: "ubec-5a", parent: "base", position: [0.08, 0.003, -0.04] }),
    P({ id: "feet", name: "Standoff feet", ref: "standoff-m3-20", parent: "", position: [-0.1, -0.02, -0.09], repeat: 2, repeatMode: "linear", repeatAxis: "x", repeatStep: 0.2 }),
  ],
  joints: [{ id: "wave", part: "horn", actuator: "shoulder", kind: "rotate", axis: "y", min: -60, max: 60, loadG: 40, leverMm: 60 }],
  program: [
    { label: "Wave out", duration: 0.6, targets: [{ joint: "wave", value: 50 }] },
    { label: "Wave in", duration: 0.6, targets: [{ joint: "wave", value: -30 }] },
    { label: "Wave out", duration: 0.6, targets: [{ joint: "wave", value: 50 }] },
    { label: "Wave in", duration: 0.6, targets: [{ joint: "wave", value: -30 }] },
    { label: "Rest", duration: 0.6, targets: [{ joint: "wave", value: 0 }] },
  ],
};

function Tick({ onTick }: { onTick: (delta: number) => void }) {
  useFrame((_, d) => onTick(d));
  return null;
}

export default function MachinePreview() {
  const assembly = useMemo(() => sanitizeAssembly(FIXTURE), []);
  const sim = useMemo(() => simulateMachine(assembly), [assembly]);
  const clock = useRef<Clock>({ t: 0, playing: true, rate: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="relative h-dvh w-full bg-[#06080b]">
      <Canvas shadows camera={{ position: [0.5, 0.4, 0.6], fov: 38 }} onPointerMissed={() => setSelected(null)}>
        <color attach="background" args={["#06080b"]} />
        <hemisphereLight args={["#bcd3ff", "#0b0f14", 0.65]} />
        <directionalLight position={[1.2, 2, 1]} intensity={1.7} castShadow shadow-mapSize={[1024, 1024]} />
        <Grid infiniteGrid cellSize={0.05} sectionSize={0.25} cellColor="#16222f" sectionColor="#1f4257" fadeDistance={4} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <shadowMaterial opacity={0.35} />
        </mesh>
        <Tick
          onTick={(d) => {
            clock.current.t = (clock.current.t + d) % sim.tEnd;
          }}
        />
        <MachineRig assembly={assembly} sim={sim} clock={clock} labels={false} selected={selected} onSelect={setSelected} gizmo="translate" onTransform={() => {}} />
        <OrbitControls makeDefault />
      </Canvas>
      <pre id="sim-report" className="absolute top-2 left-2 max-w-md font-mono text-[10px] whitespace-pre-wrap text-mute">
        {sim.checks.map((c) => `${c.level.toUpperCase()} ${c.title}`).join("\n")}
      </pre>
    </div>
  );
}
