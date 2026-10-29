"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useMemo, useRef } from "react";
import { run } from "@/lib/lab/analysis";
import { PRESETS } from "@/lib/lab/presets";
import { RIGS } from "@/lib/lab/rig";
import { useEngine } from "@/lib/sim/useEngine";
import MiniChart from "./MiniChart";

export default function Systems() {
  const engine = useEngine();
  const strip = useRef<HTMLDivElement>(null);
  const cards = useMemo(
    () =>
      PRESETS.map((p) => {
        const model = p.build();
        const r = run(engine, model, model.controller);
        return { p, model, y: r.sim.y, stable: r.analysis.metrics.stable === 1, os: r.analysis.metrics.overshootPct };
      }),
    [engine],
  );
  const scroll = (dir: number) => strip.current?.scrollBy({ left: dir * 380, behavior: "smooth" });

  return (
    <section id="systems" className="relative border-b border-line">
      <div className="mx-auto max-w-[1440px] px-4 pt-28 pb-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="mono-label text-mute">·· Systems</p>
            <h2 className="mt-3 text-[clamp(2rem,4.4vw,3.8rem)] leading-[1] font-medium tracking-[-0.03em]">
              Start from a{" "}
              <span className="brackets inline-block border border-line-2 px-3 py-0.5">
                <span className="font-pixel text-[0.82em]">machine</span>
              </span>
            </h2>
          </div>
          <div className="flex gap-2">
            {[ArrowLeft, ArrowRight].map((Icon, i) => (
              <button
                key={i}
                onClick={() => scroll(i ? 1 : -1)}
                className="flex size-10 items-center justify-center rounded-full border border-line text-mute transition-colors hover:border-line-2 hover:bg-panel hover:text-fg"
                aria-label={i ? "Next" : "Previous"}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div ref={strip} className="mx-auto flex max-w-[1440px] snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-6 [scrollbar-width:none] sm:px-6">
        {cards.map(({ p, model, y, stable, os }, i) => (
          <motion.article
            key={p.id}
            className="group flex w-[86vw] max-w-[380px] shrink-0 snap-start flex-col overflow-hidden rounded-3xl border border-line bg-panel transition-shadow hover:shadow-[0_24px_60px_-30px_rgb(0_0_0/0.35)] sm:w-[380px]"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.05 }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <span className="mono-label text-dim">▸ SYS {String(i + 1).padStart(2, "0")}</span>
              <span className={`mono-label rounded-full border px-2 py-0.5 ${stable ? "border-line-2 text-mute" : "border-bad/40 text-bad"}`}>
                {stable ? `${os.toFixed(0)}% OS · untuned` : "unstable · untuned"}
              </span>
            </div>
            <div className="px-5 pt-5">
              <h3 className="text-xl font-medium tracking-tight">{p.name}</h3>
              <p className="mono-label mt-1 text-mute">
                3D {RIGS[p.rig].name} · {p.blurb}
              </p>
              <MiniChart y={y} target={model.sim.ref} className="mt-5 h-24 w-full" height={96} />
            </div>
            <ul className="mt-4 flex-1 space-y-1.5 px-5 pb-5 text-[13px] text-mute">
              {model.assumptions.slice(0, 2).map((a) => (
                <li key={a} className="flex gap-2">
                  <span className="text-dim">▸</span> {a}
                </li>
              ))}
            </ul>
            <Link
              href={`/lab?preset=${p.id}`}
              className="mono-label flex items-center justify-between border-t border-line px-5 py-4 transition-colors group-hover:bg-panel-2"
            >
              Open in lab <ArrowUpRight className="size-4 text-spec-1 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
