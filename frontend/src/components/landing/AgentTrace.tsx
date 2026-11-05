"use client";

import { motion, useInView } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { autoTune } from "@/lib/lab/advisor";
import { checkSpecs, fmtNum, run } from "@/lib/lab/analysis";
import type { ControllerSpec, LabModel } from "@/lib/lab/types";
import { useEngine } from "@/lib/sim/useEngine";
import recorded from "@/data/live-trace.json";
import MiniChart from "./MiniChart";

// A real agent run, replayed. The model below is exactly what Muse Spark 1.3 returned on a live call
// (recorded 2026-10-28, 4,698 tokens, $0.016). The checks and the fix are computed right now, in this
// browser, by the same engine the lab uses.
const PROMPT = "A small robot car with two DC motors; keep its wheel speed at 1 m/s.";
const RECORDED = { tokens: 4698, cost: 0.016 };

function poly(cs: number[]): string {
  const n = cs.length - 1;
  return cs
    .map((c, i) => {
      const p = n - i;
      const v = fmtNum(Math.abs(c));
      const term = p === 0 ? v : `${v === "1" ? "" : v}s${p > 1 ? `^${p}` : ""}`;
      return { sign: c < 0 ? "−" : "+", term };
    })
    .map((t, i) => (i === 0 ? (t.sign === "−" ? "−" : "") + t.term : ` ${t.sign} ${t.term}`))
    .join("");
}

function gains(c: ControllerSpec): string {
  if (c.type === "pid") return `kp ${fmtNum(c.kp)} · ki ${fmtNum(c.ki)} · kd ${fmtNum(c.kd)}`;
  return c.type === "lqr" ? `LQR R ${fmtNum(c.R)}` : "open loop";
}

type Line = { tag: string; tone: "meta" | "engine" | "ok" | "bad"; body: React.ReactNode };

export default function AgentTrace() {
  const engine = useEngine();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20%" });
  const [shown, setShown] = useState(0);

  const trace = useMemo(() => {
    const model = recorded as unknown as LabModel;
    const first = run(engine, model, model.controller);
    const firstChecks = checkSpecs(first.analysis.metrics, model.specs, model.sim.ref);
    const firstPass = firstChecks.every((c) => c.pass);
    const fixed = firstPass ? model.controller : autoTune(engine, model, model.controller, 80);
    const second = firstPass ? first : run(engine, model, fixed);
    const secondChecks = checkSpecs(second.analysis.metrics, model.specs, model.sim.ref);
    return { model, first, firstChecks, firstPass, fixed, second, secondChecks, accepted: secondChecks.every((c) => c.pass) };
  }, [engine]);

  const plant = trace.model.plant;
  const lines: Line[] = [
    { tag: "you", tone: "engine", body: <span className="text-fg">“{PROMPT}”</span> },
    {
      tag: "muse-spark-1.3",
      tone: "meta",
      body: (
        <>
          Plant <span className="text-fg">G(s) = {plant.kind === "tf" ? `${poly(plant.num)} / (${poly(plant.den)})` : "state space"}</span>, starting PID{" "}
          <span className="text-fg">{gains(trace.model.controller)}</span>, specs overshoot ≤ {trace.model.specs.maxOvershootPct}%, settle ≤{" "}
          {trace.model.specs.maxSettlingTime} s.{" "}
          <span className="text-dim">
            {RECORDED.tokens.toLocaleString()} tokens · ${RECORDED.cost.toFixed(3)}
          </span>
        </>
      ),
    },
    ...checkLines("v1", trace.firstChecks),
  ];
  if (!trace.firstPass) {
    lines.push({
      tag: "plantsim · fix",
      tone: "engine",
      body: (
        <>
          Rejected before it reached you. Searching gains with the simulator in the loop → <span className="text-fg">{gains(trace.fixed)}</span>
        </>
      ),
    });
    lines.push(...checkLines("v2", trace.secondChecks));
  }
  lines.push(
    trace.accepted
      ? { tag: "verdict", tone: "ok", body: <span className="text-fg">Every spec passes. Firmware unlocked.</span> }
      : { tag: "verdict", tone: "bad", body: <span className="text-fg">Still failing. Held back; you&apos;ll see why in the lab.</span> },
  );

  useEffect(() => {
    if (!inView) return;
    if (shown >= lines.length) return;
    const id = setTimeout(() => setShown((s) => s + 1), shown === 0 ? 200 : 650);
    return () => clearTimeout(id);
  }, [inView, shown, lines.length]);

  return (
    <section id="trace" className="relative border-b border-line">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="mono-label text-mute">·· Verifiable agent</p>
          <h2 className="mt-4 text-[clamp(2rem,4vw,3.2rem)] leading-[1.04] font-semibold tracking-[-0.03em]">
            The AI proposes. <span className="text-spectrum">Physics decides.</span>
          </h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-mute">
            This is a real run, not a mock-up. The model on the right is exactly what Muse Spark returned on a live call. The checks and the fix are
            being computed right now, in your browser, by the same C++/WebAssembly engine the lab uses.
          </p>
          <div className="mt-8 grid max-w-md grid-cols-2 gap-4">
            {[
              { label: "Muse Spark's first try", y: trace.first.sim.y, pass: trace.firstPass },
              { label: trace.firstPass ? "Accepted as-is" : "After the engine's fix", y: trace.second.sim.y, pass: trace.accepted },
            ].map((c) => (
              <div key={c.label} className="rounded-2xl border border-line bg-panel p-3">
                <p className="mono-label flex items-center justify-between text-[9px] text-mute">
                  {c.label} <span className={c.pass ? "text-ok" : "text-bad"}>{c.pass ? "pass" : "fail"}</span>
                </p>
                <MiniChart y={c.y} target={trace.model.sim.ref} className="mt-2 h-14 w-full" height={56} />
              </div>
            ))}
          </div>
        </div>

        <div ref={ref} className="meta-ring self-start overflow-hidden rounded-3xl bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="mono-label text-[10px] text-mute">agent trace · rover speed loop</span>
            <span className="mono-label flex items-center gap-1.5 text-[10px] text-mute">
              <span className="size-1.5 rounded-full bg-spec-2" /> {engine.backend === "wasm" ? "wasm engine" : "ts engine"}
            </span>
          </div>
          <ol className="space-y-3 p-4 font-mono text-[12px] leading-relaxed sm:p-5 sm:text-[13px]">
            {lines.slice(0, shown).map((l, i) => (
              <motion.li key={i} className="grid grid-cols-[8rem_1fr] gap-3 sm:grid-cols-[10.5rem_1fr]" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
                <span
                  className={`truncate ${l.tone === "meta" ? "text-spectrum" : l.tone === "ok" ? "text-ok" : l.tone === "bad" ? "text-bad" : "text-dim"}`}
                >
                  {l.tag}
                </span>
                <span className="text-mute">{l.body}</span>
              </motion.li>
            ))}
            {shown < lines.length && <li className="caret text-dim" aria-hidden />}
          </ol>
        </div>
      </div>
    </section>
  );
}

function checkLines(v: string, checks: ReturnType<typeof checkSpecs>): Line[] {
  return [
    {
      tag: `plantsim · check ${v}`,
      tone: "engine",
      body: (
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          {checks.map((c) => (
            <span key={c.key}>
              {c.label} <span className="text-fg">{c.value}</span> <span className={c.pass ? "text-ok" : "text-bad"}>{c.pass ? "✓" : "✗"}</span>
            </span>
          ))}
        </span>
      ),
    },
  ];
}
