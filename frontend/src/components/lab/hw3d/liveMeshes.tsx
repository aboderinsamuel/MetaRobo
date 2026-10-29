"use client";

// 3D models for sensing / plant / automation parts that react to the behaviour simulation every
// frame: soil darkens as it gets wet, the reservoir drains, LEDs and relays light, buzzers pulse,
// fans spin, pumps vibrate, LCDs show live text. `live()` returns the part's state right now.
import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const MM = 0.001;

/** What a part is doing at this instant (all optional). */
export interface PartLive {
  /** 0..1: powered / running / lit */
  on?: number;
  /** 0..1: soil moisture, water level, fill */
  level?: number;
  /** text on a display */
  text?: string;
  /** LED colour */
  color?: string;
}
export type LiveFn = () => PartLive | undefined;

const none: LiveFn = () => undefined;

function Pcb({ w, d, color = "#1d3f8f" }: { w: number; d: number; color?: string }) {
  return (
    <mesh position={[0, 0.8 * MM, 0]} castShadow receiveShadow>
      <boxGeometry args={[w, 1.6 * MM, d]} />
      <meshPhysicalMaterial color={color} roughness={0.55} />
    </mesh>
  );
}

/** Capacitive / resistive soil probe: a vertical board whose tip goes into the soil. */
export function SoilProbe({ x, y, resistive = false }: { x: number; y: number; resistive?: boolean }) {
  return (
    <group>
      <mesh position={[0, y / 2, 0]} castShadow>
        <boxGeometry args={[x, y, 1.6 * MM]} />
        <meshPhysicalMaterial color={resistive ? "#1f4fd6" : "#15181d"} roughness={0.5} />
      </mesh>
      {/* sensing area / tines */}
      {resistive ? (
        [1, -1].map((s) => (
          <mesh key={s} position={[s * x * 0.28, y * 0.3, 1 * MM]}>
            <boxGeometry args={[x * 0.18, y * 0.55, 0.3 * MM]} />
            <meshPhysicalMaterial color="#d9c27a" metalness={1} roughness={0.3} />
          </mesh>
        ))
      ) : (
        <mesh position={[0, y * 0.32, 0.9 * MM]}>
          <boxGeometry args={[x * 0.7, y * 0.5, 0.2 * MM]} />
          <meshPhysicalMaterial color="#2a2e35" roughness={0.3} clearcoat={1} />
        </mesh>
      )}
      {/* electronics at the top */}
      <mesh position={[0, y * 0.88, 1.6 * MM]}>
        <boxGeometry args={[x * 0.45, y * 0.08, 1.4 * MM]} />
        <meshPhysicalMaterial color="#121418" />
      </mesh>
      <mesh position={[0, y - 1.5 * MM, 0]}>
        <boxGeometry args={[x * 0.6, 3 * MM, 2.5 * MM]} />
        <meshPhysicalMaterial color="#f2f2f0" roughness={0.6} />
      </mesh>
    </group>
  );
}

export function LevelSensor({ x, y, z }: { x: number; y: number; z: number }) {
  const strip = z < 5 * MM;
  return strip ? (
    <group>
      <mesh position={[0, y / 2, 0]} castShadow>
        <boxGeometry args={[x, y, 1.6 * MM]} />
        <meshPhysicalMaterial color="#c0392b" roughness={0.5} />
      </mesh>
      {Array.from({ length: 10 }).map((_, i) => (
        <mesh key={i} position={[0, y * (0.15 + i * 0.06), 0.85 * MM]}>
          <boxGeometry args={[x * 0.75, 0.8 * MM, 0.1 * MM]} />
          <meshPhysicalMaterial color="#d9c27a" metalness={1} roughness={0.3} />
        </mesh>
      ))}
    </group>
  ) : (
    <group>
      <mesh position={[0, y * 0.75, 0]} castShadow>
        <cylinderGeometry args={[2 * MM, 2 * MM, y * 0.5, 12]} />
        <meshPhysicalMaterial color="#e8e8e8" roughness={0.4} />
      </mesh>
      <mesh position={[0, y * 0.3, 0]} castShadow>
        <cylinderGeometry args={[x / 2, x / 2, y * 0.35, 24]} />
        <meshPhysicalMaterial color="#f2f2f0" roughness={0.45} />
      </mesh>
    </group>
  );
}

export function DhtSensor({ x, y, z }: { x: number; y: number; z: number }) {
  return (
    <group>
      <RoundedBox args={[x, y, z]} radius={1 * MM} smoothness={2} position={[0, y / 2, 0]} castShadow>
        <meshPhysicalMaterial color="#f4f4f2" roughness={0.55} />
      </RoundedBox>
      {Array.from({ length: 4 }).flatMap((_, r) =>
        Array.from({ length: 3 }).map((__, c) => (
          <mesh key={`${r}${c}`} position={[(c - 1) * x * 0.25, y * (0.35 + r * 0.14), z / 2 + 0.05 * MM]}>
            <planeGeometry args={[x * 0.16, y * 0.08]} />
            <meshStandardMaterial color="#9aa0a8" />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Relay module: blue relay cube, screw terminal, and an LED that lights when the relay is on. */
export function Relay({ x, z, channels, live = none }: { x: number; z: number; channels: number; live?: LiveFn }) {
  const led = useRef<THREE.MeshStandardMaterial>(null);
  const click = useRef<THREE.Group>(null);
  useFrame(() => {
    const on = live()?.on ?? 0;
    if (led.current) led.current.emissiveIntensity = on > 0.5 ? 3 : 0.05;
    if (click.current) click.current.position.y = on > 0.5 ? -0.2 * MM : 0;
  });
  return (
    <group>
      <Pcb w={x} d={z} color="#1d3f8f" />
      {Array.from({ length: channels }).map((_, i) => (
        <group key={i} position={[x * 0.05, 0, (i - (channels - 1) / 2) * (z / channels)]} ref={i === 0 ? click : undefined}>
          <RoundedBox args={[19 * MM, 15 * MM, 15 * MM]} radius={0.8 * MM} smoothness={2} position={[0, 9 * MM, 0]} castShadow>
            <meshPhysicalMaterial color="#1f5fd6" roughness={0.35} clearcoat={0.4} />
          </RoundedBox>
        </group>
      ))}
      <mesh position={[x / 2 - 4 * MM, 5 * MM, 0]} castShadow>
        <boxGeometry args={[7.5 * MM, 8 * MM, z * 0.6]} />
        <meshPhysicalMaterial color="#1e7a3c" roughness={0.5} />
      </mesh>
      <mesh position={[-x / 2 + 6 * MM, 2.4 * MM, z * 0.3]}>
        <boxGeometry args={[2 * MM, 1.2 * MM, 1.4 * MM]} />
        <meshStandardMaterial ref={led} color="#ff3b30" emissive="#ff3b30" emissiveIntensity={0.05} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Mini submersible pump: black body, outlet nozzle; it buzzes (vibrates) while running. */
export function PumpMini({ x, y, z, live = none }: { x: number; y: number; z: number; live?: LiveFn }) {
  const body = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const on = live()?.on ?? 0;
    if (body.current) body.current.position.x = on > 0.1 ? Math.sin(clock.elapsedTime * 90) * 0.25 * MM : 0;
  });
  return (
    <group ref={body}>
      <mesh position={[0, y * 0.45, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[z / 2, z / 2, x * 0.75, 28]} />
        <meshPhysicalMaterial color="#17191d" roughness={0.5} />
      </mesh>
      <mesh position={[x * 0.38, y * 0.45, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[z * 0.32, z * 0.4, x * 0.12, 24]} />
        <meshPhysicalMaterial color="#202328" roughness={0.6} />
      </mesh>
      {/* outlet */}
      <mesh position={[x * 0.1, y * 0.95, 0]} castShadow>
        <cylinderGeometry args={[3.2 * MM, 3.2 * MM, y * 0.35, 16]} />
        <meshPhysicalMaterial color="#17191d" roughness={0.5} />
      </mesh>
      {/* suction slots */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-x * 0.38, y * (0.3 + i * 0.12), 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[z * 0.6, 1 * MM]} />
          <meshStandardMaterial color="#05060a" />
        </mesh>
      ))}
    </group>
  );
}

export function Pump12({ x, y, live = none }: { x: number; y: number; live?: LiveFn }) {
  const body = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const on = live()?.on ?? 0;
    if (body.current) body.current.position.y = on > 0.1 ? Math.sin(clock.elapsedTime * 70) * 0.2 * MM : 0;
  });
  return (
    <group ref={body}>
      <mesh position={[-x * 0.15, y / 2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[y * 0.45, y * 0.45, x * 0.55, 28]} />
        <meshPhysicalMaterial color="#c9ced6" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[x * 0.32, y / 2, 0]} castShadow>
        <boxGeometry args={[x * 0.3, y * 0.95, y * 0.95]} />
        <meshPhysicalMaterial color="#1b1e23" roughness={0.45} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[x * 0.42, y * 0.95, s * y * 0.22]} castShadow>
          <cylinderGeometry args={[3 * MM, 3 * MM, 10 * MM, 14]} />
          <meshPhysicalMaterial color="#1b1e23" roughness={0.45} />
        </mesh>
      ))}
    </group>
  );
}

export function Solenoid({ x, y, z, live = none }: { x: number; y: number; z: number; live?: LiveFn }) {
  const coil = useRef<THREE.MeshPhysicalMaterial>(null);
  useFrame(() => {
    const on = live()?.on ?? 0;
    if (coil.current) coil.current.emissiveIntensity = on > 0.5 ? 0.25 : 0;
  });
  return (
    <group>
      <mesh position={[0, y * 0.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[z * 0.3, z * 0.3, x, 24]} />
        <meshPhysicalMaterial color="#c9a24a" metalness={1} roughness={0.3} />
      </mesh>
      <mesh position={[0, y * 0.65, 0]} castShadow>
        <boxGeometry args={[x * 0.42, y * 0.55, z * 0.8]} />
        <meshPhysicalMaterial ref={coil} color="#15171b" roughness={0.5} emissive="#ff6a1a" emissiveIntensity={0} />
      </mesh>
    </group>
  );
}

/** Piezo buzzer: pulses rings of "sound" while it's beeping. */
export function Buzzer({ x, y, live = none }: { x: number; y: number; live?: LiveFn }) {
  const rings = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const on = live()?.on ?? 0;
    const g = rings.current;
    if (!g) return;
    g.visible = on > 0.5;
    g.children.forEach((m, i) => {
      const k = ((clock.elapsedTime * 2 + i / 3) % 1) as number;
      m.scale.setScalar(1 + k * 4);
      ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k);
    });
  });
  return (
    <group>
      <mesh position={[0, y / 2, 0]} castShadow>
        <cylinderGeometry args={[x / 2, x / 2, y, 28]} />
        <meshPhysicalMaterial color="#121418" roughness={0.45} />
      </mesh>
      <mesh position={[0, y + 0.05 * MM, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[x * 0.12, 16]} />
        <meshStandardMaterial color="#000" />
      </mesh>
      <group ref={rings} position={[0, y + 1 * MM, 0]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[x * 0.5, x * 0.56, 32]} />
            <meshBasicMaterial color="#2dd4ff" transparent opacity={0.5} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** 5 mm LED with legs; glows in its colour when on. */
export function Led({ y, color = "#ff3b30", live = none }: { y: number; color?: string; live?: LiveFn }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(() => {
    const s = live();
    const on = s?.on ?? 0;
    const c = s?.color ?? color;
    if (mat.current) {
      mat.current.color.set(c);
      mat.current.emissive.set(c);
      mat.current.emissiveIntensity = on > 0.05 ? 1 + on * 3 : 0.05;
    }
    if (light.current) {
      light.current.color.set(c);
      light.current.intensity = on * 0.04;
    }
  });
  return (
    <group>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 1.2 * MM, y * 0.22, 0]}>
          <cylinderGeometry args={[0.25 * MM, 0.25 * MM, y * 0.45, 6]} />
          <meshPhysicalMaterial color="#c9ced6" metalness={1} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, y * 0.62, 0]} castShadow>
        <capsuleGeometry args={[2.5 * MM, 3 * MM, 6, 16]} />
        <meshStandardMaterial ref={mat} color={color} emissive={color} emissiveIntensity={0.05} transparent opacity={0.92} toneMapped={false} />
      </mesh>
      <pointLight ref={light} position={[0, y, 0]} distance={0.12} intensity={0} />
    </group>
  );
}

export function Fan({ x, y, live = none }: { x: number; y: number; live?: LiveFn }) {
  const rotor = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const on = live()?.on ?? 0;
    if (rotor.current) rotor.current.rotation.y += on * dt * 60;
  });
  return (
    <group>
      <RoundedBox args={[x, y, x]} radius={2 * MM} smoothness={2} position={[0, y / 2, 0]} castShadow>
        <meshPhysicalMaterial color="#1a1d22" roughness={0.5} transparent opacity={0.35} />
      </RoundedBox>
      <group ref={rotor} position={[0, y / 2, 0]}>
        <mesh>
          <cylinderGeometry args={[x * 0.16, x * 0.16, y * 0.9, 20]} />
          <meshPhysicalMaterial color="#202328" roughness={0.5} />
        </mesh>
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={i} rotation={[0.35, (i / 7) * Math.PI * 2, 0]} position={[Math.cos((i / 7) * Math.PI * 2) * x * 0.27, 0, -Math.sin((i / 7) * Math.PI * 2) * x * 0.27]}>
            <boxGeometry args={[x * 0.24, 0.8 * MM, x * 0.12]} />
            <meshPhysicalMaterial color="#202328" roughness={0.5} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function Potentiometer({ x, y }: { x: number; y: number }) {
  return (
    <group>
      <mesh position={[0, y * 0.2, 0]} castShadow>
        <boxGeometry args={[x * 0.9, y * 0.4, x * 0.9]} />
        <meshPhysicalMaterial color="#1f4fd6" roughness={0.5} />
      </mesh>
      <mesh position={[0, y * 0.7, 0]} castShadow>
        <cylinderGeometry args={[x * 0.35, x * 0.38, y * 0.6, 24]} />
        <meshPhysicalMaterial color="#15171b" roughness={0.6} />
      </mesh>
    </group>
  );
}

/** 16×2 LCD whose screen shows the display's current text, drawn into a canvas texture. */
export function Lcd({ x, z, live = none }: { x: number; z: number; live?: LiveFn }) {
  const screen = useRef<THREE.MeshBasicMaterial>(null);
  const state = useRef<{ canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; text: string } | null>(null);
  useFrame(() => {
    const m = screen.current;
    if (!m || typeof document === "undefined") return;
    let st = state.current;
    if (!st) {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 80;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      st = { canvas, tex, text: "" };
      state.current = st;
      m.map = tex;
      m.color.set("#ffffff");
      m.needsUpdate = true;
    }
    const text = live()?.text ?? "RoboCraft\nready";
    if (text === st.text) return;
    st.text = text;
    const ctx = st.canvas.getContext("2d")!;
    ctx.fillStyle = "#3b7bd4";
    ctx.fillRect(0, 0, 320, 80);
    ctx.fillStyle = "#e9f2ff";
    ctx.font = "600 26px ui-monospace, Menlo, monospace";
    const [a, b] = text.split("\n");
    ctx.fillText((a ?? "").slice(0, 16), 14, 34);
    ctx.fillText((b ?? "").slice(0, 16), 14, 68);
    st.tex.needsUpdate = true;
  });
  useEffect(() => () => state.current?.tex.dispose(), []);
  return (
    <group>
      <Pcb w={x} d={z} color="#1e7a3c" />
      <mesh position={[0, 5 * MM, 0]} castShadow>
        <boxGeometry args={[x * 0.88, 7 * MM, z * 0.7]} />
        <meshPhysicalMaterial color="#111317" roughness={0.6} />
      </mesh>
      <mesh position={[0, 8.6 * MM, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[x * 0.8, z * 0.55]} />
        <meshBasicMaterial ref={screen} color="#3b7bd4" toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Plant pot: tapered pot, soil that darkens as it gets wet, and a plant that perks up. */
export function PlantPot({ x, y, live = none }: { x: number; y: number; live?: LiveFn }) {
  const soil = useRef<THREE.MeshPhysicalMaterial>(null);
  const plant = useRef<THREE.Group>(null);
  const dry = useMemo(() => new THREE.Color("#a3835c"), []);
  const wet = useMemo(() => new THREE.Color("#3d2a1b"), []);
  useFrame(() => {
    // Soil looks dark long before it's saturated: darken through the 20-45 % range.
    const raw = Math.max(0, Math.min(1, live()?.level ?? 0.5));
    const m = THREE.MathUtils.smoothstep(raw, 0.2, 0.45);
    if (soil.current) {
      soil.current.color.copy(dry).lerp(wet, m);
      soil.current.roughness = 0.95 - m * 0.4;
    }
    // Leaves droop when dry and lift when watered.
    if (plant.current) plant.current.children.forEach((l, i) => (l.rotation.z = (i % 2 ? -1 : 1) * (0.5 + (1 - m) * 0.7)));
  });
  return (
    <group>
      <mesh position={[0, y / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[x / 2, x * 0.38, y, 40, 1, true]} />
        <meshPhysicalMaterial color="#c2643c" roughness={0.75} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, y - 2 * MM, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[x / 2, 3 * MM, 10, 40]} />
        <meshPhysicalMaterial color="#b35a35" roughness={0.75} />
      </mesh>
      <mesh position={[0, y * 0.88, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[x * 0.47, 40]} />
        <meshPhysicalMaterial ref={soil} color="#a3835c" roughness={0.95} />
      </mesh>
      <group ref={plant} position={[0, y * 0.88, 0]}>
        {Array.from({ length: 6 }).map((_, i) => (
          <group key={i} rotation={[0, (i / 6) * Math.PI * 2, 0]}>
            <mesh position={[0, x * 0.22, 0]} castShadow>
              <capsuleGeometry args={[x * 0.035, x * 0.38, 4, 10]} />
              <meshPhysicalMaterial color="#3f9d4b" roughness={0.6} sheen={0.5} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/** Clear water reservoir whose water level follows the simulation. */
export function Reservoir({ x, y, z, live = none }: { x: number; y: number; z: number; live?: LiveFn }) {
  const water = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const l = Math.max(0.02, Math.min(1, live()?.level ?? 0.8));
    if (water.current) {
      water.current.scale.y = l;
      water.current.position.y = (y * 0.9 * l) / 2 + 2 * MM;
    }
  });
  return (
    <group>
      <RoundedBox args={[x, y, z]} radius={6 * MM} smoothness={3} position={[0, y / 2, 0]} castShadow>
        <meshPhysicalMaterial color="#eaf6ff" roughness={0.05} transparent opacity={0.28} clearcoat={1} />
      </RoundedBox>
      <mesh ref={water} position={[0, y * 0.4, 0]}>
        <boxGeometry args={[x * 0.92, y * 0.9, z * 0.92]} />
        <meshPhysicalMaterial color="#3aa0ff" roughness={0.1} transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

export function TubeCoil({ x }: { x: number }) {
  return (
    <mesh position={[0, 5 * MM, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <torusGeometry args={[x * 0.35, 3.5 * MM, 12, 40]} />
      <meshPhysicalMaterial color="#e9f2f7" roughness={0.3} transparent opacity={0.7} />
    </mesh>
  );
}
