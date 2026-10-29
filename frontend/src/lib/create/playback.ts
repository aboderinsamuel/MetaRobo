// Reading a recorded simulation at any time t (interpolating between recorded frames), and the
// playback clock the workspace and viewport share.
import { create } from "zustand";
import { CLOTH_FPS, type Recording } from "./sim";

export interface Sample {
  q: Map<number, number>;
  base: { x: number; z: number; yaw: number; crouch: number; lean: number };
  rigid: Map<string, [number, number, number, number, number, number, number]>;
  sceneQ: Map<string, number>;
  step: number;
}

const lerpAngle = (a: number, b: number, u: number) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * u;
};

export function sample(rec: Recording, t: number): Sample {
  const f = Math.max(0, Math.min(rec.frames - 1, t * rec.fps));
  const i = Math.floor(f);
  const k = Math.min(rec.frames - 1, i + 1);
  const u = f - i;
  const nj = rec.joints.length;
  const q = new Map<number, number>();
  rec.joints.forEach((j, n) => q.set(j, rec.q[i * nj + n] + (rec.q[k * nj + n] - rec.q[i * nj + n]) * u));
  const B = 5;
  const lerp = (c: number) => rec.base[i * B + c] + (rec.base[k * B + c] - rec.base[i * B + c]) * u;
  const base = { x: lerp(0), z: lerp(1), yaw: lerpAngle(rec.base[i * B + 2], rec.base[k * B + 2], u), crouch: lerp(3), lean: lerp(4) };
  const nr = rec.rigid.length;
  const rigid = new Map<string, [number, number, number, number, number, number, number]>();
  rec.rigid.forEach((id, n) => {
    const a = (i * nr + n) * 7;
    const b = (k * nr + n) * 7;
    const p = Array.from({ length: 7 }, (_, c) => rec.rigidPose[a + c] + (rec.rigidPose[b + c] - rec.rigidPose[a + c]) * u) as [number, number, number, number, number, number, number];
    // Quaternions are close between frames: normalising the lerp is enough.
    const l = Math.hypot(p[3], p[4], p[5], p[6]) || 1;
    for (let c = 3; c < 7; c++) p[c] /= l;
    rigid.set(id, p);
  });
  const ns = rec.sceneJoints.length;
  const sceneQ = new Map<string, number>();
  rec.sceneJoints.forEach((id, n) => sceneQ.set(id, rec.sceneQ[i * ns + n] + (rec.sceneQ[k * ns + n] - rec.sceneQ[i * ns + n]) * u));
  const step = rec.steps.findIndex((s) => t >= s.start && t < s.end);
  return { q, base, rigid, sceneQ, step };
}

/** Cloth particle positions at time t, written into `out`. */
export function sampleCloth(rec: Recording, index: number, t: number, out: Float32Array): void {
  const c = rec.cloth[index];
  const n = c.nx * c.ny * 3;
  const f = Math.max(0, Math.min(rec.clothFrames - 1, t * CLOTH_FPS));
  const i = Math.floor(f);
  const k = Math.min(rec.clothFrames - 1, i + 1);
  const u = f - i;
  const a = i * n,
    b = k * n;
  for (let v = 0; v < n; v++) out[v] = c.pos[a + v] + (c.pos[b + v] - c.pos[a + v]) * u;
}

interface PlaybackState {
  t: number;
  playing: boolean;
  rate: number;
  duration: number;
  set: (p: Partial<Omit<PlaybackState, "set">>) => void;
}

export const usePlayback = create<PlaybackState>((set) => ({ t: 0, playing: false, rate: 1, duration: 0, set: (p) => set(p) }));
