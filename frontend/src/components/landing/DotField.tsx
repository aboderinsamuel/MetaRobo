"use client";

import { useEffect, useRef } from "react";

/**
 * A slowly turning sphere of dots seen from above its equator - the "physical world" the
 * models describe. Dots nearer the viewer are larger and brighter. Pauses off-screen.
 */
export default function DotField({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const N = 900;
    const pts = Array.from({ length: N }, (_, i) => {
      // Fibonacci sphere: even coverage without clumps.
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = i * 2.399963229728653;
      return { x: Math.cos(th) * r, y, z: Math.sin(th) * r, s: 0.6 + ((i * 7919) % 100) / 70 };
    });
    let raf = 0,
      visible = true,
      t = 0,
      mx = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(c);
    const onMove = (e: PointerEvent) => (mx = (e.clientX / window.innerWidth - 0.5) * 2);
    window.addEventListener("pointermove", onMove, { passive: true });

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!visible) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth,
        h = c.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!reduced) t += 0.0016;
      const rot = t + mx * 0.25;
      const R = Math.max(w, h * 1.4) * 0.62;
      const cx = w / 2,
        cy = h * 1.05;
      const tilt = 0.42;
      for (const p of pts) {
        const x = p.x * Math.cos(rot) - p.z * Math.sin(rot);
        const z0 = p.x * Math.sin(rot) + p.z * Math.cos(rot);
        const y = p.y * Math.cos(tilt) - z0 * Math.sin(tilt);
        const z = p.y * Math.sin(tilt) + z0 * Math.cos(tilt);
        if (z < -0.15) continue;
        const sx = cx + x * R,
          sy = cy + y * R;
        if (sy > h + 4 || sx < -4 || sx > w + 4) continue;
        const depth = (z + 1) / 2;
        const rad = p.s * (0.5 + depth * 2.1);
        ctx.globalAlpha = 0.15 + depth * 0.75;
        ctx.fillStyle = "#eceef2";
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, []);
  return <canvas ref={canvas} className={className} aria-hidden />;
}
