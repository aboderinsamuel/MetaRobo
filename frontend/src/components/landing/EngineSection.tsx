"use client";

import { Play, RotateCcw } from "lucide-react";
import { motion, useInView } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SELF_TESTS, benchmark } from "@/lib/sim/selftest";
import { useEngine } from "@/lib/sim/useEngine";
import DotField from "./DotField";
import { VerdictIcon } from "./LoopStory";

const SPEC_ROWS: [string, string[]][] = [
  ["Integrator", ["4th-order Runge-Kutta", "Fixed step, zero-order hold"]],
  ["Plants", ["Transfer function → state space", "Up to 8 states, dead time"]],
  ["Controllers", ["PID · filtered D · anti-windup", "LQR state feedback"]],
  ["Analysis", ["Closed-loop poles (Aberth)", "Bode, gain & phase margins"]],
  ["Identification", ["FOPDT / second-order fit", "Nelder-Mead on step data"]],
  ["Realism", ["Actuator saturation", "Sensor noise · load steps"]],
];

type Row = { name: string; expected: string; got?: string; pass?: boolean; ms?: number };

export default function EngineSection() {
  const engine = useEngine();
  const [bench, setBench] = useState<{ steps: number; ms: number } | null>(null);
  const [rows, setRows] = useState<Row[]>(SELF_TESTS.map((t) => ({ name: t.name, expected: t.expected })));
  const [running, setRunning] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const inView = useInView(box, { once: true, margin: "-20% 0px" });

  const runSuite = useCallback(async () => {
    setRunning(true);
    setRows(SELF_TESTS.map((t) => ({ name: t.name, expected: t.expected })));
    for (let i = 0; i < SELF_TESTS.length; i++) {
      await new Promise((r) => setTimeout(r, 180));
      const r = SELF_TESTS[i].run(engine);
      setRows((prev) => prev.map((row, j) => (j === i ? { ...row, ...r } : row)));
    }
    setBench(benchmark(engine));
    setRunning(false);
  }, [engine]);

  useEffect(() => {
    if (!inView) return;
    const id = setTimeout(() => void runSuite(), 0);
    return () => clearTimeout(id);
  }, [inView, runSuite]);

  const passed = rows.filter((r) => r.pass).length;

  return (
    <>
      <section id="engine" className="relative overflow-hidden border-b border-line">
        <DotField className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] w-full opacity-60" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-void via-void/70 to-void/20" />
        <div className="relative mx-auto max-w-[1440px] px-4 pt-28 pb-40 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
            <div>
              <p className="mono-label text-mute">·· The engine</p>
              <h2 className="mt-3 text-[clamp(2rem,4.4vw,3.8rem)] leading-[1] font-medium tracking-[-0.03em]">
                Real physics,
                <br />
                compiled to <span className="font-pixel text-[0.85em]">WASM</span>.
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-mute">
                PlantSim is a dependency-free C++17 engine. The same source compiles natively for the test suite and to WebAssembly for the
                browser, so what you tune is what was tested.
              </p>
              <div className="rounded-2xl mt-8 inline-flex items-center gap-4 border border-line bg-panel/70 px-4 py-3 backdrop-blur">
                <span className={`mono-label rounded-full px-1.5 py-0.5 ${engine.backend === "wasm" ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>
                  {engine.backend === "wasm" ? "C++ / WASM" : "TS fallback"}
                </span>
                <span className="font-mono text-sm tabular-nums">
                  {bench ? (
                    <>
                      {bench.steps.toLocaleString()} RK4 steps in <span className="text-spectrum">{bench.ms.toFixed(1)} ms</span>
                    </>
                  ) : (
                    "benchmarking…"
                  )}
                </span>
              </div>
            </div>
            {/* Credits-style spec grid */}
            <dl className="grid grid-cols-1 border-t border-l border-line sm:grid-cols-2">
              {SPEC_ROWS.map(([k, vs], i) => (
                <motion.div
                  key={k}
                  className="border-r border-b border-line bg-void/60 p-5 backdrop-blur-sm sm:p-6"
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                >
                  <dt className="mono-label text-dim">{k}</dt>
                  <dd className="mt-4 space-y-1 font-mono text-[13px] tracking-wide uppercase">
                    {vs.map((v) => (
                      <p key={v}>{v}</p>
                    ))}
                  </dd>
                </motion.div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section id="validation" className="relative border-b border-line">
        <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-28 sm:px-6 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <p className="mono-label text-mute">·· Validation</p>
            <h2 className="mt-3 text-[clamp(2rem,4.4vw,3.8rem)] leading-[1] font-medium tracking-[-0.03em]">
              Checked against
              <br />
              the textbook. <span className="text-mute">Live.</span>
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-mute">
              These tests run right now, in your browser, on the engine you&apos;ll use. The same checks run natively against the C++ build,
              and a golden-data test proves the browser and native engines agree to 1e-9.
            </p>
            <div className="mt-8 flex items-center gap-3">
              <button
                onClick={() => void runSuite()}
                disabled={running}
                className="spectrum-border inline-flex h-9 items-center gap-2 rounded-xl bg-void px-4 font-mono text-[11px] tracking-[0.08em] uppercase transition-colors hover:bg-panel-2 disabled:opacity-50"
              >
                {running ? <RotateCcw className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Run again
              </button>
              <span className="mono-label text-mute">
                {passed}/{rows.length} passed
              </span>
            </div>
          </div>
          <div ref={box} className="rounded-2xl border border-line bg-panel">
            <div className="grid grid-cols-[1fr_auto] border-b border-line px-4 py-2.5 sm:grid-cols-[1.1fr_1fr_1fr_auto]">
              <span className="mono-label text-dim">Test</span>
              <span className="mono-label hidden text-dim sm:block">Expected</span>
              <span className="mono-label hidden text-dim sm:block">Engine</span>
              <span className="mono-label text-dim">ms</span>
            </div>
            <ul>
              {rows.map((r) => (
                <li key={r.name} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line px-4 py-3 last:border-0 sm:grid-cols-[1.1fr_1fr_1fr_auto]">
                  <span className="flex items-center gap-2.5 text-sm">
                    {r.pass === undefined ? (
                      <span className="size-5 shrink-0 rounded-full border border-line-2 border-t-fg" style={{ animation: running ? "rc-spin 0.8s linear infinite" : undefined }} />
                    ) : (
                      <VerdictIcon verdict={r.pass ? "pass" : "fail"} />
                    )}
                    {r.name}
                  </span>
                  <span className="hidden font-mono text-xs text-mute sm:block">{r.expected}</span>
                  <span className="hidden font-mono text-xs sm:block">{r.got ?? "—"}</span>
                  <span className="font-mono text-xs text-dim tabular-nums">{r.ms !== undefined ? r.ms.toFixed(1) : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
