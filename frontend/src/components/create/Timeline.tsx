"use client";

// Playback controls under the canvas: play / pause / restart, a scrubber with a marker for every
// task step (green = succeeded, amber = had problems), the current step, and playback speed.
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";
import { usePlayback } from "@/lib/create/playback";
import type { Recording } from "@/lib/create/sim";
import { IconButton, Segmented, cx } from "./ui";

const fmt = (t: number) => `${Math.floor(t / 60)}:${Math.floor(t % 60)
  .toString()
  .padStart(2, "0")}`;

export default function Timeline({ recording, running, progress }: { recording: Recording | null; running: boolean; progress: number }) {
  const { t, playing, rate, set } = usePlayback();
  const bar = useRef<HTMLDivElement>(null);
  const duration = recording?.duration ?? 0;

  // Space toggles playback (unless typing).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== "Space" || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName) || el.isContentEditable) return;
      e.preventDefault();
      const s = usePlayback.getState();
      if (!recording) return;
      s.set({ playing: !s.playing, t: s.t >= recording.duration - 0.05 ? 0 : s.t });
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [recording]);

  const seek = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r || !duration) return;
    set({ t: Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration)) });
  };
  const step = recording?.steps.find((s) => t >= s.start && t < s.end);

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      <div className="flex items-center gap-3">
        <IconButton label={playing ? "Pause (Space)" : "Play (Space)"} disabled={!recording} onClick={() => set({ playing: !playing, t: t >= duration - 0.05 ? 0 : t })} className="size-9 bg-surface-2 text-fg">
          {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </IconButton>
        <IconButton label="Restart" disabled={!recording} onClick={() => set({ t: 0, playing: true })}>
          <RotateCcw className="size-4" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="truncate font-medium text-fg">{running ? `Simulating… ${Math.round(progress * 100)}%` : step ? step.label : recording ? "Ready" : "No simulation yet"}</span>
            <span className="shrink-0 font-mono text-[11.5px] text-mute tabular-nums">
              {fmt(t)} / {fmt(duration)}
            </span>
          </div>
          <div
            ref={bar}
            className="group relative mt-2 h-6 cursor-pointer touch-none"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              set({ playing: false });
              seek(e.clientX);
            }}
            onPointerMove={(e) => e.buttons === 1 && seek(e.clientX)}
          >
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-2" />
            {recording?.steps.map((s, i) => (
              <div
                key={i}
                title={`${s.label}${s.ok ? "" : ` · ${s.note}`}`}
                className={cx("absolute top-1/2 h-1.5 -translate-y-1/2 border-l border-surface", s.ok ? "bg-ok/25" : "bg-warn/45")}
                style={{ left: `${(s.start / duration) * 100}%`, width: `${((s.end - s.start) / duration) * 100}%` }}
              />
            ))}
            <div className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${duration ? (t / duration) * 100 : 0}%` }} />
            {running && <div className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 animate-pulse rounded-full bg-accent/40" style={{ width: `${progress * 100}%` }} />}
            <div className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface shadow transition-transform group-hover:scale-110" style={{ left: `${duration ? (t / duration) * 100 : 0}%` }} />
          </div>
        </div>
        <Segmented
          size="sm"
          value={String(rate)}
          onChange={(v) => set({ rate: Number(v) })}
          options={[
            { id: "0.25", label: "¼×" },
            { id: "0.5", label: "½×" },
            { id: "1", label: "1×" },
            { id: "2", label: "2×" },
          ]}
          className="hidden sm:inline-flex"
        />
      </div>
    </div>
  );
}
