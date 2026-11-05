"use client";

import { useEffect, useState } from "react";
import { loadEngine, tsEngine } from "./engine";
import type { Engine } from "./engine";

/** The simulation engine: the TypeScript port at first, swapped for WebAssembly once it loads. */
export function useEngine(): Engine {
  const [engine, setEngine] = useState<Engine>(tsEngine);
  useEffect(() => {
    let live = true;
    void loadEngine().then((e) => live && setEngine(e));
    return () => {
      live = false;
    };
  }, []);
  return engine;
}
