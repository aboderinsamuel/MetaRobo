// Runs auto-tuning off the main thread so the studio stays responsive.
import { autoTune } from "./advisor";
import { instantiateWasm, tsEngine } from "@/lib/sim/engine";
import type { Engine } from "@/lib/sim/engine";
import type { ControllerSpec, LabModel } from "./types";

let engine: Promise<Engine> | null = null;

function getEngine(): Promise<Engine> {
  engine ??= fetch("/engine/plantsim.wasm")
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(instantiateWasm)
    .catch(() => tsEngine);
  return engine;
}

self.onmessage = async (e: MessageEvent<{ id: number; model: LabModel; spec: ControllerSpec }>) => {
  const { id, model, spec } = e.data;
  try {
    const eng = await getEngine();
    const tuned = autoTune(eng, model, spec);
    self.postMessage({ id, tuned });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
