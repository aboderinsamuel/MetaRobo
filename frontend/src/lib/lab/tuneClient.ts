"use client";

import { autoTune } from "./advisor";
import { tsEngine } from "@/lib/sim/engine";
import type { ControllerSpec, LabModel } from "./types";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: { tuned?: ControllerSpec; error?: string }) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./tune.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; tuned?: ControllerSpec; error?: string }>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
    return worker;
  } catch {
    return null;
  }
}

/** Auto-tunes in a Web Worker; falls back to the main thread if workers are unavailable. */
export function tuneAsync(model: LabModel, spec: ControllerSpec): Promise<ControllerSpec> {
  const w = getWorker();
  if (!w) return new Promise((r) => setTimeout(() => r(autoTune(tsEngine, model, spec)), 30));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, (r) => (r.tuned ? resolve(r.tuned) : reject(new Error(r.error ?? "tuning failed"))));
    w.postMessage({ id, model, spec });
  });
}
