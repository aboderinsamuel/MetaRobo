"use client";

// Coach panel, report card and live scope for AI-designed machines. Everything here comes from the
// machine's own parts and per-actuator simulation, never from the preset robots' scaffold.
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, Info, Sparkles, XCircle } from "lucide-react";
import { useState } from "react";
import type { MachineCheck, MachineSim } from "@/lib/lab/actuation";
import { behaviourIndex, type BehaviourSim } from "@/lib/lab/behaviour";
import { totalMassG, totalPriceUsd, type Assembly } from "@/lib/lab/assembly";
import type { Playback } from "@/lib/lab/playback";
import { TimeChart } from "./charts";

const ICON = { pass: CheckCircle2, info: Info, warn: AlertTriangle, error: XCircle };
const CLS = { pass: "text-ok", info: "text-spec-1", warn: "text-warn", error: "text-bad" };
const COLORS = ["#2dd4ff", "#9b5cff", "#ff5ca8", "#4ade80", "#ffb020", "#7fd4ff"];

// Behaviour plays on an event-aware clock; charts need evenly spaced playback time.
const PLAY_DT = 0.05;
function onPlaybackTime(b: BehaviourSim, v: Float32Array): Float32Array {
  const n = Math.ceil(b.duration / PLAY_DT) + 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v[behaviourIndex(b, i * PLAY_DT)];
  return out;
}

/** Group checks into the four things a builder cares about. */
function areas(checks: MachineCheck[]) {
  const pick = (re: RegExp) => checks.filter((c) => re.test(c.id));
  const worst = (cs: MachineCheck[]) => (cs.some((c) => c.level === "error") ? "error" : cs.some((c) => c.level === "warn") ? "warn" : "pass");
  return [
    { label: "Strong enough", level: worst(pick(/^torque|^limb/)) },
    { label: "Fast enough", level: worst(pick(/^late|^range/)) },
    { label: "Powered right", level: worst(pick(/^power|^current|^voltage/)) },
    { label: "Wired right", level: worst(pick(/controller|driver|unresolved|fit|duplicate/)) },
  ] as const;
}

export function MachineCoach({ assembly, sim, onSelect, onFix }: { assembly: Assembly; sim: MachineSim; onSelect: (id: string) => void; onFix?: (check: MachineCheck) => void }) {
  const errors = sim.checks.filter((c) => c.level === "error");
  const warns = sim.checks.filter((c) => c.level === "warn");
  const runtime = sim.checks.find((c) => c.id === "runtime");
  const mass = totalMassG(assembly);
  return (
    <div className="space-y-4 p-4">
      <div className={`rounded-xl border px-3 py-2.5 ${errors.length ? "border-bad/40 bg-bad/5" : warns.length ? "border-warn/40 bg-warn/5" : "border-ok/40 bg-ok/5"}`}>
        <p className="text-[13px] font-medium">
          {errors.length ? `${errors.length} thing${errors.length > 1 ? "s" : ""} to fix before you build it` : warns.length ? `Buildable, with ${warns.length} thing${warns.length > 1 ? "s" : ""} to watch` : "Ready to build: every part checks out"}
        </p>
        <p className="mt-1 text-[11.5px] text-mute">Checked against each part&apos;s real ratings while the motion program runs.</p>
      </div>
      <div className="grid grid-cols-2 gap-px border border-line bg-line rounded-xl">
        {[
          ["Parts cost", `$${totalPriceUsd(assembly).toFixed(2)}`],
          ["Total mass", mass >= 1000 ? `${(mass / 1000).toFixed(2)} kg` : `${Math.round(mass)} g`],
          ["Peak current", `${sim.peakA.toFixed(2)} A`],
          ["Runtime", runtime ? runtime.title.replace("Runtime ≈ ", "") : "mains / —"],
        ].map(([k, v]) => (
          <div key={k} className="bg-void px-3 py-2">
            <p className="mono-label text-[9px] text-dim">{k}</p>
            <p className="mt-0.5 font-mono text-[14px]">{v}</p>
          </div>
        ))}
      </div>
      <ul className="space-y-2.5">
        {sim.checks.map((c) => {
          const Icon = ICON[c.level];
          return (
            <li key={c.id} className="text-[12px]">
              <button disabled={!c.part} onClick={() => c.part && onSelect(c.part)} className={`flex items-start gap-1.5 text-left ${CLS[c.level]} ${c.part ? "cursor-pointer hover:underline" : "cursor-default"}`}>
                <Icon className="mt-0.5 size-3.5 shrink-0" />
                <span className="text-fg">{c.title}</span>
              </button>
              <p className="pl-5 leading-snug text-dim">{c.detail}</p>
              {c.level !== "pass" && onFix && (
                <button type="button" onClick={() => onFix(c)} className="ml-5 mt-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line-2 px-2 py-1 text-[11px] text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  <Sparkles className="size-3" /> Diagnose & fix with Robo Copilot
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The 3D view's bottom strip in Simple mode: four plain-language verdicts. */
export function MachineReport({ sim }: { sim: MachineSim }) {
  const a = areas(sim.checks);
  const ok = a.filter((x) => x.level === "pass").length;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-void/85 px-3 py-2 backdrop-blur">
      <span className="mono-label text-[10px] text-mute">
        Report card · {ok}/4 {ok === 4 ? "· ready to build" : ""}
      </span>
      {a.map((x) => {
        const Icon = ICON[x.level];
        return (
          <span key={x.label} className={`flex items-center gap-1 text-[12px] ${CLS[x.level]}`}>
            <Icon className="size-3.5" /> <span className="text-fg">{x.label}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Pro mode's live scope: every joint's position and the total current, from the actuator simulation. */
export function MachineScope({ sim, playback, simKey }: { sim: MachineSim; playback: Playback; simKey: number }) {
  const [open, setOpen] = useState(true);
  const angular = sim.traces.filter((t) => t.joint.kind === "rotate" || t.joint.kind === "articulate");
  return (
    <div className="border-t border-line bg-void/80 backdrop-blur">
      <button onClick={() => setOpen((v) => !v)} className="mono-label flex w-full items-center justify-between px-3 py-1 text-[9.5px] text-dim hover:text-mute">
        <span className="flex items-center gap-2">
          <Activity className="size-3" /> Live scope · {sim.traces.length} joints · peak {sim.peakA.toFixed(2)} A
        </span>
        <ChevronDown className={`size-3 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-px px-1 pb-1 sm:grid-cols-2">
          {angular.length || !sim.behaviour ? (
            <TimeChart
              className="h-[104px]"
              animateKey={`m-${simKey}`}
              playback={playback}
              yLabel="joint angle [°]"
              series={angular.map((t, i) => ({ y: t.joint.kind === "articulate" ? Array.from(t.value, (v) => v * 90) : t.value, dt: sim.dt, color: COLORS[i % COLORS.length], label: t.joint.id, width: 1.5 }))}
            />
          ) : (
            <TimeChart
              className="h-[104px]"
              animateKey={`s-${simKey}`}
              playback={playback}
              yLabel={sim.behaviour.signals.map((s) => `${s.name} [${s.unit}]`).join(" · ")}
              series={sim.behaviour.signals.map((s, i) => ({ y: onPlaybackTime(sim.behaviour!, s.value), dt: PLAY_DT, color: COLORS[i % COLORS.length], label: s.id, width: 1.6 }))}
            />
          )}
          <TimeChart
            className="hidden h-[104px] sm:block"
            animateKey={`c-${simKey}`}
            playback={playback}
            yLabel="total current [A]"
            series={[{ y: sim.totalCurrent, dt: sim.dt, color: "#ffb020", label: "current", width: 1.3 }]}
          />
        </div>
      )}
    </div>
  );
}
