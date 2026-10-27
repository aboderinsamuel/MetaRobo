"use client";

// 3D models of the parts in the library. Each look is built at real scale (metres) from simple
// primitives, so swapping a part in the lab visibly changes the machine.
import { Edges, Line, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CheckLevel } from "@/lib/lab/hardware/build";
import { batteryDims, boardDims, driverDims, motorDims } from "@/lib/lab/hardware/dims";
import type { Battery, Board, Driver, GearMotor, Sensor, SlotId } from "@/lib/lab/hardware/parts";

type V3 = [number, number, number];

// ---------------------------------------------------------------------------
// Selection and status context
// ---------------------------------------------------------------------------

export interface PartStatus {
  level: CheckLevel;
  callout?: string;
}

export interface SceneCtx {
  selected: SlotId | null;
  status: Partial<Record<SlotId, PartStatus>>;
  onSelect: (slot: SlotId | null) => void;
  labels: boolean;
  /** 0..1 load per slot, updated every frame by the rig (motor current / rating etc.). */
  load: React.RefObject<Partial<Record<SlotId, number>>>;
}

export const Scene = createContext<SceneCtx | null>(null);
export const useScene = () => useContext(Scene)!;

const LEVEL_COLOR: Record<CheckLevel, string> = { pass: "#4ade80", info: "#3ff0ff", warn: "#ffb020", error: "#ff4d5e" };

/**
 * Text drawn into a canvas texture on a sprite. It stays inside the WebGL scene, so mounting
 * and unmounting the view never creates or tears down extra React roots.
 */
export function Label({
  text,
  position,
  size = 0.018,
  color = "#eceef2",
  box = true,
  border = "rgba(255,255,255,0.22)",
  bg = "rgba(4,5,6,0.82)",
}: {
  text: string;
  position: V3;
  size?: number;
  color?: string;
  box?: boolean;
  border?: string;
  bg?: string;
}) {
  const { tex, aspect } = useMemo(() => {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    const font = "500 44px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + (box ? 36 : 8);
    c.width = w;
    c.height = 68;
    ctx.font = font;
    if (box) {
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(1, 1, w - 2, 66, 10);
      ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(text, box ? 18 : 4, 36);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { tex: t, aspect: w / 68 };
  }, [text, color, box, border, bg]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={position} scale={[size * aspect, size, 1]} renderOrder={10}>
      <spriteMaterial map={tex} transparent depthTest={false} toneMapped={false} />
    </sprite>
  );
}

/**
 * A clickable part. It draws the selection or warning outline around `size` and pops the check's
 * callout above it, so the 3D view shows exactly which part a check is about.
 */
export function PartSlot({
  slot,
  size,
  center = [0, 0, 0],
  label,
  children,
  calloutAt,
}: {
  slot: SlotId;
  size: V3;
  center?: V3;
  label?: string;
  children: React.ReactNode;
  calloutAt?: V3;
}) {
  const s = useScene();
  const st = s.status[slot];
  const selected = s.selected === slot;
  const bad = st && (st.level === "error" || st.level === "warn");
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = st?.level === "error" ? 0.08 + 0.1 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 6)) : selected ? 0.07 : 0;
  });
  const color = selected ? "#3ff0ff" : bad ? LEVEL_COLOR[st!.level] : "#3ff0ff";
  const pad: V3 = [size[0] + 0.006, size[1] + 0.006, size[2] + 0.006];
  const top: V3 = calloutAt ?? [center[0], center[1] + size[1] / 2 + 0.022, center[2]];
  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        s.onSelect(selected ? null : slot);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      {children}
      {(selected || bad) && (
        <mesh position={center}>
          <boxGeometry args={pad} />
          <meshBasicMaterial ref={mat} color={color} transparent opacity={0} depthWrite={false} toneMapped={false} />
          <Edges color={color} lineWidth={selected ? 1.6 : 1.2} />
        </mesh>
      )}
      {bad && st?.callout && <Label text={`${st.level === "error" ? "✕" : "!"} ${st.callout}`} position={top} size={0.014} color={LEVEL_COLOR[st.level]} border={LEVEL_COLOR[st.level]} />}
      {!bad && selected && label && <Label text={label} position={top} size={0.013} color="#3ff0ff" border="#3ff0ff" />}
      {!bad && !selected && label && s.labels && <Label text={label} position={top} size={0.011} color="#aab2bf" />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------

const Std = ({ color, metal = 0.2, rough = 0.5, emissive, ei = 0 }: { color: string; metal?: number; rough?: number; emissive?: string; ei?: number }) => (
  <meshStandardMaterial color={color} metalness={metal} roughness={rough} emissive={emissive ?? "#000000"} emissiveIntensity={ei} />
);

function Pcb({ w, d, color, t = 0.0016 }: { w: number; d: number; color: string; t?: number }) {
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[w, t, d]} />
      <Std color={color} rough={0.6} />
    </mesh>
  );
}

function Chip({ p, s, color = "#0b0d10" }: { p: V3; s: V3; color?: string }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <Std color={color} rough={0.35} />
    </mesh>
  );
}

function Header({ p, n, along = "x", pitch = 0.00254 }: { p: V3; n: number; along?: "x" | "z"; pitch?: number }) {
  return (
    <group position={p}>
      <mesh>
        <boxGeometry args={along === "x" ? [n * pitch, 0.0025, pitch] : [pitch, 0.0025, n * pitch]} />
        <Std color="#111" />
      </mesh>
      {n <= 20 &&
        Array.from({ length: n }).map((_, i) => (
          <mesh key={i} position={along === "x" ? [(i - (n - 1) / 2) * pitch, 0.002, 0] : [0, 0.002, (i - (n - 1) / 2) * pitch]}>
            <boxGeometry args={[0.0006, 0.003, 0.0006]} />
            <Std color="#d4b25a" metal={0.8} rough={0.3} />
          </mesh>
        ))}
    </group>
  );
}

function Terminal({ p, n, rot = 0 }: { p: V3; n: number; rot?: number }) {
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <mesh>
        <boxGeometry args={[0.0075, 0.009, n * 0.005]} />
        <Std color="#1f6fe0" rough={0.5} />
      </mesh>
      {Array.from({ length: n }).map((_, i) => (
        <mesh key={i} position={[0, 0.0048, (i - (n - 1) / 2) * 0.005]}>
          <cylinderGeometry args={[0.0014, 0.0014, 0.001, 10]} />
          <Std color="#c9ced6" metal={0.8} rough={0.3} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Gearmotors: drawn along +x (shaft at the origin, can extending to −x)
// ---------------------------------------------------------------------------

/** A gearmotor with its shaft at the origin pointing +x. `glow` is a material ref for current. */
export function GearMotorMesh({ motor, glow }: { motor: GearMotor; glow?: React.RefObject<THREE.MeshStandardMaterial | null> }) {
  const { len, r } = motorDims(motor.look);
  const can = (
    <meshStandardMaterial ref={glow} color={motor.look === "37d" ? "#2a2f36" : "#c9ced6"} metalness={0.7} roughness={0.3} emissive="#ff6a1a" emissiveIntensity={0} />
  );
  if (motor.look === "tt") {
    return (
      <group>
        <mesh position={[-0.022, 0, 0]} castShadow>
          <boxGeometry args={[0.045, 0.022, 0.019]} />
          <Std color="#f2c811" rough={0.55} />
        </mesh>
        <mesh position={[-0.052, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.009, 0.009, 0.02, 24]} />
          {can}
        </mesh>
        <mesh position={[0.003, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.0028, 0.0028, 0.01, 6]} />
          <Std color="#f4f4f4" />
        </mesh>
      </group>
    );
  }
  const gearLen = motor.look === "n20" ? len * 0.35 : len * 0.42;
  const canLen = len - gearLen;
  return (
    <group>
      {/* gearbox */}
      <mesh position={[-gearLen / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        {motor.look === "n20" ? <boxGeometry args={[r * 2, gearLen, r * 1.7]} /> : <cylinderGeometry args={[r * 1.02, r * 1.02, gearLen, 32]} />}
        <Std color={motor.look === "pg45" || motor.look === "37d" ? "#3a3f47" : "#c8a24a"} metal={0.8} rough={0.3} />
      </mesh>
      {/* motor can */}
      <mesh position={[-gearLen - canLen / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[r * 0.95, r * 0.95, canLen, 32]} />
        {can}
      </mesh>
      {/* end cap */}
      <mesh position={[-len - 0.0015, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r * 0.8, r * 0.8, 0.003, 24]} />
        <Std color="#20252c" />
      </mesh>
      {/* shaft */}
      <mesh position={[0.006, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[Math.max(0.0015, r * 0.2), Math.max(0.0015, r * 0.2), 0.012, 12]} />
        <Std color="#dfe3e8" metal={0.9} rough={0.2} />
      </mesh>
      {/* power tabs */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[-len - 0.003, s * r * 0.4, 0]}>
          <boxGeometry args={[0.003, 0.0015, 0.002]} />
          <Std color="#d4b25a" metal={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Wheels
// ---------------------------------------------------------------------------

export function Wheel({ r, w, spin, hub = "#3dd6ec" }: { r: number; w: number; spin?: React.RefObject<THREE.Group | null>; hub?: string }) {
  return (
    <group ref={spin}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[r, r, w, 48]} />
        <Std color="#111821" rough={0.9} />
      </mesh>
      {/* tread */}
      {Array.from({ length: 18 }).map((_, i) => {
        const a = (i / 18) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * r, Math.sin(a) * r, 0]} rotation={[0, 0, a]}>
            <boxGeometry args={[0.0018, r * 0.18, w * 0.95]} />
            <Std color="#1b2430" rough={0.9} />
          </mesh>
        );
      })}
      {[1, -1].map((side) => (
        <group key={side} position={[0, 0, (side * w) / 2 + side * 0.0006]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[r * 0.66, r * 0.66, 0.0012, 32]} />
            <Std color="#9aa6b6" metal={0.5} rough={0.35} />
          </mesh>
          {[0, 1, 2].map((k) => (
            <mesh key={k} rotation={[0, 0, (k * Math.PI) / 3]} position={[0, 0, side * 0.0008]}>
              <boxGeometry args={[r * 1.2, r * 0.13, 0.001]} />
              <meshStandardMaterial color={hub} emissive={hub} emissiveIntensity={0.5} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Batteries (centred, sitting on y = 0)
// ---------------------------------------------------------------------------


export function BatteryMesh({ battery }: { battery: Battery }) {
  const [w, h, d] = batteryDims(battery);
  if (battery.look === "aa") {
    return (
      <group>
        <mesh position={[0, 0.003, 0]} castShadow>
          <boxGeometry args={[w, 0.006, d]} />
          <Std color="#121418" />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[0, 0.0085, (i - 1.5) * 0.0145]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.007, 0.007, 0.05, 20]} />
            <Std color={i % 2 ? "#2a8a4a" : "#1d7a3e"} rough={0.4} />
          </mesh>
        ))}
      </group>
    );
  }
  if (battery.look === "18650") {
    const n = battery.cells && battery.cells >= 6 ? 6 : 2;
    return (
      <group>
        <mesh position={[0, 0.002, 0]} castShadow>
          <boxGeometry args={[w, 0.004, d]} />
          <Std color="#121418" />
        </mesh>
        {Array.from({ length: n }).map((_, i) => (
          <mesh key={i} position={[0, 0.0115 + (n > 2 ? Math.floor(i / 3) * 0.019 : 0), ((n > 2 ? i % 3 : i) - (n > 2 ? 1 : 0.5)) * 0.019]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.009, 0.009, 0.065, 24]} />
            <Std color="#1f4fd6" rough={0.35} metal={0.1} />
          </mesh>
        ))}
      </group>
    );
  }
  if (battery.look === "lipo") {
    return (
      <group>
        <RoundedBox args={[w, h, d]} radius={0.003} smoothness={3} position={[0, h / 2, 0]} castShadow>
          <Std color="#2b2f36" rough={0.45} metal={0.3} />
        </RoundedBox>
        <mesh position={[0, h / 2, d / 2 + 0.0002]}>
          <planeGeometry args={[w * 0.8, h * 0.7]} />
          <meshStandardMaterial color="#f2c811" roughness={0.6} />
        </mesh>
        <mesh position={[0, h + 0.0003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[w * 0.6, d * 0.5]} />
          <meshStandardMaterial color="#e94d4d" roughness={0.6} />
        </mesh>
        {/* XT60 lead */}
        {["#d92020", "#111111"].map((c, i) => (
          <mesh key={c} position={[w / 2 + 0.008, h * 0.5, (i - 0.5) * 0.006]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.0018, 0.0018, 0.018, 8]} />
            <Std color={c} />
          </mesh>
        ))}
        <mesh position={[w / 2 + 0.019, h * 0.5, 0]}>
          <boxGeometry args={[0.008, 0.008, 0.015]} />
          <Std color="#e8c51a" />
        </mesh>
      </group>
    );
  }
  // Mains adapter: a barrel jack and a lead running off the base.
  return (
    <group>
      <mesh position={[0, 0.005, 0]} castShadow>
        <boxGeometry args={[0.014, 0.01, 0.01]} />
        <Std color="#15181d" />
      </mesh>
      <mesh position={[-0.03, 0.004, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.002, 0.002, 0.05, 8]} />
        <Std color="#0b0b0b" />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Boards (centred, lying flat on y = 0)
// ---------------------------------------------------------------------------


export function BoardMesh({ board, led }: { board: Board; led?: React.RefObject<THREE.MeshBasicMaterial | null> }) {
  const [w, , d] = boardDims(board);
  const ledMesh = (p: V3) => (
    <mesh position={p}>
      <boxGeometry args={[0.0018, 0.0008, 0.0012]} />
      <meshBasicMaterial ref={led} color="#4ade80" toneMapped={false} />
    </mesh>
  );
  if (board.form === "uno") {
    return (
      <group position={[0, 0.0008, 0]}>
        <Pcb w={w} d={d} color={board.color} />
        <Chip p={[0.008, 0.003, 0.004]} s={[0.035, 0.004, 0.009]} />
        <mesh position={[-w / 2 + 0.008, 0.006, d / 2 - 0.012]}>
          <boxGeometry args={[0.016, 0.011, 0.012]} />
          <Std color="#c9ced6" metal={0.8} rough={0.3} />
        </mesh>
        <mesh position={[-w / 2 + 0.007, 0.0055, -d / 2 + 0.01]}>
          <boxGeometry args={[0.014, 0.011, 0.009]} />
          <Std color="#111" />
        </mesh>
        <Header p={[0.005, 0.002, d / 2 - 0.002]} n={18} />
        <Header p={[0.01, 0.002, -d / 2 + 0.002]} n={14} />
        {ledMesh([0.02, 0.0015, d / 2 - 0.01])}
      </group>
    );
  }
  if (board.form === "esp32") {
    return (
      <group position={[0, 0.0008, 0]}>
        <Pcb w={w} d={d} color={board.color} />
        <mesh position={[0.008, 0.0024, 0]}>
          <boxGeometry args={[0.018, 0.0032, 0.016]} />
          <Std color="#b9c0ca" metal={0.85} rough={0.25} />
        </mesh>
        <mesh position={[0.021, 0.0012, 0]}>
          <boxGeometry args={[0.007, 0.0008, 0.016]} />
          <Std color="#0e1a2b" />
        </mesh>
        <Header p={[0, -0.002, d / 2 - 0.0013]} n={19} />
        <Header p={[0, -0.002, -d / 2 + 0.0013]} n={19} />
        <mesh position={[-w / 2 + 0.003, 0.0018, 0]}>
          <boxGeometry args={[0.006, 0.003, 0.008]} />
          <Std color="#c9ced6" metal={0.8} />
        </mesh>
        {ledMesh([-0.012, 0.0012, 0.008])}
      </group>
    );
  }
  if (board.form === "fc") {
    return (
      <group position={[0, 0.0008, 0]}>
        <Pcb w={w} d={d} color={board.color} />
        <Chip p={[0, 0.0012, 0]} s={[0.01, 0.0012, 0.01]} />
        {[1, -1].flatMap((sx) =>
          [1, -1].map((sz) => (
            <mesh key={`${sx}${sz}`} position={[(sx * w) / 2 - sx * 0.0035, 0, (sz * d) / 2 - sz * 0.0035]}>
              <cylinderGeometry args={[0.0018, 0.0018, 0.0022, 12]} />
              <Std color="#d4b25a" metal={0.9} />
            </mesh>
          )),
        )}
        {ledMesh([0.01, 0.0012, -0.01])}
      </group>
    );
  }
  return (
    <group position={[0, 0.0008, 0]}>
      <Pcb w={w} d={d} color={board.color} />
      <Chip p={[0, 0.0015, 0]} s={[w * 0.2, 0.0015, d * 0.4]} />
      <Header p={[0, -0.002, d / 2 - 0.0013]} n={Math.round(w / 0.00254)} />
      <Header p={[0, -0.002, -d / 2 + 0.0013]} n={Math.round(w / 0.00254)} />
      <mesh position={[-w / 2 + 0.003, 0.0016, 0]}>
        <boxGeometry args={[0.006, 0.0028, 0.008]} />
        <Std color="#c9ced6" metal={0.8} />
      </mesh>
      {ledMesh([w * 0.3, 0.0012, 0])}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Motor drivers (centred, flat)
// ---------------------------------------------------------------------------


export function DriverMesh({ driver, heat }: { driver: Driver; heat?: React.RefObject<THREE.MeshStandardMaterial | null> }) {
  const [w, , d] = driverDims(driver);
  const sink = (h: number, ww: number, dd: number, p: V3) => (
    <group position={p}>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[ww, h * 0.2, dd]} />
        <meshStandardMaterial ref={heat} color="#1a1d22" metalness={0.6} roughness={0.4} emissive="#ff4d1a" emissiveIntensity={0} />
      </mesh>
      {Array.from({ length: 7 }).map((_, i) => (
        <mesh key={i} position={[(i - 3) * (ww / 7), h * 0.55, 0]}>
          <boxGeometry args={[ww / 16, h * 0.9, dd]} />
          <Std color="#1a1d22" metal={0.6} rough={0.4} />
        </mesh>
      ))}
    </group>
  );
  if (driver.look === "l298n") {
    return (
      <group position={[0, 0.0008, 0]}>
        <Pcb w={w} d={d} color="#b8141f" />
        {sink(0.024, 0.023, 0.016, [0, 0.001, -0.008])}
        <Terminal p={[-w / 2 + 0.004, 0.0045, 0.008]} n={2} />
        <Terminal p={[w / 2 - 0.004, 0.0045, 0.008]} n={2} />
        <Terminal p={[0, 0.0045, d / 2 - 0.004]} n={3} rot={Math.PI / 2} />
        <Header p={[0.004, 0.002, d / 2 - 0.011]} n={6} />
        <mesh position={[0.013, 0.004, 0.008]}>
          <cylinderGeometry args={[0.004, 0.004, 0.008, 16]} />
          <Std color="#1f2a6b" />
        </mesh>
      </group>
    );
  }
  if (driver.look === "tb6612") {
    return (
      <group position={[0, 0.0008, 0]}>
        <Pcb w={w} d={d} color="#5b2a86" />
        <Chip p={[0, 0.0012, 0]} s={[0.006, 0.0012, 0.008]} />
        <Header p={[0, -0.002, d / 2 - 0.0013]} n={8} />
        <Header p={[0, -0.002, -d / 2 + 0.0013]} n={8} />
      </group>
    );
  }
  if (driver.look === "bts7960") {
    return (
      <group position={[0, 0.0008, 0]}>
        <Pcb w={w} d={d} color="#b8141f" />
        {sink(0.026, 0.044, 0.044, [0, 0.001, 0])}
        <Terminal p={[-w / 2 + 0.004, 0.0045, 0]} n={4} />
      </group>
    );
  }
  if (driver.look === "esc") {
    return (
      <group position={[0, 0.0008, 0]}>
        <Pcb w={w} d={d} color="#15171b" />
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[((i % 2) - 0.5) * 0.016, 0.0014, (Math.floor(i / 2) - 0.5) * 0.016]}>
            <boxGeometry args={[0.008, 0.0014, 0.008]} />
            <meshStandardMaterial ref={i === 0 ? heat : undefined} color="#0b0d10" emissive="#ff4d1a" emissiveIntensity={0} />
          </mesh>
        ))}
      </group>
    );
  }
  return (
    <group position={[0, 0.0008, 0]}>
      <Pcb w={w} d={d} color="#b8141f" />
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.02, 0.004, 0]}>
          <boxGeometry args={[0.012, 0.006, 0.02]} />
          <meshStandardMaterial ref={s === 1 ? heat : undefined} color="#0b0d10" emissive="#ff4d1a" emissiveIntensity={0} />
        </mesh>
      ))}
      <Terminal p={[-w / 2 + 0.005, 0.0045, 0]} n={6} />
      <Terminal p={[w / 2 - 0.005, 0.0045, 0]} n={2} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------

export function SensorMesh({ sensor }: { sensor: Sensor }) {
  switch (sensor.look) {
    case "sonar":
      return (
        <group>
          <mesh>
            <boxGeometry args={[0.045, 0.02, 0.0016]} />
            <Std color="#1f4fd6" />
          </mesh>
          {[-0.013, 0.013].map((x) => (
            <mesh key={x} position={[x, 0, 0.006]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.008, 0.008, 0.012, 24]} />
              <Std color="#a8b1bd" metal={0.7} rough={0.3} />
            </mesh>
          ))}
        </group>
      );
    case "tof":
      return (
        <group>
          <mesh>
            <boxGeometry args={[0.013, 0.0016, 0.018]} />
            <Std color="#15181d" />
          </mesh>
          <mesh position={[0, -0.0012, 0]}>
            <boxGeometry args={[0.0045, 0.001, 0.0025]} />
            <meshBasicMaterial color="#ff4d5e" toneMapped={false} />
          </mesh>
        </group>
      );
    case "hall":
    case "optical":
      return (
        <group>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[sensor.look === "optical" ? 0.011 : 0.008, sensor.look === "optical" ? 0.011 : 0.008, 0.0012, 32]} />
            <Std color={sensor.look === "optical" ? "#ccd3dc" : "#2b2f36"} metal={0.4} />
          </mesh>
          <mesh position={[-0.003, 0.006, 0]}>
            <boxGeometry args={[0.004, 0.012, 0.014]} />
            <Std color={sensor.look === "optical" ? "#15181d" : "#1f7a3a"} />
          </mesh>
        </group>
      );
    default: {
      const color = sensor.look === "mpu" ? "#1f4fd6" : sensor.look === "bno" || sensor.look === "magnetic" || sensor.look === "baro" ? "#5b2a86" : "#15181d";
      return (
        <group>
          <Pcb w={0.02} d={0.016} color={color} />
          <Chip p={[0, 0.0012, 0]} s={[0.004, 0.001, 0.004]} />
          <Header p={[0, -0.002, -0.0065]} n={6} />
        </group>
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Wires with animated current flow
// ---------------------------------------------------------------------------

export function Wire({ points, color, flow, width = 1.6 }: { points: V3[]; color: string; flow?: () => number; width?: number }) {
  const ref = useRef<{ material: { dashOffset: number } } | null>(null);
  useFrame((_, delta) => {
    if (!flow || !ref.current) return;
    ref.current.material.dashOffset -= delta * flow() * 0.06;
  });
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Line ref={ref as any} points={points} color={color} lineWidth={width} dashed={!!flow} dashSize={0.006} gapSize={0.004} transparent opacity={0.95} />
  );
}

export function curve(a: V3, b: V3, lift = 0.02, n = 16): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + Math.sin(Math.PI * t) * lift, a[2] + (b[2] - a[2]) * t]);
  }
  return pts;
}

/** A dimension line with end ticks and a label, like a drawing. */
export function Dimension({ a, b, text, offset = [0, 0, 0] as V3 }: { a: V3; b: V3; text: string; offset?: V3 }) {
  const A: V3 = [a[0] + offset[0], a[1] + offset[1], a[2] + offset[2]];
  const B: V3 = [b[0] + offset[0], b[1] + offset[1], b[2] + offset[2]];
  const mid: V3 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + 0.008, (A[2] + B[2]) / 2];
  return (
    <group>
      <Line points={[A, B]} color="#6b7480" lineWidth={1} />
      <Line points={[a, A]} color="#3a414c" lineWidth={1} dashed dashSize={0.003} gapSize={0.003} />
      <Line points={[b, B]} color="#3a414c" lineWidth={1} dashed dashSize={0.003} gapSize={0.003} />
      <Label text={text} position={mid} size={0.011} color="#aab2bf" />
    </group>
  );
}
