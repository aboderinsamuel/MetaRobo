"use client";

// Video in the loop. Muse Spark vision reads keyframes from a phone video (the robot, its moving
// parts, the objects around it, sizes judged from things of known size) and that observation can
// seed a new design. SAM 3.1 then tracks the robot's moving part frame by frame, and the tracked
// path is compared with the simulated hand path, so you can see where the digital model and the
// real machine disagree.
import { Box, Crosshair, Eye, Film, Loader2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SceneObservation } from "@/lib/create/ai";
import type { Design } from "@/lib/create/design";
import { RobotModel } from "@/lib/create/kinematics";
import type { Recording } from "@/lib/create/sim";
import type { SamBox } from "@/lib/meta/sam";
import { Button, SectionTitle } from "./ui";

/** Grab n evenly spaced frames as JPEG data URLs (max 640 px wide). */
async function keyframes(file: File, n: number): Promise<{ frames: string[]; duration: number }> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.src = url;
  await new Promise<void>((ok, bad) => {
    v.onloadeddata = () => ok();
    v.onerror = () => bad(new Error("This browser can't decode that video."));
  });
  const w = Math.min(640, v.videoWidth);
  const h = Math.round((v.videoHeight / v.videoWidth) * w);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const frames: string[] = [];
  for (let i = 0; i < n; i++) {
    v.currentTime = ((i + 0.5) / n) * v.duration;
    await new Promise<void>((ok) => (v.onseeked = () => ok()));
    g.drawImage(v, 0, 0, w, h);
    frames.push(c.toDataURL("image/jpeg", 0.8));
  }
  URL.revokeObjectURL(url);
  return { frames, duration: v.duration };
}

/** Resample a path to n points evenly in time, centred and scaled to unit size. */
function normalise(path: [number, number][], n = 80): [number, number][] {
  if (path.length < 2) return [];
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1)) * (path.length - 1);
    const a = path[Math.floor(f)],
      b = path[Math.min(path.length - 1, Math.floor(f) + 1)];
    const u = f - Math.floor(f);
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  const cx = out.reduce((s, p) => s + p[0], 0) / n,
    cy = out.reduce((s, p) => s + p[1], 0) / n;
  const r = Math.max(1e-9, ...out.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
  return out.map(([x, y]) => [(x - cx) / r, (y - cy) / r]);
}

function simulatedHandPath(design: Design, rec: Recording): [number, number][] {
  const robot = new RobotModel(design);
  const e = design.robot.effectors[0];
  const node = e ? robot.index.get(e.node) : undefined;
  if (node === undefined) return [];
  const out: [number, number][] = [];
  const nj = rec.joints.length;
  const p = new THREE.Vector3();
  for (let f = 0; f < rec.frames; f += 2) {
    rec.joints.forEach((j, k) => (robot.q[j] = rec.q[f * nj + k]));
    robot.base = { x: rec.base[f * 5], z: rec.base[f * 5 + 1], yaw: rec.base[f * 5 + 2], crouch: rec.base[f * 5 + 3], lean: rec.base[f * 5 + 4] };
    robot.fk();
    robot.pointOn(node, e.tip, p);
    // Front view (camera looking along −z): image x = world x, image y = −world y.
    out.push([p.x, -p.y]);
  }
  return out;
}

export default function VideoPanel({ design, recording, busy, onBuild, onSpend }: { design: Design | null; recording: Recording | null; busy: boolean; onBuild: (prompt: string, observed: string) => void; onSpend: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [duration, setDuration] = useState(0);
  const [note, setNote] = useState("");
  const [scene, setScene] = useState<SceneObservation | null>(null);
  const [boxes, setBoxes] = useState<SamBox[] | null>(null);
  const [work, setWork] = useState<"frames" | "vision" | "track" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pick = async (f: File) => {
    setFile(f);
    setScene(null);
    setBoxes(null);
    setError(null);
    setWork("frames");
    try {
      const k = await keyframes(f, 8);
      setFrames(k.frames);
      setDuration(k.duration);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWork(null);
    }
  };

  const read = async () => {
    setWork("vision");
    setError(null);
    try {
      const res = await fetch("/api/create/vision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ images: frames, note }) });
      const body = (await res.json()) as { scene?: SceneObservation; error?: string };
      if (!res.ok || !body.scene) throw new Error(body.error ?? `HTTP ${res.status}`);
      setScene(body.scene);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWork(null);
      onSpend();
    }
  };

  const track = async () => {
    if (!file || !scene) return;
    setWork("track");
    setError(null);
    try {
      const form = new FormData();
      form.append("video", file);
      form.append("prompt", scene.trackPrompt || "robot");
      form.append("frames", String(Math.min(600, Math.ceil(duration * 30))));
      const res = await fetch("/api/lab/track", { method: "POST", body: form });
      const body = (await res.json()) as { boxes?: SamBox[]; error?: string };
      if (!res.ok || !body.boxes) throw new Error(body.error ?? `HTTP ${res.status}`);
      setBoxes(body.boxes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWork(null);
      onSpend();
    }
  };

  const observed = scene
    ? [
        scene.summary,
        scene.robot.present ? `Robot: ${scene.robot.kind}. ${scene.robot.description}. Moving parts: ${scene.robot.movingParts.map((m) => `${m.part} (${m.motion})`).join("; ")}` : "No robot visible.",
        `Objects: ${scene.objects.map((o) => `${o.name} ${o.sizeM.map((v) => v.toFixed(2)).join("×")} m ${o.color}, ${o.where}`).join("; ")}`,
        scene.scaleReferences.length ? `Scale from: ${scene.scaleReferences.map((r) => `${r.object} (${r.knownSizeM} m)`).join(", ")}` : "",
      ].join("\n")
    : "";

  const comparison = useMemo(() => {
    if (!boxes?.length) return null;
    const main = new Map<number, number>();
    for (const b of boxes) main.set(b.id, (main.get(b.id) ?? 0) + 1);
    const id = [...main].sort((a, b) => b[1] - a[1])[0][0];
    const real = normalise(boxes.filter((b) => b.id === id).sort((a, b) => a.frame - b.frame).map((b) => [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2]));
    const sim = design && recording ? normalise(simulatedHandPath(design, recording)) : [];
    const rms = sim.length ? Math.sqrt(real.reduce((s, p, i) => s + (p[0] - sim[i][0]) ** 2 + (p[1] - sim[i][1]) ** 2, 0) / real.length) : null;
    return { real, sim, rms, frames: boxes.filter((b) => b.id === id).length };
  }, [boxes, design, recording]);

  const pathD = (p: [number, number][]) => p.map(([x, y], i) => `${i ? "L" : "M"}${(50 + x * 42).toFixed(1)},${(50 + y * 42).toFixed(1)}`).join(" ");

  return (
    <div className="space-y-5">
      <p className="text-[13px] leading-relaxed text-mute">Film a real robot or the space it will work in. Muse Spark reads the scene; SAM 3.1 tracks the moving part so you can compare it with the simulation.</p>
      <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
      <button onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-line-2 px-4 py-6 text-mute transition-colors hover:border-accent hover:text-fg">
        {work === "frames" ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
        <span className="text-[13px]">{file ? file.name : "Choose a video (MP4 or MOV, a few seconds)"}</span>
      </button>

      {frames.length > 0 && (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            {frames.map((f, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- local data URLs, nothing to optimise
              <img key={i} src={f} alt={`Keyframe ${i + 1}`} className="aspect-video w-full rounded-lg object-cover" />
            ))}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything it should know? e.g. 'the arm is 40 cm long'" className="h-9 w-full rounded-xl bg-surface-2 px-3 text-[13px] outline-none focus:ring-2 focus:ring-accent" />
          <Button variant="primary" className="w-full" disabled={!!work} onClick={() => void read()}>
            {work === "vision" ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />} Read the scene with Muse Spark
          </Button>
          <p className="-mt-3 text-center text-[11px] text-dim">8 keyframes · about 1¢</p>
        </>
      )}

      {scene && (
        <section className="space-y-3">
          <SectionTitle>What Muse Spark saw</SectionTitle>
          <p className="text-[13px] leading-relaxed">{scene.summary}</p>
          {scene.robot.present && (
            <div className="rounded-xl bg-surface-2/70 p-3 text-[12.5px]">
              <p className="font-medium">{scene.robot.kind}</p>
              <p className="mt-1 leading-relaxed text-mute">{scene.robot.description}</p>
              <ul className="mt-2 space-y-0.5 text-mute">
                {scene.robot.movingParts.map((m) => (
                  <li key={m.part}>
                    <span className="text-fg">{m.part}</span>: {m.motion}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="space-y-1 text-[12.5px]">
            {scene.objects.map((o) => (
              <li key={o.name} className="flex items-center gap-2">
                <span className="size-3 shrink-0 rounded-full ring-1 ring-line-2" style={{ background: o.color }} />
                <span className="truncate">{o.name}</span>
                <span className="ml-auto shrink-0 text-mute tabular-nums">{o.sizeM.map((v) => v.toFixed(2)).join(" × ")} m</span>
              </li>
            ))}
          </ul>
          {scene.scaleReferences.length > 0 && <p className="text-[11.5px] text-dim">Scale judged from: {scene.scaleReferences.map((r) => r.object).join(", ")}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => onBuild(scene.suggestedPrompt, observed)}>
              <Box className="size-4" /> Build this in 3D
            </Button>
            <Button size="sm" disabled={!!work || !file || !/mp4|quicktime/.test(file.type)} onClick={() => void track()} title={file && !/mp4|quicktime/.test(file.type) ? "SAM 3.1 needs MP4 or MOV" : undefined}>
              {work === "track" ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />} Track “{scene.trackPrompt}” with SAM 3.1
            </Button>
          </div>
        </section>
      )}

      {comparison && (
        <section>
          <SectionTitle>Real motion vs simulation</SectionTitle>
          <svg viewBox="0 0 100 100" className="aspect-square w-full rounded-2xl bg-surface-2/60">
            {comparison.sim.length > 0 && <path d={pathD(comparison.sim)} fill="none" stroke="var(--color-accent)" strokeWidth={1.2} strokeLinejoin="round" />}
            <path d={pathD(comparison.real)} fill="none" stroke="var(--color-warn)" strokeWidth={1.2} strokeDasharray="2 1.5" strokeLinejoin="round" />
          </svg>
          <div className="mt-2 flex items-center gap-4 text-[12px] text-mute">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-warn" /> SAM 3.1 track ({comparison.frames} frames)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-accent" /> Simulated hand
            </span>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-mute">
            {comparison.rms === null
              ? "Build or open a design to compare against."
              : `Shape difference ${comparison.rms.toFixed(2)} (0 = identical paths, ~1.4 = unrelated), after centring and scaling both paths and matching them in time. The camera isn't calibrated, so this compares the shape of the motion, not its size.`}
          </p>
        </section>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-xl bg-bad/10 px-3 py-2 text-[12.5px] text-bad">
          <Film className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
