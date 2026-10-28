"use client";

// Getting started for everyone: a welcome flow that asks who you are and what you want to build,
// a guided tour of the lab, and the plain-language pieces of Simple mode (report card and coach)
// that replace the graphs and engineering terms.
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, GraduationCap, Rocket, Sparkles, Wand2, Wrench, X, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useState } from "react";
import RoboMark from "@/components/brand/RoboMark";
import type { SpecCheck } from "@/lib/lab/analysis";
import type { DerivedHardware, DesignCheck, HardwareBuild } from "@/lib/lab/hardware/build";
import type { SlotId } from "@/lib/lab/hardware/parts";
import type { LabModel, RigKind } from "@/lib/lab/types";
import type { Metrics } from "@/lib/sim/core";
import { RIG_ICON } from "./hwpanels";

export type Mode = "simple" | "pro";

export const FRIENDLY: Record<RigKind, { name: string; blurb: string; goal: string }> = {
  rover: { name: "Robot car", blurb: "Two motors, two wheels, drives itself", goal: "its cruise speed" },
  arm: { name: "Robot arm", blurb: "Picks things up and puts them on a shelf", goal: "the shelf" },
  balancer: { name: "Balancing robot", blurb: "Stands up on two wheels, like a Segway", goal: "the flag" },
  drone: { name: "Drone", blurb: "Four propellers, flies up and hovers", goal: "its target height" },
};

/** What each part does, in a sentence a 10-year-old can follow. */
export const SLOT_HELP: Record<SlotId, string> = {
  motor: "Makes things move. Stronger motors lift more; faster ones zoom.",
  driver: "The power switch between the brain and the motors.",
  battery: "Stores the energy. More volts means more speed.",
  board: "The robot's brain. It runs the code that makes decisions.",
  sensor: "How the robot knows where it is and how it's moving.",
  prop: "The spinning blades that push air down to fly.",
};

// ---------------------------------------------------------------------------
// Welcome flow
// ---------------------------------------------------------------------------

const PERSONAS: { id: "new" | "student" | "engineer"; title: string; sub: string; icon: typeof Rocket; mode: Mode }[] = [
  { id: "new", title: "I'm new to robots", sub: "Kids, makers, the curious. No maths needed.", icon: Rocket, mode: "simple" },
  { id: "student", title: "I'm learning engineering", sub: "See the graphs and the maths behind every move.", icon: GraduationCap, mode: "pro" },
  { id: "engineer", title: "I build robots already", sub: "Straight to the full lab: tuning, Bode, firmware.", icon: Wrench, mode: "pro" },
];

export function Welcome({ onDone, onClose }: { onDone: (mode: Mode, pick: RigKind | "describe", tour: boolean) => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [persona, setPersona] = useState<(typeof PERSONAS)[number] | null>(null);
  return (
    <motion.div className="fixed inset-0 z-[90] flex items-center justify-center bg-void/80 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        initial={{ y: 16, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        className="spectrum-border relative w-full max-w-[640px] rounded-[6px] bg-panel p-6 sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to RoboCraft"
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-dim hover:text-fg" aria-label="Skip">
          <X className="size-4" />
        </button>
        <div className="flex items-center gap-3">
          <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 2.4, repeat: Infinity }}>
            <RoboMark className="size-12" />
          </motion.div>
          <div>
            <p className="mono-label text-[10px] text-dim">Step {step + 1} of 2</p>
            <h2 className="text-xl font-medium tracking-tight sm:text-2xl">{step === 0 ? "Hi! I'm Robo. Let's build a robot." : "What do you want to build?"}</h2>
          </div>
        </div>
        <AnimatePresence mode="wait">
          {step === 0 ? (
            <motion.div key="who" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="mt-6">
              <p className="text-[14px] text-mute">You pick a machine, choose its parts and press Simulate to watch it move. If something won&apos;t work, I&apos;ll tell you why and how to fix it. First, who are you?</p>
              <div className="mt-5 grid gap-2.5">
                {PERSONAS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPersona(p);
                      setStep(1);
                    }}
                    className="group flex items-center gap-4 border border-line-2 bg-void px-4 py-3.5 text-left transition-colors hover:border-spec-1/60 hover:bg-panel-2"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line-2 text-spec-1 group-hover:border-spec-1/60">
                      <p.icon className="size-5" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-[15px] font-medium">{p.title}</span>
                      <span className="block text-[12.5px] text-mute">{p.sub}</span>
                    </span>
                    <ArrowRight className="size-4 text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div key="what" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="mt-6">
              <div className="grid grid-cols-2 gap-2.5">
                {(Object.keys(FRIENDLY) as RigKind[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => onDone(persona?.mode ?? "simple", k, true)}
                    className="group flex flex-col items-start gap-2 border border-line-2 bg-void p-4 text-left transition-colors hover:border-spec-1/60 hover:bg-panel-2"
                  >
                    <span className="text-spec-1 [&_svg]:h-8 [&_svg]:w-12">{RIG_ICON[k]}</span>
                    <span className="text-[15px] font-medium">{FRIENDLY[k].name}</span>
                    <span className="text-[12px] leading-snug text-mute">{FRIENDLY[k].blurb}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => onDone(persona?.mode ?? "simple", "describe", true)}
                className="mt-2.5 flex w-full items-center justify-center gap-2 border border-dashed border-line-2 px-4 py-3 text-[13px] text-mute transition-colors hover:border-spec-1/60 hover:text-fg"
              >
                <Sparkles className="size-4 text-spec-1" /> Or describe my own idea in words (or say it out loud)
              </button>
              <div className="mt-5 flex items-center justify-between">
                <button onClick={() => setStep(0)} className="mono-label flex items-center gap-1.5 text-[10px] text-dim hover:text-fg">
                  <ArrowLeft className="size-3" /> Back
                </button>
                <span className="text-[11.5px] text-dim">You can switch between Simple and Pro any time.</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Guided tour: spotlights elements marked with data-tour="…"
// ---------------------------------------------------------------------------

export interface TourStep {
  target: string;
  title: string;
  body: string;
}

export function tourSteps(mode: Mode, kind: RigKind): TourStep[] {
  const f = FRIENDLY[kind];
  return [
    { target: "robot", title: `This is your ${f.name.toLowerCase()}`, body: "Drag to spin it around and scroll to zoom. Click any part (a motor, the battery, the brain) to see what it does or swap it for another." },
    { target: "programs", title: "Pick what it should do", body: kind === "rover" ? "Drive straight up a ramp, a square, a figure-8 or a spin." : "Each button is a different mission. Try them all." },
    { target: "simulate", title: "Press Simulate", body: "Watch it move. Everything you see comes from real physics: the motors, the weight and the battery you chose." },
    {
      target: "parts",
      title: "Change the parts",
      body: mode === "simple" ? "Swap motors and batteries, or change the size and the load. The robot updates instantly." : "Swap parts, change dimensions, and tune the controller in the Control tab.",
    },
    {
      target: "coach",
      title: mode === "simple" ? "Robo checks your design" : "Design checks",
      body: mode === "simple" ? "If a part is too weak or a battery too big, I'll say so in plain words and fix it in one click. 'Make it better' tunes the robot for you." : "Electrical and mechanical rules with one-click fixes, plus the copilot that explains the response.",
    },
    {
      target: "mode",
      title: mode === "simple" ? "Ready for more?" : "Want it simpler?",
      body: mode === "simple" ? "Switch to Pro to see the graphs, the maths and the code that runs on the real robot." : "Simple mode hides the graphs and explains everything in plain words.",
    },
  ];
}

export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];
  useLayoutEffect(() => {
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [step.target]);
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      const r = el?.getBoundingClientRect() ?? null;
      setRect((prev) => (prev && r && prev.x === r.x && prev.y === r.y && prev.width === r.width && prev.height === r.height ? prev : r));
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((v) => Math.min(steps.length - 1, v + 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", key);
    };
  }, [step.target, steps.length, onClose]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const pad = 6;
  const box = rect ? { x: rect.x - pad, y: rect.y - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 } : null;
  const cardW = Math.min(340, vw - 32);
  // Put the card beside the target where there is room, otherwise below or above it.
  let left = vw / 2 - cardW / 2,
    top = vh / 2 - 90;
  if (box) {
    // Tall side panels get the card beside them, a little way down.
    const sideTop = box.h > vh * 0.5 ? box.y + 80 : box.y;
    if (box.x + box.w + cardW + 16 < vw && box.w < vw * 0.45) {
      left = box.x + box.w + 12;
      top = sideTop;
    } else if (box.x - cardW - 16 > 0 && box.w < vw * 0.45) {
      left = box.x - cardW - 12;
      top = sideTop;
    } else if (box.y + box.h + 200 < vh) {
      left = box.x + box.w / 2 - cardW / 2;
      top = box.y + box.h + 12;
    } else {
      left = box.x + box.w / 2 - cardW / 2;
      top = Math.max(16, box.y - 200);
    }
    if (box.h > vh * 0.6 && box.w > vw * 0.45) top = box.y + 40;
  }
  left = Math.max(16, Math.min(vw - cardW - 16, left));
  top = Math.max(16, Math.min(vh - 220, top));
  const last = i === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[95]" aria-live="polite">
      {/* Dim everything except the spotlight. */}
      {box ? (
        <motion.div
          className="pointer-events-none absolute rounded-[6px] border-2 border-spec-1"
          animate={{ left: box.x, top: box.y, width: box.w, height: box.h }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          style={{ boxShadow: "0 0 0 9999px rgb(4 5 6 / 0.72), 0 0 24px rgb(45 212 255 / 0.45)" }}
        />
      ) : (
        <div className="absolute inset-0 bg-void/70" />
      )}
      <div className="absolute inset-0" onClick={onClose} />
      <motion.div
        key={i}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute border border-spec-1/50 bg-panel p-4 shadow-2xl"
        style={{ left, top, width: cardW }}
        role="dialog"
        aria-label={step.title}
      >
        <p className="mono-label text-[10px] text-spec-1">
          Tour · {i + 1} / {steps.length}
        </p>
        <p className="mt-1 text-[15px] font-medium">{step.title}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-mute">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <button onClick={onClose} className="mono-label text-[10px] text-dim hover:text-fg">
            Skip tour
          </button>
          <div className="flex gap-1.5">
            {i > 0 && (
              <button onClick={() => setI(i - 1)} className="mono-label border border-line-2 px-2.5 py-1.5 text-[10px] text-mute hover:text-fg">
                Back
              </button>
            )}
            <button onClick={() => (last ? onClose() : setI(i + 1))} className="mono-label px-3 py-1.5 text-[10px] text-void" style={{ background: "var(--spectrum)" }}>
              {last ? "Let's go" : "Next"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simple mode: report card and coach
// ---------------------------------------------------------------------------

export interface ReportItem {
  key: string;
  label: string;
  ok: boolean;
  text: string;
}

/** The control specs and part checks, said in everyday words. */
export function report(model: LabModel, m: Metrics, specs: SpecCheck[], checks: DesignCheck[]): ReportItem[] {
  const kind = model.rig?.kind ?? "rover";
  const goal = FRIENDLY[kind].goal;
  const ref = Math.abs(model.sim.ref) || 1;
  const ss = (Math.abs(m.ssError) / ref) * 100;
  const pass = (k: string) => specs.find((s) => s.key === k)?.pass ?? false;
  const errors = checks.filter((c) => c.level === "error").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  if (!m.stable)
    return [
      { key: "stable", label: "Under control", ok: false, text: kind === "balancer" ? "It falls over. The robot can't keep itself upright." : "It's out of control: it wobbles more and more." },
      { key: "parts", label: "Safe parts", ok: errors === 0, text: errors ? `${errors} part problem${errors > 1 ? "s" : ""} to fix` : warns ? `${warns} thing${warns > 1 ? "s" : ""} to keep an eye on` : "All parts are safe" },
    ];
  return [
    { key: "reach", label: "Gets there", ok: pass("sserror"), text: pass("sserror") ? `Reaches ${goal}` : `Stops ${ss.toFixed(0)}% short of ${goal}` },
    {
      key: "smooth",
      label: "Smooth",
      ok: pass("overshoot"),
      text: pass("overshoot") ? (m.overshootPct < 1 ? "No swinging past the target" : "Only a tiny swing past the target") : `Swings ${m.overshootPct.toFixed(0)}% past ${goal}, like braking too late`,
    },
    {
      key: "quick",
      label: "Quick",
      ok: pass("settling"),
      text: m.settlingTime < 0 ? "Never quite settles" : pass("settling") ? `Settles in ${m.settlingTime.toFixed(1)} s` : `Takes ${m.settlingTime.toFixed(1)} s to settle (aim for ${model.specs.maxSettlingTime} s)`,
    },
    {
      key: "parts",
      label: "Safe parts",
      ok: errors === 0 && warns === 0,
      text: errors ? `${errors} part problem${errors > 1 ? "s" : ""} to fix` : warns ? `${warns} thing${warns > 1 ? "s" : ""} to keep an eye on` : "All parts are safe",
    },
  ];
}

export function ReportCard({ items, onImprove, busy }: { items: ReportItem[]; onImprove: () => void; busy: boolean }) {
  const allOk = items.every((r) => r.ok);
  const score = items.filter((r) => r.ok).length;
  return (
    <div className="border-t border-line bg-void/85 px-3 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className={`mono-label text-[10px] ${allOk ? "text-ok" : "text-mute"}`}>
          Report card · {score}/{items.length} {allOk ? "· great job!" : ""}
        </span>
        {items.map((r) => (
          <span key={r.key} className="flex items-center gap-1.5 text-[12px]" title={r.text}>
            {r.ok ? <CheckCircle2 className="size-3.5 text-ok" /> : <AlertTriangle className="size-3.5 text-warn" />}
            <span className={r.ok ? "text-fg" : "text-warn"}>{r.label}</span>
          </span>
        ))}
        {!allOk && (
          <button onClick={onImprove} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium text-void disabled:opacity-60" style={{ background: "var(--spectrum)" }}>
            <Wand2 className="size-3.5" /> {busy ? "Working…" : "Make it better"}
          </button>
        )}
      </div>
    </div>
  );
}

export function CoachPanel({
  hw,
  items,
  checks,
  onBuild,
  onSelect,
  onImprove,
  busy,
  lastNote,
}: {
  hw: DerivedHardware;
  items: ReportItem[];
  checks: DesignCheck[];
  onBuild: (b: HardwareBuild, note: string) => void;
  onSelect: (s: SlotId | null) => void;
  onImprove: () => void;
  busy: boolean;
  lastNote: string | null;
}) {
  const issues = checks.filter((c) => c.level === "error" || c.level === "warn");
  const motionOk = items.filter((r) => r.key !== "parts").every((r) => r.ok);
  const allOk = items.every((r) => r.ok);
  const mood = allOk ? "Your robot works great! Try a different mission or swap a part to see what changes." : issues.some((c) => c.level === "error") ? "Some parts won't work together yet. Fix those first." : motionOk ? "It moves nicely, but a few parts need attention." : "The parts are fine. The robot just needs better tuning.";
  return (
    <div className="space-y-3 p-3">
      <div className={`flex gap-3 border px-3 py-3 ${allOk ? "border-ok/40 bg-ok/[0.06]" : "border-line-2 bg-panel"}`}>
        <motion.div animate={allOk ? { rotate: [0, -8, 8, 0] } : { y: [0, -2, 0] }} transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1 }}>
          <RoboMark className="size-9" />
        </motion.div>
        <div>
          <p className="text-[11px] text-dim">Robo says</p>
          <p className="text-[13.5px] leading-snug">{lastNote ?? mood}</p>
        </div>
      </div>

      <ul className="space-y-1.5">
        {items.map((r) => (
          <li key={r.key} className="flex items-start gap-2.5 border border-line bg-panel/60 px-3 py-2">
            {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />}
            <span>
              <span className="block text-[13px] font-medium">{r.label}</span>
              <span className="block text-[12px] text-mute">{r.text}</span>
            </span>
          </li>
        ))}
      </ul>

      {!motionOk && (
        <button onClick={onImprove} disabled={busy} className="flex w-full items-center justify-center gap-2 py-2.5 text-[13px] font-medium text-void disabled:opacity-60" style={{ background: "var(--spectrum)" }}>
          <Wand2 className="size-4" /> {busy ? "Robo is tuning…" : "Make it better"}
        </button>
      )}

      {issues.length > 0 && (
        <div>
          <p className="mono-label pb-1.5 text-[10px] text-mute">Things to fix</p>
          <ul className="space-y-1.5">
            {issues.map((c) => (
              <li key={c.id} className="border border-line bg-panel/60 px-3 py-2">
                <button onClick={() => c.slot && onSelect(c.slot)} className="flex w-full items-start gap-2 text-left">
                  {c.level === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-bad" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />}
                  <span className="text-[12.5px] leading-snug">{c.title}</span>
                </button>
                {c.fix && (
                  <button
                    onClick={() => onBuild({ ...hw.build, parts: { ...hw.build.parts, ...c.fix!.parts }, geom: { ...hw.build.geom, ...c.fix!.geom } }, `fix: ${c.fix!.label}`)}
                    className="mono-label mt-1.5 ml-6 inline-flex items-center gap-1 border border-spec-1/40 px-1.5 py-1 text-[10px] text-spec-1 hover:bg-spec-1/10"
                  >
                    <Wand2 className="size-3" /> Fix it: {c.fix.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {hw.stats.map((s) => (
          <div key={s.label} className="border border-line bg-panel px-3 py-2">
            <p className="text-[11px] text-dim">{s.label}</p>
            <p className={`mt-0.5 font-mono text-[16px] tabular-nums ${s.tone === "bad" ? "text-bad" : s.tone === "warn" ? "text-warn" : ""}`}>{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
