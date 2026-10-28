// Shared shapes for the Control Lab: what the modeler (Muse Spark or the offline library) returns,
// and what the studio keeps per design iteration.
import type { Complex, Metrics } from "@/lib/sim/core";

export type PlantSpec =
  | { kind: "tf"; num: number[]; den: number[]; delay?: number }
  | { kind: "ss"; A: number[][]; B: number[]; C: number[]; D?: number; delay?: number; stateNames: string[] };

export type ControllerSpec =
  | { type: "pid"; kp: number; ki: number; kd: number; N: number }
  | { type: "lqr"; Q: number[]; R: number }
  | { type: "open" };

export interface ParamRow {
  symbol: string;
  name: string;
  value: number;
  unit: string;
}

export interface Specs {
  maxOvershootPct: number;
  maxSettlingTime: number;
  maxSsErrorPct: number;
  uMin: number;
  uMax: number;
}

export interface SimSetup {
  tEnd: number;
  ref: number;
  dt?: number;
  disturbance?: { time: number; magnitude: number };
  noiseStd?: number;
}

export type RigKind = "rover" | "arm" | "balancer" | "drone";

/** Which built-in 3D hardware shows this model, and what the output signal means on it. */
export interface RigSpec {
  kind: RigKind;
  signal: "speed" | "position" | "angle" | "altitude";
}

/**
 * Electrical model of a DC-motor actuator, present when the plant comes from a hardware build.
 * Motor current i = |u − Ke ω| / R + holdA, with ω = wPerY · y (mode "y") or wPerY · dy/dt
 * (mode "dy"). Lets tuning and validation respect the driver's current rating.
 */
export interface DriveModel {
  R: number;
  Ke: number;
  wPerY: number;
  mode: "y" | "dy";
  limitA: number;
  holdA: number;
}

export interface LabModel {
  rig?: RigSpec;
  drive?: DriveModel;
  title: string;
  summary: string;
  domain: string;
  input: { name: string; unit: string };
  output: { name: string; unit: string };
  params: ParamRow[];
  equations: string[];
  assumptions: string[];
  plant: PlantSpec;
  controller: ControllerSpec;
  controllerRationale: string;
  specs: Specs;
  sim: SimSetup;
  source: "meta" | "offline" | "data";
  presetId?: string;
}

export interface Proposal {
  label: string;
  rationale: string;
  controller: ControllerSpec;
}

export interface Advice {
  headline: string;
  explanation: string;
  diagnosis: string[];
  proposals: Proposal[];
  meetsSpecs: boolean;
  source: "meta" | "offline";
}

export interface Analysis {
  metrics: Metrics;
  poles: Complex[];
  openPoles: Complex[];
  gmDb: number;
  pmDeg: number;
  wcp: number;
  wcg: number;
}

export interface Iteration {
  id: number;
  label: string;
  controller: ControllerSpec;
  analysis: Analysis;
  note?: string;
}
