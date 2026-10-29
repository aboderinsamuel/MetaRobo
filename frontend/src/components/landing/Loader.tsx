"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import RoboMark from "@/components/brand/RoboMark";

const LINES = ["LOADING PLANTSIM ENGINE", "COMPILING C++ → WASM MODULE", "WARMING RK4 INTEGRATOR", "CALIBRATING CONTROLLERS"];

/** Boot screen shown once per browser session. */
export default function Loader() {
  const [show, setShow] = useState(true);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem("rc-booted") === "1";
      sessionStorage.setItem("rc-booted", "1");
    } catch {}
    let raf = 0;
    if (seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      raf = requestAnimationFrame(() => setShow(false));
      return () => cancelAnimationFrame(raf);
    }
    // Ends as soon as the hero film has its first frame (at least 0.6 s, at most 2.4 s), so the
    // boot screen never hides a film that is already there.
    const t0 = performance.now();
    let ready = false;
    const onReady = () => (ready = true);
    window.addEventListener("rc-hero-ready", onReady, { once: true });
    const tick = () => {
      const el = performance.now() - t0;
      const k = ready && el > 600 ? 1 : Math.min(0.92, el / 1800);
      setPct(Math.round(100 * (1 - Math.pow(1 - k, 3))));
      if (k < 1 && el < 2400) raf = requestAnimationFrame(tick);
      else {
        setPct(100);
        setTimeout(() => setShow(false), 150);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("rc-hero-ready", onReady);
    };
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-void"
          exit={{ opacity: 0, filter: "blur(8px)" }}
          transition={{ duration: 0.6, ease: [0.6, 0, 0.2, 1] }}
        >
          <div className="grid-lines pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative flex flex-col items-center gap-8">
            <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.6 }}>
              <RoboMark className="size-28" animate />
            </motion.div>
            <div className="w-64">
              <div className="mono-label mb-2 flex justify-between text-mute">
                <span>{LINES[Math.min(LINES.length - 1, Math.floor(pct / 26))]}</span>
                <span className="text-fg tabular-nums">{String(pct).padStart(3, "0")}%</span>
              </div>
              <div className="h-px w-full bg-line">
                <div className="h-px" style={{ width: `${pct}%`, background: "var(--spectrum)" }} />
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
