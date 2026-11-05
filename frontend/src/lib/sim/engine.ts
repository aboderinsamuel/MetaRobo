// One engine API for the whole app. In the browser it loads the C++ engine compiled to
// WebAssembly (public/engine/plantsim.wasm, built by engine/build-wasm.sh). If that file is
// missing or fails to load, it uses the TypeScript port in core.ts, which gives the same
// numbers (checked by tests/engine.test.ts).
import * as core from "./core";
import type { BodeOut, Complex, Ctrl, FitOut, Plant, SimCfg, SimOut } from "./core";
import { METRIC_KEYS } from "./core";

export type Backend = "wasm" | "ts";

export interface Engine {
  backend: Backend;
  simulate(p: Plant, k: Ctrl, cfg: SimCfg): SimOut;
  poles(p: Plant, k: Ctrl): Complex[];
  bode(p: Plant, k: Ctrl, nw?: number, wMin?: number, wMax?: number): BodeOut;
  lqr(p: Plant, Q: number[], R: number): { ok: boolean; K: number[]; Nbar: number };
  fit(t: number[], y: number[], uStep: number, kind?: 0 | 1 | 2): FitOut;
}

export const tsEngine: Engine = {
  backend: "ts",
  simulate: core.simulate,
  poles: core.closedLoopPoles,
  bode: core.bode,
  lqr: core.lqr,
  fit: (t, y, u, kind = 0) => (kind === 0 ? core.fitBest(t, y, u) : core.fitStep(t, y, u, kind)),
};

type WasmExports = {
  memory: WebAssembly.Memory;
  rc_alloc(n: number): number;
  rc_free(p: number): void;
  rc_version(): number;
  rc_simulate(i: number, l: number, o: number, c: number): number;
  rc_poles(i: number, l: number, o: number, c: number): number;
  rc_bode(i: number, l: number, o: number, c: number): number;
  rc_lqr(i: number, l: number, o: number, c: number): number;
  rc_fit(i: number, l: number, o: number, c: number): number;
  _initialize?: () => void;
};

export function packProblem(p: Plant, k: Ctrl): number[] {
  const v = [p.n, ...p.A, ...p.B, ...p.C, p.D, p.delay, k.type, k.kp, k.ki, k.kd, k.N, k.Nbar];
  for (let i = 0; i < p.n; i++) v.push(k.K[i] ?? 0);
  return v;
}

function makeWasmEngine(ex: WasmExports): Engine {
  // Calls into the module with a packed input, growing the output buffer if asked to.
  const call = (fn: (i: number, l: number, o: number, c: number) => number, input: number[], cap: number) => {
    const inPtr = ex.rc_alloc(input.length);
    new Float64Array(ex.memory.buffer, inPtr, input.length).set(input);
    let outPtr = ex.rc_alloc(cap);
    let len = fn(inPtr, input.length, outPtr, cap);
    if (len < 0) {
      ex.rc_free(outPtr);
      cap = -len;
      outPtr = ex.rc_alloc(cap);
      len = fn(inPtr, input.length, outPtr, cap);
    }
    // Copy out before freeing: the view is invalidated if memory grows later.
    const out = len > 0 ? new Float64Array(ex.memory.buffer, outPtr, len).slice() : new Float64Array(0);
    ex.rc_free(inPtr);
    ex.rc_free(outPtr);
    return out;
  };

  return {
    backend: "wasm",
    simulate(p, k, cfg) {
      const input = [
        ...packProblem(p, k),
        cfg.tEnd,
        cfg.dt,
        cfg.ref,
        cfg.distTime,
        cfg.distMag,
        cfg.uMin,
        cfg.uMax,
        cfg.noiseStd,
        cfg.seed,
      ];
      const steps = Math.floor(cfg.tEnd / cfg.dt + 1e-9) + 1;
      const out = call(ex.rc_simulate, input, 13 + 3 * steps);
      if (!out.length) return core.simulate(p, k, cfg);
      const n = out[0];
      const metrics = Object.fromEntries(METRIC_KEYS.map((key, i) => [key, out[1 + i]])) as unknown as SimOut["metrics"];
      return {
        dt: cfg.dt,
        y: out.slice(13, 13 + n),
        u: out.slice(13 + n, 13 + 2 * n),
        r: out.slice(13 + 2 * n, 13 + 3 * n),
        metrics,
      };
    },
    poles(p, k) {
      const out = call(ex.rc_poles, packProblem(p, k), 64);
      const res: Complex[] = [];
      for (let i = 0; i < out[0]; i++) res.push({ re: out[1 + 2 * i], im: out[2 + 2 * i] });
      return res;
    },
    bode(p, k, nw = 400, wMin = 1e-2, wMax = 1e3) {
      const out = call(ex.rc_bode, [...packProblem(p, k), nw, wMin, wMax], 1 + 3 * nw + 4);
      if (!out.length) return core.bode(p, k, nw, wMin, wMax);
      const m = out[0];
      return {
        w: Array.from(out.slice(1, 1 + m)),
        mag: Array.from(out.slice(1 + m, 1 + 2 * m)),
        phase: Array.from(out.slice(1 + 2 * m, 1 + 3 * m)),
        gmDb: out[1 + 3 * m],
        pmDeg: out[2 + 3 * m],
        wcg: out[3 + 3 * m],
        wcp: out[4 + 3 * m],
      };
    },
    lqr(p, Q, R) {
      const out = call(ex.rc_lqr, [...packProblem(p, core.DEFAULT_CTRL), R, ...Q], 2 + p.n);
      return { ok: out[0] === 1, K: Array.from(out.slice(1, 1 + p.n)), Nbar: out[1 + p.n] };
    },
    fit(t, y, uStep, kind = 0) {
      const out = call(ex.rc_fit, [t.length, uStep, kind, ...t, ...y], 8);
      return {
        kind: out[0] as 1 | 2,
        K: out[1],
        tau: out[2],
        wn: out[3],
        zeta: out[4],
        theta: out[5],
        sse: out[6],
        r2: out[7],
      };
    },
  };
}

export async function instantiateWasm(bytes: BufferSource): Promise<Engine> {
  const mod = await WebAssembly.compile(bytes);
  // Standalone Emscripten output may import a few WASI functions it never really needs here.
  const imports: Record<string, Record<string, WebAssembly.ImportValue>> = {};
  for (const imp of WebAssembly.Module.imports(mod)) {
    imports[imp.module] ??= {};
    if (imp.kind === "function") imports[imp.module][imp.name] = () => 0;
  }
  const inst = await WebAssembly.instantiate(mod, imports);
  const ex = inst.exports as unknown as WasmExports;
  ex._initialize?.();
  return makeWasmEngine(ex);
}

let enginePromise: Promise<Engine> | null = null;

export function loadEngine(): Promise<Engine> {
  if (typeof window === "undefined") return Promise.resolve(tsEngine);
  enginePromise ??= (async () => {
    try {
      const res = await fetch("/engine/plantsim.wasm");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await instantiateWasm(await res.arrayBuffer());
    } catch (err) {
      console.info("[plantsim] WebAssembly engine unavailable, using the TypeScript port:", err);
      return tsEngine;
    }
  })();
  return enginePromise;
}
