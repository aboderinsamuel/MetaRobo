"use client";

// The creation workspace. Describe a machine (typed, spoken, or from a video) and Muse Spark
// designs it; the canvas shows it in 3D and plays its physically simulated task; the side panel
// changes it in plain words, edits parts directly, walks the task, and reports the engineering.
// Every change is a version you can step back and forward through; projects save in the browser.
import { ArrowRight, Bot, Box, Boxes, ChevronLeft, ChevronRight, CircleHelp, Copy, Cpu, FlaskConical, FolderOpen, ListChecks, Loader2, PanelLeftClose, PanelLeftOpen, PenLine, Plus, RotateCcw, ScanEye, SlidersHorizontal, Trash2, Video } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppNav from "@/components/AppNav";
import { Tour } from "@/components/lab/onboarding";
import { EXAMPLES as READY_MADE, loadExample } from "@/lib/create/examples";
import { sendToLab } from "@/lib/create/handoff";
import type { Design } from "@/lib/create/design";
import { usePlayback } from "@/lib/create/playback";
import { deleteProject, loadProjects, newProjectId, saveProject, type Project } from "@/lib/create/projects";
import { useSimulation } from "@/lib/create/useSimulation";
import type { CallUsage } from "@/lib/lab/types";
import { MODEL_CHOICES, pickModel, type ModelChoice } from "@/lib/meta/models";
import { useTheme } from "@/lib/theme";
import AgentPanel from "./AgentPanel";
import EngineeringPanel from "./EngineeringPanel";
import { Inspector, PromptBox, TaskPanel } from "./panels";
import Timeline from "./Timeline";
import { Button, IconButton, Segmented, ThemeToggle, cx } from "./ui";
import VideoPanel from "./VideoPanel";
import { CreateWelcome, TOURED_KEY, WELCOMED_KEY, createTour, markSeen, seen } from "./Welcome";
import type { CameraPreset, ViewMode } from "./Viewport";

const Viewport = dynamic(() => import("./Viewport"), { ssr: false, loading: () => <div className="size-full animate-pulse bg-canvas" /> });

const EXAMPLES = [
  "A realistic home humanoid robot that collects dirty clothes, sorts them by colour, loads a front-loading washing machine, then folds a clean shirt on a table",
  "A six-axis robot arm on a workbench that picks apples and oranges off a conveyor and sorts them into two crates",
  "A four-wheeled warehouse robot with a lifting platform that carries a box from one shelf to another",
  "A friendly desk companion robot with a round screen face and two small arms that waves and hands you a pen",
];

const STAGES = ["Reading your request", "Designing the body and joints", "Choosing actuators and materials", "Building the environment", "Planning the task"];

type Tab = "prompt" | "edit" | "task" | "engineer" | "agent" | "video";

function freshProject(design: Design, prompt: string): Project {
  const at = Date.now();
  return { id: newProjectId(), title: design.title, updated: at, versions: [{ design, prompt, at }], cursor: 0 };
}

function useStatus() {
  const [status, setStatus] = useState<{ ai: boolean; spent: number; budget: number } | null>(null);
  const refresh = useCallback(() => {
    fetch("/api/lab/status")
      .then((r) => r.json())
      .then((s: { ai: boolean; spentUsd?: number; budgetUsd?: number }) => setStatus({ ai: s.ai, spent: s.spentUsd ?? 0, budget: s.budgetUsd ?? 0 }))
      .catch(() => setStatus({ ai: false, spent: 0, budget: 0 }));
  }, []);
  useEffect(refresh, [refresh]);
  return [status, refresh] as const;
}

// Measured design times (one design, the server not busy with others): Muse Spark ≈ 35 s, Muse
// Wonder ≈ 50 s. The stages pace themselves to that.
const TYPICAL: Record<string, { s: number; hint: string }> = {
  "muse-spark-1.3": { s: 35, hint: "usually 30–60 s" },
  "muse-wonder-1.0": { s: 50, hint: "usually 45–90 s" },
};

function Generating({ startedAt, change, model }: { startedAt: number; change: boolean; model: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const s = (now - startedAt) / 1000;
  const typical = TYPICAL[model] ?? TYPICAL["muse-spark-1.3"];
  const stage = change ? Math.min(2, Math.floor(s / (typical.s / 3))) : Math.min(STAGES.length - 1, Math.floor(s / (typical.s / STAGES.length)));
  const stages = change ? ["Reading your change", "Revising the design", "Checking it still fits together"] : STAGES;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-20 flex items-center justify-center bg-canvas/60 backdrop-blur-sm">
      <div className="w-[min(92%,380px)] rounded-3xl bg-surface p-6 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.45),0_0_0_1px_var(--color-line)]">
        <div className="flex items-center gap-3">
          <span className="relative flex size-10 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Box className="size-5" />
            <span className="absolute inset-0 animate-ping rounded-2xl bg-accent/20" />
          </span>
          <div>
            <p className="text-[15px] font-semibold">{change ? "Changing" : "Designing"} your robot</p>
            <p className="text-[12.5px] text-mute tabular-nums">{MODEL_CHOICES.find((m) => m.id === model)?.name} · {Math.floor(s)} s · {typical.hint}</p>
          </div>
        </div>
        <ol className="mt-5 space-y-2.5">
          {stages.map((label, i) => (
            <li key={label} className={cx("flex items-center gap-2.5 text-[13px] transition-colors", i < stage ? "text-mute" : i === stage ? "text-fg" : "text-dim")}>
              <span className={cx("flex size-5 items-center justify-center rounded-full", i < stage ? "bg-ok/15 text-ok" : i === stage ? "bg-accent-soft text-accent" : "bg-surface-2")}>
                {i < stage ? "✓" : i === stage ? <Loader2 className="size-3 animate-spin" /> : null}
              </span>
              {label}
            </li>
          ))}
        </ol>
      </div>
    </motion.div>
  );
}

function ProjectsMenu({ current, onOpen, onNew }: { current: string | null; onOpen: (p: Project) => void; onNew: () => void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Project[]>([]);
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setList(loadProjects());
          setOpen((o) => !o);
        }}
      >
        <FolderOpen className="size-4" /> Projects
      </Button>
      {/* The click-catcher goes away at once, not after the menu's exit animation (which stalls in a
          background tab and would swallow the next click). */}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      <AnimatePresence>
        {open && (
          <>
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="absolute top-11 left-0 z-50 w-80 rounded-2xl bg-surface p-2 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.4),0_0_0_1px_var(--color-line)]">
              <button
                onClick={() => {
                  onNew();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-accent hover:bg-accent-soft"
              >
                <Plus className="size-4" /> New project
              </button>
              {list.length === 0 && <p className="px-3 py-3 text-[12.5px] text-mute">Projects you create are saved here, in this browser.</p>}
              <ul className="max-h-80 overflow-y-auto">
                {list.map((p) => (
                  <li key={p.id} className={cx("group flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-surface-2", p.id === current && "bg-surface-2")}>
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        onOpen(p);
                        setOpen(false);
                      }}
                    >
                      <p className="truncate text-[13px]">{p.title}</p>
                      <p className="text-[11px] text-mute">
                        {p.versions.length} version{p.versions.length > 1 ? "s" : ""} · {new Date(p.updated).toLocaleDateString()}
                      </p>
                    </button>
                    <IconButton
                      label="Delete project"
                      className="opacity-0 group-hover:opacity-100"
                      onClick={() => {
                        deleteProject(p.id);
                        setList(loadProjects());
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/** What produced a version, from its prompt. */
function kindOf(prompt: string, i: number): { label: string; cls: string } {
  if (i === 0) return { label: "Created", cls: "bg-accent-soft text-accent" };
  if (/^Edited\b/.test(prompt)) return { label: "Edited", cls: "bg-surface-2 text-mute" };
  if (/^(Fixed|Upsized)\b/.test(prompt)) return { label: "Engineering fix", cls: "bg-ok/12 text-ok" };
  return { label: "Changed", cls: "bg-[#0ea5e9]/12 text-[#0284c7] dark:text-[#38bdf8]" };
}

/** Every prompt, change and edit in this project, in full, oldest first; click one to open it. */
function History({ project, onOpen }: { project: Project; onOpen: (i: number) => void }) {
  const [copied, setCopied] = useState<number | null>(null);
  return (
    <section>
      <p className="mb-2 flex items-center justify-between text-[12px] font-semibold text-mute">
        <span>Project history</span>
        <span className="font-normal text-dim">
          {project.versions.length} version{project.versions.length > 1 ? "s" : ""}
        </span>
      </p>
      <ol className="relative space-y-2 before:absolute before:top-3 before:bottom-3 before:left-[15px] before:w-px before:bg-line-2">
        {project.versions.map((v, i) => {
          const k = kindOf(v.prompt, i);
          const on = i === project.cursor;
          return (
            <li key={i} className="relative">
              <div className={cx("ml-0 flex gap-3 rounded-2xl p-2.5 transition-colors", on ? "bg-accent-soft/70" : "hover:bg-surface-2")}>
                <button onClick={() => onOpen(i)} aria-label={`Open version ${i + 1}`} className={cx("relative z-10 flex size-[22px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold tabular-nums", on ? "bg-accent text-accent-fg" : "bg-surface text-mute ring-1 ring-line-2")}>
                  {i + 1}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cx("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", k.cls)}>{k.label}</span>
                    <span className="text-[11px] text-dim">{new Date(v.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                  </div>
                  <button onClick={() => onOpen(i)} className="mt-1 block w-full text-left text-[13px] leading-relaxed whitespace-pre-wrap text-fg">
                    {v.prompt}
                  </button>
                  <p className="mt-1 text-[11.5px] text-mute">{v.design.title}</p>
                </div>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(v.prompt);
                    setCopied(i);
                    setTimeout(() => setCopied(null), 1200);
                  }}
                  title="Copy this prompt"
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-dim hover:bg-surface hover:text-fg"
                >
                  {copied === i ? <span className="text-[10px]">✓</span> : <Copy className="size-3.5" />}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const MODEL_KEY = "rc-design-model";

export default function Workspace({ initial, example }: { initial?: Design; example?: string }) {
  const theme = useTheme();
  const router = useRouter();
  const [status, refreshStatus] = useStatus();
  const [project, setProject] = useState<Project | null>(() => (initial ? { id: "fixture", title: initial.title, updated: Date.now(), versions: [{ design: initial, prompt: "Test fixture", at: Date.now() }], cursor: 0 } : null));
  const [tab, setTab] = useState<Tab>("prompt");
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("skin");
  const [preset, setPreset] = useState<{ name: CameraPreset }>({ name: "iso" });
  const [busy, setBusy] = useState<{ kind: "create" | "change"; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [runKey, setRunKey] = useState(0);
  const [welcome, setWelcome] = useState(false);
  const [touring, setTouring] = useState(false);
  // Which Meta model designs and revises robots: Muse Spark by default, or Muse Wonder. Kept per browser.
  const [designModel, setDesignModel] = useState<ModelChoice>("muse-spark-1.3");
  useEffect(() => {
    let saved: ModelChoice = "muse-spark-1.3";
    try {
      saved = pickModel(localStorage.getItem(MODEL_KEY), saved);
    } catch {}
    if (saved === "muse-spark-1.3") return;
    const id = setTimeout(() => setDesignModel(saved), 0);
    return () => clearTimeout(id);
  }, []);
  const chooseModel = (m: ModelChoice) => {
    setDesignModel(m);
    try {
      localStorage.setItem(MODEL_KEY, m);
    } catch {}
  };
  const modelName = MODEL_CHOICES.find((m) => m.id === designModel)?.name ?? "Muse Spark";

  // First visit: Robo's welcome (not over a design that's already open, like a test fixture).
  useEffect(() => {
    if (initial || example || seen(WELCOMED_KEY)) return;
    const id = requestAnimationFrame(() => setWelcome(true));
    return () => cancelAnimationFrame(id);
  }, [initial, example]);

  const design = project ? project.versions[project.cursor].design : null;
  const sim = useSimulation(design, runKey);

  // A new recording starts playing from the beginning.
  useEffect(() => {
    if (sim.recording) usePlayback.getState().set({ t: 0, playing: true, duration: sim.recording.duration });
  }, [sim.recording]);

  const commit = useCallback((p: Project) => {
    setProject(p);
    if (!saveProject(p)) setError("Couldn't save to this browser's storage (it's full); the project stays open but won't be kept.");
  }, []);

  const addVersion = useCallback(
    (d: Design, prompt: string, coalesce = false) => {
      setProject((p) => {
        if (!p) return p;
        const versions = p.versions.slice();
        // Successive edits to the same part become one version.
        if (coalesce && versions[p.cursor]?.prompt === prompt && p.cursor === versions.length - 1) versions[p.cursor] = { design: { ...d, version: versions[p.cursor].design.version }, prompt, at: Date.now() };
        else versions.push({ design: { ...d, version: versions.length + 1 }, prompt, at: Date.now() });
        const next = { ...p, title: d.title, versions, cursor: versions.length - 1, updated: Date.now() };
        if (!saveProject(next)) setError("Couldn't save to this browser's storage.");
        return next;
      });
    },
    [],
  );

  const call = async (body: object, kind: "create" | "change") => {
    setBusy({ kind, at: Date.now() });
    setError(null);
    try {
      const res = await fetch("/api/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, model: designModel }) });
      const out = (await res.json()) as { design?: Design; usage?: CallUsage; error?: string };
      if (!res.ok || !out.design) throw new Error(out.error ?? `HTTP ${res.status}`);
      return out.design;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(null);
      refreshStatus();
    }
  };

  const create = async (prompt: string, observed?: string) => {
    const d = await call({ prompt, observed }, "create");
    if (!d) return;
    setSelected(null);
    setPreset({ name: "iso" });
    commit({ id: newProjectId(), title: d.title, updated: Date.now(), versions: [{ design: d, prompt, at: Date.now() }], cursor: 0 });
    setTab("task");
  };

  // A ready-made robot: a real Muse Spark design from public/examples, opened with no AI call.
  // The first one a visitor opens comes with the studio tour.
  const openExample = async (id: string) => {
    const ex = READY_MADE.find((e) => e.id === id);
    if (!ex) return;
    setError(null);
    setWelcome(false);
    markSeen(WELCOMED_KEY);
    try {
      const d = await loadExample(id);
      setSelected(null);
      setPreset({ name: "iso" });
      setPanelOpen(true);
      commit(freshProject(d, ex.prompt));
      setTab("task");
      if (!seen(TOURED_KEY)) setTimeout(() => setTouring(true), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // ?example=<id> (from the landing page) opens that ready-made robot straight away, once.
  const openedExample = useRef(false);
  useEffect(() => {
    if (!example || openedExample.current) return;
    // A timer, not an animation frame: it must also fire in a background tab.
    const id = setTimeout(() => {
      openedExample.current = true;
      void openExample(example);
    }, 0);
    return () => clearTimeout(id);
    // openExample is recreated each render; this runs once per example.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [example]);

  const showAround = () => {
    if (!design) return setWelcome(true);
    setPanelOpen(true);
    setTouring(true);
  };

  const change = async (text: string) => {
    if (!design || !project) return;
    const history = project.versions.slice(1, project.cursor + 1).map((v) => v.prompt);
    const d = await call({ design, change: text, history }, "change");
    if (d) addVersion(d, text);
  };

  const goto = (i: number) => {
    if (!project) return;
    commit({ ...project, cursor: Math.max(0, Math.min(project.versions.length - 1, i)) });
  };

  const counts = useMemo(() => (design ? { parts: design.robot.nodes.length, joints: design.robot.nodes.filter((n) => n.joint.type !== "fixed").length, objects: design.scene.length } : null), [design]);
  const live = status?.ai ?? false;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "prompt", label: design ? "Change" : "Create", icon: <PenLine className="size-3.5" /> },
    { id: "edit", label: "Edit", icon: <SlidersHorizontal className="size-3.5" /> },
    { id: "task", label: "Task", icon: <ListChecks className="size-3.5" /> },
    { id: "engineer", label: "Engineer", icon: <Cpu className="size-3.5" /> },
    { id: "agent", label: "Agent", icon: <Bot className="size-3.5" /> },
    { id: "video", label: "Video", icon: <Video className="size-3.5" /> },
  ];

  return (
    <div className="flex h-dvh flex-col bg-void text-fg">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-1">
          <AppNav />
          <span className="mx-1 hidden h-5 w-px bg-line-2 md:block" />
          <ProjectsMenu
            current={project?.id ?? null}
            onOpen={(p) => {
              setProject(p);
              setSelected(null);
              setPreset({ name: "iso" });
            }}
            onNew={() => {
              setProject(null);
              setSelected(null);
              setTab("prompt");
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Segmented size="sm" className="hidden sm:inline-flex" value={designModel} onChange={chooseModel} options={MODEL_CHOICES.map((m) => ({ id: m.id, label: m.name, title: `${m.name} designs and revises your robots` }))} />
          {status && live && (
            <span title="Meta Muse spend today, against the daily cap" className="hidden h-8 items-center gap-2 rounded-xl bg-surface-2 px-3 text-[12px] text-mute sm:inline-flex">
              <span className="size-1.5 rounded-full bg-ok" />
              Spent today <span className="text-fg tabular-nums">${status.spent.toFixed(2)}</span>
              {status.budget > 0 && <span className="tabular-nums">/ ${status.budget}</span>}
            </span>
          )}
          <IconButton label="Show me around" onClick={showAround}>
            <CircleHelp className="size-4" />
          </IconButton>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col-reverse gap-3 px-3 pb-3 lg:flex-row">
        {/* Side panel */}
        <AnimatePresence initial={false}>
          {panelOpen && (
            <motion.aside
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2 }}
              className="flex max-h-[55dvh] min-h-0 w-full shrink-0 flex-col rounded-3xl bg-surface shadow-[0_0_0_1px_var(--color-line)] lg:max-h-none lg:w-[400px]"
            >
              {design && project && (
                <div className="border-b border-line px-5 pt-4 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h1 className="truncate text-[16px] font-semibold">{design.title}</h1>
                      <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-mute">{design.summary}</p>
                    </div>
                  </div>
                  <Button
                    data-tour="lab"
                    size="sm"
                    variant="primary"
                    className="mt-3 w-full"
                    title="The same robot in the Control Lab, with a real actuator on every joint and its controller, power and wiring inside: swap and edit parts, run the checks, get firmware. Instant, no AI call."
                    onClick={() => {
                      sendToLab(project);
                      router.push("/lab?from=create");
                    }}
                  >
                    <FlaskConical className="size-4" /> Open in Control Lab
                  </Button>
                  <div data-tour="versions" className="mt-3 flex items-center gap-2">
                    <IconButton label="Previous version" disabled={project.cursor === 0} onClick={() => goto(project.cursor - 1)}>
                      <ChevronLeft className="size-4" />
                    </IconButton>
                    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
                      {project.versions.map((v, i) => (
                        <button key={i} title={v.prompt} onClick={() => goto(i)} className={cx("h-7 shrink-0 rounded-lg px-2.5 text-[12px] font-medium tabular-nums transition-colors", i === project.cursor ? "bg-accent text-accent-fg" : "bg-surface-2 text-mute hover:text-fg")}>
                          v{i + 1}
                        </button>
                      ))}
                    </div>
                    <IconButton label="Next version" disabled={project.cursor >= project.versions.length - 1} onClick={() => goto(project.cursor + 1)}>
                      <ChevronRight className="size-4" />
                    </IconButton>
                  </div>
                  <p className="mt-1.5 truncate text-[11.5px] text-dim" title={project.versions[project.cursor].prompt}>
                    v{project.cursor + 1}: {project.versions[project.cursor].prompt}
                  </p>
                </div>
              )}
              <div data-tour="tabs" className="px-4 pt-3">
                <Segmented value={tab} onChange={setTab} size="sm" className="w-full" options={tabs.filter((t) => design || t.id === "prompt" || t.id === "video").map((t) => ({ id: t.id, label: t.id === tab || !design ? t.label : "", icon: t.icon, title: t.label }))} />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 [scrollbar-width:thin]">
                {tab === "prompt" &&
                  (design ? (
                    <div className="space-y-4">
                      <p className="text-[13px] leading-relaxed text-mute">Say what to change: add an environment, swap a gripper for a hand, make it taller, give it a new task. {modelName} revises this version and keeps everything else.</p>
                      <PromptBox placeholder="e.g. Add a laundry basket by the washing machine and fold two towels too" busy={!!busy} onSubmit={(t) => void change(t)} submitLabel="Change" examples={["Make it 20% taller with longer arms", "Swap the grippers for five-finger hands", "Add a second table and stack the folded clothes on it"]} />
                      {project && <History project={project} onOpen={goto} />}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-[13px] leading-relaxed text-mute">Describe any robot or machine and the job it should do. {modelName} designs its body, joints, hands and the space it works in, then it&apos;s simulated with real physics.</p>
                      <PromptBox placeholder="Describe the robot and its task…" busy={!!busy} onSubmit={(t) => void create(t)} submitLabel="Create" examples={EXAMPLES.slice(0, 3)} />
                    </div>
                  ))}
                {tab === "edit" && design && (
                  <Inspector
                    design={design}
                    selected={selected ?? ""}
                    onChange={(d, what) => {
                      addVersion(d, what, true);
                    }}
                  />
                )}
                {tab === "task" && design && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[12.5px] text-mute">{sim.recording ? `${sim.recording.steps.filter((s) => s.ok).length} of ${design.task.length} steps succeeded` : "Simulating…"}</p>
                      <Button size="sm" variant="ghost" disabled={sim.running} onClick={() => setRunKey((k) => k + 1)}>
                        {sim.running ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Run again
                      </Button>
                    </div>
                    <TaskPanel design={design} recording={sim.recording} />
                  </div>
                )}
                {tab === "agent" && design && <AgentPanel design={design} live={live} onDesign={(d, what) => addVersion(d, what)} />}
                {tab === "engineer" && design && <EngineeringPanel design={design} recording={sim.recording} onApply={(d, what) => addVersion(d, what)} onSelect={(id) => (setSelected(id), setTab("edit"))} />}
                {tab === "video" && <VideoPanel design={design} recording={sim.recording} busy={!!busy} onBuild={(p, o) => void create(p, o)} onSpend={refreshStatus} />}
                {error && <p className="mt-4 rounded-xl bg-bad/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-bad">{error}</p>}
                {!live && status && <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-mute">New designs are paused on this demo right now. Saved projects still open and simulate.</p>}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Canvas */}
        <main className="relative flex min-h-[55dvh] min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-canvas shadow-[0_0_0_1px_var(--color-line)] lg:min-h-0">
          {design ? (
            <>
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-2 p-3">
                <div className="pointer-events-auto flex items-center gap-2">
                  <IconButton label={panelOpen ? "Hide panel" : "Show panel"} onClick={() => setPanelOpen((o) => !o)} className="hidden bg-surface/85 backdrop-blur lg:inline-flex">
                    {panelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                  </IconButton>
                  <div data-tour="views">
                    <Segmented
                      size="sm"
                      value={mode}
                      onChange={setMode}
                      className="bg-surface/85 backdrop-blur"
                      options={[
                        { id: "skin", label: "Skin", icon: <Box className="size-3.5" /> },
                        { id: "skeleton", label: "Skeleton", icon: <ScanEye className="size-3.5" /> },
                        { id: "both", label: "Skin + Rig", icon: <Boxes className="size-3.5" /> },
                      ]}
                    />
                  </div>
                </div>
                <div className="pointer-events-auto flex items-center gap-2">
                  {counts && (
                    <span className="hidden h-9 items-center rounded-xl bg-surface/85 px-3 text-[12px] text-mute backdrop-blur md:inline-flex">
                      <span className="text-fg tabular-nums">{counts.joints}</span>&nbsp;joints ·&nbsp;<span className="text-fg tabular-nums">{counts.parts}</span>&nbsp;parts ·&nbsp;<span className="text-fg tabular-nums">{counts.objects}</span>&nbsp;scene objects
                    </span>
                  )}
                  <div data-tour="cameras">
                    <Segmented
                      size="sm"
                      value={preset.name}
                      onChange={(name) => setPreset({ name })}
                      className="bg-surface/85 backdrop-blur"
                      options={(["iso", "front", "side", "top", "scene"] as const).map((id) => ({ id, label: id === "iso" ? "Robot" : id[0].toUpperCase() + id.slice(1), title: id === "scene" ? "Frame the whole scene" : undefined }))}
                    />
                  </div>
                </div>
              </div>
              <div data-tour="viewport" className="relative min-h-0 flex-1">
                <Viewport design={design} recording={sim.recording} selected={selected} onSelect={(id) => (setSelected(id), id && setTab("edit"))} mode={mode} preset={preset} theme={theme} />
                {sim.error && <p className="absolute bottom-3 left-3 rounded-xl bg-bad/10 px-3 py-2 text-[12px] text-bad backdrop-blur">Simulation failed: {sim.error}</p>}
                <div className="pointer-events-none absolute bottom-3 left-3 hidden gap-1.5 sm:flex">
                  <span className="rounded-full bg-surface/85 px-2.5 py-1 text-[11px] text-mute backdrop-blur" title="Objects, furniture, doors and cloth run in a physics engine">
                    <span className="mr-1 inline-block size-1.5 rounded-full bg-ok align-middle" /> Physics: rigid bodies + cloth
                  </span>
                  <span className="rounded-full bg-surface/85 px-2.5 py-1 text-[11px] text-mute backdrop-blur" title="The robot is position-controlled: inverse kinematics within joint limits and actuator speeds">
                    <span className="mr-1 inline-block size-1.5 rounded-full bg-accent align-middle" /> Robot: IK-planned motion
                  </span>
                </div>
              </div>
              <div data-tour="timeline" className="border-t border-line bg-surface/90 backdrop-blur">
                <Timeline recording={sim.recording} running={sim.running} progress={sim.progress} />
              </div>
            </>
          ) : (
            <div className="relative flex flex-1 items-center justify-center overflow-y-auto p-6">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--color-line)_1px,transparent_1px),linear-gradient(90deg,var(--color-line)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)] bg-[size:32px_32px]" />
              <div className="relative w-full max-w-2xl">
                <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-[12px] font-medium text-accent">
                  Real joints, real actuators, real physics
                </p>
                <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] leading-[1.08] font-semibold tracking-[-0.025em]">What should we build?</h2>
                <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-mute">Describe any robot and the job it should do. You&apos;ll get a custom 3D design with real joints and actuators, the space it works in, and a simulation of it doing the task.</p>
                <div className="mt-6">
                  <PromptBox large autoFocus placeholder="A home humanoid that loads the washing machine and folds the laundry…" busy={!!busy} onSubmit={(t) => void create(t)} submitLabel="Create" examples={EXAMPLES} />
                </div>
                <div className="mt-7">
                  <p className="text-[13px] font-medium">
                    Or open a ready-made robot <span className="font-normal text-mute">· opens instantly</span>
                  </p>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                    {READY_MADE.map((e) => (
                      <button key={e.id} onClick={() => void openExample(e.id)} className="group flex items-center gap-3 rounded-2xl bg-surface/80 px-3.5 py-3 text-left shadow-[0_0_0_1px_var(--color-line)] backdrop-blur transition-shadow hover:shadow-[0_0_0_1px_var(--color-line-2)]">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-medium">{e.title}</span>
                          <span className="block truncate text-[12px] text-mute">{e.blurb}</span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={() => setTab("video")} className="mt-5 inline-flex items-center gap-2 text-[13px] text-mute hover:text-fg">
                  <Video className="size-4" /> Or start from a video of a real robot
                </button>
              </div>
            </div>
          )}
          <AnimatePresence>{busy && <Generating startedAt={busy.at} change={busy.kind === "change"} model={designModel} />}</AnimatePresence>
        </main>
      </div>
      <AnimatePresence>
        {welcome && (
          <CreateWelcome
            live={live}
            onExample={(id) => void openExample(id)}
            onDescribe={() => {
              setWelcome(false);
              markSeen(WELCOMED_KEY);
              setTimeout(() => document.querySelector<HTMLTextAreaElement>("main textarea")?.focus(), 50);
            }}
            onClose={() => {
              setWelcome(false);
              markSeen(WELCOMED_KEY);
            }}
          />
        )}
      </AnimatePresence>
      {touring && design && (
        <Tour
          steps={createTour()}
          onClose={() => {
            setTouring(false);
            markSeen(TOURED_KEY);
          }}
        />
      )}
    </div>
  );
}
