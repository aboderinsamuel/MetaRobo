"use client";

// The lab's starting point: an empty 3D workspace, waiting for a machine to be described.
import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { AlertTriangle, Bot, Loader2, PenLine, RefreshCw } from "lucide-react";

export default function EmptyStage({
  busy,
  step,
  modelName,
  error,
  onRetry,
  onDescribe,
  onDemos,
}: {
  busy: boolean;
  step: string | null;
  modelName: string;
  /** Why the last build failed; shown with a retry instead of loading anything else. */
  error?: string | null;
  onRetry?: () => void;
  onDescribe: () => void;
  onDemos: () => void;
}) {
  return (
    <div className="relative min-h-[520px] flex-1 overflow-hidden bg-[#06080b]">
      <Canvas camera={{ position: [1.6, 1.1, 2.2], fov: 38 }} dpr={[1, 1.75]} className="absolute! inset-0">
        <color attach="background" args={["#06080b"]} />
        <fog attach="fog" args={["#06080b", 3, 9]} />
        <hemisphereLight args={["#bcd3ff", "#0b0f14", 0.6]} />
        <Grid infiniteGrid cellSize={0.05} sectionSize={0.25} cellColor="#16222f" sectionColor="#1f4257" fadeDistance={6} fadeStrength={1.5} />
        <OrbitControls makeDefault target={[0, 0.2, 0]} enableDamping autoRotate={!busy} autoRotateSpeed={0.4} maxPolarAngle={Math.PI / 2.05} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
        <div className="pointer-events-auto max-w-sm text-center">
          {busy ? (
            <>
              <Loader2 className="mx-auto size-6 animate-spin text-spec-2" />
              <p className="mt-4 text-[15px] font-medium">{step ?? "Working…"}</p>
              <p className="mt-1 text-[12px] text-mute">{modelName} is engineering your machine: physics first, then every part. This takes about a minute.</p>
            </>
          ) : error ? (
            <>
              <AlertTriangle className="mx-auto size-6 text-warn" />
              <p className="mt-3 text-[15px] font-medium">That machine wasn&apos;t built</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-mute">{error}</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {onRetry && (
                  <button onClick={onRetry} className="meta-ring inline-flex h-9 items-center gap-2 rounded-md bg-void px-4 text-[13px] font-semibold">
                    <RefreshCw className="size-3.5 text-spec-2" /> Try again
                  </button>
                )}
                <button onClick={onDescribe} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-2 px-4 text-[13px] text-mute hover:text-fg">
                  <PenLine className="size-3.5" /> Edit the description
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mono-label text-[10px] text-dim">Empty workspace</p>
              <p className="mt-3 text-[18px] leading-snug font-semibold tracking-tight">Describe a machine and {modelName} will engineer it here.</p>
              <p className="mt-2 text-[13px] text-mute">Every part is real and editable. Simulate it, change it, test it again with Robo Copilot.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button onClick={onDemos} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-2 px-4 text-[13px] text-mute hover:text-fg">
                  <Bot className="size-3.5" /> Demo robots
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
