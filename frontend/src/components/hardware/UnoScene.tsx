"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls, RoundedBox } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

function Box({
  at,
  size,
  color,
  metal = 0,
}: {
  at: [number, number, number];
  size: [number, number, number];
  color: string;
  metal?: number;
}) {
  return (
    <mesh position={at} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} metalness={metal} roughness={metal ? 0.28 : 0.48} />
    </mesh>
  );
}
function Board({ spinning }: { spinning: boolean }) {
  const group = useRef<THREE.Group>(null);
  const amber = useRef<THREE.MeshStandardMaterial>(null);
  const silk = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 800;
    const x = c.getContext("2d")!;
    x.fillStyle = "#15669b";
    x.fillRect(0, 0, 1024, 800);
    x.strokeStyle = "#247daf";
    x.lineWidth = 3;
    for (let i = 0; i < 22; i++) {
      x.beginPath();
      x.moveTo(220 + i * 29, 75);
      x.lineTo(220 + i * 29, 170 + i * 12);
      x.lineTo(320 + i * 21, 230 + i * 12);
      x.lineTo(320 + i * 21, 725);
      x.stroke();
    }
    x.fillStyle = "#e0f6ed";
    x.textAlign = "center";
    x.font = "bold 76px Arial";
    x.fillText("UNO", 480, 360);
    x.font = "22px monospace";
    x.fillText("ROBOCRAFT • R3", 480, 398);
    x.fillText("DIGITAL (PWM ~)", 630, 98);
    x.fillText("POWER", 420, 687);
    x.fillText("ANALOG IN", 780, 687);
    x.font = "20px monospace";
    ["13", "12", "~11", "~10", "~9", "8", "7", "~6", "~5", "4", "~3", "2", "TX1", "RX0"].forEach((v, i) =>
      x.fillText(v, 260 + i * 50, 155),
    );
    ["IO", "RST", "3V3", "5V", "GND", "GND", "VIN", "A0", "A1", "A2", "A3", "A4", "A5"].forEach((v, i) =>
      x.fillText(v, 280 + i * 50, 645),
    );
    x.fillText("L", 285, 230);
    x.fillText("ON", 860, 280);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }, []);
  useFrame(({ clock }, delta) => {
    if (group.current && spinning) group.current.rotation.y += delta * 0.16;
    if (amber.current) {
      const t = clock.elapsedTime % 1.8;
      amber.current.emissiveIntensity = t < 0.15 || (t > 0.3 && t < 0.45) ? 4 : 0.12;
    }
  });
  return (
    <group ref={group} rotation={[0, -0.3, 0]}>
      <Box at={[0, 0, 0]} size={[6.86, 0.16, 5.34]} color="#0c4e7c" metal={0.15} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.085, 0]}>
        <planeGeometry args={[6.78, 5.26]} />
        <meshStandardMaterial map={silk} roughness={0.52} metalness={0.15} />
      </mesh>
      {[-2.92, 2.92].flatMap((x) =>
        [-2.15, 2.15].map((z) => (
          <group key={`${x}${z}`} position={[x, 0.11, z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.18, 0.055, 8, 24]} />
              <meshStandardMaterial color="#cbc5a3" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.13, 24]} />
              <meshBasicMaterial color="#07101c" />
            </mesh>
          </group>
        )),
      )}
      {[-2.32, 2.32].map((z) =>
        [0, 1].map((row) => (
          <group key={`${z}${row}`}>
            <Box at={[row ? 1.9 : -0.5, 0.31, z]} size={[row ? 1.65 : 2.65, 0.46, 0.3]} color="#14191f" />
            {Array.from({ length: row ? 6 : 10 }, (_, i) => (
              <group key={i}>
                <Box
                  at={[(row ? 1.27 : -1.64) + i * 0.254, 0.55, z]}
                  size={[0.12, 0.015, 0.15]}
                  color="#030609"
                />
                <Box
                  at={[(row ? 1.27 : -1.64) + i * 0.254, -0.2, z]}
                  size={[0.06, 0.42, 0.06]}
                  color="#bcbcb1"
                  metal={0.8}
                />
              </group>
            ))}
          </group>
        )),
      )}
      <Box at={[0.95, 0.3, 0.75]} size={[3.5, 0.38, 0.82]} color="#171b20" />
      {Array.from({ length: 14 }, (_, i) =>
        [-1, 1].map((s) => (
          <Box
            key={`${i}${s}`}
            at={[-0.65 + i * 0.25, 0.22, 0.75 + s * 0.51]}
            size={[0.07, 0.2, 0.26]}
            color="#c5c7bf"
            metal={0.8}
          />
        )),
      )}
      <Box at={[-2.95, 0.66, -1.1]} size={[1.65, 1.15, 1.15]} color="#adb7c0" metal={0.95} />
      <Box at={[-3.79, 0.65, -1.1]} size={[0.02, 0.8, 0.83]} color="#252e37" />
      <Box at={[-3.81, 0.63, -1.1]} size={[0.03, 0.36, 0.48]} color="#d5d8db" />
      <group position={[-2.9, 0.58, 1.77]} rotation={[0, 0, Math.PI / 2]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.45, 0.45, 1.15, 32]} />
          <meshStandardMaterial color="#121820" roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.59, 0]}>
          <cylinderGeometry args={[0.29, 0.29, 0.015, 32]} />
          <meshStandardMaterial color="#040508" />
        </mesh>
      </group>
      {[-1.9, -1.35].map((x) => (
        <group key={x} position={[x, 0.52, 1.7]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.25, 0.25, 0.85, 24]} />
            <meshStandardMaterial color="#222a32" metalness={0.3} />
          </mesh>
          <mesh position={[0, 0.43, 0]}>
            <cylinderGeometry args={[0.23, 0.23, 0.02, 24]} />
            <meshStandardMaterial color="#c7d2d9" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}
      <Box at={[-1.9, 0.2, -0.6]} size={[0.65, 0.2, 0.65]} color="#181d26" />
      <RoundedBox position={[-1.05, 0.25, -0.05]} args={[0.85, 0.3, 0.35]} radius={0.13} smoothness={3}>
        <meshStandardMaterial color="#c4d0d8" metalness={0.95} roughness={0.25} />
      </RoundedBox>
      <Box at={[-2.6, 0.22, -2.1]} size={[0.5, 0.24, 0.5]} color="#bdc5cb" metal={0.6} />
      <mesh position={[-2.6, 0.4, -2.1]}>
        <cylinderGeometry args={[0.16, 0.16, 0.13, 24]} />
        <meshStandardMaterial color="#d65149" />
      </mesh>
      <mesh position={[-1.5, 0.17, -1.4]}>
        <boxGeometry args={[0.16, 0.12, 0.22]} />
        <meshStandardMaterial ref={amber} color="#ffbf49" emissive="#ff9d15" />
      </mesh>
      <mesh position={[2.5, 0.17, -0.85]}>
        <boxGeometry args={[0.15, 0.12, 0.2]} />
        <meshStandardMaterial color="#78ff9b" emissive="#44ff88" emissiveIntensity={2} />
      </mesh>
      {Array.from({ length: 16 }, (_, i) => (
        <group key={i}>
          <Box
            at={[-2 + (i % 8) * 0.54, 0.13, i < 8 ? -1.78 : 1.6]}
            size={[0.23, 0.08, 0.11]}
            color="#bbbeb5"
            metal={0.5}
          />
          <Box
            at={[-2 + (i % 8) * 0.54, 0.18, i < 8 ? -1.78 : 1.6]}
            size={[0.13, 0.025, 0.115]}
            color="#29292b"
          />
        </group>
      ))}
    </group>
  );
}
export default function UnoScene({ spinning }: { spinning: boolean }) {
  return (
    <Canvas
      shadows="basic"
      camera={{ position: [-7.2, 9, 8], fov: 33 }}
      dpr={[1, 1.7]}
      aria-label="Interactive 3D Uno R3 preview. Drag to rotate. LED is illustrative, not live telemetry."
    >
      <ambientLight intensity={1.2} />
      <directionalLight position={[2, 8, 4]} intensity={3} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-5, 3, -4]} color="#70aaff" intensity={2} />
      <Environment resolution={128}>
        <Lightformer intensity={3} position={[0, 8, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 10, 1]} />
        <Lightformer intensity={2} position={[-8, 3, 0]} rotation={[0, Math.PI / 2, 0]} scale={[10, 5, 1]} />
      </Environment>
      <Board spinning={spinning} />
      <ContactShadows position={[0, -0.45, 0]} opacity={0.6} scale={16} blur={2.5} far={7} />
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={9}
        maxDistance={20}
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  );
}
