"use client";

// The landing-page mascot: a dark, glossy robot with a spectrum-rimmed face screen whose eyes
// follow the pointer. Built from primitives (no model files) and lit with in-scene light
// formers, so nothing is fetched at runtime.
import { Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const SPECTRUM = ["#3ff0ff", "#5a86ff", "#b06bff", "#ff5fa2", "#ff9a3d", "#ffe45c"].map((c) => new THREE.Color(c));

function spectrumAt(t: number): THREE.Color {
  const x = (((t % 1) + 1) % 1) * SPECTRUM.length;
  const i = Math.floor(x);
  return SPECTRUM[i % SPECTRUM.length].clone().lerp(SPECTRUM[(i + 1) % SPECTRUM.length], x - i);
}

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2,
    y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function SpectrumRim() {
  const geo = useMemo(() => {
    const outer = roundedRectShape(2.04, 1.82, 0.42);
    const hole = roundedRectShape(1.78, 1.56, 0.3);
    outer.holes.push(new THREE.Path(hole.getPoints(48)));
    const g = new THREE.ExtrudeGeometry(outer, { depth: 0.1, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 3, curveSegments: 24 });
    // Colour each vertex by its angle around the face: a continuous spectrum loop.
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getY(i), pos.getX(i));
      const c = spectrumAt(0.62 - a / (2 * Math.PI));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, []);
  return (
    <mesh geometry={geo} position={[0, 0, 0.86]}>
      <meshBasicMaterial vertexColors toneMapped={false} />
    </mesh>
  );
}

function FaceGrid() {
  const geo = useMemo(() => {
    const pts: number[] = [];
    const w = 1.4,
      h = 1.18;
    for (let i = 0; i <= 6; i++) {
      const x = -w / 2 + (w * i) / 6;
      pts.push(x, -h / 2, 0, x, h / 2, 0);
    }
    for (let j = 0; j <= 5; j++) {
      const y = -h / 2 + (h * j) / 5;
      pts.push(-w / 2, y, 0, w / 2, y, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geo} position={[0, 0, 0.97]}>
      <lineBasicMaterial color="#2b303c" transparent opacity={0.9} />
    </lineSegments>
  );
}

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.25, "rgba(200,230,255,0.35)");
  g.addColorStop(1, "rgba(120,140,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function Robot({ scrollRef }: { scrollRef: React.RefObject<number> }) {
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const glow = useMemo(() => (typeof document !== "undefined" ? glowTexture() : null), []);
  const blink = useRef({ next: 2, t: 0 });
  // On narrow screens the robot shrinks and sits above the headline instead of behind it.
  const width = useThree((s) => s.size.width);
  const narrow = width < 768;
  const baseY = narrow ? 1.75 : 0.55;
  const scale = narrow ? 0.62 : 1;

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const px = state.pointer.x,
      py = state.pointer.y;
    const scroll = scrollRef.current ?? 0;
    if (root.current) {
      root.current.position.y = baseY + Math.sin(t * 1.1) * 0.06 - scroll * 0.6;
      root.current.scale.setScalar(scale);
      root.current.rotation.y = THREE.MathUtils.lerp(root.current.rotation.y, scroll * 0.9, 0.08);
    }
    if (head.current) {
      head.current.rotation.y = THREE.MathUtils.lerp(head.current.rotation.y, px * 0.45, 0.06);
      head.current.rotation.x = THREE.MathUtils.lerp(head.current.rotation.x, -py * 0.22, 0.06);
      head.current.rotation.z = Math.sin(t * 0.7) * 0.025;
    }
    if (eyes.current) {
      eyes.current.position.x = THREE.MathUtils.lerp(eyes.current.position.x, px * 0.14, 0.12);
      eyes.current.position.y = THREE.MathUtils.lerp(eyes.current.position.y, py * 0.08, 0.12);
      const b = blink.current;
      b.t += dt;
      let sy = 1;
      if (b.t > b.next) {
        const k = (b.t - b.next) / 0.16;
        sy = k < 1 ? Math.abs(1 - 2 * k) * 0.9 + 0.1 : 1;
        if (k >= 1) {
          b.t = 0;
          b.next = 2 + Math.random() * 3;
        }
      }
      eyes.current.scale.y = sy;
    }
  });

  const metal = <meshPhysicalMaterial color="#121419" metalness={0.75} roughness={0.32} clearcoat={1} clearcoatRoughness={0.25} />;

  return (
    <group ref={root}>
      <group ref={head} position={[0, 0.55, 0]}>
        <RoundedBox args={[2.3, 2.05, 1.7]} radius={0.42} smoothness={8}>
          {metal}
        </RoundedBox>
        <SpectrumRim />
        <RoundedBox args={[1.72, 1.5, 0.12]} radius={0.24} smoothness={6} position={[0, 0, 0.86]}>
          <meshPhysicalMaterial color="#040507" metalness={0.2} roughness={0.12} clearcoat={1} />
        </RoundedBox>
        <FaceGrid />
        <group ref={eyes} position={[0, 0, 1]}>
          {[-0.3, 0.3].map((x) => (
            <group key={x} position={[x, 0.02, 0]}>
              <mesh>
                <circleGeometry args={[0.13, 40]} />
                <meshBasicMaterial color="#ffffff" toneMapped={false} />
              </mesh>
              {glow && (
                <sprite scale={[0.85, 0.85, 1]} position={[0, 0, 0.01]}>
                  <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
                </sprite>
              )}
            </group>
          ))}
        </group>
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 1.2, -0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
            <mesh>
              <cylinderGeometry args={[0.36, 0.36, 0.18, 40]} />
              {metal}
            </mesh>
            <mesh position={[0, side * 0.1, 0]}>
              <cylinderGeometry args={[0.2, 0.2, 0.06, 40]} />
              <meshBasicMaterial color={side < 0 ? "#3ff0ff" : "#ff5fa2"} toneMapped={false} />
            </mesh>
          </group>
        ))}
        <mesh position={[0.62, 1.2, -0.2]}>
          <cylinderGeometry args={[0.025, 0.025, 0.45, 12]} />
          {metal}
        </mesh>
        <mesh position={[0.62, 1.46, -0.2]}>
          <sphereGeometry args={[0.07, 24, 24]} />
          <meshBasicMaterial color="#ffe45c" toneMapped={false} />
        </mesh>
      </group>
      <mesh position={[0, -0.62, 0]}>
        <cylinderGeometry args={[0.28, 0.34, 0.3, 32]} />
        {metal}
      </mesh>
      <RoundedBox args={[1.9, 1.35, 1.25]} radius={0.38} smoothness={6} position={[0, -1.45, -0.05]}>
        {metal}
      </RoundedBox>
      {["#b06bff", "#3ff0ff", "#ff9a3d"].map((c, i) => (
        <mesh key={c} position={[-0.18 + i * 0.18, -1.2, 0.58]}>
          <sphereGeometry args={[0.055, 20, 20]} />
          <meshBasicMaterial color={c} toneMapped={false} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 1.08, -1.15, 0]}>
          <sphereGeometry args={[0.3, 32, 32]} />
          {metal}
        </mesh>
      ))}
    </group>
  );
}

/** Signals once the first frame with the robot has been drawn. */
function FirstFrame({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    requestAnimationFrame(() => {
      onReady?.();
      window.dispatchEvent(new Event("rc-hero-ready"));
    });
  });
  return null;
}

export default function HeroRobot({ scrollRef, onReady }: { scrollRef: React.RefObject<number>; onReady?: () => void }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 10.5], fov: 32 }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      className="!absolute inset-0"
    >
      <FirstFrame onReady={onReady} />
      <ambientLight intensity={0.12} />
      <directionalLight position={[2, 4, 6]} intensity={0.5} />
      {/* Coloured rim lights give the iridescent edge highlights. */}
      <spotLight position={[-6, 3, -3]} angle={0.6} penumbra={1} intensity={120} color="#3f7bff" />
      <spotLight position={[6, 2, -3]} angle={0.6} penumbra={1} intensity={120} color="#c25bff" />
      <spotLight position={[0, -5, -2]} angle={0.8} penumbra={1} intensity={60} color="#ff8a3d" />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2.5} color="#6aa8ff" position={[-5, 2, -2]} scale={[2, 8, 1]} rotation-y={Math.PI / 2} />
        <Lightformer form="rect" intensity={2.5} color="#d07bff" position={[5, 1, -2]} scale={[2, 8, 1]} rotation-y={-Math.PI / 2} />
        <Lightformer form="rect" intensity={1.2} color="#ffffff" position={[0, 6, 2]} scale={[8, 2, 1]} rotation-x={Math.PI / 2} />
        <Lightformer form="ring" intensity={1.5} color="#ff9a3d" position={[0, -4, -4]} scale={3} />
      </Environment>
      <Robot scrollRef={scrollRef} />
    </Canvas>
  );
}
