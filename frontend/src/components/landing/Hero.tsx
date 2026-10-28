"use client";

import { ArrowDown } from "lucide-react";
import { motion } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtNum, run } from "@/lib/lab/analysis";
import { presetById } from "@/lib/lab/presets";
import { useEngine } from "@/lib/sim/useEngine";
import { LaunchButton, MetaBadge } from "./Chrome";
import MiniChart from "./MiniChart";

// Start downloading the 3D robot as soon as this module runs (during hydration), not after mount.
const robotChunk = typeof window !== "undefined" ? import("./HeroRobot") : null;
const HeroRobot = dynamic(() => robotChunk ?? import("./HeroRobot"), { ssr: false });

const ease = [0.6, 0, 0.2, 1] as const;

function Crosshair({ className }: { className: string }) {
  return (
    <span className={`pointer-events-none absolute size-3 ${className}`} aria-hidden>
      <span className="absolute top-1/2 left-0 h-px w-full bg-mute/60" />
      <span className="absolute top-0 left-1/2 h-full w-px bg-mute/60" />
    </span>
  );
}

export default function Hero() {
  const scrollRef = useRef(0);
  const [robotReady, setRobotReady] = useState(false);
  // Never leave the hero empty if WebGL is slow or unavailable.
  useEffect(() => {
    const id = setTimeout(() => setRobotReady(true), 4000);
    return () => clearTimeout(id);
  }, []);
  const engine = useEngine();
  useEffect(() => {
    const on = () => (scrollRef.current = Math.min(1.5, window.scrollY / window.innerHeight));
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const live = useMemo(() => {
    const model = presetById("rover")!.build();
    const r = run(engine, model, { type: "pid", kp: 10.4, ki: 136, kd: 0, N: 500 });
    return { y: r.sim.y, ref: model.sim.ref, a: r.analysis, backend: engine.backend };
  }, [engine]);

  return (
    <section id="intro" className="relative h-[100svh] min-h-[640px] overflow-hidden border-b border-line">
      <div className="grid-lines pointer-events-none absolute inset-0" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 50% 45% at 50% 42%, rgb(0 130 251 / 0.13), transparent 70%)" }}
      />
      {/* Placeholder glow in the robot's spot until its first 3D frame is drawn. */}
      <div
        className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-700 ${robotReady ? "opacity-0" : "opacity-100"}`}
        aria-hidden
      >
        <div className="-mt-[8vh] size-[min(46vw,420px)] animate-pulse rounded-[38%] border border-white/5 bg-[radial-gradient(circle_at_50%_45%,rgb(0_130_251/0.22),rgb(155_92_255/0.08)_45%,transparent_70%)]" />
      </div>
      <div className={`absolute inset-0 mx-auto max-w-[1440px] transition-[opacity,transform] duration-700 ease-out ${robotReady ? "scale-100 opacity-100" : "scale-[0.97] opacity-0"}`}>
        <HeroRobot scrollRef={scrollRef} onReady={() => setRobotReady(true)} />
      </div>

      {/* Fades the robot into the page at the bottom. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-void via-void/80 to-transparent" />

      <div className="pointer-events-none relative mx-auto flex h-full max-w-[1440px] flex-col justify-between px-4 pt-20 pb-8 sm:px-6">
        <motion.div
          className="flex items-start justify-between"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.8 }}
        >
          <p className="mono-label hidden max-w-[16rem] text-mute sm:block">
            <span className="text-fg">[RC-LAB]</span> Your idea → real parts → 3D simulation → Robo helps you fix it
          </p>
          <ul className="mono-label hidden space-y-1.5 text-right text-mute md:block">
            {["Ages 10 to engineer", "Simple & Pro modes", "Real part physics", "C++ → WebAssembly", "Meta Muse Spark"].map((t, i) => (
              <motion.li key={t} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + i * 0.08 }}>
                {t}
              </motion.li>
            ))}
          </ul>
        </motion.div>

        <div className="grid items-end gap-8 lg:grid-cols-[1fr_auto]">
          <div>
            <motion.div className="mb-5 flex flex-wrap items-center gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
              <MetaBadge />
              <span className="mono-label text-mute">·· No experience needed</span>
            </motion.div>
            <h1 className="text-[clamp(2.4rem,5.6vw,5.2rem)] leading-[0.95] font-medium tracking-[-0.035em] [text-shadow:0_4px_40px_rgb(4_5_6_/_0.9)]">
              <motion.span className="block" initial={{ y: "110%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.9, ease, delay: 0.2 }}>
                Build a robot.
              </motion.span>
              <motion.span
                className="mt-2 flex flex-wrap items-center gap-x-[0.25em]"
                initial={{ y: "110%", opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.9, ease, delay: 0.32 }}
              >
                Watch it
                <span className="relative inline-block px-[0.18em]">
                  <Crosshair className="-top-1.5 -left-1.5" />
                  <Crosshair className="-right-1.5 -bottom-1.5" />
                  <span className="absolute inset-0 border border-line-2" />
                  <span className="font-pixel text-[0.86em] tracking-[-0.02em]">move</span>
                </span>
              </motion.span>
            </h1>
          </div>
          <motion.div
            className="pointer-events-auto max-w-sm lg:pb-3"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.7 }}
          >
            <p className="text-[15px] leading-relaxed text-mute [text-shadow:0_2px_18px_rgb(4_5_6_/_0.95)]">
              Pick a robot car, arm, balancer or drone, or just say <span className="text-fg">“a robot that picks up my toys”</span>. Press
              Simulate and watch it move. Robo explains what won&apos;t work and fixes it with you. Pro mode adds the graphs, maths and firmware.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <LaunchButton label="Start building" href="/lab?onboard=1" />
              <a href="#loop" className="mono-label inline-flex h-9 items-center gap-2 px-3 text-mute transition-colors hover:text-fg">
                How it works <ArrowDown className="size-3.5" />
              </a>
            </div>
          </motion.div>
        </div>

        <motion.div
          className="pointer-events-auto mt-8 grid grid-cols-2 border-t border-line pt-4 sm:grid-cols-[1.4fr_repeat(3,1fr)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
        >
          <div className="col-span-2 flex items-center gap-3 pb-3 sm:col-span-1 sm:pb-0">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-ok" />
            </span>
            <span className="mono-label text-mute">
              Live · rover speed loop · <span className="text-fg">{live.backend === "wasm" ? "WASM" : "TS"} engine</span>
            </span>
            <MiniChart y={live.y} target={live.ref} className="hidden h-6 w-28 sm:block" height={24} />
          </div>
          {[
            ["Overshoot", `${live.a.metrics.overshootPct.toFixed(1)}%`],
            ["Settling", `${fmtNum(live.a.metrics.settlingTime)} s`],
            ["Phase margin", `${fmtNum(live.a.pmDeg)}°`],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2 sm:justify-end">
              <span className="mono-label text-dim">{k}</span>
              <span className="font-mono text-sm text-fg tabular-nums">{v}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
