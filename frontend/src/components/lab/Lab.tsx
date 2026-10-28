"use client";

// RoboCraft Control Lab: describe → build the hardware → model → control → simulate → explain →
// iterate → validate. The hardware build is the source of truth: parts and dimensions give the
// plant, the actuator limits and the design checks.
import { Activity, Box, Cable, ChevronDown, CircleHelp, Code2, Cpu, Download, MessageSquare, ShieldCheck, SlidersHorizontal, Sparkles, Waves } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoboMark from "@/components/brand/RoboMark";
import { designCost } from "@/lib/lab/advisor";
import { checkSpecs, fmtNum, run, simConfig, specToPlant, toCtrl } from "@/lib/lab/analysis";
import { arduinoCode, suggestSampleTime } from "@/lib/lab/codegen";
import { fitSummary, modelFromFit, parseStepCsv, sampleStepCsv } from "@/lib/lab/data";
import type { StepData } from "@/lib/lab/data";
import { applyHints, defaultBuild, deriveHardware, liveChecks, sortChecks, telemetry } from "@/lib/lab/hardware/build";
import type { HardwareBuild } from "@/lib/lab/hardware/build";
import type { SlotId } from "@/lib/lab/hardware/parts";
import { createPlayback } from "@/lib/lab/playback";
import { PROGRAMS, programRun } from "@/lib/lab/programs";
import { presetById } from "@/lib/lab/presets";
import { RIGS, rigFor } from "@/lib/lab/rig";
import { tuneAsync } from "@/lib/lab/tuneClient";
import type { Advice, ControllerSpec, Iteration, LabModel, RigKind } from "@/lib/lab/types";
import { CHECK_COUNT, validateDesign } from "@/lib/lab/validate";
import type { CheckResult } from "@/lib/lab/validate";
import { useEngine } from "@/lib/sim/useEngine";
import { BodePlot, PoleMap, TimeChart } from "./charts";
import { ChecksPanel, GeometryPanel, PartsPanel, RigPicker, WiringDiagram } from "./hwpanels";
import { CoachPanel, FRIENDLY, ReportCard, SLOT_HELP, Tour, Welcome, report, tourSteps } from "./onboarding";
import type { Mode } from "./onboarding";
import type { ChatMsg } from "./panels";
import { CodePanel, Copilot, DescribePanel, GhostButton, ModelCard, SectionLabel, SpecStrip, TunerPanel, ValidatePanel, describeCtrl, diffCtrl } from "./panels";

const HardwareView = dynamic(() => import("./HardwareView"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-panel" />,
});

type View = "hardware" | "scope" | "analysis" | "wiring" | "validate" | "code";
type LeftTab = "hardware" | "control" | "describe";
type RightTab = "checks" | "copilot";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Scenario {
  disturbance: boolean;
  noise: boolean;
  limits: boolean;
}

function applyScenario(m: LabModel, s: Scenario): LabModel {
  return {
    ...m,
    specs: s.limits ? m.specs : { ...m.specs, uMin: -1e9, uMax: 1e9 },
    sim: {
      ...m.sim,
      disturbance: s.disturbance ? (m.sim.disturbance ?? { time: m.sim.tEnd * 0.7, magnitude: -0.1 * (Number.isFinite(m.specs.uMax) ? m.specs.uMax : 1) }) : undefined,
      // Sensor noise comes from the selected sensor's datasheet when the build provides it.
      noiseStd: s.noise ? (m.sim.noiseStd ?? Math.abs(m.sim.ref) * 0.01) : 0,
    },
  };
}

export default function Lab({ initialPreset, onboard = false }: { initialPreset?: string; onboard?: boolean }) {
  const engine = useEngine();
  const [text, setText] = useState("");
  const [build, setBuild] = useState<HardwareBuild | null>(null);
  const [dataModel, setDataModel] = useState<LabModel | null>(null);
  const [ctrl, setCtrl] = useState<ControllerSpec | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<StepData | null>(null);
  const [scenario, setScenario] = useState<Scenario>({ disturbance: true, noise: false, limits: true });
  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [pipeline, setPipeline] = useState(-1);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<View>("hardware");
  const [leftTab, setLeftTab] = useState<LeftTab>(initialPreset ? "hardware" : "describe");
  const [rightTab, setRightTab] = useState<RightTab>("checks");
  const [selected, setSelected] = useState<SlotId | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const [validation, setValidation] = useState<{ results: CheckResult[]; running: boolean }>({ results: [], running: false });
  const [simKey, setSimKey] = useState(0);
  const [program, setProgram] = useState("mission");
  const [playback] = useState(createPlayback);
  // Simple mode (plain words, no graphs) is the default until someone picks Pro.
  const [mode, setModeState] = useState<Mode>("simple");
  const [welcome, setWelcome] = useState(false);
  const [touring, setTouring] = useState(false);
  const [coachNote, setCoachNote] = useState<string | null>(null);
  const simple = mode === "simple";
  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem("rc-mode", m);
    } catch {}
  }, []);
  useEffect(() => {
    let saved: string | null = null,
      seen = false;
    try {
      saved = localStorage.getItem("rc-mode");
      seen = localStorage.getItem("rc-onboarded") === "1";
    } catch {}
    const id = requestAnimationFrame(() => {
      if (saved === "pro" || saved === "simple") setModeState(saved);
      if (onboard || !seen) setWelcome(true);
    });
    return () => cancelAnimationFrame(id);
  }, [onboard]);
  const iterSeq = useRef(0);

  useEffect(() => {
    fetch("/api/lab/status")
      .then((r) => r.json())
      .then((s: { ai: boolean }) => setAiOn(s.ai))
      .catch(() => setAiOn(false));
  }, []);

  const hw = useMemo(() => (build ? deriveHardware(build) : null), [build]);
  const model = dataModel ?? hw?.model ?? null;
  const effModel = useMemo(() => (model ? applyScenario(model, scenario) : null), [model, scenario]);
  const result = useMemo(() => (effModel && ctrl ? run(engine, effModel, ctrl) : null), [engine, effModel, ctrl]);
  const bode = useMemo(() => {
    if (!effModel || !ctrl || view !== "analysis") return null;
    const plant = specToPlant(effModel.plant);
    return engine.bode(plant, toCtrl(engine, plant, ctrl), 400, 1e-3, 1e4);
  }, [engine, effModel, ctrl, view]);
  // Balancer tilt comes straight from the state vector: same controller, output matrix picking θ.
  const tilt = useMemo(() => {
    if (!effModel || !result || effModel.rig?.kind !== "balancer" || effModel.plant.kind !== "ss" || result.ctrl.type !== 2) return undefined;
    const names = effModel.plant.stateNames.map((n) => n.toLowerCase());
    let i = names.findIndex((n) => /θ|theta|tilt|angle|pitch/.test(n) && !/̇|dot|rate|ω/.test(n));
    if (i < 0) i = Math.min(2, names.length - 1);
    const plant = { ...result.plant, C: result.plant.C.map((_, j) => (j === i ? 1 : 0)), D: 0 };
    return Float64Array.from(engine.simulate(plant, result.ctrl, simConfig(effModel)).y);
  }, [engine, effModel, result]);
  const tel = useMemo(() => (hw && result ? telemetry(hw, result.sim.y, result.sim.u, result.sim.dt) : null), [hw, result]);
  // What the 3D view plays: the exact mission run, or a program superposed from the same loop.
  const prun = useMemo(
    () => (effModel && ctrl && result ? programRun(engine, program, dataModel ? null : build, effModel, ctrl, result, tilt) : null),
    [engine, program, dataModel, build, effModel, ctrl, result, tilt],
  );
  const ptel = useMemo(() => {
    if (!hw || !prun) return null;
    if (!prun.vL || !prun.vR || !prun.uL || !prun.uR) return telemetry(hw, prun.y, prun.u, prun.dt);
    // Rover programs: each wheel has its own current; show the busier one.
    const a = telemetry(hw, prun.vL, prun.uL, prun.dt),
      b = telemetry(hw, prun.vR, prun.uR, prun.dt);
    return { ...a, perMotor: a.perMotor.map((v, i) => Math.max(v, b.perMotor[i])), current: a.current.map((v, i) => v + b.current[i] - 0.15) };
  }, [hw, prun]);
  const allChecks = useMemo(() => {
    if (!hw || !result || !tel) return hw?.checks ?? [];
    return sortChecks([...hw.checks, ...liveChecks(hw, tel, result.sim.u, result.analysis.wcp, result.analysis.metrics.stable === 1)]);
  }, [hw, result, tel]);
  const checks = useMemo(() => (result && effModel ? checkSpecs(result.analysis.metrics, effModel.specs, effModel.sim.ref) : []), [result, effModel]);
  const specOk = checks.length > 0 && checks.every((c) => c.pass);
  const reportItems = useMemo(() => (effModel && result ? report(effModel, result.analysis.metrics, checks, allChecks) : []), [effModel, result, checks, allChecks]);
  // A new design or tune clears Robo's last remark after a while.
  useEffect(() => {
    if (!coachNote || busy) return;
    const id = setTimeout(() => setCoachNote(null), 9000);
    return () => clearTimeout(id);
  }, [coachNote, busy]);
  const prevIteration = iterations.length > 1 ? iterations[iterations.length - 2] : null;
  const ghost = useMemo(() => {
    if (!effModel || !prevIteration || !ctrl || JSON.stringify(prevIteration.controller) === JSON.stringify(ctrl)) return null;
    return run(engine, effModel, prevIteration.controller).sim;
  }, [engine, effModel, prevIteration, ctrl]);

  const pushIteration = useCallback(
    (m: LabModel, c: ControllerSpec, label: string) => {
      const id = ++iterSeq.current;
      const analysis = run(engine, applyScenario(m, scenario), c).analysis;
      setIterations((prev) => [...prev, { id, label, controller: c, analysis }]);
      setSimKey((k) => k + 1);
      return id;
    },
    [engine, scenario],
  );

  // ---- Explanations --------------------------------------------------------------------------
  const explain = useCallback(
    async (m: LabModel, c: ControllerSpec, question?: string, its: Iteration[] = iterations): Promise<Advice | null> => {
      const eff = applyScenario(m, scenario);
      const history = its.slice(-6).map((it) => ({
        label: `v${it.id} ${it.label}`,
        controller: it.controller,
        summary: it.analysis.metrics.stable ? `${it.analysis.metrics.overshootPct.toFixed(1)}% overshoot, settling ${fmtNum(it.analysis.metrics.settlingTime)} s` : "unstable",
      }));
      try {
        const res = await fetch("/api/lab/explain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: eff, controller: c, history, question }),
        });
        const advice = (await res.json()) as Advice & { notice?: string; error?: string };
        if (!res.ok || advice.error) throw new Error(advice.error ?? `HTTP ${res.status}`);
        const previews = advice.proposals.map((p) => {
          const r = run(engine, eff, p.controller, { noiseStd: 0 });
          return { metrics: r.analysis.metrics, cost: designCost(engine, eff, p.controller) };
        });
        const forIteration = iterSeq.current;
        setMessages((prev) => [...prev, { kind: "advice", advice, previews, forIteration, base: c }]);
        return advice;
      } catch (err) {
        setMessages((prev) => [...prev, { kind: "event", text: `Explanation failed: ${err instanceof Error ? err.message : String(err)}` }]);
        return null;
      }
    },
    [engine, scenario, iterations],
  );

  // ---- Loading a design ----------------------------------------------------------------------
  /** Starts a fresh design from a hardware build (or a model identified from data). */
  const adopt = useCallback(
    async (b: HardwareBuild, note: string | null, fromData: LabModel | null = null) => {
      const m = fromData ? { ...fromData, rig: fromData.rig ?? { kind: b.kind, signal: deriveHardware(b).model.rig!.signal } } : deriveHardware(b).model;
      setPipeline(2);
      await sleep(350);
      setBuild(b);
      setDataModel(fromData ? m : null);
      setCtrl(m.controller);
      setNotice(note);
      setSelected(null);
      setProgram("mission");
      setIterations([]);
      setValidation({ results: [], running: false });
      setView((v) => (v === "wiring" || v === "code" || v === "validate" ? "hardware" : v));
      iterSeq.current = 0;
      setPipeline(3);
      await sleep(350);
      const id = ++iterSeq.current;
      const analysis = run(engine, applyScenario(m, scenario), m.controller).analysis;
      const first: Iteration = { id, label: "initial design", controller: m.controller, analysis };
      setIterations([first]);
      setSimKey((k) => k + 1);
      setMessages([{ kind: "event", text: `v1 · ${m.title}` }]);
      setPipeline(4);
      await explain(m, m.controller, undefined, [first]);
      setPipeline(5);
      await sleep(600);
      setPipeline(-1);
    },
    [engine, scenario, explain],
  );

  const buildFromText = useCallback(async () => {
    if (!text.trim()) return;
    setBusy("model");
    setPipeline(0);
    try {
      const t0 = performance.now();
      const res = fetch("/api/lab/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: text, dataSummary: data ? fitSummary(engine.fit(data.t, data.y, data.uStep, 0), data) : undefined }),
      });
      await sleep(400);
      setPipeline(1);
      const body = (await (await res).json()) as { model?: LabModel; notice?: string; error?: string };
      if (!body.model) throw new Error(body.error ?? "No model returned");
      if (performance.now() - t0 < 900) await sleep(400);
      // The words pick the closest of the four rigs and size it; the parts give the physics.
      const kind = rigFor(body.model, text).kind;
      const b = applyHints(defaultBuild(kind), text);
      const why = body.model.source === "meta" ? `Muse Spark matched this to the ${RIGS[kind].name.toLowerCase()}.` : `Matched to the ${RIGS[kind].name.toLowerCase()}.`;
      await adopt(b, body.notice ? `${body.notice} ${why}` : `${why} Sizes and targets came from your description; swap parts on the left to change the physics.`);
      setLeftTab("hardware");
    } catch (err) {
      setNotice(`Modeling failed: ${err instanceof Error ? err.message : String(err)}`);
      setPipeline(-1);
    } finally {
      setBusy(null);
    }
  }, [text, data, engine, adopt]);

  const loadRig = useCallback(
    async (kind: RigKind, prompt?: string) => {
      setBusy("model");
      if (prompt) setText(prompt);
      setData(null);
      setPipeline(0);
      await sleep(300);
      setPipeline(1);
      await sleep(300);
      await adopt(prompt ? applyHints(defaultBuild(kind), prompt) : defaultBuild(kind), null);
      setBusy(null);
    },
    [adopt],
  );

  const loadPreset = useCallback(
    async (id: string) => {
      const p = presetById(id);
      if (p) await loadRig(p.rig, p.prompt);
    },
    [loadRig],
  );

  const loadData = useCallback(
    async (csv: string, name: string) => {
      setBusy("model");
      setPipeline(0);
      try {
        const d = parseStepCsv(csv, name);
        setData(d);
        setPipeline(1);
        await sleep(250);
        const fit = engine.fit(d.t, d.y, d.uStep, 0);
        const local = modelFromFit(fit, d);
        const kind = rigFor(local, text).kind;
        await adopt(applyHints(defaultBuild(kind), text), `Identified from ${name}: ${fitSummary(fit, d)}. The plant comes from your data; swapping a part switches back to the physics model.`, local);
      } catch (err) {
        setNotice(`Couldn't read that data: ${err instanceof Error ? err.message : String(err)}`);
        setPipeline(-1);
      } finally {
        setBusy(null);
      }
    },
    [engine, text, adopt],
  );

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const p = initialPreset ? presetById(initialPreset) : undefined;
    void loadRig(p?.rig ?? "rover", p?.prompt);
  }, [initialPreset, loadRig]);

  // ---- Hardware changes ----------------------------------------------------------------------
  const onBuild = useCallback(
    (b: HardwareBuild, note: string | null) => {
      setBuild(b);
      setValidation({ results: [], running: false });
      if (dataModel) {
        setDataModel(null);
        setNotice("Switched back to the physics model from the parts.");
      }
      if (note && ctrl) {
        const nm = deriveHardware(b).model;
        const id = pushIteration(nm, ctrl, note.startsWith("fix") ? "hardware fix" : "hardware change");
        setMessages((prev) => [...prev, { kind: "event", text: `v${id} · ${note}` }]);
      }
    },
    [ctrl, dataModel, pushIteration],
  );

  // ---- Iterating -----------------------------------------------------------------------------
  const apply = useCallback(
    (c: ControllerSpec, label: string) => {
      if (!model) return;
      const msg = `v${iterSeq.current + 1} · ${label} · ${ctrl ? diffCtrl(ctrl, c) : describeCtrl(c)}`;
      setMessages((prev) => [...prev, { kind: "event", text: msg }]);
      setCtrl(c);
      pushIteration(model, c, label);
      setValidation({ results: [], running: false });
    },
    [model, ctrl, pushIteration],
  );

  const ask = useCallback(
    async (q?: string) => {
      if (!model || !ctrl) return;
      if (q) setMessages((prev) => [...prev, { kind: "user", text: q }]);
      const last = iterations[iterations.length - 1];
      if (!last || JSON.stringify(last.controller) !== JSON.stringify(ctrl)) {
        const id = pushIteration(model, ctrl, "manual tuning");
        setMessages((prev) => [...prev, { kind: "event", text: `v${id} · manual tuning` }]);
      }
      setBusy("explain");
      await explain(model, ctrl, q);
      setBusy(null);
    },
    [model, ctrl, iterations, pushIteration, explain],
  );

  const tune = useCallback(async () => {
    if (!model || !ctrl || !effModel) return;
    setBusy("tune");
    if (mode === "pro") setRightTab("copilot");
    setMessages((prev) => [...prev, { kind: "event", text: "auto-tuning with the simulator in the loop…" }]);
    try {
      const tuned = await tuneAsync(effModel, ctrl);
      apply(tuned, "auto-tune");
    } catch (err) {
      setMessages((prev) => [...prev, { kind: "event", text: `Auto-tune failed: ${String(err)}` }]);
    }
    setBusy(null);
  }, [model, ctrl, effModel, apply, mode]);

  // Simple mode's "Make it better": tune with the simulator in the loop, then say what changed.
  const improve = useCallback(async () => {
    if (!effModel || !ctrl) return;
    const before = run(engine, effModel, ctrl).analysis.metrics;
    setCoachNote("Let me try lots of settings in the simulator…");
    await tune();
    setCoachNote(
      before.stable
        ? `Done! I tested hundreds of settings and kept the best. Press Simulate to see the difference.`
        : "Done! It's back under control. Press Simulate to watch it.",
    );
  }, [effModel, ctrl, engine, tune]);

  const autoIterate = useCallback(async () => {
    if (!model || !ctrl || !effModel) return;
    setBusy("auto");
    let current = ctrl;
    let its = iterations;
    let triedTune = false;
    setMessages((prev) => [...prev, { kind: "event", text: "iterating until the specs are met" }]);
    for (let round = 0; round < 5; round++) {
      const advice = await explain(model, current, round === 0 ? undefined : "Continue: propose the next improvement.", its);
      const nowCost = designCost(engine, effModel, current);
      const nowChecks = checkSpecs(run(engine, effModel, current).analysis.metrics, effModel.specs, effModel.sim.ref);
      if (nowChecks.every((c) => c.pass)) {
        setMessages((prev) => [...prev, { kind: "event", text: `all specs met after ${round} change${round === 1 ? "" : "s"}` }]);
        break;
      }
      const candidates = (advice?.proposals ?? []).map((p) => ({ c: p.controller, label: p.label, cost: designCost(engine, effModel, p.controller) }));
      let best = candidates.sort((a, b) => a.cost - b.cost)[0];
      if ((!best || best.cost >= nowCost * 0.98) && !triedTune) {
        triedTune = true;
        const tuned = await tuneAsync(effModel, current);
        best = { c: tuned, label: "auto-tune", cost: designCost(engine, effModel, tuned) };
      }
      if (!best || best.cost >= nowCost * 0.98) {
        setMessages((prev) => [...prev, { kind: "event", text: "no further improvement found — the hardware may be the limit; check the design checks" }]);
        break;
      }
      await sleep(500);
      const msg = `v${iterSeq.current + 1} · ${best.label} · ${diffCtrl(current, best.c)}`;
      setMessages((prev) => [...prev, { kind: "event", text: msg }]);
      current = best.c;
      setCtrl(current);
      const id = ++iterSeq.current;
      const it: Iteration = { id, label: best.label, controller: current, analysis: run(engine, effModel, current).analysis };
      its = [...its, it];
      setIterations(its);
      setSimKey((k) => k + 1);
      await sleep(900);
    }
    setBusy(null);
  }, [model, ctrl, effModel, iterations, engine, explain]);

  const runValidation = useCallback(async () => {
    if (!effModel || !ctrl) return;
    setValidation({ results: [], running: true });
    for await (const r of validateDesign(engine, effModel, ctrl)) setValidation((v) => ({ ...v, results: [...v.results, r] }));
    setValidation((v) => ({ ...v, running: false }));
  }, [engine, effModel, ctrl]);

  const code = useMemo(() => {
    if (!model || !ctrl || !result || view !== "code") return null;
    const ts = suggestSampleTime(result.analysis.wcp);
    return { ts, text: arduinoCode(model, ctrl, result.ctrl.K, result.ctrl.Nbar, ts) };
  }, [model, ctrl, result, view]);

  const exportJson = () => {
    if (!model || !ctrl) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            hardware: build,
            bom: hw?.bom,
            checks: allChecks.map((c) => ({ level: c.level, title: c.title })),
            model,
            controller: ctrl,
            iterations: iterations.map((i) => ({ id: i.id, label: i.label, controller: i.controller, metrics: i.analysis.metrics })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: "robocraft-design.json" }).click();
    URL.revokeObjectURL(url);
  };

  const m = result?.analysis.metrics;
  const views: { id: View; label: string; icon: typeof Activity }[] = [
    { id: "hardware", label: "3D hardware", icon: Box },
    { id: "scope", label: "Scope", icon: Activity },
    { id: "analysis", label: "Poles & Bode", icon: Waves },
    { id: "wiring", label: "Wiring", icon: Cable },
    { id: "validate", label: "Validate", icon: ShieldCheck },
    { id: "code", label: "Firmware", icon: Code2 },
  ];
  const ready = !!(model && ctrl && result && effModel && hw && tel && prun && ptel);
  const issues = allChecks.filter((c) => c.level === "error" || c.level === "warn").length;

  const outputSeries = ready
    ? [
        ...(ghost ? [{ y: ghost.y, dt: ghost.dt, color: "#8b909c", label: `v${prevIteration?.id}`, width: 1.2, opacity: 0.45, dash: "3 3" }] : []),
        { y: result!.sim.y, dt: result!.sim.dt, color: specOk ? "#4ade80" : "#3ff0ff", label: `v${iterations[iterations.length - 1]?.id ?? 1} ${model!.output.name.toLowerCase()}`, width: 1.8 },
      ]
    : [];

  return (
    <div className="flex min-h-dvh flex-col bg-void text-fg lg:h-dvh">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <RoboMark className="size-6" />
            <span className="hidden text-[14px] font-medium sm:inline">RoboCraft</span>
          </Link>
          <span className="text-dim">/</span>
          <span className="truncate text-[13px] font-medium">{simple && hw ? `Your ${FRIENDLY[hw.build.kind].name.toLowerCase()}` : model ? model.title : "Control lab"}</span>
          {hw && (
            <span
              className={`mono-label hidden rounded-[2px] px-1.5 py-0.5 text-[10px] md:inline ${allChecks.some((c) => c.level === "error") ? "bg-bad/10 text-bad" : issues ? "bg-warn/10 text-warn" : "bg-ok/10 text-ok"}`}
            >
              {allChecks.some((c) => c.level === "error") ? (simple ? "needs fixing" : "not feasible") : issues ? `${issues} warning${issues > 1 ? "s" : ""}` : simple ? "ready to build" : "feasible"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div data-tour="mode" className="flex items-center gap-0.5 border border-line-2 p-0.5" role="radiogroup" aria-label="Mode">
            {(
              [
                ["simple", "Simple"],
                ["pro", "Pro"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="radio"
                aria-checked={mode === id}
                onClick={() => {
                  setMode(id);
                  if (id === "simple") setView("hardware");
                }}
                className={`mono-label px-2.5 py-1 text-[10px] transition-colors ${mode === id ? "bg-fg text-void" : "text-dim hover:text-mute"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => setTouring(true)} className="flex size-8 items-center justify-center border border-line-2 text-mute hover:text-fg" aria-label="Show me around" title="Show me around">
            <CircleHelp className="size-4" />
          </button>
          {!simple && (
            <>
              <span className={`mono-label hidden rounded-[2px] px-1.5 py-0.5 text-[10px] xl:inline ${engine.backend === "wasm" ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"}`}>
                {engine.backend === "wasm" ? "C++/WASM engine" : "TS engine"}
              </span>
              <GhostButton onClick={exportJson} disabled={!model}>
                <Download className="size-3" /> <span className="hidden sm:inline">Export</span>
              </GhostButton>
            </>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)_340px]">
        {/* Left: hardware / control / describe */}
        <aside data-tour="parts" className="flex max-h-[85vh] min-h-0 flex-col border-b border-line lg:max-h-none lg:border-r lg:border-b-0">
          <Tabs
            value={simple && leftTab === "control" ? "hardware" : leftTab}
            onChange={setLeftTab}
            items={
              simple
                ? [
                    { id: "hardware", label: "Build", icon: Cpu },
                    { id: "describe", label: "Describe", icon: Sparkles },
                  ]
                : [
                    { id: "hardware", label: "Hardware", icon: Cpu },
                    { id: "control", label: "Control", icon: SlidersHorizontal },
                    { id: "describe", label: "Describe", icon: Sparkles },
                  ]
            }
            layoutId="left-tab"
          />
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
            {(leftTab === "hardware" || (simple && leftTab === "control")) && (
              <>
                <RigPicker
                  kind={build?.kind ?? null}
                  onPick={(k) => void loadRig(k)}
                  busy={!!busy}
                  names={simple ? { rover: "car", arm: "arm", balancer: "balancer", drone: "drone" } : undefined}
                />
                {notice && <p className="border-b border-line bg-panel/60 px-4 py-2.5 text-[11.5px] leading-relaxed text-mute">{notice}</p>}
                {hw && allChecks && (
                  <>
                    <SectionLabel>{simple ? "Parts · what your robot is made of" : "Parts"}</SectionLabel>
                    <PartsPanel hw={hw} checks={allChecks} selected={selected} onSelect={setSelected} onBuild={onBuild} help={simple ? SLOT_HELP : undefined} />
                    <div className="border-t border-line" />
                    <GeometryPanel hw={hw} onBuild={onBuild} groups={simple ? ["Mission", "Mass & payload"] : undefined} />
                    {!simple && (
                      <>
                        <SectionLabel>Test scenario</SectionLabel>
                        <ScenarioToggles scenario={scenario} setScenario={setScenario} model={effModel} />
                      </>
                    )}
                  </>
                )}
              </>
            )}
            {!simple && leftTab === "control" && model && ctrl && result && (
              <>
                <SectionLabel
                  right={
                    <button onClick={() => setCtrl(model.controller)} className="mono-label text-[10px] text-dim hover:text-fg">
                      reset
                    </button>
                  }
                >
                  Controller · {ctrl.type === "pid" ? "PID" : ctrl.type === "lqr" ? "LQR state feedback" : "open loop"}
                </SectionLabel>
                <div className="p-4">
                  <TunerPanel ctrl={ctrl} center={model.controller} onChange={setCtrl} stateNames={model.plant.kind === "ss" ? model.plant.stateNames : undefined} />
                  {ctrl.type === "lqr" && (
                    <p className="mt-3 font-mono text-[11px] text-mute">
                      K = [{result.ctrl.K.map((k) => fmtNum(k)).join(", ")}] · N̄ = {fmtNum(result.ctrl.Nbar)}
                    </p>
                  )}
                  <p className="mt-3 text-[12px] leading-relaxed text-dim">{model.controllerRationale}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <GhostButton onClick={() => void tune()} disabled={!!busy} className="justify-center">
                      Auto-tune
                    </GhostButton>
                    <GhostButton
                      onClick={() => {
                        setRightTab("copilot");
                        void autoIterate();
                      }}
                      disabled={!!busy}
                      className="justify-center"
                    >
                      Fix it for me
                    </GhostButton>
                  </div>
                </div>
                <ModelCard model={model} notice={null} />
              </>
            )}
            {leftTab === "describe" && (
              <DescribePanel
                text={text}
                setText={setText}
                onBuild={() => void buildFromText()}
                onPreset={(id) => void loadPreset(id).then(() => setLeftTab("hardware"))}
                onData={(f) => void f.text().then((t) => loadData(t, f.name))}
                onSample={() => void loadData(sampleStepCsv(), "sample_motor_step.csv")}
                busy={!!busy}
                pipeline={pipeline}
                aiOn={aiOn}
              />
            )}
          </div>
        </aside>

        {/* Centre: the machine */}
        <main className="order-first flex min-h-[78vh] flex-col border-b border-line lg:order-none lg:min-h-0 lg:border-b-0">
          <div className={`flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 [scrollbar-width:none] ${simple ? "hidden" : ""}`}>
            {views.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`mono-label relative flex h-10 shrink-0 items-center gap-1.5 px-3 transition-colors ${view === id ? "text-fg" : "text-dim hover:text-mute"}`}
              >
                <Icon className="size-3.5" /> {label}
                {id === "wiring" && hw && hw.checks.some((c) => c.auto) && <span className="size-1 rounded-full bg-spec-1" />}
                {view === id && <motion.span layoutId="lab-view" className="absolute inset-x-2 bottom-0 h-px" style={{ background: "var(--spectrum)" }} />}
              </button>
            ))}
          </div>

          {!ready ? (
            <div className="flex flex-1 items-center justify-center">
              <motion.div animate={{ rotate: [0, 4, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity }}>
                <RoboMark className="size-16" />
              </motion.div>
            </div>
          ) : (
            <>
              {(view === "hardware" || simple) && (
                <HardwareView
                  simple={simple}
                  title={simple ? FRIENDLY[hw!.build.kind].name : undefined}
                  className="min-h-[520px] flex-1"
                  hw={hw!}
                  model={effModel!}
                  run={prun!}
                  tel={ptel!}
                  checks={allChecks}
                  stable={m!.stable === 1}
                  settlingTime={m!.settlingTime}
                  resetKey={simKey}
                  playback={playback}
                  programs={dataModel ? PROGRAMS[hw!.build.kind].slice(0, 1) : PROGRAMS[hw!.build.kind]}
                  program={program}
                  onProgram={setProgram}
                  selected={selected}
                  onSelect={setSelected}
                  onBuild={onBuild}
                  dock={
                    simple ? (
                      <ReportCard items={reportItems} onImprove={() => void improve()} busy={busy === "tune"} />
                    ) : (
                    <div className="border-t border-line bg-void/80 backdrop-blur">
                      <button onClick={() => setDockOpen((v) => !v)} className="mono-label flex w-full items-center justify-between px-3 py-1 text-[9.5px] text-dim hover:text-mute">
                        <span className="flex items-center gap-2">
                          <Activity className="size-3" /> Live scope
                          {m && (
                            <span className={specOk ? "text-ok" : "text-warn"}>
                              · {m.stable ? `${m.overshootPct.toFixed(1)}% OS · settles ${m.settlingTime < 0 ? "—" : `${fmtNum(m.settlingTime)} s`}` : "unstable"}
                            </span>
                          )}
                        </span>
                        <ChevronDown className={`size-3 transition-transform ${dockOpen ? "" : "rotate-180"}`} />
                      </button>
                      <AnimatePresence initial={false}>
                        {dockOpen && (
                          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                            <div className="grid grid-cols-1 gap-px px-1 pb-1 sm:grid-cols-2">
                              <TimeChart
                                className="h-[104px]"
                                animateKey={`${simKey}-${program}`}
                                playback={playback}
                                refValue={program === "mission" ? effModel!.sim.ref : undefined}
                                band={program === "mission" ? 0.02 : undefined}
                                yLabel={`${model!.output.name} [${model!.output.unit}]`}
                                series={
                                  program === "mission"
                                    ? outputSeries
                                    : [
                                        { y: prun!.r, dt: prun!.dt, color: "#8b909c", label: "setpoint", width: 1, dash: "4 3" },
                                        { y: prun!.y, dt: prun!.dt, color: "#3ff0ff", label: model!.output.name.toLowerCase(), width: 1.6 },
                                      ]
                                }
                              />
                              <TimeChart
                                className="hidden h-[104px] sm:block"
                                animateKey={`${simKey}-${program}`}
                                playback={playback}
                                limit={ptel!.limitA}
                                yLabel={`${ptel!.label} [A]`}
                                series={[{ y: ptel!.perMotor, dt: prun!.dt, color: "#ffb020", label: "current", width: 1.3 }]}
                              />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    )
                  }
                />
              )}
              {!simple && view === "scope" && (
                <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
                  <SpecStrip checks={checks} metrics={m!} pm={result!.analysis.pmDeg} unit={effModel!.input.unit} />
                  <div className="relative px-2 pt-3">
                    <TimeChart
                      className="h-[260px]"
                      animateKey={simKey}
                      playback={program === "mission" ? playback : undefined}
                      refValue={effModel!.sim.ref}
                      band={0.02}
                      limit={effModel!.sim.ref * (1 + effModel!.specs.maxOvershootPct / 100)}
                      yLabel={`${effModel!.output.name} [${effModel!.output.unit}]`}
                      series={outputSeries}
                    />
                    {!m?.stable && <div className="mono-label absolute top-6 left-16 border border-bad/50 bg-bad/10 px-2 py-1 text-bad">Unstable</div>}
                  </div>
                  <div className="grid gap-px px-2 md:grid-cols-2">
                    <TimeChart
                      className="h-[150px]"
                      animateKey={simKey}
                      playback={program === "mission" ? playback : undefined}
                      limit={Number.isFinite(effModel!.specs.uMax) && effModel!.specs.uMax < 1e8 ? effModel!.specs.uMax : undefined}
                      yLabel={`${effModel!.input.name} [${effModel!.input.unit}]`}
                      series={[{ y: result!.sim.u, dt: result!.sim.dt, color: "#b06bff", label: "control u", width: 1.3 }]}
                    />
                    <TimeChart
                      className="h-[150px]"
                      animateKey={simKey}
                      playback={program === "mission" ? playback : undefined}
                      limit={tel!.limitA}
                      yLabel={`${tel!.label} [A]`}
                      series={[{ y: tel!.perMotor, dt: result!.sim.dt, color: "#ffb020", label: "current", width: 1.3 }]}
                    />
                  </div>
                  <p className="px-4 py-3 font-mono text-[10.5px] text-dim">
                    Dashed line on the current plot: the {hw!.driver.name}&apos;s {tel!.limitA} A continuous rating. Scrub the 3D view and the cursor follows.
                  </p>
                </div>
              )}
              {!simple && view === "analysis" && (
                <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
                  <SpecStrip checks={checks} metrics={m!} pm={result!.analysis.pmDeg} unit={effModel!.input.unit} />
                  <div className="grid gap-px bg-line md:grid-cols-2">
                    <div className="bg-void">
                      <SectionLabel>s-plane</SectionLabel>
                      <PoleMap className="h-72" poles={result!.analysis.poles} openPoles={result!.analysis.openPoles} />
                      <div className="border-t border-line p-4 font-mono text-[11px] text-mute">
                        {result!.analysis.poles.map((p, i) => (
                          <span key={i} className={`mr-3 inline-block ${p.re >= 0 ? "text-bad" : ""}`}>
                            {fmtNum(p.re)}
                            {Math.abs(p.im) > 1e-9 ? ` ${p.im > 0 ? "+" : "−"} ${fmtNum(Math.abs(p.im))}j` : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="bg-void">
                      <SectionLabel>Open-loop Bode {ctrl!.type === "lqr" ? "(broken at plant input)" : "L = C·P"}</SectionLabel>
                      {bode && <BodePlot className="h-72" w={bode.w} mag={bode.mag} phase={bode.phase} wcp={bode.wcp} pm={bode.pmDeg} />}
                      <div className="grid grid-cols-2 border-t border-line font-mono text-[11px]">
                        <p className="border-r border-line p-4">
                          <span className="text-dim">Gain margin </span>
                          {bode && (bode.gmDb >= 1e8 ? "∞" : `${fmtNum(bode.gmDb)} dB @ ${fmtNum(bode.wcg)} rad/s`)}
                        </p>
                        <p className="p-4">
                          <span className="text-dim">Phase margin </span>
                          {bode && (bode.pmDeg >= 1e8 ? "∞" : `${fmtNum(bode.pmDeg)}° @ ${fmtNum(bode.wcp)} rad/s`)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {!simple && view === "wiring" && <WiringDiagram wiring={hw!.wiring} />}
              {!simple && view === "validate" && (
                <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
                  <ValidatePanel results={validation.results} running={validation.running} total={CHECK_COUNT} onRun={() => void runValidation()} refValue={effModel!.sim.ref} />
                </div>
              )}
              {!simple && view === "code" && code && (
                <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
                  <CodePanel code={code.text} ts={code.ts} filename={`${(model!.presetId ?? "controller").replace(/\W+/g, "_")}.ino`} />
                </div>
              )}
            </>
          )}
        </main>

        {/* Right: checks / copilot */}
        <aside data-tour="coach" className="flex min-h-[560px] flex-col border-t border-line lg:min-h-0 lg:border-t-0 lg:border-l">
          {simple ? (
            <>
              <SectionLabel>Robo · your coach</SectionLabel>
              <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
                {hw && (
                  <CoachPanel
                    hw={hw}
                    items={reportItems}
                    checks={allChecks}
                    onBuild={onBuild}
                    onSelect={setSelected}
                    onImprove={() => void improve()}
                    busy={busy === "tune"}
                    lastNote={coachNote}
                  />
                )}
              </div>
            </>
          ) : (
          <>
          <Tabs
            value={rightTab}
            onChange={setRightTab}
            items={[
              { id: "checks", label: `Design checks${issues ? ` · ${issues}` : ""}`, icon: ShieldCheck },
              { id: "copilot", label: "Copilot", icon: MessageSquare },
            ]}
            layoutId="right-tab"
          />
          <div className={`min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin] ${rightTab === "checks" ? "" : "hidden"}`}>
            {hw && <ChecksPanel hw={hw} checks={allChecks} onBuild={onBuild} onSelect={(s) => { setSelected(s); setView("hardware"); }} />}
          </div>
          <div className={`flex min-h-0 flex-1 flex-col ${rightTab === "copilot" ? "" : "hidden"}`}>
            <Copilot
              messages={messages}
              iterations={iterations}
              current={ctrl}
              busy={busy}
              ready={!!model}
              specOk={specOk}
              onAsk={(q) => void ask(q)}
              onApply={apply}
              onAuto={() => void autoIterate()}
              onTune={() => void tune()}
              onRestore={(it) => {
                setCtrl(it.controller);
                setSimKey((k) => k + 1);
              }}
            />
          </div>
          </>
          )}
        </aside>
      </div>

      <AnimatePresence>
        {welcome && (
          <Welcome
            onClose={() => {
              setWelcome(false);
              try {
                localStorage.setItem("rc-onboarded", "1");
              } catch {}
            }}
            onDone={(m, pick, tour) => {
              setWelcome(false);
              setMode(m);
              setView("hardware");
              try {
                localStorage.setItem("rc-onboarded", "1");
              } catch {}
              if (pick === "describe") setLeftTab("describe");
              else {
                setLeftTab("hardware");
                if (pick !== build?.kind) void loadRig(pick);
              }
              if (tour) setTimeout(() => setTouring(true), pick !== "describe" && pick !== build?.kind ? 1600 : 500);
            }}
          />
        )}
      </AnimatePresence>
      {touring && ready && <Tour steps={tourSteps(mode, hw!.build.kind)} onClose={() => setTouring(false)} />}
    </div>
  );
}

function Tabs<T extends string>({ value, onChange, items, layoutId }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; icon: typeof Activity }[]; layoutId: string }) {
  return (
    <div className="flex shrink-0 border-b border-line">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`mono-label relative flex h-10 flex-1 items-center justify-center gap-1.5 px-2 text-[10.5px] transition-colors ${value === id ? "text-fg" : "text-dim hover:text-mute"}`}
        >
          <Icon className="size-3.5" /> {label}
          {value === id && <motion.span layoutId={layoutId} className="absolute inset-x-3 bottom-0 h-px" style={{ background: "var(--spectrum)" }} />}
        </button>
      ))}
    </div>
  );
}

function ScenarioToggles({ scenario, setScenario, model }: { scenario: Scenario; setScenario: React.Dispatch<React.SetStateAction<Scenario>>; model: LabModel | null }) {
  const kind = model?.rig?.kind;
  const distLabel = kind === "rover" ? "Ramp halfway through" : kind === "arm" ? "Release the payload" : kind === "drone" ? "Down-gust" : "Load disturbance";
  return (
    <div className="space-y-2.5 p-4">
      {(
        [
          ["disturbance", distLabel],
          ["noise", "Sensor noise (from datasheet)"],
          ["limits", "Battery / thrust limits"],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="flex cursor-pointer items-center justify-between text-[12.5px] text-mute">
          {label}
          <button
            role="switch"
            aria-checked={scenario[k]}
            onClick={() => setScenario((s) => ({ ...s, [k]: !s[k] }))}
            className={`relative h-4 w-7 rounded-full transition-colors ${scenario[k] ? "bg-fg" : "bg-line-2"}`}
          >
            <motion.span layout className={`absolute top-0.5 size-3 rounded-full bg-void ${scenario[k] ? "right-0.5" : "left-0.5"}`} />
          </button>
        </label>
      ))}
      {model && (
        <p className="pt-1 font-mono text-[10px] text-dim">
          u ∈ [{fmtNum(model.specs.uMin)}, {fmtNum(model.specs.uMax)}] {model.input.unit}
        </p>
      )}
    </div>
  );
}
