"use client";

import { motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fmtNum } from "@/lib/lab/analysis";
import type { Playback } from "@/lib/lab/playback";
import type { Complex } from "@/lib/sim/core";

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 600, h: 300 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * span; v += step) out.push(Math.abs(v) < 1e-12 * span ? 0 : v);
  return out;
}

export interface Series {
  y: ArrayLike<number>;
  dt: number;
  color: string;
  label: string;
  width?: number;
  dash?: string;
  opacity?: number;
}

const PAD = { l: 52, r: 14, t: 12, b: 26 };

/** Time-series plot with ticks, a reference line, spec bands and a hover readout. */
export function TimeChart({
  series,
  refValue,
  band,
  limit,
  yLabel,
  className,
  animateKey,
  playback,
}: {
  series: Series[];
  refValue?: number;
  band?: number;
  limit?: number;
  yLabel?: string;
  className?: string;
  animateKey?: string | number;
  /** Playback clock of the 3D view: its time is drawn as a moving marker, updated outside React. */
  playback?: Playback;
}) {
  const [box, { w, h }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  const tEnd = Math.max(...series.map((s) => (s.y.length - 1) * s.dt), 1e-9);
  const { lo, hi } = useMemo(() => {
    let lo = refValue !== undefined ? Math.min(0, refValue) : Infinity,
      hi = refValue !== undefined ? Math.max(0, refValue) : -Infinity;
    for (const s of series)
      for (let i = 0; i < s.y.length; i++) {
        const v = s.y[i];
        if (Number.isFinite(v) && Math.abs(v) < 1e7) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    if (limit !== undefined) hi = Math.max(hi, limit);
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    const pad = (hi - lo) * 0.08 || 1;
    return { lo: lo - pad, hi: hi + pad };
  }, [series, refValue, limit]);
  const iw = Math.max(10, w - PAD.l - PAD.r),
    ih = Math.max(10, h - PAD.t - PAD.b);
  const X = (t: number) => PAD.l + (t / tEnd) * iw;
  const Y = (v: number) => PAD.t + ih - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * ih;
  const paths = series.map((s) => {
    const n = s.y.length;
    const step = Math.max(1, Math.floor(n / Math.max(200, iw)));
    let d = "";
    for (let i = 0; i < n; i += step) d += `${i ? "L" : "M"}${X(i * s.dt).toFixed(1)},${Y(s.y[i]).toFixed(1)}`;
    if ((n - 1) % step) d += `L${X((n - 1) * s.dt).toFixed(1)},${Y(s.y[n - 1]).toFixed(1)}`;
    return d;
  });
  const xt = niceTicks(0, tEnd, Math.max(3, Math.floor(iw / 90)));
  const yt = niceTicks(lo, hi, Math.max(3, Math.floor(ih / 45)));
  const hoverT = hover !== null ? hover * tEnd : null;

  // The playback cursor moves every frame, so it is written straight to the DOM; the effect
  // re-subscribes after each render with the current scales.
  const cursorRef = useRef<SVGGElement>(null);
  useEffect(() => {
    if (!playback) return;
    const draw = () => {
      const g = cursorRef.current;
      if (!g) return;
      const t = playback.t;
      const show = t > 0 && t <= tEnd * 1.0001;
      g.style.display = show ? "" : "none";
      if (!show) return;
      const x = X(Math.min(t, tEnd)).toFixed(1);
      const line = g.querySelector("line");
      line?.setAttribute("x1", x);
      line?.setAttribute("x2", x);
      const solid = series.filter((s) => !s.dash);
      g.querySelectorAll("circle").forEach((c, k) => {
        const s = solid[k];
        if (!s) return;
        c.setAttribute("cx", x);
        c.setAttribute("cy", Y(s.y[Math.min(s.y.length - 1, Math.round(t / s.dt))]).toFixed(1));
      });
    };
    draw();
    return playback.subscribe(draw);
  });

  return (
    <div
      ref={box}
      className={`relative ${className ?? ""}`}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const f = (e.clientX - r.left - PAD.l) / iw;
        setHover(f >= 0 && f <= 1 ? f : null);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg width={w} height={h} className="absolute inset-0 overflow-visible">
        <defs>
          <clipPath id={`c${gid}`}>
            <rect x={PAD.l} y={PAD.t - 2} width={iw} height={ih + 4} />
          </clipPath>
        </defs>
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={PAD.l + iw} y1={Y(v)} y2={Y(v)} stroke="rgb(255 255 255 / 0.06)" />
            <text x={PAD.l - 8} y={Y(v) + 3.5} textAnchor="end" className="fill-dim font-mono text-[10px]">
              {fmtNum(v)}
            </text>
          </g>
        ))}
        {xt.map((t) => (
          <g key={`x${t}`}>
            <line x1={X(t)} x2={X(t)} y1={PAD.t} y2={PAD.t + ih} stroke="rgb(255 255 255 / 0.04)" />
            <text x={X(t)} y={h - 8} textAnchor="middle" className="fill-dim font-mono text-[10px]">
              {fmtNum(t)}
            </text>
          </g>
        ))}
        <text x={w - PAD.r} y={h - 8} textAnchor="end" className="fill-dim font-mono text-[10px]">
          s
        </text>
        {yLabel && (
          <text x={PAD.l + 4} y={PAD.t + 10} className="fill-mute font-mono text-[10px]">
            {yLabel}
          </text>
        )}
        <g clipPath={`url(#c${gid})`}>
          {refValue !== undefined && band !== undefined && (
            <rect x={PAD.l} width={iw} y={Y(refValue + Math.abs(refValue) * band)} height={Math.max(0, Y(refValue - Math.abs(refValue) * band) - Y(refValue + Math.abs(refValue) * band))} fill="rgb(74 222 128 / 0.07)" />
          )}
          {limit !== undefined && <line x1={PAD.l} x2={PAD.l + iw} y1={Y(limit)} y2={Y(limit)} stroke="rgb(251 191 36 / 0.5)" strokeDasharray="2 4" />}
          {refValue !== undefined && <line x1={PAD.l} x2={PAD.l + iw} y1={Y(refValue)} y2={Y(refValue)} stroke="rgb(255 255 255 / 0.4)" strokeDasharray="4 4" />}
          {series.map((s, i) => (
            <motion.path
              key={`${animateKey ?? ""}-${i}-${s.label}`}
              d={paths[i]}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 1.6}
              strokeDasharray={s.dash}
              opacity={s.opacity ?? 1}
              strokeLinejoin="round"
              initial={animateKey !== undefined && !s.dash ? { pathLength: 0 } : false}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.9, ease: [0.6, 0, 0.2, 1] }}
            />
          ))}
        </g>
        {playback && (
          <g ref={cursorRef} style={{ display: "none" }}>
            <line y1={PAD.t} y2={PAD.t + ih} stroke="rgb(63 240 255 / 0.5)" />
            {series
              .filter((s) => !s.dash)
              .map((s) => (
                <circle key={s.label} r={3} fill={s.color} stroke="#040506" strokeWidth={1.5} />
              ))}
          </g>
        )}
        {hoverT !== null && (
          <line x1={X(hoverT)} x2={X(hoverT)} y1={PAD.t} y2={PAD.t + ih} stroke="rgb(255 255 255 / 0.3)" />
        )}
      </svg>
      {hoverT !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 border border-line-2 bg-void/90 px-2.5 py-1.5 font-mono text-[11px] backdrop-blur"
          style={{ left: Math.min(w - 150, X(hoverT) + 10) }}
        >
          <p className="text-dim">t = {fmtNum(hoverT)} s</p>
          {series.map((s) => {
            const i = Math.min(s.y.length - 1, Math.round(hoverT / s.dt));
            return (
              <p key={s.label} className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full" style={{ background: s.color }} />
                {s.label} {fmtNum(s.y[i])}
              </p>
            );
          })}
        </div>
      )}
      <div className="pointer-events-none absolute top-1.5 right-3 flex gap-3">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 font-mono text-[10px] text-mute">
            <span className="h-px w-3" style={{ background: s.color, opacity: s.opacity ?? 1 }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** s-plane: closed-loop poles (spectrum crosses) over open-loop poles (grey circles). */
export function PoleMap({ poles, openPoles, className }: { poles: Complex[]; openPoles: Complex[]; className?: string }) {
  const [box, { w, h }] = useSize<HTMLDivElement>();
  const all = [...poles, ...openPoles].filter((p) => Number.isFinite(p.re) && Number.isFinite(p.im));
  // Ignore very fast filter poles when framing, but still draw them at the edge.
  const mags = all.map((p) => Math.hypot(p.re, p.im)).sort((a, b) => a - b);
  const scale = Math.max(1e-3, (mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.8))] ?? 1) * 1.4);
  const cx = w * 0.62,
    cy = h / 2;
  const S = Math.min(w * 0.55, h * 0.45) / scale;
  const P = (p: Complex) => ({ x: Math.max(8, Math.min(w - 8, cx + p.re * S)), y: Math.max(8, Math.min(h - 8, cy - p.im * S)) });
  const zeta = 0.7;
  const ang = Math.acos(zeta);
  return (
    <div ref={box} className={`relative ${className ?? ""}`}>
      <svg width={w} height={h} className="absolute inset-0">
        <rect x={cx} y={0} width={Math.max(0, w - cx)} height={h} fill="rgb(248 113 113 / 0.06)" />
        <line x1={0} x2={w} y1={cy} y2={cy} stroke="rgb(255 255 255 / 0.15)" />
        <line x1={cx} x2={cx} y1={0} y2={h} stroke="rgb(255 255 255 / 0.25)" />
        {/* ζ = 0.7 guide lines: poles inside the wedge are well damped. */}
        {[1, -1].map((sgn) => (
          <line key={sgn} x1={cx} y1={cy} x2={cx - Math.cos(ang) * w} y2={cy - sgn * Math.sin(ang) * w} stroke="rgb(74 222 128 / 0.25)" strokeDasharray="3 4" />
        ))}
        <text x={8} y={cy - 6} className="fill-dim font-mono text-[10px]">
          ζ = 0.7
        </text>
        <text x={w - 8} y={14} textAnchor="end" className="fill-bad/60 font-mono text-[10px]">
          unstable
        </text>
        <text x={cx + 4} y={h - 6} className="fill-dim font-mono text-[10px]">
          jω
        </text>
        {openPoles.map((p, i) => {
          const q = P(p);
          return <circle key={`o${i}`} cx={q.x} cy={q.y} r={4.5} fill="none" stroke="rgb(255 255 255 / 0.35)" />;
        })}
        {poles.map((p, i) => {
          const q = P(p);
          const bad = p.re >= -1e-9;
          return (
            <motion.g key={`c${i}`} initial={{ scale: 0 }} animate={{ x: q.x, y: q.y, scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 20 }}>
              <path d="M-5,-5 L5,5 M-5,5 L5,-5" stroke={bad ? "#f87171" : "#3ff0ff"} strokeWidth={2} />
            </motion.g>
          );
        })}
      </svg>
      <div className="absolute bottom-1.5 left-2 flex gap-3 font-mono text-[10px] text-mute">
        <span className="flex items-center gap-1">
          <span className="text-spec-1">✕</span> closed loop
        </span>
        <span className="flex items-center gap-1">○ plant</span>
      </div>
    </div>
  );
}

/** Open-loop Bode magnitude and phase with crossover markers. */
export function BodePlot({ w: ws, mag, phase, wcp, pm, className }: { w: number[]; mag: number[]; phase: number[]; wcp: number; pm: number; className?: string }) {
  const [box, { w, h }] = useSize<HTMLDivElement>();
  if (!ws.length) return <div ref={box} className={className} />;
  const lw0 = Math.log10(ws[0]),
    lw1 = Math.log10(ws[ws.length - 1]);
  const X = (v: number) => 40 + ((Math.log10(v) - lw0) / (lw1 - lw0)) * (w - 50);
  const half = (h - 12) / 2;
  const mLo = Math.max(-100, Math.min(...mag)),
    mHi = Math.min(100, Math.max(...mag, 10));
  const pLo = Math.max(-540, Math.min(...phase, -200)),
    pHi = Math.min(180, Math.max(...phase, 0));
  const YM = (v: number) => 6 + (1 - (Math.max(mLo, Math.min(mHi, v)) - mLo) / (mHi - mLo || 1)) * (half - 10);
  const YP = (v: number) => half + 6 + (1 - (Math.max(pLo, Math.min(pHi, v)) - pLo) / (pHi - pLo || 1)) * (half - 10);
  const line = (vals: number[], Y: (v: number) => number) => vals.map((v, i) => `${i ? "L" : "M"}${X(ws[i]).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  return (
    <div ref={box} className={`relative ${className ?? ""}`}>
      <svg width={w} height={h} className="absolute inset-0">
        <line x1={40} x2={w - 10} y1={YM(0)} y2={YM(0)} stroke="rgb(255 255 255 / 0.25)" strokeDasharray="3 3" />
        <line x1={40} x2={w - 10} y1={YP(-180)} y2={YP(-180)} stroke="rgb(248 113 113 / 0.35)" strokeDasharray="3 3" />
        <text x={36} y={YM(0) + 3} textAnchor="end" className="fill-dim font-mono text-[10px]">
          0 dB
        </text>
        <text x={36} y={YP(-180) + 3} textAnchor="end" className="fill-dim font-mono text-[10px]">
          −180°
        </text>
        <path d={line(mag, YM)} fill="none" stroke="#5a86ff" strokeWidth={1.5} />
        <path d={line(phase, YP)} fill="none" stroke="#ff5fa2" strokeWidth={1.5} />
        {wcp > 0 && pm < 1e8 && (
          <g>
            <line x1={X(wcp)} x2={X(wcp)} y1={6} y2={h - 6} stroke="rgb(255 255 255 / 0.3)" />
            <text x={X(wcp) + 4} y={h - 8} className="fill-fg font-mono text-[10px]">
              PM {fmtNum(pm)}° @ {fmtNum(wcp)} rad/s
            </text>
          </g>
        )}
      </svg>
      <div className="absolute top-1 right-2 flex gap-3 font-mono text-[10px] text-mute">
        <span className="text-spec-2">|L(jω)|</span>
        <span className="text-spec-4">∠L(jω)</span>
      </div>
    </div>
  );
}
