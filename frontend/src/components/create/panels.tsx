"use client";

// The workspace's side panels: the prompt (create or change, typed or spoken), the part inspector,
// and the task timeline. Engineering lives in EngineeringPanel.
import { AlertTriangle, ArrowUp, CheckCircle2, Loader2, Mic, MicOff } from "lucide-react";
import { useState } from "react";
import { MATERIALS, ROLES, SHAPES, nodeMassKg, type Design, type NodeSpec, type ObjectSpec } from "@/lib/create/design";
import { usePlayback } from "@/lib/create/playback";
import type { Recording } from "@/lib/create/sim";
import { useSpeech } from "@/components/lab/useSpeech";
import { Button, IconButton, cx } from "./ui";

// ------------------------------------------------------------------------------ prompt

export function PromptBox({ placeholder, busy, onSubmit, submitLabel, examples, autoFocus, large }: { placeholder: string; busy: boolean; onSubmit: (text: string) => void; submitLabel: string; examples?: string[]; autoFocus?: boolean; large?: boolean }) {
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const speech = useSpeech((final, live) => {
    if (final) setText((t) => `${t.replace(/\s+$/, "")}${t ? " " : ""}${final}`.slice(0, 4000));
    setInterim(live);
  });
  const send = () => {
    const v = text.trim();
    if (!v || busy) return;
    onSubmit(v);
    setText("");
  };
  return (
    <div>
      <div className={cx("rounded-2xl bg-surface shadow-[0_0_0_1px_var(--color-line-2),0_12px_40px_-24px_rgb(0_0_0/0.35)] transition-shadow focus-within:shadow-[0_0_0_2px_var(--color-accent),0_12px_40px_-20px_var(--color-accent)]")}>
        <textarea
          value={interim ? `${text} ${interim}` : text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
              e.preventDefault();
              send();
            }
          }}
          rows={large ? 4 : 3}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className={cx("w-full resize-none bg-transparent px-4 pt-3.5 text-fg outline-none placeholder:text-dim", large ? "text-[15.5px] leading-relaxed" : "text-[14px] leading-relaxed")}
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
          <IconButton label={speech.listening ? "Stop dictating" : speech.supported ? "Speak instead" : "Voice input isn't supported in this browser"} disabled={!speech.supported} onClick={speech.toggle} active={speech.listening}>
            {speech.listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </IconButton>
          <div className="flex items-center gap-2">
            {speech.listening && <span className="text-[12px] text-accent">Listening…</span>}
            <Button variant="primary" size={large ? "md" : "sm"} disabled={!text.trim() || busy} onClick={send}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              {submitLabel}
            </Button>
          </div>
        </div>
      </div>
      {speech.error && <p className="mt-2 text-[12px] text-bad">{speech.error}</p>}
      {examples && (
        <div className="mt-3 flex flex-wrap gap-2">
          {examples.map((e) => (
            <button key={e} onClick={() => setText(e)} className="rounded-full bg-surface-2 px-3 py-1.5 text-left text-[12.5px] text-mute transition-colors hover:bg-accent-soft hover:text-fg">
              {e.length > 70 ? `${e.slice(0, 68)}…` : e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------ inspector

function Num({ label, value, onCommit, step = 0.001, unit }: { label: string; value: number; onCommit: (v: number) => void; step?: number; unit?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    if (Number.isFinite(v)) onCommit(v);
    setDraft(null);
  };
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-mute">{label}</span>
      <div className="flex h-8 items-center rounded-lg bg-surface-2 px-2 focus-within:ring-2 focus-within:ring-accent">
        <input
          type="number"
          step={step}
          value={draft ?? Number(value.toFixed(4))}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="w-full min-w-0 bg-transparent text-[12.5px] text-fg tabular-nums outline-none"
        />
        {unit && <span className="text-[11px] text-dim">{unit}</span>}
      </div>
    </label>
  );
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-mute">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="h-8 rounded-lg bg-surface-2 px-2 text-[12.5px] text-fg outline-none focus:ring-2 focus:ring-accent">
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

function Vec({ label, value, onCommit, unit, step }: { label: string; value: number[]; onCommit: (v: number[]) => void; unit?: string; step?: number }) {
  return (
    <div>
      <p className="mb-1 text-[11px] text-mute">{label}</p>
      <div className="grid grid-cols-3 gap-1.5">
        {["x", "y", "z"].map((a, i) => (
          <Num key={a} label={a} value={value[i] ?? 0} step={step} unit={unit} onCommit={(v) => onCommit(value.map((x, k) => (k === i ? v : x)))} />
        ))}
      </div>
    </div>
  );
}

/** Edit the selected robot part or scene object. Changes apply at once and re-simulate. */
export function Inspector({ design, selected, onChange }: { design: Design; selected: string; onChange: (d: Design, what: string) => void }) {
  const node = design.robot.nodes.find((n) => n.id === selected);
  const obj = design.scene.find((o) => o.id === selected);
  if (!node && !obj) return <p className="text-[13px] text-mute">Click any part of the robot or the scene to inspect and edit it.</p>;
  const item = (node ?? obj)!;
  const set = (patch: Partial<NodeSpec & ObjectSpec>) => {
    const what = `Edited ${item.name}`;
    if (node) onChange({ ...design, robot: { ...design.robot, nodes: design.robot.nodes.map((n) => (n.id === node.id ? { ...n, ...patch } : n)) } }, what);
    else onChange({ ...design, scene: design.scene.map((o) => (o.id === obj!.id ? { ...o, ...patch } : o)) }, what);
  };
  const j = item.joint;
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-[15px] font-semibold">{item.name}</h3>
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-mute">{node ? node.role.replace(/_/g, " ") : obj!.kind}</span>
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-dim">
          {item.id}
          {node && ` · ${(nodeMassKg(node) * 1000).toFixed(0)} g`}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select label="Shape" value={item.shape} options={SHAPES} onChange={(shape) => set({ shape })} />
        <Select label="Material" value={item.material} options={MATERIALS} onChange={(material) => set({ material })} />
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-mute">Colour</span>
          <input type="color" value={item.color} onChange={(e) => set({ color: e.target.value })} className="h-8 w-full cursor-pointer rounded-lg bg-surface-2 p-1" />
        </label>
        {node ? <Select label="Role" value={node.role} options={ROLES} onChange={(role) => set({ role })} /> : <Num label="Mass" unit="kg" step={0.01} value={obj!.massKg} onCommit={(massKg) => set({ massKg: Math.max(0.01, massKg) })} />}
      </div>
      <Vec label="Size (m)" value={item.dims} onCommit={(dims) => set({ dims: dims.map((v) => Math.max(0.001, v)) })} />
      <Vec label="Position (m)" value={item.position} onCommit={(position) => set({ position })} />
      <Vec label="Rotation (°)" value={item.rotation} step={1} onCommit={(rotation) => set({ rotation })} />
      {j.type !== "fixed" && (
        <div className="space-y-2 rounded-xl bg-surface-2/60 p-3">
          <p className="text-[12px] font-semibold">
            {j.type === "revolute" ? "Revolute joint" : "Slide joint"} · axis [{j.axis.map((v) => Number(v.toFixed(2))).join(", ")}]
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            <Num label="Min" value={j.min} step={1} onCommit={(min) => set({ joint: { ...j, min: Math.min(min, j.max) } })} />
            <Num label="Max" value={j.max} step={1} onCommit={(max) => set({ joint: { ...j, max: Math.max(max, j.min) } })} />
            <Num label="Rest" value={j.rest} step={1} onCommit={(rest) => set({ joint: { ...j, rest: Math.max(j.min, Math.min(j.max, rest)) } })} />
          </div>
          {node && (
            <div className="grid grid-cols-2 gap-1.5">
              <Num label="Rated torque" unit="N·m" step={0.1} value={j.torqueNm} onCommit={(torqueNm) => set({ joint: { ...j, torqueNm: Math.max(0, torqueNm) } })} />
              <Num label="Speed" unit={j.type === "revolute" ? "°/s" : "m/s"} step={1} value={j.speed} onCommit={(speed) => set({ joint: { ...j, speed: Math.max(1e-3, speed) } })} />
            </div>
          )}
          {node && <p className="truncate text-[11.5px] text-mute">Actuator: {j.actuator.replace(/^need:/, "") || "none named"}</p>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------ task

export function TaskPanel({ design, recording }: { design: Design; recording: Recording | null }) {
  const t = usePlayback((s) => s.t);
  const set = usePlayback((s) => s.set);
  if (!design.task.length) return <p className="text-[13px] text-mute">This design has no task yet. Ask for one, e.g. &ldquo;make it pick up the cup and put it on the shelf&rdquo;.</p>;
  return (
    <ol className="space-y-1">
      {design.task.map((s, i) => {
        const r = recording?.steps[i];
        const active = r && t >= r.start && t < r.end;
        return (
          <li key={i}>
            <button
              onClick={() => r && set({ t: r.start + 0.01, playing: true })}
              className={cx("flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors", active ? "bg-accent-soft" : "hover:bg-surface-2")}
            >
              <span className={cx("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold", active ? "bg-accent text-accent-fg" : "bg-surface-2 text-mute")}>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug text-fg">{s.label}</span>
                <span className="block text-[11.5px] text-mute">
                  {s.action.replace(/_/g, " ")}
                  {s.target && ` · ${design.scene.find((o) => o.id === s.target)?.name ?? s.target}`}
                  {r && ` · ${(r.end - r.start).toFixed(1)} s`}
                </span>
                {r && !r.ok && <span className="mt-1 block text-[11.5px] text-warn">{r.note}</span>}
              </span>
              {r && (r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />)}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
