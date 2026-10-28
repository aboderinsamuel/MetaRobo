"use client";

import { Film, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface VideoTrackOptions {
  prompt: string;
  lengthCm: number;
  measure: "speed" | "position";
  uStep: number;
}

// Phones film at 30 fps by default; 60 fps clips cost twice as much.
const ASSUMED_FPS = 30;
const MAX_SECONDS = 20;

/** Phone clips sometimes arrive without a MIME type; SAM 3.1 only takes MP4 / MOV. */
export function normaliseClip(file: File): File | null {
  const ext = file.name.toLowerCase().split(".").pop();
  const type = file.type || (ext === "mov" ? "video/quicktime" : ext === "mp4" || ext === "m4v" ? "video/mp4" : "");
  if (type !== "video/mp4" && type !== "video/quicktime") return null;
  return file.type === type ? file : new File([file], file.name, { type });
}

/**
 * "Film it": pick a clip of the real robot, say what moves and how long it is, see the cost, then
 * SAM 3.1 tracks it and the lab fits a model from the motion.
 */
export default function VideoTrack({
  file,
  onCancel,
  onTrack,
  busy,
  aiOn,
  defaultPrompt,
}: {
  file: File;
  onCancel: () => void;
  onTrack: (opts: VideoTrackOptions, durationS: number) => void;
  busy: boolean;
  aiOn: boolean;
  defaultPrompt: string;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [duration, setDuration] = useState<number | null>(null);
  const [opts, setOpts] = useState<VideoTrackOptions>({ prompt: defaultPrompt, lengthCm: 20, measure: "speed", uStep: 1 });

  const frames = duration ? Math.ceil(duration * ASSUMED_FPS) : 0;
  const cents = Math.max(50, frames) * 0.02; // $0.20 per 1,000 frames
  const tooLong = duration !== null && duration > MAX_SECONDS;
  const ready = !!duration && !tooLong && opts.prompt.trim() && opts.lengthCm > 0 && opts.uStep !== 0;
  const field = "w-full border border-line-2 bg-void px-2 py-1.5 text-[13px] outline-none focus:border-fg/40";

  return (
    <div className="meta-ring mt-3 rounded-md bg-panel p-3">
      <div className="flex items-center justify-between">
        <p className="mono-label flex items-center gap-1.5 text-[10px] text-mute">
          <Film className="size-3.5" /> Film it · <span className="text-spectrum font-semibold">SAM 3.1</span>
        </p>
        <button onClick={onCancel} className="text-mute hover:text-fg" aria-label="Cancel video">
          <X className="size-4" />
        </button>
      </div>
      {url && (
        <video
          src={url}
          className="mt-2 aspect-video w-full rounded bg-black object-contain"
          muted
          playsInline
          controls
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
      )}
      <p className="mt-1 truncate text-[11px] text-dim">
        {file.name}
        {duration ? ` · ${duration.toFixed(1)} s` : ""}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[11px] text-mute">
          What moves?
          <input className={field} value={opts.prompt} maxLength={60} onChange={(e) => setOpts({ ...opts, prompt: e.target.value })} placeholder="robot car" />
        </label>
        <label className="text-[11px] text-mute">
          Its real length (cm)
          <input className={field} type="number" min={1} value={opts.lengthCm} onChange={(e) => setOpts({ ...opts, lengthCm: Number(e.target.value) })} />
        </label>
        <label className="text-[11px] text-mute">
          Command step
          <input className={field} type="number" value={opts.uStep} onChange={(e) => setOpts({ ...opts, uStep: Number(e.target.value) })} title="The input you applied, e.g. 6 (volts) or 100 (% PWM)" />
        </label>
        <div className="col-span-2 flex gap-1.5 text-[11px]">
          {(["speed", "position"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setOpts({ ...opts, measure: m })}
              className={`flex-1 border px-2 py-1.5 capitalize ${opts.measure === m ? "border-fg/40 text-fg" : "border-line-2 text-mute"}`}
            >
              Measure {m}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-dim">
        Film side-on with the phone still. Start recording, then start the robot from rest with one fixed command.
      </p>
      {tooLong && <p className="mt-2 text-[11px] text-bad">Keep the clip under {MAX_SECONDS} seconds.</p>}
      {!aiOn && <p className="mt-2 text-[11px] text-warn">Muse live mode is off, so only clips tracked before can be replayed.</p>}

      <button
        onClick={() => duration && onTrack(opts, duration)}
        disabled={!ready || busy}
        className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 bg-fg text-[13px] font-semibold text-void disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Film className="size-3.5" />}
        Track with SAM 3.1{duration ? ` · about ${cents.toFixed(1)}¢` : ""}
      </button>
    </div>
  );
}
