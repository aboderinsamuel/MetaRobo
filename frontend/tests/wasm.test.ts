// Loads the real WebAssembly build (public/engine/plantsim.wasm) and checks it against the
// TypeScript port on every preset. Skipped when the .wasm file hasn't been built.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run } from "@/lib/lab/analysis";
import { PRESETS } from "@/lib/lab/presets";
import { instantiateWasm, tsEngine } from "@/lib/sim/engine";
import { SELF_TESTS } from "@/lib/sim/selftest";

const wasmPath = new URL("../public/engine/plantsim.wasm", import.meta.url);
const built = existsSync(wasmPath);

describe.skipIf(!built)("WebAssembly engine", () => {
  const load = () => instantiateWasm(readFileSync(wasmPath));

  it("passes the analytic self-tests", async () => {
    const wasm = await load();
    expect(wasm.backend).toBe("wasm");
    for (const t of SELF_TESTS) expect(t.run(wasm).pass, t.name).toBe(true);
  });

  for (const preset of PRESETS) {
    it(`${preset.id}: matches the TypeScript engine`, async () => {
      const wasm = await load();
      const model = preset.build();
      const a = run(wasm, model, model.controller);
      const b = run(tsEngine, model, model.controller);
      const scale = Math.max(1, Math.abs(model.sim.ref));
      expect(a.sim.y.length).toBe(b.sim.y.length);
      let diff = 0;
      for (let i = 0; i < a.sim.y.length; i++) diff = Math.max(diff, Math.abs(a.sim.y[i] - b.sim.y[i]));
      expect(diff / scale).toBeLessThan(1e-9);
      expect(a.analysis.metrics.stable).toBe(b.analysis.metrics.stable);
      a.analysis.poles.forEach((p, i) => expect(p.re).toBeCloseTo(b.analysis.poles[i].re, 6));
      expect(Math.min(a.analysis.pmDeg, 1e9)).toBeCloseTo(Math.min(b.analysis.pmDeg, 1e9), 4);
    });
  }
});
