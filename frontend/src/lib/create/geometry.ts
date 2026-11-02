// Turns a design shape into real geometry (for rendering) and matching collision shapes (for the
// physics engine). Shapes are built in the node's frame: the shape's centre sits at `offset`,
// rotated by `orient`.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { NodeSpec } from "./design";

export type ShapeSpec = Pick<NodeSpec, "shape" | "dims" | "bevel" | "points" | "offset" | "orient">;

const DEG = Math.PI / 180;

function rawGeometry(s: ShapeSpec): THREE.BufferGeometry {
  const [a, b, c] = s.dims;
  switch (s.shape) {
    case "box": {
      const r = Math.min(s.bevel, a / 2 - 1e-4, b / 2 - 1e-4, c / 2 - 1e-4);
      return r > 0.0005 ? new RoundedBoxGeometry(a, b, c, 3, r) : new THREE.BoxGeometry(a, b, c);
    }
    case "cylinder":
      return new THREE.CylinderGeometry(c / 2, a / 2, b, 48, 1);
    case "capsule":
      return new THREE.CapsuleGeometry(a / 2, b, 10, 28);
    case "sphere": {
      const g = new THREE.SphereGeometry(0.5, 48, 32);
      g.scale(a, b, c);
      return g;
    }
    case "torus":
      return new THREE.TorusGeometry(Math.max(1e-3, (a - b) / 2), b / 2, 20, 72, (c || 360) * DEG);
    case "lathe": {
      // Centred on its height like every other shape, so `offset` is the middle of the shell.
      const pts = s.points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
      const ys = pts.map((p) => p.y);
      return new THREE.LatheGeometry(pts, 64).translate(0, -(Math.min(...ys) + Math.max(...ys)) / 2, 0);
    }
    case "extrude": {
      const shape = new THREE.Shape(s.points.map(([x, y]) => new THREE.Vector2(x, y)));
      const bevel = Math.min(s.bevel, c / 3);
      const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-4, c - 2 * bevel), bevelEnabled: bevel > 1e-4, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 16 });
      g.translate(0, 0, -(c - 2 * bevel) / 2);
      return g;
    }
    case "tube": {
      const curve = new THREE.CatmullRomCurve3(s.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      return new THREE.TubeGeometry(curve, Math.max(16, s.points.length * 12), a / 2, 14, false);
    }
    case "bin": {
      const t = Math.max(0.002, s.bevel || 0.004);
      const parts = [
        new RoundedBoxGeometry(a, t, c, 2, t / 3).translate(0, -b / 2 + t / 2, 0),
        new RoundedBoxGeometry(a, b, t, 2, t / 3).translate(0, 0, c / 2 - t / 2),
        new RoundedBoxGeometry(a, b, t, 2, t / 3).translate(0, 0, -c / 2 + t / 2),
        new RoundedBoxGeometry(t, b, c, 2, t / 3).translate(a / 2 - t / 2, 0, 0),
        new RoundedBoxGeometry(t, b, c, 2, t / 3).translate(-a / 2 + t / 2, 0, 0),
      ];
      return mergeGeometries(parts.map((p) => p.toNonIndexed()));
    }
    case "drum": {
      const r = a / 2;
      const outer = new THREE.CylinderGeometry(r, r, c, 56, 1, true).rotateX(Math.PI / 2);
      const back = new THREE.CircleGeometry(r, 56).translate(0, 0, -c / 2);
      return mergeGeometries([outer.toNonIndexed(), back.toNonIndexed()]);
    }
  }
}

/** Geometry for a shape, placed and oriented in the node's frame. */
export function buildGeometry(s: ShapeSpec): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  try {
    g = rawGeometry(s);
  } catch {
    g = new THREE.BoxGeometry(...s.dims);
  }
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...s.offset), new THREE.Quaternion().setFromEuler(new THREE.Euler(s.orient[0] * DEG, s.orient[1] * DEG, s.orient[2] * DEG)), new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  if (!g.attributes.normal) g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------------ colliders

export type Collider =
  | { type: "cuboid"; half: [number, number, number]; pos: THREE.Vector3; rot: THREE.Quaternion }
  | { type: "ball"; r: number; pos: THREE.Vector3; rot: THREE.Quaternion }
  | { type: "capsule"; halfHeight: number; r: number; pos: THREE.Vector3; rot: THREE.Quaternion }
  | { type: "cylinder"; halfHeight: number; r: number; pos: THREE.Vector3; rot: THREE.Quaternion }
  | { type: "hull"; points: Float32Array; pos: THREE.Vector3; rot: THREE.Quaternion }
  | { type: "trimesh"; vertices: Float32Array; indices: Uint32Array; pos: THREE.Vector3; rot: THREE.Quaternion };

/**
 * Collision shapes for a shape in its node's frame. Primitives where they fit; hollow shapes
 * (bins, drums) as walls so things can go inside; static meshes as exact triangle meshes;
 * everything else as a convex hull.
 */
export function buildColliders(s: ShapeSpec, solid: "static" | "dynamic"): Collider[] {
  const base = new THREE.Matrix4().compose(new THREE.Vector3(...s.offset), new THREE.Quaternion().setFromEuler(new THREE.Euler(s.orient[0] * DEG, s.orient[1] * DEG, s.orient[2] * DEG)), new THREE.Vector3(1, 1, 1));
  const at = (x: number, y: number, z: number, q = new THREE.Quaternion()) => {
    const m = base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    m.decompose(pos, rot, new THREE.Vector3());
    return { pos, rot };
  };
  const [a, b, c] = s.dims;
  switch (s.shape) {
    case "box":
      return [{ type: "cuboid", half: [a / 2, b / 2, c / 2], ...at(0, 0, 0) }];
    case "capsule":
      return [{ type: "capsule", halfHeight: b / 2, r: a / 2, ...at(0, 0, 0) }];
    case "cylinder":
      if (Math.abs(a - c) < 1e-4) return [{ type: "cylinder", halfHeight: b / 2, r: a / 2, ...at(0, 0, 0) }];
      break;
    case "sphere":
      if (Math.abs(a - b) < 1e-4 && Math.abs(b - c) < 1e-4) return [{ type: "ball", r: a / 2, ...at(0, 0, 0) }];
      break;
    case "bin": {
      const t = Math.max(0.004, s.bevel || 0.004);
      return [
        { type: "cuboid", half: [a / 2, t / 2, c / 2], ...at(0, -b / 2 + t / 2, 0) },
        { type: "cuboid", half: [a / 2, b / 2, t / 2], ...at(0, 0, c / 2 - t / 2) },
        { type: "cuboid", half: [a / 2, b / 2, t / 2], ...at(0, 0, -c / 2 + t / 2) },
        { type: "cuboid", half: [t / 2, b / 2, c / 2], ...at(a / 2 - t / 2, 0, 0) },
        { type: "cuboid", half: [t / 2, b / 2, c / 2], ...at(-a / 2 + t / 2, 0, 0) },
      ];
    }
    case "drum": {
      const r = a / 2;
      const n = 16;
      const t = Math.max(0.006, b);
      const out: Collider[] = [{ type: "cylinder", halfHeight: t / 2, r, ...at(0, 0, -c / 2, new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))) }];
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        out.push({ type: "cuboid", half: [(Math.PI * r) / n + 0.002, t / 2, c / 2], ...at(Math.sin(ang) * r, Math.cos(ang) * r, 0, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ang)) });
      }
      return out;
    }
    case "tube": {
      const out: Collider[] = [];
      for (let i = 1; i < s.points.length; i++) {
        const p0 = new THREE.Vector3(...(s.points[i - 1] as [number, number, number]));
        const p1 = new THREE.Vector3(...(s.points[i] as [number, number, number]));
        const len = p0.distanceTo(p1);
        if (len < 1e-4) continue;
        const mid = p0.clone().add(p1).multiplyScalar(0.5);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
        out.push({ type: "capsule", halfHeight: len / 2, r: a / 2, ...at(mid.x, mid.y, mid.z, q) });
      }
      return out;
    }
  }
  // Everything else: the exact mesh for static scenery, a convex hull for moving bodies.
  const g = rawGeometry(s);
  const pos = g.attributes.position.array as Float32Array;
  if (solid === "static") {
    const idx = g.index ? new Uint32Array(g.index.array) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
    return [{ type: "trimesh", vertices: new Float32Array(pos), indices: idx, ...at(0, 0, 0) }];
  }
  return [{ type: "hull", points: new Float32Array(pos), ...at(0, 0, 0) }];
}
