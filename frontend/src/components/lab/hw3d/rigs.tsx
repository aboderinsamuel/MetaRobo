"use client";

// The four hardware rigs, built from the selected parts and dimensions and driven by the simulated
// signals: wheels turn with the integrated speed, the shoulder swings to the place pose and lets go,
// the balancer leans by its simulated tilt state, the quadcopter climbs on its thrust.
import { Line, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { fmtNum } from "@/lib/lab/analysis";
import type { DerivedHardware, Telemetry } from "@/lib/lab/hardware/build";
import { ARM_ELBOW, ARM_GRIP, ARM_START, payloadSize } from "@/lib/lab/hardware/build";
import { batteryDims, boardDims, driverDims, motorDims } from "@/lib/lab/hardware/dims";
import { BatteryMesh, BoardMesh, Dimension, DriverMesh, GearMotorMesh, Label, PartSlot, SensorMesh, Wheel, Wire, curve } from "./parts3d";

type V3 = [number, number, number];

export type Clock = { t: number; playing: boolean; rate: number };

export interface Motion {
  dt: number;
  tEnd: number;
  main: Float64Array; // rover distance (m), arm lift (rad), balancer x (m), drone altitude (m)
  speed?: Float64Array;
  tilt?: Float64Array;
  u: ArrayLike<number>;
  target: number;
  distTime: number;
}

export interface RigProps {
  hw: DerivedHardware;
  m: Motion;
  clock: React.RefObject<Clock>;
  tel: Telemetry;
}

export function sample(arr: ArrayLike<number>, dt: number, t: number): number {
  if (!arr.length) return 0;
  const f = t / dt;
  const i = Math.max(0, Math.min(arr.length - 1, Math.floor(f)));
  const j = Math.min(arr.length - 1, i + 1);
  const v = arr[i] + (arr[j] - arr[i]) * Math.max(0, Math.min(1, f - i));
  return Number.isFinite(v) ? v : 0;
}

const clampAbs = (v: number, m: number) => Math.max(-m, Math.min(m, v));

/** Keeps the orbit target (and camera) gliding after a moving robot along one axis. */
function useFollow(get: () => number, axis: "x" | "y" = "x") {
  useFrame((state, delta) => {
    const controls = state.controls as OrbitControlsImpl | null;
    if (!controls) return;
    // Time-based easing, so the camera keeps up even when the page renders slowly.
    const d = (get() - controls.target[axis]) * (1 - Math.exp(-Math.min(delta, 0.25) * 5));
    if (Math.abs(d) < 1e-5) return;
    controls.target[axis] += d;
    state.camera.position[axis] += d;
    controls.update();
  });
}

/** Motor glow and driver heat from the simulated current; returns the material refs to attach. */
function useElectricalGlow(p: RigProps) {
  const m0 = useRef<THREE.MeshStandardMaterial>(null);
  const m1 = useRef<THREE.MeshStandardMaterial>(null);
  const heat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    const cur = sample(p.tel.perMotor, p.m.dt, p.clock.current.t);
    const stallA = p.hw.motor?.stallA ?? p.hw.facts.maxA ?? 1;
    const g = Math.min(1.6, (cur / stallA) * 2.2);
    if (m0.current) m0.current.emissiveIntensity = g;
    if (m1.current) m1.current.emissiveIntensity = g;
    const over = cur / p.tel.limitA;
    if (heat.current) heat.current.emissiveIntensity = over > 1 ? 0.6 + 0.4 * Math.sin(p.clock.current.t * 30) : over * 0.35;
  });
  return { mot1: m0, mot2: m1, heat };
}

function TrackMarks({ upto, z = 0.13 }: { upto: number; z?: number }) {
  const n = Math.min(80, Math.max(8, Math.ceil(Math.abs(upto) / 0.1) + 6));
  return (
    <group>
      {Array.from({ length: n }).map((_, i) => (
        <mesh key={i} position={[i * 0.1, 0.0006, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.003, i % 5 === 0 ? 0.04 : 0.018]} />
          <meshBasicMaterial color="#8b909c" transparent opacity={i % 5 === 0 ? 0.8 : 0.35} />
        </mesh>
      ))}
      {Array.from({ length: Math.ceil(n / 5) }).map((_, i) => (
        <Label key={i} text={`${(i * 0.5).toFixed(1)} m`} position={[i * 0.5, 0.004, z + 0.045]} size={0.016} color="#8b909c" box={false} />
      ))}
    </group>
  );
}

function Flag({ x, label, z = -0.12 }: { x: number; label: string; z?: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.0018, 0.0018, 0.18, 8]} />
        <meshBasicMaterial color="#cfd6e0" />
      </mesh>
      <mesh position={[0.018, 0.165, 0]}>
        <boxGeometry args={[0.036, 0.024, 0.002]} />
        <meshBasicMaterial color="#3ff0ff" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.001, -z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.004, Math.abs(z) * 3.5]} />
        <meshBasicMaterial color="#3ff0ff" transparent opacity={0.45} toneMapped={false} />
      </mesh>
      <Label text={label.toUpperCase()} position={[0, 0.205, 0]} size={0.018} />
    </group>
  );
}

function Crate({ s }: { s: number }) {
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[s, s, s]} />
        <meshStandardMaterial color="#e0a33a" roughness={0.75} />
      </mesh>
      <mesh>
        <boxGeometry args={[s * 1.002, s * 0.18, s * 1.002]} />
        <meshStandardMaterial color="#b97c22" roughness={0.8} />
      </mesh>
    </group>
  );
}

/** Marks a centre of mass: the pink ball and a plumb line to the floor, as in the original studio. */
function ComMarker({ y, bad }: { y: number; bad?: boolean }) {
  return (
    <group>
      <mesh position={[0, y, 0]}>
        <sphereGeometry args={[0.007, 20, 20]} />
        <meshBasicMaterial color={bad ? "#ff4d5e" : "#ff6fd8"} toneMapped={false} />
      </mesh>
      <Line points={[[0, y, 0], [0, 0.001, 0]]} color={bad ? "#ff4d5e" : "#ff6fd8"} lineWidth={1} dashed dashSize={0.004} gapSize={0.004} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Rover
// ---------------------------------------------------------------------------

export function RoverRig(p: RigProps) {
  const { hw, m, clock } = p;
  const g = hw.build.geom;
  const motor = hw.motor!;
  const L = g.chassisL,
    W = g.chassisW,
    r = g.wheelD / 2;
  const md = motorDims(motor.look);
  const ww = Math.min(0.04, Math.max(0.012, r * 0.55));
  const deckY = Math.max(r + md.r + 0.004, 0.03);
  const axleX = -L / 2 + Math.max(r * 0.7, md.r + 0.012);
  const slope = hw.facts.slope;
  const rampAt = hw.facts.rampAt;
  // Where the ramp starts: the distance covered when the disturbance hits.
  const rampX = rampAt > 0 ? sample(m.main, m.dt, rampAt) + L * 0.5 : Infinity;

  const body = useRef<THREE.Group>(null);
  const wl = useRef<THREE.Group>(null);
  const wr = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Mesh>(null);
  const xNow = () => clampAbs(sample(m.main, m.dt, clock.current.t), 80);
  useFollow(xNow);
  const { mot1, mot2, heat } = useElectricalGlow(p);
  useFrame(({ clock: c }) => {
    const x = xNow();
    if (body.current) {
      // The nose tips up as it rolls onto the ramp; once the tail is on too, it climbs the incline.
      const k = rampX < Infinity ? Math.min(1, Math.max(0, (x + L / 2 - rampX) / L)) : 0;
      const pitch = slope * k;
      const climb = rampX < Infinity ? Math.max(0, x - L / 2 - rampX) * Math.tan(slope) : 0;
      body.current.position.set(x, (L / 2) * Math.sin(pitch) + climb, 0);
      body.current.rotation.z = pitch;
    }
    for (const w of [wl.current, wr.current]) if (w) w.rotation.z = -x / r;
    if (beam.current) (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.05 * Math.sin(c.elapsedTime * 8);
  });

  const bd = batteryDims(hw.battery),
    cd = boardDims(hw.board),
    dd = driverDims(hw.driver);
  // Lay out battery (rear), board (middle), driver (front) along the deck.
  const xs = [-L / 2 + 0.008 + bd[0] / 2, 0, L / 2 - 0.012 - dd[0] / 2];
  xs[1] = (xs[0] + bd[0] / 2 + (xs[2] - dd[0] / 2)) / 2;
  const top = deckY + 0.003;
  const payloadS = g.payload > 0.005 ? payloadSize(g.payload) : 0;
  const curNow = () => sample(p.tel.perMotor, m.dt, clock.current.t);
  const wirePts = (a: V3, b: V3, lift = 0.015) => curve(a, b, lift);

  return (
    <>
      <TrackMarks upto={Math.max(1.5, m.main[m.main.length - 1] ?? 1)} z={W / 2 + 0.07} />
      {rampX < Infinity && slope > 0.001 && (
        <group position={[rampX, 0, 0]}>
          <mesh position={[0.6 * Math.cos(slope), 0.6 * Math.sin(slope) - 0.006, 0]} rotation={[0, 0, slope]} receiveShadow>
            <boxGeometry args={[1.2, 0.012, W + 0.16]} />
            <meshStandardMaterial color="#1a2433" roughness={0.8} />
          </mesh>
          <Label text={`RAMP ${fmtNum((slope * 180) / Math.PI, 2)}°`} position={[0.08, 0.06, -(W / 2 + 0.1)]} size={0.016} color="#ffb020" box={false} />
        </group>
      )}
      <group ref={body}>
        {/* Chassis */}
        <RoundedBox args={[L, 0.004, W]} radius={0.002} smoothness={2} position={[0, deckY, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#1b3550" roughness={0.55} />
        </RoundedBox>
        <mesh position={[0, deckY - md.r - 0.004, 0]}>
          <boxGeometry args={[L * 0.6, 0.003, W * 0.5]} />
          <meshStandardMaterial color="#13283d" roughness={0.6} />
        </mesh>
        {/* Motors face outwards from the middle of the rear axle */}
        {[1, -1].map((side) => (
          <group key={side}>
            <PartSlot slot="motor" size={[md.r * 2.2, md.r * 2.2, md.len]} center={[axleX, r, side * (W / 2 - md.len / 2)]} label={side === 1 ? motor.name : undefined}>
              <group position={[axleX, r, side * (W / 2 - 0.001)]} rotation={[0, side === 1 ? -Math.PI / 2 : Math.PI / 2, 0]}>
                <GearMotorMesh motor={motor} glow={side === 1 ? mot1 : mot2} />
              </group>
            </PartSlot>
            <PartSlot slot="sensor" size={[0.024, 0.024, 0.006]} center={[axleX, r, side * (W / 2 - md.len - 0.004)]} label={side === 1 ? hw.sensor.name : undefined}>
              <group position={[axleX, r, side * (W / 2 - md.len - 0.004)]} rotation={[0, side === 1 ? -Math.PI / 2 : Math.PI / 2, 0]}>
                <SensorMesh sensor={hw.sensor} />
              </group>
            </PartSlot>
            <group position={[axleX, r, side * (W / 2 + 0.004 + ww / 2)]}>
              <Wheel r={r} w={ww} spin={side === 1 ? wl : wr} />
            </group>
          </group>
        ))}
        {/* Caster */}
        <mesh position={[L / 2 - 0.02, (deckY - 0.004) / 2 + 0.006, 0]}>
          <cylinderGeometry args={[0.004, 0.004, Math.max(0.002, deckY - 0.016), 10]} />
          <meshStandardMaterial color="#9aa6b6" metalness={0.6} roughness={0.3} />
        </mesh>
        <mesh position={[L / 2 - 0.02, 0.006, 0]}>
          <sphereGeometry args={[0.006, 20, 20]} />
          <meshStandardMaterial color="#c9ced6" metalness={0.7} roughness={0.25} />
        </mesh>
        {/* Deck electronics */}
        <PartSlot slot="battery" size={bd} center={[xs[0], top + bd[1] / 2, 0]} label={hw.battery.name}>
          <group position={[xs[0], top, 0]}>
            <BatteryMesh battery={hw.battery} />
          </group>
        </PartSlot>
        <PartSlot slot="board" size={cd} center={[xs[1], top + cd[1] / 2, -W * 0.12]} label={hw.board.name}>
          <group position={[xs[1], top + 0.003, -W * 0.12]}>
            <BoardMesh board={hw.board} />
          </group>
        </PartSlot>
        <PartSlot slot="driver" size={dd} center={[xs[2], top + dd[1] / 2, W * 0.1]} label={hw.driver.name}>
          <group position={[xs[2], top, W * 0.1]}>
            <DriverMesh driver={hw.driver} heat={heat} />
          </group>
        </PartSlot>
        {/* Ultrasonic sensor on the nose, with its sensing cone */}
        <group position={[L / 2 + 0.002, deckY + 0.014, 0]} rotation={[0, Math.PI / 2, 0]}>
          <SensorMesh sensor={{ ...hw.sensor, look: "sonar" }} />
        </group>
        <mesh ref={beam} position={[L / 2 + 0.14, deckY + 0.014, 0]} rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[0.06, 0.26, 32, 1, true]} />
          <meshBasicMaterial color="#3ff0ff" transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {/* Payload */}
        {payloadS > 0 && (
          <group position={[xs[0], top + bd[1] + payloadS / 2 + 0.001, 0]}>
            <Crate s={payloadS} />
          </group>
        )}
        {/* Wiring: battery → driver (power), driver → motors, board → driver (signals) */}
        <Wire points={wirePts([xs[0] + bd[0] / 2, top + 0.004, W * 0.12], [xs[2] - dd[0] / 2, top + 0.004, W * 0.1 + 0.01])} color="#ff4d5e" flow={curNow} />
        <Wire points={wirePts([xs[0] + bd[0] / 2, top + 0.003, W * 0.16], [xs[2] - dd[0] / 2, top + 0.003, W * 0.1 + 0.016], 0.01)} color="#2b2f36" />
        {[1, -1].map((side) => (
          <Wire key={side} points={wirePts([xs[2], top + 0.004, W * 0.1 + (side * dd[2]) / 2], [axleX - md.len * 0.3, r + md.r, side * (W / 2 - md.len)], 0.02)} color="#b06bff" flow={curNow} width={1.4} />
        ))}
        <Wire points={wirePts([xs[1] + cd[0] / 2, top + 0.005, -W * 0.12], [xs[2] - dd[0] / 2, top + 0.006, W * 0.1 - 0.01], 0.012)} color="#3ff0ff" width={1.2} />
        <Dimension a={[-L / 2, deckY, -W / 2 - 0.02]} b={[L / 2, deckY, -W / 2 - 0.02]} text={`chassis ${Math.round(L * 1000)} mm`} offset={[0, 0, -0.02]} />
        <Label text={`⌀${Math.round(g.wheelD * 1000)} mm`} position={[axleX, r * 2 + 0.014, W / 2 + ww + 0.01]} size={0.011} color="#aab2bf" />
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Arm: pick and place
// ---------------------------------------------------------------------------

const YAW_SWING = Math.PI / 2;

function ArmLinks({ hw, ghost = false, glow, jaw }: { hw: DerivedHardware; ghost?: boolean; glow?: React.RefObject<THREE.MeshStandardMaterial | null>; jaw?: React.RefObject<THREE.Group | null> }) {
  const g = hw.build.geom;
  const L1 = g.upper,
    L2 = g.fore;
  const mat = (color: string) => (ghost ? <meshBasicMaterial color="#3ff0ff" transparent opacity={0.13} depthWrite={false} /> : <meshStandardMaterial color={color} roughness={0.45} metalness={0.25} />);
  return (
    <group>
      <mesh position={[L1 / 2, 0, 0]} castShadow={!ghost}>
        <boxGeometry args={[L1, 0.02, 0.026]} />
        {mat("#c9ced6")}
      </mesh>
      {/* elbow servo */}
      <mesh position={[L1, 0, 0]} castShadow={!ghost}>
        <boxGeometry args={[0.04, 0.04, 0.022]} />
        {ghost ? mat("") : <meshStandardMaterial ref={glow} color="#0f8a5f" roughness={0.5} emissive="#34d399" emissiveIntensity={0.05} />}
      </mesh>
      <group position={[L1, 0, 0]} rotation={[0, 0, ARM_ELBOW]}>
        <mesh position={[L2 / 2, 0, 0]} castShadow={!ghost}>
          <boxGeometry args={[L2, 0.016, 0.022]} />
          {mat("#c9ced6")}
        </mesh>
        {/* gripper */}
        <group position={[L2, 0, 0]}>
          <mesh>
            <boxGeometry args={[0.012, 0.03, 0.034]} />
            {mat("#3a4352")}
          </mesh>
          <mesh position={[0.004, 0.02, 0]}>
            <boxGeometry args={[0.022, 0.012, 0.012]} />
            {ghost ? mat("") : <meshStandardMaterial color="#1f4fd6" />}
          </mesh>
          <group ref={jaw}>
            {[1, -1].map((s) => (
              <mesh key={s} position={[ARM_GRIP / 2 + 0.006, 0, s * 0.014]} name={`jaw${s}`}>
                <boxGeometry args={[ARM_GRIP, 0.008, 0.004]} />
                {mat("#3a4352")}
              </mesh>
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}

export function ArmRig(p: RigProps) {
  const { hw, m, clock } = p;
  const g = hw.build.geom;
  const motor = hw.motor!;
  const md = motorDims(motor.look);
  const L1 = g.upper,
    L2 = g.fore,
    H = g.shoulderH;
  const reach = L1 + L2 + ARM_GRIP;
  const zArm = 0.022;
  const box = payloadSize(g.payload);
  const yawMax = YAW_SWING;
  const thEnd = ARM_START + m.target;
  const tip = (th: number, yaw: number): V3 => {
    const px = L1 * Math.cos(th) + (L2 + ARM_GRIP * 0.6) * Math.cos(th + ARM_ELBOW);
    const py = H + L1 * Math.sin(th) + (L2 + ARM_GRIP * 0.6) * Math.sin(th + ARM_ELBOW);
    return [px * Math.cos(yaw) + zArm * Math.sin(yaw), py, -px * Math.sin(yaw) + zArm * Math.cos(yaw)];
  };
  const pick = tip(ARM_START, 0);
  const place = tip(thEnd, yawMax);
  const release = m.distTime > 0 ? m.distTime : Infinity;

  const turret = useRef<THREE.Group>(null);
  const shoulder = useRef<THREE.Group>(null);
  const crate = useRef<THREE.Group>(null);
  const jaw = useRef<THREE.Group>(null);
  const servoGlow = useRef<THREE.MeshStandardMaterial>(null);
  const { mot1: glow, heat } = useElectricalGlow(p);
  useFrame(() => {
    const t = clock.current.t;
    const lift = clampAbs(sample(m.main, m.dt, t), 2.8);
    const frac = m.target ? Math.max(-0.2, Math.min(1.15, lift / m.target)) : 0;
    const yaw = yawMax * frac;
    const th = ARM_START + lift;
    if (turret.current) turret.current.rotation.y = yaw;
    if (shoulder.current) shoulder.current.rotation.z = th;
    if (servoGlow.current) servoGlow.current.emissiveIntensity = 0.05;
    const held = t < release;
    if (jaw.current)
      jaw.current.children.forEach((c, i) => {
        c.position.z = (i === 0 ? 1 : -1) * (held && g.payload > 0 ? box / 2 + 0.002 : box / 2 + 0.01);
      });
    if (crate.current) {
      if (held) {
        const [x, y, z] = tip(th, yaw);
        crate.current.position.set(x, y, z);
        crate.current.rotation.set(0, yaw, 0);
      } else {
        const k = Math.min(1, (t - release) / 0.15);
        crate.current.position.set(place[0], place[1] - k * 0.003, place[2]);
        crate.current.rotation.set(0, yawMax, 0);
      }
    }
  });
  const comBad = hw.checks.some((c) => c.id === "tip" && c.level !== "pass");
  const bd = batteryDims(hw.battery),
    cd = boardDims(hw.board),
    dd = driverDims(hw.driver);
  const trayX = -g.baseR - 0.07;
  const curNow = () => sample(p.tel.perMotor, m.dt, clock.current.t);

  return (
    <>
      {/* Reach envelope: a dome around the shoulder, like the studio */}
      <mesh position={[0, H, 0]}>
        <sphereGeometry args={[reach, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#5fe0c8" transparent opacity={0.035} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <Line
        points={Array.from({ length: 97 }, (_, i) => [Math.cos((i / 96) * Math.PI * 2) * reach, 0.001, Math.sin((i / 96) * Math.PI * 2) * reach] as V3)}
        color="#5fe0c8"
        lineWidth={1}
        dashed
        dashSize={0.012}
        gapSize={0.008}
        transparent
        opacity={0.6}
      />
      {/* Pick pedestal and place shelf */}
      {[
        { at: pick, label: "PICK" },
        { at: place, label: "PLACE" },
      ].map(({ at, label }) => {
        const h = Math.max(0.002, at[1] - box / 2);
        return (
          <group key={label} position={[at[0], 0, at[2]]}>
            <mesh position={[0, h / 2, 0]} castShadow>
              <cylinderGeometry args={[0.005, 0.007, h, 12]} />
              <meshStandardMaterial color="#3a4352" metalness={0.5} roughness={0.4} />
            </mesh>
            <mesh position={[0, h - 0.002, 0]} receiveShadow castShadow>
              <cylinderGeometry args={[box * 0.95, box * 0.95, 0.004, 32]} />
              <meshStandardMaterial color={label === "PICK" ? "#2a3a52" : "#1d5a6a"} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.002, 0]}>
              <cylinderGeometry args={[box * 0.7, box * 0.75, 0.004, 24]} />
              <meshStandardMaterial color="#1c2a3d" roughness={0.7} />
            </mesh>
            <Label text={label} position={[0, h + box + 0.03, 0]} size={0.014} color={label === "PICK" ? "#aab2bf" : "#3ff0ff"} />
          </group>
        );
      })}
      {/* Base */}
      <mesh position={[0, 0.0075, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[g.baseR, g.baseR * 1.08, 0.015, 64]} />
        <meshStandardMaterial color="#1c2a3d" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.0005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[g.baseR * 1.1, g.baseR * 1.14, 64]} />
        <meshBasicMaterial color={comBad ? "#ff4d5e" : "#34d399"} transparent opacity={0.7} toneMapped={false} />
      </mesh>
      {/* Electronics tray behind the base */}
      <mesh position={[trayX, 0.003, 0]} receiveShadow>
        <boxGeometry args={[0.11, 0.006, 0.13]} />
        <meshStandardMaterial color="#141c28" roughness={0.7} />
      </mesh>
      <PartSlot slot="board" size={cd} center={[trayX, 0.006 + cd[1] / 2, -0.03]} label={hw.board.name}>
        <group position={[trayX, 0.009, -0.03]}>
          <BoardMesh board={hw.board} />
        </group>
      </PartSlot>
      <PartSlot slot="driver" size={dd} center={[trayX + 0.01, 0.006 + dd[1] / 2, 0.035]} label={hw.driver.name}>
        <group position={[trayX + 0.01, 0.006, 0.035]}>
          <DriverMesh driver={hw.driver} heat={heat} />
        </group>
      </PartSlot>
      <PartSlot slot="battery" size={bd} center={[trayX - 0.085, bd[1] / 2, 0]} label={hw.battery.name}>
        <group position={[trayX - 0.085, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <BatteryMesh battery={hw.battery} />
        </group>
      </PartSlot>
      <Wire points={curve([trayX - 0.06, 0.008, 0], [trayX + 0.01 - dd[0] / 2, 0.012, 0.035], 0.02)} color="#ff4d5e" flow={curNow} />
      <Wire points={curve([trayX + 0.01 + dd[0] / 2, 0.012, 0.035], [0, H - 0.02, -0.02], 0.05)} color="#b06bff" flow={curNow} />
      {/* Turret: everything above the turntable yaws together */}
      <group ref={turret}>
        <mesh position={[0, 0.019, 0]}>
          <cylinderGeometry args={[g.baseR * 0.75, g.baseR * 0.75, 0.008, 48]} />
          <meshStandardMaterial color="#2a3a52" roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[0, (H + 0.023) / 2, 0]} castShadow>
          <boxGeometry args={[0.04, H - 0.023, 0.04]} />
          <meshStandardMaterial color="#c9ced6" roughness={0.45} metalness={0.25} />
        </mesh>
        <PartSlot slot="motor" size={[md.r * 2.2, md.r * 2.2, md.len]} center={[0, H, zArm - md.len / 2]} label={motor.name}>
          <group position={[0, H, zArm - 0.004]} rotation={[0, -Math.PI / 2, 0]}>
            <GearMotorMesh motor={motor} glow={glow} />
          </group>
        </PartSlot>
        <PartSlot slot="sensor" size={[0.02, 0.02, 0.006]} center={[0, H, zArm - md.len - 0.006]} label={hw.sensor.name}>
          <group position={[0, H, zArm - md.len - 0.006]} rotation={[Math.PI / 2, 0, 0]}>
            <SensorMesh sensor={hw.sensor} />
          </group>
        </PartSlot>
        <group position={[0, H, zArm]}>
          <group ref={shoulder}>
            <ArmLinks hw={hw} glow={servoGlow} jaw={jaw} />
          </group>
          <Label text={`upper arm ${Math.round(L1 * 1000)} mm`} position={[0, 0.06, 0.03]} size={0.011} color="#aab2bf" />
        </group>
        <Label text={`shoulder ${Math.round(H * 1000)} mm`} position={[0.045, H * 0.45, 0.03]} size={0.011} color="#aab2bf" />
      </group>
      {/* Ghost of the place pose */}
      <group rotation={[0, yawMax, 0]}>
        <group position={[0, H, zArm]} rotation={[0, 0, thEnd]}>
          <ArmLinks hw={hw} ghost />
        </group>
      </group>
      {g.payload > 0 && (
        <group ref={crate}>
          <Crate s={box} />
        </group>
      )}
      <group position={[Math.max(0, hw.facts.comX), 0.016, 0]}>
        <ComMarker y={H * 0.55} bad={comBad} />
      </group>
      <Label text={`reach ${Math.round(reach * 1000)} mm`} position={[reach * 0.72, 0.012, reach * 0.72]} size={0.012} color="#5fe0c8" box={false} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Self-balancing robot
// ---------------------------------------------------------------------------

export function BalancerRig(p: RigProps) {
  const { hw, m, clock } = p;
  const g = hw.build.geom;
  const motor = hw.motor!;
  const md = motorDims(motor.look);
  const r = g.wheelD / 2;
  const l = g.comH;
  const bodyW = Math.max(0.1, 2 * md.len + 0.012);
  const ww = Math.min(0.035, Math.max(0.014, r * 0.5));
  const decks = [md.r + 0.012, l * 0.95, Math.max(l * 1.75, l + 0.05)];
  const bodyH = decks[2] + 0.01;
  const deckD = 0.075;

  const base = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const wl = useRef<THREE.Group>(null);
  const wr = useRef<THREE.Group>(null);
  const xNow = () => clampAbs(sample(m.main, m.dt, clock.current.t), 20);
  useFollow(xNow);
  const { mot1, mot2, heat } = useElectricalGlow(p);
  // Lying flat: the angle at which the top deck touches the floor.
  const fallAngle = Math.min(1.45, Math.PI / 2 - Math.atan2(r, bodyH));
  useFrame(() => {
    const t = clock.current.t;
    const x = xNow();
    let th = m.tilt ? sample(m.tilt, m.dt, t) : 0;
    if (!Number.isFinite(th) || Math.abs(th) > fallAngle) th = Math.sign(th || 1) * fallAngle;
    if (base.current) base.current.position.x = x;
    if (tilt.current) tilt.current.rotation.z = -th;
    for (const w of [wl.current, wr.current]) if (w) w.rotation.z = -x / r;
  });
  const bd = batteryDims(hw.battery),
    cd = boardDims(hw.board),
    dd = driverDims(hw.driver);
  const payloadS = g.payload > 0.005 ? payloadSize(g.payload) : 0;
  const curNow = () => sample(p.tel.perMotor, m.dt, clock.current.t);
  return (
    <>
      <TrackMarks upto={Math.max(0.8, m.target * 2)} z={bodyW / 2 + ww + 0.06} />
      <Flag x={m.target} label={`target ${fmtNum(m.target)} m`} z={-(bodyW / 2 + 0.1)} />
      <group ref={base}>
        {[1, -1].map((s) => (
          <group key={s} position={[0, r, s * (bodyW / 2 + 0.004 + ww / 2)]}>
            <Wheel r={r} w={ww} spin={s === 1 ? wl : wr} hub="#b06bff" />
          </group>
        ))}
        <group position={[0, r, 0]}>
          <group ref={tilt}>
            {/* Motors along the axle, shafts out to the wheels */}
            {[1, -1].map((s) => (
              <PartSlot key={s} slot="motor" size={[md.r * 2.2, md.r * 2.2, md.len]} center={[0, 0, s * (bodyW / 2 - md.len / 2)]} label={s === 1 ? motor.name : undefined}>
                <group position={[0, 0, s * (bodyW / 2 - 0.001)]} rotation={[0, s === 1 ? -Math.PI / 2 : Math.PI / 2, 0]}>
                  <GearMotorMesh motor={motor} glow={s === 1 ? mot1 : mot2} />
                </group>
              </PartSlot>
            ))}
            {/* Frame: three acrylic decks on brass standoffs */}
            {decks.map((y, i) => (
              <mesh key={i} position={[0, y, 0]} castShadow>
                <boxGeometry args={[deckD, 0.004, bodyW]} />
                <meshStandardMaterial color="#9fd8ff" transparent opacity={0.28} roughness={0.15} metalness={0.1} />
              </mesh>
            ))}
            {[1, -1].flatMap((sx) =>
              [1, -1].map((sz) => (
                <mesh key={`${sx}${sz}`} position={[(sx * deckD) / 2 - sx * 0.006, (decks[0] + decks[2]) / 2, (sz * bodyW) / 2 - sz * 0.006]}>
                  <cylinderGeometry args={[0.0022, 0.0022, decks[2] - decks[0], 8]} />
                  <meshStandardMaterial color="#d4b25a" metalness={0.85} roughness={0.3} />
                </mesh>
              )),
            )}
            <mesh position={[0, md.r + 0.004, 0]}>
              <boxGeometry args={[deckD * 0.7, 0.004, bodyW - 0.01]} />
              <meshStandardMaterial color="#2a3a52" />
            </mesh>
            <PartSlot slot="driver" size={dd} center={[0, decks[0] + 0.002 + dd[1] / 2, 0]} label={hw.driver.name}>
              <group position={[0, decks[0] + 0.002, 0]} rotation={[0, Math.PI / 2, 0]}>
                <DriverMesh driver={hw.driver} heat={heat} />
              </group>
            </PartSlot>
            <PartSlot slot="board" size={cd} center={[0, decks[1] + 0.002 + cd[1] / 2, -0.012]} label={hw.board.name}>
              <group position={[0, decks[1] + 0.005, -0.012]} rotation={[0, Math.PI / 2, 0]}>
                <BoardMesh board={hw.board} />
              </group>
            </PartSlot>
            <PartSlot slot="sensor" size={[0.02, 0.006, 0.016]} center={[0, decks[1] + 0.004, bodyW / 2 - 0.02]} label={hw.sensor.name}>
              <group position={[0, decks[1] + 0.004, bodyW / 2 - 0.02]}>
                <SensorMesh sensor={hw.sensor} />
              </group>
            </PartSlot>
            <PartSlot slot="battery" size={bd} center={[0, decks[2] + 0.002 + bd[1] / 2, 0]} label={hw.battery.name}>
              <group position={[0, decks[2] + 0.002, 0]} rotation={[0, Math.PI / 2, 0]}>
                <BatteryMesh battery={hw.battery} />
              </group>
            </PartSlot>
            {payloadS > 0 && (
              <group position={[0, decks[2] + bd[1] + payloadS / 2 + 0.004, 0]}>
                <Crate s={payloadS} />
              </group>
            )}
            {/* Face on the front of the top deck */}
            <group position={[deckD / 2 + 0.002, decks[2] - 0.02, 0]}>
              <mesh>
                <boxGeometry args={[0.003, 0.03, 0.06]} />
                <meshStandardMaterial color="#040507" roughness={0.2} />
              </mesh>
              {[-0.012, 0.012].map((z) => (
                <mesh key={z} position={[0.002, 0, z]} rotation={[0, Math.PI / 2, 0]}>
                  <circleGeometry args={[0.005, 20]} />
                  <meshBasicMaterial color="#ffffff" toneMapped={false} />
                </mesh>
              ))}
            </group>
            <Wire points={curve([0, decks[2], bodyW / 2 - 0.01], [0, decks[0] + 0.008, bodyW / 2 - 0.01], 0)} color="#ff4d5e" flow={curNow} />
            <ComMarker y={l} />
            <Label text={`COM ${Math.round(l * 1000)} mm`} position={[-0.05, l, 0]} size={0.011} color="#ff6fd8" box={false} />
          </group>
        </group>
      </group>
      <Label text={`⌀${Math.round(g.wheelD * 1000)} mm`} position={[0, 0.006, bodyW / 2 + ww + 0.025]} size={0.011} color="#aab2bf" box={false} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Quadcopter
// ---------------------------------------------------------------------------

export function DroneRig(p: RigProps) {
  const { hw, m, clock } = p;
  const g = hw.build.geom;
  const motor = hw.droneMotor!;
  const prop = hw.prop!;
  const arm = prop.armM;
  const propR = (prop.inch * 0.0254) / 2;
  const statorR = Number(motor.stator.split("×")[0]) / 2000 + 0.002;
  const legH = 0.05 + arm * 0.15;
  const craft = useRef<THREE.Group>(null);
  const props = useRef<(THREE.Group | null)[]>([]);
  const thrust = useRef<(THREE.Group | null)[]>([]);
  const shadow = useRef<THREE.Mesh>(null);
  const gust = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Mesh>(null);
  const { thrustTotal, weight } = hw.facts;
  const { mot1: bell, heat } = useElectricalGlow(p);
  const altNow = () => Math.max(0, Math.min(8, sample(m.main, m.dt, clock.current.t)));
  useFollow(() => legH + 0.05 + altNow(), "y");
  useFrame((_, delta) => {
    const t = clock.current.t;
    const alt = altNow();
    if (craft.current) {
      craft.current.position.y = legH + alt;
      craft.current.rotation.z = Math.sin(t * 3) * 0.012;
      craft.current.rotation.x = Math.cos(t * 2.3) * 0.01;
    }
    const T = Math.max(0, Math.min(thrustTotal, weight + sample(m.u, m.dt, t)));
    const frac = thrustTotal > 0 ? T / thrustTotal : 0;
    props.current.forEach((pp, i) => {
      if (pp) pp.rotation.y += delta * (clock.current.playing ? 1 : 0.1) * (30 + 90 * frac) * (i % 2 ? 1 : -1);
    });
    thrust.current.forEach((a) => {
      if (a) a.scale.set(1, 0.2 + 1.6 * frac, 1);
    });
    if (shadow.current) {
      const k = 1 / (1 + alt * 1.2);
      shadow.current.scale.setScalar(0.6 + (1 - k) * 0.8);
      (shadow.current.material as THREE.MeshBasicMaterial).opacity = 0.45 * k;
    }
    if (beam.current) {
      beam.current.scale.y = Math.max(0.01, legH + alt - 0.02);
      beam.current.position.y = -(legH + alt - 0.02) / 2 - 0.01;
    }
    if (gust.current) {
      const on = m.distTime >= 0 && t >= m.distTime && t < m.distTime + Math.max(0.6, m.tEnd * 0.08);
      gust.current.visible = on;
      gust.current.position.y = legH + alt + 0.3 - ((t * 0.8) % 0.1);
    }
  });
  const arms = [45, 135, 225, 315].map((d) => (d * Math.PI) / 180);
  const targetY = legH + m.target;
  const plate = Math.max(0.05, arm * 0.55);
  const bd = batteryDims(hw.battery);
  const tick = targetY > 2.5 ? 0.5 : 0.25;
  const nTicks = Math.ceil((targetY + 0.6) / tick) + 1;
  const sonar = hw.sensor.look === "sonar";
  const curNow = () => sample(p.tel.perMotor, m.dt, clock.current.t);
  return (
    <>
      <mesh ref={shadow} position={[0, 0.0008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[arm * 1.3, 40]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.4} />
      </mesh>
      {/* Landing pad */}
      <mesh position={[0, 0.0006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[arm * 1.5, arm * 1.55, 64]} />
        <meshBasicMaterial color="#3ff0ff" transparent opacity={0.35} toneMapped={false} />
      </mesh>
      {/* Altitude ruler */}
      {Array.from({ length: nTicks }).map((_, i) => (
        <group key={i} position={[-(arm * 2.2), legH + i * tick, 0]}>
          <mesh>
            <boxGeometry args={[i % 2 ? 0.02 : 0.04, 0.002, 0.002]} />
            <meshBasicMaterial color="#8b909c" />
          </mesh>
          {i % 2 === 0 && <Label text={`${(i * tick).toFixed(1)} m`} position={[-0.08, 0, 0]} size={0.035} color="#8b909c" box={false} />}
        </group>
      ))}
      <mesh position={[-(arm * 2.2), legH + ((nTicks - 1) * tick) / 2, 0]}>
        <boxGeometry args={[0.002, (nTicks - 1) * tick, 0.002]} />
        <meshBasicMaterial color="#50555f" />
      </mesh>
      {/* Target altitude ring */}
      <mesh position={[0, targetY, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[arm * 1.7, 0.003, 8, 96]} />
        <meshBasicMaterial color="#3ff0ff" transparent opacity={0.7} toneMapped={false} />
      </mesh>
      <Label text={`TARGET +${fmtNum(m.target)} M`} position={[arm * 2.3, targetY, 0]} size={0.04} />
      <group ref={gust} visible={false}>
        {[-1, 0, 1].map((k) => (
          <group key={k} position={[k * arm * 0.9, 0, arm * 0.4]}>
            <mesh position={[0, 0.04, 0]}>
              <cylinderGeometry args={[0.003, 0.003, 0.1, 6]} />
              <meshBasicMaterial color="#ff9a3d" toneMapped={false} />
            </mesh>
            <mesh rotation={[Math.PI, 0, 0]} position={[0, -0.02, 0]}>
              <coneGeometry args={[0.012, 0.03, 12]} />
              <meshBasicMaterial color="#ff9a3d" toneMapped={false} />
            </mesh>
          </group>
        ))}
        <Label text={`DOWN-GUST ${Math.round(g.gust * 100)}% W`} position={[arm * 1.8, 0.05, 0]} size={0.035} color="#ff9a3d" box={false} />
      </group>
      <group ref={craft}>
        {/* Frame plates and arms */}
        <RoundedBox args={[plate, 0.004, plate * 0.8]} radius={0.002} smoothness={2} castShadow>
          <meshStandardMaterial color="#14171c" metalness={0.4} roughness={0.35} />
        </RoundedBox>
        <RoundedBox args={[plate * 0.9, 0.003, plate * 0.7]} radius={0.002} smoothness={2} position={[0, 0.03, 0]} castShadow>
          <meshStandardMaterial color="#14171c" metalness={0.4} roughness={0.35} />
        </RoundedBox>
        {[1, -1].flatMap((sx) =>
          [1, -1].map((sz) => (
            <mesh key={`${sx}${sz}`} position={[sx * plate * 0.38, 0.015, sz * plate * 0.3]}>
              <cylinderGeometry args={[0.0022, 0.0022, 0.03, 8]} />
              <meshStandardMaterial color="#c9573a" metalness={0.6} roughness={0.35} />
            </mesh>
          )),
        )}
        {/* Landing skids */}
        {[1, -1].map((s) => (
          <group key={s} position={[0, -legH / 2, s * plate * 0.45]}>
            <mesh>
              <boxGeometry args={[0.004, legH, 0.004]} />
              <meshStandardMaterial color="#2b2f36" />
            </mesh>
            <mesh position={[0, -legH / 2, 0]}>
              <boxGeometry args={[plate * 1.4, 0.005, 0.006]} />
              <meshStandardMaterial color="#2b2f36" />
            </mesh>
          </group>
        ))}
        {arms.map((a, i) => (
          <group key={i} rotation={[0, a, 0]}>
            <mesh position={[arm / 2, 0, 0]} castShadow>
              <boxGeometry args={[arm, 0.008, Math.max(0.01, arm * 0.09)]} />
              <meshStandardMaterial color="#1d2128" metalness={0.4} roughness={0.4} />
            </mesh>
            <PartSlot slot="motor" size={[statorR * 2.4, 0.03, statorR * 2.4]} center={[arm, 0.014, 0]} label={i === 0 ? motor.name : undefined}>
              <group position={[arm, 0.004, 0]}>
                <mesh position={[0, 0.008, 0]}>
                  <cylinderGeometry args={[statorR, statorR, 0.016, 28]} />
                  <meshStandardMaterial ref={i === 0 ? bell : undefined} color="#c9ced6" metalness={0.75} roughness={0.25} emissive="#ff6a1a" emissiveIntensity={0} />
                </mesh>
                <mesh position={[0, 0.019, 0]}>
                  <cylinderGeometry args={[statorR * 0.95, statorR, 0.006, 28]} />
                  <meshStandardMaterial color={i < 2 ? "#3ff0ff" : "#ff5fa2"} metalness={0.5} roughness={0.3} />
                </mesh>
              </group>
            </PartSlot>
            <PartSlot slot="prop" size={[propR * 2, 0.006, propR * 2]} center={[arm, 0.03, 0]} label={i === 1 ? prop.name : undefined}>
              <group
                ref={(el) => {
                  props.current[i] = el;
                }}
                position={[arm, 0.03, 0]}
              >
                {[0, 1, ...(prop.inch <= 5 ? [2] : [])].map((b, _, all) => (
                  <mesh key={b} rotation={[0.12, (b * Math.PI * 2) / all.length, 0]} position={[0, 0, 0]}>
                    <boxGeometry args={[propR * 2 * (all.length === 3 ? 0.5 : 1), 0.0015, propR * 0.16]} />
                    <meshStandardMaterial color={i < 2 ? "#3ff0ff" : "#ff5fa2"} emissive={i < 2 ? "#3ff0ff" : "#ff5fa2"} emissiveIntensity={0.25} transparent opacity={0.85} />
                  </mesh>
                ))}
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[propR, 48]} />
                  <meshBasicMaterial color={i < 2 ? "#3ff0ff" : "#ff5fa2"} transparent opacity={0.06} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
              </group>
            </PartSlot>
            {/* thrust arrow */}
            <group
              ref={(el) => {
                thrust.current[i] = el;
              }}
              position={[arm, -0.01, 0]}
            >
              <mesh position={[0, -0.03, 0]}>
                <cylinderGeometry args={[0.002, 0.002, 0.06, 6]} />
                <meshBasicMaterial color="#3ff0ff" transparent opacity={0.5} toneMapped={false} />
              </mesh>
            </group>
          </group>
        ))}
        <PartSlot slot="driver" size={[0.036, 0.006, 0.036]} center={[0, 0.008, 0]} label={hw.driver.name}>
          <group position={[0, 0.005, 0]}>
            <DriverMesh driver={hw.driver} heat={heat} />
          </group>
        </PartSlot>
        <PartSlot slot="board" size={[0.036, 0.006, 0.036]} center={[0, 0.018, 0]} label={hw.board.name}>
          <group position={[0, 0.015, 0]}>
            <BoardMesh board={hw.board} />
          </group>
        </PartSlot>
        <PartSlot slot="battery" size={bd} center={[0, 0.033 + bd[1] / 2, 0]} label={hw.battery.name}>
          <group position={[0, 0.0325, 0]}>
            <BatteryMesh battery={hw.battery} />
          </group>
          {/* strap */}
          <mesh position={[0, 0.033 + bd[1] / 2, 0]}>
            <boxGeometry args={[0.012, bd[1] + 0.003, bd[2] + 0.004]} />
            <meshStandardMaterial color="#c0182a" roughness={0.7} transparent opacity={0.9} />
          </mesh>
        </PartSlot>
        <PartSlot slot="sensor" size={[0.02, 0.008, 0.02]} center={[plate * 0.25, -0.006, 0]} label={hw.sensor.name}>
          <group position={[plate * 0.25, -0.006, 0]} rotation={sonar ? [-Math.PI / 2, 0, 0] : [Math.PI, 0, 0]}>
            <SensorMesh sensor={hw.sensor} />
          </group>
        </PartSlot>
        {/* Sensing beam to the ground */}
        {hw.sensor.look !== "baro" && (
          <mesh ref={beam} position={[plate * 0.25, -0.1, 0]}>
            {sonar ? <cylinderGeometry args={[0.008, 0.12, 1, 24, 1, true]} /> : <cylinderGeometry args={[0.0012, 0.0012, 1, 6]} />}
            <meshBasicMaterial color={sonar ? "#3ff0ff" : "#ff4d5e"} transparent opacity={sonar ? 0.07 : 0.7} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        )}
        {g.payload > 0.01 && (
          <group position={[-plate * 0.15, -0.03, 0]}>
            <mesh>
              <boxGeometry args={[0.012, 0.03, 0.012]} />
              <meshStandardMaterial color="#2b2f36" />
            </mesh>
            <mesh position={[0, -0.025, 0]} castShadow>
              <boxGeometry args={[0.05, 0.035, 0.04]} />
              <meshStandardMaterial color="#15181d" metalness={0.3} roughness={0.4} />
            </mesh>
            <mesh position={[0.028, -0.025, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.012, 0.014, 0.012, 24]} />
              <meshStandardMaterial color="#0b0d10" metalness={0.6} roughness={0.2} />
            </mesh>
          </group>
        )}
        <Wire points={curve([0, 0.035, bd[2] / 2], [0, 0.008, plate * 0.3], 0.01)} color="#ff4d5e" flow={curNow} />
      </group>
    </>
  );
}
