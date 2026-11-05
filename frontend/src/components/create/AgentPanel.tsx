"use client";

// The engineering agent, live: Muse Wonder plans and decides, RoboCraft's physics simulation and
// engineering checks measure, and every revision lands as a version you can see and step back from.
import { Activity, CheckCircle2, CircleStop, FileSearch, Flag, Play, TriangleAlert, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { callAgentModel, workerSimulator } from "@/lib/agent/browser";
import { runAgent, type AgentEvent, type AgentResult } from "@/lib/agent/loop";
import { LIMITS, type Score } from "@/lib/agent/tools";
import type { Design } from "@/lib/create/design";
import { Button, cx } from "./ui";

const DEFAULT_GOAL = "Make every task step succeed in simulation with no hardware errors: every joint must hold its measured load with margin, and the robot must not tip over.";

const ICON: Record<string, React.ReactNode> = {
  inspect_design: <FileSearch className="size-3.5" />,
  run_simulation: <Activity className="size-3.5" />,
  revise_design: <Wrench className="size-3.5" />,
  finish: <Flag className="size-3.5" />,
};
const LABEL: Record<string, string> = { inspect_design: "Inspect design", run_simulation: "Run physics simulation", revise_design: "Revise design", finish: "Verdict" };

function ScoreRow({ label, before, after, better }: { label: string; before: number | string; after: number | string; better: boolean | null }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[12.5px]">
      <span className="text-mute">{label}</span>
      <span className="tabular-nums">
        <span className="text-dim">{before}</span> → <span className={cx("font-semibold", better === true ? "text-ok" : better === false ? "text-bad" : "text-fg")}>{after}</span>
      </span>
    </div>
  );
}

function Comparison({ before, after }: { before: Score; after: Score }) {
  return (
    <div className="mt-3 divide-y divide-line rounded-xl bg-surface-2 px-3">
      <ScoreRow label="Task steps succeeded" before={`${before.stepsOk}/${before.steps}`} after={`${after.stepsOk}/${after.steps}`} better={after.stepsOk === before.stepsOk ? null : after.stepsOk > before.stepsOk} />
      <ScoreRow label="Hardware errors" before={before.errors} after={after.errors} better={after.errors === before.errors ? null : after.errors < before.errors} />
      <ScoreRow label="Overloaded joints" before={before.overloaded} after={after.overloaded} better={after.overloaded === before.overloaded ? null : after.overloaded < before.overloaded} />
      <ScoreRow label="Mass" before={`${before.massKg} kg`} after={`${after.massKg} kg`} better={null} />
    </div>
  );
}

const VERDICT: Record<AgentResult["verdict"], { label: string; cls: string }> = {
  validated: { label: "Validated in simulation", cls: "bg-ok/12 text-ok" },
  improved: { label: "Improved, not yet clean", cls: "bg-warn/12 text-warn" },
  limited: { label: "No change helped", cls: "bg-surface-2 text-mute" },
  stopped: { label: "Stopped", cls: "bg-surface-2 text-mute" },
};

export default function AgentPanel({ design, live, onDesign }: { design: Design; live: boolean; onDesign: (d: Design, label: string) => void }) {
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), [events.length]);
  useEffect(() => () => abort.current?.abort(), []);

  const start = async () => {
    setEvents([]);
    setResult(null);
    setError(null);
    setRunning(true);
    abort.current = new AbortController();
    const sim = workerSimulator();
    try {
      const r = await runAgent({
        design,
        goal,
        callModel: callAgentModel,
        simulate: sim.simulate,
        signal: abort.current.signal,
        onEvent: (e) => {
          if (e.kind === "design") onDesign(e.design, `Engineering agent: ${e.label}`);
          if (e.kind !== "done") setEvents((xs) => [...xs, e]);
        },
      });
      setResult(r);
      // If a later revision measured worse, put the best measured design back on screen.
      if (r.after && r.design !== design) onDesign(r.design, `Engineering agent: best measured design (${r.verdict})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      sim.dispose();
      setRunning(false);
    }
  };

  const turns = events.filter((e): e is Extract<AgentEvent, { kind: "turn" }> => e.kind === "turn");
  const cost = turns.at(-1)?.costUsd ?? 0;
  const model = turns.find((t) => t.model)?.model;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] leading-relaxed text-mute">
          An autonomous engineering loop. <span className="text-fg">Meta Muse Wonder</span> plans and decides; RoboCraft&apos;s physics simulation and engineering checks measure every result. It inspects the design, simulates it, diagnoses failures from the data, revises, and re-simulates until the physics says it works.
        </p>
        <p className="mt-1.5 text-[11.5px] text-dim">
          Budget: {LIMITS.simulations} simulations, {LIMITS.revisions} revisions. Each revision becomes a version you can step back from.
        </p>
      </div>

      <label className="block">
        <span className="text-[12px] font-medium text-mute">Goal</span>
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} disabled={running} rows={3} className="mt-1 w-full resize-none rounded-xl bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed outline-none focus:shadow-[0_0_0_1px_var(--color-accent)]" />
      </label>

      {running ? (
        <Button className="w-full" onClick={() => abort.current?.abort()}>
          <CircleStop className="size-4" /> Stop after this step
        </Button>
      ) : (
        <Button variant="primary" className="w-full" disabled={!live || !goal.trim()} onClick={() => void start()}>
          <Play className="size-4" /> Run the engineering agent
        </Button>
      )}
      {!live && <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-mute">The engineering agent needs live Muse Wonder, which is paused on this demo right now.</p>}

      {(events.length > 0 || running) && (
        <div>
          <div className="mb-2 flex items-center justify-between text-[11.5px] text-dim">
            <span>{model ?? "Muse Wonder"} · {turns.length} turns</span>
            <span className="tabular-nums">${cost.toFixed(3)}</span>
          </div>
          <ol className="space-y-2">
            {events.map((e, i) => {
              if (e.kind === "thought") return <li key={i} className="px-1 text-[12px] leading-relaxed text-mute italic">{e.text}</li>;
              if (e.kind !== "tool") return null;
              const o = e.outcome;
              return (
                <li key={i} className={cx("rounded-xl px-3 py-2.5", o.error ? "bg-warn/10" : "bg-surface-2")}>
                  <p className="flex items-center gap-2 text-[12.5px] font-medium">
                    <span className={cx(o.error ? "text-warn" : "text-accent")}>{ICON[e.name] ?? <Wrench className="size-3.5" />}</span>
                    {LABEL[e.name] ?? e.name}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-mute">{o.summary}</p>
                  {o.applied && o.applied.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-fg/80">
                      {o.applied.map((a) => <li key={a}>+ {a}</li>)}
                    </ul>
                  )}
                  {o.rejected && o.rejected.length > 0 && (
                    <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-warn">
                      {o.rejected.map((a) => <li key={a}>× {a}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
            {running && <li className="px-1 text-[12px] text-dim">Working…</li>}
          </ol>
          <div ref={end} />
        </div>
      )}

      {error && <p className="rounded-xl bg-bad/10 px-3 py-2.5 text-[12.5px] text-bad">{error}</p>}

      {result && (
        <div className="rounded-2xl bg-surface p-4 shadow-[0_0_0_1px_var(--color-line)]">
          <div className="flex items-center gap-2">
            <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium", VERDICT[result.verdict].cls)}>
              {result.verdict === "validated" ? <CheckCircle2 className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
              {VERDICT[result.verdict].label}
            </span>
            <span className="text-[11.5px] text-dim">{result.simulations} simulations · {result.revisions} revisions · ${result.costUsd.toFixed(3)}</span>
          </div>
          <p className="mt-2.5 text-[12.5px] leading-relaxed">{result.summary}</p>
          {result.before && result.after && <Comparison before={result.before} after={result.after} />}
          {result.remaining.length > 0 && (
            <ul className="mt-2.5 space-y-1 text-[12px] text-mute">
              {result.remaining.map((r) => <li key={r}>· {r}</li>)}
            </ul>
          )}
          <p className="mt-2.5 text-[11px] text-dim">The verdict is computed from the simulation, not taken from the model. A simulation is evidence, not a guarantee of real-world safety.</p>
        </div>
      )}
    </div>
  );
}
