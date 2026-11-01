"use client";

// The landing hero: a centred pitch, then the RoboCraft film in a cinematic frame. The film plays
// muted on loop (browsers only autoplay silent video), with one click for sound; it pauses when
// it's off-screen and doesn't autoplay for people who prefer reduced motion.
import { ArrowRight, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { motion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtNum, run } from "@/lib/lab/analysis";
import { presetById } from "@/lib/lab/presets";
import { useEngine } from "@/lib/sim/useEngine";
import MiniChart from "./MiniChart";

const ease = [0.6, 0, 0.2, 1] as const;

function Crosshair({ className }: { className: string }) {
  return (
    <span className={`pointer-events-none absolute size-3 ${className}`} aria-hidden>
      <span className="absolute top-1/2 left-0 h-px w-full bg-mute/60" />
      <span className="absolute top-0 left-1/2 h-full w-px bg-mute/60" />
    </span>
  );
}

function Film() {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  // Eases in as it scrolls into view.
  const { scrollYProgress } = useScroll({ target: frame, offset: ["start end", "center center"] });
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1]);
  const lift = useTransform(scrollYProgress, [0, 1], [40, 0]);

  // Autoplay (muted) unless reduced motion is preferred; pause while off-screen.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !reduced && v.dataset.userPaused !== "1") void v.play().catch(() => {});
        else if (!e.isIntersecting) v.pause();
      },
      { threshold: 0.25 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  const toggleSound = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    // Sound on starts from the top, so the line lands as cut.
    if (!v.muted) {
      v.currentTime = 0;
      v.dataset.userPaused = "0";
      void v.play().catch(() => {});
    }
  };
  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      v.dataset.userPaused = "0";
      void v.play().catch(() => {});
    } else {
      v.dataset.userPaused = "1";
      v.pause();
    }
  };

  return (
    <motion.div ref={frame} style={{ scale, y: lift }} className="relative mx-auto w-full max-w-[1120px]">
      {/* Soft spectrum glow behind the frame. */}
      <div aria-hidden className="pointer-events-none absolute -inset-x-10 -inset-y-8 -z-10 rounded-[48px] opacity-60 blur-3xl" style={{ background: "radial-gradient(60% 60% at 50% 55%, rgb(0 130 251 / 0.28), rgb(155 92 255 / 0.18) 45%, transparent 75%)" }} />
      <div className="group relative overflow-hidden rounded-[28px] bg-black shadow-[0_50px_120px_-40px_rgb(0_0_0/0.65),0_0_0_1px_rgb(255_255_255/0.08)] sm:rounded-[32px]">
        <video
          ref={video}
          className="aspect-video w-full object-cover"
          src="/video/robocraft.mp4"
          poster="/video/robocraft-poster.jpg"
          muted
          loop
          playsInline
          preload="auto"
          // Lets the boot screen lift as soon as the film can show its first frame.
          onLoadedData={() => window.dispatchEvent(new Event("rc-hero-ready"))}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          aria-label="RoboCraft film: built with Meta Muse Spark, Muse Wonder, Muse Image and SAM 3.1"
        />
        {/* Controls: always reachable, quiet until hovered. */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/55 to-transparent p-4 opacity-90 transition-opacity sm:p-5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <button onClick={togglePlay} aria-label={playing ? "Pause the film" : "Play the film"} className="flex size-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-colors hover:bg-white/25">
            {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
          </button>
          <button onClick={toggleSound} className="inline-flex h-10 items-center gap-2 rounded-full bg-white/15 px-4 text-[13px] font-medium text-white backdrop-blur-md transition-colors hover:bg-white/25">
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            {muted ? "Sound on" : "Mute"}
          </button>
        </div>
        {/* A sound hint that disappears once used. */}
        {muted && (
          <button onClick={toggleSound} className="absolute top-4 right-4 hidden h-8 items-center gap-1.5 rounded-full bg-black/40 px-3 text-[12px] font-medium text-white/90 backdrop-blur-md transition-colors hover:bg-black/60 sm:top-5 sm:right-5 sm:inline-flex">
            <VolumeX className="size-3.5" /> Tap for sound
          </button>
        )}
      </div>
    </motion.div>
  );
}

export default function Hero() {
  const engine = useEngine();
  const live = useMemo(() => {
    const model = presetById("rover")!.build();
    const r = run(engine, model, { type: "pid", kp: 10.4, ki: 136, kd: 0, N: 500 });
    return { y: r.sim.y, ref: model.sim.ref, a: r.analysis, backend: engine.backend };
  }, [engine]);

  return (
    <section id="intro" className="relative overflow-hidden border-b border-line">
      <div className="grid-lines pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_55%_at_50%_30%,black,transparent)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[70vh]" style={{ background: "radial-gradient(ellipse 50% 60% at 50% 0%, rgb(0 130 251 / 0.12), transparent 70%)" }} />

      <div className="relative mx-auto max-w-[1440px] px-4 pt-24 pb-16 sm:px-6 sm:pt-28 sm:pb-24">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-[clamp(2.6rem,6.4vw,5.6rem)] leading-[0.98] font-medium tracking-[-0.04em]">
            <motion.span className="block" initial={{ y: "60%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.9, ease, delay: 0.2 }}>
              Describe a robot.
            </motion.span>
            <motion.span className="mt-2 flex flex-wrap items-center justify-center gap-x-[0.25em]" initial={{ y: "60%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.9, ease, delay: 0.32 }}>
              Watch it
              <span className="relative inline-block px-[0.18em]">
                <Crosshair className="-top-1.5 -left-1.5" />
                <Crosshair className="-right-1.5 -bottom-1.5" />
                <span className="absolute inset-0 border border-line-2" />
                <span className="font-pixel text-[0.86em] tracking-[-0.02em]">move</span>
              </span>
            </motion.span>
          </h1>
          <motion.p className="mx-auto mt-7 max-w-2xl text-[clamp(1rem,1.5vw,1.2rem)] leading-relaxed text-balance text-mute" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.7 }}>
            Type it, say it or film it. Meta&apos;s Muse models design the machine from real, buyable parts, physics puts it through the job, and you leave with the parts list, the wiring and the firmware.
            <span className="mt-2 block text-fg">All before you buy a single motor.</span>
          </motion.p>
          <motion.div className="mt-9 flex flex-wrap items-center justify-center gap-3" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65, duration: 0.7 }}>
            <Link href="/create" className="group inline-flex h-12 items-center gap-2 rounded-2xl bg-fg px-6 text-[15px] font-semibold text-void shadow-[0_12px_40px_-12px_rgb(0_130_251/0.55)] transition-transform hover:-translate-y-0.5">
              Start building, free <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/lab" className="inline-flex h-12 items-center gap-2 rounded-2xl border border-line-2 bg-panel/60 px-6 text-[15px] font-medium text-fg backdrop-blur transition-colors hover:bg-panel">
              Explore the Control Lab
            </Link>
          </motion.div>
        </div>

        <motion.div className="mt-16 sm:mt-20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 1 }}>
          <Film />
        </motion.div>

        {/* Proof: what it's built on, and the engine running live in this page. */}
        <div className="mx-auto mt-14 flex max-w-[1120px] flex-col items-center gap-6 sm:mt-16">
          <p className="mono-label text-dim">Built with</p>
          <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[15px] font-medium text-mute">
            {["Meta Muse Spark", "Muse Wonder", "SAM 3.1", "Muse Image", "C++ → WebAssembly", "Rapier physics"].map((t) => (
              <li key={t} className="whitespace-nowrap">
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-2 grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 flex items-center gap-3 rounded-2xl border border-line bg-panel/60 px-4 py-3 sm:col-span-1">
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-ok" />
              </span>
              <span className="min-w-0 text-[12.5px] leading-tight text-mute">
                Live now: rover speed loop on the <span className="text-fg">{live.backend === "wasm" ? "WASM" : "TS"} engine</span>
              </span>
              <MiniChart y={live.y} target={live.ref} className="ml-auto hidden h-6 w-20 shrink-0 lg:block" height={24} />
            </div>
            {[
              ["Overshoot", `${live.a.metrics.overshootPct.toFixed(1)}%`],
              ["Settling time", `${fmtNum(live.a.metrics.settlingTime)} s`],
              ["Phase margin", `${fmtNum(live.a.pmDeg)}°`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-line bg-panel/60 px-4 py-3">
                <p className="text-[12px] text-mute">{k}</p>
                <p className="mt-0.5 font-mono text-[17px] text-fg tabular-nums">{v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
