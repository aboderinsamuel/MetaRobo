"use client";

import { ArrowUpRight, Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import RoboMark from "@/components/brand/RoboMark";

export const SECTIONS = [
  { id: "intro", label: "Intro" },
  { id: "loop", label: "The loop" },
  { id: "engine", label: "Engine" },
  { id: "validation", label: "Validation" },
  { id: "systems", label: "Systems" },
  { id: "builder", label: "Builder" },
];

export function LaunchButton({ className = "", label = "Launch lab" }: { className?: string; label?: string }) {
  return (
    <Link
      href="/lab"
      className={`spectrum-border group inline-flex h-9 items-center gap-2 rounded-[3px] bg-void px-4 font-mono text-[11px] tracking-[0.08em] text-fg uppercase transition-colors hover:bg-panel-2 ${className}`}
    >
      <span className="text-mute transition-colors group-hover:text-fg">··</span> {label}
    </Link>
  );
}

export function Nav() {
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
        <nav className="hidden items-center gap-7 md:flex">
          {SECTIONS.slice(1).map((s) => (
            <a key={s.id} href={`#${s.id}`} className="mono-label text-mute transition-colors hover:text-fg">
              {s.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <LaunchButton className="hidden sm:inline-flex" />
          <button className="flex size-9 items-center justify-center text-mute md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
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
            className="overflow-hidden border-t border-line bg-void md:hidden"
          >
            {SECTIONS.slice(1).map((s) => (
              <a key={s.id} href={`#${s.id}`} onClick={() => setOpen(false)} className="mono-label flex items-center justify-between border-b border-line px-4 py-4 text-mute">
                {s.label} <ArrowUpRight className="size-3.5" />
              </a>
            ))}
            <div className="p-4">
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
    <aside className="fixed top-1/2 right-5 z-40 hidden -translate-y-1/2 xl:block">
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
