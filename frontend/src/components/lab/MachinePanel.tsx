"use client";

// The engineering editor for AI-designed machines built from real parts: engineering checks from the
// per-actuator simulation, the bill of materials, the part tree, an inspector (swap catalogue parts,
// size fabricated parts, move, attach), joints driven by real actuators, the motion program, undo,
// and re-deriving the physics from the edited design.
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Copy, ExternalLink, Info, Loader2, Move3d, Plus, RefreshCw, RotateCw, Trash2, Undo2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { simulateMachine, type MachineCheck } from "@/lib/lab/actuation";
import {
  FAB_KINDS,
  FAB_MATERIALS,
  JOINT_KINDS,
  actuatorParts,
  addPart,
  catalogOf,
  childrenOf,
  deletePart,
  duplicatePart,
  setFab,
  setJoint,
  setPartRef,
  totalMassG,
  updatePart,
  type Assembly,
  type JointSpec,
  type PartSpec,
} from "@/lib/lab/assembly";
import { CATALOG, CATALOG_BY_ID, type Category } from "@/lib/lab/catalog/parts";
import { supplierLinks } from "@/lib/lab/catalog/suppliers";
import type { Review } from "@/lib/lab/review";
import BomPanel from "./BomPanel";
import ReviewCard from "./ReviewCard";

const field = "w-full min-w-0 border border-line-2 bg-void px-1.5 py-1 font-mono text-[11.5px] outline-none focus:border-spec-1/60";
const label = "mono-label text-[9px] text-dim";

const CATEGORY_LABEL: Record<Category, string> = {
  servo: "Servos",
  motor: "DC gearmotors",
  stepper: "Steppers",
  controller: "Controllers",
  driver: "Drivers",
  sensor: "Sensors",
  power: "Power",
  structure: "Structure",
  wheel: "Wheels & tracks",
  kit: "Kits",
  electronics: "Electronics",
};

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

/** Pick any catalogue part (grouped by category) or a fabricated part. */
function PartPicker({ value, onPick }: { value: string; onPick: (ref: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<Category, typeof CATALOG>();
    for (const c of CATALOG) m.set(c.category, [...(m.get(c.category) ?? []), c]);
    return [...m.entries()];
  }, []);
  return (
    <select className={field} value={value} onChange={(e) => onPick(e.target.value)}>
      {!CATALOG_BY_ID.has(value) && !value.startsWith("fab:") && <option value={value}>{value}</option>}
      <optgroup label="Fabricated (PCBWay, makerspace)">
        {FAB_KINDS.map((k) => (
          <option key={k} value={`fab:${k}`}>
            {k === "plate" ? "Laser-cut plate" : k === "printed" ? "3D-printed part" : k === "extrusion" ? "2020 extrusion (cut)" : "Rod (cut)"}
          </option>
        ))}
      </optgroup>
      {groups.map(([cat, parts]) => (
        <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
          {parts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · ${p.priceUsd}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

const CHECK_ICON = { pass: CheckCircle2, info: Info, warn: AlertTriangle, error: XCircle };
const CHECK_CLS = { pass: "text-ok", info: "text-spec-1", warn: "text-warn", error: "text-bad" };

function Checks({ checks, onSelect }: { checks: MachineCheck[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const bad = checks.filter((c) => c.level === "error").length;
  const warn = checks.filter((c) => c.level === "warn").length;
  return (
    <div className="border-b border-line">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left">
        <span className="mono-label text-[10px] text-dim">
          Engineering checks ·{" "}
          <span className={bad ? "text-bad" : warn ? "text-warn" : "text-ok"}>{bad ? `${bad} to fix` : warn ? `${warn} warnings` : "all good"}</span>
        </span>
        <ChevronDown className={`size-3.5 text-dim transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <ul className="space-y-2 px-4 pb-3">
          {checks.map((c) => {
            const Icon = CHECK_ICON[c.level];
            return (
              <li key={c.id} className="text-[11.5px]">
                <button disabled={!c.part} onClick={() => c.part && onSelect(c.part)} className={`flex items-start gap-1.5 text-left ${CHECK_CLS[c.level]} ${c.part ? "hover:underline" : ""}`}>
                  <Icon className="mt-0.5 size-3 shrink-0" />
                  <span className="text-fg">{c.title}</span>
                </button>
                <p className="pl-[18px] leading-snug text-dim">{c.detail}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function JointEditor({ assembly, part, onChange }: { assembly: Assembly; part: PartSpec; onChange: (a: Assembly, note: string) => void }) {
  const j = assembly.joints.find((x) => x.part === part.id);
  const actuators = actuatorParts(assembly);
  const set = (patch: Partial<Omit<JointSpec, "part" | "id">> | null) => {
    if (patch === null) return onChange(setJoint(assembly, part.id, null), `${part.name} no longer moves`);
    const base = j ?? { actuator: actuators[0]?.id ?? "", kind: "rotate" as const, axis: "z" as const, min: -90, max: 90, loadG: Math.round(part.massG), leverMm: 50 };
    onChange(setJoint(assembly, part.id, { ...base, ...patch }), `${part.name} joint changed`);
  };
  const unit = j ? (j.kind === "spin" ? "rpm" : j.kind === "slide" || j.kind === "lift" ? "mm" : j.kind === "articulate" ? "stroke" : "°") : "";
  return (
    <div className="border-t border-line pt-3">
      <p className={label}>Joint · moves with the simulation</p>
      {!actuators.length ? (
        <p className="mt-1 text-[11px] text-dim">Add a servo, motor or stepper to the design first; joints are driven by real actuators.</p>
      ) : (
        <div className="mt-1 space-y-1.5">
          <div className="grid grid-cols-2 gap-1">
            <select className={field} value={j?.kind ?? "none"} onChange={(e) => set(e.target.value === "none" ? null : { kind: e.target.value as JointSpec["kind"] })}>
              <option value="none">fixed (doesn&apos;t move)</option>
              {JOINT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            {j && (
              <select className={field} value={j.axis} onChange={(e) => set({ axis: e.target.value as JointSpec["axis"] })} disabled={j.kind === "lift"}>
                {["x", "y", "z"].map((a) => (
                  <option key={a} value={a}>
                    {a} axis
                  </option>
                ))}
              </select>
            )}
          </div>
          {j && (
            <>
              <div>
                <p className={label}>Driven by</p>
                <select className={field} value={j.actuator} onChange={(e) => set({ actuator: e.target.value })}>
                  {actuators.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({catalogOf(a)?.name})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-4 gap-1">
                <div>
                  <p className={label}>Min {unit}</p>
                  <NumField value={j.min} onCommit={(v) => set({ min: v })} />
                </div>
                <div>
                  <p className={label}>Max {unit}</p>
                  <NumField value={j.max} onCommit={(v) => set({ max: v })} />
                </div>
                <div>
                  <p className={label}>Load g</p>
                  <NumField value={j.loadG} onCommit={(v) => set({ loadG: Math.max(0, v) })} />
                </div>
                <div>
                  <p className={label}>Lever mm</p>
                  <NumField value={j.leverMm} onCommit={(v) => set({ leverMm: Math.max(0, v) })} />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProgramEditor({ assembly, onChange }: { assembly: Assembly; onChange: (a: Assembly, note: string) => void }) {
  const [open, setOpen] = useState(false);
  const steps = assembly.program;
  const setSteps = (next: Assembly["program"], note: string) => onChange({ ...assembly, program: next }, note);
  return (
    <div className="border-b border-line">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left">
        <span className="mono-label text-[10px] text-dim">
          Motion program · {steps.length} steps · {steps.reduce((s, x) => s + x.duration, 0).toFixed(1)} s
        </span>
        <ChevronDown className={`size-3.5 text-dim transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-3">
          {steps.map((s, i) => (
            <div key={i} className="border border-line p-2">
              <div className="grid grid-cols-[1fr_64px_24px] gap-1">
                <TextField value={s.label} onCommit={(v) => setSteps(steps.map((x, k) => (k === i ? { ...x, label: v } : x)), "renamed a step")} />
                <NumField value={s.duration} step={0.1} title="seconds" onCommit={(v) => setSteps(steps.map((x, k) => (k === i ? { ...x, duration: Math.max(0.1, v) } : x)), "changed a step's time")} />
                <button onClick={() => setSteps(steps.filter((_, k) => k !== i), "removed a step")} className="text-dim hover:text-bad" aria-label="Remove step">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {assembly.joints.map((j) => {
                  const t = s.targets.find((x) => x.joint === j.id);
                  return (
                    <label key={j.id} className="text-[10px] text-dim">
                      {j.id}
                      <NumField
                        value={t?.value ?? NaN}
                        onCommit={(v) =>
                          setSteps(
                            steps.map((x, k) => (k === i ? { ...x, targets: [...x.targets.filter((q) => q.joint !== j.id), { joint: j.id, value: v }] } : x)),
                            `set ${j.id} in "${s.label}"`,
                          )
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <button
            onClick={() => setSteps([...steps, { label: `Step ${steps.length + 1}`, duration: 1, targets: [] }], "added a step")}
            className="mono-label inline-flex h-8 w-full items-center justify-center gap-1.5 border border-line-2 text-[10px] text-mute hover:text-fg"
          >
            <Plus className="size-3" /> Add step
          </button>
        </div>
      )}
    </div>
  );
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
  const sim = useMemo(() => simulateMachine(assembly), [assembly]);
  const part = assembly.parts.find((p) => p.id === selected) ?? null;
  const moving = useMemo(() => new Set(assembly.joints.map((j) => j.part)), [assembly.joints]);
  const mass = totalMassG(assembly);
  const edit = (patch: Partial<PartSpec>, note: string) => part && onChange(updatePart(assembly, part.id, patch), note);
  const cat = part ? catalogOf(part) : undefined;

  const tree = (parent: string, depth: number): React.ReactNode =>
    (kids.get(parent) ?? []).map((p) => (
      <div key={p.id}>
        <button
          onClick={() => onSelect(p.id === selected ? null : p.id)}
          className={`flex w-full items-center gap-1.5 py-1 pr-3 text-left transition-colors ${p.id === selected ? "bg-spec-1/10 text-fg" : "text-mute hover:bg-panel-2"}`}
          style={{ paddingLeft: 12 + depth * 12 }}
        >
          <ChevronRight className={`size-3 shrink-0 ${kids.get(p.id)?.length ? "text-dim" : "opacity-0"}`} />
          <span className={`min-w-0 flex-1 truncate text-[12px] ${p.kind === "need" ? "text-warn" : ""}`}>
            {p.name}
            {p.repeat > 1 && <span className="text-dim"> ×{p.repeat}</span>}
          </span>
          {moving.has(p.id) && <RotateCw className="size-3 shrink-0 text-spec-2" aria-label="moves" />}
          <span className="shrink-0 font-mono text-[10px] text-dim">{p.kind === "fab" ? "fab" : `$${(p.priceUsd * p.repeat).toFixed(0)}`}</span>
        </button>
        {tree(p.id, depth + 1)}
      </div>
    ));

  return (
    <div className="pb-4">
      {review && <ReviewCard review={review} />}
      <Checks checks={sim.checks} onSelect={(id) => onSelect(id)} />
      <BomPanel assembly={assembly} />
      <ProgramEditor assembly={assembly} onChange={onChange} />

      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">{assembly.title}</p>
          <p className="font-mono text-[10px] text-dim">
            {assembly.parts.length} parts · {mass >= 1000 ? `${(mass / 1000).toFixed(2)} kg` : `${Math.round(mass)} g`} · {assembly.joints.length} joints
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
            <p className={label}>Part</p>
            <PartPicker value={part.ref} onPick={(ref) => onChange(setPartRef(assembly, part.id, ref), `${part.name} → ${CATALOG_BY_ID.get(ref)?.name ?? ref}`)} />
          </div>

          {part.kind === "catalog" && cat && (
            <div className="border border-line px-2.5 py-2">
              <p className="text-[11.5px] leading-snug">{cat.spec}</p>
              <p className="mt-1 font-mono text-[10px] text-dim">
                {cat.dims.join(" × ")} mm · {cat.massG} g · ≈ ${cat.priceUsd}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-2">
                {supplierLinks(cat.suppliers.slice(0, 4), cat.search).map((l) => (
                  <a key={l.name} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono text-[10px] text-spec-1 hover:underline">
                    {l.name} <ExternalLink className="size-2.5" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {part.kind === "fab" && part.fab && (
            <div className="space-y-2 border border-line px-2.5 py-2">
              <p className="text-[11px] text-dim">{part.spec}</p>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <p className={label}>Material</p>
                  <select className={field} value={part.material} onChange={(e) => onChange(setFab(assembly, part.id, part.size, e.target.value), `${part.name} material changed`)}>
                    {FAB_MATERIALS[part.fab].map((m) => (
                      <option key={m} value={m}>
                        {m.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className={label}>Colour</p>
                  <input type="color" className="h-[26px] w-full cursor-pointer border border-line-2 bg-void" value={part.color || "#f0f0ee"} onChange={(e) => edit({ color: e.target.value }, `${part.name} colour changed`)} />
                </div>
              </div>
              <Vec
                name={part.fab === "plate" ? "Size: width, thickness, depth" : part.fab === "printed" ? "Size" : part.fab === "rod" ? "Ø, length" : "Profile, length"}
                unit="mm"
                value={part.size}
                scale={1000}
                step={1}
                onCommit={(v) => onChange(setFab(assembly, part.id, v, part.material), `${part.name} resized`)}
              />
              {part.fab === "plate" && <p className="text-[10px] text-dim">Thickness snaps to stock sheet: 2, 3, 4, 5 or 6 mm.</p>}
            </div>
          )}

          {part.kind === "need" && (
            <p className="border border-warn/40 bg-warn/5 px-2.5 py-2 text-[11.5px] text-warn">Not in the catalogue yet. Pick a catalogue part above, or rebuild to look it up online.</p>
          )}

          <Vec name="Position" unit="mm, from parent" value={part.position} scale={1000} step={1} onCommit={(v) => edit({ position: v }, `${part.name} moved`)} />
          <Vec name="Rotation" unit="°" value={part.rotation} scale={1} step={5} onCommit={(v) => edit({ rotation: v }, `${part.name} rotated`)} />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className={label}>Mounted on</p>
              <select className={field} value={part.parent} onChange={(e) => edit({ parent: e.target.value }, `${part.name} re-attached`)}>
                <option value="">— the world —</option>
                {parentOptions(assembly, part.id).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className={label}>Quantity</p>
              <NumField value={part.repeat} onCommit={(v) => edit({ repeat: Math.max(1, Math.min(36, Math.round(v))) }, `${part.name} quantity changed`)} />
            </div>
          </div>
          {part.repeat > 1 && (
            <div className="grid grid-cols-3 gap-1">
              <select className={field} value={part.repeatMode} onChange={(e) => edit({ repeatMode: e.target.value as PartSpec["repeatMode"] }, `${part.name} pattern changed`)}>
                <option value="radial">radial</option>
                <option value="linear">linear</option>
              </select>
              <select className={field} value={part.repeatAxis} onChange={(e) => edit({ repeatAxis: e.target.value as PartSpec["repeatAxis"] }, `${part.name} pattern axis changed`)}>
                {["x", "y", "z"].map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
              <NumField
                value={part.repeatMode === "radial" ? part.repeatStep : Math.round(part.repeatStep * 1000 * 100) / 100}
                title={part.repeatMode === "radial" ? "degrees between copies" : "mm between copies"}
                onCommit={(v) => edit({ repeatStep: part.repeatMode === "radial" ? v : v / 1000 }, `${part.name} spacing changed`)}
              />
            </div>
          )}

          <JointEditor assembly={assembly} part={part} onChange={onChange} />
        </div>
      ) : (
        <p className="px-4 pt-3 text-[12px] leading-relaxed text-dim">
          Click a part in the 3D view or in the list to select it. Swap it for another real part, move it with the gizmo (G move, R rotate), or give it a joint.
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
          Joints, torque and current re-simulate instantly as you edit. For the control-loop model (Scope, Poles & Bode), Muse Spark re-derives it from this parts list (one live call, about 1.5¢).
        </p>
      </div>
    </div>
  );
}
