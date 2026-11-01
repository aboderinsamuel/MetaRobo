"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";

// The signature motif: a closed control loop drawn as ∞, a shaded ribbon in Meta's blues that
// twists over itself at the centre. A light pulse travels the path and lights up each stage as it
// passes (sense → think → check → act), the way a feedback loop runs.

const W = 800;
const H = 340;
// Figure-eight through the centre: right lobe clockwise, then the left lobe counter-clockwise.
const PATH = "M400 170 C470 70 680 70 680 170 C680 270 470 270 400 170 C330 70 120 70 120 170 C120 270 330 270 400 170 Z";

export interface LoopStage {
  key: string;
  label: string;
  models: string;
  /** Position along the loop, 0..1. */
  at: number;
  /** Where the label sits relative to its node. */
  side: "top" | "bottom";
}

export const LOOP_STAGES: LoopStage[] = [
  { key: "sense", label: "Sense", models: "SAM 3.1 · Muse Spark vision", at: 0.125, side: "top" },
  { key: "think", label: "Think", models: "Muse Spark · Muse Wonder", at: 0.375, side: "bottom" },
  { key: "check", label: "Check", models: "PlantSim C++ → WASM", at: 0.625, side: "top" },
  { key: "act", label: "Act", models: "Firmware · your robot", at: 0.875, side: "bottom" },
];

const PERIOD_MS = 9000;
const TAIL = 0.14; // fraction of the loop the comet tail covers

export default function ControlLoop({ className = "", onStage }: { className?: string; onStage?: (key: string) => void }) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const pathRef = useRef<SVGPathElement>(null);
  const tailRef = useRef<SVGPathElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const [nodes, setNodes] = useState<{ x: number; y: number }[]>([]);
  // The strand that crosses on top at the centre (bottom-left to top-right: the loop's end and
  // start), traced from the path itself and drawn again over the other strand: the twist.
  const [cross, setCross] = useState("");
  const [active, setActive] = useState("think");
  const activeRef = useRef("think");
  const onStageRef = useRef(onStage);
  useEffect(() => {
    onStageRef.current = onStage;
  });

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const len = path.getTotalLength();
    setNodes(LOOP_STAGES.map((s) => path.getPointAtLength(s.at * len)));
    const span = 0.045 * len;
    const pts: string[] = [];
    for (let k = 0; k <= 16; k++) {
      const d = -span + (2 * span * k) / 16;
      const p = path.getPointAtLength(d < 0 ? len + d : d);
      pts.push(`${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
    }
    setCross(`M${pts.join(" L")}`);

    const place = (t: number) => {
      const p = path.getPointAtLength(t * len);
      headRef.current?.setAttribute("transform", `translate(${p.x} ${p.y})`);
      // Draw only the stretch just behind the head as the tail.
      tailRef.current?.setAttribute("stroke-dasharray", `${TAIL * len} ${len}`);
      tailRef.current?.setAttribute("stroke-dashoffset", `${-(t - TAIL) * len}`);
      // The stage most recently passed is the active one.
      let cur = LOOP_STAGES[LOOP_STAGES.length - 1].key;
      for (const s of LOOP_STAGES) if (t >= s.at) cur = s.key;
      if (activeRef.current !== cur) {
        activeRef.current = cur;
        setActive(cur);
        onStageRef.current?.(cur);
      }
    };

    if (reduced) {
      place(0.4);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      place(((now - t0) % PERIOD_MS) / PERIOD_MS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return (
    <div className={`relative ${className}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label="Control loop: sense, think, check, act">
        <defs>
          {/* Meta blues, deep on the left to bright on the right. */}
          <linearGradient id={`lg${id}`} x1="110" y1="0" x2="690" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#0052CC" />
            <stop offset="0.38" stopColor="#0068E6" />
            <stop offset="0.7" stopColor="#0082FB" />
            <stop offset="1" stopColor="#21B5FF" />
          </linearGradient>
          {/* Light from above: the ribbon reads as a rounded band, not a flat line. */}
          <linearGradient id={`sh${id}`} x1="0" y1="60" x2="0" y2="280" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#001a4d" stopOpacity="0.35" />
          </linearGradient>
          <filter id={`gl${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <filter id={`sd${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        {/* Soft glow under the ribbon */}
        <path d={PATH} fill="none" stroke="#0082FB" strokeOpacity="0.28" strokeWidth="44" strokeLinecap="round" filter={`url(#gl${id})`} />
        {/* The ribbon: colour, shading, and a highlight along its upper edge */}
        <path ref={pathRef} d={PATH} fill="none" stroke={`url(#lg${id})`} strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
        <path d={PATH} fill="none" stroke={`url(#sh${id})`} strokeWidth="30" strokeLinecap="round" />
        <path d={PATH} fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="4" strokeLinecap="round" transform="translate(0 -7)" />
        {/* The twist: one strand passes over the other at the centre, casting a shadow on it. */}
        {cross && (
          <>
        <path d={cross} fill="none" stroke="#001433" strokeOpacity="0.55" strokeWidth="34" strokeLinecap="butt" filter={`url(#sd${id})`} />
        <path d={cross} fill="none" stroke={`url(#lg${id})`} strokeWidth="30" strokeLinecap="butt" />
        <path d={cross} fill="none" stroke={`url(#sh${id})`} strokeWidth="30" strokeLinecap="butt" />
        <path d={cross} fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="4" strokeLinecap="butt" transform="translate(0 -7)" />
          </>
        )}
        {/* A current running round the loop */}
        <path d={PATH} fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth="1.5" className="flow-dash" />
        {/* Comet tail: a blurred glow plus a crisp core */}
        <path ref={tailRef} d={PATH} fill="none" stroke="#bfe6ff" strokeWidth="12" strokeLinecap="round" filter={`url(#gl${id})`} />
        {nodes.map((n, i) => {
          const on = LOOP_STAGES[i].key === active;
          return (
            <g key={LOOP_STAGES[i].key} transform={`translate(${n.x} ${n.y})`}>
              <circle r={on ? 19 : 12} fill={on ? "#fff" : "#0a1f44"} stroke="#fff" strokeOpacity={on ? 1 : 0.55} strokeWidth="2" style={{ transition: "all .35s" }} />
              <circle r={on ? 7 : 4} fill={on ? "#0082FB" : "#fff"} style={{ transition: "all .35s" }} />
            </g>
          );
        })}
        <g ref={headRef}>
          <circle r="18" fill="#cfeaff" opacity="0.55" filter={`url(#gl${id})`} />
          <circle r="6" fill="#fff" />
        </g>
      </svg>

      {/* Labels as HTML so they stay crisp and readable at any size. */}
      {nodes.map((n, i) => {
        const s = LOOP_STAGES[i];
        const on = s.key === active;
        return (
          <div
            key={s.key}
            className="pointer-events-none absolute w-40 -translate-x-1/2 text-center transition-opacity duration-300"
            style={{
              left: `${(n.x / W) * 100}%`,
              top: `${(n.y / H) * 100}%`,
              transform: `translate(-50%, ${s.side === "top" ? "calc(-100% - 30px)" : "30px"})`,
              opacity: on ? 1 : 0.55,
            }}
          >
            <p className={`text-sm font-semibold tracking-tight sm:text-base ${on ? "text-fg" : "text-mute"}`}>{s.label}</p>
            <p className="mono-label mt-0.5 hidden text-[9px] text-mute sm:block">{s.models}</p>
          </div>
        );
      })}
    </div>
  );
}
