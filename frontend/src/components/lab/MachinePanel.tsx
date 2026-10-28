"use client";

// The engineering editor for AI-designed machines: the part tree with specs and masses, an
// inspector for every property, add / duplicate / delete, motion bindings, undo, and a button to
// have Muse Spark re-derive the physics from the edited design.
import { ChevronRight, Copy, Loader2, Move3d, Plus, RefreshCw, RotateCw, Trash2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  MATERIALS,
  MOTION_KINDS,
  SHAPES,
  addPart,
  childrenOf,
  deletePart,
  duplicatePart,
  setMotion,
  totalMassG,
  updatePart,
  type Assembly,
  type MotionSpec,
  type PartSpec,
} from "@/lib/lab/assembly";
import type { Review } from "@/lib/lab/review";
import ReviewCard from "./ReviewCard";

const field = "w-full min-w-0 border border-line-2 bg-void px-1.5 py-1 font-mono text-[11.5px] outline-none focus:border-spec-1/60";
const label = "mono-label text-[9px] text-dim";

/** A number input that commits on Enter or blur, so typing doesn't flood the undo history. */
function NumField({ value, onCommit, step = 1, title }: { value: number; onCommit: (v: number) => void; step?: number; title?: string }) {
  // null while not typing, so the field always shows the current value.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const v = Number(draft);
    if (draft !== null && Number.isFinite(v) && v !== value) onCommit(v);
    setDraft(null);
  };
  return (
    <input
      className={field}
      type="number"
      step={step}
      value={draft ?? String(value)}
      title={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

function TextField({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={field}
      value={draft ?? value}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

function Vec({ name, unit, value, scale, step, onCommit }: { name: string; unit: string; value: number[]; scale: number; step: number; onCommit: (v: [number, number, number]) => void }) {
  return (
    <div>
      <p className={label}>
        {name} <span className="normal-case">({unit})</span>
      </p>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {[0, 1, 2].map((i) => (
          <NumField
            key={i}
            title={"xyz"[i]}
            step={step}
            value={Math.round(value[i] * scale * 100) / 100}
            onCommit={(v) => {
              const next = [...value] as [number, number, number];
              next[i] = v / scale;
              onCommit(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Parts that may become this part's parent: anything except itself and what's attached to it. */
function parentOptions(a: Assembly, id: string): PartSpec[] {
  const kids = childrenOf(a);
  const banned = new Set<string>();
  const walk = (p: string) => {
    banned.add(p);
    for (const k of kids.get(p) ?? []) walk(k.id);
  };
  walk(id);
  return a.parts.filter((p) => !banned.has(p.id));
}

export default function MachinePanel({
  assembly,
  selected,
  onSelect,
  onChange,
  canUndo,
  onUndo,
  onUpdatePhysics,
  busy,
  aiOn,
  review,
}: {
  review?: Review;
  assembly: Assembly;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (next: Assembly, note: string) => void;
  canUndo: boolean;
  onUndo: () => void;
  onUpdatePhysics: () => void;
  busy: boolean;
  aiOn: boolean;
}) {
  const kids = useMemo(() => childrenOf(assembly), [assembly]);
  const part = assembly.parts.find((p) => p.id === selected) ?? null;
  const moving = useMemo(() => new Map(assembly.motions.map((m) => [m.part, m])), [assembly.motions]);
  const mass = totalMassG(assembly);
  const edit = (patch: Partial<PartSpec>, note: string) => part && onChange(updatePart(assembly, part.id, patch), note);

  const tree = (parent: string, depth: number): React.ReactNode =>
    (kids.get(parent) ?? []).map((p) => (
      <div key={p.id}>
        <button
          onClick={() => onSelect(p.id === selected ? null : p.id)}
          className={`flex w-full items-center gap-1.5 py-1 pr-3 text-left transition-colors ${p.id === selected ? "bg-spec-1/10 text-fg" : "text-mute hover:bg-panel-2"}`}
          style={{ paddingLeft: 12 + depth * 12 }}
        >
          <ChevronRight className={`size-3 shrink-0 ${kids.get(p.id)?.length ? "text-dim" : "opacity-0"}`} />
          <span className="min-w-0 flex-1 truncate text-[12px]">
            {p.name}
            {p.repeat > 1 && <span className="text-dim"> ×{p.repeat}</span>}
          </span>
          {moving.has(p.id) && <RotateCw className="size-3 shrink-0 text-spec-2" aria-label="moves" />}
          <span className="shrink-0 font-mono text-[10px] text-dim">{p.massG * p.repeat} g</span>
        </button>
        {tree(p.id, depth + 1)}
      </div>
    ));

  const m = part ? moving.get(part.id) : undefined;
  const setPartMotion = (patch: Partial<Omit<MotionSpec, "part">> | null) => {
    if (!part) return;
    if (patch === null) return onChange(setMotion(assembly, part.id, null), `${part.name} no longer moves`);
    const base = m ?? { kind: "spin" as const, axis: "y" as const, gain: 1 };
    onChange(setMotion(assembly, part.id, { kind: base.kind, axis: base.axis, gain: base.gain, ...patch }), `${part.name} motion changed`);
  };

  return (
    <div className="pb-4">
      {review && <ReviewCard review={review} />}
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">{assembly.title}</p>
          <p className="font-mono text-[10px] text-dim">
            {assembly.parts.length} parts · {mass >= 1000 ? `${(mass / 1000).toFixed(2)} kg` : `${Math.round(mass)} g`}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" className="flex size-7 items-center justify-center border border-line-2 text-mute hover:text-fg disabled:opacity-30">
            <Undo2 className="size-3.5" />
          </button>
          <button
            onClick={() => {
              const r = addPart(assembly, selected ?? "");
              onChange(r.assembly, "added a part");
              onSelect(r.id);
            }}
            title={selected ? "Add a part attached to the selected one" : "Add a part"}
            className="flex size-7 items-center justify-center border border-line-2 text-mute hover:text-fg"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="max-h-[34vh] overflow-y-auto border-b border-line py-1 [scrollbar-width:thin]">{tree("", 0)}</div>

      {part ? (
        <div className="space-y-3 px-4 pt-3">
          <div className="flex items-center justify-between">
            <p className="mono-label flex items-center gap-1.5 text-[10px] text-spec-1">
              <Move3d className="size-3.5" /> Selected part
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  const r = duplicatePart(assembly, part.id);
                  onChange(r.assembly, `duplicated ${part.name}`);
                  onSelect(r.id);
                }}
                title="Duplicate"
                className="flex size-7 items-center justify-center border border-line-2 text-mute hover:text-fg"
              >
                <Copy className="size-3.5" />
              </button>
              <button
                onClick={() => {
                  onChange(deletePart(assembly, part.id), `deleted ${part.name}`);
                  onSelect(null);
                }}
                disabled={assembly.parts.length <= 1}
                title="Delete (with everything attached to it)"
                className="flex size-7 items-center justify-center border border-line-2 text-mute hover:border-bad/50 hover:text-bad disabled:opacity-30"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>

          <div>
            <p className={label}>Name</p>
            <TextField value={part.name} onCommit={(v) => edit({ name: v }, `renamed to ${v}`)} />
          </div>
          <div>
            <p className={label}>Spec</p>
            <TextField value={part.spec} placeholder="e.g. 6 mm steel shaft, h6" onCommit={(v) => edit({ spec: v }, `${part.name} spec changed`)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className={label}>Shape</p>
              <select className={field} value={part.shape} onChange={(e) => edit({ shape: e.target.value as PartSpec["shape"] }, `${part.name} shape changed`)}>
                {SHAPES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className={label}>Mass (g, each)</p>
              <NumField value={part.massG} step={0.1} onCommit={(v) => edit({ massG: Math.max(0, v) }, `${part.name} mass changed`)} />
            </div>
            <div>
              <p className={label}>Material</p>
              <select className={field} value={part.material} onChange={(e) => edit({ material: e.target.value as PartSpec["material"] }, `${part.name} material changed`)}>
                {MATERIALS.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className={label}>Colour</p>
              <div className="flex gap-1">
                <input
                  type="color"
                  className="h-[26px] w-full cursor-pointer border border-line-2 bg-void"
                  value={part.color || "#c9ced6"}
                  onChange={(e) => edit({ color: e.target.value }, `${part.name} colour changed`)}
                />
                {part.color && (
                  <button onClick={() => edit({ color: "" }, `${part.name} colour reset`)} className="mono-label px-1 text-[9px] text-dim hover:text-fg" title="Use the material's colour">
                    auto
                  </button>
                )}
              </div>
            </div>
          </div>

          <Vec name="Size" unit="mm" value={part.size} scale={1000} step={1} onCommit={(v) => edit({ size: v.map((x) => Math.max(0.0005, x)) }, `${part.name} resized`)} />
          <Vec name="Position" unit="mm, from parent" value={part.position} scale={1000} step={1} onCommit={(v) => edit({ position: v }, `${part.name} moved`)} />
          <Vec name="Rotation" unit="°" value={part.rotation} scale={1} step={5} onCommit={(v) => edit({ rotation: v }, `${part.name} rotated`)} />

          <div>
            <p className={label}>Attached to</p>
            <select className={field} value={part.parent} onChange={(e) => edit({ parent: e.target.value }, `${part.name} re-attached`)}>
              <option value="">— the world —</option>
              {parentOptions(assembly, part.id).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-4 gap-1">
            <div>
              <p className={label}>Copies</p>
              <NumField value={part.repeat} onCommit={(v) => edit({ repeat: Math.max(1, Math.min(36, Math.round(v))) }, `${part.name} copies changed`)} />
            </div>
            <div className="col-span-1">
              <p className={label}>Pattern</p>
              <select className={field} value={part.repeatMode} onChange={(e) => edit({ repeatMode: e.target.value as PartSpec["repeatMode"] }, `${part.name} pattern changed`)}>
                <option value="radial">radial</option>
                <option value="linear">linear</option>
              </select>
            </div>
            <div>
              <p className={label}>Axis</p>
              <select className={field} value={part.repeatAxis} onChange={(e) => edit({ repeatAxis: e.target.value as PartSpec["repeatAxis"] }, `${part.name} pattern axis changed`)}>
                {["x", "y", "z"].map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <p className={label}>{part.repeatMode === "radial" ? "Step °" : "Step mm"}</p>
              <NumField
                value={part.repeatMode === "radial" ? part.repeatStep : Math.round(part.repeatStep * 1000 * 100) / 100}
                onCommit={(v) => edit({ repeatStep: part.repeatMode === "radial" ? v : v / 1000 }, `${part.name} pattern spacing changed`)}
              />
            </div>
          </div>

          <div className="border-t border-line pt-3">
            <p className={label}>Moves with the simulation</p>
            <div className="mt-1 grid grid-cols-3 gap-1">
              <select className={field} value={m?.kind ?? "none"} onChange={(e) => setPartMotion(e.target.value === "none" ? null : { kind: e.target.value as MotionSpec["kind"] })}>
                <option value="none">doesn&apos;t move</option>
                {MOTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              {m && (
                <>
                  <select className={field} value={m.axis} disabled={m.kind === "lift"} onChange={(e) => setPartMotion({ axis: e.target.value as MotionSpec["axis"] })}>
                    {["x", "y", "z"].map((a) => (
                      <option key={a} value={a}>
                        {a} axis
                      </option>
                    ))}
                  </select>
                  <NumField value={m.gain} step={0.01} title="Gain: how far it moves per unit of the simulated output" onCommit={(v) => setPartMotion({ gain: v || 1 })} />
                </>
              )}
            </div>
            {m && <p className="mt-1 text-[10.5px] text-dim">{m.kind === "spin" ? "rad/s per unit of output" : m.kind === "rotate" ? "radians per unit of output" : "metres per unit of output"}</p>}
          </div>
        </div>
      ) : (
        <p className="px-4 pt-3 text-[12px] leading-relaxed text-dim">
          Click a part in the 3D view or in the list to select it. Drag it with the gizmo (G to move, R to rotate) or edit every property here.
        </p>
      )}

      <div className="mx-4 mt-4 border-t border-line pt-3">
        <button
          onClick={onUpdatePhysics}
          disabled={busy || !aiOn}
          className="meta-ring inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-void text-[12.5px] font-semibold disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5 text-spec-2" />} Update physics from this design
        </button>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-dim">
          Edits change the 3D model right away. To make masses, sizes and specs change the simulation too, Muse Spark re-derives the physics from this parts list
          (one live call, about 1.5¢).
        </p>
      </div>
    </div>
  );
}
