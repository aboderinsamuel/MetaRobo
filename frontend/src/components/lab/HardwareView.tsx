"use client";

// Live 3D hardware: the machine built from the selected parts, driven by the simulation. Click a
// part to inspect or swap it; parts that fail a design check glow and show what's wrong.
import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { AlertTriangle, CheckCircle2, Info, Pause, Play, RotateCcw, Tag, Wand2, X, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtNum } from "@/lib/lab/analysis";
import { SLOTS } from "@/lib/lab/hardware/build";
import type { CheckLevel, DesignCheck, DerivedHardware, HardwareBuild, Telemetry } from "@/lib/lab/hardware/build";
import type { SlotId } from "@/lib/lab/hardware/parts";
import { RIGS, displayScale, integrate, tiltFromPosition } from "@/lib/lab/rig";
import { usePlayback } from "@/lib/lab/playback";
import type { Playback } from "@/lib/lab/playback";
import { segmentAt } from "@/lib/lab/programs";
import type { ProgramDef, ProgramRun } from "@/lib/lab/programs";
import type { LabModel } from "@/lib/lab/types";
import { Scene } from "./hw3d/parts3d";
import type { PartStatus, SceneCtx } from "./hw3d/parts3d";
import MachineRig, { gizmoActive, type GizmoMode } from "./hw3d/machine";
import { at, simulateMachine, type MachineSim } from "@/lib/lab/actuation";
import { VERDICT_UI } from "./ReviewCard";
import { bomTotal } from "@/lib/lab/review";
import { ArmRig, BalancerRig, DroneRig, RoverRig } from "./hw3d/rigs";
import type { Motion } from "./hw3d/rigs";

/** Calls `onFrame` from inside the render loop; the owner of the clock advances it there. */
function Driver({ onFrame }: { onFrame: (delta: number) => void }) {
  useFrame((_, delta) => onFrame(delta));
  return null;
}

function camera(hw: DerivedHardware): { pos: [number, number, number]; target: [number, number, number] } {
  const g = hw.build.geom;
  switch (hw.build.kind) {
    case "rover": {
      const s = Math.max(g.chassisL, g.chassisW) * 1.35 + 0.08;
      return { pos: [s * 0.75, s * 0.7, s * 1.35], target: [s * 0.12, 0.03, 0] };
    }
    case "arm": {
      const R = g.upper + g.fore;
      return { pos: [R * 1.5, g.shoulderH + R * 1.45, R * 2.6], target: [-0.03, g.shoulderH * 0.85, 0] };
    }
    case "balancer": {
      const H = g.comH * 2 + g.wheelD;
      return { pos: [H * 1.25 + 0.15, H * 0.95, H * 1.9 + 0.2], target: [0.12, H * 0.45, 0] };
    }
    default: {
      const arm = hw.prop?.armM ?? 0.2;
      const S = arm * 2 + 0.15;
      const y0 = 0.05 + arm * 0.15 + 0.05;
      return { pos: [S * 1.1, y0 + S * 0.55, S * 1.7], target: [0, y0, 0] };
    }
  }
}

const LEVEL_ICON: Record<CheckLevel, typeof Info> = { pass: CheckCircle2, info: Info, warn: AlertTriangle, error: XCircle };
const LEVEL_CLS: Record<CheckLevel, string> = { pass: "text-ok", info: "text-spec-1", warn: "text-warn", error: "text-bad" };
const RANK: Record<CheckLevel, number> = { pass: 0, info: 1, warn: 2, error: 3 };

const Rover = memo(RoverRig);
const Arm = memo(ArmRig);
const Balancer = memo(BalancerRig);
const Drone = memo(DroneRig);

export default function HardwareView({
  hw,
  model,
  run,
  tel,
  checks,
  stable,
  settlingTime,
  resetKey,
  playback,
  programs,
  program,
  onProgram,
  selected,
  onSelect,
  onBuild,
  dock,
  className,
  simple = false,
  title,
  selectedPart = null,
  onSelectPart,
  onTransformPart,
}: {
  /** AI-designed machines: the selected part and edits made with the 3D gizmo. */
  selectedPart?: string | null;
  onSelectPart?: (id: string | null) => void;
  onTransformPart?: (id: string, position: [number, number, number], rotation: [number, number, number]) => void;
  simple?: boolean;
  /** Friendly machine name shown in the corner (Simple mode). */
  title?: string;
  hw: DerivedHardware;
  model: LabModel;
  run: ProgramRun;
  tel: Telemetry;
  checks: DesignCheck[];
  stable: boolean;
  settlingTime: number;
  resetKey: number;
  playback: Playback;
  programs: ProgramDef[];
  program: string;
  onProgram: (id: string) => void;
  selected: SlotId | null;
  onSelect: (s: SlotId | null) => void;
  onBuild: (b: HardwareBuild, note: string) => void;
  dock?: React.ReactNode;
  className?: string;
}) {
  const rig = useMemo(() => model.rig ?? { kind: hw.build.kind, signal: "position" as const }, [model.rig, hw.build.kind]);
  // An AI-designed machine replaces the preset rig: its own parts, joints and per-actuator simulation.
  const machine = model.assembly;
  const machineSim = useMemo(() => (machine ? simulateMachine(machine) : null), [machine]);
  const tEnd = machineSim ? machineSim.tEnd : run.tEnd;
  // Short missions play in slow motion so the motion is readable; long programs run in real time.
  // A machine's program always plays in real time: its timing is the actuators' real speed.
  const baseRate = machineSim ? 1 : tEnd / Math.min(30, Math.max(4, tEnd));
  const [mult, setMult] = useState(1);
  const [labels, setLabels] = useState(false);
  const [camKey, setCamKey] = useState(0);
  const clock = useMemo(() => ({ current: playback }), [playback]);
  const load = useRef<Partial<Record<SlotId, number>>>({});
  const hasRun = useRef(false);

  // A new design rewinds; after the first Simulate, design changes replay on their own.
  useEffect(() => {
    playback.set({ t: 0, tEnd, playing: hasRun.current });
  }, [playback, resetKey, rig.kind, tEnd]);
  // Picking a program shows its route and waits for Simulate.
  useEffect(() => {
    playback.set({ t: 0, playing: false });
  }, [playback, program]);
  useEffect(() => {
    playback.set({ rate: baseRate * mult }, false);
  }, [playback, baseRate, mult]);

  const advance = useCallback((delta: number) => playback.tick(delta), [playback]);
  const simulate = useCallback(() => {
    hasRun.current = true;
    playback.toggle();
  }, [playback]);

  const scale = displayScale(model, rig);
  const motionData: Motion = useMemo(() => {
    const y = Float64Array.from(run.y, (v) => v * scale);
    const base = {
      dt: run.dt,
      tEnd: run.tEnd,
      u: run.u,
      target: model.sim.ref * scale,
      distTime: run.disturbance,
      targets: run.targets.map((v) => v * scale),
      events: run.events,
    };
    if (rig.kind === "rover") {
      if (run.pose && run.vL && run.vR) {
        const every = Math.max(1, Math.floor(run.pose.x.length / 800));
        const path: [number, number][] = [];
        for (let i = 0; i < run.pose.x.length; i += every) path.push([run.pose.x[i], run.pose.z[i]]);
        return { ...base, main: integrate(y, run.dt), speed: y, pose: run.pose, wheelS: [integrate(run.vL, run.dt), integrate(run.vR, run.dt)], plan: run.plan, path };
      }
      return rig.signal === "speed" ? { ...base, main: integrate(y, run.dt), speed: y } : { ...base, main: y };
    }
    if (rig.kind === "balancer") return { ...base, main: y, tilt: run.tilt ?? tiltFromPosition(y, run.dt) };
    if (rig.kind === "arm") return { ...base, main: y, yaw: run.yaw };
    return { ...base, main: y };
  }, [run, scale, model, rig]);

  // Worst check per part drives the outline and callout on that part.
  const status = useMemo(() => {
    const s: Partial<Record<SlotId, PartStatus>> = {};
    for (const c of checks) {
      if (!c.slot || (c.level !== "warn" && c.level !== "error")) continue;
      const prev = s[c.slot];
      if (!prev || RANK[c.level] > RANK[prev.level]) s[c.slot] = { level: c.level, callout: c.callout ?? prev?.callout };
      else if (!prev.callout && c.callout) prev.callout = c.callout;
    }
    return s;
  }, [checks]);
  const ctx: SceneCtx = useMemo(() => ({ selected, status, onSelect, labels, load }), [selected, status, onSelect, labels]);

  // Portrait phones see a narrow slice horizontally: pull the camera back so the machine fits.
  const [narrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  const wide = !!run.pose;
  const cam = useMemo(() => {
    const c = camera(hw);
    const k = (narrow ? 1.6 : 1) * (wide ? 1.6 : 1);
    return { target: c.target, pos: c.pos.map((v, i) => c.target[i] + (v - c.target[i]) * k) as [number, number, number] };
  }, [hw, narrow, wide]);
  const isDrone = rig.kind === "drone";
  const [gizmo, setGizmo] = useState<GizmoMode>("translate");
  const selectPart = useCallback((id: string | null) => onSelectPart?.(id), [onSelectPart]);
  const transformPart = useCallback(
    (id: string, p: [number, number, number], r: [number, number, number]) => onTransformPart?.(id, p, r),
    [onTransformPart],
  );
  // CAD-style shortcuts: G moves, R rotates, Esc deselects.
  useEffect(() => {
    if (!machine) return;
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === "g" || e.key === "G") setGizmo("translate");
      else if (e.key === "r" || e.key === "R") setGizmo("rotate");
      else if (e.key === "Escape") onSelectPart?.(null);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [machine, onSelectPart]);
  const errors = checks.filter((c) => c.level === "error").length;
  const warns = checks.filter((c) => c.level === "warn").length;

  return (
    <div data-tour="robot" className={`relative overflow-hidden bg-[#06080b] ${className ?? ""}`}>
      <Canvas
        key={`${machine ? `machine-${machine.title}` : rig.kind}-${camKey}-${wide ? "w" : "n"}`}
        shadows
        camera={{ position: cam.pos, fov: 38, near: 0.003, far: 60 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerMissed={() => {
          if (gizmoActive()) return;
          onSelect(null);
          onSelectPart?.(null);
        }}
      >
        <Scene.Provider value={ctx}>
          <color attach="background" args={["#06080b"]} />
          {!machine && <fog attach="fog" args={["#06080b", 2.5, isDrone ? 9 : 6]} />}
          <hemisphereLight args={["#bcd3ff", "#0b0f14", 0.65]} />
          <directionalLight
            position={[1.2, 2, 1]}
            intensity={1.7}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-camera-left={-1.5}
            shadow-camera-right={1.5}
            shadow-camera-top={1.5}
            shadow-camera-bottom={-1.5}
          />
          <directionalLight position={[-1.5, 0.8, -1]} intensity={0.6} color="#7f5bff" />
          <pointLight position={[0.3, 0.4, 0.5]} intensity={0.4} color="#2dd4ff" />
          <Grid infiniteGrid cellSize={0.05} sectionSize={0.25} cellColor="#16222f" sectionColor="#1f4257" fadeDistance={isDrone ? 7 : 3.5} fadeStrength={1.5} position={[0, -0.0005, 0]} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
            <planeGeometry args={[60, 60]} />
            <shadowMaterial opacity={0.35} />
          </mesh>
          <Driver onFrame={advance} />
          {machine ? (
            <MachineRig
              assembly={machine}
              sim={machineSim}
              clock={clock}
              labels={labels}
              selected={selectedPart}
              onSelect={selectPart}
              gizmo={gizmo}
              onTransform={transformPart}
            />
          ) : (
            <>
              {rig.kind === "rover" && <Rover hw={hw} m={motionData} clock={clock} tel={tel} />}
              {rig.kind === "arm" && <Arm hw={hw} m={motionData} clock={clock} tel={tel} />}
              {rig.kind === "balancer" && <Balancer hw={hw} m={motionData} clock={clock} tel={tel} />}
              {rig.kind === "drone" && <Drone hw={hw} m={motionData} clock={clock} tel={tel} />}
            </>
          )}
          <OrbitControls makeDefault target={cam.target} enableDamping maxPolarAngle={Math.PI / 2.05} minDistance={0.08} maxDistance={6} />
        </Scene.Provider>
      </Canvas>

      {/* Top-left: rig + verdict */}
      <div className="pointer-events-none absolute top-0 left-0 flex max-w-[60%] flex-col gap-1.5 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mono-label inline-flex items-center gap-2 border border-line-2 bg-void/80 px-2 py-1 text-[10px] backdrop-blur">
            <span className="size-1.5 rounded-full" style={{ background: "var(--spectrum-conic)" }} />
            {machine ? machine.title : (title ?? RIGS[rig.kind].name)}
          </span>
          {machine && (
            <span className="meta-ring mono-label inline-flex items-center rounded-full bg-void/80 px-2 py-1 text-[10px] backdrop-blur">
              <span className="text-spectrum font-semibold">Designed by Muse Spark</span>
            </span>
          )}
          {machine && model.review && (
            <span className={`mono-label inline-flex items-center gap-1.5 border bg-void/80 px-2 py-1 text-[10px] backdrop-blur ${VERDICT_UI[model.review.verdict].cls}`}>
              {VERDICT_UI[model.review.verdict].label}
              {model.review.bom.length > 0 && <span className="text-mute">· ≈ ${bomTotal(model.review).toFixed(0)}</span>}
            </span>
          )}
          {!machine && <span
            className={`mono-label inline-flex items-center gap-1.5 border bg-void/80 px-2 py-1 text-[10px] backdrop-blur ${errors ? "border-bad/50 text-bad" : warns ? "border-warn/50 text-warn" : "border-ok/40 text-ok"}`}
          >
            {errors ? <XCircle className="size-3" /> : warns ? <AlertTriangle className="size-3" /> : <CheckCircle2 className="size-3" />}
            {errors ? (simple ? `${errors} thing${errors > 1 ? "s" : ""} to fix` : `${errors} blocking issue${errors > 1 ? "s" : ""}`) : warns ? `${warns} warning${warns > 1 ? "s" : ""}` : simple ? "ready to build" : "feasible"}
          </span>}
        </div>
        <p className="font-mono text-[10px] text-dim">
          {machine
            ? `${machine.parts.length} parts · click a part to select and edit it · G move · R rotate · Simulate to test`
            : simple
              ? "Drag to look around · click a part to learn about it"
              : "Drag to orbit · scroll to zoom · click a part to inspect or swap it, then simulate"}
        </p>
      </div>

      {/* Top-right: live telemetry */}
      <div className="pointer-events-none absolute top-0 right-0 space-y-1.5 p-3 text-right">
        <div className="pointer-events-auto flex justify-end gap-1">
          {machine && selectedPart && (
            <div className="flex border border-spec-1/40 bg-void/80 backdrop-blur">
              {(
                [
                  ["translate", "Move", "G"],
                  ["rotate", "Rotate", "R"],
                ] as const
              ).map(([mode, label, key]) => (
                <button
                  key={mode}
                  onClick={() => setGizmo(mode)}
                  title={`${label} the selected part (${key})`}
                  className={`mono-label px-2 py-1 text-[10px] ${gizmo === mode ? "bg-spec-1/15 text-spec-1" : "text-dim hover:text-fg"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setLabels((v) => !v)}
            className={`mono-label flex items-center gap-1 border px-2 py-1 text-[10px] backdrop-blur ${labels ? "border-spec-1/40 bg-spec-1/10 text-spec-1" : "border-line-2 bg-void/80 text-dim"}`}
          >
            <Tag className="size-3" /> Labels
          </button>
          <button onClick={() => setCamKey((k) => k + 1)} className="mono-label flex items-center border border-line-2 bg-void/80 px-2 py-1 text-[10px] text-dim backdrop-blur hover:text-fg" aria-label="Reset camera">
            <RotateCcw className="size-3" />
          </button>
        </div>
        {machineSim ? (
          <MachineHud playback={playback} sim={machineSim} />
        ) : (
          <Hud playback={playback} hw={hw} model={model} run={run} tel={tel} motion={motionData} stable={stable} settlingTime={settlingTime} simple={simple} />
        )}
      </div>

      {/* Part inspector */}
      <AnimatePresence>
        {selected && (
          <motion.div
            key={selected}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            className="absolute top-20 left-3 z-10 w-[min(320px,calc(100%-24px))] border border-spec-1/40 bg-void/92 backdrop-blur"
          >
            <Inspector hw={hw} slot={selected} checks={checks} onClose={() => onSelect(null)} onBuild={onBuild} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom: dock (mini scope), then program picker and the Simulate control */}
      <div className="absolute inset-x-0 bottom-0">
        {dock}
        <div className="border-t border-line bg-void/90 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pt-2">
            <div data-tour="programs" className="flex items-center gap-0.5 border border-line p-0.5">
              {programs.map((pr) => (
                <button
                  key={pr.id}
                  title={pr.blurb}
                  onClick={() => onProgram(pr.id)}
                  className={`mono-label px-2 py-1 text-[10px] transition-colors ${program === pr.id ? "bg-panel-2 text-fg" : "text-dim hover:text-mute"}`}
                >
                  {pr.name}
                </button>
              ))}
            </div>
            <PlaybackBar playback={playback} onSimulate={simulate} mult={mult} setMult={setMult} baseRate={baseRate} />
          </div>
          {machineSim ? <MachineCaption playback={playback} sim={machineSim} /> : <Caption playback={playback} run={run} simple={simple} />}
        </div>
      </div>
    </div>
  );
}

/** Live readouts for an AI-designed machine: each joint's actuator and the total current draw. */
function MachineHud({ playback, sim }: { playback: Playback; sim: MachineSim }) {
  const { t } = usePlayback(playback);
  const errors = sim.checks.filter((c) => c.level === "error").length;
  const step = sim.steps.find((s) => t >= s.t0 && t < s.t1);
  const status = errors ? "CHECK PARTS" : t === 0 ? "READY" : t >= sim.tEnd - 1e-6 ? "DONE" : step ? "RUNNING" : "HOLD";
  const cls = errors ? "text-bad border-bad/50" : status === "DONE" ? "text-ok border-ok/40" : status === "READY" ? "text-mute border-line-2" : "text-spec-1 border-spec-1/40";
  const unit = (k: string) => (k === "spin" ? "rpm" : k === "slide" || k === "lift" ? "mm" : k === "articulate" ? "" : "°");
  const amps = at(sim.totalCurrent, t);
  return (
    <>
      <span className={`mono-label inline-block border bg-void/80 px-2 py-1 text-[10px] backdrop-blur ${cls}`}>{status}</span>
      <div className="w-56 border border-line bg-void/85 px-2.5 py-2 text-left font-mono text-[11px] backdrop-blur">
        {sim.traces.slice(0, 6).map((tr) => {
          const v = at(tr.value, t);
          return (
            <Row
              key={tr.joint.id}
              k={tr.joint.id.replace(/_/g, " ")}
              v={tr.joint.kind === "articulate" ? `${Math.round(v * 100)}%` : `${fmtNum(v, 3)}${unit(tr.joint.kind)}`}
              cls={tr.stalled ? "text-bad" : tr.torqueRatio > 0.6 ? "text-warn" : ""}
            />
          );
        })}
        {sim.traces.length > 6 && <p className="text-[9px] text-dim">+{sim.traces.length - 6} more joints</p>}
        <div className="mt-1 border-t border-line pt-1">
          <Row k="total current" v={`${amps.toFixed(2)} A`} cls={amps > sim.peakA * 0.95 && errors ? "text-bad" : ""} />
          <Row k="peak / average" v={`${sim.peakA.toFixed(1)} / ${sim.avgA.toFixed(2)} A`} />
        </div>
      </div>
    </>
  );
}

function MachineCaption({ playback, sim }: { playback: Playback; sim: MachineSim }) {
  const { t } = usePlayback(playback);
  const i = sim.steps.findIndex((s) => t >= s.t0 && t < s.t1);
  return (
    <p className="truncate px-3 pt-1 pb-2 font-mono text-[10.5px] text-mute">
      {sim.steps.length ? (
        <>
          <span className="text-dim">{`step ${Math.max(1, i + 1)}/${sim.steps.length} · `}</span>
          {sim.steps[Math.max(0, i)]?.label}
          <span className="text-dim"> · real actuator speeds and torque limits</span>
        </>
      ) : (
        "No motion program yet: give a part a joint, then add steps"
      )}
    </p>
  );
}

/** Live readouts: subscribes to the clock, so only this box re-renders during playback. */
function Hud({
  playback,
  hw,
  model,
  run,
  tel,
  motion: mo,
  stable,
  settlingTime,
  simple,
}: {
  simple?: boolean;
  playback: Playback;
  hw: DerivedHardware;
  model: LabModel;
  run: ProgramRun;
  tel: Telemetry;
  motion: Motion;
  stable: boolean;
  settlingTime: number;
}) {
  const { t } = usePlayback(playback);
  const kind = model.rig?.kind ?? hw.build.kind;
  // AI-designed machines have no preset electronics, so show only the signals that are real.
  const custom = !!model.assembly;
  const idx = Math.min(run.y.length - 1, Math.max(0, Math.round(t / run.dt)));
  const value = run.y[idx] ?? 0;
  const tiltNow = mo.tilt ? mo.tilt[idx] : 0;
  const fallen = kind === "balancer" && (!Number.isFinite(tiltNow) || Math.abs(tiltNow) > 1.25);
  const done = run.tEnd > 0 && t >= run.tEnd - 1e-9;
  const status =
    !stable && (fallen || t > run.tEnd * 0.25)
      ? fallen
        ? "FELL OVER"
        : "UNSTABLE"
      : t === 0
        ? "READY"
        : run.id === "mission"
          ? settlingTime >= 0 && t >= settlingTime
            ? "SETTLED"
            : "TRACKING"
          : done
            ? "DONE"
            : "RUNNING";
  const statusCls =
    status === "SETTLED" || status === "DONE"
      ? "text-ok border-ok/40"
      : status === "READY"
        ? "text-mute border-line-2"
        : status === "TRACKING" || status === "RUNNING"
          ? "text-spec-1 border-spec-1/40"
          : "text-bad border-bad/50";
  // Simple mode reads angles in degrees.
  const friendly = (v: number) => (model.output.unit === "rad" ? `${Math.round((v * 180) / Math.PI)}°` : `${fmtNum(v, 2)} ${model.output.unit}`);
  const curNow = tel.perMotor[idx] ?? 0;
  const curFrac = curNow / tel.limitA;
  const isDrone = kind === "drone";
  const power = isDrone ? (tel.current[idx] ?? 0) * hw.battery.vNom : Math.abs((run.u[idx] ?? 0) * (tel.current[idx] ?? 0));
  const heading = mo.pose ? Math.round(((((mo.pose.h[idx] * 180) / Math.PI) % 360) + 360) % 360) : 0;
  return (
    <>
      <span className={`mono-label inline-block border bg-void/80 px-2 py-1 text-[10px] backdrop-blur ${statusCls}`}>{status}</span>
      {custom ? (
        <div className="w-52 border border-line bg-void/85 px-2.5 py-2 text-left font-mono text-[11px] backdrop-blur">
          <Row k={model.output.name} v={`${fmtNum(value)} / ${fmtNum(run.r[idx] ?? model.sim.ref)} ${model.output.unit}`} />
          <Row k={model.input.name} v={`${fmtNum(run.u[idx] ?? 0)} ${model.input.unit}`} />
        </div>
      ) : simple ? (
        <div className="w-44 border border-line bg-void/85 px-2.5 py-2 text-left font-mono text-[11px] backdrop-blur">
          <Row k={model.output.name.replace(/ change$/, "")} v={friendly(value)} />
          <Row k="goal" v={friendly(run.r[idx] ?? model.sim.ref)} />
          {kind === "balancer" && <Row k="lean" v={`${fmtNum(((tiltNow || 0) * 180) / Math.PI, 2)}°`} />}
        </div>
      ) : (
      <div className="w-52 border border-line bg-void/85 px-2.5 py-2 text-left font-mono text-[11px] backdrop-blur">
        <Row k={model.output.name} v={`${fmtNum(value)} / ${fmtNum(run.r[idx] ?? model.sim.ref)} ${model.output.unit}`} />
        <Row k={isDrone ? "thrust Δ" : "motor V"} v={`${fmtNum(run.u[idx] ?? 0)} ${model.input.unit}`} />
        {kind === "rover" && mo.speed && <Row k="distance" v={`${fmtNum(mo.main[idx])} m`} />}
        {kind === "rover" && mo.pose && <Row k="heading" v={`${heading}°`} />}
        {kind === "balancer" && <Row k="tilt" v={`${fmtNum(((tiltNow || 0) * 180) / Math.PI)}°`} />}
        <Row k={tel.label} v={`${curNow.toFixed(2)} A`} cls={curFrac > 1 ? "text-bad" : curFrac > 0.75 ? "text-warn" : ""} />
        <div className="mt-1 h-1 w-full bg-line">
          <div className={`h-full ${curFrac > 1 ? "bg-bad" : curFrac > 0.75 ? "bg-warn" : "bg-ok"}`} style={{ width: `${Math.min(100, curFrac * 100)}%` }} />
        </div>
        <p className="mt-0.5 text-[9px] text-dim">
          {hw.driver.name.split(" ")[0]} limit {tel.limitA} A · {fmtNum(power, 2)} W
        </p>
      </div>
      )}
    </>
  );
}

function PlaybackBar({ playback, onSimulate, mult, setMult, baseRate }: { playback: Playback; onSimulate: () => void; mult: number; setMult: (k: number) => void; baseRate: number }) {
  const { t, playing } = usePlayback(playback);
  const tEnd = playback.tEnd;
  const done = t >= tEnd - 1e-9;
  const label = playing ? "Pause" : t > 0 && !done ? "Resume" : done ? "Simulate again" : "Simulate";
  return (
    <>
      <button
        data-tour="simulate"
        onClick={onSimulate}
        className={`relative inline-flex h-8 items-center gap-2 overflow-hidden px-4 text-[12px] font-medium transition-colors ${playing ? "border border-line-2 text-fg hover:bg-panel-2" : "text-void"}`}
        style={playing ? undefined : { background: "var(--spectrum)" }}
      >
        {!playing && t === 0 && <span className="absolute inset-0 animate-pulse bg-white/20" />}
        {playing ? <Pause className="relative size-3.5" /> : <Play className="relative size-3.5 fill-current" />}
        <span className="relative">{label}</span>
      </button>
      <button
        onClick={() => playback.set({ t: 0, playing: true })}
        className="flex size-7 items-center justify-center text-mute hover:text-fg"
        aria-label="Restart"
        title="Restart"
      >
        <RotateCcw className="size-3.5" />
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        value={tEnd > 0 ? (t / tEnd) * 1000 : 0}
        onChange={(e) => playback.set({ t: (Number(e.target.value) / 1000) * tEnd, playing: false })}
        className="lab-range min-w-[80px] flex-1"
        style={{ "--fill": `${tEnd > 0 ? (t / tEnd) * 100 : 0}%` } as React.CSSProperties}
        aria-label="Scrub time"
      />
      <span className="w-24 text-right font-mono text-[11px] tabular-nums">
        {fmtNum(t)} / {fmtNum(tEnd)} s
      </span>
      <div className="hidden items-center gap-0.5 sm:flex">
        {[0.25, 1, 3].map((k) => (
          <button key={k} onClick={() => setMult(k)} className={`mono-label px-1.5 py-0.5 text-[10px] ${mult === k ? "bg-panel-2 text-fg" : "text-dim hover:text-mute"}`}>
            {k}×
          </button>
        ))}
      </div>
      <span className="mono-label hidden text-[9px] text-dim lg:inline">
        {baseRate * mult < 0.98 ? `slow-mo ×${fmtNum(1 / (baseRate * mult), 2)}` : baseRate * mult > 1.02 ? `fast ×${fmtNum(baseRate * mult, 2)}` : "real time"}
      </span>
    </>
  );
}

function Caption({ playback, run, simple }: { playback: Playback; run: ProgramRun; simple?: boolean }) {
  const { t } = usePlayback(playback);
  const i = segmentAt(run, t);
  return (
    <p className="truncate px-3 pt-1 pb-2 font-mono text-[10.5px] text-mute">
      {run.segs.length > 1 && <span className="text-dim">{`step ${i + 1}/${run.segs.length} · `}</span>}
      {run.segs[i]?.label}
      {run.linear && !simple && <span className="text-dim"> · from the closed-loop step response</span>}
    </p>
  );
}

function Row({ k, v, cls = "" }: { k: string; v: string; cls?: string }) {
  return (
    <p className="flex justify-between gap-2">
      <span className="truncate text-dim">{k}</span>
      <span className={`shrink-0 tabular-nums ${cls}`}>{v}</span>
    </p>
  );
}

function Inspector({
  hw,
  slot,
  checks,
  onClose,
  onBuild,
}: {
  hw: DerivedHardware;
  slot: SlotId;
  checks: DesignCheck[];
  onClose: () => void;
  onBuild: (b: HardwareBuild, note: string) => void;
}) {
  const spec = SLOTS[hw.build.kind].find((s) => s.slot === slot);
  if (!spec) return null;
  const current = spec.options.find((o) => o.id === hw.build.parts[slot]) ?? spec.options[0];
  const mine = checks.filter((c) => c.slot === slot);
  return (
    <div>
      <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          <p className="mono-label text-[10px] text-spec-1">
            {spec.label}
            {spec.qty > 1 ? ` × ${spec.qty}` : ""}
          </p>
          <p className="truncate text-[13px] font-medium">{current.name}</p>
          <p className="font-mono text-[10px] text-dim">{current.spec}</p>
        </div>
        <button onClick={onClose} className="text-dim hover:text-fg" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 border-b border-line font-mono text-[11px]">
        <p className="border-r border-line px-3 py-1.5">
          <span className="text-dim">price </span>${(current.price * spec.qty).toFixed(2)}
        </p>
        <p className="px-3 py-1.5">
          <span className="text-dim">mass </span>
          {current.mass * spec.qty} g
        </p>
      </div>
      <div className="max-h-[38vh] overflow-y-auto [scrollbar-width:thin]">
        <p className="mono-label px-3 pt-2.5 pb-1 text-[10px] text-dim">Swap part</p>
        <div className="px-1.5 pb-2">
          {spec.options.map((o) => {
            const on = o.id === current.id;
            return (
              <button
                key={o.id}
                onClick={() => !on && onBuild({ ...hw.build, parts: { ...hw.build.parts, [slot]: o.id } }, `swapped ${spec.label.toLowerCase()} → ${o.name}`)}
                className={`flex w-full items-start gap-2 px-1.5 py-1.5 text-left transition-colors ${on ? "bg-spec-1/10" : "hover:bg-panel-2"}`}
              >
                <span className={`mt-1 size-2 shrink-0 rounded-full border ${on ? "border-spec-1 bg-spec-1" : "border-line-2"}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[12px] ${on ? "text-fg" : "text-mute"}`}>{o.name}</span>
                  <span className="block truncate font-mono text-[10px] text-dim">{o.spec}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-dim">${o.price}</span>
              </button>
            );
          })}
        </div>
        {mine.length > 0 && (
          <div className="space-y-1.5 border-t border-line px-3 py-2.5">
            {mine.map((c) => {
              const Icon = LEVEL_ICON[c.level];
              return (
                <div key={c.id} className="text-[11px]">
                  <p className={`flex items-start gap-1.5 ${LEVEL_CLS[c.level]}`}>
                    <Icon className="mt-0.5 size-3 shrink-0" />
                    <span className="text-fg">{c.title}</span>
                  </p>
                  <p className="pl-[18px] text-dim">{c.detail}</p>
                  {c.fix && (
                    <button
                      onClick={() => onBuild({ ...hw.build, parts: { ...hw.build.parts, ...c.fix!.parts }, geom: { ...hw.build.geom, ...c.fix!.geom } }, `fix: ${c.fix!.label}`)}
                      className="mono-label mt-1 ml-[18px] inline-flex items-center gap-1 border border-spec-1/40 px-1.5 py-0.5 text-[10px] text-spec-1 hover:bg-spec-1/10"
                    >
                      <Wand2 className="size-3" /> {c.fix.label}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
