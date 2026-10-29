"use client";

import { ArrowUpRight, Menu, Volume2, VolumeX, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import RoboMark from "@/components/brand/RoboMark";
import { LANGS, setLang, useLang, useStrings } from "@/lib/i18n";
import { chime, setSound, tick, useSound } from "@/lib/sound";

// `nav` marks the sections linked from the top bar; the side rail shows them all.
export const SECTIONS = [
  { id: "intro", label: "Intro" },
  { id: "styles", label: "Robo" },
  { id: "meta", label: "Meta stack", nav: true },
  { id: "loop", label: "The loop", nav: true },
  { id: "trace", label: "Agent", nav: true },
  { id: "engine", label: "Engine", nav: true },
  { id: "validation", label: "Validation" },
  { id: "systems", label: "Systems" },
  { id: "pricing", label: "Pricing", nav: true },
  { id: "log", label: "Hackathon", nav: true },
  { id: "builder", label: "Builder" },
];

/** "Powered by Meta Muse" badge: plain-text attribution, no Meta logo. */
export function MetaBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`meta-ring inline-flex h-6 items-center gap-1.5 rounded-full bg-void/70 px-2.5 text-[11px] font-medium text-fg backdrop-blur ${className}`}>
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-spec-2 opacity-70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-spec-2" />
      </span>
      Powered by <span className="text-spectrum font-semibold">Meta Muse</span>
    </span>
  );
}

export function LaunchButton({ className = "", label, href = "/lab" }: { className?: string; label?: string; href?: string }) {
  const launch = useStrings().launch;
  label ??= launch;
  return (
    <Link
      href={href}
      className={`spectrum-border group inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-[3px] bg-void px-4 font-mono text-[11px] tracking-[0.08em] text-fg uppercase transition-colors hover:bg-panel-2 ${className}`}
    >
      <span className="text-mute transition-colors group-hover:text-fg">··</span> {label}
    </Link>
  );
}

/** EN / 日本語 / 中文, each in its own script. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const lang = useLang();
  return (
    <div role="group" aria-label="Language" className={`flex h-8 items-center rounded-full border border-line-2 bg-void/60 p-0.5 backdrop-blur ${className}`}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          lang={l.id}
          onMouseEnter={tick}
          onClick={() => {
            if (l.id === lang) return;
            setLang(l.id);
            chime();
          }}
          aria-pressed={l.id === lang}
          className={`h-full rounded-full px-2.5 text-[12px] whitespace-nowrap transition-colors ${l.id === lang ? "bg-fg text-void" : "text-mute hover:text-fg"}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

function SoundToggle() {
  const on = useSound();
  const [onLabel, offLabel] = useStrings().sound;
  return (
    <button
      type="button"
      onClick={() => {
        setSound(!on);
        if (!on) chime();
      }}
      aria-label={on ? offLabel : onLabel}
      title={on ? onLabel : offLabel}
      className="flex size-8 items-center justify-center rounded-full border border-line-2 text-mute transition-colors hover:text-fg"
    >
      {on ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
    </button>
  );
}

export function Nav() {
  const t = useStrings().nav;
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${scrolled ? "border-line bg-void/80 backdrop-blur-md" : "border-transparent"}`}
    >
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <RoboMark className="size-7" />
          <span className="text-[15px] font-medium tracking-tight">RoboCraft</span>
          <span className="mono-label hidden rounded-[2px] border border-line-2 px-1.5 py-0.5 text-[9px] text-mute sm:inline">Control lab</span>
        </Link>
        <nav className="hidden items-center gap-6 lg:flex">
          {SECTIONS.filter((s) => s.nav).map((s) => (
            <a key={s.id} href={`#${s.id}`} className="mono-label whitespace-nowrap text-mute transition-colors hover:text-fg">
              {t[s.id as keyof typeof t] ?? s.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <LangSwitch className="hidden sm:flex" />
          <SoundToggle />
          <LaunchButton className="hidden xl:inline-flex" />
          <button className="flex size-9 items-center justify-center text-mute lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-line bg-void lg:hidden"
          >
            {SECTIONS.filter((s) => s.nav).map((s) => (
              <a key={s.id} href={`#${s.id}`} onClick={() => setOpen(false)} className="mono-label flex items-center justify-between border-b border-line px-4 py-4 text-mute">
                {t[s.id as keyof typeof t] ?? s.label} <ArrowUpRight className="size-3.5" />
              </a>
            ))}
            <div className="space-y-3 p-4">
              <LangSwitch className="w-fit sm:hidden" />
              <LaunchButton className="w-full justify-center" />
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

/** Right-hand section rail with a live position marker. */
export function SideIndex() {
  const [active, setActive] = useState("intro");
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <aside className="fixed top-1/2 right-5 z-40 hidden -translate-y-1/2 2xl:block">
      <ol className="flex flex-col items-end gap-3">
        {SECTIONS.map((s) => {
          const on = s.id === active;
          return (
            <li key={s.id}>
              <a href={`#${s.id}`} className="group flex items-center gap-2.5">
                <span className={`mono-label text-[10px] transition-all ${on ? "text-fg" : "text-dim group-hover:text-mute"}`}>{s.label}</span>
                <span className="relative flex size-2 items-center justify-center">
                  {on && <motion.span layoutId="rail-dot" className="absolute size-2 rounded-full" style={{ background: "var(--spectrum-conic)" }} />}
                  <span className={`size-1 rounded-full ${on ? "bg-transparent" : "bg-dim"}`} />
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
