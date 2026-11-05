// Step-response data: CSV parsing, a sample data set, and turning an identified fit into a model.
import { stepSOPDT } from "@/lib/sim/core";
import type { FitOut } from "@/lib/sim/core";
import { fmtNum } from "./analysis";
import type { LabModel } from "./types";

export interface StepData {
  t: number[];
  y: number[]; // deviation from the initial value
  y0: number;
  uStep: number;
  name: string;
}

/** Parses "t,y" or "t,u,y" CSV/TSV text (header optional). Column names t/time, u/input, y/output. */
export function parseStepCsv(text: string, name: string, uStepOverride?: number): StepData {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (lines.length < 6) throw new Error("Need at least 6 rows of data.");
  const split = (l: string) => l.split(/[,;\t ]+/).filter(Boolean);
  let header: string[] | null = null;
  if (split(lines[0]).some((c) => Number.isNaN(Number(c)))) header = split(lines.shift()!).map((h) => h.toLowerCase());
  const rows = lines.map(split).map((r) => r.map(Number));
  const width = rows[0].length;
  if (width < 2 || rows.some((r) => r.length < width || r.some((v) => !Number.isFinite(v)))) throw new Error("Every row needs numeric time and output columns.");
  const find = (names: string[], fallback: number) => {
    const i = header?.findIndex((h) => names.some((n) => h === n || h.startsWith(n))) ?? -1;
    return i >= 0 ? i : fallback;
  };
  const ti = find(["t", "time", "s"], 0);
  const yi = find(["y", "output", "out", "pv", "speed", "temp", "pos", "angle"], width - 1);
  const ui = width >= 3 ? find(["u", "input", "in", "cmd", "op", "volt", "power"], width === 3 ? 1 : -1) : -1;
  const t0 = rows[0][ti];
  const t = rows.map((r) => r[ti] - t0);
  for (let i = 1; i < t.length; i++) if (!(t[i] > t[i - 1])) throw new Error("Time must increase on every row.");
  const yRaw = rows.map((r) => r[yi]);
  const y0 = yRaw[0];
  let uStep = uStepOverride ?? 1;
  if (uStepOverride === undefined && ui >= 0 && ui !== yi) {
    const u = rows.map((r) => r[ui]);
    uStep = u[u.length - 1] - u[0] || u[u.length - 1] || 1;
  }
  return { t, y: yRaw.map((v) => v - y0), y0, uStep, name };
}

/** A realistic noisy step test: a motor speed loop with a small transport delay. */
export function sampleStepCsv(): string {
  const lines = ["time,voltage,speed_rpm"];
  let s = 12345;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
  for (let i = 0; i <= 250; i++) {
    const t = i * 0.01;
    const u = t >= 0 ? 6 : 0;
    const y = 300 + stepSOPDT(52, 14, 0.75, 0.04, t) * 6 + rnd() * 18;
    lines.push(`${t.toFixed(2)},${u},${y.toFixed(1)}`);
  }
  return lines.join("\n");
}

export function fitSummary(fit: FitOut, data: StepData): string {
  const order =
    fit.kind === 1
      ? `First order plus dead time: K = ${fmtNum(fit.K)}, τ = ${fmtNum(fit.tau)} s, θ = ${fmtNum(fit.theta)} s`
      : `Second order plus dead time: K = ${fmtNum(fit.K)}, ωn = ${fmtNum(fit.wn)} rad/s, ζ = ${fmtNum(fit.zeta)}, θ = ${fmtNum(fit.theta)} s`;
  return `${order}. Fit R² = ${fit.r2.toFixed(4)} over ${data.t.length} samples spanning ${fmtNum(data.t[data.t.length - 1])} s; input step ${fmtNum(data.uStep)}; output started at ${fmtNum(data.y0)}.`;
}

export function modelFromFit(fit: FitOut, data: StepData): LabModel {
  const span = data.t[data.t.length - 1];
  const finalOut = fit.K * data.uStep;
  const plant =
    fit.kind === 1
      ? { kind: "tf" as const, num: [fit.K], den: [fit.tau, 1], delay: fit.theta }
      : { kind: "tf" as const, num: [fit.K * fit.wn * fit.wn], den: [1, 2 * fit.zeta * fit.wn, fit.wn * fit.wn], delay: fit.theta };
  // Starting PI from SIMC rules on the dominant time constant (refined later by auto-tune).
  const tau = fit.kind === 1 ? fit.tau : (2 * fit.zeta) / fit.wn;
  const tc = Math.max(fit.theta, tau / 3);
  const kp = tau / (fit.K * (tc + fit.theta) || 1);
  const ki = kp / Math.min(tau, 4 * (tc + fit.theta));
  const uMax = Math.abs(data.uStep) * 3;
  return {
    title: `Identified plant · ${data.name}`,
    summary: `Fitted from your step test: an input step of ${fmtNum(data.uStep)} moved the output by about ${fmtNum(finalOut)}. ${
      fit.kind === 1 ? "The response looks first order with a dead time." : `The response is second order (ζ = ${fit.zeta.toFixed(2)}).`
    }`,
    domain: "identified",
    input: { name: "Input", unit: "u" },
    output: { name: "Output (deviation)", unit: "y" },
    params:
      fit.kind === 1
        ? [
            { symbol: "K", name: "Static gain", value: fit.K, unit: "y/u" },
            { symbol: "τ", name: "Time constant", value: fit.tau, unit: "s" },
            { symbol: "θ", name: "Dead time", value: fit.theta, unit: "s" },
            { symbol: "R²", name: "Fit quality", value: fit.r2, unit: "–" },
          ]
        : [
            { symbol: "K", name: "Static gain", value: fit.K, unit: "y/u" },
            { symbol: "ωn", name: "Natural frequency", value: fit.wn, unit: "rad/s" },
            { symbol: "ζ", name: "Damping ratio", value: fit.zeta, unit: "–" },
            { symbol: "θ", name: "Dead time", value: fit.theta, unit: "s" },
            { symbol: "R²", name: "Fit quality", value: fit.r2, unit: "–" },
          ],
    equations: fit.kind === 1 ? ["G(s) = K e^(−θs) / (τ s + 1)"] : ["G(s) = K ωn² e^(−θs) / (s² + 2ζωn s + ωn²)"],
    assumptions: ["The plant is linear around the tested operating point.", "The test started from rest and the input was a clean step at t = 0."],
    plant,
    controller: { type: "pid", kp, ki, kd: 0, N: 20 / Math.max(1e-3, tau) },
    controllerRationale: "PI controller from SIMC tuning rules on the identified time constant and dead time; refine with auto-tune.",
    specs: { maxOvershootPct: 10, maxSettlingTime: Math.max(span, 4 * (tau + fit.theta)) , maxSsErrorPct: 1, uMin: -uMax, uMax },
    sim: { tEnd: Math.max(span * 2, 8 * (tau + fit.theta)), ref: finalOut || 1 },
    source: "data",
  };
}
