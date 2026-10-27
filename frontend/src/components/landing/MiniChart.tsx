"use client";

import { motion } from "motion/react";
import { useId } from "react";

export function pathFrom(ys: ArrayLike<number>, w: number, h: number, lo: number, hi: number, step = 1): string {
  const n = ys.length;
  if (!n) return "";
  const span = hi - lo || 1;
  let d = "";
  for (let i = 0; i < n; i += step) {
    const x = (i / (n - 1)) * w;
    const y = h - ((ys[i] - lo) / span) * h;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

/** A step-response sparkline: dashed reference, spectrum-stroked output that draws itself in. */
export default function MiniChart({
  y,
  target,
  className,
  height = 80,
  draw = true,
}: {
  y: ArrayLike<number>;
  target: number;
  className?: string;
  height?: number;
  draw?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const w = 300;
  let lo = Math.min(0, target),
    hi = Math.max(0, target);
  for (let i = 0; i < y.length; i++) {
    if (y[i] < lo) lo = y[i];
    if (y[i] > hi) hi = y[i];
  }
  const pad = (hi - lo) * 0.12 || 1;
  lo -= pad;
  hi += pad;
  const refY = height - ((target - lo) / (hi - lo)) * height;
  const step = Math.max(1, Math.floor(y.length / 300));
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className={className} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`s${id}`} x1="0" x2="1">
          <stop offset="0" stopColor="#3ff0ff" />
          <stop offset="0.4" stopColor="#b06bff" />
          <stop offset="0.75" stopColor="#ff5fa2" />
          <stop offset="1" stopColor="#ffe45c" />
        </linearGradient>
      </defs>
      <line x1="0" x2={w} y1={refY} y2={refY} stroke="rgb(255 255 255 / 0.25)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      <motion.path
        d={pathFrom(y, w, height, lo, hi, step)}
        fill="none"
        stroke={`url(#s${id})`}
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
        initial={draw ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.4, ease: [0.6, 0, 0.2, 1] }}
      />
    </svg>
  );
}
