"use client";
/* eslint-disable react-hooks/immutability -- three.js scene objects (camera, meshes, groups) are mutable by design and are updated every frame. */

// The 3D workspace canvas: renders an AI-generated robot and its environment with physically
// based materials and soft studio lighting, plays back the recorded simulation (joints, base,
// rigid objects, doors, cloth), and lets you orbit, select parts and switch between skin,
// skeleton and both. Objects are built imperatively once per design so even 300-part robots stay
// smooth; playback only updates transforms.
import { Environment, Grid, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Cloth } from "@/lib/create/cloth";
import type { Design, JointSpec, ObjectSpec } from "@/lib/create/design";
import { buildGeometry } from "@/lib/create/geometry";
import { RobotModel, baseTransform } from "@/lib/create/kinematics";
import { materialFor } from "@/lib/create/materials";
import { sample, sampleCloth, usePlayback } from "@/lib/create/playback";
import { STAGE } from "@/lib/stage";
import type { Recording } from "@/lib/create/sim";

const DEG = Math.PI / 180;

export type ViewMode = "skin" | "skeleton" | "both";
export type CameraPreset = "iso" | "front" | "side" | "top" | "scene";

const GHOST = new THREE.MeshStandardMaterial({ color: "#8fa3c4", transparent: true, opacity: 0.16, depthWrite: false });
const BONE = new THREE.LineBasicMaterial({ color: "#7c5cff", depthTest: false, transparent: true });
const JOINT = new THREE.MeshBasicMaterial({ color: "#7c5cff", depthTest: false, transparent: true });

function applyJoint(g: THREE.Object3D, j: JointSpec, v: number) {
  if (j.type === "revolute") g.quaternion.setFromAxisAngle(new THREE.Vector3().fromArray(j.axis), v * DEG);
  else if (j.type === "prismatic") g.position.fromArray(j.axis).multiplyScalar(v);
}

function meshFor(spec: Parameters<typeof buildGeometry>[0] & { material: ObjectSpec["material"]; color: string }, tag: { kind: "node" | "object"; id: string }) {
  const m = new THREE.Mesh(buildGeometry(spec), materialFor(spec.material, spec.color));
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData = { ...tag, mat: m.material };
  return m;
}

interface Built {
  root: THREE.Group;
  base: THREE.Group;
  robot: RobotModel;
  jointGroups: Map<number, THREE.Group>;
  pivots: THREE.Object3D[];
  meshes: THREE.Mesh[];
  objects: Map<string, { joint: THREE.Group; spec: ObjectSpec }>;
  rigid: Map<string, THREE.Group>;
  cloth: { mesh: THREE.Mesh; buf: Float32Array }[];
  bones: THREE.LineSegments;
  jointDots: THREE.InstancedMesh;
  byId: Map<string, THREE.Object3D>;
}

function build(design: Design): Built {
  const root = new THREE.Group();
  const robot = new RobotModel(design);
  const base = new THREE.Group();
  root.add(base);
  const jointGroups = new Map<number, THREE.Group>();
  const pivots: THREE.Object3D[] = [];
  const meshes: THREE.Mesh[] = [];
  const byId = new Map<string, THREE.Object3D>();
  // Robot: pivot (rest pose) → joint (moves) → shape; children hang off the joint.
  const holders: THREE.Group[] = [];
  robot.nodes.forEach((n, i) => {
    const pivot = new THREE.Group();
    pivot.position.fromArray(n.position);
    pivot.rotation.set(n.rotation[0] * DEG, n.rotation[1] * DEG, n.rotation[2] * DEG);
    const joint = new THREE.Group();
    applyJoint(joint, n.joint, robot.q[i]);
    pivot.add(joint);
    const mesh = meshFor(n, { kind: "node", id: n.id });
    joint.add(mesh);
    meshes.push(mesh);
    holders[i] = joint;
    pivots[i] = joint;
    byId.set(n.id, mesh);
    if (n.joint.type !== "fixed") jointGroups.set(i, joint);
    pivot.userData.index = i;
  });
  robot.nodes.forEach((_, i) => {
    const p = robot.parent[i];
    (p >= 0 ? holders[p] : base).add(holders[i].parent!);
  });
  // The base's matrix is set directly from the shared base transform (same maths as the simulation).
  base.matrixAutoUpdate = false;
  robot.baseMatrix(base.matrix);

  // Scene objects, same structure; rigid bodies live at world level and follow the recording.
  const objects = new Map<string, { joint: THREE.Group; spec: ObjectSpec }>();
  const rigid = new Map<string, THREE.Group>();
  const cloth: Built["cloth"] = [];
  const pending: [ObjectSpec, THREE.Group][] = [];
  for (const o of design.scene) {
    if (o.kind === "cloth") {
      const c = new Cloth(o.cloth.width, o.cloth.length, new THREE.Vector3().fromArray(o.position), o.rotation[1] * DEG, o.massKg, o.cloth.stiffness);
      const g = new THREE.BufferGeometry();
      const idx: number[] = [];
      for (let j = 0; j < c.ny - 1; j++)
        for (let i = 0; i < c.nx - 1; i++) {
          const a = j * c.nx + i;
          idx.push(a, a + c.nx, a + 1, a + 1, a + c.nx, a + c.nx + 1);
        }
      const uv = new Float32Array(c.count * 2);
      for (let j = 0; j < c.ny; j++) for (let i = 0; i < c.nx; i++) uv.set([i / (c.nx - 1), j / (c.ny - 1)], (j * c.nx + i) * 2);
      const buf = new Float32Array(c.pos);
      g.setAttribute("position", new THREE.BufferAttribute(buf, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, materialFor("fabric", o.color));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.userData = { kind: "object", id: o.id, mat: mesh.material };
      root.add(mesh);
      cloth.push({ mesh, buf });
      byId.set(o.id, mesh);
      continue;
    }
    const pivot = new THREE.Group();
    pivot.position.fromArray(o.position);
    pivot.rotation.set(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);
    const joint = new THREE.Group();
    applyJoint(joint, o.joint, o.joint.rest);
    pivot.add(joint);
    const mesh = meshFor(o, { kind: "object", id: o.id });
    joint.add(mesh);
    byId.set(o.id, mesh);
    objects.set(o.id, { joint, spec: o });
    if (o.kind === "rigid") {
      rigid.set(o.id, pivot);
      root.add(pivot);
    } else pending.push([o, pivot]);
  }
  for (const [o, pivot] of pending) (o.parent && objects.get(o.parent) ? objects.get(o.parent)!.joint : root).add(pivot);

  // Skeleton overlay: a bone from each joint to its parent joint, and a dot on every joint.
  const bones = new THREE.LineSegments(new THREE.BufferGeometry(), BONE);
  bones.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(robot.nodes.length * 6), 3));
  bones.renderOrder = 10;
  bones.frustumCulled = false;
  const jointDots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.009, 12, 8), JOINT, Math.max(1, robot.moving.length));
  jointDots.renderOrder = 11;
  jointDots.frustumCulled = false;
  root.add(bones, jointDots);
  return { root, base, robot, jointGroups, pivots, meshes, objects, rigid, cloth, bones, jointDots, byId };
}

function Scene({ design, recording, selected, onSelect, mode, preset, theme }: ViewportProps) {
  const built = useMemo(() => build(design), [design]);
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitControlsImpl | null };
  const helper = useRef<THREE.BoxHelper | null>(null);

  useEffect(
    () => () => {
      built.root.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
    },
    [built],
  );

  // Frame the whole build (robot + scene) when a new design arrives or a view preset is picked.
  // The robot views frame the robot itself; "scene" and "top" frame everything.
  const bounds = useMemo(() => {
    built.root.updateMatrixWorld(true);
    const fallback = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const all = new THREE.Box3().setFromObject(built.root);
    const robot = new THREE.Box3().setFromObject(built.base);
    return { all: all.isEmpty() ? fallback : all, robot: robot.isEmpty() ? fallback : robot };
  }, [built]);
  useEffect(() => {
    const box = preset.name === "scene" || preset.name === "top" ? bounds.all : bounds.robot;
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(0.15, box.getSize(new THREE.Vector3()).length() / 2);
    const d = (r / Math.sin((camera.fov * DEG) / 2)) * (preset.name === "scene" ? 0.85 : 1.05);
    const dir = { iso: [0.8, 0.45, 1], front: [0, 0.12, 1], side: [1, 0.12, 0], top: [0.0001, 1, 0.0001], scene: [0.7, 0.6, 1] }[preset.name];
    camera.position.copy(c).add(new THREE.Vector3(...dir).normalize().multiplyScalar(d));
    camera.near = Math.max(0.005, d / 200);
    camera.far = d * 20;
    camera.updateProjectionMatrix();
    controls?.target.copy(c);
    controls?.update();
  }, [bounds, camera, controls, preset]);

  // Skin / skeleton / both.
  useEffect(() => {
    for (const m of built.meshes) m.material = mode === "skeleton" ? GHOST : m.userData.mat;
    built.bones.visible = built.jointDots.visible = mode !== "skin";
  }, [built, mode]);

  // Selection outline.
  useEffect(() => {
    const obj = selected ? built.byId.get(selected) : undefined;
    if (!obj) {
      helper.current?.removeFromParent();
      helper.current = null;
      return;
    }
    const h = new THREE.BoxHelper(obj, theme === "light" ? "#6d4dff" : "#9b87ff");
    (h.material as THREE.LineBasicMaterial).depthTest = false;
    h.renderOrder = 12;
    built.root.parent?.add(h);
    helper.current = h;
    return () => {
      h.removeFromParent();
      h.geometry.dispose();
    };
  }, [selected, built, theme]);

  useFrame((_, delta) => {
    const pb = usePlayback.getState();
    let t = pb.t;
    if (pb.playing && recording) {
      t = pb.t + delta * pb.rate;
      if (t >= recording.duration) {
        t = recording.duration;
        pb.set({ t, playing: false });
      } else pb.set({ t });
    }
    if (recording) {
      const s = sample(recording, t);
      baseTransform(s.base, recording.baseY, built.robot.pivot, built.base.matrix);
      for (const [j, g] of built.jointGroups) {
        const v = s.q.get(j);
        if (v !== undefined) applyJoint(g, built.robot.nodes[j].joint, v);
      }
      for (const [id, g] of built.rigid) {
        const p = s.rigid.get(id);
        if (!p) continue;
        g.position.set(p[0], p[1], p[2]);
        g.quaternion.set(p[3], p[4], p[5], p[6]);
      }
      for (const [id, v] of s.sceneQ) {
        const o = built.objects.get(id);
        if (o) applyJoint(o.joint, o.spec.joint, v);
      }
      built.cloth.forEach((c, k) => {
        sampleCloth(recording, k, t, c.buf);
        c.mesh.geometry.attributes.position.needsUpdate = true;
        c.mesh.geometry.computeVertexNormals();
      });
    }
    // Skeleton overlay follows the moving joints.
    if (built.bones.visible) {
      built.root.updateMatrixWorld(true);
      const pos = built.bones.geometry.attributes.position as THREE.BufferAttribute;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const m = new THREE.Matrix4();
      let k = 0;
      built.robot.nodes.forEach((_, i) => {
        const p = built.robot.parent[i];
        if (p < 0) return;
        a.setFromMatrixPosition(built.pivots[i].matrixWorld);
        b.setFromMatrixPosition(built.pivots[p].matrixWorld);
        pos.setXYZ(k++, a.x, a.y, a.z);
        pos.setXYZ(k++, b.x, b.y, b.z);
      });
      pos.needsUpdate = true;
      built.bones.geometry.setDrawRange(0, k);
      built.robot.moving.forEach((j, n) => {
        m.copy(built.pivots[j].matrixWorld);
        built.jointDots.setMatrixAt(n, m.makeTranslation(new THREE.Vector3().setFromMatrixPosition(built.pivots[j].matrixWorld)));
      });
      built.jointDots.instanceMatrix.needsUpdate = true;
    }
    helper.current?.update();
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    const id = e.object.userData?.id as string | undefined;
    onSelect(id ?? null);
  };

  return <primitive object={built.root} onClick={click} />;
}

function Stage({ theme }: { theme: "light" | "dark" }) {
  const light = theme === "light";
  const s = STAGE[theme];
  return (
    <>
      <color attach="background" args={[s.bg]} />
      <fog attach="fog" args={[s.bg, 9, 26]} />
      <hemisphereLight args={[s.sky, s.ground, s.hemi]} />
      <directionalLight position={[3, 6, 4]} intensity={light ? 2.1 : 1.8} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}>
        <orthographicCamera attach="shadow-camera" args={[-4, 4, 4, -4, 0.1, 20]} />
      </directionalLight>
      <directionalLight position={[-4, 3, -2]} intensity={light ? 0.5 : 0.35} color="#dfe8ff" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.4} position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[8, 8, 1]} />
        <Lightformer form="rect" intensity={1.4} position={[-5, 2, 1]} rotation={[0, Math.PI / 2, 0]} scale={[5, 3, 1]} color="#dbe6ff" />
        <Lightformer form="rect" intensity={1.1} position={[5, 1.5, -1]} rotation={[0, -Math.PI / 2, 0]} scale={[5, 3, 1]} color="#ffe9dc" />
        <Lightformer form="ring" intensity={0.8} position={[0, 2, 5]} scale={3} color={light ? "#ffffff" : "#8b7bff"} />
      </Environment>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <shadowMaterial opacity={s.shadow} />
      </mesh>
      <Grid
        infiniteGrid
        cellSize={0.1}
        sectionSize={1}
        cellThickness={0.6}
        sectionThickness={1}
        cellColor={s.cell}
        sectionColor={s.section}
        fadeDistance={22}
        fadeStrength={1.5}
        position={[0, 0.0005, 0]}
      />
    </>
  );
}

export interface ViewportProps {
  design: Design;
  recording: Recording | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  mode: ViewMode;
  /** a new object each time a preset is picked, so picking the same one re-frames */
  preset: { name: CameraPreset };
  theme: "light" | "dark";
}

export default function Viewport(props: ViewportProps) {
  return (
    <Canvas
      shadows="soft"
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: props.theme === "light" ? 1.05 : 1 }}
      camera={{ position: [2, 1.4, 2.6], fov: 35 }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <Stage theme={props.theme} />
      <Scene {...props} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI * 0.495} />
    </Canvas>
  );
}
