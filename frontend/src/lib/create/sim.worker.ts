// Runs the task simulation off the main thread, so the workspace stays responsive while it computes.
import type { Design } from "./design";
import { simulate, type Recording } from "./sim";

self.onmessage = async (e: MessageEvent<{ id: number; design: Design }>) => {
  const { id, design } = e.data;
  try {
    const rec = await simulate(design, (p) => self.postMessage({ id, progress: p }));
    const transfer: ArrayBuffer[] = [rec.q.buffer, rec.base.buffer, rec.rigidPose.buffer, rec.sceneQ.buffer, ...rec.cloth.map((c) => c.pos.buffer)] as ArrayBuffer[];
    (self as unknown as Worker).postMessage({ id, recording: rec satisfies Recording }, transfer);
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
