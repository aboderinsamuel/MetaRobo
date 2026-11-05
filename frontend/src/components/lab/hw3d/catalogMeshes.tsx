"use client";

// 3D models for every part in the catalogue (lib/lab/catalog/parts.ts) and for fabricated parts.
// Parts the built-in robots already model (gearmotors, boards, drivers, sensors, batteries, wheels)
// reuse those meshes, so AI-designed machines look like the demos.
//
// Origins (also given to Muse Spark):
// - servos: at the output shaft on top of the case; the case hangs below (−y) and extends towards −x
// - DC gearmotors: output shaft at the origin pointing +x
// - steppers: output shaft at the origin pointing +y; the body hangs below
// - wheels: centred, axle along z
// - arm kits: base on y = 0, reaching +x
// - everything else: centred in x/z, sitting on y = 0
import { RoundedBox } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { CatalogPart, FabKind } from "@/lib/lab/catalog/parts";
import { ALTIMETERS, BATTERIES, BOARDS, DRIVERS, GEARMOTORS, IMUS } from "@/lib/lab/hardware/parts";
import type { Board } from "@/lib/lab/hardware/parts";
import { BatteryMesh, BoardMesh, DriverMesh, GearMotorMesh, SensorMesh, Wheel } from "./parts3d";
import { Buzzer, DhtSensor, Fan, Lcd, Led, LevelSensor, PlantPot, Potentiometer, Pump12, PumpMini, Relay, Reservoir, Solenoid, SoilProbe, TubeCoil, type LiveFn } from "./liveMeshes";

const MM = 0.001;

function M({ color, metal = 0, rough = 0.5, clear = 0, opacity = 1 }: { color: string; metal?: number; rough?: number; clear?: number; opacity?: number }) {
  return <meshPhysicalMaterial color={color} metalness={metal} roughness={rough} clearcoat={clear} transparent={opacity < 1} opacity={opacity} envMapIntensity={1.1} />;
}

// Bead-blasted aluminium (servo brackets, horns): matte silver, so it reads from every angle.
const ALU = { color: "#d6dbe1", metal: 0.7, rough: 0.42 };
const DARK = { color: "#23272e", metal: 0.85, rough: 0.38 };

// ---------------------------------------------------------------- servos

function ServoCase({ L, H, W, color, label }: { L: number; H: number; W: number; color: string; label: string }) {
  // Origin at the output shaft (top). The shaft sits ~10 mm from one end of the case.
  const shaftOff = L / 2 - Math.min(10 * MM, L * 0.25);
  const bodyH = H * 0.9;
  return (
    <group>
      <RoundedBox args={[L, bodyH, W]} radius={Math.min(L, W) * 0.05} smoothness={3} position={[-shaftOff, -H * 0.1 - bodyH / 2, 0]} castShadow receiveShadow>
        <M color={color} rough={0.42} clear={0.3} />
      </RoundedBox>
      {/* mounting flange with screw holes */}
      <mesh position={[-shaftOff, -H * 0.28, 0]} castShadow>
        <boxGeometry args={[L * 1.34, 2.4 * MM, W]} />
        <M color={color} rough={0.45} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[-shaftOff + s * L * 0.6, -H * 0.28 + 1.3 * MM, 0]}>
          <cylinderGeometry args={[1.6 * MM, 1.6 * MM, 0.3 * MM, 12]} />
          <meshStandardMaterial color="#0b0d10" />
        </mesh>
      ))}
      {/* label */}
      <mesh position={[-shaftOff, -H * 0.55, W / 2 + 0.05 * MM]}>
        <planeGeometry args={[L * 0.7, H * 0.25]} />
        <meshStandardMaterial color={label} roughness={0.5} />
      </mesh>
      {/* output spline */}
      <mesh position={[0, -H * 0.05, 0]} castShadow>
        <cylinderGeometry args={[W * 0.28, W * 0.32, H * 0.1, 24]} />
        <M color={color} rough={0.4} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[W * 0.13, W * 0.13, H * 0.06, 16]} />
        <M color="#e8e8e8" metal={0.9} rough={0.25} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- generic modules

/** A module PCB: solder-mask board with a chip, headers and passives, sitting on y = 0. */
function ModulePcb({ w, d, color = "#1d6b3a", chip = true, header = true }: { w: number; d: number; color?: string; chip?: boolean; header?: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.8 * MM, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 1.6 * MM, d]} />
        <M color={color} rough={0.55} />
      </mesh>
      {chip && (
        <mesh position={[w * 0.08, 2.4 * MM, 0]} castShadow>
          <boxGeometry args={[Math.min(w, d) * 0.32, 1.4 * MM, Math.min(w, d) * 0.32]} />
          <M color="#121418" rough={0.6} />
        </mesh>
      )}
      {header && (
        <mesh position={[-w / 2 + 2.5 * MM, 4.2 * MM, 0]} castShadow>
          <boxGeometry args={[2.5 * MM, 8.5 * MM, d * 0.85]} />
          <M color="#111" rough={0.6} />
        </mesh>
      )}
      {Array.from({ length: 4 }).map((_, i) => (
        <mesh key={i} position={[w * (0.25 - i * 0.12), 2 * MM, d * 0.32]}>
          <boxGeometry args={[1.6 * MM, 0.8 * MM, 0.8 * MM]} />
          <M color="#b08a5a" rough={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function boardFor(form: Board["form"]): Board {
  return BOARDS.find((b) => b.form === form) ?? BOARDS[0];
}

/** A Raspberry Pi style SBC: green board, SoC with heat spreader, USB/Ethernet stack, GPIO header. */
function PiBoard({ w, d }: { w: number; d: number }) {
  return (
    <group>
      <ModulePcb w={w} d={d} color="#1f7a3a" chip={false} header={false} />
      <mesh position={[-w * 0.12, 2.6 * MM, 0]} castShadow>
        <boxGeometry args={[15 * MM, 1.8 * MM, 15 * MM]} />
        <M {...ALU} rough={0.25} />
      </mesh>
      {[0.32, 0.12, -0.12].map((f, i) => (
        <mesh key={i} position={[w / 2 - 9 * MM, (i === 2 ? 7 : 8) * MM, d * f]} castShadow>
          <boxGeometry args={[18 * MM, (i === 2 ? 13 : 16) * MM, i === 2 ? 16 * MM : 13 * MM]} />
          <M {...ALU} rough={0.28} />
        </mesh>
      ))}
      <mesh position={[-w * 0.05, 4.2 * MM, -d / 2 + 3.5 * MM]} castShadow>
        <boxGeometry args={[51 * MM, 8.5 * MM, 5 * MM]} />
        <M color="#111" rough={0.6} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- structure

function UBracket({ L, H, W }: { L: number; H: number; W: number }) {
  const t = 2 * MM;
  return (
    <group>
      <mesh position={[0, t / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[L * 0.55, t, W]} />
        <M {...ALU} />
      </mesh>
      {[1, -1].map((s) => (
        <RoundedBox key={s} args={[t, H, W]} radius={t * 0.45} smoothness={2} position={[(s * L * 0.55) / 2, H / 2, 0]} castShadow receiveShadow>
          <M {...ALU} />
        </RoundedBox>
      ))}
    </group>
  );
}

function LBracket({ L, H, W }: { L: number; H: number; W: number }) {
  const t = 2 * MM;
  return (
    <group>
      <mesh position={[0, t / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[L, t, W]} />
        <M {...ALU} />
      </mesh>
      <mesh position={[-L / 2 + t / 2, H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, H, W]} />
        <M {...ALU} />
      </mesh>
    </group>
  );
}

function MultiBracket({ L, H, W }: { L: number; H: number; W: number }) {
  // A rectangular frame that grips a standard servo, with a mounting face on one side.
  const t = 2 * MM;
  return (
    <group>
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, H / 2, (s * W) / 2]} castShadow>
          <boxGeometry args={[L, H, t]} />
          <M {...ALU} />
        </mesh>
      ))}
      <mesh position={[-L / 2, H / 2, 0]} castShadow>
        <boxGeometry args={[t, H, W]} />
        <M {...ALU} />
      </mesh>
      <mesh position={[0, t / 2, 0]} castShadow>
        <boxGeometry args={[L, t, W]} />
        <M {...ALU} />
      </mesh>
    </group>
  );
}

/** A rounded-rectangle outline, as a laser cutter would cut it. */
function roundedRect(shape: THREE.Shape | THREE.Path, w: number, d: number, r: number) {
  shape.moveTo(-w / 2 + r, -d / 2);
  shape.lineTo(w / 2 - r, -d / 2);
  shape.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  shape.lineTo(w / 2, d / 2 - r);
  shape.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  shape.lineTo(-w / 2 + r, d / 2);
  shape.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  shape.lineTo(-w / 2, -d / 2 + r);
  shape.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
}

function hole(shape: THREE.Shape, x: number, z: number, r: number) {
  const p = new THREE.Path();
  p.absarc(x, z, r, 0, Math.PI * 2, true);
  shape.holes.push(p);
}

function slot(shape: THREE.Shape, x: number, z: number, len: number, wid: number) {
  const p = new THREE.Path();
  roundedRect(p, len, wid, wid / 2 - 1e-5);
  // roundedRect draws around the origin; shift by rebuilding the points
  const pts = p.getPoints(12).map((v) => new THREE.Vector2(v.x + x, v.y + z));
  shape.holes.push(new THREE.Path(pts.reverse()));
}

/**
 * A laser-cut sheet: the real cut profile with M3 mounting holes along the edges and, on larger
 * plates, lightening slots, extruded to the sheet thickness. Acrylic reads as clear tinted sheet with
 * bright cut edges; plywood has laser-burnt edges.
 */
function Plate({ w, t, d, material }: { w: number; t: number; d: number; material: string }) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape();
    roundedRect(shape, w, d, Math.min(w, d) * 0.08);
    const r = 1.6 * MM; // M3 clearance
    const inset = 5 * MM;
    // Mounting holes every ~25 mm around the edge.
    const along = (len: number) => Math.max(2, Math.min(8, Math.round(len / (25 * MM)) + 1));
    const nx = along(w - 2 * inset);
    const nz = along(d - 2 * inset);
    for (let i = 0; i < nx; i++) {
      const x = -w / 2 + inset + ((w - 2 * inset) * i) / (nx - 1);
      hole(shape, x, -d / 2 + inset, r);
      hole(shape, x, d / 2 - inset, r);
    }
    for (let i = 1; i < nz - 1; i++) {
      const z = -d / 2 + inset + ((d - 2 * inset) * i) / (nz - 1);
      hole(shape, -w / 2 + inset, z, r);
      hole(shape, w / 2 - inset, z, r);
    }
    // Cable / lightening slots on plates big enough to need them.
    if (w > 90 * MM && d > 70 * MM) {
      const sl = Math.min(w * 0.3, 50 * MM);
      for (const z of [-d * 0.18, d * 0.18]) slot(shape, 0, z, sl, 6 * MM);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 10 });
    g.rotateX(Math.PI / 2);
    g.translate(0, t, 0);
    return g;
  }, [w, t, d]);
  const face =
    material === "acrylic"
      ? { color: "#d8eeff", metal: 0, rough: 0.05, clear: 1, opacity: 0.5 }
      : material === "plywood"
        ? { color: "#d2a873", metal: 0, rough: 0.78 }
        : material === "carbon_fiber"
          ? { color: "#1a1c20", metal: 0.3, rough: 0.35, clear: 0.8 }
          : { color: "#c9ced6", metal: 1, rough: 0.35 };
  const edge = material === "acrylic" ? { color: "#f2fbff", metal: 0, rough: 0.1, clear: 1, opacity: 0.85 } : material === "plywood" ? { color: "#3b2414", metal: 0, rough: 0.9 } : face;
  return (
    <mesh geometry={geo} castShadow receiveShadow>
      {/* ExtrudeGeometry: group 0 = the sheet's faces, group 1 = the cut edges */}
      <meshPhysicalMaterial attach="material-0" color={face.color} metalness={face.metal} roughness={face.rough} clearcoat={face.clear ?? 0} transparent={(face.opacity ?? 1) < 1} opacity={face.opacity ?? 1} />
      <meshPhysicalMaterial attach="material-1" color={edge.color} metalness={edge.metal} roughness={edge.rough} clearcoat={edge.clear ?? 0} transparent={(edge.opacity ?? 1) < 1} opacity={edge.opacity ?? 1} />
    </mesh>
  );
}

/** FDM layer lines, as a bump map: one stripe every 0.2 mm layer (drawn coarser so it reads on screen). */
let layerTex: THREE.CanvasTexture | null = null;
function layerLines(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  if (layerTex) return layerTex;
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < 64; y++) {
    const v = 128 + Math.round(70 * Math.sin((y / 64) * Math.PI * 2 * 8));
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, y, 4, 1);
  }
  layerTex = new THREE.CanvasTexture(c);
  layerTex.wrapS = layerTex.wrapT = THREE.RepeatWrapping;
  return layerTex;
}

function PrintMat({ color, height }: { color: string; height: number }) {
  const tex = useMemo(() => {
    const t = layerLines()?.clone();
    if (t) {
      t.needsUpdate = true;
      // 8 stripes per texture repeat; ~0.6 mm per stripe so the layers are visible.
      t.repeat.set(1, Math.max(1, height / (8 * 0.6 * MM)));
    }
    return t ?? null;
  }, [height]);
  return <meshPhysicalMaterial color={color} roughness={0.62} metalness={0} bumpMap={tex ?? undefined} bumpScale={0.6} sheen={0.2} />;
}

/** A thin-walled 3D-printed enclosure: rounded shell, lid split line, screw holes, vent slots. */
function PrintedShell({ a, b, c, color }: { a: number; b: number; c: number; color: string }) {
  const lidY = b * 0.82;
  return (
    <group>
      <RoundedBox args={[a, b, c]} radius={Math.min(a, b, c) * 0.12} smoothness={4} position={[0, b / 2, 0]} castShadow receiveShadow>
        <PrintMat color={color} height={b} />
      </RoundedBox>
      {/* lid split line */}
      <mesh position={[0, lidY, 0]}>
        <boxGeometry args={[a * 1.002, 0.6 * MM, c * 1.002]} />
        <meshStandardMaterial color="#0d0f12" roughness={0.9} />
      </mesh>
      {/* lid screws */}
      {[
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].map(([sx, sz], i) => (
        <mesh key={i} position={[sx * (a / 2 - 5 * MM), b + 0.05 * MM, sz * (c / 2 - 5 * MM)]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[2.2 * MM, 16]} />
          <meshStandardMaterial color="#2a2e35" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      {/* vent slots on the front */}
      {Array.from({ length: Math.max(2, Math.min(6, Math.floor(a / (12 * MM)))) }).map((_, i, arr) => (
        <mesh key={i} position={[(i - (arr.length - 1) / 2) * 8 * MM, b * 0.3, c / 2 + 0.05 * MM]}>
          <planeGeometry args={[3 * MM, b * 0.25]} />
          <meshStandardMaterial color="#0d0f12" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** A long printed part as a real printed link: slotted profile with pivot holes and lightening cut-outs. */
function PrintedLink({ len, thick, wid, color }: { len: number; thick: number; wid: number; color: string }) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape();
    roundedRect(shape, len, wid, wid / 2 - 1e-5);
    const r = Math.min(wid * 0.18, 2.5 * MM);
    hole(shape, -len / 2 + wid / 2, 0, r);
    hole(shape, len / 2 - wid / 2, 0, r);
    if (len > wid * 3.2) slot(shape, 0, 0, len - wid * 2.4, wid * 0.42);
    const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelSize: thick * 0.12, bevelThickness: thick * 0.12, bevelSegments: 2, curveSegments: 12 });
    g.rotateX(Math.PI / 2);
    g.translate(0, thick, 0);
    return g;
  }, [len, thick, wid]);
  return (
    <mesh geometry={geo} castShadow receiveShadow>
      <PrintMat color={color} height={thick} />
    </mesh>
  );
}

function Extrusion2020({ len }: { len: number }) {
  const geo = useMemo(() => {
    const s = 10 * MM;
    const slot = 3 * MM;
    const shape = new THREE.Shape();
    shape.moveTo(-s, -s);
    const side = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
      const mx = (ax + bx) / 2,
        my = (ay + by) / 2;
      const tx = Math.sign(bx - ax),
        ty = Math.sign(by - ay);
      shape.lineTo(mx - tx * slot, my - ty * slot);
      shape.lineTo(mx - tx * slot - nx * 4 * MM, my - ty * slot - ny * 4 * MM);
      shape.lineTo(mx + tx * slot - nx * 4 * MM, my + ty * slot - ny * 4 * MM);
      shape.lineTo(mx + tx * slot, my + ty * slot);
      shape.lineTo(bx, by);
    };
    side(-s, -s, s, -s, 0, -1);
    side(s, -s, s, s, 1, 0);
    side(s, s, -s, s, 0, 1);
    side(-s, s, -s, -s, -1, 0);
    const core = new THREE.Path();
    core.absarc(0, 0, 2.1 * MM, 0, Math.PI * 2, true);
    shape.holes.push(core);
    const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 12 });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [len]);
  return (
    <mesh geometry={geo} castShadow receiveShadow>
      <M color="#c4c9d1" metal={1} rough={0.38} />
    </mesh>
  );
}

// ---------------------------------------------------------------- the switch

/** Draws a catalogue part at real scale. `color` overrides the accent colour where it makes sense. */
export function CatalogMesh({ part, color, live }: { part: CatalogPart; color?: string; live?: LiveFn }) {
  const [x, y, z] = part.dims.map((v) => v * MM) as [number, number, number];
  switch (part.model) {
    case "sensor_soil":
      return <SoilProbe x={x} y={y} resistive={part.id.includes("yl69")} />;
    case "sensor_level":
      return <LevelSensor x={x} y={y} z={z} />;
    case "sensor_dht":
      return <DhtSensor x={x} y={y} z={z} />;
    case "relay_module":
      return <Relay x={x} z={z} channels={part.electrical?.channels ?? 1} live={live} />;
    case "pump_mini":
      return <PumpMini x={x} y={y} z={z} live={live} />;
    case "pump_12v":
      return <Pump12 x={x} y={y} live={live} />;
    case "solenoid_valve":
      return <Solenoid x={x} y={y} z={z} live={live} />;
    case "buzzer":
      return <Buzzer x={x} y={y} live={live} />;
    case "led":
      return <Led y={y} color={color || "#ff3b30"} live={live} />;
    case "fan":
      return <Fan x={x} y={y} live={live} />;
    case "potentiometer":
      return <Potentiometer x={x} y={y} />;
    case "lcd":
      return <Lcd x={x} z={z} live={live} />;
    case "pot_plant":
      return <PlantPot x={x} y={y} live={live} />;
    case "reservoir":
      return <Reservoir x={x} y={y} z={z} live={live} />;
    case "tube_coil":
      return <TubeCoil x={x} />;
    case "servo_micro":
      return <ServoCase L={x} H={y} W={z} color={color || "#2a5bd7"} label="#e8ebef" />;
    case "servo_standard":
      return <ServoCase L={x} H={y} W={z} color={color || "#16191f"} label="#2d6cdf" />;
    case "servo_bus":
      return <ServoCase L={x} H={y} W={z} color={color || "#1b1e24"} label="#e0a33a" />;
    case "motor_tt":
      return <GearMotorMesh motor={GEARMOTORS.find((m) => m.look === "tt")!} />;
    case "motor_n20":
      return <GearMotorMesh motor={GEARMOTORS.find((m) => m.look === "n20")!} />;
    case "motor_jga25":
      return <GearMotorMesh motor={GEARMOTORS.find((m) => m.look === "jga25")!} />;
    case "motor_jgb37":
      return <GearMotorMesh motor={GEARMOTORS.find((m) => m.look === "jgb37")!} />;
    case "motor_37d":
      return <GearMotorMesh motor={GEARMOTORS.find((m) => m.look === "37d")!} />;
    case "stepper_nema17":
      return (
        <group>
          <RoundedBox args={[x, z, x]} radius={3 * MM} smoothness={3} position={[0, -z / 2 - 2 * MM, 0]} castShadow receiveShadow>
            <M color="#2a2e35" metal={0.6} rough={0.4} />
          </RoundedBox>
          {[0.18, 0.82].map((f) => (
            <mesh key={f} position={[0, -z * f - 2 * MM, 0]}>
              <boxGeometry args={[x * 1.005, z * 0.18, x * 1.005]} />
              <M {...ALU} rough={0.3} />
            </mesh>
          ))}
          <mesh position={[0, -1 * MM, 0]}>
            <cylinderGeometry args={[11 * MM, 11 * MM, 2 * MM, 32]} />
            <M {...ALU} />
          </mesh>
          <mesh position={[0, 10 * MM, 0]} castShadow>
            <cylinderGeometry args={[2.5 * MM, 2.5 * MM, 22 * MM, 16]} />
            <M color="#dfe3e8" metal={1} rough={0.2} />
          </mesh>
        </group>
      );
    case "stepper_28byj":
      return (
        <group>
          <mesh position={[0, -y / 2, 0]} castShadow>
            <cylinderGeometry args={[x / 2, x / 2, y, 32]} />
            <M color="#c9ced6" metal={0.9} rough={0.3} />
          </mesh>
          <mesh position={[0, -y * 0.6, -x / 2 - 3 * MM]} castShadow>
            <boxGeometry args={[16 * MM, 12 * MM, 6 * MM]} />
            <M color="#2b6fd6" rough={0.5} />
          </mesh>
          <mesh position={[0, 4 * MM, 7 * MM]}>
            <cylinderGeometry args={[2.5 * MM, 2.5 * MM, 9 * MM, 12]} />
            <M color="#d9b45a" metal={0.9} rough={0.3} />
          </mesh>
        </group>
      );
    case "board_uno":
      return <BoardMesh board={boardFor("uno")} />;
    case "board_nano":
      return <BoardMesh board={boardFor("nano")} />;
    case "board_esp32":
      return <BoardMesh board={boardFor("esp32")} />;
    case "board_pico":
      return <BoardMesh board={boardFor("pico")} />;
    case "board_mega":
      return <ModulePcb w={x} d={z} color="#1b5fa8" />;
    case "board_pi":
      return <PiBoard w={x} d={z} />;
    case "board_microbit":
      return (
        <group>
          <ModulePcb w={x} d={z} color="#151515" chip={false} header={false} />
          {Array.from({ length: 25 }).map((_, i) => (
            <mesh key={i} position={[((i % 5) - 2) * 4 * MM, 2 * MM, (Math.floor(i / 5) - 2) * 4 * MM]}>
              <boxGeometry args={[1.2 * MM, 0.6 * MM, 2 * MM]} />
              <meshBasicMaterial color="#ff3b30" toneMapped={false} />
            </mesh>
          ))}
        </group>
      );
    case "driver_l298n":
      return <DriverMesh driver={DRIVERS.find((d) => d.look === "l298n")!} />;
    case "driver_tb6612":
      return <DriverMesh driver={DRIVERS.find((d) => d.look === "tb6612")!} />;
    case "driver_pca9685":
      return <ModulePcb w={x} d={z} color="#1d3f8f" />;
    case "driver_a4988":
      return (
        <group>
          <ModulePcb w={x} d={z} color="#1d6b3a" chip={false} />
          <mesh position={[0, 4 * MM, 0]} castShadow>
            <boxGeometry args={[9 * MM, 6 * MM, 9 * MM]} />
            <M {...ALU} rough={0.4} />
          </mesh>
        </group>
      );
    case "module_pcb":
    case "sensor_color":
      return <ModulePcb w={x} d={z} color={part.category === "sensor" ? "#1f4fd6" : "#1d6b3a"} />;
    case "sensor_sonar":
      return <SensorMesh sensor={ALTIMETERS.find((s) => s.look === "sonar")!} />;
    case "sensor_tof":
      return <SensorMesh sensor={ALTIMETERS.find((s) => s.look === "tof") ?? ALTIMETERS[1]} />;
    case "sensor_imu":
      return <SensorMesh sensor={IMUS[0]} />;
    case "sensor_line":
      return (
        <group>
          <ModulePcb w={x} d={z} color="#1f4fd6" chip={false} header={false} />
          {Array.from({ length: 5 }).map((_, i) => (
            <mesh key={i} position={[(i - 2) * x * 0.18, -1 * MM, 0]}>
              <boxGeometry args={[5 * MM, 2 * MM, 10 * MM]} />
              <M color="#0d0f12" />
            </mesh>
          ))}
        </group>
      );
    case "sensor_camera":
      return (
        <group>
          <ModulePcb w={Math.min(x, 25 * MM)} d={Math.min(z, 24 * MM)} color="#1f7a3a" chip={false} header={false} />
          <mesh position={[0, y * 0.4, 0]} castShadow>
            <boxGeometry args={[Math.min(x, 25 * MM) * 0.4, y * 0.6, Math.min(x, 25 * MM) * 0.4]} />
            <M color="#15181c" />
          </mesh>
          <mesh position={[0, y * 0.72, 0]}>
            <cylinderGeometry args={[3.5 * MM, 3.5 * MM, 1 * MM, 24]} />
            <M color="#1b3a6b" rough={0.05} clear={1} />
          </mesh>
        </group>
      );
    case "sensor_pir":
      return (
        <group>
          <ModulePcb w={x} d={y} color="#1d6b3a" chip={false} header={false} />
          <mesh position={[0, 2 * MM, 0]}>
            <sphereGeometry args={[11 * MM, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <M color="#f2f2f2" rough={0.3} opacity={0.92} />
          </mesh>
        </group>
      );
    case "battery_18650x2":
      return <BatteryMesh battery={BATTERIES.find((b) => b.look === "18650")!} />;
    case "battery_18650x3":
      return (
        <group scale={[1, 1, 1.45]}>
          <BatteryMesh battery={BATTERIES.find((b) => b.look === "18650")!} />
        </group>
      );
    case "battery_lipo":
      return <BatteryMesh battery={BATTERIES.find((b) => b.look === "lipo")!} />;
    case "battery_aa4":
      return <BatteryMesh battery={BATTERIES.find((b) => b.look === "aa")!} />;
    case "buck":
      return (
        <group>
          <ModulePcb w={x} d={z} color="#1d3f8f" chip={false} header={false} />
          <mesh position={[-x * 0.2, 6 * MM, 0]} castShadow>
            <cylinderGeometry args={[4 * MM, 4 * MM, 10 * MM, 16]} />
            <M color="#1a1d22" metal={0.4} />
          </mesh>
          <mesh position={[x * 0.18, 4 * MM, 0]} castShadow>
            <boxGeometry args={[9 * MM, 6 * MM, 9 * MM]} />
            <M color="#2a2e35" />
          </mesh>
        </group>
      );
    case "bracket_u":
      return <UBracket L={x} H={y} W={z} />;
    case "bracket_l":
      return <LBracket L={x} H={y} W={z} />;
    case "bracket_multi":
      return <MultiBracket L={x} H={y} W={z} />;
    case "servo_horn":
      return (
        <mesh position={[0, y / 2, 0]} castShadow>
          <cylinderGeometry args={[x / 2, x / 2, y, 32]} />
          <M {...ALU} />
        </mesh>
      );
    case "standoff":
      return (
        <mesh position={[0, y / 2, 0]} castShadow>
          <cylinderGeometry args={[x / 2, x / 2, y, 6]} />
          <M color="#c9a24a" metal={1} rough={0.3} />
        </mesh>
      );
    case "bearing":
      return (
        <group>
          <mesh position={[0, y / 2, 0]} castShadow>
            <cylinderGeometry args={[x / 2, x / 2, y, 32]} />
            <M color="#c4c9d1" metal={1} rough={0.18} />
          </mesh>
          <mesh position={[0, y + 0.05 * MM, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[4 * MM, x * 0.36, 32]} />
            <M color="#1c2026" />
          </mesh>
        </group>
      );
    case "shaft_coupler":
      return (
        <mesh position={[0, y / 2, 0]} castShadow>
          <cylinderGeometry args={[x / 2, x / 2, y, 24]} />
          <M {...ALU} rough={0.3} />
        </mesh>
      );
    case "timing_pulley":
      return (
        <group>
          <mesh position={[0, y * 0.4, 0]} castShadow>
            <cylinderGeometry args={[x * 0.42, x * 0.42, y * 0.55, 20]} />
            <M {...ALU} />
          </mesh>
          <mesh position={[0, y * 0.85, 0]}>
            <cylinderGeometry args={[x / 2, x / 2, y * 0.12, 24]} />
            <M {...ALU} />
          </mesh>
        </group>
      );
    case "lead_screw":
      return (
        <mesh position={[0, y / 2, 0]} castShadow>
          <cylinderGeometry args={[x / 2, x / 2, y, 16]} />
          <M color="#b8bec7" metal={1} rough={0.25} />
        </mesh>
      );
    case "wheel":
      return <Wheel r={x / 2} w={z} hub={color || "#2dd4ff"} />;
    case "wheel_mecanum":
    case "wheel_omni":
      return (
        <group>
          <Wheel r={x / 2} w={z} hub={color || "#9b5cff"} />
          {Array.from({ length: part.model === "wheel_mecanum" ? 9 : 12 }).map((_, i, a) => {
            const t = (i / a.length) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(t) * x * 0.47, Math.sin(t) * x * 0.47, 0]} rotation={[part.model === "wheel_mecanum" ? Math.PI / 4 : 0, 0, t]} castShadow>
                <capsuleGeometry args={[x * 0.07, z * 0.6, 4, 10]} />
                <M color="#1b1f24" rough={0.85} />
              </mesh>
            );
          })}
        </group>
      );
    case "caster_ball":
      return (
        <group>
          <mesh position={[0, y * 0.75, 0]} castShadow>
            <cylinderGeometry args={[x / 2, x * 0.4, y * 0.5, 24]} />
            <M color="#1a1d22" />
          </mesh>
          <mesh position={[0, y * 0.38, 0]} castShadow>
            <sphereGeometry args={[y * 0.38, 24, 16]} />
            <M color="#d9dde3" metal={1} rough={0.15} />
          </mesh>
        </group>
      );
    case "track_set":
      return (
        <group>
          {[1, -1].map((s) => (
            <RoundedBox key={s} args={[x, y, z * 0.35]} radius={y * 0.45} smoothness={4} position={[0, y / 2, (s * z) / 2]} castShadow>
              <M color="#15181c" rough={0.9} />
            </RoundedBox>
          ))}
        </group>
      );
    case "gripper_claw":
      return (
        <group>
          <ServoCase L={40.7 * MM} H={42.9 * MM} W={19.7 * MM} color="#16191f" label="#2d6cdf" />
          {[1, -1].map((s) => (
            <RoundedBox key={s} args={[x * 0.55, 3 * MM, 12 * MM]} radius={1.4 * MM} smoothness={2} position={[x * 0.35, 4 * MM, s * 12 * MM]} rotation={[0, s * 0.12, 0]} castShadow>
              <M {...ALU} />
            </RoundedBox>
          ))}
        </group>
      );
    case "pan_tilt":
      return (
        <group>
          <ServoCase L={23 * MM} H={22.5 * MM} W={12.2 * MM} color="#2a5bd7" label="#e8ebef" />
          <group position={[0, 14 * MM, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <ServoCase L={23 * MM} H={22.5 * MM} W={12.2 * MM} color="#2a5bd7" label="#e8ebef" />
          </group>
          <mesh position={[0, 26 * MM, 0]} castShadow>
            <boxGeometry args={[30 * MM, 2 * MM, 30 * MM]} />
            <M color="#15181c" />
          </mesh>
        </group>
      );
    case "chassis_plate":
      return <Plate w={x} t={y} d={z} material="acrylic" />;
    case "breadboard":
      return (
        <group>
          <RoundedBox args={[x, y, z]} radius={1 * MM} smoothness={2} position={[0, y / 2, 0]} castShadow>
            <M color="#f2f2f0" rough={0.6} />
          </RoundedBox>
          <mesh position={[0, y + 0.05 * MM, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[x * 0.9, z * 0.8]} />
            <meshStandardMaterial color="#dcdcd8" />
          </mesh>
        </group>
      );
    case "led_ring":
      return (
        <group>
          <mesh position={[0, y / 2, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
            <ringGeometry args={[x * 0.3, x / 2, 48]} />
            <M color="#151515" />
          </mesh>
          {Array.from({ length: 16 }).map((_, i) => {
            const t = (i / 16) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(t) * x * 0.4, y, Math.sin(t) * x * 0.4]}>
                <boxGeometry args={[4 * MM, 1.2 * MM, 4 * MM]} />
                <meshBasicMaterial color={color || "#7fd4ff"} toneMapped={false} />
              </mesh>
            );
          })}
        </group>
      );
    case "oled":
      return (
        <group>
          <ModulePcb w={x} d={z} color="#1d3f8f" chip={false} header={false} />
          <mesh position={[0, 2.2 * MM, -1 * MM]}>
            <boxGeometry args={[x * 0.9, 1.2 * MM, z * 0.6]} />
            <M color="#05070a" rough={0.1} clear={1} />
          </mesh>
        </group>
      );
    case "speaker":
      return (
        <group>
          <mesh position={[0, y / 2, 0]} castShadow>
            <cylinderGeometry args={[x / 2, x * 0.4, y, 32]} />
            <M {...DARK} />
          </mesh>
          <mesh position={[0, y + 0.05 * MM, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[x * 0.42, 32]} />
            <M color="#2b2f36" rough={0.8} />
          </mesh>
        </group>
      );
    case "button":
      return (
        <group>
          <mesh position={[0, y * 0.3, 0]} castShadow>
            <boxGeometry args={[x, y * 0.6, z]} />
            <M color="#1a1d22" />
          </mesh>
          <mesh position={[0, y * 0.75, 0]} castShadow>
            <cylinderGeometry args={[Math.min(x, z) * 0.35, Math.min(x, z) * 0.35, y * 0.35, 24]} />
            <M color={color || (part.id === "estop-22mm" ? "#e0262c" : "#e8e8e8")} rough={0.35} clear={0.5} />
          </mesh>
        </group>
      );
    case "switch":
      return (
        <group>
          <mesh position={[0, y * 0.3, 0]} castShadow>
            <boxGeometry args={[x, y * 0.6, z]} />
            <M color="#151515" />
          </mesh>
          <mesh position={[0, y * 0.7, 0]} rotation={[0, 0, 0.25]} castShadow>
            <boxGeometry args={[x * 0.8, y * 0.25, z * 0.8]} />
            <M color="#e0262c" rough={0.4} />
          </mesh>
        </group>
      );
    default:
      return <ModulePcb w={x} d={z} />;
  }
}

/** How a printed part reads: a long thin link, a thin-walled enclosure, or a small solid fitting. */
export function printedForm(size: [number, number, number]): "link" | "shell" | "fitting" {
  const s = [...size].sort((x, y) => y - x);
  if (s[0] >= s[1] * 3 && s[2] <= 12 * MM) return "link";
  if (s[2] > 12 * MM) return "shell";
  return "fitting";
}

function Printed({ size, color }: { size: [number, number, number]; color: string }) {
  const [a, b, c] = size;
  const form = printedForm(size);
  const basis = useMemo(() => {
    // Build the link along x (length), y (thickness), z (width), then turn it so its length runs
    // along the part's longest axis and its thickness along the shortest.
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const order = [0, 1, 2].sort((i, k) => size[k] - size[i]);
    const L = axes[order[0]];
    const T = axes[order[2]];
    const W = new THREE.Vector3().crossVectors(L, T);
    return new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(L, T, W));
  }, [size]);
  if (form === "link") {
    const s = [...size].sort((x, y) => y - x);
    return (
      <group position={[0, b / 2, 0]} rotation={basis}>
        <group position={[0, -s[2] / 2, 0]}>
          <PrintedLink len={s[0]} thick={s[2]} wid={s[1]} color={color} />
        </group>
      </group>
    );
  }
  if (form === "shell") return <PrintedShell a={a} b={b} c={c} color={color} />;
  return (
    <RoundedBox args={[a, b, c]} radius={Math.min(a, b, c) * 0.2} smoothness={3} position={[0, b / 2, 0]} castShadow receiveShadow>
      <PrintMat color={color} height={b} />
    </RoundedBox>
  );
}

/** Draws a fabricated part: laser-cut plate, 3D print, cut extrusion or rod. */
export function FabMesh({ kind, size, material, color }: { kind: FabKind; size: [number, number, number]; material: string; color?: string }) {
  const [a, b, c] = size;
  switch (kind) {
    case "plate":
      return <Plate w={a} t={b} d={c} material={material} />;
    case "printed":
      return <Printed size={size} color={color || (material === "tpu" ? "#22262c" : "#f0f0ee")} />;
    case "extrusion":
      return <Extrusion2020 len={b} />;
    default:
      return (
        <mesh position={[0, b / 2, 0]} castShadow>
          <cylinderGeometry args={[a / 2, a / 2, b, 20]} />
          <M color={material === "carbon_fiber" ? "#1a1c20" : "#c4c9d1"} metal={material === "carbon_fiber" ? 0.3 : 1} rough={0.25} />
        </mesh>
      );
  }
}
