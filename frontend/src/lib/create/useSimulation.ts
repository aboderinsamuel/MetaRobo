"use client";

// Simulates a design in a Web Worker whenever it changes; returns the recording and progress.
import { useEffect, useRef, useState } from "react";
import type { Design } from "./design";
import type { Recording } from "./sim";

export interface SimState {
  recording: Recording | null;
  progress: number;
  running: boolean;
  error: string | null;
}

export function useSimulation(design: Design | null, runKey: number): SimState {
  const [state, setState] = useState<SimState>({ recording: null, progress: 0, running: false, error: null });
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    worker.current = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    return () => worker.current?.terminate();
  }, []);

  useEffect(() => {
    const w = worker.current;
    if (!design || !w) return;
    const id = ++seq.current;
    const on = (e: MessageEvent<{ id: number; progress?: number; recording?: Recording; error?: string }>) => {
      if (e.data.id !== id) return;
      if (e.data.recording) setState({ recording: e.data.recording, progress: 1, running: false, error: null });
      else if (e.data.error) setState((s) => ({ ...s, running: false, error: e.data.error! }));
      else if (e.data.progress !== undefined) setState((s) => ({ ...s, progress: e.data.progress! }));
    };
    w.addEventListener("message", on);
    // Start: keep showing the previous recording until the new one is ready.
    setState((s) => ({ ...s, running: true, progress: 0, error: null }));
    w.postMessage({ id, design });
    return () => w.removeEventListener("message", on);
  }, [design, runKey]);

  return state;
}
