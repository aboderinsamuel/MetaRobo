// Cloth physics for garments, towels and sheets: a position-based (Verlet) mass-spring grid with
// structural, shear and bending constraints, gravity, air drag, friction, and collisions against
// the floor, the scene's furniture and containers (oriented boxes), and the robot's fingers and
// palms (spheres). Grasping pins the particles under the fingertips; they follow the hand until
// it lets go. Folding is the robot really moving pinched corners over the cloth.
import * as THREE from "three";

export interface Obb {
  /** world → box-local */
  inv: THREE.Matrix4;
  /** box-local → world */
  m: THREE.Matrix4;
  half: THREE.Vector3;
}

export interface Sphere {
  c: THREE.Vector3;
  r: number;
}

const GRAVITY = -9.81;

export class Cloth {
  readonly nx: number;
  readonly ny: number;
  readonly pos: Float32Array;
  private prev: Float32Array;
  private readonly invMass: Float32Array;
  private readonly cons: Int32Array;
  private readonly rest: Float32Array;
  private readonly stiff: Float32Array;
  /** pinned particle → the gripper it follows and its offset in that gripper's frame */
  readonly pins = new Map<number, { key: string; off: THREE.Vector3 }>();
  /** 1 where a particle is pinned (fast lookup in the solver) */
  private pinned: Uint8Array;
  readonly thickness = 0.006;
  readonly mass: number;

  constructor(width: number, length: number, center: THREE.Vector3, yaw: number, mass: number, stiffness: number) {
    const spacing = Math.max(0.04, Math.max(width, length) / 15);
    this.nx = Math.max(4, Math.round(width / spacing) + 1);
    this.ny = Math.max(4, Math.round(length / spacing) + 1);
    this.mass = mass;
    const n = this.nx * this.ny;
    this.pos = new Float32Array(n * 3);
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const k = (j * this.nx + i) * 3;
        const lx = (i / (this.nx - 1) - 0.5) * width;
        const lz = (j / (this.ny - 1) - 0.5) * length;
        this.pos[k] = center.x + lx * c + lz * s;
        // A tiny ripple so it doesn't land as a perfect plane.
        this.pos[k + 1] = center.y + 0.002 * Math.sin(i * 1.7 + j * 2.3);
        this.pos[k + 2] = center.z - lx * s + lz * c;
      }
    this.prev = new Float32Array(this.pos);
    this.invMass = new Float32Array(n).fill(n / mass);
    this.pinned = new Uint8Array(n);
    const cons: number[] = [];
    const st: number[] = [];
    const add = (a: number, b: number, k: number) => {
      cons.push(a, b);
      st.push(k);
    };
    const id = (i: number, j: number) => j * this.nx + i;
    const bend = 0.05 + stiffness * 0.5;
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        if (i + 1 < this.nx) add(id(i, j), id(i + 1, j), 1);
        if (j + 1 < this.ny) add(id(i, j), id(i, j + 1), 1);
        if (i + 1 < this.nx && j + 1 < this.ny) {
          add(id(i, j), id(i + 1, j + 1), 0.6);
          add(id(i + 1, j), id(i, j + 1), 0.6);
        }
        if (i + 2 < this.nx) add(id(i, j), id(i + 2, j), bend);
        if (j + 2 < this.ny) add(id(i, j), id(i, j + 2), bend);
      }
    this.cons = Int32Array.from(cons);
    this.stiff = Float32Array.from(st);
    this.rest = new Float32Array(st.length);
    for (let c2 = 0; c2 < st.length; c2++) {
      const a = cons[c2 * 2] * 3,
        b = cons[c2 * 2 + 1] * 3;
      this.rest[c2] = Math.hypot(this.pos[a] - this.pos[b], this.pos[a + 1] - this.pos[b + 1], this.pos[a + 2] - this.pos[b + 2]);
    }
  }

  get count(): number {
    return this.nx * this.ny;
  }

  corner(which: 0 | 1 | 2 | 3): number {
    return [0, this.nx - 1, (this.ny - 1) * this.nx, this.ny * this.nx - 1][which];
  }

  point(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
  }

  centroid(out = new THREE.Vector3()): THREE.Vector3 {
    out.set(0, 0, 0);
    for (let i = 0; i < this.count; i++) out.x += this.pos[i * 3];
    for (let i = 0; i < this.count; i++) out.y += this.pos[i * 3 + 1];
    for (let i = 0; i < this.count; i++) out.z += this.pos[i * 3 + 2];
    return out.multiplyScalar(1 / this.count);
  }

  /** Footprint area on the floor plane (bounding box), for fold checks. */
  footprint(): number {
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (let i = 0; i < this.count; i++) {
      x0 = Math.min(x0, this.pos[i * 3]);
      x1 = Math.max(x1, this.pos[i * 3]);
      z0 = Math.min(z0, this.pos[i * 3 + 2]);
      z1 = Math.max(z1, this.pos[i * 3 + 2]);
    }
    return (x1 - x0) * (z1 - z0);
  }

  nearest(p: THREE.Vector3): number {
    let best = 0,
      bd = Infinity;
    for (let i = 0; i < this.count; i++) {
      const d = (this.pos[i * 3] - p.x) ** 2 + (this.pos[i * 3 + 1] - p.y) ** 2 + (this.pos[i * 3 + 2] - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** Pin every particle within r of p to a moving frame (the gripper), keeping their offsets. */
  pinNear(p: THREE.Vector3, r: number, key: string, frameInv: THREE.Matrix4): number {
    let n = 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < this.count; i++) {
      this.point(i, v);
      if (v.distanceTo(p) <= r) {
        this.pins.set(i, { key, off: v.clone().applyMatrix4(frameInv) });
        this.pinned[i] = 1;
        n++;
      }
    }
    return n;
  }

  unpin(key: string): void {
    for (const [i, pin] of this.pins)
      if (pin.key === key) {
        this.pins.delete(i);
        this.pinned[i] = 0;
      }
  }

  step(dt: number, frames: Map<string, THREE.Matrix4>, boxes: Obb[], spheres: Sphere[], iterations = 8): void {
    const n = this.count;
    const p = this.pos;
    const q = this.prev;
    const damp = 0.985;
    // Integrate.
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const vx = (p[k] - q[k]) * damp,
        vy = (p[k + 1] - q[k + 1]) * damp,
        vz = (p[k + 2] - q[k + 2]) * damp;
      q[k] = p[k];
      q[k + 1] = p[k + 1];
      q[k + 2] = p[k + 2];
      p[k] += vx;
      p[k + 1] += vy + GRAVITY * dt * dt;
      p[k + 2] += vz;
    }
    const v = new THREE.Vector3();
    // Broad phase: only boxes and spheres near the cloth's bounds this step.
    let x0 = Infinity,
      y0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity,
      z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (p[k] < x0) x0 = p[k];
      if (p[k] > x1) x1 = p[k];
      if (p[k + 1] < y0) y0 = p[k + 1];
      if (p[k + 1] > y1) y1 = p[k + 1];
      if (p[k + 2] < z0) z0 = p[k + 2];
      if (p[k + 2] > z1) z1 = p[k + 2];
    }
    const pad = 0.08;
    const near = boxes.filter((b) => {
      // World half-extents of the oriented box: |R| · half.
      const e = b.m.elements;
      const cx = e[12],
        cy = e[13],
        cz = e[14];
      const ex = Math.abs(e[0]) * b.half.x + Math.abs(e[4]) * b.half.y + Math.abs(e[8]) * b.half.z;
      const ey = Math.abs(e[1]) * b.half.x + Math.abs(e[5]) * b.half.y + Math.abs(e[9]) * b.half.z;
      const ez = Math.abs(e[2]) * b.half.x + Math.abs(e[6]) * b.half.y + Math.abs(e[10]) * b.half.z;
      return cx + ex > x0 - pad && cx - ex < x1 + pad && cy + ey > y0 - pad && cy - ey < y1 + pad && cz + ez > z0 - pad && cz - ez < z1 + pad;
    });
    const nearSpheres = spheres.filter((b) => b.c.x + b.r > x0 - pad && b.c.x - b.r < x1 + pad && b.c.y + b.r > y0 - pad && b.c.y - b.r < y1 + pad && b.c.z + b.r > z0 - pad && b.c.z - b.r < z1 + pad);
    const cons = this.cons,
      rest = this.rest,
      stiff = this.stiff,
      pinned = this.pinned,
      invMass = this.invMass,
      nc = rest.length;
    for (let it = 0; it < iterations; it++) {
      // Distance constraints.
      for (let c = 0; c < nc; c++) {
        const a = cons[c * 2],
          b = cons[c * 2 + 1];
        const ka = a * 3,
          kb = b * 3;
        const dx = p[kb] - p[ka],
          dy = p[kb + 1] - p[ka + 1],
          dz = p[kb + 2] - p[ka + 2];
        // sqrt, not Math.hypot: hypot is several times slower in V8 and this is the hot loop.
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        const wa = pinned[a] ? 0 : invMass[a],
          wb = pinned[b] ? 0 : invMass[b];
        const w = wa + wb;
        if (w === 0) continue;
        // Cloth barely stretches but folds freely: compression is resisted only weakly.
        const diff = d - rest[c];
        const k = (diff > 0 ? 1 : 0.15) * stiff[c];
        const s = (k * diff) / (d * w);
        p[ka] += dx * s * wa;
        p[ka + 1] += dy * s * wa;
        p[ka + 2] += dz * s * wa;
        p[kb] -= dx * s * wb;
        p[kb + 1] -= dy * s * wb;
        p[kb + 2] -= dz * s * wb;
      }
      // Pins follow the gripper.
      for (const [i, pin] of this.pins) {
        const f = frames.get(pin.key);
        if (!f) continue;
        v.copy(pin.off).applyMatrix4(f);
        p[i * 3] = v.x;
        p[i * 3 + 1] = v.y;
        p[i * 3 + 2] = v.z;
      }
      // Collisions (the last passes only; constraints settle in between): floor, boxes, spheres,
      // with friction against whatever it rests on.
      if (it < iterations - 2) continue;
      const t = this.thickness;
      for (let i = 0; i < n; i++) {
        if (pinned[i]) continue;
        const k = i * 3;
        if (p[k + 1] < t) {
          p[k + 1] = t;
          p[k] = q[k] + (p[k] - q[k]) * 0.4;
          p[k + 2] = q[k + 2] + (p[k + 2] - q[k + 2]) * 0.4;
        }
        for (const s of nearSpheres) {
          v.set(p[k] - s.c.x, p[k + 1] - s.c.y, p[k + 2] - s.c.z);
          const d = v.length();
          if (d < s.r + t && d > 1e-6) {
            v.multiplyScalar((s.r + t) / d);
            p[k] = s.c.x + v.x;
            p[k + 1] = s.c.y + v.y;
            p[k + 2] = s.c.z + v.z;
          }
        }
        for (const b of near) {
          // World → box-local (rigid transform, written out for speed).
          const e = b.inv.elements;
          const px = p[k],
            py = p[k + 1],
            pz = p[k + 2];
          let lx = e[0] * px + e[4] * py + e[8] * pz + e[12];
          let ly = e[1] * px + e[5] * py + e[9] * pz + e[13];
          let lz = e[2] * px + e[6] * py + e[10] * pz + e[14];
          const hx = b.half.x + t,
            hy = b.half.y + t,
            hz = b.half.z + t;
          if (Math.abs(lx) >= hx || Math.abs(ly) >= hy || Math.abs(lz) >= hz) continue;
          // Push out through the nearest face.
          const ex = hx - Math.abs(lx),
            ey = hy - Math.abs(ly),
            ez = hz - Math.abs(lz);
          if (ey <= ex && ey <= ez) ly = Math.sign(ly || 1) * hy;
          else if (ex <= ez) lx = Math.sign(lx || 1) * hx;
          else lz = Math.sign(lz || 1) * hz;
          const m = b.m.elements;
          p[k] = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
          p[k + 1] = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
          p[k + 2] = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
          // Friction on whatever it rests on.
          p[k] = q[k] + (p[k] - q[k]) * 0.55;
          p[k + 2] = q[k + 2] + (p[k + 2] - q[k + 2]) * 0.55;
        }
      }
    }
  }
}
