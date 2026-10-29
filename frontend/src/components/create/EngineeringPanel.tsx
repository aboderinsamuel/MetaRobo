"use client";

// Engineering for an AI-designed robot, in four views: Overview (is it feasible and electrically
// safe, with every check and what was auto-fixed), Mechanics (each joint's load against its
// actuator, with one-click upsizing to real parts), Electronics (bus voltage, current, battery,
// protection, wiring) and Code (firmware generated from the simulated motion, plus exports).
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, Cpu, Download, FileCode2, Info, Sparkles, Wand2, Wrench, XCircle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { Design } from "@/lib/create/design";
import { arduinoSketch, overview, ros2Node, upsizeActuators, type Check } from "@/lib/create/engineering";
import { billOfMaterials, download, toUrdf } from "@/lib/create/export";
import type { Recording } from "@/lib/create/sim";
import { BasisBadge, Button, SectionTitle, Segmented, cx } from "./ui";

type View = "overview" | "mechanics" | "electronics" | "code";

const SEV: Record<Check["severity"], ReactNode> = {
  error: <XCircle className="size-4 text-bad" />,
  warning: <AlertTriangle className="size-4 text-warn" />,
  info: <Info className="size-4 text-[#0284c7] dark:text-[#38bdf8]" />,
  pass: <CheckCircle2 className="size-4 text-ok" />,
};
const ORDER = { error: 0, warning: 1, info: 2, pass: 3 } as const;

function CheckRow({ c }: { c: Check }) {
  const [open, setOpen] = useState(c.severity === "error");
  return (
    <li className="rounded-xl bg-surface-2/60">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left">
        <span className="mt-px shrink-0">{SEV[c.severity]}</span>
        <span className="flex-1 text-[13px] leading-snug">{c.title}</span>
        {c.autoFixed && (
          <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 text-[10.5px] font-semibold text-accent">
            <Wand2 className="size-3" /> auto-fixed
          </span>
        )}
        <ChevronDown className={cx("mt-0.5 size-3.5 shrink-0 text-dim transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3 pl-9 text-[12.5px] leading-relaxed text-mute">
          <p>{c.detail}</p>
          {c.fix && (
            <p className="rounded-lg bg-surface px-2.5 py-1.5 text-fg">
              <span className="font-semibold text-accent">What to do: </span>
              {c.fix}
            </p>
          )}
          <BasisBadge basis={c.basis === "estimate" ? "ai" : c.basis} />
        </div>
      )}
    </li>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="rounded-2xl bg-surface-2/70 px-3.5 py-3">
      <p className="text-[11.5px] text-mute">{label}</p>
      <p className={cx("mt-0.5 text-[18px] font-semibold tabular-nums", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-dim">{sub}</p>}
    </div>
  );
}

function CodeBlock({ code, filename }: { code: string; filename: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl bg-[#0d1117] text-[#e6edf3]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="font-mono text-[11.5px] text-white/60">{filename}</span>
        <div className="flex gap-1">
          <button
            onClick={() => {
              void navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11.5px] text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Copy className="size-3.5" /> {copied ? "Copied" : "Copy"}
          </button>
          <button onClick={() => download(filename, code, "text/plain")} className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11.5px] text-white/70 hover:bg-white/10 hover:text-white">
            <Download className="size-3.5" /> Download
          </button>
        </div>
      </div>
      <pre className="max-h-[420px] overflow-auto p-3 font-mono text-[11.5px] leading-relaxed [scrollbar-width:thin]">{code}</pre>
    </div>
  );
}

export default function EngineeringPanel({ design, recording, onApply, onSelect }: { design: Design; recording: Recording | null; onApply: (d: Design, what: string) => void; onSelect: (id: string) => void }) {
  const [view, setView] = useState<View>("overview");
  const [filter, setFilter] = useState<"all" | "issues" | "auto">("all");
  const [lang, setLang] = useState<"ros2" | "arduino">("ros2");
  const o = useMemo(() => overview(design, recording), [design, recording]);
  const fixable = o.loads.filter((l) => l.upgrade);

  if (!recording) return <p className="text-[13px] text-mute">Simulating; the engineering report appears when it finishes.</p>;

  const verdict = o.errors ? { cls: "bg-bad/8 ring-bad/30", icon: <XCircle className="size-5 text-bad" />, title: `Not buildable yet: ${o.errors} blocking issue${o.errors > 1 ? "s" : ""}` } : o.warnings ? { cls: "bg-warn/8 ring-warn/30", icon: <AlertTriangle className="size-5 text-warn" />, title: `Buildable, with ${o.warnings} warning${o.warnings > 1 ? "s" : ""}` } : { cls: "bg-ok/8 ring-ok/30", icon: <CheckCircle2 className="size-5 text-ok" />, title: "Design is feasible and electrically safe" };
  const shown = [...o.checks].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]).filter((c) => (filter === "all" ? true : filter === "auto" ? c.autoFixed : c.severity === "error" || c.severity === "warning"));
  const e = o.elec;

  return (
    <div className="space-y-5">
      <Segmented
        size="sm"
        value={view}
        onChange={setView}
        className="w-full"
        options={[
          { id: "overview", label: "Overview", icon: <Sparkles className="size-3.5" /> },
          { id: "mechanics", label: "Mechanics", icon: <Wrench className="size-3.5" /> },
          { id: "electronics", label: "Electronics", icon: <Cpu className="size-3.5" /> },
          { id: "code", label: "Code", icon: <FileCode2 className="size-3.5" /> },
        ]}
      />

      {view === "overview" && (
        <>
          <div className={cx("rounded-2xl px-4 py-3.5 ring-1", verdict.cls)}>
            <p className="flex items-center gap-2.5 text-[14.5px] font-semibold">
              {verdict.icon}
              {verdict.title}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5 pl-7.5">
              <span className="rounded-full bg-ok/12 px-2 py-0.5 text-[11px] font-semibold text-ok">{o.passed} passed</span>
              {o.autoFixes > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
                  <Wand2 className="size-3" /> {o.autoFixes} safety fix{o.autoFixes > 1 ? "es" : ""} applied
                </span>
              )}
              {fixable.length > 0 && (
                <button onClick={() => onApply(upsizeActuators(design, o.loads), `Fixed ${fixable.length} overloaded joint${fixable.length > 1 ? "s" : ""}`)} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-accent-fg hover:brightness-110">
                  <Wrench className="size-3" /> Fix {fixable.length} overloaded joint{fixable.length > 1 ? "s" : ""}
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Actuators priced" value={o.cost ? `$${o.cost.toLocaleString()}` : "–"} sub={`${o.costed} of ${o.loads.length} from datasheets`} />
            <Stat label="Total mass" value={`${recording.massKg.toFixed(1)} kg`} sub={`+ ${e.battery.massKg.toFixed(1)} kg battery`} />
            <Stat label="Peak draw" value={`${e.peakA.toFixed(1)} A`} sub={`at ${e.busVolts} V · fuse ${e.fuseA} A`} tone={e.peakA > 60 ? "warn" : undefined} />
            <Stat label="Runtime" value={`${Math.round(e.runtimeMin)} min`} sub={`${Math.round(e.avgW)} W average`} tone={e.runtimeMin < 20 ? "warn" : "ok"} />
          </div>
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-[12px] font-semibold tracking-wide text-mute uppercase">Design checks</h3>
              <Segmented
                size="sm"
                value={filter}
                onChange={setFilter}
                options={[
                  { id: "all", label: `All ${o.checks.length}` },
                  { id: "issues", label: "Issues" },
                  { id: "auto", label: "Auto-fixes" },
                ]}
              />
            </div>
            <ul className="space-y-1.5">
              {shown.map((c) => (
                <CheckRow key={c.id} c={c} />
              ))}
              {!shown.length && <p className="px-1 text-[12.5px] text-mute">Nothing here.</p>}
            </ul>
          </section>
        </>
      )}

      {view === "mechanics" && (
        <>
          <section>
            <SectionTitle
              action={
                fixable.length > 0 && (
                  <Button size="sm" variant="primary" onClick={() => onApply(upsizeActuators(design, o.loads), `Fixed ${fixable.length} overloaded joint${fixable.length > 1 ? "s" : ""}`)}>
                    <Wrench className="size-3.5" /> Fix all {fixable.length}
                  </Button>
                )
              }
            >
              Joint loads vs actuators
            </SectionTitle>
            <p className="mb-3 text-[12px] leading-relaxed text-mute">Peak holding torque measured in the simulation (link masses and what it carried, standing legs carrying the body) against each actuator&apos;s continuous rating.</p>
            <ul className="space-y-2">
              {[...o.loads]
                .sort((a, b) => (b.ratedNm ? b.peakNm / b.ratedNm : 9) - (a.ratedNm ? a.peakNm / a.ratedNm : 9))
                .map((l) => {
                  const r = l.ratedNm > 0 ? l.peakNm / l.ratedNm : 1;
                  return (
                    <li key={l.node.id} className="rounded-xl bg-surface-2/60 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => onSelect(l.node.id)} className="min-w-0 text-left">
                          <p className="truncate text-[13px] font-medium">{l.node.name}</p>
                          <p className="truncate text-[11.5px] text-mute">{l.actuator ? `${l.actuator.name} · ${l.actuator.source}` : l.node.joint.actuator.replace(/^need:/, "") || "no actuator named"}</p>
                        </button>
                        <span className="shrink-0 text-right text-[12px] tabular-nums">
                          {l.peakNm.toFixed(1)} / {l.ratedNm ? l.ratedNm.toFixed(1) : "?"} N·m
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-surface">
                        <div className={cx("h-full rounded-full", l.status === "over" ? "bg-bad" : l.status === "tight" ? "bg-warn" : l.status === "unrated" ? "bg-dim" : "bg-ok")} style={{ width: `${Math.min(100, r * 100)}%` }} />
                      </div>
                      {l.upgrade && (
                        <button onClick={() => onApply(upsizeActuators(design, o.loads, l.node.id), `Upsized ${l.node.name} to ${l.upgrade!.name}`)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-accent-soft px-2 py-1 text-[11.5px] font-medium text-accent hover:bg-accent hover:text-accent-fg">
                          <Wrench className="size-3" /> Use {l.upgrade.name} ({l.upgrade.ratedNm} N·m rated, {l.upgrade.massKg} kg)
                        </button>
                      )}
                      {(l.status === "over" || l.status === "unrated") && !l.upgrade && <p className="mt-1.5 text-[11.5px] text-bad">No single actuator in the library holds {l.peakNm.toFixed(0)} N·m: add a gearbox or shorten the lever.</p>}
                    </li>
                  );
                })}
            </ul>
          </section>
          <section>
            <SectionTitle>Mobility</SectionTitle>
            <p className="text-[13px]">
              {design.robot.mobility === "fixed" ? "Fixed base." : `${design.robot.mobility[0].toUpperCase()}${design.robot.mobility.slice(1)}, ${design.robot.speed} m/s.`} {design.robot.mobility === "legs" ? "Walking is a kinematic gait in the simulation, not balance-controlled." : ""}
            </p>
          </section>
        </>
      )}

      {view === "electronics" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Bus voltage" value={`${e.busVolts} V`} sub={`${e.domains.length} domain${e.domains.length > 1 ? "s" : ""}`} />
            <Stat label="Peak / average" value={`${e.peakA.toFixed(1)} A`} sub={`${e.avgA.toFixed(1)} A average`} />
            <Stat label="Battery" value={`${Math.round(e.battery.wh)} Wh`} sub={e.battery.name} />
            <Stat label="Runtime" value={`${Math.round(e.runtimeMin)} min`} sub={`${Math.round(e.avgW)} W average`} tone={e.runtimeMin < 20 ? "warn" : "ok"} />
          </div>
          <section>
            <SectionTitle>Power tree</SectionTitle>
            <ol className="space-y-1.5 text-[12.5px]">
              <li className="rounded-xl bg-surface-2/60 px-3 py-2">
                <span className="font-medium">{e.battery.name}</span> → {e.fuseA} A fuse → E-stop → {e.busVolts} V bus ({e.awg} AWG)
              </li>
              {e.domains.map((dm) => (
                <li key={dm.volts} className="rounded-xl bg-surface-2/60 px-3 py-2">
                  <span className="font-medium">{dm.volts} V</span> · {dm.loads.length} actuator{dm.loads.length > 1 ? "s" : ""}: <span className="text-mute">{dm.loads.slice(0, 6).join(", ")}{dm.loads.length > 6 ? "…" : ""}</span>
                </li>
              ))}
              {e.converters.map((c) => (
                <li key={c} className="rounded-xl bg-accent-soft/60 px-3 py-2 text-accent">
                  <Wand2 className="mr-1 inline size-3" /> {c}
                </li>
              ))}
            </ol>
          </section>
          <section>
            <SectionTitle>Electrical checks</SectionTitle>
            <ul className="space-y-1.5">
              {e.checks.map((c) => (
                <CheckRow key={c.id} c={c} />
              ))}
            </ul>
          </section>
          <section>
            <SectionTitle>Bill of materials</SectionTitle>
            <ul className="divide-y divide-line">
              {billOfMaterials(design).map((l) => (
                <li key={l.part} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[13px] leading-snug">{l.part}</p>
                    <p className="truncate text-[11.5px] text-mute">{l.where}</p>
                  </div>
                  <p className="shrink-0 text-[12.5px] tabular-nums">×{l.qty}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {view === "code" && (
        <>
          <Segmented
            size="sm"
            value={lang}
            onChange={setLang}
            options={[
              { id: "ros2", label: "ROS 2 (Python)" },
              { id: "arduino", label: "Arduino · servos" },
            ]}
          />
          <p className="text-[12px] leading-relaxed text-mute">{lang === "ros2" ? "A JointTrajectory with one waypoint per task step, timed like the simulation. Joint names match the URDF export." : "For hobby-servo builds on a PCA9685: each task step eases every servo to its simulated angle."}</p>
          <CodeBlock code={lang === "ros2" ? ros2Node(design, recording) : arduinoSketch(design, recording)} filename={lang === "ros2" ? `${design.title.replace(/\W+/g, "_").toLowerCase()}_task.py` : `${design.title.replace(/\W+/g, "_")}.ino`} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => download(`${design.title.replace(/\W+/g, "_")}.urdf`, toUrdf(design))}>
              <FileCode2 className="size-4" /> URDF
            </Button>
            <Button size="sm" onClick={() => download(`${design.title.replace(/\W+/g, "_")}.json`, JSON.stringify(design, null, 2), "application/json")}>
              <Download className="size-4" /> Design JSON
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
