"use client";

import { motion } from "motion/react";
import { useState } from "react";
import ControlLoop from "./ControlLoop";

// Which Meta model does what, mapped onto the control loop. Status is honest: "Live" means it runs
// in the app today; "In build" means it is being built during the hackathon.
const MODELS: { stage: string; name: string; id: string; role: string; meta: boolean; live: boolean }[] = [
  { stage: "sense", name: "SAM 3.1", id: "sam-3.1", role: "Tracks your real robot frame by frame in a phone video, so we can measure how it actually moves.", meta: true, live: false },
  { stage: "sense", name: "Muse Voice Transcribe", id: "muse-voice-transcribe-1.0", role: "Describe your machine out loud instead of typing.", meta: true, live: false },
  { stage: "think", name: "Muse Spark 1.3", id: "muse-spark-1.3", role: "Turns a sentence into a physics model and a starting controller, then explains every simulation and proposes fixes.", meta: true, live: true },
  { stage: "think", name: "Muse Spark · vision", id: "muse-spark-1.3", role: "Reads the video scene: what kind of robot, a known-size object for scale, which part moves.", meta: true, live: false },
  { stage: "check", name: "PlantSim engine", id: "C++17 → WebAssembly", role: "Our physics engine. Every AI suggestion is simulated and must pass the specs before you ever see it.", meta: false, live: true },
  { stage: "act", name: "Firmware generator", id: "Arduino · ESP32", role: "Writes the controller with the verified gains, ready to flash onto your robot.", meta: false, live: true },
];

export default function MetaStack() {
  const [stage, setStage] = useState("think");
  return (
    <section id="meta" className="relative overflow-hidden border-b border-line">
      <div className="meta-aurora pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1440px] px-4 py-24 sm:px-6 sm:py-32">
        <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="mono-label text-mute">·· Powered by Meta Muse</p>
            <h2 className="mt-4 max-w-3xl text-[clamp(2rem,4.6vw,3.8rem)] leading-[1.02] font-semibold tracking-[-0.03em]">
              Meta&apos;s models, wired into <span className="text-spectrum">one closed loop</span>.
            </h2>
          </div>
          <p className="max-w-sm text-[15px] leading-relaxed text-mute">
            A controller is a loop: sense, think, check, act, repeat. RoboCraft gives each step to the model that does it best, and nothing
            the AI says reaches your robot until the physics engine has checked it.
          </p>
        </div>

        <motion.div
          className="mx-auto mt-16 max-w-4xl px-2 sm:px-10"
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{ duration: 0.9, ease: [0.6, 0, 0.2, 1] }}
        >
          <ControlLoop onStage={setStage} className="py-10" />
        </motion.div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {MODELS.map((m, i) => {
            const on = m.stage === stage;
            return (
              <motion.div
                key={m.name}
                className={`relative bg-void p-6 transition-colors duration-500 ${on ? "bg-panel-2" : ""}`}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
              >
                <span
                  className="absolute inset-x-0 top-0 h-px transition-opacity duration-500"
                  style={{ background: "var(--spectrum)", opacity: on ? 1 : 0 }}
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="mono-label text-[10px] text-dim">{m.stage}</span>
                  {m.live ? (
                    <span className="mono-label flex items-center gap-1.5 text-[10px] text-ok">
                      <span className="size-1.5 rounded-full bg-ok" /> Live
                    </span>
                  ) : (
                    <span className="mono-label text-[10px] text-warn">In build</span>
                  )}
                </div>
                <p className="mt-4 text-lg font-semibold tracking-tight">{m.name}</p>
                <p className="mt-0.5 font-mono text-[11px] text-mute">
                  {m.meta ? "Meta · " : "RoboCraft · "}
                  {m.id}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-mute">{m.role}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
