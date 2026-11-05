"use client";

// RoboCraft Control Lab: describe → build the hardware → model → control → simulate → explain →
// iterate → validate. The hardware build is the source of truth: parts and dimensions give the
// plant, the actuator limits and the design checks.
import { Activity, Box, Cable, ChevronDown, CircleHelp, Code2, Cpu, Download, MessageSquare, PenLine, Plus, ShieldCheck, SlidersHorizontal, Waves } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppNav from "@/components/AppNav";
import { Segmented, ThemeToggle } from "@/components/create/ui";
import { applyActions, assistContext, type AssistAction, type AssistResult } from "@/lib/lab/assist";
import { MODEL_CHOICES, pickModel, type ModelChoice } from "@/lib/meta/models";
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
import { rigFor } from "@/lib/lab/rig";
import { tuneAsync } from "@/lib/lab/tuneClient";
import type { Advice, CallUsage, ControllerSpec, Iteration, LabModel, RigKind } from "@/lib/lab/types";
import { catalogOf, totalMassG, updatePart, type Assembly } from "@/lib/lab/assembly";
import { machineFirmware } from "@/lib/lab/machineFirmware";
import { takeHandoff } from "@/lib/create/handoff";
import { sanitizeDesign, type Design } from "@/lib/create/design";
import { designToAssembly } from "@/lib/lab/fromDesign";
import { estimateFps, tracksToStepCsv } from "@/lib/lab/video";
import type { SamBox } from "@/lib/meta/sam";
import { CHECK_COUNT, validateDesign } from "@/lib/lab/validate";
import type { CheckResult } from "@/lib/lab/validate";
import { useEngine } from "@/lib/sim/useEngine";
import { BodePlot, PoleMap, TimeChart } from "./charts";
import { ChecksPanel, GeometryPanel, PartsPanel, RigPicker, WiringDiagram } from "./hwpanels";
import { CoachPanel, FRIENDLY, ReportCard, SLOT_HELP, Tour, Welcome, report, tourSteps } from "./onboarding";
import type { Mode } from "./onboarding";
import type { AssistSnapshot, ChatMsg } from "./panels";
import type { VideoTrackOptions } from "./VideoTrack";
import { Assistant, CodePanel, DescribePanel, GhostButton, ModelCard, PIPELINE, SectionLabel, SpecStrip, TunerPanel, ValidatePanel, describeCtrl, diffCtrl } from "./panels";
import EmptyStage from "./EmptyStage";
import { MachineCoach, MachineReport, MachineScope } from "./MachineCoach";
import { simulateMachine } from "@/lib/lab/actuation";
import { loadUserParts } from "./PartsLibrary";
import type { CatalogPart } from "@/lib/lab/catalog/parts";
import MachinePanel from "./MachinePanel";

const HardwareView = dynamic(() => import("./HardwareView"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-panel" />,
});

type View = "hardware" | "scope" | "analysis" | "wiring" | "validate" | "code";
type LeftTab = "hardware" | "control" | "describe" | "edit" | "task" | "engineer" | "agent";
type RightTab = "checks" | "assistant";
const LAB_STATE_KEY = "rc-control-lab-state";
const PREVIOUS_LAB_STATE_KEY = "rc-control-lab-previous";
type SavedLabState = { text?: string; build?: HardwareBuild | null; dataModel?: LabModel | null; ctrl?: ControllerSpec | null; messages?: ChatMsg[]; iterations?: Iteration[]; promptHistory?: string[] };
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

/** An AI machine's model with the physics its drivetrain parts imply (as the demos derive theirs). */
function withHardwarePhysics(m: LabModel, b: HardwareBuild): LabModel {
  const derived = deriveHardware(b).model;
  return { ...derived, title: m.title, summary: m.summary, source: m.source, review: m.review, assembly: m.assembly ? { ...m.assembly, hardware: b } : undefined };
}

export default function Lab({ initialPreset, onboard = false, fromCreate = false }: { initialPreset?: string; onboard?: boolean; fromCreate?: boolean }) {
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
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [pipeline, setPipeline] = useState(-1);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<View>("hardware");
  const [leftTab, setLeftTab] = useState<LeftTab>(initialPreset ? "hardware" : "describe");
  const [rightTab, setRightTab] = useState<RightTab>("checks");
  const [selected, setSelected] = useState<SlotId | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(310);
  const [rightWidth, setRightWidth] = useState(350);
  const [resizing, setResizing] = useState<"left" | "right" | null>(null);
  const [hasPreviousLab, setHasPreviousLab] = useState(false);
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  // Which Meta model does the lab's AI work: Muse Spark (default) or Muse Wonder. Shared with Create.
  const [llm, setLlm] = useState<ModelChoice>("muse-spark-1.3");
  useEffect(() => {
    let saved: ModelChoice = "muse-spark-1.3";
    try {
      saved = pickModel(localStorage.getItem("rc-design-model"), saved);
    } catch {}
    if (saved === "muse-spark-1.3") return;
    const id = setTimeout(() => setLlm(saved), 0);
    return () => clearTimeout(id);
  }, []);
  const chooseLlm = useCallback((m: ModelChoice) => {
    setLlm(m);
    try {
      localStorage.setItem("rc-design-model", m);
    } catch {}
  }, []);
  const llmName = MODEL_CHOICES.find((m) => m.id === llm)?.name ?? "Muse Spark";
  const [simpleTab, setSimpleTab] = useState<"coach" | "assistant">("coach");
  // Today's Meta spend against the daily cap; bumped locally after each live call.
  const [spend, setSpend] = useState<{ usd: number; budgetUsd: number } | null>(null);
  const addSpend = useCallback((u?: CallUsage) => {
    if (u && !u.cached) setSpend((s) => (s ? { ...s, usd: s.usd + u.costUsd } : s));
  }, []);
  /** Reads the logged total; used after failures, whose attempts still cost. */
  const refreshSpend = useCallback(() => {
    fetch("/api/lab/status")
      .then((r) => r.json())
      .then((s: { spentUsd?: number; budgetUsd?: number }) => s.budgetUsd && setSpend({ usd: s.spentUsd ?? 0, budgetUsd: s.budgetUsd }))
      .catch(() => {});
  }, []);
  // Why the last description couldn't be built (shown with a retry, never replaced by a demo).
  const [buildError, setBuildError] = useState<string | null>(null);
  // The user's uploaded parts (kept in this browser), sent with every build.
  const [userParts, setUserParts] = useState<CatalogPart[]>([]);
  useEffect(() => {
    const id = requestAnimationFrame(() => setUserParts(loadUserParts()));
    return () => cancelAnimationFrame(id);
  }, []);
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
      if ((onboard || !seen) && !fromCreate) setWelcome(true);
    });
    return () => cancelAnimationFrame(id);
  }, [onboard, fromCreate]);
  const iterSeq = useRef(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (fromCreate || initialPreset) {
      setHydrated(true);
      return;
    }
    try {
      const raw = localStorage.getItem(LAB_STATE_KEY);
      if (!raw) {
        setHydrated(true);
        return;
      }
      const saved = JSON.parse(raw) as SavedLabState;
      if (saved.text) setText(saved.text);
      if (saved.build) setBuild(saved.build);
      if (saved.dataModel) setDataModel(saved.dataModel);
      if (saved.ctrl) setCtrl(saved.ctrl);
      if (saved.messages) setMessages(saved.messages);
      if (saved.iterations) setIterations(saved.iterations);
      if (saved.promptHistory) setPromptHistory(saved.promptHistory);
    } catch {
      localStorage.removeItem(LAB_STATE_KEY);
    }
    try {
      setHasPreviousLab(!!localStorage.getItem(PREVIOUS_LAB_STATE_KEY));
    } catch {}
    setHydrated(true);
  }, [fromCreate, initialPreset]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LAB_STATE_KEY, JSON.stringify({ text, build, dataModel, ctrl, messages, iterations, promptHistory }));
    } catch {
      setNotice("Your lab is open, but this browser could not save the latest state.");
    }
  }, [hydrated, text, build, dataModel, ctrl, messages, iterations, promptHistory]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("rc-control-lab-panels") ?? "{}") as { left?: number; right?: number };
      if (typeof saved.left === "number") setLeftWidth(Math.min(460, Math.max(260, saved.left)));
      if (typeof saved.right === "number") setRightWidth(Math.min(460, Math.max(280, saved.right)));
    } catch {}
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const move = (event: PointerEvent) => {
      if (resizing === "left") setLeftWidth(Math.min(460, Math.max(260, event.clientX)));
      else setRightWidth(Math.min(460, Math.max(280, window.innerWidth - event.clientX)));
    };
    const stop = () => setResizing(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizing]);

  useEffect(() => {
    try {
      localStorage.setItem("rc-control-lab-panels", JSON.stringify({ left: leftWidth, right: rightWidth }));
    } catch {}
  }, [leftWidth, rightWidth]);

  useEffect(() => {
    fetch("/api/lab/status")
      .then((r) => r.json())
      .then((s: { ai: boolean; spentUsd?: number; budgetUsd?: number }) => {
        setAiOn(s.ai);
        if (s.budgetUsd) setSpend({ usd: s.spentUsd ?? 0, budgetUsd: s.budgetUsd });
      })
      .catch(() => setAiOn(false));
  }, []);

  const hw = useMemo(() => (build ? deriveHardware(build) : null), [build]);
  const model = dataModel ?? hw?.model ?? null;

  // ---- AI-designed machine: selection, edits, undo ---------------------------------------------
  const machine = model?.assembly ?? null;
  // An AI machine with a drivetrain build runs on the same hardware engine as the demos: part slots,
  // geometry, electrical checks with auto-fixes, wiring, controller and firmware.
  const aiRig = !!machine?.hardware;
  const machineSim = useMemo(() => (machine ? simulateMachine(machine) : null), [machine]);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const dataModelTitle = useRef<string | undefined>(undefined);
  const [undoStack, setUndoStack] = useState<Assembly[]>([]);
  const editAssembly = useCallback(
    (next: Assembly) => {
      if (!dataModel?.assembly) return;
      const prev = dataModel.assembly;
      setUndoStack((s) => [...s.slice(-49), prev]);
      setDataModel({ ...dataModel, assembly: next });
    },
    [dataModel],
  );
  const undo = useCallback(() => {
    if (!dataModel?.assembly || !undoStack.length) return;
    setDataModel({ ...dataModel, assembly: undoStack[undoStack.length - 1] });
    setUndoStack((s) => s.slice(0, -1));
  }, [dataModel, undoStack]);
  const locateSlot = useCallback(
    (slot: SlotId | null) => {
      setSelected(slot);
      if (!slot || !machine) return;
      const cats: Record<SlotId, string[]> = { board: ["controller"], driver: ["driver"], motor: ["motor", "servo", "stepper"], battery: ["power"], sensor: ["sensor"], prop: ["motor"] };
      const hit = machine.parts.find((p) => cats[slot].includes(catalogOf(p)?.category ?? ""));
      if (hit) setSelectedPart(hit.id);
    },
    [machine],
  );
  const transformPart = useCallback(
    (id: string, position: [number, number, number], rotation: [number, number, number]) => machine && editAssembly(updatePart(machine, id, { position, rotation })),
    [machine, editAssembly],
  );
  useEffect(() => {
    if (!machine) return;
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [machine, undo]);
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
    // The preset rigs' part checks (wheel slip, driver current…) don't apply to AI-designed machines.
    if (machine && !aiRig) return [];
    if (!hw || !result || !tel) return hw?.checks ?? [];
    return sortChecks([...hw.checks, ...liveChecks(hw, tel, result.sim.u, result.analysis.wcp, result.analysis.metrics.stable === 1)]);
  }, [machine, aiRig, hw, result, tel]);
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
    // `live: false` uses the free offline advisor; Muse Spark only runs when the user asks.
    async (m: LabModel, c: ControllerSpec, question?: string, its: Iteration[] = iterations, live = true): Promise<Advice | null> => {
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
          body: JSON.stringify({ model: eff, controller: c, history, question, offline: !live, llm }),
        });
        const advice = (await res.json()) as Advice & { notice?: string; error?: string };
        if (!res.ok || advice.error) throw new Error(advice.error ?? `HTTP ${res.status}`);
        addSpend(advice.usage);
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
    [engine, scenario, iterations, addSpend, llm],
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
      // A different design starts a fresh edit history; re-derived physics keeps the same design.
      if (fromData?.assembly?.title !== dataModelTitle.current) {
        setSelectedPart(null);
        setUndoStack([]);
      }
      dataModelTitle.current = fromData?.assembly?.title;
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
      await explain(m, m.controller, undefined, [first], false);
      setPipeline(5);
      await sleep(600);
      setPipeline(-1);
    },
    [engine, scenario, explain],
  );

  /**
   * A realistic design (from the designer) becomes this lab's machine: every shell as designed, real
   * actuators on every joint, controller, power, drivers, sensors and wiring inside, and the physics
   * of its drivetrain (from its hardware build, else the closest rig).
   */
  const adoptDesign = useCallback(
    async (d: Design, note: string) => {
      const { assembly } = designToAssembly(d, d.hardware && d.hardware.kind !== "none" ? d.hardware : undefined);
      const kind: RigKind = assembly.hardware?.kind ?? (d.robot.mobility === "flying" ? "drone" : d.robot.mobility === "wheels" || d.robot.mobility === "tracks" ? "rover" : "arm");
      const b = assembly.hardware ?? defaultBuild(kind);
      const physics = deriveHardware(b).model;
      await adopt(b, note, { ...physics, title: d.title, summary: d.summary, source: "meta", assembly });
      setLeftTab("hardware");
    },
    [adopt],
  );

  const buildFromText = useCallback(async () => {
    if (!text.trim()) return;
    setPromptHistory((history) => [...history.filter((p) => p !== text.trim()), text.trim()]);
    setBuildError(null);
    setBusy("model");
    setPipeline(0);
    try {
      const t0 = performance.now();
      // A description becomes the realistic design (shells, proportions, joints) with real hardware
      // inside, the same as Create. Measured step data still goes through the model-fitting path.
      if (!data) {
        const req = fetch("/api/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: text, model: llm }) });
        await sleep(400);
        setPipeline(1);
        const res = await req;
        const out = (await res.json()) as { design?: Design; usage?: CallUsage; error?: string };
        if (!res.ok || !out.design) throw new Error(out.error ?? `${llmName} didn't return a design. Try again.`);
        addSpend(out.usage);
        if (performance.now() - t0 < 900) await sleep(400);
        await adoptDesign(sanitizeDesign(out.design, 1), `${llmName} designed "${out.design.title}": the body as designed, with a real actuator on every joint and its controller, power and wiring inside (X-ray to see them). Click any part to edit or swap it, or press Simulate.`);
        return;
      }
      const res = fetch("/api/lab/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: text, dataSummary: data ? fitSummary(engine.fit(data.t, data.y, data.uStep, 0), data) : undefined, customParts: userParts }),
      });
      await sleep(400);
      setPipeline(1);
      const body = (await (await res).json()) as { model?: LabModel; error?: string; usage?: CallUsage; foundOnline?: { name: string }[]; searchNotes?: string[] };
      // A description only ever becomes the machine Muse Spark designed. Never a demo robot.
      if (!body.model?.assembly || body.model.source !== "meta") throw new Error(body.error ?? "Muse Spark didn't return a design. Try again.");
      addSpend(body.usage);
      if (performance.now() - t0 < 900) await sleep(400);
      // The 3D view builds the AI design; the hidden hardware scaffold only feeds the simulator.
      const asm = body.model.assembly;
      const b = asm.hardware ?? applyHints(defaultBuild(rigFor(body.model, text).kind), text);
      await adopt(
        b,
        [
          `Muse Spark designed "${body.model.assembly.title}" (${body.model.assembly.parts.length} parts) and its physics; the engine checked it. Click any part to edit it, or press Simulate to test.`,
          body.foundOnline?.length ? `Found online: ${body.foundOnline.map((p) => p.name).join(", ")}.` : "",
          ...(body.searchNotes ?? []),
        ]
          .filter(Boolean)
          .join(" "),
        asm.hardware ? withHardwarePhysics(body.model, asm.hardware) : body.model,
      );
      setLeftTab("hardware");
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : String(err));
      setPipeline(-1);
      refreshSpend();
    } finally {
      setBusy(null);
    }
  }, [text, data, engine, adopt, adoptDesign, addSpend, refreshSpend, userParts, llm, llmName]);

  const loadRig = useCallback(
    async (kind: RigKind, prompt?: string) => {
      setBusy("model");
      if (prompt) {
        setText(prompt);
        setPromptHistory((history) => [...history.filter((p) => p !== prompt), prompt]);
      }
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
    async (csv: string, name: string, source = `Identified from ${name}`) => {
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
        await adopt(applyHints(defaultBuild(kind), text), `${source}: ${fitSummary(fit, d)}. The plant comes from your data; swapping a part switches back to the physics model.`, local);
      } catch (err) {
        setNotice(`Couldn't read that data: ${err instanceof Error ? err.message : String(err)}`);
        setPipeline(-1);
      } finally {
        setBusy(null);
      }
    },
    [engine, text, adopt],
  );

  // Muse Spark re-derives the physics from the engineer's edited design (masses, sizes, specs).
  const rederivePhysics = useCallback(async () => {
    if (!machine || !build) return;
    if (machine.hardware && model) {
      await adopt(build, `Re-derived the physics from the drivetrain parts (${machine.parts.length} parts, ${Math.round(totalMassG(machine))} g).`, withHardwarePhysics(model, build));
      return;
    }
    setBusy("model");
    setPipeline(1);
    try {
      const res = await fetch("/api/lab/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: text.trim() || machine.title, assembly: machine, customParts: userParts }),
      });
      const body = (await res.json()) as { model?: LabModel; error?: string; usage?: CallUsage };
      addSpend(body.usage);
      if (!res.ok || !body.model) throw new Error(body.error ?? `HTTP ${res.status}`);
      const keep = selectedPart;
      // The feasibility review is about the idea, so it carries over to the re-derived physics.
      await adopt(
        build,
        `Muse Spark re-derived the physics from your design (${machine.parts.length} parts, ${Math.round(totalMassG(machine))} g). Press Simulate to test it.`,
        { ...body.model, review: body.model.review ?? model?.review },
      );
      setSelectedPart(keep);
      setLeftTab("hardware");
    } catch (err) {
      setNotice(`Couldn't update the physics: ${err instanceof Error ? err.message : String(err)}`);
      setPipeline(-1);
    } finally {
      setBusy(null);
    }
  }, [machine, build, text, addSpend, adopt, selectedPart, model, userParts]);

  // "Film it": SAM 3.1 tracks the robot in a clip; its motion becomes step data and is fitted.
  const trackVideo = useCallback(
    async (file: File, opts: VideoTrackOptions, durationS: number) => {
      setBusy("model");
      setPipeline(0);
      try {
        const form = new FormData();
        form.append("video", file);
        form.append("prompt", opts.prompt.trim());
        form.append("frames", String(Math.ceil(durationS * 30)));
        const res = await fetch("/api/lab/track", { method: "POST", body: form });
        const body = (await res.json()) as { boxes?: SamBox[]; frameCount?: number; cached?: boolean; costUsd?: number; error?: string };
        if (body.costUsd !== undefined) addSpend({ model: "sam-3.1", cached: !!body.cached, tokens: 0, costUsd: body.costUsd });
        if (!res.ok || !body.boxes) throw new Error(body.error ?? `HTTP ${res.status}`);
        const out = tracksToStepCsv({
          boxes: body.boxes,
          fps: estimateFps(body.frameCount ?? 0, durationS),
          lengthM: opts.lengthCm / 100,
          measure: opts.measure,
          uStep: opts.uStep,
        });
        const cost = body.cached ? "replayed from cache, $0" : `$${(body.costUsd ?? 0).toFixed(3)}`;
        await loadData(
          out.csv,
          file.name,
          `SAM 3.1 tracked "${opts.prompt}" in ${out.samples} frames (${cost}): it travelled ${fmtNum(out.distanceM)} m, peaking at ${fmtNum(out.peakSpeed)} m/s. Fitted model`,
        );
      } catch (err) {
        setNotice(`Video tracking failed: ${err instanceof Error ? err.message : String(err)}`);
        setPipeline(-1);
        setBusy(null);
      }
    },
    [addSpend, loadData],
  );

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    // A robot sent from Create: Muse Spark engineers it here from real parts (one build, on the
    // user's click in Create).
    if (fromCreate) {
      const h = takeHandoff();
      if (h) {
        setText(h.prompts.join("\n"));
        setPromptHistory(h.prompts);
        void adoptDesign(sanitizeDesign(h.design, h.design.version ?? 1), `"${h.title}" from your Create project: the body exactly as designed, with real hardware inside (X-ray to see it).`);
        return;
      }
    }
    // The lab opens on an empty workspace; a demo robot loads only when one is asked for.
    const p = initialPreset ? presetById(initialPreset) : undefined;
    if (p) void loadRig(p.rig, p.prompt);
  }, [initialPreset, loadRig, fromCreate, adoptDesign]);

  // ---- Hardware changes ----------------------------------------------------------------------
  const onBuild = useCallback(
    (b: HardwareBuild, note: string | null) => {
      setBuild(b);
      setValidation({ results: [], running: false });
      if (dataModel?.assembly?.hardware) {
        setDataModel(withHardwarePhysics(dataModel, b));
      } else if (dataModel) {
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

  // ---- The assistant: ask the chosen model, or have it change the machine ------------------------
  // Slots and sizes are editable on the demos and on designed machines with a drivetrain; other
  // designed machines change by swapping their catalogue parts.
  const slotsEditable = !!build && (!machine || aiRig);
  /** Applies validated actions to the live machine; returns what changed and how to undo it. */
  const applyNow = useCallback(
    (actions: AssistAction[]) => {
      const snap: AssistSnapshot = { build, machine, ctrl };
      const r = applyActions(actions, { build, slots: slotsEditable, checks: allChecks, machine, ctrl });
      const note = r.done.join("; ");
      if (r.build && build && JSON.stringify(r.build) !== JSON.stringify(build)) onBuild(r.build, `${llmName}: ${note}`);
      if (r.machine && r.machine !== machine) editAssembly(r.machine);
      if (r.ctrl && ctrl && JSON.stringify(r.ctrl) !== JSON.stringify(ctrl)) {
        setCtrl(r.ctrl);
        if (model) pushIteration(model, r.ctrl, `${llmName} gains`);
      }
      if (r.done.length) setValidation({ results: [], running: false });
      return { done: r.done, skipped: r.skipped, snap: r.done.length ? snap : undefined };
    },
    [build, machine, ctrl, slotsEditable, allChecks, onBuild, editAssembly, model, pushIteration, llmName],
  );
  const assist = useCallback(
    async (q: string) => {
      if (!model) {
        setNotice("Build or load a machine first, then Robo Copilot can diagnose and fix it.");
        setSimpleTab("assistant");
        setRightTab("assistant");
        return;
      }
      setMessages((prev) => [...prev, { kind: "user", text: q }]);
      setBusy("assist");
      const context = assistContext({
        title: machine?.title ?? model.title,
        build,
        slots: slotsEditable,
        checks: allChecks,
        machine,
        machineChecks: machineSim?.checks ?? [],
        ctrl,
        metrics: result ? { stable: result.analysis.metrics.stable === 1, overshootPct: result.analysis.metrics.overshootPct, settlingTime: result.analysis.metrics.settlingTime, riseTime: result.analysis.metrics.riseTime } : null,
        specs: checks.map((c) => ({ label: c.label, pass: c.pass })),
      });
      const history = messages
        .filter((m): m is Extract<ChatMsg, { kind: "user" | "assist" }> => m.kind === "user" || m.kind === "assist")
        .slice(-6)
        .map((m) => (m.kind === "user" ? { role: "user" as const, text: m.text } : { role: "assistant" as const, text: [m.reply, ...m.done].join(" ").slice(0, 1500) }));
      try {
        const res = await fetch("/api/lab/assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, context, history, model: llm }) });
        const out = (await res.json()) as AssistResult & { usage?: CallUsage; error?: string };
        if (!res.ok || out.error) throw new Error(out.error ?? `HTTP ${res.status}`);
        addSpend(out.usage);
        const now = out.mode === "applied" && out.actions.length ? applyNow(out.actions) : { done: [], skipped: [], snap: undefined };
        setMessages((prev) => [
          ...prev,
          { kind: "assist", reply: out.reply, mode: out.mode, done: now.done, skipped: now.skipped, snap: now.snap, suggestions: out.mode === "suggested" ? out.actions : [], applied: [], model: llmName, usage: out.usage },
        ]);
      } catch (err) {
        setMessages((prev) => [...prev, { kind: "event", text: `${llmName} couldn't answer: ${err instanceof Error ? err.message : String(err)}` }]);
        refreshSpend();
      } finally {
        setBusy(null);
      }
    },
    [model, machine, build, slotsEditable, allChecks, machineSim, ctrl, result, checks, messages, llm, llmName, addSpend, applyNow, refreshSpend],
  );
  const undoAssist = useCallback(
    (i: number) => {
      const m = messages[i];
      if (m?.kind !== "assist" || !m.snap || m.undone) return;
      const { snap } = m;
      if (snap.build && build && JSON.stringify(snap.build) !== JSON.stringify(build)) onBuild(snap.build, `undid ${llmName}'s change`);
      if (snap.machine && snap.machine !== machine) editAssembly(snap.machine);
      if (snap.ctrl && ctrl && JSON.stringify(snap.ctrl) !== JSON.stringify(ctrl)) setCtrl(snap.ctrl);
      setMessages((prev) => prev.map((x, k) => (k === i && x.kind === "assist" ? { ...x, undone: true } : x)));
    },
    [messages, build, machine, ctrl, onBuild, editAssembly, llmName],
  );
  const applySuggestion = useCallback(
    (i: number, j: number) => {
      const m = messages[i];
      if (m?.kind !== "assist" || !m.suggestions[j] || m.applied.includes(j)) return;
      const now = applyNow([m.suggestions[j]]);
      setMessages((prev) => [
        ...prev.map((x, k) => (k === i && x.kind === "assist" ? { ...x, applied: [...x.applied, j] } : x)),
        { kind: "assist", reply: now.done.length ? "Applied." : "That change couldn't be applied.", mode: "applied", done: now.done, skipped: now.skipped, snap: now.snap, suggestions: [], applied: [], model: llmName },
      ]);
    },
    [messages, applyNow, llmName],
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
    if (mode === "pro") setRightTab("assistant");
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
    // At most 3 rounds: each one can be a live Muse Spark call.
    for (let round = 0; round < 3; round++) {
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
    if (view !== "code") return null;
    // A machine without a drivetrain gets firmware generated from its own wiring, motion and rules.
    if (machine && !aiRig) {
      const fw = machineFirmware(machine);
      return { ts: 0.02, text: fw.text, filename: fw.filename };
    }
    if (!model || !ctrl || !result) return null;
    const ts = suggestSampleTime(result.analysis.wcp);
    return { ts, text: arduinoCode(model, ctrl, result.ctrl.K, result.ctrl.Nbar, ts), filename: `${(model.presetId ?? "controller").replace(/\W+/g, "_")}.ino` };
  }, [model, ctrl, result, view, machine, aiRig]);

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
    { id: "hardware", label: machine ? "3D design" : "3D hardware", icon: Box },
    { id: "scope", label: "Scope", icon: Activity },
    { id: "analysis", label: "Poles & Bode", icon: Waves },
    // Wiring is generated for the preset rigs only.
    ...(machine && !aiRig ? [] : [{ id: "wiring" as const, label: "Wiring", icon: Cable }]),
    { id: "validate", label: "Validate", icon: ShieldCheck },
    { id: "code", label: "Firmware", icon: Code2 },
  ];
  const ready = !!(model && ctrl && result && effModel && hw && tel && prun && ptel);
  const issues = allChecks.filter((c) => c.level === "error" || c.level === "warn").length;
  const assistantPanel = (isSimple: boolean) => (
    <Assistant
      messages={messages}
      iterations={iterations}
      current={ctrl}
      busy={busy}
      ready={!!model}
      specOk={specOk}
      aiOn={!!aiOn}
      modelName={llmName}
      simple={isSimple}
      onAsk={(q) => void ask(q)}
      onAssist={(q) => void assist(q)}
      onUndo={undoAssist}
      onApplySuggestion={applySuggestion}
      onApply={apply}
      onAuto={() => void autoIterate()}
      onTune={() => void tune()}
      onRestore={(it) => {
        setCtrl(it.controller);
        setSimKey((k) => k + 1);
      }}
    />
  );
  const askToFixMachineCheck = (check: { id: string; title: string; detail: string; part?: string }) => {
    setSimpleTab("assistant");
    setRightTab("assistant");
    void assist(
      `Diagnose and fix hardware check "${check.id}"${check.part ? ` (affected part id: ${check.part})` : ""} now: ${check.title}. ${check.detail} Use a valid catalogue change when one can solve it; otherwise give the smallest concrete redesign recommendation with the measurement and why.`,
    );
  };

  const restoreLab = (saved: SavedLabState) => {
    setText(saved.text ?? "");
    setBuild(saved.build ?? null);
    setDataModel(saved.dataModel ?? null);
    setCtrl(saved.ctrl ?? null);
    setMessages(saved.messages ?? []);
    setIterations(saved.iterations ?? []);
    setPromptHistory(saved.promptHistory ?? []);
    setData(null);
    setValidation({ results: [], running: false });
    setView("hardware");
    setLeftTab(saved.dataModel ? "hardware" : "describe");
    setRightTab("checks");
    setSelected(null);
    setSimKey((key) => key + 1);
  };

  const restorePreviousLab = () => {
    try {
      const raw = localStorage.getItem(PREVIOUS_LAB_STATE_KEY);
      if (!raw) return;
      restoreLab(JSON.parse(raw) as SavedLabState);
      localStorage.removeItem(PREVIOUS_LAB_STATE_KEY);
      setHasPreviousLab(false);
    } catch {
      setNotice("The previous lab could not be restored.");
    }
  };

  const startNewLab = () => {
    if ((text || model || messages.length > 0) && !window.confirm("Start a new lab? You can restore this lab once from the button beside New lab.")) return;
    try {
      const current = localStorage.getItem(LAB_STATE_KEY);
      if (current) localStorage.setItem(PREVIOUS_LAB_STATE_KEY, current);
      localStorage.removeItem(LAB_STATE_KEY);
      setHasPreviousLab(!!current);
    } catch {}
    restoreLab({});
    setPipeline(-1);
    setBusy(null);
    setBuildError(null);
    setNotice(null);
    setSelected(null);
    setView("hardware");
    setLeftTab("describe");
    setRightTab("checks");
    setSimKey((key) => key + 1);
  };

  const outputSeries = ready
    ? [
        ...(ghost ? [{ y: ghost.y, dt: ghost.dt, color: "#8b909c", label: `v${prevIteration?.id}`, width: 1.2, opacity: 0.45, dash: "3 3" }] : []),
        { y: result!.sim.y, dt: result!.sim.dt, color: specOk ? "#4ade80" : "#2dd4ff", label: `v${iterations[iterations.length - 1]?.id ?? 1} ${model!.output.name.toLowerCase()}`, width: 1.8 },
      ]
    : [];

  return (
    <div className="app-ui flex min-h-dvh flex-col bg-void text-fg lg:h-dvh">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <AppNav />
          <span className="hidden text-dim lg:inline">/</span>
          <span className="hidden truncate text-[13px] font-medium lg:inline">{machine ? machine.title : simple && hw ? `Your ${FRIENDLY[hw.build.kind].name.toLowerCase()}` : model ? model.title : "Control lab"}</span>
          <button onClick={startNewLab} className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-mute hover:bg-surface-2 hover:text-fg" title="Start a fresh Control Lab project">
            <Plus className="size-3.5" /> <span className="hidden sm:inline">New lab</span>
          </button>
          {hasPreviousLab && (
            <button onClick={restorePreviousLab} className="hidden shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent-soft sm:inline" title="Restore the lab you had open before starting this one">
              Restore previous
            </button>
          )}
          {hw && !machine && (
            <span
              className={`mono-label hidden rounded-full px-1.5 py-0.5 text-[10px] md:inline ${allChecks.some((c) => c.level === "error") ? "bg-bad/10 text-bad" : issues ? "bg-warn/10 text-warn" : "bg-ok/10 text-ok"}`}
            >
              {allChecks.some((c) => c.level === "error") ? (simple ? "needs fixing" : "not feasible") : issues ? `${issues} warning${issues > 1 ? "s" : ""}` : simple ? "ready to build" : "feasible"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div data-tour="mode" className="flex items-center gap-0.5 rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Mode">
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
                className={`h-7 rounded-[9px] px-3 text-[12.5px] font-medium transition-all ${mode === id ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--color-line)]" : "text-mute hover:text-fg"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Segmented
            size="sm"
            className="inline-flex"
            value={llm}
            onChange={chooseLlm}
            options={MODEL_CHOICES.map((m) => ({ id: m.id, label: m.name, title: `${m.name} designs, explains and changes your machine` }))}
          />
          <button onClick={() => setTouring(true)} className="flex size-8 items-center justify-center rounded-xl text-mute hover:bg-surface-2 hover:text-fg" aria-label="Show me around" title="Show me around">
            <CircleHelp className="size-4" />
          </button>
          {!simple && (
            <>
              <span className={`mono-label hidden rounded-full px-1.5 py-0.5 text-[10px] xl:inline ${engine.backend === "wasm" ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"}`}>
                {engine.backend === "wasm" ? "C++/WASM engine" : "TS engine"}
              </span>
              <GhostButton onClick={exportJson} disabled={!model}>
                <Download className="size-3" /> <span className="hidden sm:inline">Export</span>
              </GhostButton>
            </>
          )}
          <ThemeToggle />
        </div>
      </header>

      <div
        className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 px-3 pb-3 lg:grid-cols-[var(--lab-left)_minmax(0,1fr)_var(--lab-right)]"
        style={{ "--lab-left": `${leftWidth}px`, "--lab-right": `${rightWidth}px` } as React.CSSProperties}
      >
        {/* Left: hardware / control / describe */}
        <aside data-tour="parts" className="relative flex max-h-[85vh] min-h-0 flex-col overflow-hidden rounded-3xl bg-surface shadow-[0_0_0_1px_var(--color-line)] lg:max-h-none">
          <Tabs
            value={simple && leftTab === "control" ? "hardware" : leftTab}
            onChange={setLeftTab}
            items={
              simple
                ? [
                    { id: "hardware", label: machine ? "Parts" : "Demos", icon: Cpu },
                    { id: "describe", label: "Describe", icon: PenLine },
                    { id: "edit", label: "Edit", icon: PenLine },
                    { id: "task", label: "Task", icon: Activity },
                    { id: "agent", label: "Agent", icon: MessageSquare },
                  ]
                : [
                    { id: "hardware", label: machine ? "Parts" : "Demos", icon: Cpu },
                    { id: "control", label: "Control", icon: SlidersHorizontal },
                    { id: "describe", label: "Describe", icon: PenLine },
                    { id: "edit", label: "Edit", icon: PenLine },
                    { id: "task", label: "Task", icon: Activity },
                    { id: "engineer", label: "Engineer", icon: Cpu },
                    { id: "agent", label: "Agent", icon: MessageSquare },
                  ]
            }
            layoutId="left-tab"
          />
          <div role="separator" aria-label="Resize left panel" onPointerDown={() => setResizing("left")} className="absolute top-0 right-[-7px] z-10 hidden h-full w-3 cursor-col-resize lg:block" />
          <div className="rc-scroll min-h-0 flex-1 overflow-y-auto">
            {leftTab === "edit" && machine && (
              <MachinePanel assembly={machine} selected={selectedPart} onSelect={setSelectedPart} onChange={editAssembly} canUndo={undoStack.length > 0} onUndo={undo} onUpdatePhysics={() => void rederivePhysics()} busy={!!busy} aiOn={!!aiOn} review={model?.review} />
            )}
            {leftTab === "task" && (
              <div>
                <SectionLabel>Task & test conditions</SectionLabel>
                <ScenarioToggles scenario={scenario} setScenario={setScenario} model={model} />
                <div className="border-t border-line p-4">
                  <GhostButton onClick={() => { setView("hardware"); setSimKey((k) => k + 1); }} disabled={!ready}>
                    <Activity className="size-3.5" /> Simulate again
                  </GhostButton>
                </div>
              </div>
            )}
            {leftTab === "engineer" && (
              <div className="space-y-2 p-4">
                <SectionLabel>Engineer live</SectionLabel>
                <p className="text-[12px] leading-relaxed text-mute">Tune, validate, and repair the current machine without leaving the lab.</p>
                <GhostButton className="w-full justify-center" onClick={() => void autoIterate()} disabled={!ready || !!busy}><SlidersHorizontal className="size-3.5" /> Auto-tune controller</GhostButton>
                <GhostButton className="w-full justify-center" onClick={() => void runValidation()} disabled={!ready || validation.running}><ShieldCheck className="size-3.5" /> Run validation</GhostButton>
                <GhostButton className="w-full justify-center" onClick={() => { setRightTab("assistant"); setLeftTab("agent"); }} disabled={!model}><MessageSquare className="size-3.5" /> Open repair copilot</GhostButton>
              </div>
            )}
            {leftTab === "agent" && <div className="h-full min-h-[420px]">{assistantPanel(simple)}</div>}
            {(leftTab === "hardware" || (simple && leftTab === "control")) && machine && (
              <>
                {notice && <p className="border-b border-line bg-panel/60 px-4 py-2.5 text-[11.5px] leading-relaxed text-mute">{notice}</p>}
                {aiRig && hw && (
                  <>
                    <SectionLabel>{simple ? "Drivetrain · what makes it move" : `Drivetrain · chosen by ${llmName}`}</SectionLabel>
                    <PartsPanel hw={hw} checks={allChecks} selected={selected} onSelect={locateSlot} onBuild={onBuild} help={simple ? SLOT_HELP : undefined} />
                    <GeometryPanel hw={hw} onBuild={onBuild} groups={simple ? ["Mission", "Mass & payload"] : undefined} />
                    <SectionLabel>Every part</SectionLabel>
                  </>
                )}
                <MachinePanel
                  assembly={machine}
                  selected={selectedPart}
                  onSelect={setSelectedPart}
                  onChange={(next) => editAssembly(next)}
                  canUndo={undoStack.length > 0}
                  onUndo={undo}
                  onUpdatePhysics={() => void rederivePhysics()}
                  busy={!!busy}
                  aiOn={!!aiOn}
                  review={model?.review}
                />
              </>
            )}
            {(leftTab === "hardware" || (simple && leftTab === "control")) && !machine && (
              <>
                <SectionLabel>Demo robots · built-in</SectionLabel>
                <p className="px-4 pt-2 text-[11.5px] leading-relaxed text-dim">
                  Four ready-made robots with real parts and wiring, for demos. To engineer your own machine, use{" "}
                  <button onClick={() => setLeftTab("describe")} className="text-fg underline-offset-2 hover:underline">
                    Describe
                  </button>
                  .
                </p>
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
                        setRightTab("assistant");
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
                modelName={llmName}
                promptHistory={promptHistory}
                text={text}
                setText={setText}
                onBuild={() => void buildFromText()}
                onPreset={(id) => void loadPreset(id).then(() => setLeftTab("hardware"))}
                onData={(f) => void f.text().then((t) => loadData(t, f.name))}
                onSample={() => void loadData(sampleStepCsv(), "sample_motor_step.csv")}
                busy={!!busy}
                pipeline={pipeline}
                aiOn={aiOn}
                spend={spend}
                onVideo={trackVideo}
                error={buildError}
                userParts={userParts}
                onUserParts={setUserParts}
              />
            )}
          </div>
        </aside>

        {/* Centre: the machine */}
        <main className="order-first flex min-h-[78vh] flex-col overflow-hidden rounded-3xl bg-canvas shadow-[0_0_0_1px_var(--color-line)] lg:order-none lg:min-h-0">
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
            <EmptyStage
              busy={!!busy}
              step={pipeline >= 0 ? (PIPELINE[pipeline]?.label ?? null) : null}
              modelName={llmName}
              error={buildError}
              onRetry={text.trim() ? () => void buildFromText() : undefined}
              onDescribe={() => setLeftTab("describe")}
              onDemos={() => setLeftTab("hardware")}
            />
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
                  programs={machine ? [] : dataModel ? PROGRAMS[hw!.build.kind].slice(0, 1) : PROGRAMS[hw!.build.kind]}
                  program={program}
                  onProgram={setProgram}
                  selected={selected}
                  onSelect={setSelected}
                  onBuild={onBuild}
                  selectedPart={selectedPart}
                  onSelectPart={(id) => {
                    setSelectedPart(id);
                    if (id) setLeftTab("hardware");
                  }}
                  onTransformPart={transformPart}
                  dock={
                    machineSim ? (
                      simple ? (
                        <MachineReport sim={machineSim} />
                      ) : (
                        <MachineScope sim={machineSim} playback={playback} simKey={simKey} />
                      )
                    ) : simple ? (
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
                                        { y: prun!.y, dt: prun!.dt, color: "#2dd4ff", label: model!.output.name.toLowerCase(), width: 1.6 },
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
                <div className="rc-scroll min-h-0 flex-1 overflow-y-auto">
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
                    {!m?.stable && <div className="mono-label absolute top-6 left-16 border border-bad/50 bg-bad/10 px-2 py-1 text-bad rounded-xl">Unstable</div>}
                  </div>
                  <div className="grid gap-px px-2 md:grid-cols-2">
                    <TimeChart
                      className="h-[150px]"
                      animateKey={simKey}
                      playback={program === "mission" ? playback : undefined}
                      limit={Number.isFinite(effModel!.specs.uMax) && effModel!.specs.uMax < 1e8 ? effModel!.specs.uMax : undefined}
                      yLabel={`${effModel!.input.name} [${effModel!.input.unit}]`}
                      series={[{ y: result!.sim.u, dt: result!.sim.dt, color: "#9b5cff", label: "control u", width: 1.3 }]}
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
                <div className="rc-scroll min-h-0 flex-1 overflow-y-auto">
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
                <div className="rc-scroll min-h-0 flex-1 overflow-y-auto">
                  <ValidatePanel results={validation.results} running={validation.running} total={CHECK_COUNT} onRun={() => void runValidation()} refValue={effModel!.sim.ref} />
                </div>
              )}
              {!simple && view === "code" && code && (
                <div className="rc-scroll min-h-0 flex-1 overflow-y-auto">
                  <CodePanel code={code.text} ts={code.ts} filename={code.filename} machine={!!machine && !aiRig} />
                </div>
              )}
            </>
          )}
        </main>

        {/* Right: checks / copilot */}
        <aside data-tour="coach" className="relative flex min-h-[560px] flex-col overflow-hidden rounded-3xl bg-surface shadow-[0_0_0_1px_var(--color-line)] lg:min-h-0">
          <div role="separator" aria-label="Resize right panel" onPointerDown={() => setResizing("right")} className="absolute top-0 left-[-7px] z-10 hidden h-full w-3 cursor-col-resize lg:block" />
          {simple ? (
            <>
              <Tabs
                value={simpleTab}
                onChange={setSimpleTab}
                items={[
                  { id: "coach", label: "Robo · coach", icon: ShieldCheck },
                  { id: "assistant", label: "Robo Copilot", icon: MessageSquare },
                ]}
                layoutId="right-tab-simple"
              />
              <div className={`rc-scroll min-h-0 flex-1 overflow-y-auto ${simpleTab === "coach" ? "" : "hidden"}`}>
                {machine && machineSim && <MachineCoach assembly={machine} sim={machineSim} onSelect={(id) => { setSelectedPart(id); setLeftTab("hardware"); }} onFix={askToFixMachineCheck} />}
                {hw && aiRig && <ChecksPanel hw={hw} checks={allChecks} onBuild={onBuild} onSelect={locateSlot} />}
                {hw && !machine && (
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
              <div className={`flex min-h-0 flex-1 flex-col ${simpleTab === "assistant" ? "" : "hidden"}`}>
                {assistantPanel(true)}
              </div>
            </>
          ) : (
          <>
          <Tabs
            value={rightTab}
            onChange={setRightTab}
            items={[
              { id: "checks", label: `Design checks${(machineSim ? machineSim.checks.filter((c) => c.level === "error" || c.level === "warn").length : issues) ? ` · ${machineSim ? machineSim.checks.filter((c) => c.level === "error" || c.level === "warn").length : issues}` : ""}`, icon: ShieldCheck },
              { id: "assistant", label: "Robo Copilot", icon: MessageSquare },
            ]}
            layoutId="right-tab"
          />
          <div className={`rc-scroll min-h-0 flex-1 overflow-y-auto ${rightTab === "checks" ? "" : "hidden"}`}>
            {machine && machineSim && <MachineCoach assembly={machine} sim={machineSim} onSelect={(id) => { setSelectedPart(id); setLeftTab("hardware"); }} onFix={askToFixMachineCheck} />}
            {hw && (!machine || aiRig) && <ChecksPanel hw={hw} checks={allChecks} onBuild={onBuild} onSelect={(s) => { setSelected(s); setView("hardware"); }} />}
          </div>
          <div className={`flex min-h-0 flex-1 flex-col ${rightTab === "assistant" ? "" : "hidden"}`}>{assistantPanel(false)}</div>
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
    <div className="grid shrink-0 gap-1 border-b border-line p-2" style={{ gridTemplateColumns: `repeat(${Math.min(3, items.length)}, minmax(0, 1fr))` }} role="tablist" aria-label="Lab tools">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`relative flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[11px] font-medium transition-colors ${value === id ? "bg-accent-soft text-fg" : "text-mute hover:bg-surface-2 hover:text-fg"}`}
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
