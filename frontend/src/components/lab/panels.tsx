"use client";

import type { AssistAction, AssistResult } from "@/lib/lab/assist";
import type { Assembly } from "@/lib/lab/assembly";
import type { HardwareBuild } from "@/lib/lab/hardware/build";
import {
  ArrowRight,
  Check,
  Copy,
  Cpu,
  Download,
  FileSpreadsheet,
  Film,
  Lightbulb,
  Loader2,
  Mic,
  MicOff,
  Play,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { VerdictIcon } from "@/components/landing/LoopStory";
import { fmtNum, polyToString } from "@/lib/lab/analysis";
import type { SpecCheck } from "@/lib/lab/analysis";
import { PRESETS } from "@/lib/lab/presets";
import { RIGS, pickRig } from "@/lib/lab/rig";
import type { Advice, CallUsage, ControllerSpec, Iteration, LabModel } from "@/lib/lab/types";
import type { CheckResult } from "@/lib/lab/validate";
import type { Metrics } from "@/lib/sim/core";
import { TimeChart } from "./charts";
import { useSpeech } from "./useSpeech";
import VideoTrack, { normaliseClip, type VideoTrackOptions } from "./VideoTrack";
import PartsLibrary from "./PartsLibrary";
import type { CatalogPart } from "@/lib/lab/catalog/parts";

export function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-2">
      <span className="text-[12px] font-semibold tracking-wide text-mute uppercase">{children}</span>
      {right}
    </div>
  );
}

export function GhostButton({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex h-8 items-center gap-1.5 rounded-xl bg-surface px-3 text-[12.5px] font-medium text-mute shadow-[0_0_0_1px_var(--color-line-2)] transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    />
  );
}

export function PrimaryButton({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-medium text-accent-fg shadow-[0_6px_20px_-8px_var(--color-accent)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Describe
// ---------------------------------------------------------------------------

// Each step names who does it, so you can watch the work move between Meta's model and our engine.
export const PIPELINE: { label: string; who: "meta" | "engine" }[] = [
  { label: "Checking what can be built", who: "meta" },
  { label: "Deriving the physics and 3D build", who: "meta" },
  { label: "Choosing a controller", who: "meta" },
  { label: "Simulating in the engine", who: "engine" },
  { label: "Explaining the response", who: "meta" },
];

/** Today's Meta spend against the daily cap. */
function MetaMeter({ aiOn, spend, modelName }: { aiOn: boolean | null; spend: { usd: number; budgetUsd: number } | null; modelName: string }) {
  if (aiOn === null) return <span className="mono-label text-dim">…</span>;
  if (!aiOn) return <span className="mono-label text-warn" title="Live AI is switched off on this server; ready-made machines, checks and tuning still work">Live AI paused</span>;
  const pct = spend ? Math.min(100, (spend.usd / spend.budgetUsd) * 100) : 0;
  return (
    <span className="mono-label flex items-center gap-2 text-[10px] text-mute" title="Estimated Meta API spend today, against the daily cap">
      <span className="text-spectrum font-semibold">{modelName}</span>
      {spend && (
        <>
          <span className="relative h-1 w-10 overflow-hidden rounded-full bg-line-2">
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(pct, 3)}%`, background: "var(--spectrum)" }} />
          </span>
          <span className="tabular-nums">
            ${spend.usd.toFixed(3)} / ${spend.budgetUsd.toFixed(0)}
          </span>
        </>
      )}
    </span>
  );
}

function usageNote(u: CallUsage | undefined): string {
  if (!u) return "";
  return u.cached ? " · cached, $0" : ` · ${u.tokens.toLocaleString()} tokens · $${u.costUsd.toFixed(3)}`;
}

export function DescribePanel({
  text,
  setText,
  onBuild,
  onPreset,
  onData,
  onSample,
  busy,
  pipeline,
  aiOn,
  spend,
  onVideo,
  error,
  userParts,
  onUserParts,
  modelName = "Muse Spark",
  promptHistory = [],
}: {
  text: string;
  setText: (s: string) => void;
  onBuild: () => void;
  onPreset: (id: string) => void;
  onData: (file: File) => void;
  onSample: () => void;
  busy: boolean;
  pipeline: number;
  aiOn: boolean | null;
  spend: { usd: number; budgetUsd: number } | null;
  onVideo: (file: File, opts: VideoTrackOptions, durationS: number) => Promise<void>;
  /** Why the last description couldn't be built. */
  error?: string | null;
  userParts: CatalogPart[];
  onUserParts: (p: CatalogPart[]) => void;
  /** The Meta model chosen in the top bar. */
  modelName?: string;
  promptHistory?: string[];
}) {
  const [clip, setClip] = useState<File | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [interim, setInterim] = useState("");
  const baseRef = useRef("");
  const speech = useSpeech((finalText, live) => {
    setText((baseRef.current ? baseRef.current + " " : "") + finalText);
    setInterim(live);
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  return (
    <div>
      <SectionLabel right={<MetaMeter aiOn={aiOn} spend={spend} modelName={modelName} />}>
        01 · Modeler · {modelName}
      </SectionLabel>
      {promptHistory.length > 0 && (
        <div className="border-b border-line px-4 pb-3">
          <p className="mono-label mb-1.5 text-[9px] text-dim">Prompt history</p>
          <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:thin]">
            {promptHistory.slice(-6).map((prompt, i) => <span key={`${prompt}-${i}`} title={prompt} className="max-w-[220px] shrink-0 truncate rounded-lg bg-surface-2 px-2 py-1 text-[11px] text-mute">{prompt}</span>)}
          </div>
        </div>
      )}
      <div
        className={`p-4 transition-colors ${drag ? "bg-panel-2" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) onData(f);
        }}
      >
        <div className="relative border border-line-2 bg-void focus-within:border-fg/40 rounded-xl">
          <textarea
            value={text + (interim ? (text ? " " : "") + interim : "")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onBuild();
            }}
            rows={5}
            placeholder="e.g. A DC motor driving a conveyor belt with a 5 kg load. Hold 0.5 m/s even when boxes drop on it."
            className="block w-full resize-none bg-transparent p-3 text-[14px] leading-relaxed outline-none placeholder:text-dim"
          />
          <div className="flex items-center justify-between border-t border-line px-2 py-1.5">
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  baseRef.current = text;
                  speech.toggle();
                }}
                disabled={!speech.supported}
                title={speech.supported ? "Dictate" : "Speech input isn't supported in this browser"}
                className={`flex size-8 items-center justify-center transition-colors disabled:opacity-30 ${speech.listening ? "text-bad" : "text-mute hover:text-fg"}`}
              >
                {speech.listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </button>
              <button onClick={() => fileRef.current?.click()} title="Upload step-response CSV" className="flex size-8 items-center justify-center text-mute hover:text-fg">
                <Upload className="size-4" />
              </button>
              <button onClick={() => videoRef.current?.click()} title="Film it: learn your robot's physics from a video (SAM 3.1)" className="flex size-8 items-center justify-center text-mute hover:text-fg">
                <Film className="size-4" />
              </button>
              <input
                ref={videoRef}
                type="file"
                accept="video/mp4,video/quicktime,.mp4,.mov,.m4v"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const ok = normaliseClip(f);
                  setClipError(ok ? null : "Use an MP4 or MOV clip, as phones record by default.");
                  setClip(ok);
                }}
              />
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onData(f);
                  e.target.value = "";
                }}
              />
              {speech.listening && (
                <span className="ml-1 flex h-4 items-end gap-0.5">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <motion.span key={i} className="w-0.5 bg-bad" animate={{ height: ["25%", `${35 + ((i * 41) % 60)}%`, "25%"] }} transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.05 }} />
                  ))}
                </span>
              )}
            </div>
            <span className="mono-label text-[10px] text-dim">Ctrl ↵</span>
          </div>
        </div>
        {speech.error && <p className="mt-2 text-xs text-bad">{speech.error}</p>}
        {clipError && <p className="mt-2 text-xs text-bad">{clipError}</p>}
        {error && <p className="mt-2 border border-warn/40 bg-warn/5 px-2.5 py-2 text-[11.5px] leading-relaxed text-warn rounded-xl">{error}</p>}
        {clip && (
          <VideoTrack
            file={clip}
            busy={busy}
            aiOn={!!aiOn}
            defaultPrompt={RIGS[pickRig(text)].name.toLowerCase().includes("arm") ? "robot arm" : "robot"}
            onCancel={() => setClip(null)}
            onTrack={(opts, d) => void onVideo(clip, opts, d).then(() => setClip(null))}
          />
        )}
        {text.trim() && (
          <p className="mono-label mt-2 flex items-center gap-1.5 text-[10px] text-mute">
            <span className="size-1.5 rounded-full" style={{ background: "var(--spectrum-conic)" }} />
            3D rig: <span className="text-fg">{RIGS[pickRig(text)].name}</span>
          </p>
        )}
        <PrimaryButton className="mt-3 w-full" onClick={onBuild} disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Cpu className="size-3.5" />} Build model & controller
        </PrimaryButton>

        <PartsLibrary parts={userParts} onChange={onUserParts} />

        <AnimatePresence>
          {pipeline >= 0 && (
            <motion.ol initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 overflow-hidden">
              {PIPELINE.map((p, i) => (
                <li key={p.label} className={`flex items-center gap-2.5 py-1 text-[13px] transition-colors ${i <= pipeline ? "text-fg" : "text-dim"}`}>
                  <span className="flex size-4 items-center justify-center">
                    {i < pipeline ? (
                      <Check className="size-3.5 text-ok" />
                    ) : i === pipeline ? (
                      <span className="size-3 rounded-full border border-line-2 border-t-fg" style={{ animation: "rc-spin .7s linear infinite" }} />
                    ) : (
                      <span className="size-1 rounded-full bg-dim" />
                    )}
                  </span>
                  <span className="flex-1">{p.label}</span>
                  <span
                    className={`mono-label rounded-full px-2 py-0.5 text-[9px] transition-opacity ${i === pipeline ? "meta-ring opacity-100" : "opacity-50"} ${
                      p.who === "meta" && aiOn ? "text-spectrum" : "text-mute"
                    }`}
                  >
                    {p.who === "engine" ? "PlantSim" : aiOn ? modelName : "Physics library"}
                  </span>
                </li>
              ))}
            </motion.ol>
          )}
        </AnimatePresence>

        <div className="mt-4">
          <p className="mono-label mb-2 text-dim">Or start from</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => onPreset(p.id)}
                disabled={busy}
                className="border border-line px-2.5 py-1 text-[12px] text-mute transition-colors hover:border-line-2 hover:text-fg disabled:opacity-40 rounded-xl"
              >
                {p.name}
              </button>
            ))}
          </div>
          <button onClick={onSample} disabled={busy} className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-mute underline-offset-4 hover:text-fg hover:underline">
            <FileSpreadsheet className="size-3.5" /> Try sample step-test data
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model card
// ---------------------------------------------------------------------------

export function ModelCard({ model, notice }: { model: LabModel; notice: string | null }) {
  const [open, setOpen] = useState(false);
  const src = { meta: "Meta Muse Spark", offline: "Physics library", data: "Identified from data" }[model.source];
  return (
    <div className="border-t border-line">
      <SectionLabel right={<span className="mono-label rounded-full border border-line-2 px-1.5 py-0.5 text-[10px] text-mute">{src}</span>}>02 · Model</SectionLabel>
      <div className="space-y-4 p-4">
        {notice && <p className="border-l-2 border-warn/60 pl-3 text-xs text-mute">{notice}</p>}
        <div>
          <h3 className="text-[15px] font-medium">{model.title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-mute">{model.summary}</p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-mute">
          <span>
            in: <span className="text-fg">{model.input.name}</span> [{model.input.unit}]
          </span>
          <span>
            out: <span className="text-fg">{model.output.name}</span> [{model.output.unit}]
          </span>
        </div>
        {model.plant.kind === "tf" ? (
          <div className="flex items-center gap-3 overflow-x-auto border border-line bg-void p-3 font-mono text-[12px] rounded-xl">
            <span className="shrink-0 text-mute">G(s) =</span>
            <span className="inline-flex flex-col items-center">
              <span className="px-1 whitespace-nowrap">{polyToString(model.plant.num)}</span>
              <span className="my-0.5 h-px w-full bg-fg/50" />
              <span className="px-1 whitespace-nowrap">{polyToString(model.plant.den)}</span>
            </span>
            {(model.plant.delay ?? 0) > 0 && <span className="shrink-0">· e^(−{fmtNum(model.plant.delay ?? 0)}s)</span>}
          </div>
        ) : (
          <div className="overflow-x-auto border border-line bg-void p-3 font-mono text-[11px] rounded-xl">
            <p className="mb-1.5 text-mute">ẋ = A x + B u · states [{model.plant.stateNames.join(", ")}]</p>
            <table>
              <tbody>
                {model.plant.A.map((row, i) => (
                  <tr key={i}>
                    {row.map((v, j) => (
                      <td key={j} className="pr-3 text-right tabular-nums">
                        {fmtNum(v)}
                      </td>
                    ))}
                    <td className="border-l border-line pl-3 text-right text-spec-1 tabular-nums">{model.plant.kind === "ss" ? fmtNum(model.plant.B[i]) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="space-y-1 font-mono text-[12px]">
          {model.equations.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
        <button onClick={() => setOpen((o) => !o)} className="mono-label flex items-center gap-1.5 text-mute hover:text-fg">
          <ArrowRight className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} /> Parameters & assumptions
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <table className="w-full font-mono text-[11px]">
                <tbody>
                  {model.params.map((p) => (
                    <tr key={p.symbol + p.name} className="border-b border-line">
                      <td className="py-1 pr-2">{p.symbol}</td>
                      <td className="py-1 pr-2 text-mute">{p.name}</td>
                      <td className="py-1 text-right whitespace-nowrap">
                        {fmtNum(p.value)} <span className="text-dim">{p.unit}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="mt-3 space-y-1 text-[12px] text-mute">
                {model.assumptions.map((a) => (
                  <li key={a} className="flex gap-2">
                    <span className="text-dim">▸</span>
                    {a}
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controller tuner
// ---------------------------------------------------------------------------

function LogSlider({ label, value, center, onChange, unit }: { label: string; value: number; center: number; onChange: (v: number) => void; unit?: string }) {
  // Log scale spanning 1/30x .. 30x of the reference value; 0 sits at the far left.
  const c = Math.max(center, 1e-9);
  const lo = Math.log(c / 30),
    hi = Math.log(c * 30);
  const pos = value <= 0 ? 0 : Math.max(0, Math.min(1000, ((Math.log(value) - lo) / (hi - lo)) * 1000));
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="font-mono text-[12px]">{label}</span>
        <input
          type="number"
          value={Number(value.toPrecision(4))}
          step="any"
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 0) onChange(v);
          }}
          className="w-24 bg-transparent text-right font-mono text-[12px] tabular-nums outline-none focus:text-spec-1"
        />
      </span>
      <input
        type="range"
        min={0}
        max={1000}
        value={pos}
        onChange={(e) => {
          const p = Number(e.target.value);
          onChange(p <= 2 ? 0 : Math.exp(lo + (p / 1000) * (hi - lo)));
        }}
        className="lab-range mt-2"
        style={{ "--fill": `${pos / 10}%` } as React.CSSProperties}
      />
      {unit && <span className="sr-only">{unit}</span>}
    </label>
  );
}

export function TunerPanel({
  ctrl,
  center,
  onChange,
  stateNames,
}: {
  ctrl: ControllerSpec;
  center: ControllerSpec;
  onChange: (c: ControllerSpec) => void;
  stateNames?: string[];
}) {
  if (ctrl.type === "pid" && center.type === "pid") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <LogSlider label="Kp · proportional" value={ctrl.kp} center={center.kp || 1} onChange={(kp) => onChange({ ...ctrl, kp })} />
        <LogSlider label="Ki · integral" value={ctrl.ki} center={center.ki || center.kp || 1} onChange={(ki) => onChange({ ...ctrl, ki })} />
        <LogSlider label="Kd · derivative" value={ctrl.kd} center={center.kd || (center.kp || 1) * 0.05} onChange={(kd) => onChange({ ...ctrl, kd })} />
        <LogSlider label="N · D-filter (rad/s)" value={ctrl.N} center={center.N || 50} onChange={(N) => onChange({ ...ctrl, N: Math.max(0.1, N) })} />
      </div>
    );
  }
  if (ctrl.type === "lqr" && center.type === "lqr") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {ctrl.Q.map((q, i) => (
          <LogSlider
            key={i}
            label={`Q · ${stateNames?.[i] ?? `x${i + 1}`}`}
            value={q}
            center={center.Q[i] || 1}
            onChange={(v) => onChange({ ...ctrl, Q: ctrl.Q.map((x, j) => (j === i ? v : x)) })}
          />
        ))}
        <LogSlider label="R · effort cost" value={ctrl.R} center={center.R} onChange={(R) => onChange({ ...ctrl, R: Math.max(1e-6, R) })} />
      </div>
    );
  }
  return <p className="text-sm text-mute">Open loop: no controller.</p>;
}

// ---------------------------------------------------------------------------
// Metrics strip
// ---------------------------------------------------------------------------

export function SpecStrip({ checks, metrics, pm, unit }: { checks: SpecCheck[]; metrics: Metrics; pm: number; unit: string }) {
  const extra = [
    { label: "Rise time", value: metrics.riseTime < 0 ? "—" : `${fmtNum(metrics.riseTime)} s` },
    { label: "Phase margin", value: pm >= 1e8 ? "∞" : `${fmtNum(pm)}°` },
    { label: "Peak |u|", value: `${fmtNum(metrics.maxAbsU)} ${unit}` },
  ];
  return (
    <div className="grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-4 xl:grid-cols-7">
      {checks.map((c) => (
        <div key={c.key} className="bg-panel px-3 py-2.5">
          <p className="mono-label flex items-center justify-between text-[10px] text-dim">
            {c.label}
            <span className={`size-1.5 rounded-full ${c.pass ? "bg-ok" : "bg-bad"}`} />
          </p>
          <motion.p key={c.value} initial={{ opacity: 0.3 }} animate={{ opacity: 1 }} className={`mt-1 font-mono text-[14px] tabular-nums ${c.pass ? "" : "text-bad"}`}>
            {c.value}
          </motion.p>
          <p className="font-mono text-[10px] text-dim">{c.target}</p>
        </div>
      ))}
      {extra.map((e) => (
        <div key={e.label} className="bg-panel px-3 py-2.5">
          <p className="mono-label text-[10px] text-dim">{e.label}</p>
          <p className="mt-1 font-mono text-[14px] tabular-nums">{e.value}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistant: ask the chosen Meta model, or tell it what to change (plus explain, tune, history)
// ---------------------------------------------------------------------------

/** The state before an assistant change, so it can be undone. */
export interface AssistSnapshot {
  build: HardwareBuild | null;
  machine: Assembly | null;
  ctrl: ControllerSpec | null;
}

export type ChatMsg =
  | { kind: "user"; text: string }
  | {
      kind: "assist";
      reply: string;
      mode: AssistResult["mode"];
      /** Changes made, in plain words; `snap` undoes them. */
      done: string[];
      skipped: string[];
      snap?: AssistSnapshot;
      undone?: boolean;
      /** Suggested changes, and which have been applied. */
      suggestions: AssistAction[];
      applied: number[];
      model: string;
      usage?: CallUsage;
    }
  | { kind: "advice"; advice: Advice & { notice?: string }; previews: { metrics: Metrics; cost: number }[]; forIteration: number; base: ControllerSpec }
  | { kind: "event"; text: string };

export function describeCtrl(c: ControllerSpec): string {
  if (c.type === "pid") return `Kp ${fmtNum(c.kp)} · Ki ${fmtNum(c.ki)} · Kd ${fmtNum(c.kd)} · N ${fmtNum(c.N)}`;
  if (c.type === "lqr") return `Q [${c.Q.map((q) => fmtNum(q)).join(", ")}] · R ${fmtNum(c.R)}`;
  return "open loop";
}

export function diffCtrl(a: ControllerSpec, b: ControllerSpec): string {
  if (a.type === "pid" && b.type === "pid") {
    const parts = (["kp", "ki", "kd", "N"] as const)
      .filter((k) => Math.abs(a[k] - b[k]) > 1e-9 * Math.max(1, Math.abs(a[k])))
      .map((k) => `${k === "N" ? "N" : k[0].toUpperCase() + k.slice(1)} ${fmtNum(a[k])} → ${fmtNum(b[k])}`);
    return parts.join(" · ") || "no change";
  }
  return describeCtrl(b);
}

export function Assistant({
  messages,
  iterations,
  current,
  busy,
  onAsk,
  onApply,
  onAuto,
  onTune,
  onRestore,
  ready,
  specOk,
  aiOn = false,
  modelName,
  simple = false,
  onAssist,
  onUndo,
  onApplySuggestion,
}: {
  messages: ChatMsg[];
  iterations: Iteration[];
  current: ControllerSpec | null;
  busy: string | null;
  onAsk: (q?: string) => void;
  onApply: (c: ControllerSpec, label: string) => void;
  onAuto: () => void;
  onTune: () => void;
  onRestore: (it: Iteration) => void;
  ready: boolean;
  specOk: boolean;
  /** Live AI is on, so Explain and questions spend credit. */
  aiOn?: boolean;
  /** The Meta model chosen in the top bar (Muse Spark or Muse Wonder). */
  modelName: string;
  /** Simple mode: just the conversation, no tuning tools. */
  simple?: boolean;
  onAssist: (q: string) => void;
  onUndo: (index: number) => void;
  onApplySuggestion: (index: number, action: number) => void;
}) {
  const [q, setQ] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SectionLabel right={busy && <Loader2 className="size-3.5 animate-spin text-mute" />}>Robo Copilot · {modelName}</SectionLabel>
      {!simple && iterations.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-line px-4 py-2.5 [scrollbar-width:none]">
          {iterations.map((it) => {
            const ok = it.analysis.metrics.stable === 1;
            const on = current && JSON.stringify(current) === JSON.stringify(it.controller);
            return (
              <motion.button
                key={it.id}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => onRestore(it)}
                title={`${it.label}: ${describeCtrl(it.controller)}`}
                className={`rounded-xl shrink-0 border px-2 py-1 text-left font-mono text-[10px] transition-colors ${on ? "border-fg/50 bg-panel-2" : "border-line hover:border-line-2"}`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`size-1.5 rounded-full ${ok ? "bg-ok" : "bg-bad"}`} />v{it.id}
                </span>
                <span className="text-dim">{ok ? `${it.analysis.metrics.overshootPct.toFixed(0)}% OS` : "unstable"}</span>
              </motion.button>
            );
          })}
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 [scrollbar-width:thin]">
        {!messages.some((m) => m.kind === "user" || m.kind === "assist") && (
          <div className="space-y-2 text-[13px] leading-relaxed text-mute">
            <p>
              Ask Robo Copilot about this machine, or tell it what to change. It sees every part, check and number in the lab, makes the change for you, and the
              simulation re-checks it.
            </p>
            {ready && aiOn && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {["Fix the problems", "Make it cheaper", "Why is it failing?"].map((p) => (
                  <button key={p} onClick={() => onAssist(p)} disabled={!!busy} className="rounded-full border border-line-2 px-2.5 py-1 text-[12px] text-fg transition-colors hover:bg-panel-2 disabled:opacity-40">
                    {p}
                  </button>
                ))}
              </div>
            )}
            {!aiOn && <p className="text-[12px] text-warn">Live AI is paused on this server, so questions can&apos;t be answered right now. The checks, one-click fixes and auto-tune still work.</p>}
          </div>
        )}
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
              {m.kind === "user" && <div className="ml-auto max-w-[85%] rounded-2xl bg-panel-2 px-3 py-2 text-[13px]">{m.text}</div>}
              {m.kind === "assist" && (
                <div className="border-l-2 pl-3" style={{ borderImage: "var(--spectrum) 1" }}>
                  <p className="text-[13px] leading-relaxed">{m.reply}</p>
                  {m.done.length > 0 && (
                    <div className={`mt-2 rounded-xl border border-line bg-void p-2.5 ${m.undone ? "opacity-50" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11.5px] font-medium text-ok">{m.undone ? "Undone" : "Changed"}</p>
                        {m.snap && !m.undone && (
                          <button onClick={() => onUndo(i)} disabled={!!busy} className="rounded-lg border border-line-2 px-2 py-0.5 text-[11px] text-fg transition-colors hover:bg-panel-2 disabled:opacity-40">
                            Undo
                          </button>
                        )}
                      </div>
                      <ul className="mt-1 space-y-0.5 text-[12px] text-mute">
                        {m.done.map((d) => (
                          <li key={d} className="flex gap-1.5">
                            <span className="text-dim">▸</span>
                            {d}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {m.suggestions.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {m.suggestions.map((a, j) => (
                        <div key={j} className="flex items-start justify-between gap-2 rounded-xl border border-line bg-void p-2.5">
                          <p className="min-w-0 text-[12px] leading-snug text-mute">
                            <span className="font-medium text-fg">{actionLabel(a)}</span>
                            <br />
                            {a.why}
                          </p>
                          <button
                            onClick={() => onApplySuggestion(i, j)}
                            disabled={!!busy || m.applied.includes(j)}
                            className="shrink-0 rounded-lg border border-line-2 px-2 py-0.5 text-[11px] text-fg transition-colors hover:bg-panel-2 disabled:opacity-40"
                          >
                            {m.applied.includes(j) ? "Applied" : "Apply"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.skipped.length > 0 && <p className="mt-1.5 text-[11.5px] text-warn">{m.skipped.join(" ")}</p>}
                  <p className="mono-label mt-2 text-[9px] text-dim">
                    {m.model}
                    {usageNote(m.usage)}
                  </p>
                </div>
              )}
              {m.kind === "event" && (
                <p className="mono-label flex items-center gap-2 text-[10px] text-dim">
                  <span className="h-px flex-1 bg-line" />
                  {m.text}
                  <span className="h-px flex-1 bg-line" />
                </p>
              )}
              {m.kind === "advice" && (
                <div className="border-l-2 pl-3" style={{ borderImage: "var(--spectrum) 1" }}>
                  <p className="flex items-start gap-1.5 text-[13px] font-medium">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
                    {m.advice.headline}
                  </p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-mute">{m.advice.explanation}</p>
                  {m.advice.diagnosis.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-[12px] text-mute">
                      {m.advice.diagnosis.map((d) => (
                        <li key={d} className="flex gap-1.5">
                          <span className="text-dim">▸</span>
                          {d}
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.advice.notice && <p className="mt-2 text-[11px] text-warn/80">{m.advice.notice}</p>}
                  <div className="mt-3 space-y-2">
                    {m.advice.proposals.map((p, j) => {
                      const pv = m.previews[j];
                      const applied = current && JSON.stringify(current) === JSON.stringify(p.controller);
                      return (
                        <div key={j} className="border border-line bg-void p-2.5 rounded-xl">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[12px] font-medium">{p.label}</p>
                              <p className="mt-0.5 font-mono text-[10px] break-words text-spec-1">{diffCtrl(m.base, p.controller)}</p>
                            </div>
                            <button
                              onClick={() => onApply(p.controller, p.label)}
                              disabled={!!busy || !!applied}
                              className="mono-label shrink-0 border border-line-2 px-2 py-1 text-[10px] text-fg transition-colors hover:bg-panel-2 disabled:opacity-40 rounded-xl"
                            >
                              {applied ? "Applied" : "Apply"}
                            </button>
                          </div>
                          <p className="mt-1 text-[11px] leading-snug text-mute">{p.rationale}</p>
                          {pv && (
                            <p className="mt-1.5 font-mono text-[10px] text-dim">
                              predicted: {pv.metrics.stable ? `${pv.metrics.overshootPct.toFixed(1)}% OS · Ts ${pv.metrics.settlingTime < 0 ? "—" : fmtNum(pv.metrics.settlingTime) + " s"}` : "unstable"}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mono-label mt-2 text-[9px] text-dim">{m.advice.source === "meta" ? modelName : "Offline advisor"} · on v{m.forIteration}
                    {usageNote(m.advice.usage)}
                  </p>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={endRef} />
      </div>
      <div className="border-t border-line p-3">
        {!simple && (
        <div className="mb-2 grid grid-cols-3 gap-1.5">
          <GhostButton
            onClick={() => onAsk()}
            disabled={!ready || !!busy}
            className="justify-center"
            title={aiOn ? `Ask ${modelName} to explain this response (a live call, about 1¢)` : "Explain with the offline advisor"}
          >
            <Lightbulb className="size-3" /> Explain
          </GhostButton>
          <GhostButton onClick={onTune} disabled={!ready || !!busy} className="justify-center">
            <SlidersHorizontal className="size-3" /> Auto-tune
          </GhostButton>
          <GhostButton onClick={onAuto} disabled={!ready || !!busy} className={`justify-center ${specOk ? "" : "border-fg/30 text-fg"}`}>
            {busy === "auto" ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />} Iterate
          </GhostButton>
        </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!q.trim()) return;
            onAssist(q.trim());
            setQ("");
          }}
          className="flex items-center border border-line-2 bg-void focus-within:border-fg/40 rounded-xl"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={!ready || !aiOn}
            placeholder={!ready ? "Build a machine first" : !aiOn ? "Live AI is paused" : "Ask, or say what to change…"}
            className="h-9 min-w-0 flex-1 bg-transparent px-3 text-[13px] outline-none placeholder:text-dim"
          />
          <button type="submit" disabled={!ready || !aiOn || !!busy || !q.trim()} className="flex size-9 items-center justify-center text-mute hover:text-fg disabled:opacity-30">
            <Send className="size-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

/** A suggested change in plain words. */
function actionLabel(a: AssistAction): string {
  if (a.kind === "swap_part" || a.kind === "swap_machine_part") return `Swap ${a.target.replace(/_/g, " ")} → ${a.value}`;
  if (a.kind === "set_size") return `Set ${a.target.replace(/_/g, " ")} to ${a.value}`;
  if (a.kind === "apply_fix") return "Apply the fix for this check";
  return `Gains: Kp ${fmtNum(a.kp)} · Ki ${fmtNum(a.ki)} · Kd ${fmtNum(a.kd)}`;
}

// ---------------------------------------------------------------------------
// Validation + code
// ---------------------------------------------------------------------------

export function ValidatePanel({ results, running, total, onRun, refValue }: { results: CheckResult[]; running: boolean; total: number; onRun: () => void; refValue: number }) {
  const robust = results.find((r) => r.id === "robust");
  const palette = ["#2dd4ff", "#9b5cff", "#d946ef", "#ff8ac4"];
  const passed = results.filter((r) => r.verdict === "pass").length;
  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[15px] font-medium">Pre-hardware validation</p>
          <p className="text-[13px] text-mute">Stability, margins, specs, actuator limits, robustness, noise, disturbances and an engine cross-check.</p>
        </div>
        <PrimaryButton onClick={onRun} disabled={running}>
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} {results.length ? "Run again" : "Run validation"}
        </PrimaryButton>
      </div>
      {results.length > 0 && (
        <div className="mb-3 h-px w-full bg-line">
          <motion.div className="h-px" style={{ background: "var(--spectrum)" }} animate={{ width: `${(results.length / total) * 100}%` }} />
        </div>
      )}
      <ul className="divide-y divide-line border-y border-line">
        <AnimatePresence initial={false}>
          {results.map((r) => (
            <motion.li key={r.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex items-start gap-3 py-2.5">
              <VerdictIcon verdict={r.verdict} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center justify-between gap-2 text-[13px]">
                  {r.label}
                  <span className="mono-label shrink-0 text-[9px] text-dim">{r.group}</span>
                </p>
                <p className="font-mono text-[11px] text-mute">{r.detail}</p>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {!running && results.length === total && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mono-label mt-3 text-mute">
          {passed}/{total} passed · {results.filter((r) => r.verdict === "warn").length} warnings · {results.filter((r) => r.verdict === "fail").length} failures
        </motion.p>
      )}
      {robust?.traces && (
        <div className="mt-5">
          <p className="mono-label mb-2 text-dim">Robustness: same controller, perturbed plants</p>
          <TimeChart
            className="h-48"
            refValue={refValue}
            series={robust.traces.map((t, i) => ({ y: t.y, dt: t.dt, label: t.label, color: palette[i % palette.length], width: 1.2 }))}
          />
        </div>
      )}
    </div>
  );
}

export function CodePanel({ code, ts, filename, machine = false }: { code: string; ts: number; filename: string; machine?: boolean }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => code.split("\n"), [code]);
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[15px] font-medium">Firmware</p>
          <p className="text-[13px] text-mute">
            {machine
              ? "Generated from this design: pins from its wiring, motion from its program, logic from its rules (with the same hysteresis as the simulation)."
              : `The same discrete controller the simulator runs, at a ${ts * 1000} ms sample time (≈20 samples per crossover period).`}
          </p>
        </div>
        <div className="flex gap-2">
          <GhostButton
            onClick={() => {
              void navigator.clipboard.writeText(code).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? "Copied" : "Copy"}
          </GhostButton>
          <GhostButton
            onClick={() => {
              const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
              const a = Object.assign(document.createElement("a"), { href: url, download: filename });
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="size-3" /> .ino
          </GhostButton>
        </div>
      </div>
      <pre className="max-h-[520px] overflow-auto border border-line bg-void p-3 font-mono text-[11.5px] leading-relaxed rounded-xl">
        {lines.map((l, i) => (
          <div key={i} className="flex">
            <span className="w-8 shrink-0 pr-3 text-right text-dim select-none">{i + 1}</span>
            <span className={l.trimStart().startsWith("//") ? "text-dim" : ""}>{l || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
