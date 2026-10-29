"use client";

// "Robo, in every style": the mascot drawn by Meta Muse Image in eight art styles. The images were
// generated once (scripts/robo-styles.mjs) and are served from /public, so this costs nothing at
// runtime. The featured image cycles on its own; hovering or tapping a tile picks it.
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { STYLE_IDS, useStrings, type StyleId } from "@/lib/i18n";
import { chime, tick } from "@/lib/sound";

export default function RoboStyles() {
  const s = useStrings().styles;
  const [active, setActive] = useState<StyleId>("studio");
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setActive((a) => STYLE_IDS[(STYLE_IDS.indexOf(a) + 1) % STYLE_IDS.length]), 2600);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <section id="styles" className="relative overflow-hidden border-b border-line">
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 45% 50% at 30% 50%, rgb(155 92 255 / 0.10), transparent 70%)" }} />
      <div className="relative mx-auto grid max-w-[1440px] gap-12 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
        <div className="relative mx-auto aspect-square w-full max-w-[520px]">
          <div className="spectrum-border absolute inset-0 rounded-[28px]" />
          <div className="absolute inset-[1px] overflow-hidden rounded-[27px] bg-[#06080b]">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={active}
                className="absolute inset-0"
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.6, ease: [0.6, 0, 0.2, 1] }}
              >
                <Image src={`/robo/${active}.webp`} alt={`Robo, ${s.names[active]}`} fill sizes="(min-width: 1024px) 520px, 92vw" className="object-cover" priority={active === "studio"} />
              </motion.div>
            </AnimatePresence>
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/80 to-transparent p-5">
              <AnimatePresence mode="wait">
                <motion.span key={active + s.title} className="text-xl font-medium" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                  {s.names[active]}
                </motion.span>
              </AnimatePresence>
              <span className="mono-label text-[10px] text-mute">
                {STYLE_IDS.indexOf(active) + 1} / {STYLE_IDS.length}
              </span>
            </div>
          </div>
        </div>

        <div>
          <p className="mono-label text-mute">{s.kicker}</p>
          <h2 className="mt-4 text-[clamp(2rem,4.6vw,3.8rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
            <span className="text-spectrum">{s.title}</span>
          </h2>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-mute">{s.body}</p>
          <ul className="mt-10 grid grid-cols-4 gap-2.5" onMouseLeave={() => setPaused(false)}>
            {STYLE_IDS.map((id) => {
              const on = id === active;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onMouseEnter={() => {
                      setPaused(true);
                      if (id !== active) {
                        tick();
                        setActive(id);
                      }
                    }}
                    onClick={() => {
                      setPaused(true);
                      setActive(id);
                      chime();
                    }}
                    className={`group relative block aspect-square w-full overflow-hidden rounded-[10px] border transition-all duration-300 ${on ? "border-fg/70 shadow-[0_0_24px_rgb(0_130_251/0.35)]" : "border-line opacity-70 hover:opacity-100"}`}
                    aria-label={s.names[id]}
                    aria-pressed={on}
                  >
                    <Image src={`/robo/${id}.webp`} alt="" fill sizes="120px" className="object-cover transition-transform duration-500 group-hover:scale-110" />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-1 text-center text-[10px] leading-tight">{s.names[id]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mono-label mt-5 text-[10px] text-dim">{s.note}</p>
        </div>
      </div>
    </section>
  );
}
