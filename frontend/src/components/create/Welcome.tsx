"use client";

// First visit to Create: Robo explains the three steps and offers the fastest way in, a
// ready-made robot that opens instantly (no AI call), or describing your own. A guided tour of
// the studio follows the first robot that opens. The tour steps spotlight [data-tour] elements.
import { ArrowRight, PenLine, X } from "lucide-react";
import { motion } from "motion/react";
import RoboMark from "@/components/brand/RoboMark";
import type { TourStep } from "@/components/lab/onboarding";
import { EXAMPLES } from "@/lib/create/examples";
import { cx } from "./ui";

export const WELCOMED_KEY = "rc-create-welcomed";
export const TOURED_KEY = "rc-create-toured";

export function seen(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return true;
  }
}

export function markSeen(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Storage blocked: the welcome may show again next time, which is harmless.
  }
}

const STEPS = [
  { n: "1", title: "Describe it", body: "Type, say or film the robot and the job it should do." },
  { n: "2", title: "Watch it work", body: "A 3D design with real joints, simulated doing the task in real physics." },
  { n: "3", title: "Build it for real", body: "Open it in the Control Lab: real parts inside, checks, wiring and firmware." },
];

export function CreateWelcome({ live, onExample, onDescribe, onClose }: { live: boolean; onExample: (id: string) => void; onDescribe: () => void; onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-[90] flex items-center justify-center bg-void/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-welcome-title"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="relative max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-3xl bg-surface p-6 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.5),0_0_0_1px_var(--color-line)] sm:p-7"
      >
        <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-lg text-mute hover:bg-surface-2 hover:text-fg">
          <X className="size-4" />
        </button>
        <div className="flex items-center gap-3">
          <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 2.4, repeat: Infinity }}>
            <RoboMark className="size-11" />
          </motion.div>
          <div>
            <p className="text-[12px] text-mute">Welcome to Create</p>
            <h2 id="create-welcome-title" className="text-xl font-semibold tracking-tight sm:text-2xl">
              Hi, I&apos;m Robo. Let&apos;s make a robot.
            </h2>
          </div>
        </div>

        <ol className="mt-6 grid gap-2 sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-2xl bg-surface-2 p-3.5">
              <span className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{s.n}</span>
              <p className="mt-2 text-[13.5px] font-medium">{s.title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-mute">{s.body}</p>
            </li>
          ))}
        </ol>

        <p className="mt-6 text-[13px] font-medium">Start with a ready-made robot</p>
        <p className="text-[12px] text-mute">Opens instantly. I&apos;ll show you around once it&apos;s on screen.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {EXAMPLES.map((e, i) => (
            <button
              key={e.id}
              onClick={() => onExample(e.id)}
              className={cx(
                "group flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors",
                i === 0 ? "bg-accent-soft shadow-[0_0_0_1px_var(--color-accent)]" : "bg-surface-2 hover:shadow-[0_0_0_1px_var(--color-line-2)]",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium">{e.title}</span>
                <span className="block truncate text-[12px] text-mute">{e.blurb}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
            </button>
          ))}
        </div>

        <button onClick={onDescribe} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line-2 px-4 py-3 text-[13px] text-mute transition-colors hover:text-fg">
          <PenLine className="size-4" /> Or describe my own robot
        </button>
        {!live && <p className="mt-3 text-center text-[12px] text-dim">New designs are paused on this demo right now, so the ready-made robots are the way in.</p>}
      </motion.div>
    </motion.div>
  );
}

/** The studio tour, shown after the first robot opens and from the help button. */
export function createTour(): TourStep[] {
  return [
    { target: "viewport", title: "Your robot, in its world", body: "Drag to orbit, scroll to zoom. Click any part of the robot or the scene to inspect and edit it." },
    { target: "views", title: "Look inside", body: "Skin shows the finished robot. Skeleton shows its joints and how they bend. Skin + Rig shows both." },
    { target: "cameras", title: "Camera angles", body: "Jump to the front, side or top, or frame the whole scene." },
    { target: "timeline", title: "Watch it do the job", body: "Every step of the task is simulated with real physics. Each mark on the timeline is a step: scrub through it, replay it, or slow it down." },
    { target: "tabs", title: "Make it yours", body: "Change it by describing what you want, Edit any part by hand, follow each step in Task, and see joint loads and motors in Engineer." },
    { target: "versions", title: "Nothing gets lost", body: "Every change is a new version. Step back and forth, and see the full history of what you asked for." },
    { target: "lab", title: "Build it for real", body: "Open it in the Control Lab: the same body with real motors, a board and a battery inside, checked against their ratings, with wiring and firmware." },
  ];
}
