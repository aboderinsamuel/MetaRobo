"use client";

import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import MachineRig from "@/components/lab/hw3d/machine";
import type { Clock } from "@/components/lab/hw3d/rigs";
import { simulateMachine } from "@/lib/lab/actuation";
import { behaviourIndex } from "@/lib/lab/behaviour";
import { sanitizeAssembly, type AiAssembly, type AssemblyInput } from "@/lib/lab/assembly";

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

const FIXTURE: AssemblyInput = {
  title: "Waving robot (test fixture)",
  parts: [
    P({ id: "base", name: "Base plate", ref: "fab:plate", size: [0.22, 0.003, 0.2], material: "acrylic" }),
    P({ id: "body", name: "Body shell", ref: "fab:printed", parent: "base", size: [0.09, 0.12, 0.07], material: "pla", color: "#e9edf2", position: [0, 0.003, 0] }),
    P({ id: "head", name: "Head shell", ref: "fab:printed", parent: "body", size: [0.07, 0.055, 0.06], material: "petg", color: "#2d6cdf", position: [0, 0.12, 0] }),
    P({ id: "eyes", name: "Eyes (ultrasonic)", ref: "hc-sr04", parent: "head", position: [0, 0.028, 0.032] }),
    // The arm, built like a real servo kit: servo → horn → bracket → servo → horn → bracket → claw.
    P({ id: "shoulder", name: "Shoulder servo", ref: "mg996r", parent: "body", position: [0.049, 0.1, 0], rotation: [0, 0, -90] }),
    P({ id: "shoulder_horn", name: "Shoulder horn", ref: "horn-metal-25t", parent: "shoulder" }),
    P({ id: "upper_arm", name: "Upper arm bracket", ref: "bracket-multi-servo", parent: "shoulder_horn", position: [0, 0.004, 0], rotation: [0, 0, 90] }),
    P({ id: "elbow", name: "Elbow servo", ref: "mg996r", parent: "upper_arm", position: [0, 0.045, 0], rotation: [0, 0, -90] }),
    P({ id: "elbow_horn", name: "Elbow horn", ref: "horn-metal-25t", parent: "elbow" }),
    P({ id: "forearm", name: "Forearm bracket", ref: "bracket-u-servo", parent: "elbow_horn", position: [0, 0.004, 0], rotation: [0, 0, 90] }),
    P({ id: "hand", name: "Gripper claw", ref: "gripper-claw-mg996", parent: "forearm", position: [0, 0.045, 0], rotation: [0, 0, 90] }),
    P({ id: "uno", name: "Controller", ref: "arduino-uno", parent: "base", position: [0, 0.003, 0.07] }),
    P({ id: "pwm", name: "Servo driver", ref: "pca9685", parent: "base", position: [-0.075, 0.003, 0] }),
    P({ id: "battery", name: "Battery", ref: "batt-18650x2", parent: "base", position: [0, 0.003, -0.07] }),
    P({ id: "ubec", name: "5 V UBEC", ref: "ubec-5a", parent: "base", position: [0.08, 0.003, -0.04] }),
    P({ id: "feet", name: "Standoff feet", ref: "standoff-m3-20", parent: "", position: [-0.1, -0.02, -0.09], repeat: 2, repeatMode: "linear", repeatAxis: "x", repeatStep: 0.2 }),
  ],
  joints: [
    // Shoulder carries the elbow servo, both brackets, horns and the claw: ~200 g at ~70 mm.
    { id: "shoulder", part: "shoulder_horn", actuator: "shoulder", kind: "rotate", axis: "y", min: -60, max: 120, loadG: 200, leverMm: 70 },
    // Elbow carries the forearm bracket and claw: ~135 g at ~45 mm.
    { id: "elbow", part: "elbow_horn", actuator: "elbow", kind: "rotate", axis: "y", min: -90, max: 90, loadG: 135, leverMm: 45 },
  ],
  program: [
    { label: "Raise arm", duration: 0.9, targets: [{ joint: "shoulder", value: 100 }, { joint: "elbow", value: 0 }] },
    { label: "Wave", duration: 0.4, targets: [{ joint: "elbow", value: 40 }] },
    { label: "Wave", duration: 0.4, targets: [{ joint: "elbow", value: -40 }] },
    { label: "Wave", duration: 0.4, targets: [{ joint: "elbow", value: 40 }] },
    { label: "Wave", duration: 0.4, targets: [{ joint: "elbow", value: -40 }] },
    { label: "Lower arm", duration: 0.9, targets: [{ joint: "shoulder", value: 0 }, { joint: "elbow", value: 0 }] },
  ],
};

function Tick({ onTick }: { onTick: (delta: number) => void }) {
  useFrame((_, d) => onTick(d));
  return null;
}

// The plant waterer from the user's prompt: pot + soil probe, reservoir + pump, tube, controller,
// relay, buzzer and LCD on a base, all wired, with the controller's watering rule.
const PLANT: AssemblyInput = {
  title: "Smart plant waterer (test fixture)",
  parts: [
    P({ id: "base", name: "Base plate", ref: "fab:plate", size: [0.17, 0.003, 0.13], material: "acrylic", position: [0.12, 0, 0] }),
    P({ id: "uno", name: "Controller", ref: "arduino-uno", parent: "base", position: [-0.04, 0.003, 0.02] }),
    P({ id: "relay", name: "Pump relay", ref: "relay-1ch", parent: "base", position: [0.045, 0.003, 0.035] }),
    P({ id: "lcd", name: "Display", ref: "lcd1602-i2c", parent: "base", position: [0.03, 0.003, -0.035] }),
    P({ id: "buzzer", name: "Buzzer", ref: "buzzer-active", parent: "base", position: [-0.065, 0.003, -0.045] }),
    P({ id: "power", name: "USB supply", ref: "usb-5v-2a", position: [0.24, 0, 0.02] }),
    P({ id: "pot", name: "Plant pot", ref: "pot-12cm", position: [-0.04, 0, 0] }),
    P({ id: "probe", name: "Soil probe", ref: "soil-cap-v12", parent: "pot", position: [0.025, 0.045, 0.01] }),
    P({ id: "tank", name: "Reservoir", ref: "reservoir-1l", position: [-0.05, 0, -0.16] }),
    P({ id: "pump", name: "Pump", ref: "pump-mini-5v", parent: "tank", position: [0, 0.004, 0] }),
  ],
  connections: [
    { from: "power", fromPin: "5V", to: "uno", toPin: "5V", kind: "power" },
    { from: "uno", fromPin: "5V", to: "probe", toPin: "VCC", kind: "power" },
    { from: "uno", fromPin: "GND", to: "probe", toPin: "GND", kind: "ground" },
    { from: "probe", fromPin: "AOUT", to: "uno", toPin: "A0", kind: "signal" },
    { from: "uno", fromPin: "D7", to: "relay", toPin: "IN", kind: "signal" },
    { from: "uno", fromPin: "5V", to: "relay", toPin: "VCC", kind: "power" },
    { from: "relay", fromPin: "NO", to: "pump", toPin: "+", kind: "motor" },
    { from: "uno", fromPin: "D8", to: "buzzer", toPin: "+", kind: "signal" },
    { from: "uno", fromPin: "SDA", to: "lcd", toPin: "SDA", kind: "data" },
    { from: "pump", fromPin: "OUTLET", to: "pot", toPin: "IN", kind: "tube" },
  ],
  joints: [],
  program: [],
  signals: [{ id: "moisture", sensor: "probe", name: "Soil moisture", unit: "%", min: 0, max: 100, start: 40, drift: -0.02, effects: [{ part: "pump", rate: 2 }], shows: "pot" }],
  rules: [
    {
      signal: "moisture",
      op: "<",
      value: 30,
      hysteresis: 15,
      outputs: [
        { part: "relay", action: "on", text: "" },
        { part: "buzzer", action: "beep", text: "" },
        { part: "lcd", action: "display", text: "Watering...\nSoil {moisture}%" },
      ],
    },
  ],
  timeScale: 180,
  simSeconds: 3600,
};

export default function MachinePreview({ which, freeze }: { which: "plant" | "waver"; freeze?: number }) {
  const assembly = useMemo(() => sanitizeAssembly(which === "plant" ? PLANT : FIXTURE), [which]);
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
            clock.current.t = freeze !== undefined ? freeze : (clock.current.t + d) % sim.tEnd;
          }}
        />
        <MachineRig assembly={assembly} sim={sim} clock={clock} labels={false} selected={selected} onSelect={setSelected} gizmo="translate" onTransform={() => {}} />
        <OrbitControls makeDefault />
      </Canvas>
      <pre id="sim-report" className="absolute top-2 left-2 max-w-md font-mono text-[10px] whitespace-pre-wrap text-mute">
        {sim.checks.map((c) => `${c.level.toUpperCase()} ${c.title}`).join("\n")}
        {freeze !== undefined && sim.behaviour && `\n@${freeze}s: ${sim.behaviour.signals.map((s) => `${s.id}=${s.value[behaviourIndex(sim.behaviour!, freeze)].toFixed(1)}`).join(" ")} on=[${[...sim.behaviour.on].filter(([, a]) => a[behaviourIndex(sim.behaviour!, freeze)]).map(([id]) => id).join(",")}] firstPump=${sim.behaviour.realT[sim.behaviour.on.get("pump")?.findIndex((v) => v > 0) ?? 0]?.toFixed(2)}s`}
      </pre>
    </div>
  );
}
