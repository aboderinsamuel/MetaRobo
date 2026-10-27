"use client";

// Hardware side of the lab: pick parts and dimensions, read the design checks and bill of
// materials, and see the auto-generated wiring.
import { AlertTriangle, CheckCircle2, ChevronDown, Download, Info, Wand2, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { GEOMETRY, SLOTS } from "@/lib/lab/hardware/build";
import type { CheckLevel, DerivedHardware, DesignCheck, HardwareBuild, NetEdge, NetNode } from "@/lib/lab/hardware/build";
import type { SlotId } from "@/lib/lab/hardware/parts";
import { RIGS } from "@/lib/lab/rig";
import type { RigKind } from "@/lib/lab/types";

const LEVEL_ICON: Record<CheckLevel, typeof Info> = { pass: CheckCircle2, info: Info, warn: AlertTriangle, error: XCircle };
const LEVEL_CLS: Record<CheckLevel, string> = { pass: "text-ok", info: "text-spec-1", warn: "text-warn", error: "text-bad" };
const RANK: Record<CheckLevel, number> = { pass: 0, info: 1, warn: 2, error: 3 };

function worstFor(checks: DesignCheck[], slot: SlotId): CheckLevel | null {
  let w: CheckLevel | null = null;
  for (const c of checks) if (c.slot === slot && (c.level === "warn" || c.level === "error") && (!w || RANK[c.level] > RANK[w])) w = c.level;
  return w;
}

const RIG_ICON: Record<RigKind, React.ReactNode> = {
  rover: (
    <svg viewBox="0 0 32 20" className="h-5 w-8" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="5" width="24" height="7" rx="1.5" />
      <circle cx="9" cy="14" r="3.5" />
      <circle cx="23" cy="14" r="3.5" />
      <path d="M27 8h3" />
    </svg>
  ),
  arm: (
    <svg viewBox="0 0 32 20" className="h-5 w-8" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M6 18h10M11 18V12l7-7 7 4" />
      <circle cx="11" cy="12" r="1.6" />
      <circle cx="18" cy="5" r="1.6" />
      <path d="M25 9l2 2M25 9l3-1" />
    </svg>
  ),
  balancer: (
    <svg viewBox="0 0 32 20" className="h-5 w-8" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="12" y="1.5" width="8" height="13" rx="1.5" />
      <circle cx="16" cy="16" r="3" />
      <path d="M14 5h4" />
    </svg>
  ),
  drone: (
    <svg viewBox="0 0 32 20" className="h-5 w-8" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M8 6l16 8M24 6L8 14" />
      <rect x="13" y="8" width="6" height="4" rx="1" />
      <path d="M3 6h10M19 6h10M3 14h10M19 14h10" />
    </svg>
  ),
};

export function RigPicker({ kind, onPick, busy }: { kind: RigKind | null; onPick: (k: RigKind) => void; busy?: boolean }) {
  return (
    <div className="grid grid-cols-4 gap-px border-b border-line bg-line">
      {(Object.keys(RIGS) as RigKind[]).map((k) => (
        <button
          key={k}
          disabled={busy}
          onClick={() => onPick(k)}
          className={`group relative flex flex-col items-center gap-1 bg-void px-1 py-2.5 transition-colors disabled:opacity-50 ${kind === k ? "text-fg" : "text-dim hover:bg-panel hover:text-mute"}`}
        >
          {RIG_ICON[k]}
          <span className="mono-label text-[9px]">{k === "balancer" ? "balancer" : k}</span>
          {kind === k && <motion.span layoutId="rig-pick" className="absolute inset-x-2 bottom-0 h-px" style={{ background: "var(--spectrum)" }} />}
        </button>
      ))}
    </div>
  );
}

export function PartsPanel({
  hw,
  checks,
  selected,
  onSelect,
  onBuild,
}: {
  hw: DerivedHardware;
  checks: DesignCheck[];
  selected: SlotId | null;
  onSelect: (s: SlotId | null) => void;
  onBuild: (b: HardwareBuild, note: string) => void;
}) {
  return (
    <div className="divide-y divide-line">
      {SLOTS[hw.build.kind].map((s) => {
        const cur = s.options.find((o) => o.id === hw.build.parts[s.slot]) ?? s.options[0];
        const worst = worstFor(checks, s.slot);
        const on = selected === s.slot;
        return (
          <div key={s.slot} className={`px-4 py-2.5 transition-colors ${on ? "bg-spec-1/[0.06]" : ""}`}>
            <button onClick={() => onSelect(on ? null : s.slot)} className="mono-label flex w-full items-center justify-between text-[10px] text-dim hover:text-mute">
              <span className="flex items-center gap-1.5">
                <span className={`size-1.5 rounded-full ${worst === "error" ? "bg-bad" : worst === "warn" ? "bg-warn" : "bg-ok"}`} />
                {s.label}
                {s.qty > 1 && <span className="text-dim">× {s.qty}</span>}
              </span>
              <span className={on ? "text-spec-1" : ""}>{on ? "in view" : "locate"}</span>
            </button>
            <div className="relative mt-1.5">
              <select
                value={cur.id}
                onChange={(e) => {
                  const o = s.options.find((x) => x.id === e.target.value)!;
                  onBuild({ ...hw.build, parts: { ...hw.build.parts, [s.slot]: o.id } }, `swapped ${s.label.toLowerCase()} → ${o.name}`);
                }}
                className={`w-full appearance-none border bg-panel py-1.5 pr-7 pl-2 text-[12.5px] text-fg outline-none focus:border-spec-1/60 ${worst === "error" ? "border-bad/50" : worst === "warn" ? "border-warn/50" : "border-line-2"}`}
              >
                {s.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-dim" />
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-dim">{cur.spec}</p>
          </div>
        );
      })}
    </div>
  );
}

export function GeometryPanel({ hw, onBuild }: { hw: DerivedHardware; onBuild: (b: HardwareBuild, note: string | null) => void }) {
  const specs = GEOMETRY[hw.build.kind];
  const groups = [...new Set(specs.map((s) => s.group))];
  return (
    <div>
      {groups.map((grp) => (
        <div key={grp} className="border-b border-line">
          <p className="mono-label px-4 pt-3 pb-1 text-[10px] text-dim">{grp}</p>
          <div className="space-y-3 px-4 pt-1 pb-3.5">
            {specs
              .filter((s) => s.group === grp)
              .map((s) => {
                const v = hw.build.geom[s.key] ?? s.min;
                const shown = v * s.scale;
                const fill = ((v - s.min) / (s.max - s.min)) * 100;
                return (
                  <label key={s.key} className="block" title={s.info}>
                    <span className="flex items-baseline justify-between text-[12.5px]">
                      <span className="text-mute">{s.label}</span>
                      <span className="font-mono tabular-nums">
                        {shown >= 100 ? Math.round(shown) : Number(shown.toFixed(s.scale === 1 && s.step < 0.1 ? 2 : 1))}
                        <span className="ml-1 text-[10px] text-dim">{s.unit}</span>
                      </span>
                    </span>
                    <input
                      type="range"
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      value={v}
                      onChange={(e) => onBuild({ ...hw.build, geom: { ...hw.build.geom, [s.key]: Number(e.target.value) } }, null)}
                      className="lab-range mt-2"
                      style={{ "--fill": `${fill}%` } as React.CSSProperties}
                    />
                  </label>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview: verdict, stats, checks, BOM
// ---------------------------------------------------------------------------

export function ChecksPanel({
  hw,
  checks,
  onBuild,
  onSelect,
}: {
  hw: DerivedHardware;
  checks: DesignCheck[];
  onBuild: (b: HardwareBuild, note: string) => void;
  onSelect: (s: SlotId | null) => void;
}) {
  const [filter, setFilter] = useState<"all" | "issues" | "auto">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [bomOpen, setBomOpen] = useState(false);
  const errors = checks.filter((c) => c.level === "error").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  const passed = checks.filter((c) => c.level === "pass").length;
  const autos = checks.filter((c) => c.auto).length;
  const shown = checks.filter((c) => (filter === "issues" ? c.level === "warn" || c.level === "error" : filter === "auto" ? c.auto : true));
  const verdict = errors
    ? { cls: "border-bad/40 bg-bad/[0.06]", icon: <XCircle className="size-4 text-bad" />, title: `Not buildable yet: ${errors} blocking issue${errors > 1 ? "s" : ""}` }
    : warns
      ? { cls: "border-warn/40 bg-warn/[0.06]", icon: <AlertTriangle className="size-4 text-warn" />, title: `Buildable, with ${warns} warning${warns > 1 ? "s" : ""}` }
      : { cls: "border-ok/40 bg-ok/[0.06]", icon: <CheckCircle2 className="size-4 text-ok" />, title: "Design is feasible and electrically safe" };
  const downloadBom = () => {
    const rows = [["Part", "Qty", "Unit price (USD)", "Unit mass (g)", "Added by RoboCraft"], ...hw.bom.map((l) => [l.name, l.qty, l.price.toFixed(2), l.mass, l.auto ? "yes" : ""])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `robocraft-${hw.build.kind}-bom.csv` }).click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3 p-3">
      <motion.div key={verdict.title} initial={{ opacity: 0.4, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }} className={`border px-3 py-2.5 ${verdict.cls}`}>
        <p className="flex items-center gap-2 text-[13.5px] font-medium">
          {verdict.icon} {verdict.title}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
          <span className="mono-label rounded-[2px] bg-ok/10 px-1.5 py-0.5 text-[10px] text-ok">{passed} passed</span>
          {autos > 0 && (
            <span className="mono-label inline-flex items-center gap-1 rounded-[2px] bg-spec-1/10 px-1.5 py-0.5 text-[10px] text-spec-1">
              <Wand2 className="size-3" /> {autos} safety fix{autos > 1 ? "es" : ""} applied
            </span>
          )}
        </div>
      </motion.div>
      <div className="grid grid-cols-2 gap-2">
        {hw.stats.map((s) => (
          <div key={s.label} className="border border-line bg-panel px-3 py-2">
            <p className="text-[11px] text-dim">{s.label}</p>
            <motion.p
              key={s.value}
              initial={{ opacity: 0.3, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-0.5 font-mono text-[17px] tabular-nums ${s.tone === "bad" ? "text-bad" : s.tone === "warn" ? "text-warn" : s.tone === "ok" ? "text-ok" : ""}`}
            >
              {s.value}
            </motion.p>
            <p className="truncate text-[10.5px] text-dim">{s.sub}</p>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between pb-2">
          <p className="mono-label text-[10px] text-mute">Design checks</p>
          <div className="flex gap-0.5 border border-line p-0.5">
            {(
              [
                ["all", `All ${checks.length}`],
                ["issues", `Issues ${errors + warns}`],
                ["auto", "Auto-fixes"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`mono-label px-1.5 py-0.5 text-[9.5px] ${filter === k ? "bg-panel-2 text-fg" : "text-dim hover:text-mute"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <ul className="space-y-1">
          <AnimatePresence initial={false}>
            {shown.map((c) => {
              const Icon = LEVEL_ICON[c.level];
              const isOpen = open === c.id;
              return (
                <motion.li key={c.id} layout initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="border border-line bg-panel/60">
                  <button
                    onClick={() => {
                      setOpen(isOpen ? null : c.id);
                      if (c.slot && !isOpen) onSelect(c.slot);
                    }}
                    className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
                  >
                    <Icon className={`mt-0.5 size-3.5 shrink-0 ${LEVEL_CLS[c.level]}`} />
                    <span className="flex-1 text-[12px] leading-snug">{c.title}</span>
                    {c.auto && (
                      <span className="mono-label inline-flex shrink-0 items-center gap-1 rounded-[2px] bg-spec-1/10 px-1 py-0.5 text-[9px] text-spec-1">
                        <Wand2 className="size-2.5" /> auto
                      </span>
                    )}
                    <ChevronDown className={`mt-0.5 size-3 shrink-0 text-dim transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <p className="px-2.5 pb-2 pl-8 text-[11.5px] leading-relaxed text-mute">{c.detail}</p>
                        {c.fix && (
                          <button
                            onClick={() => onBuild({ ...hw.build, parts: { ...hw.build.parts, ...c.fix!.parts }, geom: { ...hw.build.geom, ...c.fix!.geom } }, `fix: ${c.fix!.label}`)}
                            className="mono-label mb-2 ml-8 inline-flex items-center gap-1 border border-spec-1/40 px-1.5 py-1 text-[10px] text-spec-1 hover:bg-spec-1/10"
                          >
                            <Wand2 className="size-3" /> Apply fix · {c.fix.label}
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>

      <div className="border border-line">
        <button onClick={() => setBomOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2">
          <span className="mono-label text-[10px] text-mute">Bill of materials · {hw.bom.length} lines</span>
          <span className="flex items-center gap-2 font-mono text-[12px]">
            ${hw.cost.toFixed(2)} <ChevronDown className={`size-3 text-dim transition-transform ${bomOpen ? "rotate-180" : ""}`} />
          </span>
        </button>
        <AnimatePresence>
          {bomOpen && (
            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden border-t border-line">
              <table className="w-full text-[11px]">
                <tbody>
                  {hw.bom.map((l, i) => (
                    <tr key={i} className="border-b border-line/60 last:border-0">
                      <td className="py-1 pl-3 text-mute">
                        {l.name}
                        {l.auto && <Wand2 className="ml-1 inline size-2.5 text-spec-1" />}
                      </td>
                      <td className="py-1 text-right font-mono text-dim">×{l.qty}</td>
                      <td className="py-1 pr-3 text-right font-mono">${(l.price * l.qty).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={downloadBom} className="mono-label flex w-full items-center justify-center gap-1.5 border-t border-line py-2 text-[10px] text-mute hover:text-fg">
                <Download className="size-3" /> Download CSV
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wiring diagram
// ---------------------------------------------------------------------------

const EDGE_COLOR: Record<NetEdge["kind"], string> = { power: "#ff4d5e", ground: "#8b909c", signal: "#3ff0ff", motor: "#c46bff" };
const SIGNAL_HUES = ["#3ff0ff", "#4ade80", "#ffd23f", "#ff9a3d", "#5b8cff", "#ff6fd8"];

export function WiringDiagram({ wiring }: { wiring: { nodes: NetNode[]; edges: NetEdge[] } }) {
  const [hover, setHover] = useState<string | null>(null);
  const layout = useMemo(() => {
    const COL_W = 215,
      NODE_W = 160,
      PIN_H = 14,
      HEAD = 34,
      GAP = 22;
    const cols = new Map<number, NetNode[]>();
    for (const n of wiring.nodes) cols.set(n.col, [...(cols.get(n.col) ?? []), n]);
    const pos = new Map<string, { x: number; y: number; h: number; node: NetNode }>();
    let maxH = 0;
    for (const [c, list] of cols) {
      let y = 20;
      for (const n of list) {
        const h = HEAD + n.pins.length * PIN_H + 8;
        pos.set(n.id, { x: 20 + c * COL_W, y, h, node: n });
        y += h + GAP;
      }
      maxH = Math.max(maxH, y);
    }
    const pinY = (id: string, pin: string) => {
      const p = pos.get(id)!;
      const i = Math.max(0, p.node.pins.indexOf(pin));
      return p.y + HEAD + i * PIN_H + 4;
    };
    let sig = 0;
    const edges = wiring.edges
      .filter((e) => pos.has(e.from[0]) && pos.has(e.to[0]))
      .map((e, i) => {
        const a = pos.get(e.from[0])!,
          b = pos.get(e.to[0])!;
        const ay = pinY(e.from[0], e.from[1]),
          by = pinY(e.to[0], e.to[1]);
        let ax: number, bx: number, d: string;
        if (a.x === b.x) {
          ax = a.x + NODE_W;
          bx = b.x + NODE_W;
          const bulge = ax + 30 + (i % 4) * 8;
          d = `M${ax},${ay} C${bulge},${ay} ${bulge},${by} ${bx},${by}`;
        } else {
          const lr = a.x < b.x;
          ax = lr ? a.x + NODE_W : a.x;
          bx = lr ? b.x : b.x + NODE_W;
          const k = Math.abs(bx - ax) * 0.45;
          d = `M${ax},${ay} C${ax + (lr ? k : -k)},${ay} ${bx - (lr ? k : -k)},${by} ${bx},${by}`;
        }
        const color = e.kind === "signal" ? SIGNAL_HUES[sig++ % SIGNAL_HUES.length] : EDGE_COLOR[e.kind];
        return { e, d, color, ax, ay, bx, by, key: `${i}` };
      });
    const width = 20 + (Math.max(...wiring.nodes.map((n) => n.col)) + 1) * COL_W - (COL_W - NODE_W) + 20;
    return { pos, edges, width, height: maxH + 10, NODE_W, HEAD, PIN_H };
  }, [wiring]);
  const nameOf = (id: string) => layout.pos.get(id)?.node.name ?? id;

  return (
    <div className="grid min-h-0 flex-1 auto-rows-min gap-px overflow-y-auto bg-line 2xl:auto-rows-auto 2xl:grid-cols-[minmax(0,1fr)_280px] 2xl:overflow-hidden">
      <div className="min-h-0 overflow-auto bg-void p-3 [scrollbar-width:thin]">
        <div className="mb-2 flex flex-wrap items-center gap-4 font-mono text-[10px] text-dim">
          {(
            [
              ["Power", "#ff4d5e", false],
              ["Ground", "#8b909c", true],
              ["Signal", "#3ff0ff", false],
              ["Motor", "#c46bff", false],
            ] as const
          ).map(([l, c, dash]) => (
            <span key={l} className="flex items-center gap-1.5">
              <svg width="18" height="4">
                <line x1="0" y1="2" x2="18" y2="2" stroke={c} strokeWidth="2" strokeDasharray={dash ? "3 2" : undefined} />
              </svg>
              {l}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 border border-dashed border-spec-1" /> added by RoboCraft
          </span>
        </div>
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ minWidth: layout.width * 0.7 }} className="w-full">
          <defs>
            <pattern id="wd-dots" width="14" height="14" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.7" fill="#1b2230" />
            </pattern>
          </defs>
          <rect width={layout.width} height={layout.height} fill="url(#wd-dots)" />
          {layout.edges.map(({ e, d, color, key }) => {
            const dim = hover && hover !== e.net;
            return (
              <path
                key={key}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={hover === e.net ? 2.4 : 1.5}
                strokeDasharray={e.kind === "ground" ? "4 3" : undefined}
                opacity={dim ? 0.15 : 0.9}
                className={e.kind === "power" || e.kind === "motor" ? "flow-dash" : undefined}
                onMouseEnter={() => setHover(e.net)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
          {[...layout.pos.values()].map(({ x, y, h, node }) => (
            <g key={node.id}>
              <rect x={x} y={y} width={layout.NODE_W} height={h} rx="3" fill="#0b0f15" stroke={node.auto ? "#3ff0ff" : "#2a3342"} strokeDasharray={node.auto ? "4 3" : undefined} />
              <text x={x + 9} y={y + 15} fill="#eceef2" fontSize="11" fontWeight="600" fontFamily="var(--font-geist-sans), sans-serif">
                {node.name.length > 24 ? `${node.name.slice(0, 23)}…` : node.name}
              </text>
              <text x={x + layout.NODE_W - 8} y={y + 15} fill="#6b7480" fontSize="9" textAnchor="end" fontFamily="var(--font-geist-mono), monospace">
                {node.ref}
              </text>
              <text x={x + 9} y={y + 27} fill="#6b7480" fontSize="8.5" fontFamily="var(--font-geist-mono), monospace">
                {node.sub.length > 32 ? `${node.sub.slice(0, 31)}…` : node.sub}
              </text>
              {node.auto && (
                <g>
                  <rect x={x + layout.NODE_W - 34} y={y - 7} width="30" height="13" rx="6" fill="#0d3a40" stroke="#3ff0ff" strokeWidth="0.8" />
                  <text x={x + layout.NODE_W - 19} y={y + 2.5} fill="#3ff0ff" fontSize="8" textAnchor="middle" fontFamily="var(--font-geist-mono), monospace">
                    auto
                  </text>
                </g>
              )}
              {node.pins.map((p, i) => {
                const py = y + layout.HEAD + i * layout.PIN_H + 4;
                return (
                  <g key={p}>
                    <text x={x + layout.NODE_W / 2} y={py + 3} fill="#aab2bf" fontSize="9" textAnchor="middle" fontFamily="var(--font-geist-mono), monospace">
                      {p}
                    </text>
                    <circle cx={x} cy={py} r="2" fill="#2a3342" />
                    <circle cx={x + layout.NODE_W} cy={py} r="2" fill="#2a3342" />
                  </g>
                );
              })}
            </g>
          ))}
          {layout.edges.map(({ ax, ay, bx, by, color, key }) => (
            <g key={`d${key}`}>
              <circle cx={ax} cy={ay} r="2.4" fill={color} />
              <circle cx={bx} cy={by} r="2.4" fill={color} />
            </g>
          ))}
        </svg>
      </div>
      <div className="bg-void 2xl:min-h-0 2xl:overflow-y-auto [scrollbar-width:thin]">
        <p className="mono-label sticky top-0 border-b border-line bg-void px-4 py-2.5 text-[10px] text-mute">Connections ({wiring.edges.length})</p>
        <ul>
          {wiring.edges.map((e, i) => (
            <li
              key={i}
              onMouseEnter={() => setHover(e.net)}
              onMouseLeave={() => setHover(null)}
              className={`grid grid-cols-[1fr_auto_1fr] items-start gap-2 border-b border-line/60 px-4 py-1.5 text-[10.5px] ${hover === e.net ? "bg-panel-2" : ""}`}
            >
              <span className="text-mute">
                {nameOf(e.from[0])} <span className="font-mono text-fg">{e.from[1]}</span>
              </span>
              <span className="pt-0.5 font-mono text-[9px]" style={{ color: e.kind === "signal" ? "#3ff0ff" : EDGE_COLOR[e.kind] }}>
                → {e.net}
              </span>
              <span className="text-right text-mute">
                {nameOf(e.to[0])} <span className="font-mono text-fg">{e.to[1]}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
