"use client";

// Scroll-driven walkthrough of the product loop. Every number on screen comes from the real
// engine and the offline advisor, run in the browser on the robot-arm preset.
import { Check, FileSpreadsheet, Mic, Sparkles, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { offlineAdvice } from "@/lib/lab/advisor";
import { fmtNum, polyToString, run } from "@/lib/lab/analysis";
import { PRESETS, presetById } from "@/lib/lab/presets";
import type { ControllerSpec, LabModel } from "@/lib/lab/types";
import { validateDesign } from "@/lib/lab/validate";
import type { CheckResult } from "@/lib/lab/validate";
import type { Engine } from "@/lib/sim/engine";
import { useEngine } from "@/lib/sim/useEngine";
import MiniChart, { pathFrom } from "./MiniChart";

const STEPS = [
  { k: "Describe", t: "Type it, say it, or upload data", d: "Plain language, your voice, or a CSV from a step test. No equations needed." },
  { k: "Model", t: "Physics in, transfer function out", d: "Muse Spark derives the equations, picks realistic parameters, and states every assumption." },
  { k: "Control", t: "A controller with starting gains", d: "PID for most loops, LQR state feedback for unstable multi-state systems like balancing robots." },
  { k: "Simulate", t: "Watch the hardware move", d: "A C++ engine compiled to WebAssembly drives a live 3D rover, arm, balancing robot or drone, synced to the graphs: actuator limits, dead time, noise and disturbances included." },
  { k: "Explain", t: "Why it overshoots, in plain words", d: "Pole locations, damping and margins turned into a diagnosis and concrete fixes. Iterate until it behaves." },
  { k: "Validate", t: "Checks before hardware", d: "Margins, robustness to model error, noise, load disturbances, and engine cross-checks." },
];

// The arm preset's first guess, then the copilot's hardware-aware auto-tune (inside the 2 A driver rating).
const BEFORE: ControllerSpec = { type: "pid", kp: 10.15, ki: 0, kd: 0.1, N: 150 };
const AFTER: ControllerSpec = { type: "pid", kp: 6.16, ki: 0, kd: 0.816, N: 84 };

function useTyped(text: string, active: boolean, speed = 22) {
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t0 = performance.now();
    const id = setInterval(() => {
      setStart((s) => s ?? t0);
      setNow(performance.now());
    }, speed);
    return () => {
      clearInterval(id);
      setStart(null);
    };
  }, [text, active, speed]);
  const n = start === null ? 0 : Math.floor((now - start) / speed);
  return text.slice(0, Math.max(0, n));
}

const fade = {
  initial: { opacity: 0, y: 18, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -18, filter: "blur(6px)" },
  transition: { duration: 0.5, ease: [0.6, 0, 0.2, 1] as const },
};

export function VerdictIcon({ verdict }: { verdict: CheckResult["verdict"] }) {
  const cls = verdict === "pass" ? "bg-ok/15 text-ok" : verdict === "warn" ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad";
  const Icon = verdict === "pass" ? Check : verdict === "warn" ? TriangleAlert : X;
  return (
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 18 }}
      className={`flex size-5 shrink-0 items-center justify-center rounded-full ${cls}`}
    >
      <Icon className="size-3" />
    </motion.span>
  );
}

function LiveChecks({ engine, model, spec }: { engine: Engine; model: LabModel; spec: ControllerSpec }) {
  // Rows are tagged with the run that produced them; a new run replaces them on its first result.
  const [state, setState] = useState<{ run: object | null; rows: CheckResult[] }>({ run: null, rows: [] });
  const rows = state.rows;
  useEffect(() => {
    let live = true;
    const token = {};
    void (async () => {
      for await (const r of validateDesign(engine, model, spec)) {
        if (!live) return;
        setState((prev) => ({ run: token, rows: prev.run === token ? [...prev.rows, r] : [r] }));
      }
    })();
    return () => {
      live = false;
    };
  }, [engine, model, spec]);
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <motion.li key={r.id} className="flex items-center justify-between gap-4 py-2.5" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
          <span>
            <span className="block text-sm">{r.label}</span>
            <span className="block font-mono text-[11px] text-dim">{r.detail}</span>
          </span>
          <VerdictIcon verdict={r.verdict} />
        </motion.li>
      ))}
    </ul>
  );
}

function Panel({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="relative h-full w-full border border-line bg-panel/80 backdrop-blur">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="mono-label text-mute">{label}</span>
        <span className="flex gap-1">
          {["#2dd4ff", "#9b5cff", "#ff5ca8"].map((c) => (
            <span key={c} className="size-1.5 rounded-full" style={{ background: c }} />
          ))}
        </span>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </div>
  );
}

export default function LoopStory() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    setProgress(v);
    setStep(Math.min(STEPS.length - 1, Math.floor(v * STEPS.length)));
  });

  const engine = useEngine();
  const model = useMemo(() => presetById("arm")!.build(), []);
  const before = useMemo(() => run(engine, model, BEFORE), [engine, model]);
  const after = useMemo(() => run(engine, model, AFTER), [engine, model]);
  const advice = useMemo(() => offlineAdvice(model, BEFORE, before.analysis), [model, before]);
  const tf = model.plant.kind === "tf" ? model.plant : null;
  const prompt = useTyped(PRESETS[0].prompt, step === 0);

  return (
    <section id="loop" ref={ref} className="relative border-b border-line" style={{ height: `${STEPS.length * 80 + 40}vh` }}>
      <div className="sticky top-0 flex h-[100svh] flex-col overflow-hidden pt-14">
        <div className="grid-lines pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative mx-auto grid h-full w-full max-w-[1440px] grid-rows-[auto_1fr] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:grid-rows-1 lg:gap-12 lg:py-12">
          <div className="flex flex-col justify-between">
            <div>
              <p className="mono-label text-mute">·· The loop</p>
              <h2 className="mt-3 text-[clamp(2rem,4vw,3.4rem)] leading-[1] font-medium tracking-[-0.03em]">
                From a sentence to a <span className="text-spectrum">validated</span> controller.
              </h2>
            </div>
            <ol className="mt-6 hidden lg:block">
              {STEPS.map((s, i) => {
                const on = i === step;
                return (
                  <li key={s.k} className={`border-t border-line py-3.5 transition-opacity duration-500 ${on ? "opacity-100" : "opacity-35"}`}>
                    <div className="flex items-baseline gap-4">
                      <span className={`relative flex h-6 w-9 items-center justify-center font-mono text-[11px] ${on ? "text-fg" : "text-mute"}`}>
                        <span className={`absolute inset-0 ${on ? "spectrum-border" : "border border-line"}`} />
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <p className="text-[15px] font-medium">{s.t}</p>
                        <AnimatePresence initial={false}>
                          {on && (
                            <motion.p
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden pt-1 text-sm leading-relaxed text-mute"
                            >
                              {s.d}
                            </motion.p>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="mt-4 h-px w-full bg-line">
              <div className="h-px" style={{ width: `${progress * 100}%`, background: "var(--spectrum)" }} />
            </div>
          </div>

          <div className="relative min-h-0">
            <p className="mono-label mb-3 text-mute lg:hidden">
              {String(step + 1).padStart(2, "0")} · {STEPS[step].t}
            </p>
            <AnimatePresence mode="wait">
              <motion.div key={step} {...fade} className="h-full max-h-[560px]">
                {step === 0 && (
                  <Panel label="01 · Describe">
                    <div className="min-h-28 rounded-[3px] border border-line-2 bg-void p-4 text-[15px] leading-relaxed">
                      <span className="caret">{prompt}</span>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <span className="spectrum-border inline-flex items-center gap-2 rounded-full bg-void px-3 py-1.5">
                        <Mic className="size-3.5" />
                        <span className="flex h-4 items-end gap-0.5">
                          {Array.from({ length: 14 }).map((_, i) => (
                            <motion.span
                              key={i}
                              className="w-0.5 rounded-full bg-fg"
                              animate={{ height: ["20%", `${30 + ((i * 37) % 70)}%`, "20%"] }}
                              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.05 }}
                            />
                          ))}
                        </span>
                        <span className="mono-label text-mute">Listening</span>
                      </span>
                      <span className="inline-flex items-center gap-2 rounded-full border border-line-2 px-3 py-1.5 text-mute">
                        <FileSpreadsheet className="size-3.5" />
                        <span className="mono-label">step_test.csv · 301 rows</span>
                      </span>
                    </div>
                  </Panel>
                )}
                {step === 1 && (
                  <Panel label="02 · Model">
                    <p className="text-sm text-mute">{model.summary}</p>
                    <div className="mt-4 space-y-1.5 font-mono text-[13px]">
                      {model.equations.map((e, i) => (
                        <motion.p key={e} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.15 }}>
                          {e}
                        </motion.p>
                      ))}
                    </div>
                    {tf && (
                      <motion.div
                        className="mt-6 flex items-center gap-3 border-t border-line pt-5 font-mono"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.7 }}
                      >
                        <span className="text-mute">G(s) =</span>
                        <span className="inline-flex flex-col items-center text-[13px] sm:text-sm">
                          <span className="px-2">{polyToString(tf.num)}</span>
                          <span className="my-1 h-px w-full bg-fg/60" />
                          <span className="px-2">{polyToString(tf.den)}</span>
                        </span>
                      </motion.div>
                    )}
                    <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                      {model.params.slice(0, 6).map((p) => (
                        <div key={p.symbol} className="flex justify-between border-b border-line py-1 font-mono text-xs">
                          <span className="text-mute">{p.symbol}</span>
                          <span>
                            {fmtNum(p.value)} <span className="text-dim">{p.unit}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}
                {step === 2 && (
                  <Panel label="03 · Control">
                    <svg viewBox="0 0 520 170" className="w-full" aria-hidden>
                      <defs>
                        <marker id="arw" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                          <path d="M0,0 L8,4 L0,8 z" fill="#8b909c" />
                        </marker>
                      </defs>
                      <g fontFamily="var(--font-mono)" fontSize="12" fill="#eceef2">
                        <text x="6" y="64">r</text>
                        <line x1="20" y1="60" x2="78" y2="60" stroke="#8b909c" className="flow-dash" markerEnd="url(#arw)" />
                        <circle cx="94" cy="60" r="15" fill="none" stroke="#eceef2" />
                        <text x="88" y="65">Σ</text>
                        <line x1="110" y1="60" x2="168" y2="60" stroke="#8b909c" className="flow-dash" markerEnd="url(#arw)" />
                        <rect x="170" y="35" width="110" height="50" fill="#0a0b0e" stroke="url(#spec)" />
                        <text x="190" y="65">PID  C(s)</text>
                        <line x1="280" y1="60" x2="338" y2="60" stroke="#8b909c" className="flow-dash" markerEnd="url(#arw)" />
                        <text x="296" y="52" fill="#8b909c">u</text>
                        <rect x="340" y="35" width="110" height="50" fill="#0a0b0e" stroke="#50555f" />
                        <text x="360" y="65">Plant P(s)</text>
                        <line x1="450" y1="60" x2="510" y2="60" stroke="#8b909c" className="flow-dash" markerEnd="url(#arw)" />
                        <text x="500" y="52">y</text>
                        <path d="M480,60 V140 H94 V78" fill="none" stroke="#8b909c" className="flow-dash" markerEnd="url(#arw)" />
                        <text x="102" y="100" fill="#8b909c">−</text>
                      </g>
                      <linearGradient id="spec" x1="0" x2="1">
                        <stop offset="0" stopColor="#2dd4ff" />
                        <stop offset="0.5" stopColor="#9b5cff" />
                        <stop offset="1" stopColor="#ff8ac4" />
                      </linearGradient>
                    </svg>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      {[
                        ["Kp", BEFORE.type === "pid" ? BEFORE.kp : 0, 0.5],
                        ["Ki", BEFORE.type === "pid" ? BEFORE.ki : 0, 0.75],
                        ["Kd", BEFORE.type === "pid" ? BEFORE.kd : 0, 0.05],
                      ].map(([k, v, f]) => (
                        <div key={k as string} className="border border-line p-3">
                          <p className="mono-label text-mute">{k}</p>
                          <p className="mt-1 font-mono text-xl tabular-nums">{fmtNum(v as number)}</p>
                          <div className="mt-2 h-0.5 bg-line">
                            <motion.div className="h-0.5 bg-fg" initial={{ width: 0 }} animate={{ width: `${(f as number) * 100}%` }} transition={{ duration: 1, delay: 0.2 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-4 text-sm text-mute">{model.controllerRationale}</p>
                  </Panel>
                )}
                {step === 3 && (
                  <Panel label={`04 · Simulate · ${engine.backend === "wasm" ? "C++/WASM" : "TS"} engine`}>
                    <div className="relative">
                      <MiniChart y={before.sim.y} target={model.sim.ref} className="h-52 w-full" height={200} />
                      <motion.div
                        className="absolute top-0 bottom-0 w-px bg-fg/40"
                        initial={{ left: "0%" }}
                        animate={{ left: "100%" }}
                        transition={{ duration: 1.4, ease: [0.6, 0, 0.2, 1] }}
                      />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
                      {[
                        ["Overshoot", `${before.analysis.metrics.overshootPct.toFixed(1)}%`, before.analysis.metrics.overshootPct > model.specs.maxOvershootPct],
                        ["Settling", `${fmtNum(before.analysis.metrics.settlingTime)} s`, false],
                        ["Phase margin", `${fmtNum(before.analysis.pmDeg)}°`, before.analysis.pmDeg < 45],
                        ["Peak |u|", `${fmtNum(before.analysis.metrics.maxAbsU)} V`, false],
                      ].map(([k, v, bad]) => (
                        <div key={k as string} className="bg-panel p-3">
                          <p className="mono-label text-dim">{k}</p>
                          <p className={`mt-1 font-mono text-base tabular-nums ${bad ? "text-warn" : ""}`}>{v}</p>
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}
                {step === 4 && (
                  <Panel label="05 · Explain & iterate">
                    <div className="space-y-3">
                      <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="ml-auto max-w-[80%] rounded-[3px] bg-panel-2 px-3.5 py-2.5 text-sm">
                        Why does the arm swing past the shelf?
                      </motion.div>
                      <motion.div
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.35 }}
                        className="max-w-[92%] border-l-2 pl-3.5 text-sm leading-relaxed"
                        style={{ borderImage: "var(--spectrum) 1" }}
                      >
                        <p className="mb-1 flex items-center gap-1.5 font-medium">
                          <Sparkles className="size-3.5" /> {advice.headline}
                        </p>
                        <p className="text-mute">{advice.explanation}</p>
                      </motion.div>
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.8 }}
                        className="spectrum-border flex items-center justify-between gap-3 bg-void px-3.5 py-2.5"
                      >
                        <span className="font-mono text-xs">
                          Kp 30 → 47 · Ki 3000 → 1340 · Kd 0 → 0.03
                        </span>
                        <span className="mono-label text-ok">Applied</span>
                      </motion.div>
                    </div>
                    <svg viewBox="0 0 300 90" className="mt-4 h-28 w-full" preserveAspectRatio="none" aria-hidden>
                      <path d={pathFrom(before.sim.y, 300, 90, -0.05, 0.8, 2)} fill="none" stroke="rgb(255 255 255 / 0.22)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
                      <motion.path
                        d={pathFrom(after.sim.y, 300, 90, -0.05, 0.8, 2)}
                        fill="none"
                        stroke="#4ade80"
                        strokeWidth="1.8"
                        vectorEffect="non-scaling-stroke"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ delay: 1, duration: 1.2 }}
                      />
                    </svg>
                    <p className="mono-label mt-2 text-mute">
                      Overshoot {before.analysis.metrics.overshootPct.toFixed(0)}% → <span className="text-ok">{after.analysis.metrics.overshootPct.toFixed(1)}%</span> · phase margin{" "}
                      {fmtNum(before.analysis.pmDeg)}° → <span className="text-ok">{fmtNum(after.analysis.pmDeg)}°</span>
                    </p>
                  </Panel>
                )}
                {step === 5 && (
                  <Panel label="06 · Validate">
                    <LiveChecks engine={engine} model={model} spec={AFTER} />
                  </Panel>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
