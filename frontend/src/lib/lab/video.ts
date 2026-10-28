// Turns SAM 3.1 boxes from a phone clip into step-response data the lab can fit.
//
// Scale comes from the object itself: you tell us how long it really is, and its tracked box width
// gives metres per pixel. Motion is measured along whichever image axis the object travels most.
// This assumes the clip is filmed side-on with a still camera, and that the command was applied
// as a step when the robot started moving.
import type { SamBox } from "@/lib/meta/sam";

export interface VideoTrackInput {
  boxes: SamBox[];
  fps: number;
  /** The tracked object's real length along its direction of travel, in metres. */
  lengthM: number;
  measure: "speed" | "position";
  /** Size of the command step (e.g. 6 V or 100 % PWM). */
  uStep: number;
}

export interface VideoTrackOut {
  csv: string;
  axis: "x" | "y";
  metresPerPixel: number;
  distanceM: number;
  peakSpeed: number;
  samples: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Estimates frames per second from SAM's frame count and the clip duration; falls back to 30. */
export function estimateFps(frameCount: number, durationS: number): number {
  const fps = durationS > 0 ? frameCount / durationS : 0;
  return fps >= 10 && fps <= 120 ? fps : 30;
}

export function tracksToStepCsv({ boxes, fps, lengthM, measure, uStep }: VideoTrackInput): VideoTrackOut {
  if (boxes.length < 8) throw new Error("The object was only found in a few frames. Film it for longer, side-on, with the whole robot in view.");
  const cx = boxes.map((b) => (b.x1 + b.x2) / 2);
  const cy = boxes.map((b) => (b.y1 + b.y2) / 2);
  const range = (v: number[]) => Math.max(...v) - Math.min(...v);
  const axis: "x" | "y" = range(cx) >= range(cy) ? "x" : "y";
  const c = axis === "x" ? cx : cy;
  // The object's size along its travel direction is the ruler.
  const sizePx = median(boxes.map((b) => (axis === "x" ? b.x2 - b.x1 : b.y2 - b.y1)));
  if (!(sizePx > 2)) throw new Error("The tracked box is too small to measure. Film closer.");
  const mpp = lengthM / sizePx;

  const t = boxes.map((b) => (b.frame - boxes[0].frame) / fps);
  // Positive = the direction it actually went.
  const sign = c[c.length - 1] >= c[0] ? 1 : -1;
  const pos = c.map((v) => (v - c[0]) * mpp * sign);

  // Speed from a centred difference over ~0.1 s, then a light moving average.
  const k = Math.max(1, Math.round(fps * 0.1));
  const raw = pos.map((_, i) => {
    const a = Math.max(0, i - k);
    const b = Math.min(pos.length - 1, i + k);
    return t[b] > t[a] ? (pos[b] - pos[a]) / (t[b] - t[a]) : 0;
  });
  const speed = raw.map((_, i) => {
    const w = raw.slice(Math.max(0, i - k), Math.min(raw.length, i + k + 1));
    return w.reduce((s, v) => s + v, 0) / w.length;
  });
  speed[0] = 0; // starts from rest

  const y = measure === "speed" ? speed : pos;
  const lines = [`time,input,${measure === "speed" ? "speed_m_s" : "position_m"}`];
  for (let i = 0; i < t.length; i++) {
    if (i > 0 && !(t[i] > t[i - 1])) continue;
    lines.push(`${t[i].toFixed(4)},${uStep},${y[i].toFixed(5)}`);
  }
  return { csv: lines.join("\n"), axis, metresPerPixel: mpp, distanceM: pos[pos.length - 1], peakSpeed: Math.max(...speed), samples: lines.length - 1 };
}
