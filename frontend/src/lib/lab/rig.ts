// Every model is shown on one of four built-in hardware rigs. This file picks the rig from the
// user's words (or the model), and converts simulated signals into the rig's physical motion.
import type { LabModel, RigKind, RigSpec } from "./types";

export const RIGS: Record<RigKind, { name: string; blurb: string }> = {
  rover: { name: "Differential-drive rover", blurb: "DC motors, gearbox, wheels" },
  arm: { name: "Robot arm joint", blurb: "Servo-driven shoulder" },
  balancer: { name: "Self-balancing robot", blurb: "Inverted pendulum on wheels" },
  drone: { name: "Quadcopter", blurb: "Thrust-controlled altitude" },
};

// Specific words name the machine; generic words ("motor", "robot", "drive") appear in almost
// every description, so they only break ties.
const KEYWORDS: [RigKind, string[], string[]][] = [
  ["balancer", ["balanc", "segway", "inverted", "pendulum", "unicycle", "two-wheel", "two wheel", "upright", "wobbl", "tipping", "falls over", "fall over"], []],
  ["drone", ["drone", "quad", "uav", "altitude", "hover", "multirotor", "propeller", "helicopter", "flying", "rocket", "blimp", "elevator", "levitat", "climb"], ["height", "lift", "fly", "level", "vertical"]],
  ["arm", ["arm", "joint", "servo", "gripper", "manipulator", "crane", "gimbal", "turret", "shoulder", "elbow", "wrist", "knee", "finger", "leg"], ["angle", "pan", "tilt", "door", "valve", "rotate", "rotation", "position", "stage", "actuator", "radian", "degree"]],
  ["rover", ["rover", "car", "vehicle", "cart", "conveyor", "belt", "wheel", "cruise", "train", "tank tread", "truck", "kart"], ["robot", "motor", "drive", "speed", "rpm", "velocity"]],
];

/** Picks the closest rig for a description; falls back to the rover. */
export function pickRig(text: string): RigKind {
  const t = text.toLowerCase();
  let best: RigKind = "rover",
    bestScore = 0;
  for (const [kind, specific, generic] of KEYWORDS) {
    const score = specific.reduce((acc, w) => acc + (t.includes(w) ? 10 + w.length : 0), 0) + generic.reduce((acc, w) => acc + (t.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      best = kind;
      bestScore = score;
    }
  }
  return best;
}

function signalFor(kind: RigKind, unit: string): RigSpec["signal"] {
  const u = unit.toLowerCase().replace(/\s/g, "");
  if (kind === "arm") return "angle";
  if (kind === "drone") return "altitude";
  if (kind === "balancer") return "position";
  return /\/s|rpm|rad\/s|hz/.test(u) ? "speed" : "position";
}

export function rigFor(model: LabModel, text = ""): RigSpec {
  if (model.rig) return model.rig;
  const kind = pickRig(`${text} ${model.title} ${model.summary} ${model.output.name}`);
  return { kind, signal: signalFor(kind, model.output.unit) };
}

/**
 * Converts the output signal to SI for the rig (m/s, m or rad). Known units convert exactly;
 * anything else is normalised so the reference maps to a size that reads well on screen.
 */
export function displayScale(model: LabModel, rig: RigSpec): number {
  const u = model.output.unit.toLowerCase().replace(/\s/g, "");
  const ref = Math.abs(model.sim.ref) || 1;
  const nominal = { speed: 0.5, position: rig.kind === "balancer" ? 0.3 : 0.5, angle: 1, altitude: 1 }[rig.signal];
  const exact: Record<string, number> = { "m/s": 1, m: 1, mm: 1e-3, cm: 1e-2, rad: 1, deg: Math.PI / 180, "°": Math.PI / 180 };
  const k = exact[u];
  if (k !== undefined) {
    // Exact units, unless the motion would be too small or too large to see.
    const shown = ref * k;
    if (shown >= nominal * 0.1 && shown <= nominal * 8) return k;
  }
  return nominal / ref;
}

/** Cumulative trapezoidal integral (speed → distance). */
export function integrate(y: ArrayLike<number>, dt: number): Float64Array {
  const out = new Float64Array(y.length);
  for (let i = 1; i < y.length; i++) out[i] = out[i - 1] + 0.5 * (y[i] + y[i - 1]) * dt;
  return out;
}

/** Tilt estimate from horizontal acceleration when no tilt state is available: θ ≈ −ẍ / g. */
export function tiltFromPosition(x: ArrayLike<number>, dt: number): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 1; i < x.length - 1; i++) {
    const acc = (x[i + 1] - 2 * x[i] + x[i - 1]) / (dt * dt);
    out[i] = Math.max(-0.5, Math.min(0.5, -acc / 9.81));
  }
  // Light smoothing: second differences of a sampled signal are noisy.
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i < out.length - 1; i++) out[i] = (out[i - 1] + 2 * out[i] + out[i + 1]) / 4;
  return out;
}
