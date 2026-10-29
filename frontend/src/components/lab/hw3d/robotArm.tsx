"use client";

// A complete articulated servo arm, built in code like a real 6-DOF hobby kit (Hiwonder xArm,
// LewanSoul): machined base, turntable, a servo at every joint, aluminium U-bracket links, and a
// gripper, 3-finger hand or suction cup. Muse Spark only sets reach, base size, joint count and end
// effector; the geometry and kinematics here are always right.
//
// Frame: the base stands on y = 0 and the arm reaches along +x. Pitch joints turn about z.
import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { armSpec, type PartSpec } from "@/lib/lab/assembly";

const DEG = Math.PI / 180;

interface Look {
  link: { color: string; metalness: number; roughness: number };
  servo: string;
  accent: string;
}

function Metal({ c }: { c: Look["link"] }) {
  return <meshPhysicalMaterial color={c.color} metalness={c.metalness} roughness={c.roughness} envMapIntensity={1.2} />;
}

/** A standard-size servo with its output horn on +z (the joint axis). Body centred on the origin. */
function ServoBlock({ s, look }: { s: number; look: Look }) {
  return (
    <group>
      <RoundedBox args={[s, s * 0.9, s * 0.5]} radius={s * 0.04} smoothness={3} castShadow receiveShadow>
        <meshPhysicalMaterial color={look.servo} roughness={0.42} clearcoat={0.35} clearcoatRoughness={0.3} />
      </RoundedBox>
      {/* mounting flange */}
      <mesh position={[0, s * 0.18, 0]} castShadow>
        <boxGeometry args={[s * 1.34, s * 0.06, s * 0.5]} />
        <meshPhysicalMaterial color={look.servo} roughness={0.45} />
      </mesh>
      {/* label stripe */}
      <mesh position={[0, -s * 0.05, s * 0.252]}>
        <planeGeometry args={[s * 0.7, s * 0.22]} />
        <meshStandardMaterial color={look.accent} roughness={0.5} />
      </mesh>
      {/* output spline and round horn, on the joint axis */}
      <mesh position={[0, 0, s * 0.27]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[s * 0.22, s * 0.22, s * 0.04, 32]} />
        <meshPhysicalMaterial color="#d9dde3" metalness={0.9} roughness={0.25} />
      </mesh>
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} position={[Math.cos((k * Math.PI) / 2) * s * 0.14, Math.sin((k * Math.PI) / 2) * s * 0.14, s * 0.292]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[s * 0.02, s * 0.02, s * 0.01, 10]} />
          <meshStandardMaterial color="#2a2f36" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/** A U-bracket link of length `len` along +y: two side plates either side of the joint, a web, and bolt heads. */
function Link({ len, s, look, narrow = 1 }: { len: number; s: number; look: Look; narrow?: number }) {
  const t = Math.max(0.0018, s * 0.06);
  const w = s * 0.62 * narrow;
  const gap = s * 0.3 + t;
  return (
    <group>
      {[gap, -gap].map((z) => (
        <RoundedBox key={z} args={[w, len + w * 0.6, t]} radius={Math.min(w * 0.45, t * 0.49)} smoothness={3} position={[0, len / 2, z]} castShadow receiveShadow>
          <Metal c={look.link} />
        </RoundedBox>
      ))}
      {/* web between the plates, stiffening the link */}
      <mesh position={[-w * 0.42, len / 2, 0]} castShadow>
        <boxGeometry args={[t, len * 0.72, gap * 2]} />
        <Metal c={look.link} />
      </mesh>
      {/* lightening holes read as dark recesses */}
      {[0.35, 0.65].map((f) =>
        [gap + t * 0.51, -gap - t * 0.51].map((z) => (
          <mesh key={`${f}${z}`} position={[0, len * f, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[w * 0.22, w * 0.22, 0.0004, 24]} />
            <meshStandardMaterial color="#0d1014" roughness={0.9} />
          </mesh>
        )),
      )}
      {/* bolt heads at both pivots */}
      {[0, len].map((y) =>
        [gap + t * 0.6, -gap - t * 0.6].map((z) => (
          <mesh key={`${y}${z}`} position={[0, y, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[s * 0.07, s * 0.07, t * 0.7, 6]} />
            <meshPhysicalMaterial color="#b9bfc8" metalness={1} roughness={0.2} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Gripper({ s, len, look, open }: { s: number; len: number; look: Look; open: React.RefObject<THREE.Group | null>[] }) {
  return (
    <group>
      <RoundedBox args={[s * 0.9, s * 0.32, s * 0.72]} radius={s * 0.05} smoothness={3} position={[0, s * 0.16, 0]} castShadow>
        <Metal c={look.link} />
      </RoundedBox>
      <group position={[0, s * 0.42, 0]} scale={0.7}>
        <ServoBlock s={s} look={look} />
      </group>
      {[1, -1].map((side, i) => (
        <group key={side} ref={open[i]} position={[0, s * 0.3, side * s * 0.24]}>
          <RoundedBox args={[s * 0.5, len, s * 0.08]} radius={s * 0.03} smoothness={3} position={[0, len / 2, 0]} castShadow>
            <Metal c={look.link} />
          </RoundedBox>
          {/* rubber finger pad */}
          <mesh position={[0, len * 0.82, -side * s * 0.05]} castShadow>
            <boxGeometry args={[s * 0.44, len * 0.3, s * 0.03]} />
            <meshStandardMaterial color="#15181c" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Hand({ s, len, look, curl }: { s: number; len: number; look: Look; curl: React.RefObject<THREE.Group | null>[] }) {
  const seg = len * 0.42;
  const r = s * 0.1;
  const finger = (k: number, x: number, z: number, thumb = false) => (
    <group key={k} position={[x, s * 0.62, z]} rotation={thumb ? [0, 0, Math.PI * 0.55] : [0, 0, 0]}>
      <group ref={curl[k]}>
        <mesh position={[0, seg / 2, 0]} castShadow>
          <capsuleGeometry args={[r, seg - r * 2, 6, 16]} />
          <Metal c={look.link} />
        </mesh>
        <mesh position={[0, seg, 0]}>
          <sphereGeometry args={[r * 1.15, 16, 12]} />
          <meshPhysicalMaterial color={look.servo} roughness={0.4} />
        </mesh>
        <group position={[0, seg, 0]} rotation={[0, 0, -0.5]}>
          <mesh position={[0, seg * 0.42, 0]} castShadow>
            <capsuleGeometry args={[r * 0.9, seg * 0.84 - r * 1.8, 6, 16]} />
            <Metal c={look.link} />
          </mesh>
          <mesh position={[0, seg * 0.84, 0]}>
            <sphereGeometry args={[r * 0.95, 16, 12]} />
            <meshStandardMaterial color="#15181c" roughness={0.85} />
          </mesh>
        </group>
      </group>
    </group>
  );
  return (
    <group>
      <RoundedBox args={[s * 0.5, s * 0.9, s * 0.95]} radius={s * 0.12} smoothness={4} position={[0, s * 0.18, 0]} castShadow>
        <meshPhysicalMaterial color={look.servo} roughness={0.35} clearcoat={0.5} />
      </RoundedBox>
      {finger(0, 0, s * 0.3)}
      {finger(1, 0, 0)}
      {finger(2, 0, -s * 0.3)}
      {finger(3, s * 0.2, 0, true)}
    </group>
  );
}

function Suction({ s, len }: { s: number; len: number }) {
  return (
    <group>
      <mesh position={[0, len * 0.35, 0]} castShadow>
        <cylinderGeometry args={[s * 0.12, s * 0.12, len * 0.7, 24]} />
        <meshPhysicalMaterial color="#c9ced6" metalness={1} roughness={0.25} />
      </mesh>
      <mesh position={[0, len * 0.82, 0]} castShadow>
        <cylinderGeometry args={[s * 0.42, s * 0.14, len * 0.26, 32, 1, true]} />
        <meshStandardMaterial color="#1b1f24" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/**
 * Joint angles for a stroke s (0 = rest pose, 1 = full stroke, negative = the other way).
 * Shoulder and elbow swing together (a toss / reach), the wrist flicks, the turntable yaws a little.
 */
export function armPose(s: number) {
  const k = Math.max(-1.5, Math.min(1.5, s));
  const shoulder = 18 + 32 * k;
  const elbow = 72 - 50 * k;
  return { yaw: 8 * k, shoulder, elbow, wrist: 90 - shoulder - elbow + 22 * k, roll: 25 * k, grip: Math.max(0, Math.min(1, 0.5 + 0.5 * k)) };
}

export default function RobotArm({ part, stroke, held }: { part: PartSpec; stroke: () => number; held?: React.ReactNode }) {
  const { reach, baseD, dof, effector } = armSpec(part);
  const s = Math.max(0.022, Math.min(0.12, reach * 0.11)); // servo size scales with the arm
  const L1 = reach * 0.46;
  const L2 = reach * 0.36;
  const Le = reach * 0.14;
  const hBase = baseD * 0.3;
  const hShoulder = s * 1.05;
  const look = useMemo<Look>(() => {
    const metal = part.material === "dark_metal" ? { color: "#2c3138", metalness: 0.9, roughness: 0.38 } : part.material === "plastic" || part.material === "glossy_plastic" ? { color: "#e8ebef", metalness: 0, roughness: 0.35 } : { color: "#c9ced6", metalness: 1, roughness: 0.3 };
    return { link: metal, servo: "#16191f", accent: part.color || "#2d6cdf" };
  }, [part.material, part.color]);

  const yaw = useRef<THREE.Group>(null);
  const j1 = useRef<THREE.Group>(null);
  const j2 = useRef<THREE.Group>(null);
  const j3 = useRef<THREE.Group>(null);
  const j4 = useRef<THREE.Group>(null);
  const fA = useRef<THREE.Group>(null);
  const fB = useRef<THREE.Group>(null);
  const c0 = useRef<THREE.Group>(null);
  const c1 = useRef<THREE.Group>(null);
  const c2 = useRef<THREE.Group>(null);
  const c3 = useRef<THREE.Group>(null);

  useFrame(() => {
    const p = armPose(stroke());
    if (yaw.current) yaw.current.rotation.y = p.yaw * DEG;
    // Pitch angles are measured from vertical, tilting towards +x.
    if (j1.current) j1.current.rotation.z = -p.shoulder * DEG;
    if (j2.current) j2.current.rotation.z = -p.elbow * DEG;
    if (j3.current) j3.current.rotation.z = dof >= 5 ? -p.wrist * DEG : 0;
    if (j4.current) j4.current.rotation.y = dof >= 6 ? p.roll * DEG : 0;
    const open = s * (0.08 + 0.12 * (1 - p.grip));
    if (fA.current) fA.current.position.z = s * 0.16 + open;
    if (fB.current) fB.current.position.z = -s * 0.16 - open;
    for (const c of [c0, c1, c2, c3]) if (c.current) c.current.rotation.z = -p.grip * 0.9;
  });

  return (
    <group>
      {/* machined base with the yaw servo inside */}
      <mesh position={[0, hBase / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[baseD * 0.5, baseD * 0.54, hBase, 48]} />
        <meshPhysicalMaterial color="#23272e" metalness={0.85} roughness={0.35} />
      </mesh>
      <mesh position={[0, hBase + 0.0015, 0]}>
        <cylinderGeometry args={[baseD * 0.46, baseD * 0.46, 0.003, 48]} />
        <meshPhysicalMaterial color="#c9ced6" metalness={1} roughness={0.28} />
      </mesh>
      {Array.from({ length: 4 }).map((_, k) => (
        <mesh key={k} position={[Math.cos((k / 4) * Math.PI * 2 + Math.PI / 4) * baseD * 0.43, hBase + 0.003, Math.sin((k / 4) * Math.PI * 2 + Math.PI / 4) * baseD * 0.43]}>
          <cylinderGeometry args={[baseD * 0.025, baseD * 0.025, 0.003, 6]} />
          <meshPhysicalMaterial color="#9aa2ad" metalness={1} roughness={0.25} />
        </mesh>
      ))}

      {/* turntable (yaw joint) */}
      <group ref={yaw} position={[0, hBase + 0.003, 0]}>
        <mesh position={[0, 0.004, 0]} castShadow>
          <cylinderGeometry args={[baseD * 0.36, baseD * 0.36, 0.008, 48]} />
          <Metal c={look.link} />
        </mesh>
        {/* shoulder bracket rising from the turntable, holding the shoulder servo */}
        <group position={[0, 0.008, 0]}>
          <Link len={hShoulder} s={s} look={look} narrow={1.25} />
        </group>
        <group position={[0, 0.008 + hShoulder, 0]}>
          <ServoBlock s={s} look={look} />
          {/* shoulder joint */}
          <group ref={j1}>
            <Link len={L1} s={s} look={look} />
            <group position={[0, L1, 0]}>
              <ServoBlock s={s * 0.92} look={look} />
              {/* elbow joint */}
              <group ref={j2}>
                <Link len={L2} s={s * 0.9} look={look} narrow={0.85} />
                <group position={[0, L2, 0]}>
                  {dof >= 5 && <ServoBlock s={s * 0.78} look={look} />}
                  {/* wrist pitch */}
                  <group ref={j3}>
                    <group position={[0, s * 0.42, 0]}>
                      {/* wrist roll */}
                      <group ref={j4}>
                        {dof >= 6 && (
                          <mesh position={[0, s * 0.06, 0]} castShadow>
                            <cylinderGeometry args={[s * 0.32, s * 0.32, s * 0.12, 32]} />
                            <Metal c={look.link} />
                          </mesh>
                        )}
                        <group position={[0, s * 0.12, 0]}>
                          {effector === "gripper" && <Gripper s={s} len={Le} look={look} open={[fA, fB]} />}
                          {effector === "hand" && <Hand s={s} len={Le} look={look} curl={[c0, c1, c2, c3]} />}
                          {effector === "suction" && <Suction s={s} len={Le} />}
                          {/* Whatever the arm holds rides here, at the tip of the end effector. */}
                          {held && <group position={[0, s * 0.3 + Le * 0.85, 0]}>{held}</group>}
                        </group>
                      </group>
                    </group>
                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
