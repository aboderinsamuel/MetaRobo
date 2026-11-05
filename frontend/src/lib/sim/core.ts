// TypeScript port of engine/src/plantsim.cpp.
//
// The browser prefers the WebAssembly build of the C++ engine. This port runs when the .wasm
// file is missing (and on the server, where the AI routes verify their own suggestions).
// tests/engine.test.ts checks that both give the same numbers via engine/tests/golden.json.
// Keep this file free of imports so Node can run it directly.

export type Complex = { re: number; im: number };

export interface Plant {
  n: number;
  A: number[]; // row-major n*n
  B: number[];
  C: number[];
  D: number;
  delay: number;
}

export const CTRL_OPEN = 0;
export const CTRL_PID = 1;
export const CTRL_SF = 2;

export interface Ctrl {
  type: 0 | 1 | 2;
  kp: number;
  ki: number;
  kd: number;
  N: number;
  Nbar: number;
  K: number[];
}

export interface SimCfg {
  tEnd: number;
  dt: number;
  ref: number;
  distTime: number;
  distMag: number;
  uMin: number;
  uMax: number;
  noiseStd: number;
  seed: number;
}

export interface Metrics {
  riseTime: number;
  settlingTime: number;
  overshootPct: number;
  peak: number;
  peakTime: number;
  finalValue: number;
  ssError: number;
  iae: number;
  ise: number;
  maxAbsU: number;
  stable: number;
  saturatedFrac: number;
}

export const METRIC_KEYS: (keyof Metrics)[] = [
  "riseTime",
  "settlingTime",
  "overshootPct",
  "peak",
  "peakTime",
  "finalValue",
  "ssError",
  "iae",
  "ise",
  "maxAbsU",
  "stable",
  "saturatedFrac",
];

export interface SimOut {
  dt: number;
  y: Float64Array;
  u: Float64Array;
  r: Float64Array;
  metrics: Metrics;
}

export interface BodeOut {
  w: number[];
  mag: number[];
  phase: number[];
  gmDb: number;
  pmDeg: number;
  wcg: number;
  wcp: number;
}

export interface FitOut {
  kind: 1 | 2;
  K: number;
  tau: number;
  wn: number;
  zeta: number;
  theta: number;
  sse: number;
  r2: number;
}

export const DEFAULT_CTRL: Ctrl = { type: 0, kp: 0, ki: 0, kd: 0, N: 50, Nbar: 1, K: [] };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const cAdd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
const cSub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
const cMul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cDiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const cAbs = (a: Complex) => Math.hypot(a.re, a.im);
const C = (re: number, im = 0): Complex => ({ re, im });

function eye(n: number): number[] {
  const m = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) m[i * n + i] = 1;
  return m;
}

function matmul(x: number[], y: number[], n: number): number[] {
  const out = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) {
      const v = x[i * n + k];
      if (v === 0) continue;
      for (let j = 0; j < n; j++) out[i * n + j] += v * y[k * n + j];
    }
  return out;
}

function transpose(x: number[], n: number): number[] {
  const out = new Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[j * n + i] = x[i * n + j];
  return out;
}

export function inverse(x: number[], n: number): number[] | null {
  const m = x.slice();
  const out = eye(n);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let i = col + 1; i < n; i++) if (Math.abs(m[i * n + col]) > Math.abs(m[piv * n + col])) piv = i;
    if (Math.abs(m[piv * n + col]) < 1e-300) return null;
    if (piv !== col)
      for (let j = 0; j < n; j++) {
        [m[col * n + j], m[piv * n + j]] = [m[piv * n + j], m[col * n + j]];
        [out[col * n + j], out[piv * n + j]] = [out[piv * n + j], out[col * n + j]];
      }
    const d = m[col * n + col];
    for (let j = 0; j < n; j++) {
      m[col * n + j] /= d;
      out[col * n + j] /= d;
    }
    for (let i = 0; i < n; i++) {
      if (i === col) continue;
      const f = m[i * n + col];
      if (f === 0) continue;
      for (let j = 0; j < n; j++) {
        m[i * n + j] -= f * m[col * n + j];
        out[i * n + j] -= f * out[col * n + j];
      }
    }
  }
  return out;
}

function solveShifted(A: number[], n: number, s: Complex, b: number[]): Complex[] | null {
  const m: Complex[][] = [];
  for (let i = 0; i < n; i++) {
    const row: Complex[] = [];
    for (let j = 0; j < n; j++) row.push(C(-A[i * n + j]));
    row[i] = cAdd(row[i], s);
    row.push(C(b[i]));
    m.push(row);
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let i = col + 1; i < n; i++) if (cAbs(m[i][col]) > cAbs(m[piv][col])) piv = i;
    if (cAbs(m[piv][col]) < 1e-300) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let i = col + 1; i < n; i++) {
      const f = cDiv(m[i][col], m[col][col]);
      for (let j = col; j <= n; j++) m[i][j] = cSub(m[i][j], cMul(f, m[col][j]));
    }
  }
  const x: Complex[] = new Array(n).fill(null).map(() => C(0));
  for (let i = n - 1; i >= 0; i--) {
    let acc = m[i][n];
    for (let j = i + 1; j < n; j++) acc = cSub(acc, cMul(m[i][j], x[j]));
    x[i] = cDiv(acc, m[i][i]);
  }
  return x;
}

function trimLeading(p: number[]): number[] {
  let i = 0;
  while (i + 1 < p.length && Math.abs(p[i]) < 1e-14) i++;
  return p.slice(i);
}

// ---------------------------------------------------------------------------
// Model conversions
// ---------------------------------------------------------------------------

export function tf2ss(numIn: number[], denIn: number[], delay = 0): Plant {
  let den = trimLeading(denIn);
  let num = trimLeading(numIn);
  const n = den.length - 1;
  const plant: Plant = { n, A: new Array(n * n).fill(0), B: new Array(n).fill(0), C: new Array(n).fill(0), D: 0, delay };
  if (n <= 0) {
    plant.D = !den.length || den[0] === 0 || !num.length ? 0 : num[num.length - 1] / den[0];
    return plant;
  }
  const a0 = den[0];
  den = den.map((v) => v / a0);
  num = num.map((v) => v / a0);
  const b = new Array(n + 1).fill(0);
  const off = n + 1 - num.length;
  num.forEach((v, i) => {
    if (off + i >= 0) b[off + i] = v;
  });
  plant.D = b[0];
  for (let j = 0; j < n; j++) plant.A[j] = -den[j + 1];
  for (let i = 1; i < n; i++) plant.A[i * n + i - 1] = 1;
  plant.B[0] = 1;
  for (let j = 0; j < n; j++) plant.C[j] = b[j + 1] - den[j + 1] * b[0];
  return plant;
}

function faddeev(A: number[], n: number): { p: number[]; M: number[][] } {
  const p = new Array(n + 1).fill(0);
  p[0] = 1;
  const M: number[][] = [];
  let Mk = eye(n);
  for (let k = 1; k <= n; k++) {
    if (k > 1) {
      Mk = matmul(A, M[M.length - 1], n);
      for (let i = 0; i < n; i++) Mk[i * n + i] += p[k - 1];
    }
    M.push(Mk);
    const AM = matmul(A, Mk, n);
    let tr = 0;
    for (let i = 0; i < n; i++) tr += AM[i * n + i];
    p[k] = -tr / k;
  }
  return { p, M };
}

export function charpoly(A: number[], n: number): number[] {
  return faddeev(A, n).p;
}

export function ss2tf(plant: Plant): { num: number[]; den: number[] } {
  const { n } = plant;
  const { p, M } = faddeev(plant.A, n);
  const num = p.map((v) => plant.D * v);
  for (let k = 1; k <= n; k++) {
    let v = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += plant.C[i] * M[k - 1][i * n + j] * plant.B[j];
    num[k] += v;
  }
  const tol = 1e-12 * (1 + Math.abs(p[n]));
  return { num: num.map((v) => (Math.abs(v) < tol ? 0 : v)), den: p };
}

export function roots(polyIn: number[]): Complex[] {
  let poly = trimLeading(polyIn);
  const m = poly.length - 1;
  if (m <= 0 || poly[0] === 0) return [];
  let zeroRoots = 0;
  while (poly.length > 1 && poly[poly.length - 1] === 0) {
    poly = poly.slice(0, -1);
    zeroRoots++;
  }
  const d = poly.length - 1;
  const z: Complex[] = [];
  if (d > 0) {
    const a0 = poly[0];
    poly = poly.map((v) => v / a0);
    let radius = 0;
    for (let k = 1; k <= d; k++) radius = Math.max(radius, Math.pow(Math.abs(poly[k]), 1 / k));
    radius = Math.max(radius, 1e-6);
    for (let i = 0; i < d; i++) {
      const ang = (2 * Math.PI * i) / d + 0.4;
      z.push(C(radius * Math.cos(ang), radius * Math.sin(ang)));
    }
    for (let it = 0; it < 800; it++) {
      let maxStep = 0;
      for (let i = 0; i < d; i++) {
        let pv = C(1),
          dp = C(0);
        for (let k = 1; k <= d; k++) {
          dp = cAdd(cMul(dp, z[i]), pv);
          pv = cAdd(cMul(pv, z[i]), C(poly[k]));
        }
        if (cAbs(pv) === 0) continue;
        const ratio = cDiv(pv, dp);
        let sum = C(0);
        for (let j = 0; j < d; j++) if (j !== i) sum = cAdd(sum, cDiv(C(1), cSub(z[i], z[j])));
        const w = cDiv(ratio, cSub(C(1), cMul(ratio, sum)));
        z[i] = cSub(z[i], w);
        maxStep = Math.max(maxStep, cAbs(w) / Math.max(1, cAbs(z[i])));
      }
      if (maxStep < 1e-15) break;
    }
    for (const r of z) if (Math.abs(r.im) < 1e-9 * Math.max(1, cAbs(r))) r.im = 0;
  }
  for (let i = 0; i < zeroRoots; i++) z.push(C(0));
  // Conjugate pairs share a real part up to rounding; order them by imaginary part instead.
  z.sort((a, b) => (Math.abs(a.re - b.re) > 1e-9 * Math.max(1, cAbs(a)) ? b.re - a.re : b.im - a.im));
  return z;
}

export function eig(A: number[], n: number): Complex[] {
  return roots(charpoly(A, n));
}

// ---------------------------------------------------------------------------
// Closed loop
// ---------------------------------------------------------------------------

export function closedLoopA(p: Plant, k: Ctrl): { A: number[]; n: number } {
  const n = p.n;
  if (k.type === CTRL_SF) {
    const A = p.A.slice();
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i * n + j] -= p.B[i] * (k.K[j] ?? 0);
    return { A, n };
  }
  if (k.type !== CTRL_PID) return { A: p.A.slice(), n };
  const useI = k.ki !== 0;
  const useD = k.kd !== 0;
  const m = n + (useI ? 1 : 0) + (useD ? 1 : 0);
  const iI = n,
    iD = n + (useI ? 1 : 0);
  const G = k.kp + (useD ? k.kd * k.N : 0);
  const A = new Array(m * m).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i * m + j] = p.A[i * n + j] - p.B[i] * G * p.C[j];
    if (useI) A[i * m + iI] = p.B[i] * k.ki;
    if (useD) A[i * m + iD] = -p.B[i] * k.kd * k.N * k.N;
  }
  if (useI) for (let j = 0; j < n; j++) A[iI * m + j] = -p.C[j];
  if (useD) {
    for (let j = 0; j < n; j++) A[iD * m + j] = -p.C[j];
    A[iD * m + iD] = -k.N;
  }
  return { A, n: m };
}

export function closedLoopPoles(p: Plant, k: Ctrl): Complex[] {
  const { A, n } = closedLoopA(p, k);
  return eig(A, n);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

class Rng {
  s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  uniform() {
    let s = this.s;
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    this.s = s;
    return (s + 0.5) / 4294967296;
  }
  gauss() {
    const u1 = this.uniform(),
      u2 = this.uniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function computeMetrics(
  y: ArrayLike<number>,
  u: ArrayLike<number>,
  r: ArrayLike<number>,
  dt: number,
  windowEnd: number,
  satFrac: number,
): Metrics {
  const m: Metrics = {
    riseTime: -1,
    settlingTime: -1,
    overshootPct: 0,
    peak: 0,
    peakTime: 0,
    finalValue: 0,
    ssError: 0,
    iae: 0,
    ise: 0,
    maxAbsU: 0,
    stable: 1,
    saturatedFrac: satFrac,
  };
  const len = y.length;
  if (!len) return m;
  const kEnd = Math.max(0, Math.min(len - 1, Math.floor(windowEnd / dt + 1e-9)));
  const ref = r[0];
  const tail = Math.max(1, Math.floor((kEnd + 1) / 20));
  let fin = 0;
  for (let k = kEnd - tail + 1; k <= kEnd; k++) fin += y[k];
  fin /= tail;
  m.finalValue = fin;
  m.ssError = ref - fin;
  let kPeak = 0;
  for (let k = 0; k <= kEnd; k++) if (fin >= 0 ? y[k] > y[kPeak] : y[k] < y[kPeak]) kPeak = k;
  m.peak = y[kPeak];
  m.peakTime = kPeak * dt;
  m.overshootPct = Math.abs(fin) > 1e-12 ? Math.max(0, ((m.peak - fin) / fin) * 100) : 0;
  if (Math.abs(fin) > 1e-12) {
    let k10 = -1,
      k90 = -1;
    for (let k = 0; k <= kEnd; k++) {
      const f = y[k] / fin;
      if (k10 < 0 && f >= 0.1) k10 = k;
      if (k90 < 0 && f >= 0.9) {
        k90 = k;
        break;
      }
    }
    if (k10 >= 0 && k90 >= 0) m.riseTime = (k90 - k10) * dt;
    const band = 0.02 * Math.abs(fin);
    let kLast = -1;
    for (let k = kEnd; k >= 0; k--)
      if (Math.abs(y[k] - fin) > band) {
        kLast = k;
        break;
      }
    m.settlingTime = kLast < 0 ? 0 : kLast < kEnd - tail ? (kLast + 1) * dt : -1;
  }
  for (let k = 0; k < len; k++) {
    const e = r[k] - y[k];
    m.iae += Math.abs(e) * dt;
    m.ise += e * e * dt;
    m.maxAbsU = Math.max(m.maxAbsU, Math.abs(u[k]));
  }
  return m;
}

export function simulate(p: Plant, k: Ctrl, cfg: SimCfg): SimOut {
  const n = p.n;
  const dt = cfg.dt;
  const steps = Math.floor(cfg.tEnd / dt + 1e-9) + 1;
  const y = new Float64Array(steps),
    u = new Float64Array(steps),
    rr = new Float64Array(steps);
  const x = new Float64Array(n),
    k1 = new Float64Array(n),
    k2 = new Float64Array(n),
    k3 = new Float64Array(n),
    k4 = new Float64Array(n),
    tmp = new Float64Array(n);
  const nd = Math.max(0, Math.round(p.delay / dt));
  const delayBuf = new Float64Array(nd + 1);
  let head = 0;
  const rng = new Rng(cfg.seed);
  const useI = k.ki !== 0,
    useD = k.kd !== 0;
  let xi = 0,
    xf = 0,
    uPlantPrev = 0,
    diverged = false,
    satCount = 0;

  const deriv = (xs: Float64Array, uu: number, out: Float64Array) => {
    for (let i = 0; i < n; i++) {
      let acc = p.B[i] * uu;
      for (let j = 0; j < n; j++) acc += p.A[i * n + j] * xs[j];
      out[i] = acc;
    }
  };

  for (let s = 0; s < steps; s++) {
    const t = s * dt;
    const r = cfg.ref;
    let yTrue = p.D * uPlantPrev;
    for (let j = 0; j < n; j++) yTrue += p.C[j] * x[j];
    const ym = yTrue + (cfg.noiseStd > 0 ? cfg.noiseStd * rng.gauss() : 0);
    if (s === 0 && useD) xf = -ym / k.N;

    let uUn = 0;
    if (k.type === CTRL_PID) {
      const e = r - ym;
      const dTerm = useD ? k.kd * k.N * (-ym - k.N * xf) : 0;
      uUn = k.kp * e + k.ki * xi + dTerm;
      const pushHigh = uUn > cfg.uMax && k.ki * e > 0;
      const pushLow = uUn < cfg.uMin && k.ki * e < 0;
      if (useI && !pushHigh && !pushLow) xi += e * dt;
      if (useD) xf = (xf + dt * -ym) / (1 + k.N * dt);
    } else if (k.type === CTRL_SF) {
      uUn = k.Nbar * r;
      for (let j = 0; j < n && j < k.K.length; j++) uUn -= k.K[j] * x[j];
    } else {
      uUn = r;
    }
    const uu = clamp(uUn, cfg.uMin, cfg.uMax);
    if (uu !== uUn) satCount++;
    y[s] = yTrue;
    u[s] = uu;
    rr[s] = r;

    delayBuf[head] = uu;
    const uDel = delayBuf[(head + 1) % (nd + 1)];
    head = (head + 1) % (nd + 1);
    const dist = cfg.distTime >= 0 && t >= cfg.distTime ? cfg.distMag : 0;
    const uPlant = (nd === 0 ? uu : uDel) + dist;

    if (!diverged) {
      deriv(x, uPlant, k1);
      for (let i = 0; i < n; i++) tmp[i] = x[i] + 0.5 * dt * k1[i];
      deriv(tmp, uPlant, k2);
      for (let i = 0; i < n; i++) tmp[i] = x[i] + 0.5 * dt * k2[i];
      deriv(tmp, uPlant, k3);
      for (let i = 0; i < n; i++) tmp[i] = x[i] + dt * k3[i];
      deriv(tmp, uPlant, k4);
      for (let i = 0; i < n; i++) {
        x[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
        if (!Number.isFinite(x[i]) || Math.abs(x[i]) > 1e8) diverged = true;
      }
      if (diverged) for (let i = 0; i < n; i++) x[i] = Number.isFinite(x[i]) ? clamp(x[i], -1e8, 1e8) : 0;
    }
    uPlantPrev = uPlant;
  }

  const windowEnd = cfg.distTime > 0 && cfg.distTime < cfg.tEnd ? cfg.distTime : cfg.tEnd;
  const metrics = computeMetrics(y, u, rr, dt, windowEnd, satCount / steps);
  let stable = !diverged;
  if (stable && nd === 0) {
    for (const pole of closedLoopPoles(p, k)) if (pole.re >= -1e-9) stable = false;
  } else if (stable) {
    const q = Math.floor(steps / 4);
    let a = 0,
      b = 0;
    for (let s = steps - 2 * q; s < steps - q; s++) a = Math.max(a, Math.abs(y[s] - metrics.finalValue));
    for (let s = steps - q; s < steps; s++) b = Math.max(b, Math.abs(y[s] - metrics.finalValue));
    if (b > 1.05 * a && b > 0.01 * Math.max(1, Math.abs(cfg.ref))) stable = false;
  }
  metrics.stable = stable ? 1 : 0;
  return { dt, y, u, r: rr, metrics };
}

// ---------------------------------------------------------------------------
// Frequency response
// ---------------------------------------------------------------------------

export function bode(p: Plant, k: Ctrl, nw = 400, wMin = 1e-2, wMax = 1e3): BodeOut {
  const w: number[] = [],
    mag: number[] = [],
    phase: number[] = [];
  let prev = 0;
  for (let i = 0; i < nw; i++) {
    const wi = wMin * Math.pow(wMax / wMin, i / (nw - 1));
    w.push(wi);
    const s = C(0, wi);
    const xs = solveShifted(p.A, p.n, s, p.B);
    let L = C(1e12);
    if (xs) {
      if (k.type === CTRL_SF) {
        L = C(0);
        for (let j = 0; j < p.n && j < k.K.length; j++) L = cAdd(L, cMul(C(k.K[j]), xs[j]));
      } else {
        let P = C(p.D);
        for (let j = 0; j < p.n; j++) P = cAdd(P, cMul(C(p.C[j]), xs[j]));
        if (k.type === CTRL_PID) {
          let Cs = cAdd(C(k.kp), cDiv(C(k.ki), s));
          if (k.kd !== 0) Cs = cAdd(Cs, cDiv(cMul(C(k.kd * k.N), s), cAdd(s, C(k.N))));
          L = cMul(Cs, P);
        } else L = P;
      }
    }
    mag.push(20 * Math.log10(Math.max(cAbs(L), 1e-300)));
    let ph = (Math.atan2(L.im, L.re) * 180) / Math.PI;
    if (i > 0) {
      while (ph - prev > 180) ph -= 360;
      while (ph - prev < -180) ph += 360;
    }
    prev = ph;
    phase.push(ph);
  }
  for (let i = 0; i < nw; i++) phase[i] -= (w[i] * p.delay * 180) / Math.PI;

  let gmDb = 1e9,
    pmDeg = 1e9,
    wcg = -1,
    wcp = -1;
  for (let i = 0; i + 1 < nw; i++) {
    if (mag[i] >= 0 && mag[i + 1] < 0) {
      const f = mag[i] / (mag[i] - mag[i + 1]);
      wcp = Math.exp(Math.log(w[i]) + f * (Math.log(w[i + 1]) - Math.log(w[i])));
      let pm = 180 + phase[i] + f * (phase[i + 1] - phase[i]);
      while (pm > 180) pm -= 360;
      while (pm <= -180) pm += 360;
      pmDeg = pm;
      break;
    }
  }
  for (let i = 0; i + 1 < nw; i++) {
    const a = phase[i] + 180,
      b = phase[i + 1] + 180;
    if ((a > 0 && b <= 0) || (a < 0 && b >= 0)) {
      const f = a / (a - b);
      wcg = Math.exp(Math.log(w[i]) + f * (Math.log(w[i + 1]) - Math.log(w[i])));
      gmDb = -(mag[i] + f * (mag[i + 1] - mag[i]));
      break;
    }
  }
  return { w, mag, phase, gmDb, pmDeg, wcg, wcp };
}

// ---------------------------------------------------------------------------
// LQR
// ---------------------------------------------------------------------------

export function lqr(p: Plant, Qdiag: number[], R: number): { ok: boolean; K: number[]; Nbar: number } {
  const n = p.n;
  const fail = { ok: false, K: new Array(n).fill(0), Nbar: 1 };
  if (n === 0 || R <= 0) return fail;
  let normA = 0;
  for (let i = 0; i < n; i++) {
    let row = 0;
    for (let j = 0; j < n; j++) row += Math.abs(p.A[i * n + j]);
    normA = Math.max(normA, row);
  }
  const h = Math.min(1e-3, 1e-2 / Math.max(1, normA));
  const Ad = eye(n).map((v, i) => v + p.A[i] * h);
  let G = new Array(n * n).fill(0);
  let H = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) G[i * n + j] = (p.B[i] * h * p.B[j] * h) / (R * h);
    H[i * n + i] = (Qdiag[i] ?? 1) * h;
  }
  let A = Ad.slice();
  const I = eye(n);
  let converged = false;
  for (let it = 0; it < 200; it++) {
    const W = matmul(G, H, n).map((v, i) => v + I[i]);
    const Winv = inverse(W, n);
    if (!Winv) return fail;
    const AWinv = matmul(A, Winv, n);
    const At = transpose(A, n);
    const A1 = matmul(AWinv, A, n);
    const G1 = matmul(matmul(AWinv, G, n), At, n).map((v, i) => v + G[i]);
    const H1 = matmul(matmul(At, H, n), matmul(Winv, A, n), n).map((v, i) => v + H[i]);
    let diff = 0,
      norm = 0;
    for (let i = 0; i < H.length; i++) {
      diff = Math.max(diff, Math.abs(H1[i] - H[i]));
      norm = Math.max(norm, Math.abs(H1[i]));
    }
    A = A1;
    G = G1;
    H = H1;
    if (H.some((v) => !Number.isFinite(v))) return fail;
    if (diff <= 1e-13 * Math.max(1, norm)) {
      converged = true;
      break;
    }
  }
  if (!converged) return fail;
  const PB = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) PB[i] += H[i * n + j] * p.B[j] * h;
  let denom = R * h;
  for (let i = 0; i < n; i++) denom += p.B[i] * h * PB[i];
  const K = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += PB[i] * Ad[i * n + j];
    K[j] = acc / denom;
    if (!Number.isFinite(K[j])) return fail;
  }
  return { ok: true, K, Nbar: computeNbar(p, K) };
}

export function computeNbar(p: Plant, K: number[]): number {
  const { A } = closedLoopA(p, { ...DEFAULT_CTRL, type: CTRL_SF, K });
  const inv = inverse(A, p.n);
  if (!inv) return 1;
  let dc = p.D;
  for (let i = 0; i < p.n; i++) for (let j = 0; j < p.n; j++) dc -= p.C[i] * inv[i * p.n + j] * p.B[j];
  return Math.abs(dc) < 1e-12 ? 1 : 1 / dc;
}

// ---------------------------------------------------------------------------
// System identification
// ---------------------------------------------------------------------------

export function stepFOPDT(K: number, tau: number, theta: number, t: number): number {
  if (t <= theta) return 0;
  return K * (1 - Math.exp(-(t - theta) / tau));
}

export function stepSOPDT(K: number, wn: number, zeta: number, theta: number, t: number): number {
  if (t <= theta) return 0;
  const tt = t - theta;
  if (zeta < 1 - 1e-6) {
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    return K * (1 - Math.exp(-zeta * wn * tt) * (Math.cos(wd * tt) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * tt)));
  }
  if (zeta <= 1 + 1e-6) return K * (1 - (1 + wn * tt) * Math.exp(-wn * tt));
  const sq = Math.sqrt(zeta * zeta - 1);
  const p1 = wn * (zeta - sq),
    p2 = wn * (zeta + sq);
  return K * (1 - (p2 * Math.exp(-p1 * tt) - p1 * Math.exp(-p2 * tt)) / (p2 - p1));
}

export function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iters: number): number[] {
  const n = x0.length;
  let s: number[][] = [];
  for (let i = 0; i <= n; i++) s.push(x0.slice());
  for (let i = 0; i < n; i++) s[i + 1][i] += step[i];
  let fv = s.map(f);
  for (let it = 0; it < iters; it++) {
    const idx = fv.map((_, i) => i).sort((a, b) => fv[a] - fv[b]);
    s = idx.map((i) => s[i]);
    fv = idx.map((i) => fv[i]);
    if (Math.abs(fv[n] - fv[0]) <= 1e-14 * (Math.abs(fv[0]) + 1e-20)) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += s[i][j] / n;
    const along = (a: number) => c.map((cj, j) => cj + a * (s[n][j] - cj));
    const xr = along(-1);
    const fr = f(xr);
    if (fr < fv[0]) {
      const xe = along(-2);
      const fe = f(xe);
      if (fe < fr) {
        s[n] = xe;
        fv[n] = fe;
      } else {
        s[n] = xr;
        fv[n] = fr;
      }
    } else if (fr < fv[n - 1]) {
      s[n] = xr;
      fv[n] = fr;
    } else {
      const xc = along(fr < fv[n] ? -0.5 : 0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, fv[n])) {
        s[n] = xc;
        fv[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          s[i] = s[i].map((v, j) => s[0][j] + 0.5 * (v - s[0][j]));
          fv[i] = f(s[i]);
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i <= n; i++) if (fv[i] < fv[best]) best = i;
  return s[best];
}

export function fitStep(t: number[], y: number[], uStep: number, kind: 1 | 2): FitOut {
  const fit: FitOut = { kind, K: 0, tau: 0, wn: 0, zeta: 0, theta: 0, sse: 0, r2: 0 };
  const N = Math.min(t.length, y.length);
  if (N < 5 || uStep === 0) return fit;
  const tail = Math.max(1, Math.floor(N / 10));
  let yf = 0;
  for (let i = N - tail; i < N; i++) yf += y[i];
  yf /= tail;
  const K0 = yf / uStep;
  let t63 = t[N - 1] / 3,
    t05 = 0,
    ypk = yf,
    got05 = false,
    got63 = false;
  for (let i = 0; i < N; i++) {
    const f = yf !== 0 ? y[i] / yf : 0;
    if (!got05 && f >= 0.05) {
      t05 = t[i];
      got05 = true;
    }
    if (!got63 && f >= 0.632) {
      t63 = t[i];
      got63 = true;
    }
    if (yf >= 0 ? y[i] > ypk : y[i] < ypk) ypk = y[i];
  }
  const theta0 = Math.max(0, t05 * 0.5);
  const tau0 = Math.max(1e-3, t63 - theta0);
  const sse = (Kk: number, a: number, b: number, theta: number) => {
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const model = (kind === 1 ? stepFOPDT(Kk, a, theta, t[i]) : stepSOPDT(Kk, a, b, theta, t[i])) * uStep;
      const e = y[i] - model;
      acc += e * e;
    }
    return acc;
  };
  if (kind === 1) {
    const f = (v: number[]) => sse(v[0], Math.exp(v[1]), 0, v[2] * v[2]);
    let best = nelderMead(f, [K0, Math.log(tau0), Math.sqrt(theta0)], [0.1 * Math.abs(K0) + 1e-3, 0.5, 0.2 + 0.1 * Math.sqrt(theta0)], 3000);
    best = nelderMead(f, best, [0.05 * Math.abs(best[0]) + 1e-4, 0.2, 0.1], 3000);
    fit.K = best[0];
    fit.tau = Math.exp(best[1]);
    fit.theta = best[2] * best[2];
    fit.sse = f(best);
  } else {
    const mp = yf !== 0 ? (ypk - yf) / yf : 0;
    let z0 = 0.9;
    if (mp > 0.005) {
      const l = Math.log(mp);
      z0 = -l / Math.sqrt(Math.PI * Math.PI + l * l);
    }
    const wn0 = 1.8 / Math.max(1e-3, t63 - theta0);
    const f = (v: number[]) => sse(v[0], Math.exp(v[1]), Math.exp(v[2]), v[3] * v[3]);
    let best = nelderMead(
      f,
      [K0, Math.log(wn0), Math.log(z0), Math.sqrt(theta0)],
      [0.1 * Math.abs(K0) + 1e-3, 0.4, 0.4, 0.2 + 0.1 * Math.sqrt(theta0)],
      4000,
    );
    best = nelderMead(f, best, [0.05 * Math.abs(best[0]) + 1e-4, 0.15, 0.15, 0.1], 4000);
    fit.K = best[0];
    fit.wn = Math.exp(best[1]);
    fit.zeta = Math.exp(best[2]);
    fit.theta = best[3] * best[3];
    fit.sse = f(best);
  }
  const mean = y.slice(0, N).reduce((a, b) => a + b, 0) / N;
  let sst = 0;
  for (let i = 0; i < N; i++) sst += (y[i] - mean) ** 2;
  fit.r2 = sst > 0 ? 1 - fit.sse / sst : 0;
  return fit;
}

export function fitBest(t: number[], y: number[], uStep: number): FitOut {
  const a = fitStep(t, y, uStep, 1);
  const b = fitStep(t, y, uStep, 2);
  const n = Math.min(t.length, y.length);
  const aicA = n * Math.log(Math.max(a.sse, 1e-300) / n) + 6;
  const aicB = n * Math.log(Math.max(b.sse, 1e-300) / n) + 8;
  return aicB + 2 < aicA ? b : a;
}
