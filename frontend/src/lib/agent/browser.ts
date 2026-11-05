"use client";

// The agent in the browser: Muse Wonder turns go through /api/agent (the key stays on the server);
// the tools run here, on the same simulation worker the workspace uses.
import type { Design } from "@/lib/create/design";
import type { Recording } from "@/lib/create/sim";
import type { CallModel, ModelTurn } from "./loop";

export const callAgentModel: CallModel = async (messages) => {
  const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages }) });
  const out = (await res.json().catch(() => ({}))) as ModelTurn & { error?: string };
  if (!res.ok || !out.message) throw new Error(out.error ?? `Agent call failed (HTTP ${res.status})`);
  return out;
};

/** A dedicated simulation worker for the agent, so it doesn't fight the viewport's runs. */
export function workerSimulator() {
  const worker = new Worker(new URL("../create/sim.worker.ts", import.meta.url), { type: "module" });
  let seq = 0;
  const simulate = (design: Design) =>
    new Promise<Recording>((resolve, reject) => {
      const id = ++seq;
      const on = (e: MessageEvent<{ id: number; recording?: Recording; error?: string }>) => {
        if (e.data.id !== id) return;
        if (e.data.recording) {
          worker.removeEventListener("message", on);
          resolve(e.data.recording);
        } else if (e.data.error) {
          worker.removeEventListener("message", on);
          reject(new Error(e.data.error));
        }
      };
      worker.addEventListener("message", on);
      worker.postMessage({ id, design });
    });
  return { simulate, dispose: () => worker.terminate() };
}
