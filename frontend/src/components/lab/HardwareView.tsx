"use client";

// Live 3D hardware: the machine built from the selected parts, driven by the simulation. Click a
// part to inspect or swap it; parts that fail a design check glow and show what's wrong.
import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { AlertTriangle, CheckCircle2, Info, Pause, Play, RotateCcw, Tag, Wand2, X, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtNum } from "@/lib/lab/analysis";
import { SLOTS } from "@/lib/lab/hardware/build";
import type { CheckLevel, DesignCheck, DerivedHardware, HardwareBuild, Telemetry } from "@/lib/lab/hardware/build";
import type { SlotId } from "@/lib/lab/hardware/parts";
import { RIGS, displayScale, integrate, tiltFromPosition } from "@/lib/lab/rig";
import type { LabModel } from "@/lib/lab/types";
import type { SimOut } from "@/lib/sim/core";
import { Scene } from "./hw3d/parts3d";
import type { PartStatus, SceneCtx } from "./hw3d/parts3d";
import { ArmRig, BalancerRig, DroneRig, RoverRig } from "./hw3d/rigs";
import type { Clock, Motion } from "./hw3d/rigs";

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

export default function HardwareView({
  hw,
  model,
  sim,
  tilt,
  tel,
  checks,
  stable,
  settlingTime,
  resetKey,
  selected,
  onSelect,
  onBuild,
  onTime,
  dock,
  className,
}: {
  hw: DerivedHardware;
  model: LabModel;
  sim: SimOut;
  tilt?: Float64Array;
  tel: Telemetry;
  checks: DesignCheck[];
  stable: boolean;
  settlingTime: number;
  resetKey: number;
  selected: SlotId | null;
  onSelect: (s: SlotId | null) => void;
  onBuild: (b: HardwareBuild, note: string) => void;
  onTime?: (t: number) => void;
  dock?: React.ReactNode;
  className?: string;
}) {
  const rig = useMemo(() => model.rig ?? { kind: hw.build.kind, signal: "position" as const }, [model.rig, hw.build.kind]);
  const tEnd = (sim.y.length - 1) * sim.dt;
  // Fast systems play in slow motion and slow ones speed up, so every run lasts a few seconds.
  const baseRate = tEnd / Math.min(10, Math.max(4, tEnd));
  const [mult, setMult] = useState(1);
  const [labels, setLabels] = useState(false);
  const [camKey, setCamKey] = useState(0);
  const clock = useRef<Clock>({ t: 0, playing: true, rate: baseRate });
  const [ui, setUi] = useState({ t: 0, playing: true });
  const load = useRef<Partial<Record<SlotId, number>>>({});

  useEffect(() => {
    clock.current.t = 0;
    clock.current.playing = true;
  }, [resetKey, rig.kind]);
  useEffect(() => {
    clock.current.rate = baseRate * mult;
  }, [baseRate, mult]);

  // Advances playback each frame and publishes the time to React about 15 times a second.
  const lastPublish = useRef(0);
  const advance = (delta: number) => {
    const c = clock.current;
    if (c.playing) {
      c.t = Math.min(tEnd, c.t + Math.min(delta, 0.1) * c.rate);
      if (c.t >= tEnd) c.playing = false;
    }
    const now = performance.now();
    if (now - lastPublish.current > 66 || !c.playing) {
      lastPublish.current = now;
      const { t: tt, playing } = c;
      setUi((prev) => (Math.abs(prev.t - tt) > 1e-9 || prev.playing !== playing ? { t: tt, playing } : prev));
      onTime?.(tt);
    }
  };

  const scale = displayScale(model, rig);
  const motionData: Motion = useMemo(() => {
    const y = Float64Array.from(sim.y, (v) => v * scale);
    const base = { dt: sim.dt, tEnd, u: sim.u, target: model.sim.ref * scale, distTime: model.sim.disturbance?.time ?? -1 };
    if (rig.kind === "rover" && rig.signal === "speed") return { ...base, main: integrate(y, sim.dt), speed: y };
    if (rig.kind === "balancer") return { ...base, main: y, tilt: tilt ?? tiltFromPosition(y, sim.dt) };
    return { ...base, main: y };
  }, [sim, scale, model, rig, tilt, tEnd]);

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
  const ctx: SceneCtx = { selected, status, onSelect, labels, load };

  const t = ui.t;
  const idx = Math.min(sim.y.length - 1, Math.round(t / sim.dt));
  const value = sim.y[idx] ?? 0;
  const tiltNow = motionData.tilt ? motionData.tilt[idx] : 0;
  const fallen = rig.kind === "balancer" && (!Number.isFinite(tiltNow) || Math.abs(tiltNow) > 1.25);
  const status_ = !stable && (fallen || t > tEnd * 0.25) ? (fallen ? "FELL OVER" : "UNSTABLE") : settlingTime >= 0 && t >= settlingTime ? "SETTLED" : "TRACKING";
  const statusCls = status_ === "SETTLED" ? "text-ok border-ok/40" : status_ === "TRACKING" ? "text-spec-1 border-spec-1/40" : "text-bad border-bad/50";
  // Portrait phones see a narrow slice horizontally: pull the camera back so the machine fits.
  const [narrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  const cam = useMemo(() => {
    const c = camera(hw);
    const k = narrow ? 1.6 : 1;
    return { target: c.target, pos: c.pos.map((v, i) => c.target[i] + (v - c.target[i]) * k) as [number, number, number] };
  }, [hw, narrow]);
  const curNow = tel.perMotor[idx] ?? 0;
  const curFrac = curNow / tel.limitA;
  const isDrone = rig.kind === "drone";
  const power = isDrone ? (tel.current[idx] ?? 0) * hw.battery.vNom : Math.abs((sim.u[idx] ?? 0) * (tel.current[idx] ?? 0));
  const errors = checks.filter((c) => c.level === "error").length;
  const warns = checks.filter((c) => c.level === "warn").length;

  return (
    <div className={`relative overflow-hidden bg-[#06080b] ${className ?? ""}`}>
      <Canvas
        key={`${rig.kind}-${camKey}`}
        shadows
        camera={{ position: cam.pos, fov: 38, near: 0.003, far: 60 }}
        dpr={[1, 2]}
        onPointerMissed={() => onSelect(null)}
      >
        <Scene.Provider value={ctx}>
          <color attach="background" args={["#06080b"]} />
          <fog attach="fog" args={["#06080b", 2.5, isDrone ? 9 : 6]} />
          <hemisphereLight args={["#bcd3ff", "#0b0f14", 0.65]} />
          <directionalLight position={[1.2, 2, 1]} intensity={1.7} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-1.5} shadow-camera-right={1.5} shadow-camera-top={1.5} shadow-camera-bottom={-1.5} />
          <directionalLight position={[-1.5, 0.8, -1]} intensity={0.6} color="#7f5bff" />
          <pointLight position={[0.3, 0.4, 0.5]} intensity={0.4} color="#3ff0ff" />
          <Grid infiniteGrid cellSize={0.05} sectionSize={0.25} cellColor="#16222f" sectionColor="#1f4257" fadeDistance={isDrone ? 7 : 3.5} fadeStrength={1.5} position={[0, -0.0005, 0]} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
            <planeGeometry args={[60, 60]} />
            <shadowMaterial opacity={0.35} />
          </mesh>
          <Driver onFrame={advance} />
          {rig.kind === "rover" && <RoverRig hw={hw} m={motionData} clock={clock} tel={tel} />}
          {rig.kind === "arm" && <ArmRig hw={hw} m={motionData} clock={clock} tel={tel} />}
          {rig.kind === "balancer" && <BalancerRig hw={hw} m={motionData} clock={clock} tel={tel} />}
          {rig.kind === "drone" && <DroneRig hw={hw} m={motionData} clock={clock} tel={tel} />}
          <OrbitControls makeDefault target={cam.target} enableDamping maxPolarAngle={Math.PI / 2.05} minDistance={0.08} maxDistance={6} />
        </Scene.Provider>
      </Canvas>

      {/* Top-left: rig + verdict */}
      <div className="pointer-events-none absolute top-0 left-0 flex max-w-[60%] flex-col gap-1.5 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mono-label inline-flex items-center gap-2 border border-line-2 bg-void/80 px-2 py-1 text-[10px] backdrop-blur">
            <span className="size-1.5 rounded-full" style={{ background: "var(--spectrum-conic)" }} />
            {RIGS[rig.kind].name}
          </span>
          <span
            className={`mono-label inline-flex items-center gap-1.5 border bg-void/80 px-2 py-1 text-[10px] backdrop-blur ${errors ? "border-bad/50 text-bad" : warns ? "border-warn/50 text-warn" : "border-ok/40 text-ok"}`}
          >
            {errors ? <XCircle className="size-3" /> : warns ? <AlertTriangle className="size-3" /> : <CheckCircle2 className="size-3" />}
            {errors ? `${errors} blocking issue${errors > 1 ? "s" : ""}` : warns ? `${warns} warning${warns > 1 ? "s" : ""}` : "feasible"}
          </span>
        </div>
        <p className="font-mono text-[10px] text-dim">Drag to orbit · scroll to zoom · click a part to inspect or swap it</p>
      </div>

      {/* Top-right: live telemetry */}
      <div className="pointer-events-none absolute top-0 right-0 space-y-1.5 p-3 text-right">
        <div className="pointer-events-auto flex justify-end gap-1">
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
        <span className={`mono-label inline-block border bg-void/80 px-2 py-1 text-[10px] backdrop-blur ${statusCls}`}>{status_}</span>
        <div className="w-52 border border-line bg-void/85 px-2.5 py-2 text-left font-mono text-[11px] backdrop-blur">
          <Row k={model.output.name} v={`${fmtNum(value)} / ${fmtNum(model.sim.ref)} ${model.output.unit}`} />
          <Row k={isDrone ? "thrust Δ" : "motor V"} v={`${fmtNum(sim.u[idx] ?? 0)} ${model.input.unit}`} />
          {rig.kind === "rover" && motionData.speed && <Row k="distance" v={`${fmtNum(motionData.main[idx])} m`} />}
          {rig.kind === "balancer" && <Row k="tilt" v={`${fmtNum(((tiltNow || 0) * 180) / Math.PI)}°`} />}
          <Row k={tel.label} v={`${curNow.toFixed(2)} A`} cls={curFrac > 1 ? "text-bad" : curFrac > 0.75 ? "text-warn" : ""} />
          <div className="mt-1 h-1 w-full bg-line">
            <div className={`h-full transition-[width] duration-75 ${curFrac > 1 ? "bg-bad" : curFrac > 0.75 ? "bg-warn" : "bg-ok"}`} style={{ width: `${Math.min(100, curFrac * 100)}%` }} />
          </div>
          <p className="mt-0.5 text-[9px] text-dim">
            {hw.driver.name.split(" ")[0]} limit {tel.limitA} A · {fmtNum(power, 2)} W
          </p>
        </div>
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

      {/* Bottom: dock (mini scope) + playback */}
      <div className="absolute inset-x-0 bottom-0">
        {dock}
        <div className="flex items-center gap-3 border-t border-line bg-void/85 px-3 py-2 backdrop-blur">
          <button
            onClick={() => {
              const c = clock.current;
              if (c.t >= tEnd) c.t = 0;
              c.playing = !c.playing;
            }}
            className="flex size-7 items-center justify-center border border-line-2 text-fg hover:bg-panel-2"
            aria-label={ui.playing ? "Pause" : "Play"}
          >
            {ui.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <button
            onClick={() => {
              clock.current.t = 0;
              clock.current.playing = true;
            }}
            className="flex size-7 items-center justify-center text-mute hover:text-fg"
            aria-label="Replay"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={tEnd > 0 ? (t / tEnd) * 1000 : 0}
            onChange={(e) => {
              clock.current.t = (Number(e.target.value) / 1000) * tEnd;
              clock.current.playing = false;
            }}
            className="lab-range flex-1"
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
          <span className="mono-label hidden text-[9px] text-dim md:inline">
            {baseRate * mult < 0.98 ? `slow-mo ×${fmtNum(1 / (baseRate * mult), 2)}` : baseRate * mult > 1.02 ? `fast ×${fmtNum(baseRate * mult, 2)}` : "real time"}
          </span>
        </div>
      </div>
    </div>
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
